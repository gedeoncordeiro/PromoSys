/**
 * Schemas (Zod) do módulo de autenticação.
 * São a única fonte de verdade da entrada: validam body/query/params e geram a
 * documentação OpenAPI automaticamente.
 */
import { z } from 'zod';

/** Login de operador: aceita e-mail OU CPF no mesmo campo. */
export const loginBodySchema = z.object({
  identificador: z
    .string()
    .trim()
    .min(5, 'Informe o e-mail ou o CPF.')
    .max(160)
    .describe('E-mail ou CPF do operador'),
  senha: z.string().min(6, 'Senha muito curta.').max(72).describe('Senha do operador'),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token inválido.').max(512),
});

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
  todasSessoes: z.boolean().default(false).describe('Encerra todas as sessões do usuário'),
});

/** Representação pública do operador (nunca inclui senha_hash). */
export const usuarioPublicoSchema = z.object({
  id: z.number().int(),
  nome: z.string(),
  email: z.string(),
  cpf: z.string().nullable(),
  perfil: z.string(),
  unidadeId: z.number().int().nullable(),
  unidadeNome: z.string().nullable(),
  ativo: z.boolean(),
  ultimoLoginEm: z.string().nullable(),
});

export const sessaoSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.string(),
  usuario: usuarioPublicoSchema,
});

export const loginResponseSchema = z.object({
  data: sessaoSchema,
});

export const refreshResponseSchema = z.object({
  data: sessaoSchema.omit({ usuario: true }),
});

export const meResponseSchema = z.object({
  data: usuarioPublicoSchema,
});
