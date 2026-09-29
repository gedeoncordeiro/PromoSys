/**
 * Logger estruturado (Pino) compartilhado por toda a aplicação.
 *
 * O Fastify usa as mesmas opções (`loggerOptions`) para logar requisições,
 * garantindo um único formato de log (JSON em produção, colorido em dev).
 */
import pino from 'pino';
import { env } from '../config/env.js';

/** Campos que nunca devem aparecer nos logs. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.senha',
  'req.body.password',
  'senha',
  'senha_hash',
  'password',
  'refreshToken',
  'accessToken',
  'token',
  '*.senha',
  '*.senha_hash',
  '*.refreshToken',
];

export const loggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'promosys-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  ...(env.isDevelopment
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'SYS:HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
            colorize: true,
            singleLine: true,
          },
        },
      }
    : {}),
};

export const logger = pino(loggerOptions);

export default logger;
