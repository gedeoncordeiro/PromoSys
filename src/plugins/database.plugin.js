/**
 * Plugin do banco de dados.
 *
 * - Decora o Fastify com `app.db` (acesso ao pool dentro dos handlers).
 * - Valida a conectividade no boot (`onReady`): a API não sobe "verde" se o
 *   MySQL estiver inacessível.
 * - Fecha o pool no shutdown gracioso (`onClose`).
 */
import fp from 'fastify-plugin';
import { db } from '../core/database/pool.js';
import { env } from '../../config/env.js';

async function databasePlugin(app) {
  app.decorate('db', db);

  app.addHook('onReady', async () => {
    try {
      await db.ping();
      app.log.info(
        { host: env.DB_HOST, database: env.DB_NAME, connectionLimit: env.DB_CONNECTION_LIMIT },
        'Pool de conexões MySQL pronto',
      );
    } catch (erro) {
      app.log.fatal({ err: erro, host: env.DB_HOST, database: env.DB_NAME }, 'Falha ao conectar no MySQL');
      throw erro; // fail fast: processo não deve subir sem banco
    }
  });

  app.addHook('onClose', async () => {
    await db.close();
    app.log.info('Pool de conexões MySQL encerrado');
  });
}

export default fp(databasePlugin, { name: 'database', fastify: '5.x' });
