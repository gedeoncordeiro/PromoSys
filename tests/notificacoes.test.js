/**
 * Notificações (outbox → WhatsApp) — testes puros.
 *
 * Nada aqui toca banco nem rede: as regras de elegibilidade LGPD, o texto da
 * mensagem, o backoff e a classificação de falha vivem em
 * `notificacoes.regras.js`, e o cliente HTTP aceita um `fetch` injetado. Roda no
 * `npm test` sem MySQL.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTIVOS_FALHA,
  MOTIVOS_IGNORADO,
  STATUS_NOTIFICACAO,
  TEMPLATE_CREDITO_PADRAO,
  TEMPLATE_ESTORNO_PADRAO,
  TIPOS_NOTIFICACAO,
  calcularProximaTentativa,
  classificarFalha,
  consentimentoWhatsapp,
  formatarPontos,
  formatarValor,
  higienizarErro,
  mascararTelefone,
  montarMensagem,
  podeNotificar,
  primeiroNome,
  resumirProcessamento,
  telefoneValido,
} from '../src/modules/notificacoes/notificacoes.regras.js';
import { ErroProvedor, criarProvedor, provedorHttp, provedorLog } from '../src/modules/notificacoes/notificacoes.client.js';

// ---------------------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------------------

test('só telefone em E.164 completo entra na fila', () => {
  assert.equal(telefoneValido('+5511987654321'), true);
  assert.equal(telefoneValido('+551198765432'), true); // fixo de 8 dígitos
  assert.equal(telefoneValido('11987654321'), false); // sem DDI
  assert.equal(telefoneValido('+551198765'), false); // curto demais
  assert.equal(telefoneValido('+55119876543210000'), false); // longo demais
  assert.equal(telefoneValido(''), false);
  assert.equal(telefoneValido(null), false);
  assert.equal(telefoneValido(undefined), false);
  assert.equal(telefoneValido(11987654321), false); // número, não string
});

test('telefone é mascarado em log/relatório', () => {
  assert.equal(mascararTelefone('+5511987654321'), '+5511****4321');
  assert.equal(mascararTelefone('+551198765432'), '+5511****5432');
  assert.equal(mascararTelefone('123'), '****');
  assert.equal(mascararTelefone(null), '****');
});

// ---------------------------------------------------------------------------
// Consentimento LGPD
// ---------------------------------------------------------------------------

test('vale o consentimento mais recente da finalidade WHATSAPP', () => {
  const registros = [
    { id: 1, finalidade: 'WHATSAPP', versao: '1.0', aceito: 1, criado_em: '2026-01-01T10:00:00Z' },
    { id: 2, finalidade: 'MARKETING', versao: '1.0', aceito: 1, criado_em: '2026-02-01T10:00:00Z' },
    { id: 3, finalidade: 'WHATSAPP', versao: '2.0', aceito: 0, criado_em: '2026-03-01T10:00:00Z' },
  ];

  const consentimento = consentimentoWhatsapp(registros);

  assert.equal(consentimento.aceito, false, 'a revogação (mais recente) tem de vencer');
  assert.equal(consentimento.versao, '2.0');
});

test('empate de data é desempatado pelo maior id', () => {
  const mesmoInstante = '2026-03-01T10:00:00Z';
  const consentimento = consentimentoWhatsapp([
    { id: 10, finalidade: 'WHATSAPP', aceito: 0, criado_em: mesmoInstante },
    { id: 11, finalidade: 'WHATSAPP', aceito: 1, versao: '3.0', criado_em: mesmoInstante },
  ]);

  assert.equal(consentimento.aceito, true);
  assert.equal(consentimento.versao, '3.0');
});

test('sem registro de WhatsApp o cliente não tem decisão (null)', () => {
  assert.equal(consentimentoWhatsapp([]), null);
  assert.equal(
    consentimentoWhatsapp([{ id: 1, finalidade: 'MARKETING', aceito: 1, criado_em: '2026-01-01' }]),
    null,
  );
  assert.equal(consentimentoWhatsapp(), null);
});

test('elegibilidade exige canal ligado, cliente ativo, telefone e consentimento', () => {
  const clienteBase = { id: 7, nome: 'Ana', telefone: '+5511987654321', ativo: 1 };
  const consentido = [
    { id: 1, finalidade: 'WHATSAPP', versao: '1.0', aceito: 1, criado_em: '2026-01-01T00:00:00Z' },
  ];

  assert.deepEqual(
    podeNotificar({ habilitado: true, cliente: clienteBase, consentimentos: consentido }).elegivel,
    true,
  );

  assert.equal(
    podeNotificar({ habilitado: false, cliente: clienteBase, consentimentos: consentido }).motivo,
    MOTIVOS_IGNORADO.CANAL_DESABILITADO,
  );
  assert.equal(podeNotificar({ cliente: clienteBase }).motivo, MOTIVOS_IGNORADO.SEM_CONSENTIMENTO);
  assert.equal(
    podeNotificar({ cliente: { ...clienteBase, ativo: 0 }, consentimentos: consentido }).motivo,
    MOTIVOS_IGNORADO.CLIENTE_INATIVO,
  );
  assert.equal(
    podeNotificar({ cliente: { ...clienteBase, telefone: null }, consentimentos: consentido }).motivo,
    MOTIVOS_IGNORADO.SEM_TELEFONE,
  );
  assert.equal(podeNotificar({ cliente: null }).motivo, MOTIVOS_IGNORADO.CLIENTE_INATIVO);

  // Cliente inativo vence a checagem de telefone (ordem das travas explícita).
  assert.equal(
    podeNotificar({
      cliente: { ...clienteBase, ativo: 0, telefone: null },
      consentimentos: consentido,
    }).motivo,
    MOTIVOS_IGNORADO.CLIENTE_INATIVO,
  );
});

// ---------------------------------------------------------------------------
// Mensagem
// ---------------------------------------------------------------------------

test('mensagem de crédito é montada com os dados do movimento', () => {
  const mensagem = montarMensagem({
    tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
    dados: {
      clienteNome: 'Maria Aparecida Silva',
      pontos: 1234,
      saldoApos: 5678,
      valorCompra: 149.9,
      unidadeNome: 'Loja Centro',
    },
  });

  assert.equal(
    mensagem,
    'Olá, Maria! Você acumulou 1.234 pontos (saldo: 5.678). ' +
      'Compra de R$ 149,90 em Loja Centro. Obrigado por participar do PromoSys!',
  );
});

test('mensagem de estorno usa o template de estorno', () => {
  const mensagem = montarMensagem({
    tipo: TIPOS_NOTIFICACAO.PONTOS_ESTORNADOS,
    dados: { clienteNome: 'João Souza', pontos: 15, saldoApos: 0 },
    template: TEMPLATE_ESTORNO_PADRAO,
  });

  assert.equal(mensagem, 'Olá, João! O estorno de 15 pontos da sua compra foi processado. Seu saldo agora é 0 pontos.');
});

test('template é configurável e placeholder desconhecido não vira vazio', () => {
  const mensagem = montarMensagem({
    tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
    dados: { clienteNome: 'Ana', pontos: 10, saldoApos: 40 },
    template: '{primeiroNome}: +{pontos} (saldo {saldo}) em {unidade} · ref {desconhecido}',
  });

  // `{unidade}` sem valor cai no padrão "nossa loja"; `{desconhecido}` fica como está.
  assert.equal(mensagem, 'Ana: +10 (saldo 40) em nossa loja · ref {desconhecido}');
});

test('compra sem valor informado não imprime "R$ NaN"', () => {
  const mensagem = montarMensagem({
    tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
    dados: { clienteNome: 'Ana', pontos: 5, saldoApos: 5, valorCompra: null },
    template: 'vale {valor}',
  });

  assert.equal(mensagem, 'vale sua compra');
});

test('formatação pt-BR não depende do ICU do runtime', () => {
  assert.equal(formatarPontos(1234567), '1.234.567');
  assert.equal(formatarPontos(-800), '-800');
  assert.equal(formatarPontos('15'), '15');
  assert.equal(formatarPontos(null), '0');
  assert.equal(formatarValor(149.9), 'R$ 149,90');
  assert.equal(formatarValor(1000000), 'R$ 1.000.000,00');
  assert.equal(formatarValor(0), 'R$ 0,00');
  assert.equal(formatarValor(null), '');
  assert.equal(formatarValor('abc'), '');
  assert.equal(primeiroNome('  Maria Aparecida Silva '), 'Maria');
  assert.equal(primeiroNome(''), '');
  assert.equal(primeiroNome(null), '');
  // O template padrão exportado é o mesmo aplicado quando não se passa template.
  assert.equal(
    montarMensagem({ tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS, dados: {} }).startsWith('Olá, !'),
    TEMPLATE_CREDITO_PADRAO.startsWith('Olá, {primeiroNome}!'),
  );
});

// ---------------------------------------------------------------------------
// Backoff e falhas
// ---------------------------------------------------------------------------

test('backoff cresce exponencialmente e respeita o teto', () => {
  const agora = new Date('2026-10-06T12:00:00.000Z');
  const opcoes = { baseSegundos: 60, tetoSegundos: 3600 };
  const segundos = (tentativas) =>
    (calcularProximaTentativa(tentativas, agora, opcoes).getTime() - agora.getTime()) / 1000;

  assert.equal(segundos(1), 60);
  assert.equal(segundos(2), 120);
  assert.equal(segundos(3), 240);
  assert.equal(segundos(6), 1920);
  assert.equal(segundos(7), 3600, 'não passa do teto');
  assert.equal(segundos(20), 3600);
  // Entradas degeneradas não produzem datas inválidas.
  assert.equal(segundos(0), 60);
  assert.equal(segundos(Number.NaN), 60);
});

test('classificação da falha separa o que é passageiro do que é definitivo', () => {
  assert.deepEqual(classificarFalha({ status: 500 }), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.ERRO_DO_PROVEDOR,
    status: 500,
  });
  assert.deepEqual(classificarFalha({ statusCode: 503 }), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.ERRO_DO_PROVEDOR,
    status: 503,
  });
  assert.deepEqual(classificarFalha({ status: 429 }), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.LIMITE_OU_TIMEOUT,
    status: 429,
  });
  assert.deepEqual(classificarFalha({ status: 408 }), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.LIMITE_OU_TIMEOUT,
    status: 408,
  });
  assert.deepEqual(classificarFalha({ name: 'TimeoutError' }), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.SEM_RESPOSTA,
    status: null,
  });
  assert.deepEqual(classificarFalha({ name: 'AbortError' }), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.SEM_RESPOSTA,
    status: null,
  });

  // Rede caiu (fetch rejeitou sem status): vale tentar de novo.
  assert.deepEqual(classificarFalha(new TypeError('fetch failed')), {
    retentavel: true,
    motivo: MOTIVOS_FALHA.SEM_RESPOSTA,
    status: null,
  });

  // Número inexistente no provedor (400) ou credencial inválida (401): desistir.
  assert.deepEqual(classificarFalha({ status: 400 }), {
    retentavel: false,
    motivo: MOTIVOS_FALHA.REQUISICAO_REJEITADA,
    status: 400,
  });
  assert.deepEqual(classificarFalha({ status: 401 }), {
    retentavel: false,
    motivo: MOTIVOS_FALHA.REQUISICAO_REJEITADA,
    status: 401,
  });
});

test('erro guardado no banco é truncado, sem quebra de linha e sem credencial', () => {
  const segredo = 'chave-super-secreta-do-provedor';
  const erro = new Error(`401 Unauthorized apikey=${segredo}\n${'x'.repeat(600)}`);

  const texto = higienizarErro(erro, { segredos: [segredo], limite: 120 });

  assert.equal(texto.includes(segredo), false, 'a credencial não pode ir para o banco');
  assert.equal(texto.includes('\n'), false);
  assert.ok(texto.length <= 120);
  assert.ok(texto.endsWith('…'));

  // Segredo curto demais para ser único não é mascarado (evita trocar "a" por ****).
  assert.equal(higienizarErro(new Error('falha'), { segredos: ['ab'] }).includes('falha'), true);
  assert.equal(higienizarErro(null), '');
});

test('resumo da execução conta cada desfecho', () => {
  assert.deepEqual(
    resumirProcessamento([
      { status: STATUS_NOTIFICACAO.ENVIADA },
      { status: STATUS_NOTIFICACAO.FALHA },
      { status: STATUS_NOTIFICACAO.CANCELADA },
      { status: 'SIMULADO' },
      { status: 'IGNORADO' },
    ]),
    {
      analisadas: 5,
      enviadas: 1,
      reagendadas: 1,
      canceladas: 1,
      ignoradas: 1,
      simuladas: 1,
    },
  );

  assert.deepEqual(resumirProcessamento(), {
    analisadas: 0,
    enviadas: 0,
    reagendadas: 0,
    canceladas: 0,
    ignoradas: 0,
    simuladas: 0,
  });
});

// ---------------------------------------------------------------------------
// Cliente do provedor (fetch injetado — nenhuma requisição real)
// ---------------------------------------------------------------------------

/** Resposta mínima compatível com o que o cliente usa de `fetch`. */
function resposta({ status = 200, corpo = '' } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => corpo,
  };
}

