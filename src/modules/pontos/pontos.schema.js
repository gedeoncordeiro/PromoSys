/**
 * Schemas do módulo de pontos.
 */
import { z } from 'zod';
import { PAGINACAO, TIPOS_TRANSACAO, ORIGENS_PONTOS } from '../../config/constants.js';
import { dataSchema } from '../../utils/zod-helpers.js';

/** Valor monetário: normalizado para 2 casas (evita dízimas no cálculo de pontos). */
const valorMonetarioSchema = z.coerce
  .number()
  .positive('O valor da compra deve ser maior que zero.')
  .max(999_999_999.99)
  .transform((valor) => Math.round(valor * 100) / 100)
  .describe('Valor da compra em reais (ex.: 149.90)');

export const registrarCompraBodySchema = z.object({
  clienteId: z.coerce.number().int().positive(),
  unidadeId: z.coerce.number().int().positive(),
  valor: valorMonetarioSchema,
  documentoFiscal: z
    .string()
    .trim()
    .min(1)
    .max(44)
    .optional()
    .describe('NFC-e/SAT — garante idempotência do crédito'),
  descricao: z.string().trim().max(255).optional(),
});

export const estornarBodySchema = z.object({
  transacaoId: z.coerce.number().int().positive(),
  motivo: z.string().trim().min(3).max(255).optional(),
});

export const ajusteSaldoBodySchema = z.object({
  clienteId: z.coerce.number().int().positive(),
  pontos: z.coerce
    .number()
    .int()
    .refine((valor) => valor !== 0, 'Informe um valor diferente de zero.')
    .describe('Positivo credita, negativo debita'),
  motivo: z.string().trim().min(3, 'Descreva o motivo do ajuste.').max(255),
  unidadeId: z.coerce.number().int().positive().optional(),
});

export const clienteIdParamSchema = z.object({
  clienteId: z.coerce.number().int().positive(),
});

export const extratoQuerySchema = z.object({
  tipo: z.enum(Object.values(TIPOS_TRANSACAO)).optional(),
  origem: z.enum(Object.values(ORIGENS_PONTOS)).optional(),
  de: dataSchema.optional(),
  ate: dataSchema.optional(),
  limit: z.coerce.number().int().min(1).max(PAGINACAO.LIMITE_MAXIMO).default(PAGINACAO.LIMITE_PADRAO),
  offset: z.coerce.number().int().min(0).default(0),
});

export const transacaoSchema = z.object({
  id: z.number().int(),
  clienteId: z.number().int(),
  unidadeId: z.number().int().nullable(),
  unidadeNome: z.string().nullable(),
  usuarioId: z.number().int().nullable(),
  tipo: z.string(),
  origem: z.string(),
  pontos: z.number().int(),
  valorCompra: z.number().nullable(),
  documentoFiscal: z.string().nullable(),
  descricao: z.string().nullable(),
  saldoApos: z.number().int().nullable(),
  estornoDeTransacaoId: z.number().int().nullable(),
  criadoEm: z.string().nullable(),
});

export const compraResponseSchema = z.object({
  data: z.object({
    jaProcessado: z.boolean(),
    transacaoId: z.number().int(),
    pontos: z.number().int(),
    saldoApos: z.number().int(),
    expiraEm: z.string().nullable().optional(),
    regra: z.any().optional(),
  }),
});

export const saldoResponseSchema = z.object({
  data: z.object({
    clienteId: z.number().int(),
    nome: z.string(),
    pontosSaldo: z.number().int(),
    nivel: z.string(),
    pontosAVencer: z.number().int(),
    proximaExpiracao: z.string().nullable(),
    avisoExpiracaoDias: z.number().int(),
  }),
});

export const extratoResponseSchema = z.object({
  data: z.object({
    saldoAtual: z.number().int(),
    itens: z.array(transacaoSchema),
    meta: z.object({
      total: z.number().int(),
      limit: z.number().int(),
      offset: z.number().int(),
      page: z.number().int(),
      pages: z.number().int(),
      hasNext: z.boolean(),
    }),
  }),
});
