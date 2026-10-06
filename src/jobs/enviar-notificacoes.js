/**
 * Job de envio das notificações da outbox (WhatsApp).
 *
 *   npm run notificacoes:enviar                 # drena a fila
 *   npm run notificacoes:enviar -- --situacao   # só o retrato da fila
 *   npm run notificacoes:enviar -- --simular    # mostra o que sairia, sem enviar
 *
 * É o segundo tempo do padrão outbox: o crédito de pontos só GRAVA a intenção
 * (dentro da transação); quem fala com o provedor é este job, fora da transação.
 *
 * Agende em cron (a cada 5 minutos funciona bem; o backoff cuida do resto):
 *   *\/5 * * * *  cd /opt/promosys && node --env-file=.env src/jobs/enviar-notificacoes.js >> logs/notificacoes.log 2>&1
 *
 * Contrato de saída (útil para alertas de cron):
 *   ▸ código 0 — nada mais a entregar (fila drenada, ou canal desligado)
 *   ▸ código 1 — sobraram itens recuperáveis (provedor fora do ar / instabilidade)
 *   ▸ código 2 — uso incorreto (flag desconhecida/inválida)
 *
 * Opções:
 *   --limite=N    quantos itens processar nesta execução (padrão NOTIFICACOES_LOTE)
 *   --simular     modo dry-run: mostra a fila sem enviar nem reivindicar nada
 *   --situacao    apenas o retrato da fila (não envia nada)
 *   --json        saída em JSON (para BI/painel de operação)
 *   --ajuda       mostra este texto
 *
 * Nota: diferente do job de conciliação, este NÃO grava auditoria em cada
 * execução — ele roda a cada poucos minutos e a própria outbox já é a trilha
 * (quem, quando, tentativas, erro). Auditoria por execução só inflaria o log.
 */
import { db } from '../core/database/pool.js';
import * as notificacoes from '../modules/notificacoes/notificacoes.service.js';
import { lerFlags, FlagInvalidaError } from '../utils/cli.js';

const AJUDA = `
Envio das notificações enfileiradas (outbox → WhatsApp)

  npm run notificacoes:enviar                   drena a fila
  npm run notificacoes:enviar -- --situacao     mostra o retrato da fila
  npm run notificacoes:enviar -- --simular      simula o envio (nada é gravado)
  npm run notificacoes:enviar -- --limite=50    processa até 50 itens
`.trim();

/** Flags aceitas (a validação vive em `src/utils/cli.js`). */
const FLAGS = {
  limite: { tipo: 'inteiro', minimo: 1 },
  simular: { tipo: 'booleana' },
  situacao: { tipo: 'booleana' },
  json: { tipo: 'booleana' },
  ajuda: { tipo: 'booleana' },
  h: { tipo: 'booleana' },
};

/** Lê as opções da linha de comando com validação (nada de flag livre). */
export function lerArgumentos(argv = []) {
  const flags = lerFlags(argv, FLAGS);

  return {
    limite: flags.limite,
    simular: flags.simular,
    situacao: flags.situacao,
    json: flags.json,
    ajuda: flags.ajuda || flags.h,
  };
}

function imprimirSituacao(situacao) {
  console.log(`\nFila de notificações — canal ${situacao.habilitado ? 'ATIVO' : 'DESLIGADO'}`);
  console.log(
    `Itens: ${situacao.total} · pendentes ${situacao.pendentes} · ` +
      `aguardando nova tentativa ${situacao.aguardandoNovaTentativa} · ` +
      `enviadas ${situacao.enviadas} · canceladas ${situacao.canceladas}`,
  );

  if (situacao.recuperaveis > 0) {
    console.log(
      `\n⚠ ${situacao.recuperaveis} item(ns) ainda podem ser entregues ` +
        `(limite de ${situacao.maxTentativas} tentativa(s) por item).`,
    );
  }
}

function imprimirExecucao(execucao) {
  const { resumo, resultados } = execucao;

  console.log(`\nEnvio de notificações — ${execucao.geradoEm} (provedor: ${execucao.provedor})`);

  if (execucao.simulado) {
    console.log(`Simulação: ${resumo.simuladas} item(ns) sairiam nesta execução.`);
  } else {
    console.log(
      `Analisadas ${resumo.analisadas} · enviadas ${resumo.enviadas} · ` +
        `reagendadas ${resumo.reagendadas} · canceladas ${resumo.canceladas} · ` +
        `ignoradas ${resumo.ignoradas}`,
    );
  }

  const comProblema = resultados.filter(
    (resultado) => resultado.status === 'FALHA' || resultado.status === 'CANCELADA',
  );

  if (comProblema.length > 0) {
    console.log('\n  id     status      tipo                tent.  destino          detalhe');
    for (const item of comProblema) {
      console.log(
        `  ${String(item.id).padEnd(6)} ${item.status.padEnd(11)} ` +
          `${String(item.tipo).padEnd(19)} ${String(item.tentativas).padStart(5)}  ` +
          `${String(item.destino ?? '—').padEnd(16)} ${item.motivo ?? ''}`,
      );
      if (item.erro) console.log(`         └ ${item.erro}`);
      if (item.proximaTentativaEm) console.log(`           próxima tentativa: ${item.proximaTentativaEm}`);
    }
  }
}

async function executar() {
  const opcoes = lerArgumentos(process.argv.slice(2));

  if (opcoes.ajuda) {
    console.log(AJUDA);
    return 0;
  }

  const config = notificacoes.configuracaoDeEnvio();
  const inicio = Date.now();

  if (opcoes.situacao) {
    const situacao = await notificacoes.situacaoDaFila({ config });

    if (opcoes.json) console.log(JSON.stringify({ situacao }, null, 2));
    else imprimirSituacao(situacao);

    return situacao.recuperaveis;
  }

  if (!config.habilitado) {
    const situacao = await notificacoes.situacaoDaFila({ config });

    if (opcoes.json) {
      console.log(
        JSON.stringify(
          { aviso: 'NOTIFICACOES_HABILITADAS=false: nada foi enviado.', situacao },
          null,
          2,
        ),
      );
    } else {
      console.log(
        '\nNotificações desligadas (NOTIFICACOES_HABILITADAS=false). ' +
          'Nada foi enviado — a fila só cresce se o canal for ligado.',
      );
      imprimirSituacao(situacao);
    }

    return 0;
  }

  const execucao = await notificacoes.processarFila({
    limite: opcoes.limite,
    simular: opcoes.simular,
    config,
  });

  const depois = await notificacoes.situacaoDaFila({ config });
  const duracao = Date.now() - inicio;

  if (opcoes.json) {
    console.log(JSON.stringify({ ...execucao, fila: depois, duracaoMs: duracao }, null, 2));
  } else {
    imprimirExecucao(execucao);

    if (depois.recuperaveis > 0) {
      console.log(
        `\nRestam ${depois.recuperaveis} item(ns) recuperáveis — o cron volta a tentar. ` +
          'Se o provedor estiver fora do ar, verifique WHATSAPP_API_URL.',
      );
    } else {
      console.log('\n✔ Nada mais a entregar.');
    }

    console.log(`\nExecução concluída em ${duracao}ms.`);
  }

  return depois.recuperaveis;
}

executar()
  .then((restantes) => {
    if (restantes > 0) {
      console.error(`\n${restantes} notificação(ões) seguem na fila.`);
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

    console.error('Falha no job de notificações:', erro);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.close();
  });
