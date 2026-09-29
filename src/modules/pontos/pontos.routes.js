/**
 * Rotas de pontos (/api/v1/pontos).
 *
 * Matriz de acesso:
 *   crédito de compra -> ADMIN, GERENTE, OPERADOR (e apenas na própria unidade)
 *   estorno / ajuste  -> ADMIN, GERENTE (operações sensíveis, sempre auditadas)
 *   saldo / extrato   -> todos os perfis autenticados
 */
import * as controller from './pontos.controller.js';
import { PERFIS } from '../../config/constants.js';
import {
  registrarCompraBodySchema,
  estornarBodySchema,
  ajusteSaldoBodySchema,
  clienteIdParamSchema,
  extratoQuerySchema,
  compraResponseSchema,
  saldoResponseSchema,
  extratoResponseSchema,
} from './pontos.schema.js';

const PERFIS_LEITURA = [PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR, PERFIS.AUDITOR];

/** @param {import('fastify').FastifyInstance} app */
export default async function pontosRoutes(app) {
  app.post(
    '/compras',
    {
      preHandler: [
        app.authenticate,
        app.authorize(PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR),
        // OPERADOR/GERENTE só creditam na unidade vinculada ao usuário.
        app.authorizeUnidade(),
      ],
      config: {
        // Pico de fim de semana no PDV: limite maior que o padrão global.
        rateLimit: { max: 600, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Pontos'],
        summary: 'Credita pontos de uma compra (idempotente por documento fiscal)',
        security: [{ bearerAuth: [] }],
        body: registrarCompraBodySchema,
        response: { 201: compraResponseSchema },
      },
    },
    controller.registrarCompra,
  );

  app.post(
    '/estornos',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS.ADMIN, PERFIS.GERENTE)],
      schema: {
        tags: ['Pontos'],
        summary: 'Estorna um crédito de pontos (devolução de compra)',
        security: [{ bearerAuth: [] }],
        body: estornarBodySchema,
      },
    },
    controller.estornar,
  );

  app.post(
    '/ajustes',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS.ADMIN, PERFIS.GERENTE)],
      schema: {
        tags: ['Pontos'],
        summary: 'Ajuste manual de saldo (cortesia, correção, bonificação)',
        security: [{ bearerAuth: [] }],
        body: ajusteSaldoBodySchema,
      },
    },
    controller.ajustar,
  );

  app.get(
    '/clientes/:clienteId/saldo',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Pontos'],
        summary: 'Saldo consolidado do cliente + pontos a expirar',
        security: [{ bearerAuth: [] }],
        params: clienteIdParamSchema,
        response: { 200: saldoResponseSchema },
      },
    },
    controller.obterSaldo,
  );

  app.get(
    '/clientes/:clienteId/extrato',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Pontos'],
        summary: 'Extrato paginado de movimentações de pontos',
        security: [{ bearerAuth: [] }],
        params: clienteIdParamSchema,
        querystring: extratoQuerySchema,
        response: { 200: extratoResponseSchema },
      },
    },
    controller.obterExtrato,
  );
}
