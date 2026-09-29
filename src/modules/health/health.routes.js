/**
 * Rotas de health check — usadas por load balancer, Kubernetes e monitoração.
 *
 *   /health/live  -> o processo está vivo (não toca dependências)
 *   /health/ready -> pode receber tráfego (valida o pool MySQL)
 *
 * Sem autenticação: são endpoints de infraestrutura, expõem apenas status.
 */
import { db } from '../../core/database/pool.js';
import { env } from '../../config/env.js';

const INICIADO_EM = Date.now();
const VERSAO = '0.1.0';

/** @param {import('fastify').FastifyInstance} app */
export default async function healthRoutes(app) {
  app.get(
    '/health/live',
    {
      logLevel: 'warn', // evita poluir o log a cada probe
      schema: {
        tags: ['Health'],
        summary: 'Liveness probe',
        security: [],
      },
    },
    async (_request, reply) =>
      reply.status(200).send({
        data: {
          status: 'ok',
          versao: VERSAO,
          ambiente: env.NODE_ENV,
          uptimeSegundos: Math.floor((Date.now() - INICIADO_EM) / 1000),
        },
      }),
  );

  app.get(
    '/health/ready',
    {
      logLevel: 'warn',
      schema: {
        tags: ['Health'],
        summary: 'Readiness probe (valida o pool do MySQL)',
        security: [],
      },
    },
    async (_request, reply) => {
      try {
        await db.ping();

        return reply.status(200).send({
          data: { status: 'ok', versao: VERSAO, banco: db.stats() },
        });
      } catch (erro) {
        app.log.error({ err: erro }, 'Readiness check falhou: MySQL inacessível');

        return reply.status(503).send({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'Banco de dados indisponível.',
          },
        });
      }
    },
  );
}
