/**
 * Schemas do módulo de recompensas e resgates.
 */
import { z } from 'zod';
import { PAGINACAO, STATUS_RESGATE, TIPOS_RECOMPENSA } from '../../config/constants.js';
import { booleano, dataSchema } from '../../utils/zod-helpers.js';

export const criarRecompensaBodySchema = z.object({
  sku: z.string().trim().min(2).max(40),
  nome: z.string().trim().min(3).max(160),
  descricao: z.string().trim().max(500).optional(),
  tipo: z.enum(Object.values(TIPOS_RECOMPENSA)).default(TIPOS_RECOMPENSA.PRODUTO),
  pontosCusto: z.coerce.number().int().min(1, 'Custo em pontos deve ser positivo.'),
  valorReferencia: z.coerce.number().min(0).max(999_999.99).optional(),
  estoque: z.coerce.number().int().min(0).nullable().optional().describe('null = ilimitado'),
  limitePorCliente: z.coerce.number().int().min(1).nullable().optional(),
  vigenciaInicio: dataSchema.optional(),
  vigenciaFim: dataSchema.optional(),
  imagemUrl: z.string().url().max(500).optional(),
});

export const atualizarRecompensaBodySchema = criarRecompensaBodySchema
  .partial()
  .refine((dados) => Object.keys(dados).length > 0, {
    message: 'Informe ao menos um campo para atualizar.',
  });

export const listarRecompensasQuerySchema = z.object({
  busca: z.string().trim().min(2).max(120).optional(),
  tipo: z.enum(Object.values(TIPOS_RECOMPENSA)).optional(),
  pontosMaximos: z.coerce.number().int().positive().optional().describe('Filtra por saldo do cliente'),
  apenasVigentes: booleano(true).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINACAO.LIMITE_MAXIMO).default(PAGINACAO.LIMITE_PADRAO),
  offset: z.coerce.number().int().min(0).default(0),
});

export const resgatarBodySchema = z.object({
  clienteId: z.coerce.number().int().positive(),
  unidadeId: z.coerce.number().int().positive(),
});

export const listarResgatesQuerySchema = z.object({
  clienteId: z.coerce.number().int().positive().optional(),
  unidadeId: z.coerce.number().int().positive().optional(),
  status: z.enum(Object.values(STATUS_RESGATE)).optional(),
  busca: z.string().trim().min(2).max(120).optional(),
  de: dataSchema.optional(),
  ate: dataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINACAO.LIMITE_MAXIMO).default(PAGINACAO.LIMITE_PADRAO),
  offset: z.coerce.number().int().min(0).default(0),
});

export const recompensaSchema = z.object({
  id: z.number().int(),
  sku: z.string(),
  nome: z.string(),
  descricao: z.string().nullable(),
  tipo: z.string(),
  pontosCusto: z.number().int(),
  valorReferencia: z.number().nullable(),
  estoque: z.number().int().nullable(),
  limitePorCliente: z.number().int().nullable(),
  vigenciaInicio: z.string().nullable(),
  vigenciaFim: z.string().nullable(),
  imagemUrl: z.string().nullable(),
  ativo: z.boolean(),
  criadoEm: z.string().nullable(),
  atualizadoEm: z.string().nullable(),
});

export const resgateSchema = z.object({
  id: z.number().int(),
  codigo: z.string(),
  clienteId: z.number().int(),
  clienteNome: z.string().nullable(),
  recompensaId: z.number().int(),
  recompensaNome: z.string().nullable(),
  unidadeId: z.number().int().nullable(),
  unidadeNome: z.string().nullable(),
  usuarioId: z.number().int().nullable(),
  transacaoId: z.number().int().nullable(),
  pontosDebitados: z.number().int(),
  saldoApos: z.number().int().nullable(),
  status: z.string(),
  retiradoEm: z.string().nullable(),
  criadoEm: z.string().nullable(),
});

export const listarRecompensasResponseSchema = z.object({
  data: z.array(recompensaSchema),
  meta: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    page: z.number().int(),
    pages: z.number().int(),
    hasNext: z.boolean(),
  }),
});

export const resgateResponseSchema = z.object({ data: resgateSchema });
export const recompensaResponseSchema = z.object({ data: recompensaSchema });
export const listarResgatesResponseSchema = z.object({
  data: z.array(resgateSchema),
  meta: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
    page: z.number().int(),
    pages: z.number().int(),
    hasNext: z.boolean(),
  }),
});
