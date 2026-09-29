/**
 * Handler global de erros.
 *
 * Toda exceção (rotas, services, JWT, validação, MySQL) converge para cá,
 * garantindo um contrato único de resposta:
 *
 *   4xx/5xx → { error: { code, message, details? }, requestId }
 *
 * Comportamento por severidade:
 *  - 4xx: log nível `warn` (não poluem alertas) e stack trace suprimido.
 *  - 5xx: log nível `error` com stack; mensagem genérica ao cliente em produção.
 */
import { ZodError } from 'zod';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../errors/app-error.js';
import { env } from '../../config/env.js';

/** Tradução de erros do MySQL para o nosso contrato HTTP. */
const MAPA_ERROS_MYSQL = {
  ER_DUP_ENTRY: {
    statusCode: 409,
    code: 'RESOURCE_ALREADY_EXISTS',
    message: 'Já existe um registro com os dados informados.',
  },
  ER_NO_REFERENCED_ROW_2: {
    statusCode: 422,
    code: 'INVALID_REFERENCE',
    message: 'Registro relacionado inexistente.',
  },
  ER_ROW_IS_REFERENCED_2: {
    statusCode: 409,
    code: 'RESOURCE_IN_USE',
    message: 'Registro possui vínculos e não pode ser removido.',
  },
  ER_LOCK_DEADLOCK: {
    statusCode: 409,
    code: 'CONCURRENCY_CONFLICT',
    message: 'Conflito de concorrência na transação. Tente novamente.',
  },
  ER_LOCK_WAIT_TIMEOUT: {
    statusCode: 409,
    code: 'CONCURRENCY_TIMEOUT',
    message: 'Tempo de espera por lock excedido. Tente novamente.',
  },
  ER_CHECK_CONSTRAINT_VIOLATED: {
    statusCode: 422,
    code: 'CONSTRAINT_VIOLATION',
    message: 'Operação viola uma restrição de integridade.',
  },
  ER_DATA_TOO_LONG: {
    statusCode: 422,
    code: 'FIELD_TOO_LONG',
    message: 'Um dos campos excede o tamanho máximo permitido.',
  },
  ER_TRUNCATED_WRONG_VALUE: {
    statusCode: 422,
    code: 'INVALID_FIELD_VALUE',
    message: 'Um dos campos possui valor incompatível com o tipo esperado.',
  },
  ER_BAD_NULL_ERROR: {
    statusCode: 422,
    code: 'MISSING_REQUIRED_FIELD',
    message: 'Campo obrigatório não informado.',
  },
  ECONNREFUSED: {
    statusCode: 503,
    code: 'DATABASE_UNAVAILABLE',
    message: 'Banco de dados indisponível. Tente novamente em instantes.',
  },
  PROTOCOL_CONNECTION_LOST: {
    statusCode: 503,
    code: 'DATABASE_UNAVAILABLE',
    message: 'Conexão com o banco de dados foi interrompida.',
  },
  ETIMEDOUT: {
    statusCode: 503,
    code: 'DATABASE_TIMEOUT',
    message: 'Tempo limite excedido ao acessar o banco de dados.',
  },
  ER_ACCESS_DENIED_ERROR: {
    statusCode: 500,
    code: 'DATABASE_ACCESS_DENIED',
    message: 'Falha de autenticação no banco de dados.',
  },
};

function respostaErro(reply, { statusCode, code, message, details, requestId }) {
  return reply.status(statusCode).send({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
    requestId,
  });
}

/** Detecta erros de JWT tanto do fast-jwt (@fastify/jwt) quanto do jsonwebtoken. */
function ehErroDeJwt(erro) {
  const codigo = typeof erro?.code === 'string' ? erro.code : '';
  return (
    codigo.startsWith('FST_JWT') ||
    codigo.startsWith('FAST_JWT') ||
    erro?.name === 'JsonWebTokenError' ||
    erro?.name === 'TokenExpiredError' ||
    erro?.name === 'NotBeforeError'
  );
}

/** Extrai o nome do índice violado em `ER_DUP_ENTRY` para facilitar a vida do cliente. */
function detalhesDuplicidade(erro) {
  const mensagem = String(erro?.sqlMessage ?? erro?.message ?? '');
  const match = /for key '([^']+)'/.exec(mensagem);
  return match ? { constraint: match[1] } : undefined;
}

