/**
 * Controller de clientes: apenas HTTP <-> service.
 */
import * as clienteService from './clientes.service.js';
import { contextoDaRequisicao } from '../../core/audit.js';

/** POST /clientes */
export async function criar(request, reply) {
  const cliente = await clienteService.criar(request.body, contextoDaRequisicao(request));
  return reply.status(201).location(`/clientes/${cliente.id}`).send({ data: cliente });
}

/** GET /clientes */
export async function listar(request, reply) {
  const { itens, meta } = await clienteService.listar(request.query);
  return reply.status(200).send({ data: itens, meta });
}

/** GET /clientes/:id */
export async function obter(request, reply) {
  const cliente = await clienteService.obterPorId(request.params.id);
  return reply.status(200).send({ data: cliente });
}

/** GET /clientes/cpf/:cpf */
export async function obterPorCpf(request, reply) {
  const cliente = await clienteService.obterPorCpf(request.params.cpf);
  return reply.status(200).send({ data: cliente });
}

/** GET /clientes/export */
export async function exportarCsv(request, reply) {
  const csv = await clienteService.exportarCsv();
  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="clientes.csv"')
    .send(csv);
}

/** PATCH /clientes/:id */
export async function atualizar(request, reply) {
  const cliente = await clienteService.atualizar(
    request.params.id,
    request.body,
    contextoDaRequisicao(request),
  );
  return reply.status(200).send({ data: cliente });
}

/** DELETE /clientes/:id — inativação lógica */
export async function inativar(request, reply) {
  const cliente = await clienteService.inativar(
    request.params.id,
    contextoDaRequisicao(request),
  );
  return reply.status(200).send({ data: cliente });
}
