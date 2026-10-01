/**
 * OpenAPI/Swagger — habilitado por ENABLE_DOCS (obrigatoriamente false em produção).
 * Os schemas Zod das rotas viram documentação automaticamente via
 * `jsonSchemaTransform` do fastify-type-provider-zod.
 */
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { env } from '../config/env.js';

async function docsPlugin(app) {
  if (!env.ENABLE_DOCS) {
    app.log.info('Documentação OpenAPI desabilitada (ENABLE_DOCS=false)');
    return;
  }

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'PromoSys API',
        description:
          'API do programa de fidelidade para varejo físico: clientes, pontuação, extrato e resgates.',
        version: '0.1.0',
      },
      servers: [{ url: env.API_PREFIX, description: env.NODE_ENV }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'Auth', description: 'Autenticação de operadores (JWT + refresh token)' },
        { name: 'Clientes', description: 'Cadastro e consulta de clientes do programa' },
        { name: 'Pontos', description: 'Acúmulo, estorno, ajuste e extrato de pontos' },
        { name: 'Recompensas', description: 'Catálogo e resgate de recompensas' },
        { name: 'Health', description: 'Liveness e readiness da API' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  app.log.info('Documentação OpenAPI disponível em /docs');
}

export default fp(docsPlugin, { name: 'docs', fastify: '5.x' });
