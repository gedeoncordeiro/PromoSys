/**
 * Conciliação de saldos — auditoria de integridade do programa de fidelidade.
 *
 * Invariante nº 1 do motor de pontuação (`pontos.service.js`):
 *
 *     clientes.pontos_saldo === SUM(lotes_pontos.pontos_disponiveis)
 *
 * `pontos_saldo` é um CACHE materializado para dar leitura O(1) no balcão do
 * PDV. Se uma transação morrer no meio, um bug de código ou uma intervenção
 * manual no banco rodar por fora da API, o cache pode sair de sincronia com os
 * lotes — e a loja passa a mostrar um saldo que não existe (risco de resgate
 * indevido) ou a esconder pontos legítimos do cliente (risco de reclamação no
 * Procon).
 *
 * O que este módulo faz:
 *   ▸ `analisarSaldos()`  — SOMENTE LEITURA. Compara cache × lotes e devolve
 *     um relatório com os divergentes, agregados e alertas operacionais.
 *   ▸ `corrigirSaldos()`  — reconstrói o cache a partir da fonte da verdade.
 *     Exige intenção explícita (`--corrigir` no job), roda dentro de transação
 *     com a linha do cliente bloqueada e deixa trilha no livro razão e em
 *     `audit_log`.
 */
import { db } from '../../core/database/pool.js';
import * as repositorio from './pontos.repository.js';
import * as clientesRepositorio from '../clientes/clientes.repository.js';
import {
  classificarDivergencia,
  mapearDivergencia,
  resumirDivergencias,
  TIPOS_DIVERGENCIA,
} from './conciliacao.regras.js';
import { registrarAuditoria } from '../../core/audit.js';
import { ORIGENS_PONTOS, TIPOS_TRANSACAO } from '../../config/constants.js';

/**
 * Regras puras (classificação, resumo e mapper) vivem em `conciliacao.regras.js`
 * e são reexportadas aqui para manter um único ponto de entrada do módulo.
 */
export { TIPOS_DIVERGENCIA, classificarDivergencia, resumirDivergencias, mapearDivergencia };

/** Quantos clientes divergentes entram no relatório/correção por execução. */
export const LIMITE_PADRAO = 200;

/**
 * Relatório de integridade. Não altera nada.
 *
 * @param {{ limite?: number }} [opcoes] quantos divergentes trazer no detalhe
 */
export async function analisarSaldos({ limite = LIMITE_PADRAO } = {}) {
  const quantidade = Number(limite) > 0 ? Number(limite) : LIMITE_PADRAO;

  const [base, total, linhas, agregado, vencidos] = await Promise.all([
    repositorio.resumirBase(),
    repositorio.contarDivergenciasDeSaldo(),
    repositorio.listarDivergenciasDeSaldo({ limit: quantidade, offset: 0 }),
    repositorio.resumirDivergenciasDeSaldo(),
    repositorio.resumirLotesVencidosPendentes(),
  ]);

  const itens = linhas.map(mapearDivergencia);

  return {
    geradoEm: new Date().toISOString(),
    base: {
      clientes: Number(base?.clientes ?? 0),
      clientesAtivos: Number(base?.clientes_ativos ?? 0),
      saldoMaterializado: Number(base?.saldo_materializado ?? 0),
      saldoLotes: Number(base?.saldo_lotes ?? 0),
    },
    divergencias: {
      total: Number(total?.total ?? 0),
      exibidas: itens.length,
      itens,
    },
    // Agregado exato sobre TODA a base, independente da página exibida.
    resumo: {
      clientesDivergentes: Number(agregado?.clientes ?? 0),
      clientesInflados: Number(agregado?.clientes_inflados ?? 0),
      clientesDefasados: Number(agregado?.clientes_defasados ?? 0),
      pontosInflados: Number(agregado?.pontos_inflados ?? 0),
      pontosDefasados: Number(agregado?.pontos_defasados ?? 0),
    },
    lotesVencidosPendentes: {
      lotes: Number(vencidos?.lotes ?? 0),
      pontos: Number(vencidos?.pontos ?? 0),
    },
  };
}

