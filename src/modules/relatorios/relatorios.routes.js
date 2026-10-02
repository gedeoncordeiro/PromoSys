import * as controller from './relatorios.controller.js';
import { PERFIS } from '../../config/constants.js';
import {
  financeiroQuerySchema,
  pontosClientesQuerySchema,
  resumoOperacionalQuerySchema,
  unidadesQuerySchema,
} from './relatorios.schema.js';

const PERFIS_LEITURA = [PERFIS.ADMIN, PERFIS.GERENTE, PERFIS.OPERADOR, PERFIS.AUDITOR];

export default async function relatoriosRoutes(app) {
  app.get('/operacao', {
    preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
    schema: {
      tags: ['Relatórios'],
      summary: 'Resumo agregado para o dashboard operacional',
      security: [{ bearerAuth: [] }],
      querystring: resumoOperacionalQuerySchema,
    },
  }, controller.resumoOperacional);

  app.get('/financeiro', {
    preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
    schema: {
      tags: ['Relatórios'],
      summary: 'Resumo financeiro e movimentos do programa por período',
      security: [{ bearerAuth: [] }],
      querystring: financeiroQuerySchema,
    },
  }, controller.financeiro);

  app.get('/unidades', {
    preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
    schema: {
      tags: ['Relatórios'],
      summary: 'Desempenho das unidades por período',
      security: [{ bearerAuth: [] }],
      querystring: unidadesQuerySchema,
    },
  }, controller.unidades);

  app.get('/pontos-clientes', {
    preHandler: [app.authenticate, app.authorize(PERFIS_LEITURA)],
    schema: {
      tags: ['Relatórios'],
      summary: 'Clientes, saldo de pontos, nível e unidade de cadastro',
      security: [{ bearerAuth: [] }],
      querystring: pontosClientesQuerySchema,
    },
  }, controller.pontosClientes);
}
