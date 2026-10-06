/**
 * Validação e normalização das variáveis de ambiente.
 *
 * Regras:
 *  - Nenhum módulo deve ler `process.env` diretamente; importe sempre `env`.
 *  - O processo falha rápido (fail fast) se a configuração estiver inválida.
 *  - Segredos fracos ou CORS aberto são rejeitados em produção.
 */
import { z } from 'zod';
import { booleano } from '../utils/zod-helpers.js';

const variaveisAmbienteSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_PREFIX: z
      .string()
      .regex(/^\/[a-z0-9\-/]*$/i, 'API_PREFIX deve começar com "/" (ex.: /api/v1)')
      .default('/api/v1'),
    CORS_ORIGINS: z.string().default('*'),
    ENABLE_DOCS: booleano(true),
    TRUST_PROXY: booleano(false),

    // --- MySQL -------------------------------------------------------------
    DB_HOST: z.string().min(1).default('127.0.0.1'),
    DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
    DB_USER: z.string().min(1),
    DB_PASSWORD: z.string().default(''),
    DB_NAME: z.string().min(1),
    DB_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(200).default(10),
    DB_MAX_IDLE: z.coerce.number().int().min(0).max(200).default(10),
    DB_QUEUE_LIMIT: z.coerce.number().int().min(0).default(0),
    DB_CONNECT_TIMEOUT: z.coerce.number().int().min(1000).default(10_000),
    DB_IDLE_TIMEOUT: z.coerce.number().int().min(1000).default(60_000),

    // --- Autenticação ------------------------------------------------------
    JWT_ALGORITHM: z.enum(['HS256', 'HS384', 'HS512']).default('HS512'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter ao menos 32 caracteres'),
    JWT_EXPIRES_IN: z.string().regex(/^\d+\s*(s|m|h|d|w)$/, 'Formato: 15m, 1h, 7d').default('15m'),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, 'JWT_REFRESH_SECRET precisa ter ao menos 32 caracteres'),
    JWT_REFRESH_EXPIRES_IN: z
      .string()
      .regex(/^\d+\s*(s|m|h|d|w)$/, 'Formato: 7d, 12h')
      .default('7d'),
    JWT_ISSUER: z.string().min(1).default('promosys-api'),
    JWT_AUDIENCE: z.string().min(1).default('promosys-app'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(15).default(10),

    // --- Limites -----------------------------------------------------------
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),

    // --- Notificações (outbox → WhatsApp) ----------------------------------
    // Desligado por padrão: nenhum aviso é enfileirado até o canal ser
    // configurado e o cliente ter consentimento LGPD para WhatsApp.
    NOTIFICACOES_HABILITADAS: booleano(false),
    NOTIFICACOES_LOTE: z.coerce.number().int().min(1).max(500).default(100),
    NOTIFICACOES_MAX_TENTATIVAS: z.coerce.number().int().min(1).max(15).default(8),
    // Lease: ao reivindicar um item, o worker empurra a próxima tentativa.
    // Cobre o tempo do envio e evita dois workers pegando a mesma linha.
    NOTIFICACOES_LEASE_SEGUNDOS: z.coerce.number().int().min(30).default(300),
    NOTIFICACOES_BACKOFF_BASE_SEGUNDOS: z.coerce.number().int().min(5).default(60),
    NOTIFICACOES_BACKOFF_TETO_SEGUNDOS: z.coerce.number().int().min(60).default(21_600),
    WHATSAPP_PROVEDOR: z.enum(['log', 'http']).default('log'),
    WHATSAPP_API_URL: z.string().default(''),
    WHATSAPP_API_KEY: z.string().default(''),
    WHATSAPP_INSTANCIA: z.string().default(''),
    WHATSAPP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
    // Templates opcionais: vazio = usa o texto padrão do módulo de regras.
    WHATSAPP_TEMPLATE_CREDITO: z.string().default(''),
    WHATSAPP_TEMPLATE_ESTORNO: z.string().default(''),
  })
  .superRefine((valores, ctx) => {
    if (valores.NODE_ENV === 'production') {
      const segredosFracos = /troque|changeme|secret|example|123456/i;

      if (segredosFracos.test(valores.JWT_SECRET) || valores.JWT_SECRET.length < 64) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SECRET'],
          message: 'Em produção use um segredo aleatório com ao menos 64 caracteres.',
        });
      }

      if (
        segredosFracos.test(valores.JWT_REFRESH_SECRET) ||
        valores.JWT_REFRESH_SECRET.length < 64
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'Em produção use um segredo aleatório com ao menos 64 caracteres.',
        });
      }

      if (valores.CORS_ORIGINS.trim() === '*') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'Informe a lista de origens permitidas (CORS_ORIGINS=https://app.suaempresa.com).',
        });
      }

      if (valores.ENABLE_DOCS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ENABLE_DOCS'],
          message: 'Defina ENABLE_DOCS=false em produção.',
        });
      }
    }

    if (valores.DB_MAX_IDLE > valores.DB_CONNECTION_LIMIT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DB_MAX_IDLE'],
        message: 'DB_MAX_IDLE não pode ser maior que DB_CONNECTION_LIMIT.',
      });
    }

    if (valores.NOTIFICACOES_BACKOFF_TETO_SEGUNDOS < valores.NOTIFICACOES_BACKOFF_BASE_SEGUNDOS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['NOTIFICACOES_BACKOFF_TETO_SEGUNDOS'],
        message: 'O teto do backoff não pode ser menor que a base.',
      });
    }

    if (valores.NOTIFICACOES_HABILITADAS && valores.WHATSAPP_PROVEDOR === 'http' && !valores.WHATSAPP_API_URL.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_API_URL'],
        message: 'Com NOTIFICACOES_HABILITADAS=true e provedor http, informe WHATSAPP_API_URL.',
      });
    }

    if (
      valores.NODE_ENV === 'production' &&
      valores.NOTIFICACOES_HABILITADAS &&
      valores.WHATSAPP_PROVEDOR === 'log'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_PROVEDOR'],
        message:
          'O provedor "log" apenas registra a mensagem — em produção use WHATSAPP_PROVEDOR=http.',
      });
    }
  });

const resultado = variaveisAmbienteSchema.safeParse(process.env);

if (!resultado.success) {
  const detalhes = resultado.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
    .join('\n');

  // eslint-disable-next-line no-console
  console.error(
    `\n[config] Variáveis de ambiente inválidas:\n${detalhes}\n\n` +
      'Copie .env.example para .env e ajuste os valores antes de subir a API.\n',
  );
  process.exit(1);
}

const dados = resultado.data;

export const env = Object.freeze({
  ...dados,
  isProduction: dados.NODE_ENV === 'production',
  isDevelopment: dados.NODE_ENV === 'development',
  isTest: dados.NODE_ENV === 'test',
  /** `true` = qualquer origem (apenas dev) | array de origens permitidas */
  corsOrigins:
    dados.CORS_ORIGINS.trim() === '*'
      ? true
      : dados.CORS_ORIGINS.split(',')
          .map((origem) => origem.trim())
          .filter(Boolean),
});

export default env;
