/**
 * Plugin de segurança e resiliência de entrada.
 *
 * Ordem importa: sensible → helmet → cors → rate-limit.
 * O rate-limit é global (proteção básica) e rotas sensíveis (login, resgate)
 * sobrescrevem o limite via `config.rateLimit` no próprio route options.
 */
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { env } from '../config/env.js';

async function securityPlugin(app) {
  // Helpers HTTP (httpErrors.*) com semântica correta.
  await app.register(sensible);

  // Headers de segurança (XSS, sniffing, clickjacking, HSTS).
  await app.register(helmet, {
    contentSecurityPolicy: env.isProduction ? undefined : false, // docs () usam inline em dev
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  // CORS restrito por origem em produção (validado em env.js).
  await app.register(cors, {
    origin: env.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-unidade-id', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
    maxAge: 86_400,
  });

  // Rate limit global. Chave = usuário autenticado quando houver, senão IP.
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    keyGenerator: (request) => request.auth?.usuarioId?.toString() ?? request.ip,
    allowList: env.isTest ? ['127.0.0.1', '::1'] : undefined,
    // 429 continua no nosso contrato de erro (tratado no error handler global).
    addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true },
  });

  app.log.info({ max: env.RATE_LIMIT_MAX, janela: env.RATE_LIMIT_WINDOW }, 'Rate limit global ativo');
}

export default fp(securityPlugin, { name: 'security', fastify: '5.x' });
