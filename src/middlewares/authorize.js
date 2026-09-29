/**
 * Middleware de autorização por perfil (RBAC).
 *
 * Uso na rota:
 *   { preHandler: [app.authenticate, app.authorize(PERFIS.ADMIN, PERFIS.GERENTE)] }
 *
 * Requer que `authenticate` rode antes (popula `request.auth`).
 * Regra de ouro do varejo: OPERADOR de PDV credita pontos, mas não altera
 * cadastro de cliente nem ajusta saldo manualmente.
 */
import { ForbiddenError, UnauthorizedError } from '../core/errors/app-error.js';

export function authorize(...perfisPermitidos) {
  const permitidos = new Set(perfisPermitidos.flat().filter(Boolean));

  if (permitidos.size === 0) {
    throw new Error('authorize() exige ao menos um perfil permitido.');
  }

  return async function authorizeHandler(request) {
    const perfil = request.auth?.perfil;

    if (!perfil) {
      throw new UnauthorizedError('Autenticação obrigatória para acessar este recurso.');
    }

    if (!permitidos.has(perfil)) {
      throw new ForbiddenError('Seu perfil não possui permissão para executar esta operação.', {
        perfil,
        perfisPermitidos: [...permitidos],
      });
    }
  };
}

/**
 * Restringe operações a uma unidade (loja) específica.
 * ADMIN e AUDITOR têm visão global; GERENTE/OPERADOR ficam presos à sua loja.
 * Aceita o id no body, na query ou no header `x-unidade-id`.
 */
export function authorizeUnidade({ perfisGlobais = ['ADMIN', 'AUDITOR'] } = {}) {
  return async function authorizeUnidadeHandler(request) {
    const perfil = request.auth?.perfil;
    if (perfisGlobais.includes(perfil)) return;

    const unidadeSolicitada = Number(
      request.body?.unidadeId ?? request.query?.unidadeId ?? request.headers['x-unidade-id'],
    );

    if (!Number.isInteger(unidadeSolicitada) || unidadeSolicitada <= 0) {
      throw new ForbiddenError('Informe a unidade (unidadeId) para esta operação.');
    }

    if (request.auth.unidadeId !== unidadeSolicitada) {
      throw new ForbiddenError('Você só pode operar na unidade vinculada ao seu usuário.', {
        unidadeDoUsuario: request.auth.unidadeId,
      });
    }
  };
}

export default authorize;
