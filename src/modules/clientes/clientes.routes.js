/**
 * Rotas de clientes (/api/v1/clientes).
 *
 * Matriz de acesso:
 *   criação/consulta -> ADMIN, GERENTE, OPERADOR (PDV cadastra cliente), AUDITOR (leitura)
 *   alteração        -> ADMIN, GERENTE
 *   inativação       -> ADMIN, GERENTE
 */
import * as controller from './clientes.controller.js';
import { PERFIS } from '../../config/constants.js';
import { idParamSchema } from '../../utils/zod-helpers.js';
import {
  criarClienteBodySchema,
  atualizarClienteBodySchema,
  listarClientesQuerySchema,
  cpfParamSchema,
  clienteResponseSchema,
  listarClientesResponseSchema,
} from './clientes.schema.js';

const PERFIS_LEITURA = [PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR, PERFIS.AUDITOR];
const PERFIS_ESCRITA = [PERFIS.ADMIN, PERFIS.GERENTE];

/** @param {import('fastify').FastifyInstance} app */
export default async function clientesRoutes(app) {
  app.post(
    '/',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR)],
      schema: {
        tags: ['Clientes'],
        summary: 'Cadastra um novo cliente no programa',
        security: [{ bearerAuth: [] }],
        body: criarClienteBodySchema,
        response: { 201: clienteResponseSchema },
      },
    },
    controller.criar,
  );

  app.get(
    '/',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Clientes'],
        summary: 'Lista clientes com busca e paginação',
        security: [{ bearerAuth: [] }],
        querystring: listarClientesQuerySchema,
        response: { 200: listarClientesResponseSchema },
      },
    },
    controller.listar,
  );

  // Declarada antes de /:id para tornar explícita a precedência da rota fixa.
  app.get(
    '/cpf/:cpf',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Clientes'],
        summary: 'Consulta cliente pelo CPF (uso no balcão do PDV)',
        security: [{ bearerAuth: [] }],
        params: cpfParamSchema,
        response: { 200: clienteResponseSchema },
      },
    },
    controller.obterPorCpf,
  );

  app.get(
    '/:id',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
      schema: {
        tags: ['Clientes'],
        summary: 'Consulta cliente pelo identificador',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        response: { 200: clienteResponseSchema },
      },
    },
    controller.obter,
  );

  app.patch(
    '/:id',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_ESCRITA)],
      schema: {
        tags: ['Clientes'],
        summary: 'Atualiza dados cadastrais do cliente',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
        body: atualizarClienteBodySchema,
        response: { 200: clienteResponseSchema },
      },
    },
    controller.atualizar,
  );

  app.delete(
    '/:id',
    {
      preHandler: [app.authenticate, app.authorize(PERFIS_ESCRITA)],
      schema: {
        tags: ['Clientes'],
        summary: 'Inativa o cliente (soft delete, preserva histórico)',
        security: [{ bearerAuth: [] }],
        params: idParamSchema,
      },
    },
    controller.inativar,
  );
}
