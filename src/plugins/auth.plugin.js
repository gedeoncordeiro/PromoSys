/**
 * Plugin de autenticação: registra o @fastify/jwt e expõe os decorators
 * `app.authenticate` e `app.authorize` para uso nas rotas.
 *
 * Assinatura (utils/token.js) e verificação (@fastify/jwt) usam o MESMO
 * segredo, algoritmo e iss/aud — o que garante compatibilidade dos tokens.
 */
import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import { env } from '../config/env.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize, authorizeUnidade } from '../middlewares/authorize.js';

async function authPlugin(app) {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: {
      algorithm: env.JWT_ALGORITHM,
      expiresIn: env.JWT_EXPIRES_IN,
      iss: env.JWT_ISSUER,
      aud: env.JWT_AUDIENCE,
    },
    verify: {
      algorithms: [env.JWT_ALGORITHM],
      allowedIss: env.JWT_ISSUER,
      allowedAud: env.JWT_AUDIENCE,
    },
    // Cookie desabilitado: o SPA/PDV envia o token no header Authorization.
  });

  app.decorate('authenticate', authenticate);
  app.decorate('authorize', authorize);
  app.decorate('authorizeUnidade', authorizeUnidade);
}

export default fp(authPlugin, { name: 'auth', fastify: '5.x' });