/**
 * Reconstrói o saldo de UM cliente a partir dos lotes, dentro de uma transação.
 * O lock na linha do cliente (mesma ordem usada por todo o motor: cliente →
 * lote) serializa contra créditos, estornos e expirações concorrentes.
 */
async function corrigirUmCliente(clienteId) {
  return db.withTransaction(async (conexao) => {
    const cliente = await clientesRepositorio.bloquearPorId(clienteId, conexao);
    if (!cliente) return null;

    const { total } = await repositorio.somarPontosDisponiveisDoCliente(clienteId, conexao);

    const saldoApos = Number(total);
    const saldoAnterior = Number(cliente.pontos_saldo);
    const diferenca = saldoApos - saldoAnterior;

    // Outra execução (ou um movimento legítimo) pode ter reconciliado antes.
    if (diferenca === 0) return null;

    const tipo = classificarDivergencia(diferenca);

    // O movimento entra no razão: a conciliação altera o saldo do cliente e a
    // trilha precisa explicar de onde veio a variação.
    const { insertId: transacaoId } = await repositorio.inserirTransacao(
      {
        clienteId,
        unidadeId: null,
        usuarioId: null,
        tipo: TIPOS_TRANSACAO.AJUSTE,
        origem: ORIGENS_PONTOS.AJUSTE_MANUAL,
        pontos: Math.abs(diferenca),
        descricao: `Conciliação de saldo (${tipo}): ${saldoAnterior} -> ${saldoApos} pontos (lotes)`,
        saldoApos,
      },
      conexao,
    );

    await clientesRepositorio.ajustarSaldoEAtualizarNivel(clienteId, diferenca, conexao);

    await registrarAuditoria(
      {
        acao: 'SALDO_CONCILIADO',
        entidade: 'clientes',
        entidadeId: clienteId,
        dadosAnteriores: { saldo: saldoAnterior, nivel: cliente.nivel },
        dadosNovos: {
          saldo: saldoApos,
          diferenca,
          tipo,
          transacaoId: Number(transacaoId),
          origem: 'conciliacao',
        },
      },
      conexao,
    );

    return {
      clienteId,
      saldoAnterior,
      saldoApos,
      diferenca,
      tipo,
      transacaoId: Number(transacaoId),
    };
  });
}

/**
 * Corrige até `limite` clientes divergentes (um por vez, cada um em sua
 * transação curta). Operação de escrita: só deve ser chamada com intenção
 * explícita e sempre deixa rastro em `audit_log`.
 */
export async function corrigirSaldos({ limite = LIMITE_PADRAO } = {}) {
  const quantidade = Number(limite) > 0 ? Number(limite) : LIMITE_PADRAO;

  const linhas = await repositorio.listarDivergenciasDeSaldo({ limit: quantidade, offset: 0 });

  const corrigidos = [];
  for (const linha of linhas) {
    const resultado = await corrigirUmCliente(Number(linha.cliente_id));
    if (resultado) corrigidos.push(resultado);
  }

  return { corrigidos, resumo: resumirDivergencias(corrigidos) };
}

/** Verificação de integridade usada pelos testes e por smoke tests. */
export async function saldoEstaIntegro(clienteId) {
  const linha = await db.queryOne(
    `SELECT c.pontos_saldo AS saldo_materializado,
            COALESCE((SELECT SUM(pontos_disponiveis) FROM lotes_pontos WHERE cliente_id = c.id), 0) AS saldo_lotes
       FROM clientes c
      WHERE c.id = ?`,
    [clienteId],
  );

  if (!linha) return false;

  return Number(linha.saldo_materializado) === Number(linha.saldo_lotes);
}
