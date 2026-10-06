/**
 * Motor de pontuação — todas as operações que mexem em saldo são transacionais
 * e serializadas pelo lock da linha do cliente (`SELECT ... FOR UPDATE`).
 *
 * Invariantes mantidas em toda operação:
 *   1. clientes.pontos_saldo === SUM(lotes_pontos.pontos_disponiveis)
 *   2. pontos_saldo nunca fica negativo (garantido por CHECK no MySQL + validação aqui)
 *   3. todo movimento gera uma linha em transacoes_pontos (livro razão imutável)
 *   4. todo movimento gera entrada em audit_log
 */
import { db } from '../../core/database/pool.js';
import * as repositorio from './pontos.repository.js';
import * as clientesRepositorio from '../clientes/clientes.repository.js';
import * as notificacoes from '../notificacoes/notificacoes.service.js';
import { registrarAuditoria } from '../../core/audit.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/app-error.js';
import { AVISO_EXPIRACAO_DIAS, ORIGENS_PONTOS, TIPOS_TRANSACAO } from '../../config/constants.js';
import { normalizarPaginacao, metaPaginacao } from '../../utils/pagination.js';
import { paraDataIso } from '../../utils/date.js';

/** Validade padrão de pontos de ajuste manual quando não há regra vigente. */
const VALIDADE_PADRAO_DIAS = 365;

/**
 * Consome lotes na ordem de vencimento (FIFO).
 * Exportada para reuso pelo módulo de recompensas (resgate debita pontos).
 * @returns {Promise<Array<{ loteId: number, pontos: number, expiraEm: Date }>>
 */
export async function consumirLotesFifo(clienteId, pontos, conexao) {
  const lotes = await repositorio.listarLotesDisponiveis(clienteId, conexao);

  let restante = pontos;
  const consumos = [];

  for (const lote of lotes) {
    if (restante <= 0) break;

    const usar = Math.min(Number(lote.pontos_disponiveis), restante);
    const { affectedRows } = await repositorio.debitarLote(lote.id, usar, conexao);

    if (affectedRows !== 1) {
      // Outra transação consumiu o lote entre o SELECT e o UPDATE.
      throw new ConflictError('Conflito ao consumir pontos. Tente novamente.');
    }

    consumos.push({ loteId: Number(lote.id), pontos: usar, expiraEm: lote.expira_em });
    restante -= usar;
  }

  if (restante > 0) {
    throw new BusinessRuleError('Saldo de pontos insuficiente.', { pontosFaltantes: restante });
  }

  return consumos;
}

/**
 * Credita pontos: cria a transação (razão), o lote (validade) e atualiza o saldo.
 * Sempre chamado DENTRO de uma transação, com a linha do cliente já bloqueada.
 */
async function creditar(
  {
    cliente,
    conexao,
    pontos,
    origem,
    tipo = TIPOS_TRANSACAO.CREDITO,
    valorCompra = null,
    documentoFiscal = null,
    descricao = null,
    validadeDias,
    unidadeId = null,
    usuarioId = null,
  },
) {
  const saldoApos = Number(cliente.pontos_saldo) + pontos;

  const { insertId: transacaoId } = await repositorio.inserirTransacao(
    {
      clienteId: cliente.id,
      unidadeId,
      usuarioId,
      tipo,
      origem,
      pontos,
      valorCompra,
      documentoFiscal,
      descricao,
      saldoApos,
    },
    conexao,
  );

  const { expira_em: expiraEm } = await repositorio.calcularExpiracaoLote(validadeDias, conexao);

  await repositorio.inserirLote(
    { clienteId: cliente.id, transacaoId, pontos, expiraEm },
    conexao,
  );

  await clientesRepositorio.ajustarSaldoEAtualizarNivel(cliente.id, pontos, conexao);

  return { transacaoId: Number(transacaoId), saldoApos, expiraEm };
}