export function errorHandler(erro, request, reply) {
  const requestId = request.id;
  const log = request.log ?? request.server?.log;

  // 1) Validação de schema (Zod via fastify-type-provider-zod) -----------------
  if (hasZodFastifySchemaValidationErrors(erro)) {
    const details = erro.validation.map((problema) => ({
      campo: problema.instancePath?.replace(/^\//, '') || problema.params?.issue?.path?.join('.') || undefined,
      mensagem: problema.message,
      ...(problema.params?.issue?.code ? { codigo: problema.params.issue.code } : {}),
    }));

    log?.info({ requestId, details }, 'Requisição rejeitada por validação de schema');
    return respostaErro(reply, {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Dados de entrada inválidos.',
      details,
      requestId,
    });
  }

  // 2) Validação nativa do Fastify (rotas com JSON Schema puro) ---------------
  if (Array.isArray(erro?.validation) && erro.validation.length > 0) {
    const details = erro.validation.map((problema) => ({
      campo: problema.instancePath?.replace(/^\//, '') || problema.params?.missingProperty,
      mensagem: problema.message,
    }));

    log?.info({ requestId, details }, 'Requisição rejeitada por validação de JSON Schema');
    return respostaErro(reply, {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Dados de entrada inválidos.',
      details,
      requestId,
    });
  }

  // 3) ZodError lançado manualmente dentro de services ------------------------
  if (erro instanceof ZodError) {
    const details = erro.issues.map((issue) => ({
      campo: issue.path.join('.') || undefined,
      mensagem: issue.message,
      codigo: issue.code,
    }));

    log?.info({ requestId, details }, 'ZodError capturado no service');
    return respostaErro(reply, {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
      message: 'Dados inválidos.',
      details,
      requestId,
    });
  }

  // 4) Erros de negócio/HTTP da aplicação ------------------------------------
  if (erro instanceof AppError) {
    if (erro.statusCode >= 500) {
      log?.error({ err: erro, requestId }, 'Erro de aplicação (5xx)');
    } else {
      log?.warn(
        { requestId, code: erro.code, statusCode: erro.statusCode, details: erro.details },
        erro.message,
      );
    }

    return respostaErro(reply, {
      statusCode: erro.statusCode,
      code: erro.code,
      message: erro.expose ? erro.message : 'Erro interno do servidor.',
      details: erro.expose ? erro.details : undefined,
      requestId,
    });
  }

  // 5) JWT ------------------------------------------------------------------
  if (ehErroDeJwt(erro)) {
    log?.warn({ requestId, code: erro.code ?? erro.name }, 'Falha de autenticação JWT');
    return respostaErro(reply, {
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Token de acesso ausente, inválido ou expirado.',
      requestId,
    });
  }

  // 6) MySQL ----------------------------------------------------------------
  const mapeado = MAPA_ERROS_MYSQL[erro?.code];
  if (mapeado) {
    const details =
      erro.code === 'ER_DUP_ENTRY' ? detalhesDuplicidade(erro) : erro.sqlMessage;

    if (mapeado.statusCode >= 500) {
      log?.error({ err: erro, requestId, dbCode: erro.code }, 'Erro de banco de dados (5xx)');
    } else {
      log?.warn({ requestId, dbCode: erro.code, details }, mapeado.message);
    }

    return respostaErro(reply, {
      statusCode: mapeado.statusCode,
      code: mapeado.code,
      message: mapeado.message,
      details: mapeado.statusCode >= 500 ? undefined : details,
      requestId,
    });
  }

  // 7) Erros HTTP genéricos do Fastify (413, 415, 429 do rate-limit...) ------
  const statusCode = Number(erro?.statusCode ?? 0);
  if (statusCode >= 400 && statusCode < 500) {
    const codigo =
      statusCode === 429
        ? 'TOO_MANY_REQUESTS'
        : statusCode === 413
          ? 'PAYLOAD_TOO_LARGE'
          : 'REQUEST_ERROR';

    log?.warn({ requestId, statusCode, code: erro?.code }, erro?.message ?? 'Erro de requisição');

    return respostaErro(reply, {
      statusCode,
      code: codigo,
      message: statusCode === 429 ? 'Muitas requisições. Tente novamente em instantes.' : erro.message,
      requestId,
    });
  }

  // 8) Erro de serialização de resposta --------------------------------------
  if (isResponseSerializationError(erro)) {
    log?.error({ err: erro, requestId }, 'Falha ao serializar resposta (schema divergente do payload)');
    return respostaErro(reply, {
      statusCode: 500,
      code: 'RESPONSE_SERIALIZATION_ERROR',
      message: 'Erro interno do servidor.',
      requestId,
    });
  }

  // 9) Fallback: erro inesperado (bug) --------------------------------------
  log?.error({ err: erro, requestId }, 'Erro não tratado');

  return respostaErro(reply, {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'Erro interno do servidor.',
    details: env.isProduction ? undefined : { stack: erro?.stack?.split('\n').slice(0, 5) },
    requestId,
  });
}

export default errorHandler;
