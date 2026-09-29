/**
 * Controller do módulo de pontos.
 */
import * as pontosService from './pontos.service.js';
import { contextoDaRequisicao } from '../../core/audit.js';

/** POST /pontos/compras — credita pontos de uma compra no PDV */
export async function registrarCompra(request, reply) {
  const resultado = await pontosService.registrarCompra(
    request.body,
    contextoDaRequisicao(request),
  );

  // 200 quando idempotente (documento já processado), 201 quando houve crédito novo.
  return reply.status(resultado.jaProcessado ? 200 : 201).send({ data: resultado });
}

/** POST /pontos/estornos */
export async function estornar(request, reply) {
  const resultado = await pontosService.estornar(
    request.body,
    contextoDaRequisicao(request),
  );
  return reply.status(201).send({ data: resultado });
}

/** POST /pontos/ajustes */
export async function ajustar(request, reply) {
  const resultado = await pontosService.ajustarSaldo(
    request.body,
    contextoDaRequisicao(request),
  );
  return reply.status(201).send({ data: resultado });
}

/** GET /pontos/clientes/:clienteId/saldo */
export async function obterSaldo(request, reply) {
  const saldo = await pontosService.obterSaldo(request.params.clienteId);
  return reply.status(200).send({ data: saldo });
}

/** GET /pontos/clientes/:clienteId/extrato */
export async function obterExtrato(request, reply) {
  const extrato = await pontosService.listarExtrato(request.params.clienteId, request.query);
  return reply.status(200).send({ data: extrato });
}
