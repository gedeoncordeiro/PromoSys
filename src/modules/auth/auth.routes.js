/**
 * Rotas de autenticação (/api/v1/auth).
 *
 * Observações de segurança:
 *  - login e refresh têm rate limit agressivo (brute force / credential stuffing)
 *  - somente /auth/me exige token válido
 */
import * as controller from './auth.controller.js';
import {
  loginBodySchema,
  logoutBodySchema,
  refreshBodySchema,
  loginResponseSchema,
  refreshResponseSchema,
  meResponseSchema,
} from './auth.schema.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function authRoutes(app) {
  app.post(
    '/login',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Auth'],
        summary: 'Autentica um operador (e-mail ou CPF + senha)',
        description:
          'Devolve um access token JWT de curta duração e um refresh token rotativo. ' +
          'Limite: 5 tentativas por minuto.',
        body: loginBodySchema,
        response: { 200: loginResponseSchema },
      },
    },
    controller.login,
  );

  app.post(
    '/refresh',
    {
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Auth'],
        summary: 'Renova a sessão usando o refresh token',
        description:
          'O refresh token é rotacionado a cada uso. Reapresentar um token já usado ' +
          'invalida todas as sessões do usuário (proteção contra vazamento).',
        body: refreshBodySchema,
        response: { 200: refreshResponseSchema },
      },
    },
    controller.refresh,
  );

  app.post(
    '/logout',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Encerra a sessão atual (ou todas as sessões)',
        security: [{ bearerAuth: [] }],
        body: logoutBodySchema,
      },
    },
    controller.logout,
  );

  app.get(
    '/me',
    {
      preHandler: [app.authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Retorna o operador autenticado',
        security: [{ bearerAuth: [] }],
        response: { 200: meResponseSchema },
      },
    },
    controller.me,
  );
}