/**
 * Registra uma compra e credita pontos.
 *
 * Idempotência: quando o PDV envia o documento fiscal (NFC-e/SAT), repetir a
 * requisição não duplica pontos — o índice único
 * `uk_transacoes_documento (unidade_id, documento_fiscal, origem)` + a checagem
 * prévia garantem isso.
 *
 * @param {{ clienteId: number, unidadeId: number, valor: number,
 *           documentoFiscal?: string, descricao?: string }} dados
 */
export async function registrarCompra(dados, contexto = {}) {
  const { clienteId, unidadeId, valor, documentoFiscal = null, descricao = null } = dados;

  return db.withTransaction(async (conexao) => {
    const cliente = await clientesRepositorio.bloquearPorId(clienteId, conexao);
    if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });
    if (!cliente.ativo) {
      throw new BusinessRuleError('Cliente inativo não acumula pontos.', { clienteId });
    }

    if (documentoFiscal) {
      const existente = await repositorio.buscarTransacaoPorDocumento(
        { unidadeId, documentoFiscal, origem: ORIGENS_PONTOS.COMPRA },
        conexao,
      );

      if (existente) {
        return {
          jaProcessado: true,
          transacaoId: Number(existente.id),
          pontos: Number(existente.pontos),
          saldoApos: Number(existente.saldo_apos),
        };
      }
    }

    const regra = await repositorio.buscarRegraVigente(unidadeId, conexao);
    if (!regra) {
      throw new BusinessRuleError('Nenhuma regra de pontuação vigente para esta unidade.', {
        unidadeId,
      });
    }

    const valorMinimo = Number(regra.valor_minimo_compra);
    if (valor < valorMinimo) {
      throw new BusinessRuleError(
        `Compra mínima para pontuar é R$ ${valorMinimo.toFixed(2)}.`,
        { valorInformado: valor, valorMinimo },
      );
    }

    const pontos = await repositorio.calcularPontos(
      valor,
      regra.pontos_por_real,
      conexao,
    );

    if (pontos <= 0) {
      throw new BusinessRuleError('O valor da compra não gera pontos.', { valor });
    }

    const { transacaoId, saldoApos, expiraEm } = await creditar({
      cliente,
      conexao,
      pontos,
      origem: ORIGENS_PONTOS.COMPRA,
      valorCompra: valor,
      documentoFiscal,
      descricao: descricao ?? `Compra de R$ ${Number(valor).toFixed(2)}`,
      validadeDias: Number(regra.validade_pontos_dias),
      unidadeId,
      usuarioId: contexto.usuarioId ?? null,
    });

    await clientesRepositorio.registrarVisita(cliente.id, conexao);

    await registrarAuditoria(
      {
        ...contexto,
        acao: 'PONTOS_CREDITADOS',
        entidade: 'transacoes_pontos',
        entidadeId: transacaoId,
        dadosNovos: { clienteId, pontos, valor, documentoFiscal, saldoApos },
      },
      conexao,
    );

    // Outbox: grava a INTENÇÃO do aviso na mesma transação do crédito (padrão
    // transactional outbox). O envio fica para o job — aqui não há chamada de rede
    // e, se o provedor cair, o aviso não se perde.
    const notificacao = await notificacoes.enfileirarCredito(
      {
        cliente,
        transacaoId,
        pontos,
        saldoApos,
        valorCompra: valor,
        documentoFiscal,
        unidadeId,
      },
      conexao,
    );

    return {
      jaProcessado: false,
      transacaoId,
      pontos,
      saldoApos,
      expiraEm: paraDataIso(expiraEm),
      regra: repositorio.mapearRegra(regra),
      notificacao,
    };
  });
}

/**
 * Estorna um crédito (devolução de compra / erro de lançamento).
 * O estorno consome os lotes FIFO e é bloqueado pelo índice único
 * `uk_transacoes_estorno`, impedindo estorno duplicado.
 */
