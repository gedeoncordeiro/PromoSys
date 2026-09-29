/**
 * Paginação padronizada (limit/offset) com contrato único de metadados.
 *
 * O `limit` é sempre validado e limitado a `PAGINACAO.LIMITE_MAXIMO` antes de
 * chegar ao SQL — listagens de PDV nunca devem varrer a tabela inteira.
 */
import { z } from 'zod';
import { PAGINACAO } from '../config/constants.js';

/** Schema reutilizável de query string para listagens. */
export const paginacaoSchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINACAO.LIMITE_MAXIMO)
    .default(PAGINACAO.LIMITE_PADRAO)
    .describe('Itens por página'),
  offset: z.coerce.number().int().min(0).default(0).describe('Itens a ignorar'),
});

/**
 * Converte `{ limit, offset }` nos valores seguros usados pelo SQL.
 * Os números já foram validados por `paginacaoSchema`.
 */
export function normalizarPaginacao({ limit, offset } = {}) {
  const limite = Math.min(
    Math.max(Number(limit) || PAGINACAO.LIMITE_PADRAO, 1),
    PAGINACAO.LIMITE_MAXIMO,
  );
  const deslocamento = Math.max(Number(offset) || 0, 0);

  return { limit: limite, offset: deslocamento };
}

/** Metadados de resposta: `{ total, limit, offset, page, pages, hasNext }`. */
export function metaPaginacao({ total, limit, offset }) {
  const totalSeguro = Number(total) || 0;
  const paginas = limit > 0 ? Math.ceil(totalSeguro / limit) : 0;

  return {
    total: totalSeguro,
    limit,
    offset,
    page: limit > 0 ? Math.floor(offset / limit) + 1 : 1,
    pages: paginas,
    hasNext: offset + limit < totalSeguro,
  };
}
