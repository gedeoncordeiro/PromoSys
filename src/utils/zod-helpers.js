/**
 * Helpers reutilizáveis de schema Zod.
 */
import { z } from 'zod';

/**
 * Booleano a partir de string de ambiente/query string.
 * Importante: `z.coerce.boolean()` NÃO serve, pois Boolean('false') === true.
 *
 * @param {boolean} padrao valor quando a variável não é informada
 */
export function booleano(padrao) {
  return z
    .preprocess((valor) => {
      if (valor === null || valor === undefined) return valor;
      if (typeof valor === 'boolean') return valor;
      if (typeof valor === 'number') return valor !== 0;

      const normalizado = String(valor).trim().toLowerCase();
      if (['true', '1', 'yes', 'on', 'sim'].includes(normalizado)) return true;
      if (['false', '0', 'no', 'off', 'nao', 'não', ''].includes(normalizado)) return false;
      return valor; // valor inesperado -> deixa o Zod reportar o erro
    }, z.boolean())
    .default(padrao);
}

/** Parâmetro de rota :id (inteiro positivo). */
export const idParamSchema = z.object({
  id: z.coerce.number().int().positive().describe('Identificador do recurso'),
});

/** CPF opcional aceitando máscara ou apenas dígitos. */
export const cpfSchema = z
  .string()
  .trim()
  .min(11, 'CPF incompleto.')
  .max(14)
  .describe('CPF com ou sem máscara');

/** Data no formato YYYY-MM-DD. */
export const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')
  .describe('Data no formato YYYY-MM-DD');
