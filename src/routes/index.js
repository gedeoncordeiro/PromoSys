/**
 * Agregador de rotas da API (montado sob `env.API_PREFIX`).
 *
 * Cada módulo é um plugin Fastify independente, com seu próprio contexto de
 * encapsulamento — o que permite versionar, testar e até extrair módulos sem
 * tocar no restante da aplicação.
 */

import healthRoutes from '../modules/health/health.routes.js';
import authRoutes from '../modules/auth/auth.routes.js';
import clientesRoutes from '../modules/clientes/clientes.routes.js';
import pontosRoutes from '../modules/pontos/pontos.routes.js';
import recompensasRoutes from '../modules/recompensas/recompensas.routes.js';
import relatoriosRoutes from '../modules/relatorios/relatorios.routes.js';

/** @param {import('fastify').FastifyInstance} app */
export default async function routes(app) {
  // Infraestrutura (sem autenticação)
  await app.register(healthRoutes);

  // Negócio
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(clientesRoutes, { prefix: '/clientes' });
  await app.register(pontosRoutes, { prefix: '/pontos' });
  await app.register(recompensasRoutes); // expõe /recompensas e /resgates
  await app.register(relatoriosRoutes, { prefix: '/relatorios' });
}
