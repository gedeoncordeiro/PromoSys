/**
 * Regras de negócio de recompensas e resgates.
 *
 * O resgate é a operação mais crítica do programa: envolve saldo do cliente,
 * estoque do prêmio e atualização do razão de pontos. Tudo dentro de UMA
 * transação, com as duas linhas (recompensa e cliente) bloqueadas via FOR UPDATE
 * numa ORDEM FIXA (recompensa -> cliente) para evitar deadlock entre caixas.
 */
import { db } from '../../core/database/pool.js';
import * as repositorio from './recompensas.repository.js';
import * as clientesRepositorio from '../clientes/clientes.repository.js';
import * as pontosRepositorio from '../pontos/pontos.repository.js';
import { consumirLotesFifo } from '../pontos/pontos.service.js';
import { registrarAuditoria } from '../../core/audit.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../core/errors/app-error.js';
import { ORIGENS_PONTOS, STATUS_RESGATE, TIPOS_TRANSACAO } from '../../config/constants.js';
import { normalizarPaginacao, metaPaginacao } from '../../utils/pagination.js';
import { gerarCodigoResgate } from '../../utils/token.js';

// --- Catálogo ---------------------------------------------------------------

export async function criar(dados, contexto = {}) {
  const { insertId } = await repositorio.inserir(dados);
  const recompensa = await repositorio.buscarPorId(insertId);

  await registrarAuditoria({
    ...contexto,
    acao: 'RECOMPENSA_CRIADA',
    entidade: 'recompensas',
    entidadeId: insertId,
    dadosNovos: repositorio.mapearRecompensa(recompensa),
  });

  return repositorio.mapearRecompensa(recompensa);
}

export async function atualizar(recompensaId, dados, contexto = {}) {
  const anterior = await repositorio.buscarPorId(recompensaId);
  if (!anterior) throw new NotFoundError('Recompensa não encontrada.', { recompensaId });

  await repositorio.atualizar(recompensaId, dados);
  const atualizada = await repositorio.buscarPorId(recompensaId);

  await registrarAuditoria({
    ...contexto,
    acao: 'RECOMPENSA_ATUALIZADA',
    entidade: 'recompensas',
    entidadeId: recompensaId,
    dadosAnteriores: repositorio.mapearRecompensa(anterior),
    dadosNovos: repositorio.mapearRecompensa(atualizada),
  });

  return repositorio.mapearRecompensa(atualizada);
}

export async function obterPorId(recompensaId) {
  const recompensa = await repositorio.buscarPorId(recompensaId);
  if (!recompensa) throw new NotFoundError('Recompensa não encontrada.', { recompensaId });

  return repositorio.mapearRecompensa(recompensa);
}

export async function listar(filtros) {
  const { limit, offset } = normalizarPaginacao(filtros);
  const { itens, total } = await repositorio.listar({ ...filtros, limit, offset });

  return {
    itens: itens.map(repositorio.mapearRecompensa),
    meta: metaPaginacao({ total, limit, offset }),
  };
}

// --- Resgates ---------------------------------------------------------------

/**
 * Resgata uma recompensa debitando pontos do cliente.
 * @param {{ recompensaId: number, clienteId: number, unidadeId: number }} dados
 */
