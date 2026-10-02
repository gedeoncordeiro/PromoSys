/**
 * Filtros dos relatórios financeiros e operacionais.
 */
import { z } from 'zod';
import { ORIGENS_PONTOS, PAGINACAO, TIPOS_TRANSACAO } from '../../config/constants.js';
import { booleano, dataSchema } from '../../utils/zod-helpers.js';

const periodoSchema = {
  de: dataSchema.optional(),
  ate: dataSchema.optional(),
  unidadeId: z.coerce.number().int().positive().optional(),
};

export const financeiroQuerySchema = z.object({
  ...periodoSchema,
  busca: z.string().trim().min(2).max(120).optional(),
  tipo: z.enum(Object.values(TIPOS_TRANSACAO)).optional(),
  origem: z.enum(Object.values(ORIGENS_PONTOS)).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINACAO.LIMITE_MAXIMO).default(PAGINACAO.LIMITE_PADRAO),
  offset: z.coerce.number().int().min(0).default(0),
});

export const unidadesQuerySchema = z.object(periodoSchema);

export const resumoOperacionalQuerySchema = z.object({
  unidadeId: z.coerce.number().int().positive().optional(),
});

export const pontosClientesQuerySchema = z.object({
  busca: z.string().trim().min(2).max(120).optional(),
  nivel: z.enum(['BRONZE', 'PRATA', 'OURO', 'DIAMANTE']).optional(),
  ativo: booleano(true).optional(),
  pontosMin: z.coerce.number().int().min(0).optional(),
  pontosMax: z.coerce.number().int().min(0).optional(),
  ordenarPor: z.enum(['saldo_desc', 'saldo_asc', 'nome']).default('saldo_desc'),
  unidadeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(PAGINACAO.LIMITE_MAXIMO).default(PAGINACAO.LIMITE_PADRAO),
  offset: z.coerce.number().int().min(0).default(0),
});