export async function estornar({ transacaoId, motivo = null }, contexto = {}) {
  return db.withTransaction(async (conexao) => {
    const original = await repositorio.buscarTransacaoPorId(transacaoId, conexao);
    if (!original) throw new NotFoundError('Transação não encontrada.', { transacaoId });

    if (original.tipo !== TIPOS_TRANSACAO.CREDITO) {
      throw new BusinessRuleError('Somente transações de crédito podem ser estornadas.', {
        tipo: original.tipo,
      });
    }

    const cliente = await clientesRepositorio.bloquearPorId(original.cliente_id, conexao);
    if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId: original.cliente_id });

    const estornoExistente = await repositorio.buscarEstornoDe(transacaoId, conexao);
    if (estornoExistente) {
      throw new ConflictError('Esta transação já foi estornada.', {
        estornoId: Number(estornoExistente.id),
      });
    }

    const pontos = Number(original.pontos);

    if (Number(cliente.pontos_saldo) < pontos) {
      throw new BusinessRuleError(
        'Saldo insuficiente para estorno: os pontos desta compra já foram resgatados ou expiraram.',
        { saldoAtual: Number(cliente.pontos_saldo), pontosNecessarios: pontos },
      );
    }

    await consumirLotesFifo(cliente.id, pontos, conexao);

    const saldoApos = Number(cliente.pontos_saldo) - pontos;

    const { insertId } = await repositorio.inserirTransacao(
      {
        clienteId: cliente.id,
        unidadeId: original.unidade_id,
        usuarioId: contexto.usuarioId ?? null,
        tipo: TIPOS_TRANSACAO.ESTORNO,
        origem: ORIGENS_PONTOS.ESTORNO,
        pontos,
        valorCompra: original.valor_compra !== null ? Number(original.valor_compra) : null,
        documentoFiscal: null,
        descricao: motivo ?? `Estorno da transação #${transacaoId}`,
        saldoApos,
        estornoDeTransacaoId: transacaoId,
      },
      conexao,
    );

    await clientesRepositorio.ajustarSaldoEAtualizarNivel(cliente.id, -pontos, conexao);

    await registrarAuditoria(
      {
        ...contexto,
        acao: 'PONTOS_ESTORNADOS',
        entidade: 'transacoes_pontos',
        entidadeId: insertId,
        dadosAnteriores: { transacaoEstornada: transacaoId, pontos },
        dadosNovos: { saldoApos, motivo },
      },
      conexao,
    );

    // Avisar o crédito e ficar calado no estorno deixaria o cliente com o saldo
    // prometido na mão — o aviso de estorno entra na mesma outbox.
    const notificacao = await notificacoes.enfileirarEstorno(
      {
        cliente,
        transacaoId: Number(insertId),
        estornoDeTransacaoId: Number(transacaoId),
        pontos,
        saldoApos,
        unidadeId: original.unidade_id,
      },
      conexao,
    );

    return {
      transacaoId: Number(insertId),
      estornoDeTransacaoId: Number(transacaoId),
      pontos,
      saldoApos,
      notificacao,
    };
  });
}

/**
 * Ajuste manual de saldo (ADMIN/GERENTE) — ex.: cortesia, correção de erro,
 * bonificação de campanha. Sempre auditado.
 */
