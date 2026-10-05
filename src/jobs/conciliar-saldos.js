/**
 * Job de conciliação de saldos.
 *
 *   npm run conciliar              # relatório (somente leitura)
 *   npm run conciliar -- --corrigir # relatório + reconstrução do cache
 *
 * Agende em cron / Cloud Scheduler (ex.: todo dia às 03:30, depois da
 * expiração de pontos):
 *   30 3 * * *  cd /opt/promosys && node --env-file=.env src/jobs/conciliar-saldos.js >> logs/conciliacao.log 2>&1
 *
 * Contrato de saída (útil para alertas de cron):
 *   ▸ código 0 — nenhuma divergência de saldo (ou todas corrigidas com --corrigir)
 *   ▸ código 1 — faltou conciliar (divergência detectada e nenhuma correção pedida)
 *   ▸ código 2 — uso incorreto (flag desconhecida/inválida)
 *
 * Opções:
 *   --corrigir     reconstrói `clientes.pontos_saldo` a partir dos lotes
 *                  (auditado em `audit_log`, com linha de AJUSTE no razão)
 *   --limite=N     clientes divergentes analisados por execução (padrão 200)
 *   --json         imprime o relatório em JSON (para BI/painel de operação)
 *   --ajuda        mostra este texto
 */
import { db } from '../core/database/pool.js';
import * as conciliacao from '../modules/pontos/conciliacao.service.js';
import { registrarAuditoria } from '../core/audit.js';
import { lerFlags, FlagInvalidaError } from '../utils/cli.js';

const AJUDA = `
Conciliação de saldos de pontos (invariante: clientes.pontos_saldo = SUM(lotes_pontos.pontos_disponiveis))

  npm run conciliar                 relatório somente leitura
  npm run conciliar -- --corrigir   reconstrói o cache a partir dos lotes
  npm run conciliar -- --limite=500 analisa até 500 clientes divergentes
  npm run conciliar -- --json       saída em JSON
`.trim();

/** Flags aceitas (a validação vive em `src/utils/cli.js`). */
const FLAGS = {
  corrigir: { tipo: 'booleana' },
  json: { tipo: 'booleana' },
  ajuda: { tipo: 'booleana' },
  h: { tipo: 'booleana' },
  limite: { tipo: 'inteiro', padrao: conciliacao.LIMITE_PADRAO, minimo: 1 },
};

/** Lê as opções da linha de comando com validação (nada de flag livre). */
export function lerArgumentos(argv = []) {
  const flags = lerFlags(argv, FLAGS);

  return {
    corrigir: flags.corrigir,
    json: flags.json,
    ajuda: flags.ajuda || flags.h,
    limite: flags.limite,
  };
}

/** Formata a diferença com sinal explícito (+ sobra no cache / - falta). */
function comSinal(valor) {
  return `${valor > 0 ? '+' : ''}${valor}`;
}

function imprimirRelatorio(analise) {
  const { base, divergencias, resumo, lotesVencidosPendentes } = analise;

  console.log(`\nConciliação de saldos — ${analise.geradoEm}`);
  console.log(
    `Base: ${base.clientes} cliente(s) · ${base.clientesAtivos} ativo(s) · ` +
      `saldo materializado ${base.saldoMaterializado} · saldo em lotes ${base.saldoLotes}`,
  );

  if (divergencias.total === 0) {
    console.log('\n✔ Cache e lotes estão em sincronia para todos os clientes.');
  } else {
    console.log(
      `\n✖ ${divergencias.total} cliente(s) divergente(s): ` +
        `${resumo.clientesInflados} com saldo inflado (${resumo.pontosInflados} ponto(s)) e ` +
        `${resumo.clientesDefasados} defasado(s) (${resumo.pontosDefasados} ponto(s)).`,
    );

    console.log('\n  id      cpf            cache   lotes   dif     motivo');
    for (const item of divergencias.itens) {
      console.log(
        `  ${String(item.clienteId).padEnd(7)} ${item.cpf.padEnd(14)} ` +
          `${String(item.saldoMaterializado).padStart(5)}   ${String(item.saldoLotes).padStart(5)}   ` +
          `${comSinal(item.diferenca).padStart(6)}  ${item.tipo}${item.ativo ? '' : ' (inativo)'}`,
      );
    }

    if (divergencias.exibidas < divergencias.total) {
      console.log(`  … ${divergencias.total - divergencias.exibidas} cliente(s) fora do limite desta execução.`);
    }
  }

  if (lotesVencidosPendentes.lotes > 0) {
    console.log(
      `\n⚠ ${lotesVencidosPendentes.lotes} lote(s) vencido(s) ainda com ` +
        `${lotesVencidosPendentes.pontos} ponto(s): rode "npm run pontos:expirar".`,
    );
  }
}

async function executar() {
  const opcoes = lerArgumentos(process.argv.slice(2));

  if (opcoes.ajuda) {
    console.log(AJUDA);
    return 0;
  }

  const inicio = Date.now();
  const analise = await conciliacao.analisarSaldos({ limite: opcoes.limite });

  let correcao = null;
  if (opcoes.corrigir && analise.divergencias.total > 0) {
    correcao = await conciliacao.corrigirSaldos({ limite: opcoes.limite });
  }

  // Depois de corrigir, reanalisa: o código de saída reflete o estado final.
  const final = correcao ? await conciliacao.analisarSaldos({ limite: opcoes.limite }) : analise;
  const duracao = Date.now() - inicio;

  if (opcoes.json) {
    console.log(JSON.stringify({ ...final, correcao, duracaoMs: duracao }, null, 2));
  } else {
    imprimirRelatorio(final);

    if (correcao) {
      console.log(
        `\nCorreção aplicada em ${correcao.corrigidos.length} cliente(s) ` +
          `(${correcao.resumo.pontosInflados} ponto(s) removidos do cache inflado, ` +
          `${correcao.resumo.pontosDefasados} creditados no cache defasado).`,
      );
    } else if (analise.divergencias.total > 0) {
      console.log('\nNada foi alterado. Rode com --corrigir para reconstruir o cache a partir dos lotes.');
    }

    console.log(`\nExecução concluída em ${duracao}ms.`);
  }

  await registrarAuditoria({
    acao: 'CONCILIACAO_SALDOS_EXECUTADA',
    entidade: 'clientes',
    entidadeId: null,
    dadosNovos: {
      modo: opcoes.corrigir ? 'CORRECAO' : 'RELATORIO',
      limite: opcoes.limite,
      divergentesAntes: analise.divergencias.total,
      corrigidos: correcao?.corrigidos.length ?? 0,
      divergentesDepois: final.divergencias.total,
      pontosInflados: final.resumo.pontosInflados,
      pontosDefasados: final.resumo.pontosDefasados,
      lotesVencidosPendentes: final.lotesVencidosPendentes.lotes,
      duracaoMs: duracao,
    },
  });

  return final.divergencias.total;
}

executar()
  .then((restantes) => {
    if (restantes > 0) {
      console.error(`\n${restantes} cliente(s) seguem divergentes.`);
      process.exitCode = 1;
    }
  })
  .catch((erro) => {
    if (erro instanceof FlagInvalidaError) {
      console.error(`Uso incorreto: ${erro.message}\n`);
      console.error(AJUDA);
      process.exitCode = 2;
      return;
    }

    console.error('Falha no job de conciliação de saldos:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
