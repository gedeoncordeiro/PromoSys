/**
 * Handler de rota inexistente — mantém o mesmo contrato de erro do resto da API
 * (evita o HTML/plain-text padrão do Fastify, que quebra clientes que esperam JSON).
 */
export function notFoundHandler(request, reply) {
  return reply.status(404).send({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Rota ${request.method} ${request.url} não encontrada.`,
    },
    requestId: request.id,
  });
}

export default notFoundHandler;
