/**
 * Outbox de notificações — teste de integração.
 *
 * Exige MySQL e é habilitado por `PROMOSYS_POINT_TESTS=1` (já vem ligado em
 * `.env.test`). Roda com `npm run test:notificacoes`.
 *
 * O que este teste protege (é o que justifica o padrão outbox):
 *   ▸ o aviso nasce na MESMA transação do crédito (e não em uma segunda chamada);
 *   ▸ reenviar a NFC-e não duplica o aviso (índice único por movimento);
 *   ▸ sem consentimento LGPD de WhatsApp nada é enfileirado;
 *   ▸ falha passageira reagenda com backoff e não bloqueia as outras;
 *   ▸ erro definitivo (4xx) e tentativas esgotadas cancelam o item;
 *   ▸ o estorno também avisa (não deixa o cliente com saldo prometido na mão).
 *
 * Nenhuma requisição sai para a internet: o provedor é injetado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const habilitado = process.env.PROMOSYS_POINT_TESTS === '1';

function gerarCpf() {
  const base = String(randomBytes(4).readUInt32BE(0) % 1_000_000_000).padStart(9, '0');
  const calcularDigito = (digitos) => {
    const soma = [...digitos].reduce(
      (total, digito, indice) => total + Number(digito) * (digitos.length + 1 - indice),
      0,
    );
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const primeiro = calcularDigito(base);
  return `${base}${primeiro}${calcularDigito(`${base}${primeiro}`)}`;
}

/** Provedor de mentira: registra o que sairia e falha sob demanda. */
function provedorFalso({ falhar = null, destinoFalha = null } = {}) {
  const envios = [];

  return {
    nome: 'falso',
    envios,
    async enviar({ destino, mensagem, tipo }) {
      envios.push({ destino, mensagem, tipo });
      if (falhar && (!destinoFalha || destino === destinoFalha)) throw falhar;
      return { status: 200, resposta: 'ok' };
    },
  };
}

/** Erro de provedor com status HTTP (mesma forma do `ErroProvedor` real). */
function falha(status, detalhe = 'sem detalhe') {
  const erro = new Error(`Provedor respondeu ${status}: ${detalhe}`);
  erro.status = status;
  return erro;
}

