/**
 * Montagem da aplicação Fastify (sem `listen`).
 * Separar `buildApp` do `listen` permite testar a API com `app.inject()`
 * sem abrir porta de rede.
 *
 * Ordem de registro:
 *   1. error/not-found handlers  → contrato único de erro
 *   2. segurança (helmet/cors/rate-limit)
 *   3. banco de dados (pool)
 *   4. autenticação (JWT + decorators)
 *   5. documentação (opcional)
 *   6. rotas de negócio sob o prefixo da API
 */
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { env } from './config/env.js';
import { loggerOptions } from './core/logger.js';
import { errorHandler } from './core/http/error-handler.js';
import { notFoundHandler } from './core/http/not-found-handler.js';

import securityPlugin from './plugins/security.plugin.js';
import databasePlugin from './plugins/database.plugin.js';
import authPlugin from './plugins/auth.plugin.js';
import docsPlugin from './plugins/docs.plugin.js';

import routes from './routes/index.js';

/** Teto de payload: requisições de PDV são pequenas; corpo grande é anomalia. */
const LIMITE_CORPO_BYTES = 1 * 1024 * 1024; // 1 MiB

export async function buildApp(opcoes = {}) {
  const { databasePlugin: pluginBanco = databasePlugin, ...opcoesFastify } = opcoes;

  const app = Fastify({
    logger: loggerOptions,
    trustProxy: env.TRUST_PROXY,

    // Proteção contra conexões lentas / corpo grande (anti-DoS básica)
    bodyLimit: LIMITE_CORPO_BYTES,
    requestTimeout: 30_000,
    connectionTimeout: 30_000,
    keepAliveTimeout: 72_000,

    // Correlação de logs: aceita x-request-id do cliente (rastreio ponta a ponta)
    genReqId: (request) => {
      const headerId = request.headers['x-request-id'];
      return typeof headerId === 'string' && headerId.length <= 128 ? headerId : randomUUID();
    },

    ...opcoesFastify,
  });

  // Validação/serialização com Zod em todas as rotas (via fastify-type-provider-zod)
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Contrato de erro global + 404 JSON
  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  await app.register(securityPlugin);
  await app.register(pluginBanco);
  await app.register(authPlugin);
  await app.register(docsPlugin);

  await app.register(routes, { prefix: env.API_PREFIX });

  return app;
}

export default buildApp;
