/**
 * Serviço de notificações (padrão transactional outbox).
 *
 * Duas metades, com responsabilidades bem separadas:
 *
 *  1. `enfileirarCredito` / `enfileirarEstorno` — rodam DENTRO da transação que
 *     movimenta pontos. Só gravam a INTENÇÃO do aviso (INSERT na outbox), nunca
 *     falam com o provedor. Consequências: o lock do cliente não fica preso numa
 *     chamada de rede, e o aviso existe se e somente se o movimento existir.
 *
 *  2. `processarFila` — roda FORA da transação, chamado pelo job
 *     (`npm run notificacoes:enviar`). Reivindica itens com lease, envia, e
 *     decide entre reagendar (com backoff) e desistir.
 *
 * LGPD: só entra na fila quem tem telefone válido E consentimento vigente para
 * WhatsApp (`consentimentos`, finalidade WHATSAPP). Sem consentimento, nada é
 * gravado — e a versão do termo aceito vai junto no payload, para auditoria.
 */
import { db } from '../../core/database/pool.js';
import { env } from '../../config/env.js';
import { logger } from '../../core/logger.js';
import * as clientesRepositorio from '../clientes/clientes.repository.js';
import * as repositorio from './notificacoes.repository.js';
import { criarProvedor } from './notificacoes.client.js';
import {
  CANAIS,
  STATUS_NOTIFICACAO,
  STATUS_SIMULADO,
  TEMPLATE_CREDITO_PADRAO,
  TEMPLATE_ESTORNO_PADRAO,
  TIPOS_NOTIFICACAO,
  calcularProximaTentativa,
  classificarFalha,
  higienizarErro,
  mascararTelefone,
  montarMensagem,
  podeNotificar,
  resumirProcessamento,
} from './notificacoes.regras.js';

/** Configuração de envio derivada do ambiente (nunca lida de `process.env` solta). */
export function configuracaoDeEnvio() {
  return {
    habilitado: env.NOTIFICACOES_HABILITADAS,
    provedor: env.WHATSAPP_PROVEDOR,
    url: env.WHATSAPP_API_URL || null,
    apiKey: env.WHATSAPP_API_KEY || null,
    instancia: env.WHATSAPP_INSTANCIA || null,
    timeoutMs: env.WHATSAPP_TIMEOUT_MS,
    templateCredito: env.WHATSAPP_TEMPLATE_CREDITO || TEMPLATE_CREDITO_PADRAO,
    templateEstorno: env.WHATSAPP_TEMPLATE_ESTORNO || TEMPLATE_ESTORNO_PADRAO,
    maxTentativas: env.NOTIFICACOES_MAX_TENTATIVAS,
    lote: env.NOTIFICACOES_LOTE,
    leaseSegundos: env.NOTIFICACOES_LEASE_SEGUNDOS,
    backoffBaseSegundos: env.NOTIFICACOES_BACKOFF_BASE_SEGUNDOS,
    backoffTetoSegundos: env.NOTIFICACOES_BACKOFF_TETO_SEGUNDOS,
  };
}

/** Template aplicável a cada tipo de aviso. */
function templatePara(tipo, config) {
  return tipo === TIPOS_NOTIFICACAO.PONTOS_ESTORNADOS
    ? config.templateEstorno
    : config.templateCredito;
}

/** Nome da unidade para a mensagem ("Compra de R$ 149,90 em Centro"). */
async function nomeDaUnidade(unidadeId, conexao) {
  if (!unidadeId) return null;

  const linha = await db.queryOne('SELECT nome FROM unidades WHERE id = ? LIMIT 1', [unidadeId], conexao);
  return linha?.nome ?? null;
}

/**
 * Grava a intenção do aviso na outbox.
 *
 * NUNCA lança: um problema no enfileiramento não pode derrubar (nem reverter) o
 * crédito de pontos que o operador acabou de fazer no balcão. Falha vira log.
 *
 * @returns {Promise<{ enfileirado: boolean, motivo?: string, notificacaoId?: number }>}
 */
