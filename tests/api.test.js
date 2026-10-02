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

  await t.test('relatório financeiro retorna resumo e página para ADMIN', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '1', perfil: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/relatorios/financeiro?de=2026-01-01&ate=2026-01-31',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(typeof resposta.json().data.resumo.vendas, 'number');
    assert.ok(Array.isArray(resposta.json().data.itens));
  });

  await t.test('resumo operacional agrega dados e status para o dashboard', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '1', perfil: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/relatorios/operacao',
      headers: { authorization: `Bearer ${token}` },
    });
    const { data } = resposta.json();

    assert.equal(resposta.statusCode, 200);
    assert.equal(typeof data.clients, 'number');
    assert.equal(typeof data.rewards, 'number');
    assert.equal(typeof data.pending, 'number');
    assert.equal(data.statusCounts.length, 4);
    assert.ok(Array.isArray(data.pendingItems));
    assert.ok(Array.isArray(data.recentItems));
  });

  await t.test('relatório por unidade retorna lista agregada para ADMIN', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '1', perfil: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/relatorios/unidades?de=2026-01-01&ate=2026-01-31',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.ok(Array.isArray(resposta.json().data));
  });

  await t.test('relatório de pontos por cliente aceita filtros validados', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '1', perfil: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/relatorios/pontos-clientes?nivel=OURO&pontosMin=500&ordenarPor=saldo_desc',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.ok(Array.isArray(resposta.json().data));
    assert.equal(typeof resposta.json().meta.total, 'number');
  });

  await t.test('operador não consulta relatório financeiro de outra unidade', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '2', perfil: 'OPERADOR', unidadeId: 1, exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '2' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/relatorios/financeiro?unidadeId=2',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 403);
    assert.equal(resposta.json().error.code, 'FORBIDDEN');
  });

  await t.test('lista de clientes aceita filtros de saldo e ordenação', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '1', perfil: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/clientes?ativo=true&nivel=OURO&pontosMin=100&pontosMax=500&ordenarPor=saldo_desc',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.ok(Array.isArray(resposta.json().data));
  });

  await t.test('busca de resgates aplica texto e período', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '1', perfil: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '1' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/resgates?status=PENDENTE&busca=kit&de=2026-01-01&ate=2026-01-31',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 200);
    assert.ok(Array.isArray(resposta.json().data));
  });

  await t.test('operador não consulta resgates de outra unidade', async () => {
    const token = app.jwt.sign(
      { typ: 'access', sub: '2', perfil: 'OPERADOR', unidadeId: 1, exp: Math.floor(Date.now() / 1000) + 600 },
      { subject: '2' },
    );
    const resposta = await app.inject({
      method: 'GET',
      url: '/api/v1/resgates?unidadeId=2',
      headers: { authorization: `Bearer ${token}` },
    });

    assert.equal(resposta.statusCode, 403);
    assert.equal(resposta.json().error.code, 'FORBIDDEN');
  });

  if (docsHabilitados) {
    await t.test('Swagger publica o documento OpenAPI', async () => {
      const resposta = await app.inject({ method: 'GET', url: '/docs/json' });

      assert.equal(resposta.statusCode, 200);
      assert.equal(resposta.json().openapi, '3.0.3');
    });
  }
});