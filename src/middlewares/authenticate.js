/**
 * Middleware (preHandler) de autenticação via JWT.
 *
 * Uso na rota:
 *   { preHandler: [app.authenticate] }
 *
 * Depois deste hook, `request.auth` está preenchido:
 *   { usuarioId, perfil, unidadeId, jti }
 *
 * Decisão de performance: a verificação é 100% local (assinatura + exp + iss/aud),
 * sem consulta ao banco a cada request — essencial no volume de um PDV.
 * A revogação imediata é feita no refresh token (tabela `refresh_tokens`).
 */
import { UnauthorizedError, ForbiddenError } from '../core/errors/app-error.js';

export async function authenticate(request) {
  // Lança erro do fast-jwt (FST_JWT/FAST_JWT) que o handler global traduz em 401.
  await request.jwtVerify();

  const payload = request.user ?? {};

  if (payload.typ !== 'access') {
    throw new UnauthorizedError('Tipo de token inválido para acessar este recurso.');
  }

  const usuarioId = Number(payload.sub);
  if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
    throw new UnauthorizedError('Token sem identificação de usuário válida.');
  }

  request.auth = {
    usuarioId,
    perfil: payload.perfil,
    unidadeId: payload.unidadeId ?? null,
    jti: payload.jti ?? null,
  };

  if (!request.auth.perfil) {
    throw new ForbiddenError('Token sem perfil de acesso definido.');
  }
}

export default authenticate;
