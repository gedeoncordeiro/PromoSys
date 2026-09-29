/**
 * Hierarquia de erros da aplicação.
 *
 * Regras:
 *  - Services/Repositories lançam SOMENTE erros desta hierarquia (ou erros de
 *    driver, que o handler global traduz).
 *  - `isOperational = true` indica erro esperado de negócio (não é bug):
 *    pode ser logado como warn e sua mensagem pode ir ao cliente.
 *  - Erros 5xx nunca expõem detalhes internos em produção.
 */
export class AppError extends Error {
  constructor(
    message,
    { statusCode = 500, code = 'INTERNAL_ERROR', details, expose = statusCode < 500, cause } = {},
  ) {
    super(message, cause ? { cause } : undefined);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = expose;
    this.isOperational = true;
    Error.captureStackTrace?.(this, new.target);
  }

  /** Contrato de erro devolvido ao cliente: `{ error: { code, message, details } }`. */
  toJSON() {
    return {
      code: this.code,
      message: this.expose ? this.message : 'Erro interno do servidor.',
      ...(this.expose && this.details !== undefined ? { details: this.details } : {}),
    };
  }
}

/** 400 — payload malformado / parâmetros inválidos. */
export class BadRequestError extends AppError {
  constructor(message = 'Requisição inválida.', details) {
    super(message, { statusCode: 400, code: 'BAD_REQUEST', details });
  }
}

/** 401 — não autenticado (token ausente, inválido ou expirado). */
export class UnauthorizedError extends AppError {
  constructor(message = 'Não autenticado.', details) {
    super(message, { statusCode: 401, code: 'UNAUTHORIZED', details });
  }
}

/** 403 — autenticado, porém sem permissão. */
export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado.', details) {
    super(message, { statusCode: 403, code: 'FORBIDDEN', details });
  }
}

/** 404 — recurso inexistente. */
export class NotFoundError extends AppError {
  constructor(message = 'Recurso não encontrado.', details) {
    super(message, { statusCode: 404, code: 'NOT_FOUND', details });
  }
}

/** 409 — conflito de estado (duplicidade, concorrência). */
export class ConflictError extends AppError {
  constructor(message = 'Conflito com o estado atual do recurso.', details) {
    super(message, { statusCode: 409, code: 'CONFLICT', details });
  }
}

/** 422 — payload válido sintaticamente, inválido para a regra de negócio. */
export class ValidationError extends AppError {
  constructor(message = 'Dados inválidos.', details) {
    super(message, { statusCode: 422, code: 'VALIDATION_ERROR', details });
  }
}

/** 422 — violação de regra de negócio (saldo insuficiente, compra mínima...). */
export class BusinessRuleError extends AppError {
  constructor(message = 'Operação não permitida pela regra de negócio.', details) {
    super(message, { statusCode: 422, code: 'BUSINESS_RULE_VIOLATION', details });
  }
}

/** 429 — limite de requisições excedido. */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas requisições. Tente novamente em instantes.', details) {
    super(message, { statusCode: 429, code: 'TOO_MANY_REQUESTS', details });
  }
}

/** 503 — dependência indisponível (MySQL fora do ar, por exemplo). */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Serviço temporariamente indisponível.', details) {
    super(message, { statusCode: 503, code: 'SERVICE_UNAVAILABLE', details });
  }
}

/** Normaliza qualquer `throw` em um `AppError` (útil em catch de serviços). */
export function toAppError(erro, mensagemPadrao = 'Erro interno do servidor.') {
  if (erro instanceof AppError) return erro;
  return new AppError(mensagemPadrao, { cause: erro });
}
