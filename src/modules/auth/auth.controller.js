/**
 * Controller de autenticação.
 * Responsabilidade única: traduzir HTTP <-> service. Sem regra de negócio.
 */
import * as authService from './auth.service.js';

/** POST /auth/login */
export async function login(request, reply) {
  const sessao = await authService.login({
    identificador: request.body.identificador,
    senha: request.body.senha,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  });

  return reply.status(200).send({ data: sessao });
}

/** POST /auth/refresh */
export async function refresh(request, reply) {
  const sessao = await authService.renovarSessao({
    refreshToken: request.body.refreshToken,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  });

  return reply.status(200).send({ data: sessao });
}

/** POST /auth/logout */
export async function logout(request, reply) {
  const resultado = await authService.logout({
    usuarioId: request.auth.usuarioId,
    refreshToken: request.body.refreshToken,
    todasSessoes: request.body.todasSessoes,
  });

  return reply.status(200).send({ data: resultado });
}

/** GET /auth/me */
export async function me(request, reply) {
  const usuario = await authService.obterPerfil(request.auth.usuarioId);
  return reply.status(200).send({ data: usuario });
}