test('outbox de notificações: do crédito ao envio', { skip: !habilitado }, async (t) => {
  const [{ db }, pontosService, notificacoes, { TIPOS_NOTIFICACAO }] = await Promise.all([
    import('../src/core/database/pool.js'),
    import('../src/modules/pontos/pontos.service.js'),
    import('../src/modules/notificacoes/notificacoes.service.js'),
    import('../src/modules/notificacoes/notificacoes.regras.js'),
  ]);

  const sufixo = randomUUID().replaceAll('-', '');
  const ids = { unidadeId: null, regraId: null, clientes: [] };

  // Configuração de teste: janela curta de backoff para não esperar em CI.
  const config = {
    ...notificacoes.configuracaoDeEnvio(),
    maxTentativas: 3,
    leaseSegundos: 30,
    backoffBaseSegundos: 5,
    backoffTetoSegundos: 60,
  };

  t.after(async () => {
    try {
      for (const clienteId of ids.clientes) {
        await db.execute('DELETE FROM notificacoes_outbox WHERE cliente_id = ?', [clienteId]);
        await db.execute(
          `DELETE FROM audit_log
            WHERE entidade = 'transacoes_pontos'
              AND entidade_id IN (SELECT id FROM transacoes_pontos WHERE cliente_id = ?)`,
          [clienteId],
        );
        await db.execute('DELETE FROM lotes_pontos WHERE cliente_id = ?', [clienteId]);
        // ESTORNO referencia o crédito original: sem apagar o estorno antes, a FK
        // `fk_transacoes_estorno` impede remover o crédito.
        await db.execute(
          'DELETE FROM transacoes_pontos WHERE cliente_id = ? AND estorno_de_transacao_id IS NOT NULL',
          [clienteId],
        );
        await db.execute('DELETE FROM transacoes_pontos WHERE cliente_id = ?', [clienteId]);
        await db.execute('DELETE FROM consentimentos WHERE cliente_id = ?', [clienteId]);
        await db.execute('DELETE FROM clientes WHERE id = ?', [clienteId]);
      }
      if (ids.regraId) await db.execute('DELETE FROM regras_pontuacao WHERE id = ?', [ids.regraId]);
      if (ids.unidadeId) await db.execute('DELETE FROM unidades WHERE id = ?', [ids.unidadeId]);
    } finally {
      await db.close();
    }
  });

  // --- Fixtures ------------------------------------------------------------
  const unidade = await db.execute(
    'INSERT INTO unidades (codigo, nome) VALUES (?, ?)',
    [`NTF${sufixo.slice(0, 17)}`, 'Loja Centro'],
  );
  ids.unidadeId = unidade.insertId;

  const regra = await db.execute(
    `INSERT INTO regras_pontuacao
       (unidade_id, nome, pontos_por_real, valor_minimo_compra, validade_pontos_dias)
     VALUES (?, ?, 1.000, 0.00, 365)`,
    [ids.unidadeId, `Regra notificação ${sufixo}`],
  );
  ids.regraId = regra.insertId;

  /** Cliente com (ou sem) telefone e com o consentimento pedido. */
  async function criarCliente({ telefone = '+5511987654321', consentimentos = [aceite] } = {}) {
    const nome = `Cliente notif ${sufixo.slice(0, 6)}`;
    const { insertId } = await db.execute(
      'INSERT INTO clientes (cpf, nome, telefone, unidade_cadastro_id) VALUES (?, ?, ?, ?)',
      [gerarCpf(), nome, telefone, ids.unidadeId],
    );
    ids.clientes.push(insertId);

    for (const consentimento of consentimentos) {
      await db.execute(
        `INSERT INTO consentimentos (cliente_id, finalidade, versao, aceito)
         VALUES (?, 'WHATSAPP', ?, ?)`,
        [insertId, consentimento.versao, consentimento.aceito],
      );
    }

    return { id: insertId, nome };
  }

  const aceite = { versao: '1.0', aceito: 1 };
  /** Aviso mais recente da fila para o cliente (ou `null`). */
  const avisoDoCliente = (clienteId) =>
    db.queryOne(
      'SELECT * FROM notificacoes_outbox WHERE cliente_id = ? ORDER BY id DESC LIMIT 1',
      [clienteId],
    );
  const contarAvisos = async (clienteId) =>
    Number(
      (
        await db.queryOne('SELECT COUNT(*) AS total FROM notificacoes_outbox WHERE cliente_id = ?', [
          clienteId,
        ])
      ).total,
    );

  // -------------------------------------------------------------------------
  await t.test('o crédito enfileira o aviso na mesma transação — e não duplica', async () => {
    const cliente = await criarCliente();
    const documentoFiscal = `NTF-${sufixo}`;

    const primeira = await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 149.9,
      documentoFiscal,
    });

    assert.equal(primeira.jaProcessado, false);
    assert.equal(primeira.notificacao.enfileirado, true, 'o aviso tem de nascer com o crédito');

    const aviso = await avisoDoCliente(cliente.id);
    assert.equal(aviso.status, 'PENDENTE');
    assert.equal(aviso.tipo, TIPOS_NOTIFICACAO.PONTOS_CREDITADOS);
    assert.equal(aviso.canal, 'WHATSAPP');
    assert.equal(aviso.destino, '+5511987654321');
    assert.equal(aviso.tentativas, 0);
    assert.equal(aviso.transacao_id, primeira.transacaoId);

    const payload = typeof aviso.payload === 'string' ? JSON.parse(aviso.payload) : aviso.payload;
    assert.equal(payload.clienteNome, cliente.nome);
    assert.equal(payload.pontos, 149);
    assert.equal(payload.valorCompra, 149.9);
    assert.equal(payload.unidadeNome, 'Loja Centro');
    assert.equal(payload.consentimentoVersao, '1.0', 'a versão do termo aceito vai junto (LGPD)');

    // Reenvio da mesma NFC-e (PDV repetiu a requisição): idempotência ponta a ponta.
    const segunda = await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 149.9,
      documentoFiscal,
    });

    assert.equal(segunda.jaProcessado, true);
    assert.equal(await contarAvisos(cliente.id), 1, 'um aviso por movimento, nunca dois');
  });

  await t.test('envio marca ENVIADA e a mensagem sai com os dados do movimento', async () => {
    const cliente = await criarCliente({ telefone: '+55119700001111' });

    await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 1234.5,
      documentoFiscal: `NTF2-${sufixo}`,
    });

    const provedor = provedorFalso();
    const execucao = await notificacoes.processarFila({ provedor, config });

    const meu = execucao.resultados.find((item) => item.tipo === TIPOS_NOTIFICACAO.PONTOS_CREDITADOS && item.destino === '+5511****1111');
    assert.ok(meu, 'o item deste cliente aparece na execução');
    assert.equal(meu.status, 'ENVIADA');
    assert.equal(meu.provedor, 'falso');

    const aviso = await avisoDoCliente(cliente.id);
    assert.equal(aviso.status, 'ENVIADA');
    assert.ok(aviso.enviada_em, 'enviada_em preenchido');
    assert.equal(aviso.ultimo_erro, null);

    const mensagem = provedor.envios.at(-1).mensagem;
    assert.match(mensagem, /^Olá, Cliente!/);
    assert.match(mensagem, /1\.234 pontos/);
    assert.match(mensagem, /R\$ 1\.234,50/);
    assert.match(mensagem, /Loja Centro/);

    // Nada mais na fila para este cliente.
    const fila = await notificacoes.situacaoDaFila({ config });
    assert.equal(fila.enviadas >= 1, true);
  });

  await t.test('sem consentimento, telefone inválido ou consentimento revogado nada é enfileirado', async () => {
    const semConsentimento = await criarCliente({ consentimentos: [] });
    const semTelefone = await criarCliente({ telefone: null });
    const revogado = await criarCliente({
      consentimentos: [aceite, { versao: '2.0', aceito: 0 }],
    });

    for (const [indice, [rotulo, cliente]] of [
      ['sem consentimento', semConsentimento],
      ['sem telefone', semTelefone],
      ['consentimento revogado', revogado],
    ].entries()) {
      const resultado = await pontosService.registrarCompra({
        clienteId: cliente.id,
        unidadeId: ids.unidadeId,
        valor: 50,
        documentoFiscal: `NTF3${indice}-${sufixo.slice(0, 20)}`,
      });

      assert.equal(resultado.notificacao.enfileirado, false, rotulo);
      assert.equal(await contarAvisos(cliente.id), 0, `${rotulo}: nenhuma linha na outbox`);
    }

    assert.equal(semConsentimento.id > 0 && semTelefone.id > 0, true);
    assert.equal(
      (await pontosService.obterSaldo(revogado.id)).pontosSaldo,
      50,
      'o crédito acontece normalmente — só o aviso é que não sai',
    );
  });

  await t.test('falha passageira reagenda com backoff e sai da fila até vencer', async () => {
    const cliente = await criarCliente({ telefone: '+55119600002222' });

    await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 30,
      documentoFiscal: `NTF3-${sufixo}`,
    });

    const antes = await avisoDoCliente(cliente.id);

    const primeira = await notificacoes.processarFila({
      provedor: provedorFalso({ falhar: falha(503, 'provedor indisponível'), destinoFalha: '+55119600002222' }),
      config,
    });

    const meu = primeira.resultados.find((item) => item.id === Number(antes.id));
    assert.equal(meu.status, 'FALHA');
    assert.equal(meu.motivo, 'ERRO_DO_PROVEDOR');
    assert.equal(meu.tentativas, 1);

    const depois = await avisoDoCliente(cliente.id);
    assert.equal(depois.status, 'FALHA');
    assert.equal(depois.tentativas, 1);
    assert.match(depois.ultimo_erro, /503/);

    // Ainda dentro do backoff: a fila não devolve o item.
    const cedo = await notificacoes.processarFila({ provedor: provedorFalso(), config });
    assert.equal(
      cedo.resultados.some((item) => item.id === Number(antes.id)),
      false,
      'o lease/backoff impede tentar de novo imediatamente',
    );

    // Vencido o backoff, o reenvio entrega.
    await db.execute(
      'UPDATE notificacoes_outbox SET proxima_tentativa_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
      [antes.id],
    );

    const reenvio = await notificacoes.processarFila({ provedor: provedorFalso(), config });
    assert.equal(reenvio.resultados.find((item) => item.id === Number(antes.id)).status, 'ENVIADA');

    const aviso = await avisoDoCliente(cliente.id);
    assert.equal(aviso.status, 'ENVIADA');
    assert.equal(aviso.tentativas, 2, 'a tentativa que falhou fica contada');
    assert.equal(aviso.ultimo_erro, null, 'sucesso limpa o erro anterior');
  });

  await t.test('erro definitivo (4xx) cancela sem ficar retentando', async () => {
    const cliente = await criarCliente({ telefone: '+55119500003333' });

    await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 40,
      documentoFiscal: `NTF4-${sufixo}`,
    });

    const antes = await avisoDoCliente(cliente.id);
    const execucao = await notificacoes.processarFila({
      provedor: provedorFalso({
        falhar: falha(400, 'número inválido para o WhatsApp'),
        destinoFalha: '+55119500003333',
      }),
      config,
    });

    const meu = execucao.resultados.find((item) => item.id === Number(antes.id));
    assert.equal(meu.status, 'CANCELADA');
    assert.equal(meu.motivo, 'REQUISICAO_REJEITADA');

    const aviso = await avisoDoCliente(cliente.id);
    assert.equal(aviso.status, 'CANCELADA');
    assert.equal(aviso.tentativas, 1, 'não insiste em erro que não vai passar');
    assert.match(aviso.ultimo_erro, /número inválido/);
  });

  await t.test('tentativas esgotadas cancelam o item', async () => {
    const cliente = await criarCliente({ telefone: '+55119400004444' });

    await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 60,
      documentoFiscal: `NTF5-${sufixo}`,
    });

    const aviso = await avisoDoCliente(cliente.id);
    const provavelFalha = provedorFalso({
      falhar: falha(500, 'instabilidade persistente'),
      destinoFalha: '+55119400004444',
    });

    for (let tentativa = 1; tentativa <= config.maxTentativas; tentativa += 1) {
      await db.execute(
        'UPDATE notificacoes_outbox SET proxima_tentativa_em = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?',
        [aviso.id],
      );

      const execucao = await notificacoes.processarFila({ provedor: provavelFalha, config });
      const meu = execucao.resultados.find((item) => item.id === Number(aviso.id));
      assert.equal(meu.tentativas, tentativa);
      assert.equal(
        meu.status,
        tentativa < config.maxTentativas ? 'FALHA' : 'CANCELADA',
        `tentativa ${tentativa}/${config.maxTentativas}`,
      );
    }

    const final = await avisoDoCliente(cliente.id);
    assert.equal(final.status, 'CANCELADA');
    assert.equal(final.tentativas, config.maxTentativas);
  });

  await t.test('estorno também avisa o cliente', async () => {
    const cliente = await criarCliente({ telefone: '+55119300005555' });

    const compra = await pontosService.registrarCompra({
      clienteId: cliente.id,
      unidadeId: ids.unidadeId,
      valor: 100,
      documentoFiscal: `NTF6-${sufixo}`,
    });

    const estorno = await pontosService.estornar({ transacaoId: compra.transacaoId, motivo: 'Devolução' });

    assert.equal(estorno.notificacao.enfileirado, true);

    const aviso = await avisoDoCliente(cliente.id);
    assert.equal(aviso.tipo, TIPOS_NOTIFICACAO.PONTOS_ESTORNADOS);
    assert.equal(aviso.destino, '+55119300005555');

    const provedor = provedorFalso();
    await notificacoes.processarFila({ provedor, config });

    const enviado = provedor.envios.find((envio) => envio.tipo === TIPOS_NOTIFICACAO.PONTOS_ESTORNADOS);
    assert.ok(enviado);
    assert.match(enviado.mensagem, /estorno de 100 pontos/i);
    assert.equal((await avisoDoCliente(cliente.id)).status, 'ENVIADA');

    assert.equal(await contarAvisos(cliente.id), 2, 'crédito e estorno: dois avisos, dois movimentos');
  });
});
