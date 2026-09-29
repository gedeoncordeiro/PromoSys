/**
 * Repositório de autenticação — SQL explícito, sempre parametrizado.
 *
 * Convenção de executor: todas as funções aceitam um `executor` opcional.
 *  - omitido  -> usa o pool (autocommit)
 *  - conexão  -> participa da transação aberta por `db.withTransaction`
 * Isso permite compor várias operações atômicas sem duplicar SQL.
 */
import { db } from '../../core/database/pool.js';
import { formatarCpf } from '../../utils/cpf.js';
import { paraIsoUtc } from '../../utils/date.js';

const COLUNAS_USUARIO = `
  u.id, u.nome, u.email, u.cpf, u.senha_hash, u.perfil,
  u.unidade_id, u.ativo, u.ultimo_login_em,
  un.nome AS unidade_nome
`;

/** Busca por e-mail OU CPF (index merge em uk_usuarios_email / uk_usuarios_cpf). */
export function buscarParaLogin(identificador, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_USUARIO}
       FROM usuarios u
       LEFT JOIN unidades un ON un.id = u.unidade_id
      WHERE u.email = ? OR u.cpf = ?
      LIMIT 1`,
    [identificador, identificador],
    executor,
  );
}

export function buscarPorId(usuarioId, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_USUARIO}
       FROM usuarios u
       LEFT JOIN unidades un ON un.id = u.unidade_id
      WHERE u.id = ?
      LIMIT 1`,
    [usuarioId],
    executor,
  );
}

export function registrarUltimoLogin(usuarioId, executor) {
  return db.execute(
    'UPDATE usuarios SET ultimo_login_em = UTC_TIMESTAMP(3) WHERE id = ?',
    [usuarioId],
    executor,
  );
}

// --- Refresh tokens (rotação com detecção de reuso) -------------------------

export function inserirRefreshToken(
  { usuarioId, tokenHash, expiraEm, ip, userAgent },
  executor,
) {
  return db.execute(
    `INSERT INTO refresh_tokens (usuario_id, token_hash, expira_em, ip, user_agent)
     VALUES (?, ?, ?, ?, ?)`,
    [usuarioId, tokenHash, expiraEm, ip ?? null, userAgent?.slice(0, 255) ?? null],
    executor,
  );
}

export function buscarRefreshPorHash(tokenHash, executor) {
  return db.queryOne(
    `SELECT rt.id,
            rt.usuario_id,
            rt.expira_em,
            rt.revogado_em,
            u.perfil            AS usuario_perfil,
            u.unidade_id        AS usuario_unidade_id,
            u.ativo             AS usuario_ativo
       FROM refresh_tokens rt
       INNER JOIN usuarios u ON u.id = rt.usuario_id
      WHERE rt.token_hash = ?
      LIMIT 1`,
    [tokenHash],
    executor,
  );
}

/** Revoga o token usado e aponta para o substituto (rotação). */
export function rotacionarRefreshToken({ id, novoHash, ip, userAgent }, executor) {
  return db.execute(
    `UPDATE refresh_tokens
        SET revogado_em = UTC_TIMESTAMP(3),
            substituido_por_hash = ?,
            ip = COALESCE(?, ip),
            user_agent = COALESCE(?, user_agent)
      WHERE id = ? AND revogado_em IS NULL`,
    [novoHash, ip ?? null, userAgent?.slice(0, 255) ?? null, id],
    executor,
  );
}

export function revogarPorHash(tokenHash, executor) {
  return db.execute(
    `UPDATE refresh_tokens
        SET revogado_em = UTC_TIMESTAMP(3)
      WHERE token_hash = ? AND revogado_em IS NULL`,
    [tokenHash],
    executor,
  );
}

/** Usado quando se detecta reuso de refresh token (possível vazamento). */
export function revogarTodosDoUsuario(usuarioId, executor) {
  return db.execute(
    `UPDATE refresh_tokens
        SET revogado_em = UTC_TIMESTAMP(3)
      WHERE usuario_id = ? AND revogado_em IS NULL`,
    [usuarioId],
    executor,
  );
}

/** Higiene: remove tokens expirados há mais de 30 dias. */
export function removerRefreshTokensAntigos(diasRetencao = 30, executor) {
  return db.execute(
    `DELETE FROM refresh_tokens
      WHERE expira_em < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
    [diasRetencao],
    executor,
  );
}

/** Linha do banco -> objeto público (nunca expõe senha_hash). */
export function mapearUsuario(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    nome: linha.nome,
    email: linha.email,
    cpf: linha.cpf ? formatarCpf(linha.cpf) : null,
    perfil: linha.perfil,
    unidadeId: linha.unidade_id !== null ? Number(linha.unidade_id) : null,
    unidadeNome: linha.unidade_nome ?? null,
    ativo: Boolean(linha.ativo),
    ultimoLoginEm: paraIsoUtc(linha.ultimo_login_em),
  };
}