async function enfileirar(
  { cliente, transacaoId, tipo, dados },
  conexao,
  config = configuracaoDeEnvio(),
) {
  try {
    const consentimentos = await clientesRepositorio.listarConsentimentos(cliente.id, conexao);
    const decisao = podeNotificar({
      habilitado: config.habilitado,
      cliente,
      consentimentos,
    });

    if (!decisao.elegivel) {
      logger.debug(
        { clienteId: Number(cliente.id), tipo, motivo: decisao.motivo },
        'Notificação não enfileirada',
      );
      return { enfileirado: false, motivo: decisao.motivo };
    }

    const payload = {
      // `...dados` primeiro: os campos derivados abaixo (nome da unidade,
      // versão do consentimento) precisam vencer os valores crus do chamador.
      ...dados,
      clienteId: Number(cliente.id),
      clienteNome: cliente.nome,
      transacaoId,
      unidadeId: dados.unidadeId ?? null,
      unidadeNome: dados.unidadeNome ?? (await nomeDaUnidade(dados.unidadeId, conexao)),
      consentimentoVersao: decisao.consentimento?.versao ?? null,
      canal: CANAIS.WHATSAPP,
      geradoEm: new Date().toISOString(),
    };

    const { insertId } = await repositorio.inserir(
      {
        clienteId: cliente.id,
        transacaoId,
        tipo,
        canal: CANAIS.WHATSAPP,
        destino: cliente.telefone,
        payload,
      },
      conexao,
    );

    return { enfileirado: true, notificacaoId: Number(insertId) };
  } catch (erro) {
    // Reenvio da mesma NFC-e / retry do estorno: o índice único protegeu a fila.
    if (erro?.code === 'ER_DUP_ENTRY') {
      return { enfileirado: false, motivo: 'JA_ENFILEIRADO' };
    }

    logger.error(
      { err: erro, clienteId: cliente?.id, transacaoId, tipo },
      'Falha ao enfileirar notificação (o movimento de pontos segue normalmente)',
    );
    return { enfileirado: false, motivo: 'ERRO_AO_ENFILEIRAR' };
  }
}

/** Aviso de crédito de pontos — chamado dentro da transação do crédito. */
export function enfileirarCredito(dados, conexao, config) {
  return enfileirar(
    {
      cliente: dados.cliente,
      transacaoId: dados.transacaoId,
      tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
      dados: {
        pontos: dados.pontos,
        saldoApos: dados.saldoApos,
        valorCompra: dados.valorCompra ?? null,
        documentoFiscal: dados.documentoFiscal ?? null,
        unidadeId: dados.unidadeId ?? null,
        unidadeNome: dados.unidadeNome ?? null,
      },
    },
    conexao,
    config,
  );
}

/** Aviso de estorno — evita deixar o cliente com um saldo prometido e não cumprido. */
export function enfileirarEstorno(dados, conexao, config) {
  return enfileirar(
    {
      cliente: dados.cliente,
      transacaoId: dados.transacaoId,
      tipo: TIPOS_NOTIFICACAO.PONTOS_ESTORNADOS,
      dados: {
        pontos: dados.pontos,
        saldoApos: dados.saldoApos,
        estornoDeTransacaoId: dados.estornoDeTransacaoId ?? null,
        unidadeId: dados.unidadeId ?? null,
        unidadeNome: dados.unidadeNome ?? null,
      },
    },
    conexao,
    config,
  );
}

/**
 * Envia um item já reivindicado (a reivindicação/lease é feita pelo chamador).
 * Separado para poder ser testado sem banco passando um provedor falso.
 */
