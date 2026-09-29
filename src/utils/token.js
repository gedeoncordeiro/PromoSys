/**
 * Tokens de autenticação.
 *
 * ▸ Access token: JWT assinado (HS512), curto (15m) e sem estado no servidor.
 *   `typ: 'access'` no payload impede que um refresh token seja aceito como
 *   access token.
 *
 * ▸ Refresh token: string opaca aleatória de 48 bytes. Só o hash SHA-256 é
 *   persistido — vazamento do banco não permite uso dos tokens. É rotacionado
 *   a cada uso (detecção de reuso invalida a sessão).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';

const UNIDADES_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Converte '15m' | '7d' | '30s' em milissegundos. */
export function duracaoParaMs(valor) {
  const match = /^(\d+)\s*(s|m|h|d|w)$/.exec(String(valor).trim());
  if (!match) throw new Error(`Duração inválida: ${valor}`);
  return Number(match[1]) * UNIDADES_MS[match[2]];
}

/** Assina o access token (JWT) do operador. */
export function assinarAccessToken({ usuarioId, perfil, unidadeId = null }) {
  return jwt.sign({ perfil, unidadeId, typ: 'access' }, env.JWT_SECRET, {
    algorithm: env.JWT_ALGORITHM,
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    subject: String(usuarioId),
    jwtid: randomUUID(),
  });
}

/** Gera refresh token opaco + hash para persistência. */
export function gerarRefreshToken() {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** SHA-256 em hex (64 chars) — casa com a coluna CHAR(64) da tabela. */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Data de expiração do refresh token (UTC), pronta para o MySQL. */
export function expiracaoRefreshToken() {
  return new Date(Date.now() + duracaoParaMs(env.JWT_REFRESH_EXPIRES_IN));
}

/** Código humano-legível para retirada de resgate (ex.: RSG-8F3A2B91). */
export function gerarCodigoResgate(prefixo = 'RSG') {
  const aleatorio = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
  return `${prefixo}-${aleatorio}`;
}
