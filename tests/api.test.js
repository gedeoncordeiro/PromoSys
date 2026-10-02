import test from 'node:test';
import assert from 'node:assert/strict';

const habilitado = process.env.PROMOSYS_API_TESTS === '1';
const docsHabilitados = ['true', '1'].includes(process.env.ENABLE_DOCS);

test('contratos HTTP básicos da API', { skip: !habilitado }, async (t) => {
  const { buildApp } = await import('../src/app.js');
  const { db } = await import('../src/core/database/pool.js');
  const app = await buildApp({ logger: false });

  await app.ready();
  t.after(async () => {
    await app.close();
    await db.close();
  });

  await t.test('liveness retorna status saudável', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().data.status, 'ok');
  });

  await t.test('rota inexistente usa o contrato JSON de erro', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/rota-inexistente' });
    const corpo = resposta.json();

    assert.equal(resposta.statusCode, 404);
    assert.equal(corpo.error.code, 'ROUTE_NOT_FOUND');
    assert.ok(corpo.requestId);
  });

  await t.test('payload inválido de login retorna 422', async () => {
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { identificador: 'x', senha: 'x' },
    });

    assert.equal(resposta.statusCode, 422);
    assert.equal(resposta.json().error.code, 'VALIDATION_ERROR');
  });

  await t.test('rota protegida sem JWT retorna 401', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.json().error.code, 'UNAUTHORIZED');
  });

  await t.test('rejeita refresh token em rota que exige access token', async () => {
    const token = app.jwt.sign({ typ: 'refresh' }, { subject: '1' });
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.json().error.code, 'UNAUTHORIZED');
  });

  await t.test('rejeita access token expirado', async () => {
    const expiradoEm = Math.floor(Date.now() / 1000) - 1;
    const token = app.jwt.sign(
      { typ: 'access', perfil: 'ADMIN', exp: expiradoEm },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.json().error.code, 'UNAUTHORIZED');
  });

  await t.test('perfil sem permissão é rejeitado em rota de escrita', async () => {
    const token = app.jwt.sign(
      {
        typ: 'access',
        sub: '2',
        perfil: 'OPERADOR',
        unidadeId: 1,
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      { subject: '2' },
    );
    const resposta = await app.inject({
      method: 'PATCH',
      url: '/api/v1/clientes/1',
      headers: { authorization: `Bearer ${token}` },
      payload: { nome: 'Cliente bloqueado' },
    });

    assert.equal(resposta.statusCode, 403);
    assert.equal(resposta.json().error.code, 'FORBIDDEN');
  });

  await t.test('operador precisa operar na unidade correta', async () => {
    const token = app.jwt.sign(
      {
        typ: 'access',
        sub: '2',
        perfil: 'OPERADOR',
        unidadeId: 1,
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      { subject: '2' },
    );
    const resposta = await app.inject({
      method: 'POST',
      url: '/api/v1/recompensas/1/resgates',
      headers: { authorization: `Bearer ${token}` },
      payload: { clienteId: 1, unidadeId: 2 },
    });

    assert.equal(resposta.statusCode, 403);
    assert.equal(resposta.json().error.code, 'FORBIDDEN');
  });

  await t.test('exporta clientes em CSV para perfis autorizados', async () => {
    const token = app.jwt.sign(
      {
        typ: 'access',
        sub: '1',
        perfil: 'ADMIN',
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/clientes/export',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.match(resposta.headers['content-type'], /text\/csv/i);
    assert.match(resposta.body, /nome,cpf,email/i);
  });

  if (docsHabilitados) {
    await t.test('Swagger publica o documento OpenAPI', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/docs/json' });

      assert.equal(resposta.statusCode, 200);
      assert.equal(resposta.json().openapi, '3.0.3');
    });
  }
});