export async function resgatar(dados, contexto = {}) {
  const { recompensaId, clienteId, unidadeId } = dados;

  return db.withTransaction(async (conexao) => {
    // 1) Bloqueia a recompensa (estoque) — sempre primeiro, para ordenar os locks.
    const recompensa = await repositorio.bloquearPorId(recompensaId, conexao);
    if (!recompensa) throw new NotFoundError('Recompensa não encontrada.', { recompensaId });

    if (!recompensa.ativo) {
      throw new BusinessRuleError('Recompensa indisponível.', { recompensaId });
    }

    const agora = Date.now();
    if (recompensa.vigencia_inicio && new Date(recompensa.vigencia_inicio).getTime() > agora) {
      throw new BusinessRuleError('Recompensa ainda não está vigente.', {
        vigenciaInicio: repositorio.mapearRecompensa(recompensa).vigenciaInicio,
      });
    }
    if (recompensa.vigencia_fim && new Date(recompensa.vigencia_fim).getTime() < agora) {
      throw new BusinessRuleError('Recompensa fora do período de vigência.', {
        vigenciaFim: repositorio.mapearRecompensa(recompensa).vigenciaFim,
      });
    }
    if (recompensa.estoque !== null && Number(recompensa.estoque) <= 0) {
      throw new BusinessRuleError('Recompensa sem estoque disponível.', { recompensaId });
    }

    // 2) Bloqueia o cliente (saldo).
    const cliente = await clientesRepositorio.bloquearPorId(clienteId, conexao);
    if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });
    if (!cliente.ativo) {
      throw new BusinessRuleError('Cliente inativo não pode resgatar recompensas.', { clienteId });
    }

    const custo = Number(recompensa.pontos_custo);
    const saldoAtual = Number(cliente.pontos_saldo);

    if (saldoAtual < custo) {
      throw new BusinessRuleError('Saldo de pontos insuficiente para este resgate.', {
        saldoAtual,
        pontosNecessarios: custo,
      });
    }

    // 3) Limite de resgates por cliente (controle de abuso de campanha).
    if (recompensa.limite_por_cliente !== null) {
      const { total } = await repositorio.contarResgatesDoCliente(
        clienteId,
        recompensaId,
        conexao,
      );

      if (Number(total) >= Number(recompensa.limite_por_cliente)) {
        throw new BusinessRuleError(
          'Limite de resgates por cliente atingido para esta recompensa.',
          { limite: Number(recompensa.limite_por_cliente), resgatesRealizados: Number(total) },
        );
      }
    }

    // 4) Consome os lotes que vencem primeiro (mesma rotina do estorno).
    await consumirLotesFifo(clienteId, custo, conexao);

    const saldoApos = saldoAtual - custo;
    const codigo = gerarCodigoResgate();

    // 5) Razão de pontos: um débito por resgate.
    const { insertId: transacaoId } = await pontosRepositorio.inserirTransacao(
      {
        clienteId,
        unidadeId,
        usuarioId: contexto.usuarioId ?? null,
        tipo: TIPOS_TRANSACAO.DEBITO,
        origem: ORIGENS_PONTOS.RESGATE,
        pontos: custo,
        descricao: `Resgate ${recompensa.nome} (${codigo})`,
        saldoApos,
      },
      conexao,
    );

    // 6) Registra o resgate (comprovante com código para retirada no balcão).
    const { insertId: resgateId } = await repositorio.inserirResgate(
      {
        codigo,
        clienteId,
        recompensaId,
        unidadeId,
        usuarioId: contexto.usuarioId ?? null,
        transacaoId,
        pontosDebitados: custo,
        saldoApos,
        status: STATUS_RESGATE.PENDENTE,
      },
      conexao,
    );

    // 7) Estoque: update condicional — se zerou na concorrência, aborta tudo.
    if (recompensa.estoque !== null) {
      const { affectedRows } = await repositorio.baixarEstoque(recompensaId, 1, conexao);
      if (affectedRows !== 1) {
        throw new ConflictError('Estoque esgotado durante o resgate. Tente novamente.');
      }
    }

    // 8) Cache de saldo do cliente (mesma transação = mesma verdade).
    await clientesRepositorio.ajustarSaldoEAtualizarNivel(clienteId, -custo, conexao);

    await registrarAuditoria(
      {
        ...contexto,
        acao: 'RESGATE_REALIZADO',
        entidade: 'resgates',
        entidadeId: resgateId,
        dadosNovos: { codigo, clienteId, recompensaId, pontosDebitados: custo, saldoApos },
      },
      conexao,
    );

    return {
      resgateId: Number(resgateId),
      codigo,
      clienteId,
      recompensaId,
      pontosDebitados: custo,
      saldoApos,
      transacaoId: Number(transacaoId),
      status: STATUS_RESGATE.PENDENTE,
    };
  });
}

/** Confirma a retirada do prêmio no balcão (idempotente). */
export async function confirmarRetirada(resgateId, contexto = {}) {
  const resgate = await repositorio.buscarResgatePorId(resgateId);
  if (!resgate) throw new NotFoundError('Resgate não encontrado.', { resgateId });

  const { affectedRows } = await repositorio.confirmarRetirada(resgateId);

  if (affectedRows === 1) {
    await registrarAuditoria({
      ...contexto,
      acao: 'RESGATE_ENTREGUE',
      entidade: 'resgates',
      entidadeId: resgateId,
      dadosAnteriores: { status: resgate.status },
      dadosNovos: { status: STATUS_RESGATE.ENTREGUE },
    });
  }

  const atualizado = await repositorio.buscarResgatePorId(resgateId);
  return { ...repositorio.mapearResgate(atualizado), jaConfirmado: affectedRows === 0 };
}

export async function listarResgates(filtros) {
  const { limit, offset } = normalizarPaginacao(filtros);
  const { itens, total } = await repositorio.listarResgates({ ...filtros, limit, offset });

  return {
    itens: itens.map(repositorio.mapearResgate),
    meta: metaPaginacao({ total, limit, offset }),
  };
}