export async function ajustarSaldo(dados, contexto = {}) {
  const { clienteId, pontos, motivo, unidadeId = null } = dados;

  if (pontos === 0) {
    throw new ValidationError('Informe uma quantidade de pontos diferente de zero.', {
      campo: 'pontos',
    });
  }

  return db.withTransaction(async (conexao) => {
    const cliente = await clientesRepositorio.bloquearPorId(clienteId, conexao);
    if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });

    const unidade =
      unidadeId ?? (cliente.unidade_cadastro_id !== null ? Number(cliente.unidade_cadastro_id) : null);

    if (pontos > 0) {
      const regra = await repositorio.buscarRegraVigente(unidade, conexao);
      const validadeDias = regra ? Number(regra.validade_pontos_dias) : VALIDADE_PADRAO_DIAS;

      const { transacaoId, saldoApos, expiraEm } = await creditar({
        cliente,
        conexao,
        pontos,
        origem: ORIGENS_PONTOS.AJUSTE_MANUAL,
        tipo: TIPOS_TRANSACAO.AJUSTE,
        descricao: motivo,
        validadeDias,
        unidadeId: unidade,
        usuarioId: contexto.usuarioId ?? null,
      });

      await registrarAuditoria(
        {
          ...contexto,
          acao: 'PONTOS_AJUSTE_CREDITO',
          entidade: 'transacoes_pontos',
          entidadeId: transacaoId,
          dadosNovos: { clienteId, pontos, motivo, saldoApos },
        },
        conexao,
      );

      // Cortesia/bonificação também é crédito: o cliente recebe o mesmo aviso.
      const notificacao = await notificacoes.enfileirarCredito(
        { cliente, transacaoId, pontos, saldoApos, unidadeId: unidade },
        conexao,
      );

      return {
        transacaoId,
        pontos,
        saldoApos,
        expiraEm: paraDataIso(expiraEm),
        tipo: TIPOS_TRANSACAO.AJUSTE,
        notificacao,
      };
    }

    const pontosAbsolutos = Math.abs(pontos);

    if (Number(cliente.pontos_saldo) < pontosAbsolutos) {
      throw new BusinessRuleError('Saldo insuficiente para este ajuste negativo.', {
        saldoAtual: Number(cliente.pontos_saldo),
        pontosSolicitados: pontosAbsolutos,
      });
    }

    const consumos = await consumirLotesFifo(cliente.id, pontosAbsolutos, conexao);
    const saldoApos = Number(cliente.pontos_saldo) - pontosAbsolutos;

    const { insertId } = await repositorio.inserirTransacao(
      {
        clienteId: cliente.id,
        unidadeId: unidade,
        usuarioId: contexto.usuarioId ?? null,
        tipo: TIPOS_TRANSACAO.AJUSTE,
        origem: ORIGENS_PONTOS.AJUSTE_MANUAL,
        pontos: pontosAbsolutos,
        descricao: motivo,
        saldoApos,
      },
      conexao,
    );

    await clientesRepositorio.ajustarSaldoEAtualizarNivel(cliente.id, -pontosAbsolutos, conexao);

    await registrarAuditoria(
      {
        ...contexto,
        acao: 'PONTOS_AJUSTE_DEBITO',
        entidade: 'transacoes_pontos',
        entidadeId: insertId,
        dadosNovos: { clienteId, pontos: -pontosAbsolutos, motivo, saldoApos, consumos },
      },
      conexao,
    );

    return {
      transacaoId: Number(insertId),
      pontos: -pontosAbsolutos,
      saldoApos,
      tipo: TIPOS_TRANSACAO.AJUSTE,
    };
  });
}

/** Saldo consolidado + aviso de expiração (usado no balcão e no app do cliente). */
export async function obterSaldo(clienteId) {
  const cliente = await clientesRepositorio.buscarPorId(clienteId);
  if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });

  const aVencer = await repositorio.somarLotesAVencer(clienteId, AVISO_EXPIRACAO_DIAS);

  return {
    clienteId: Number(cliente.id),
    nome: cliente.nome,
    pontosSaldo: Number(cliente.pontos_saldo),
    nivel: cliente.nivel,
    pontosAVencer: Number(aVencer?.total ?? 0),
    proximaExpiracao: paraDataIso(aVencer?.proxima_expiracao),
    avisoExpiracaoDias: AVISO_EXPIRACAO_DIAS,
  };
}

/** Extrato paginado (mais recente primeiro). */
export async function listarExtrato(clienteId, filtros = {}) {
  const { limit, offset } = normalizarPaginacao(filtros);

  const cliente = await clientesRepositorio.buscarPorId(clienteId);
  if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });

  const { itens, total } = await repositorio.listarExtrato({
    clienteId,
    tipo: filtros.tipo,
    origem: filtros.origem,
    de: filtros.de,
    ate: filtros.ate,
    limit,
    offset,
  });

  return {
    saldoAtual: Number(cliente.pontos_saldo),
    itens: itens.map(repositorio.mapearTransacao),
    meta: metaPaginacao({ total, limit, offset }),
  };
}
