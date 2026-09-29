/**
 * Trilha de auditoria (LGPD + antifraude em programa de fidelidade).
 *
 * Toda operação que altera saldo de pontos, cadastro ou resgates deve gerar um
 * registro. A gravação NUNCA derruba a operação principal: falha de auditoria
 * vira log de erro e a transação de negócio segue.
 */
import { db } from './database/pool.js';
import { logger } from './logger.js';

/**
 * @param {object} registro
 * @param {string} registro.acao            ex.: CLIENTE_CRIADO, PONTOS_CREDITADOS
 * @param {string} registro.entidade        ex.: clientes, transacoes_pontos
 * @param {number|string|null} registro.entidadeId
 * @param {number|null} [registro.usuarioId]
 * @param {number|null} [registro.unidadeId]
 * @param {object|null} [registro.dadosAnteriores]
 * @param {object|null} [registro.dadosNovos]
 * @param {string|null} [registro.ip]
 * @param {string|null} [registro.userAgent]
 * @param {import('mysql2/promise').PoolConnection} [executor] conexão da transação
 */
export async function registrarAuditoria(registro, executor) {
  try {
    await db.execute(
      `INSERT INTO audit_log
         (usuario_id, unidade_id, acao, entidade, entidade_id,
          dados_anteriores, dados_novos, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        registro.usuarioId ?? null,
        registro.unidadeId ?? null,
        registro.acao,
        registro.entidade,
        registro.entidadeId !== undefined && registro.entidadeId !== null
          ? String(registro.entidadeId)
          : null,
        registro.dadosAnteriores ? JSON.stringify(registro.dadosAnteriores) : null,
        registro.dadosNovos ? JSON.stringify(registro.dadosNovos) : null,
        registro.ip ?? null,
        registro.userAgent?.slice(0, 255) ?? null,
      ],
      executor,
    );
  } catch (erro) {
    logger.error({ err: erro, acao: registro.acao, entidade: registro.entidade }, 'Falha ao registrar auditoria');
  }
}

/** Monta o contexto de auditoria a partir da request (reuso nos controllers). */
export function contextoDaRequisicao(request) {
  return {
    usuarioId: request.auth?.usuarioId ?? null,
    unidadeId: request.auth?.unidadeId ?? null,
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
  };
}