async function enviarItem(item, { provedor, config, agora }) {
  const mensagem = montarMensagem({
    tipo: item.tipo,
    dados: item.payload,
    template: templatePara(item.tipo, config),
  });

  const tentativas = item.tentativas + 1;

  try {
    const resposta = await provedor.enviar({
      id: item.id,
      destino: item.destino,
      mensagem,
      tipo: item.tipo,
    });

    await repositorio.marcarEnviada(item.id);

    return {
      id: item.id,
      status: STATUS_NOTIFICACAO.ENVIADA,
      tipo: item.tipo,
      tentativas,
      provedor: provedor.nome,
      destino: mascararTelefone(item.destino),
      resposta: resposta?.resposta ?? null,
    };
  } catch (erro) {
    const classificacao = classificarFalha(erro);
    const textoErro = higienizarErro(erro, { segredos: [config.apiKey] });
    const podeRetentar = classificacao.retentavel && tentativas < config.maxTentativas;

    if (podeRetentar) {
      const proximaTentativaEm = calcularProximaTentativa(tentativas, agora, {
        baseSegundos: config.backoffBaseSegundos,
        tetoSegundos: config.backoffTetoSegundos,
      });

      await repositorio.marcarFalha({ id: item.id, proximaTentativaEm, erro: textoErro });

      return {
        id: item.id,
        status: STATUS_NOTIFICACAO.FALHA,
        tipo: item.tipo,
        tentativas,
        destino: mascararTelefone(item.destino),
        motivo: classificacao.motivo,
        statusHttp: classificacao.status,
        erro: textoErro,
        proximaTentativaEm: proximaTentativaEm.toISOString(),
      };
    }

    await repositorio.marcarCancelada({ id: item.id, erro: textoErro });

    return {
      id: item.id,
      status: STATUS_NOTIFICACAO.CANCELADA,
      tipo: item.tipo,
      tentativas,
      destino: mascararTelefone(item.destino),
      motivo: classificacao.retentavel ? 'TENTATIVAS_ESGOTADAS' : classificacao.motivo,
      statusHttp: classificacao.status,
      erro: textoErro,
    };
  }
}

/**
 * Drena a fila: pega os itens vencidos, envia e reagenda os que falharam.
 *
 * O envio acontece FORA de qualquer transação (a reivindicação é um UPDATE
 * atômico). Se o processo morrer no meio de um envio, o item fica com o lease
 * vencendo depois e é retentado — no pior caso o cliente recebe o aviso duas
 * vezes, que é melhor do que nunca receber.
 *
 * @param {{ limite?: number, provedor?: { nome: string, enviar: Function },
 *           simular?: boolean, agora?: Date, config?: object }} [opcoes]
 */
export async function processarFila({
  limite,
  provedor,
  simular = false,
  agora = new Date(),
  config = configuracaoDeEnvio(),
} = {}) {
  const candidatos = await repositorio.listarFila({
    limite: limite ?? config.lote,
    maxTentativas: config.maxTentativas,
  });

  const envio = provedor ?? criarProvedor(config);
  const resultados = [];

  for (const linha of candidatos) {
    const item = repositorio.mapearNotificacao(linha);

    if (simular) {
      resultados.push({
        id: item.id,
        status: STATUS_SIMULADO,
        tipo: item.tipo,
        tentativas: item.tentativas,
        destino: mascararTelefone(item.destino),
        previstoEm: item.proximaTentativaEm,
      });
      continue;
    }

    // Reivindica: incrementa tentativas e empurra o lease. Se outro worker
    // chegou primeiro, `affectedRows` é 0 e este item é pulado.
    const reivindicacao = await repositorio.reivindicar(item.id, {
      leaseSegundos: config.leaseSegundos,
    });

    if (reivindicacao.affectedRows !== 1) {
      resultados.push({ id: item.id, status: 'IGNORADO', motivo: 'REIVINDICADO_POR_OUTRO_WORKER' });
      continue;
    }

    resultados.push(await enviarItem(item, { provedor: envio, config, agora }));
  }

  const resumo = resumirProcessamento(resultados);

  return {
    provedor: envio.nome,
    simulado: simular,
    geradoEm: agora.toISOString(),
    resumo,
    resultados,
  };
}

/** Situação da fila para relatório/monitoração (nada é alterado). */
export async function situacaoDaFila({ config = configuracaoDeEnvio() } = {}) {
  const [contagem, pendentes] = await Promise.all([
    repositorio.contarNaFila({ maxTentativas: config.maxTentativas }),
    repositorio.contarPendentes({ maxTentativas: config.maxTentativas }),
  ]);

  return {
    habilitado: config.habilitado,
    provedor: config.provedor,
    maxTentativas: config.maxTentativas,
    total: Number(contagem?.total ?? 0),
    pendentes: Number(contagem?.pendentes ?? 0),
    aguardandoNovaTentativa: Number(contagem?.aguardando ?? 0),
    enviadas: Number(contagem?.enviadas ?? 0),
    canceladas: Number(contagem?.canceladas ?? 0),
    recuperaveis: Number(pendentes?.pendentes ?? 0),
  };
}
