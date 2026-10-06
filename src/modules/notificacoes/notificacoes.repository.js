/**
 * Repositório da outbox de notificações — SQL explícito e parametrizado.
 *
 * A fila é lida por `idx_outbox_fila (status, proxima_tentativa_em, id)`, ou
 * seja: o worker nunca varre a tabela inteira, só a fatia "já pode tentar".
 */
import { db } from '../../core/database/pool.js';
import { limitOffsetSql } from '../../utils/sql.js';
import { STATUS_NOTIFICACAO, STATUS_NA_FILA } from './notificacoes.regras.js';

const COLUNAS = `
  id, cliente_id, transacao_id, tipo, canal, destino, payload, status,
  tentativas, proxima_tentativa_em, ultimo_erro, enviada_em, criado_em, atualizado_em
`;

/** Normaliza a linha do driver (DECIMAL/BIGINT chegam como string, JSON como texto). */
export function mapearNotificacao(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    clienteId: Number(linha.cliente_id),
    transacaoId: linha.transacao_id === null ? null : Number(linha.transacao_id),
    tipo: linha.tipo,
    canal: linha.canal,
    destino: linha.destino,
    payload:
      typeof linha.payload === 'string'
        ? JSON.parse(linha.payload || '{}')
        : (linha.payload ?? {}),
    status: linha.status,
    tentativas: Number(linha.tentativas),
    proximaTentativaEm: linha.proxima_tentativa_em,
    ultimoErro: linha.ultimo_erro ?? null,
    enviadaEm: linha.enviada_em ?? null,
    criadoEm: linha.criado_em ?? null,
  };
}

export function inserir(
  { clienteId, transacaoId, tipo, canal, destino, payload },
  executor,
) {
  return db.execute(
    `INSERT INTO notificacoes_outbox
       (cliente_id, transacao_id, tipo, canal, destino, payload)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [clienteId, transacaoId, tipo, canal, destino, JSON.stringify(payload)],
    executor,
  );
}

export function buscarPorId(id, executor) {
  return db.queryOne(`SELECT ${COLUNAS} FROM notificacoes_outbox WHERE id = ?`, [id], executor);
}

/** Usado para saber se o aviso daquele movimento já foi enfileirado. */
export function buscarPorTransacao({ transacaoId, tipo, canal }, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS}
       FROM notificacoes_outbox
      WHERE transacao_id = ? AND tipo = ? AND canal = ?`,
    [transacaoId, tipo, canal],
    executor,
  );
}

/**
 * Itens prontos para tentar: na fila, com `proxima_tentativa_em` vencida e ainda
 * dentro do limite de tentativas.
 */
export function listarFila({ limite, maxTentativas }, executor) {
  return db.query(
    `SELECT ${COLUNAS}
       FROM notificacoes_outbox
      WHERE status IN (?, ?)
        AND tentativas < ?
        AND proxima_tentativa_em <= NOW()
      ORDER BY proxima_tentativa_em, id
      ${limitOffsetSql(limite, 0)}`,
    [STATUS_NA_FILA[0], STATUS_NA_FILA[1], maxTentativas],
    executor,
  );
}

/**
 * Reivindica um item (lease) de forma atômica.
 *
 * É um único UPDATE condicional: incrementa `tentativas` e empurra
 * `proxima_tentativa_em` para frente. Serve a dois propósitos ao mesmo tempo —
 * conta a tentativa e garante que outra execução (ou outro processo do job) não
 * pegue a mesma linha. Se `affectedRows === 0`, outro worker chegou primeiro.
 */
export function reivindicar(id, { leaseSegundos }, executor) {
  return db.execute(
    `UPDATE notificacoes_outbox
        SET tentativas = tentativas + 1,
            proxima_tentativa_em = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE id = ?
        AND status IN (?, ?)`,
    [leaseSegundos, id, STATUS_NA_FILA[0], STATUS_NA_FILA[1]],
    executor,
  );
}

export function marcarEnviada(id, executor) {
  return db.execute(
    `UPDATE notificacoes_outbox
        SET status = ?,
            enviada_em = NOW(),
            ultimo_erro = NULL
      WHERE id = ?`,
    [STATUS_NOTIFICACAO.ENVIADA, id],
    executor,
  );
}

/** Falha passageira: fica em `FALHA` aguardando a próxima tentativa. */
export function marcarFalha(
  { id, proximaTentativaEm, erro },
  executor,
) {
  return db.execute(
    `UPDATE notificacoes_outbox
        SET status = ?,
            proxima_tentativa_em = ?,
            ultimo_erro = ?
      WHERE id = ?`,
    [STATUS_NOTIFICACAO.FALHA, proximaTentativaEm, erro, id],
    executor,
  );
}

/** Desistiu: erro definitivo (4xx) ou tentativas esgotadas. */
export function marcarCancelada({ id, erro }, executor) {
  return db.execute(
    `UPDATE notificacoes_outbox
        SET status = ?,
            ultimo_erro = ?
      WHERE id = ?`,
    [STATUS_NOTIFICACAO.CANCELADA, erro, id],
    executor,
  );
}

/** Quantos itens ainda dependem de trabalho (para o código de saída do job). */
export function contarNaFila({ maxTentativas }, executor) {
  return db.queryOne(
    `SELECT
        SUM(status = ?)                                   AS pendentes,
        SUM(status = ?)                                   AS aguardando,
        SUM(status = ? AND tentativas < ?)                AS recuperaveis,
        SUM(status = ?)                                   AS enviadas,
        SUM(status = ?)                                   AS canceladas,
        COUNT(*)                                          AS total
       FROM notificacoes_outbox`,
    [
      STATUS_NOTIFICACAO.PENDENTE,
      STATUS_NOTIFICACAO.FALHA,
      STATUS_NOTIFICACAO.PENDENTE,
      maxTentativas,
      STATUS_NOTIFICACAO.ENVIADA,
      STATUS_NOTIFICACAO.CANCELADA,
    ],
    executor,
  );
}

/**
 * Itens que ainda podem ser entregues (pendentes/falha dentro do limite).
 * É o número que decide o código de saída do job.
 */
export function contarPendentes({ maxTentativas }, executor) {
  return db.queryOne(
    `SELECT COUNT(*) AS pendentes
       FROM notificacoes_outbox
      WHERE status IN (?, ?) AND tentativas < ?`,
    [STATUS_NA_FILA[0], STATUS_NA_FILA[1], maxTentativas],
    executor,
  );
}