test('provedor HTTP envia destino e mensagem e sinaliza sucesso', async () => {
  const chamadas = [];
  const provedor = provedorHttp({
    url: 'https://provedor.exemplo/send',
    apiKey: 'segredo-do-provedor',
    instancia: 'loja-01',
    fetchImpl: async (url, opcoes) => {
      chamadas.push({ url, opcoes });
      return resposta({ status: 201, corpo: '{"id":"abc"}' });
    },
  });

  const resultado = await provedor.enviar({
    destino: '+5511987654321',
    mensagem: 'Olá!',
    tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
  });

  assert.equal(resultado.status, 201);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://provedor.exemplo/send');
  assert.equal(chamadas[0].opcoes.method, 'POST');
  assert.equal(chamadas[0].opcoes.headers.apikey, 'segredo-do-provedor');

  const corpo = JSON.parse(chamadas[0].opcoes.body);
  assert.deepEqual(corpo, {
    canal: 'WHATSAPP',
    tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
    instancia: 'loja-01',
    destino: '+5511987654321',
    mensagem: 'Olá!',
  });
});

test('provedor HTTP converte resposta de erro em ErroProvedor com status', async () => {
  const provedor = provedorHttp({
    url: 'https://provedor.exemplo/send',
    fetchImpl: async () => resposta({ status: 500, corpo: 'erro interno\n do provedor' }),
  });

  await assert.rejects(
    () => provedor.enviar({ destino: '+5511987654321', mensagem: 'x', tipo: 'y' }),
    (erro) => {
      assert.ok(erro instanceof ErroProvedor);
      assert.equal(erro.status, 500);
      assert.equal(erro.message.includes('\n'), false, 'corpo é achatado em uma linha');
      return true;
    },
  );
});

