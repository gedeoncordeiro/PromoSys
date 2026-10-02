/**
 * Controller de recompensas e resgates.
 */
import * as recompensaService from './recompensas.service.js';
import { contextoDaRequisicao } from '../../core/audit.js';

/** GET /recompensas */
export async function listar(request, reply) {
  const { itens, meta } = await recompensaService.listar(request.query);
  return reply.status(200).send({ data: itens, meta });
}

/** GET /recompensas/:id */
export async function obter(request, reply) {
  const recompensa = await recompensaService.obterPorId(request.params.id);
  return reply.status(200).send({ data: recompensa });
}

/** POST /recompensas */
export async function criar(request, reply) {
  const recompensa = await recompensaService.criar(request.body, contextoDaRequisicao(request));
  return reply.status(201).location(`/recompensas/${recompensa.id}`).send({ data: recompensa });
}

/** PATCH /recompensas/:id */
export async function atualizar(request, reply) {
  const recompensa = await recompensaService.atualizar(
    request.params.id,
    request.body,
    contextoDaRequisicao(request),
  );
  return reply.status(200).send({ data: recompensa });
}

/** POST /recompensas/:id/resgates */
export async function resgatar(request, reply) {
  const resgate = await recompensaService.resgatar(
    { recompensaId: request.params.id, ...request.body },
    contextoDaRequisicao(request),
  );
  return reply.status(201).send({ data: resgate });
}

/** GET /resgates */
export async function listarResgates(request, reply) {
  const { itens, meta } = await recompensaService.listarResgates(request.query, request.auth);
  return reply.status(200).send({ data: itens, meta });
}

/** POST /resgates/:id/confirmar-retirada */
export async function confirmarRetirada(request, reply) {
  const resgate = await recompensaService.confirmarRetirada(
    request.params.id,
    contextoDaRequisicao(request),
  );
  return reply.status(200).send({ data: resgate });
}
