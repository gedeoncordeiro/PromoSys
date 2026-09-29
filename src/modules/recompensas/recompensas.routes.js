/**
 * Rotas de recompensas e resgates.
 *
 * Prefixos:
 *   /api/v1/recompensas  -> catálogo e resgate
 *   /api/v1/resgates     -> acompanhamento e entrega dos prêmios
 *
 * Matriz de acesso:
 *   catálogo (leitura) -> todos os perfis autenticados
 *   catálogo (escrita) -> ADMIN, GERENTE
 *   resgatar           -> ADMIN, GERENTE, OPERADOR (balcão)
 *   confirmar retirada -> ADMIN, GERENTE, OPERADOR
 */
import * as controller from './recompensas.controller.js';
import { PERFIS } from '../../config/constants.js';
import { idParamSchema } from '../../utils/zod-helpers.js';
import {
  criarRecompensaBodySchema,
  atualizarRecompensaBodySchema,
  listarRecompensasQuerySchema,
  resgatarBodySchema,
  listarResgatesQuerySchema,
  listarRecompensasResponseSchema,
  recompensaResponseSchema,
  listarResgatesResponseSchema,
  resgateResponseSchema,
} from './recompensas.schema.js';

const PERFIS_LEITURA = [PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR, PERFIS.AUDITOR];
const PERFIS_ESCRITA = [PERFIS.ADMIN, PERFIS.GERENTE];
const PERFIS_BALCAO = [PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR];

/** @param {import('fastify').FastifyInstance} app */
export default async function recompensasRoutes(app) {
  app.get(
    '/recompensas',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Recompensas'],
        summary: 'Lista o catálogo de recompensas',
        security: [{ bearerAuth: [] }],
        querystring: listarRecompensasQuerySchema,
        response: { 200: listarRecompensasResponseSchema },
      },
    },
    controller.listar,
  );

  app.get(
    '/recompensas/:id',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Recompensas'],
        summary: 'Detalha uma recompensa',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: recompensaResponseSchema },
      },
    },
    controller.obter,
  );

  app.post(
    '/recompensas',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_ESCRITA)],
      schema: {
        tags: ['Recompensas'],
        summary: 'Cadastra uma recompensa no catálogo',
        security: [{ bearerAuth: [] }],
        body: criarRecompensaBodySchema,
        response: { 201: recompensaResponseSchema },
      },
    },
    controller.criar,
  );

  app.patch(
    '/recompensas/:id',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_ESCRITA)],
      schema: {
        tags: ['Recompensas'],
        summary: 'Atualiza uma recompensa (preço em pontos, estoque, vigência...)',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: atualizarRecompensaBodySchema,
        response: { 200: recompensaResponseSchema },
      },
    },
    controller.atualizar,
  );

  app.post(
    '/recompensas/:id/resgates',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_BALCAO), app.authorizeUnidade()],
      config: {
        // Resgate concorrido em campanha: limite próprio para não bloquear o PDV.
        rateLimit: { max: 300, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Recompensas'],
        summary: 'Resgata uma recompensa (debita pontos e gera código de retirada)',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: resgatarBodySchema,
        response: { 201: resgateResponseSchema },
      },
    },
    controller.resgatar,
  );

  app.get(
    '/resgates',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Recompensas'],
        summary: 'Lista resgates (filtros por cliente, unidade e status)',
        security: [{ bearerAuth: [] }],
        querystring: listarResgatesQuerySchema,
        response: { 200: listarResgatesResponseSchema },
      },
    },
    controller.listarResgates,
  );

  app.post(
    '/resgates/:id/confirmar-retirada',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_BALCAO)],
      schema: {
        tags: ['Recompensas'],
        summary: 'Confirma a entrega do prêmio no balcão',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: resgateResponseSchema },
      },
    },
    controller.confirmarRetirada,
  );
}