test('timeout vira erro reconhecível como instabilidade (retentável)', async () => {
  const provedor = provedorHttp({
    url: 'https://provedor.exemplo/send',
    timeoutMs: 20,
    fetchImpl: (url, opcoes) =>
      new Promise((_resolver, rejeitar) => {
        opcoes.signal.addEventListener('abort', () => {
          const erro = new Error('aborted');
          erro.name = 'AbortError';
          rejeitar(erro);
        });
      }),
  });

  await assert.rejects(
    () => provedor.enviar({ destino: '+5511987654321', mensagem: 'x', tipo: 'y' }),
    (erro) => {
      assert.equal(erro.name, 'TimeoutError');
      assert.equal(classificarFalha(erro).retentavel, true);
      return true;
    },
  );
});

test('provedor HTTP exige URL e fetch disponíveis', () => {
  assert.throws(() => provedorHttp({ url: '' }), /WHATSAPP_API_URL/);
  assert.throws(() => provedorHttp({ url: 'https://x' , fetchImpl: null }), /fetch indisponível/);
});

test('provedor log registra a mensagem sem sair para a rede', async () => {
  const registros = [];
  const provedor = provedorLog({ registrar: (linha) => registros.push(linha) });

  const resultado = await provedor.enviar({
    destino: '+5511987654321',
    mensagem: 'Olá!',
    tipo: TIPOS_NOTIFICACAO.PONTOS_CREDITADOS,
  });

  assert.equal(resultado.status, 200);
  assert.equal(registros.length, 1);
  assert.match(registros[0], /PONTOS_CREDITADOS/);
  assert.match(registros[0], /Olá!/);
});

test('criarProvedor usa log como padrão e http quando configurado', () => {
  assert.equal(criarProvedor({}).nome, 'log');
  assert.equal(criarProvedor({ provedor: 'log' }).nome, 'log');
  assert.equal(criarProvedor({ provedor: 'http', url: 'https://x', fetchImpl: async () => resposta() }).nome, 'http');
});
