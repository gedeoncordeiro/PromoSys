import * as relatoriosService from './relatorios.service.js';

export async function financeiro(request, reply) {
  const data = await relatoriosService.financeiro(request.query, request.auth);
  return reply.status(200).send({ data });
}

export async function unidades(request, reply) {
  const data = await relatoriosService.unidades(request.query, request.auth);
  return reply.status(200).send({ data });
}

export async function pontosClientes(request, reply) {
  const data = await relatoriosService.pontosClientes(request.query, request.auth);
  return reply.status(200).send({ data: data.itens, meta: data.meta });
}

export async function resumoOperacional(request, reply) {
  const data = await relatoriosService.resumoOperacional(request.query, request.auth);
  return reply.status(200).send({ data });
}
