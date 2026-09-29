/**
 * Job de expiração de pontos.
 *
 *   npm run pontos:expirar
 *
 * Agende em cron / Cloud Scheduler (ex.: todo dia às 03:00):
 *   0 3 * * *  cd /opt/promosys && node --env-file=.env src/jobs/expirar-pontos.js
 *
 * Regra: todo lote de pontos com `expira_em < hoje` e saldo remanescente é
 * zerado e gera uma transação de EXPIRACAO no razão, descontando o saldo
 * materializado do cliente — tudo na mesma transação, com o lote e o cliente
 * bloqueados (FOR UPDATE), o que torna o job seguro para execução concorrente.
 *
 * O job é idempotente: roda duas vezes seguidas e nada acontece na segunda.
 */
import { db } from '../core/database/pool.js';
import * as pontosRepositorio from '../modules/pontos/pontos.repository.js';
import * as clientesRepositorio from '../modules/clientes/clientes.repository.js';
import { registrarAuditoria } from '../core/audit.js';
import { ORIGENS_PONTOS, TIPOS_TRANSACAO } from '../config/constants.js';

/** Lotes processados por rodada (mantém as transações curtas). */
const LOTE_POR_RODADA = 200;
/** Trava de segurança contra loop infinito. */
const MAX_RODADAS = 500;

async function expirarUmLote(loteId) {
  return db.withTransaction(async (conexao) => {
    const lote = await pontosRepositorio.bloquearLotePorId(loteId, conexao);

    // Revalida dentro da transação: outro processo pode já ter expirado o lote.
    if (!lote || Number(lote.pontos_disponiveis) <= 0) return null;

    const pontos = Number(lote.pontos_disponiveis);

    const cliente = await clientesRepositorio.bloquearPorId(lote.cliente_id, conexao);
    if (!cliente) return null;

    const saldoApos = Math.max(Number(cliente.pontos_saldo) - pontos, 0);

    const { insertId: transacaoId } = await pontosRepositorio.inserirTransacao(
      {
        clienteId: Number(lote.cliente_id),
        unidadeId: null,
        usuarioId: null,
        tipo: TIPOS_TRANSACAO.EXPIRACAO,
        origem: ORIGENS_PONTOS.EXPIRACAO,
        pontos,
        descricao: `Expiração do lote #${lote.id}`,
        saldoApos,
      },
      conexao,
    );

    await pontosRepositorio.debitarLote(lote.id, pontos, conexao);
    await clientesRepositorio.ajustarSaldoEAtualizarNivel(cliente.id, -pontos, conexao);

    await registrarAuditoria(
      {
        acao: 'PONTOS_EXPIRADOS',
        entidade: 'lotes_pontos',
        entidadeId: lote.id,
        dadosNovos: { clienteId: Number(lote.cliente_id), pontos, saldoApos, transacaoId },
      },
      conexao,
    );

    return { clienteId: Number(lote.cliente_id), pontos };
  });
}

async function executar() {
  const inicio = Date.now();
  let totalLotes = 0;
  let totalPontos = 0;

  for (let rodada = 1; rodada <= MAX_RODADAS; rodada += 1) {
    const lotes = await pontosRepositorio.listarLotesVencidos(LOTE_POR_RODADA);

    if (lotes.length === 0) break;

    for (const lote of lotes) {
      const resultado = await expirarUmLote(lote.id);

      if (resultado) {
        totalLotes += 1;
        totalPontos += resultado.pontos;
      }
    }

    console.log(`[rodada ${rodada}] ${lotes.length} lote(s) vencido(s) processado(s)`);
  }

  const duracao = Date.now() - inicio;

  console.log(
    `\nExpiração concluída: ${totalLotes} lote(s), ${totalPontos} ponto(s) expirado(s) em ${duracao}ms.`,
  );
}

executar()
  .catch((erro) => {
    console.error('Falha no job de expiração de pontos:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
