/**
 * Schemas do módulo de clientes.
 */
import { z } from 'zod';
import { PAGINACAO } from '../../config/constants.js';
import { booleano, cpfSchema, dataSchema } from '../../utils/zod-helpers.js';

export const criarClienteBodySchema = z.object({
  cpf: cpfSchema,
  nome: z.string().trim().min(3, 'Nome muito curto.').max(160),
  email: z.string().trim().toLowerCase().email('E-mail inválido.').max(160).optional(),
  telefone: z.string().trim().min(8).max(20).optional().describe('Telefone com DDD'),
  dataNascimento: dataSchema.optional(),
  cidade: z.string().trim().max(80).optional(),
  uf: z.string().trim().length(2).toUpperCase().optional(),
  aceitaMarketing: booleano(false).describe('Consentimento para receber ofertas (LGPD)'),
  unidadeCadastroId: z.coerce.number().int().positive().optional(),
});

export const atualizarClienteBodySchema = criarClienteBodySchema
  .omit({ cpf: true })
  .partial()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export const listarClientesQuerySchema = z.object({
  busca: z.string().trim().min(2).max(120).optional().describe('Nome, CPF ou telefone'),
  ativo: booleano(true).optional(),
  nivel: z.enum(['BRONZE', 'PRATA', 'OURO', 'DIAMANTE']).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINACAO.LIMITE_MAXIMO).default(PAGINACAO.LIMITE_PADRAO),
  offset: z.coerce.number().int().min(0).default(0),
  unidadeCadastroId: z.coerce.number().int().positive().optional(),
  cidade: z.string().trim().min(2).max(80).optional(),
  uf: z.string().trim().length(2).toUpperCase().optional(),
  pontosMin: z.coerce.number().int().min(0).optional(),
  pontosMax: z.coerce.number().int().min(0).optional(),
  ordenarPor: z.enum(['nome', 'saldo_desc', 'saldo_asc', 'visita_desc']).default('nome'),
}).refine((query) => query.pontosMin === undefined || query.pontosMax === undefined || query.pontosMin <= query.pontosMax, {
  message: 'O saldo mínimo não pode superar o saldo máximo.',
  path: ['pontosMax'],
});

export const cpfParamSchema = z.object({
  cpf: cpfSchema,
});

/** Shape público do cliente. */
export const clienteSchema = z.object({
  id: z.number().int(),
  cpf: z.string(),
  nome: z.string(),
  email: z.string().nullable(),
  telefone: z.string().nullable(),
  dataNascimento: z.string().nullable(),
  cidade: z.string().nullable(),
  uf: z.string().nullable(),
  pontosSaldo: z.number().int(),
  nivel: z.string(),
  aceitaMarketing: z.boolean(),
  ativo: z.boolean(),
  unidadeCadastroId: z.number().int().nullable(),
  unidadeCadastroNome: z.string().nullable(),
  ultimaVisitaEm: z.string().nullable(),
  criadoEm: z.string().nullable(),
  atualizadoEm: z.string().nullable(),
});

export const clienteResponseSchema = z.object({ data: clienteSchema });

export const listarClientesResponseSchema = z.object({
  data: z.array(clienteSchema),
  meta: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    page: z.number().int(),
    pages: z.number().int(),
    hasNext: z.boolean(),
  }),
});
