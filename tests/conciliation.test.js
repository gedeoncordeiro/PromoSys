/**
 * Conciliação de saldos — testes.
 *
 * ▸ Bloco 1 (sempre roda, sem banco): regras puras de classificação/resumo e o
 *   leitor de flags do job.
 * ▸ Bloco 2 (integrado): exige MySQL e é habilitado por `PROMOSYS_POINT_TESTS=1`
 *   (já vem ligado em `.env.test`). Cria dois clientes com saldo propositalmente
 *   fora de sincronia — um inflado e outro defasado — e verifica que o job
 *   detecta e reconstrói o cache a partir dos lotes, com trilha no razão e na
 *   auditoria. Roda com `npm run test:conciliacao`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

import {
  classificarDivergencia,
  mapearDivergencia,
  resumirDivergencias,
  TIPOS_DIVERGENCIA,
} from '../src/modules/pontos/conciliacao.regras.js';
import { lerFlags, FlagInvalidaError } from '../src/utils/cli.js';

const habilitado = process.env.PROMOSYS_POINT_TESTS === '1';

// ---------------------------------------------------------------------------
// Regras puras
// ---------------------------------------------------------------------------

test('classificação da divergência separa saldo inflado de defasado', () => {
  assert.equal(classificarDivergencia(0), TIPOS_DIVERGENCIA.CONFORME);
  assert.equal(classificarDivergencia(-800), TIPOS_DIVERGENCIA.SALDO_INFLADO);
  assert.equal(classificarDivergencia(2450), TIPOS_DIVERGENCIA.SALDO_DEFASADO);

  // Entradas degeneradas nunca devem ser classificadas como divergência.
  assert.equal(classificarDivergencia(Number.NaN), TIPOS_DIVERGENCIA.CONFORME);
  assert.equal(classificarDivergencia(Number.POSITIVE_INFINITY), TIPOS_DIVERGENCIA.CONFORME);
});

test('resumo da conciliação soma pontos de cada lado e ignora conformes', () => {
  const resumo = resumirDivergencias([
    { diferenca: -800 },
    { diferenca: -200 },
    { diferenca: 2450 },
    { diferenca: 0 },
  ]);

  assert.deepEqual(resumo, {
    clientesDivergentes: 3,
    clientesInflados: 2,
    clientesDefasados: 1,
    pontosInflados: 1000,
    pontosDefasados: 2450,
  });

  assert.deepEqual(resumirDivergencias([]), {
    clientesDivergentes: 0,
    clientesInflados: 0,
    clientesDefasados: 0,
    pontosInflados: 0,
    pontosDefasados: 0,
  });
});

test('mapper da divergência normaliza os tipos vindos do driver MySQL', () => {
  const item = mapearDivergencia({
    cliente_id: '7',
    cpf: '12345678909',
    nome: 'Maria',
    ativo: 1,
    saldo_materializado: '900',
    saldo_lotes: '100',
    diferenca: '-800',
  });

  assert.deepEqual(item, {
    clienteId: 7,
    cpf: '123.456.789-09',
    nome: 'Maria',
    ativo: true,
    saldoMaterializado: 900,
    saldoLotes: 100,
    diferenca: -800,
    tipo: TIPOS_DIVERGENCIA.SALDO_INFLADO,
  });

  assert.equal(mapearDivergencia(null), null);
});

test('leitura de flags dos jobs valida tipo, faixa e flags desconhecidas', () => {
  const especificacao = {
    json: { tipo: 'booleana' },
    limite: { tipo: 'inteiro', padrao: 200, minimo: 1 },
    modo: { tipo: 'texto', padrao: 'relatorio' },
  };

  assert.deepEqual(lerFlags([], especificacao), { json: false, limite: 200, modo: 'relatorio' });
  assert.deepEqual(lerFlags(['--json', '--limite=500'], especificacao), {
    json: true,
    limite: 500,
    modo: 'relatorio',
  });

  assert.throws(() => lerFlags(['--corrigri'], especificacao), /Flag desconhecida/);
  assert.throws(() => lerFlags(['--corrigri'], especificacao), FlagInvalidaError);
  assert.throws(() => lerFlags(['--limite=0'], especificacao), />= 1/);
  assert.throws(() => lerFlags(['--limite=abc'], especificacao), /inteiro/);
  assert.throws(() => lerFlags(['--json=1'], especificacao), /não aceita valor/);
  assert.throws(() => lerFlags(['--modo'], especificacao), /exige um valor/);
});

// ---------------------------------------------------------------------------
// Integração (MySQL)
// ---------------------------------------------------------------------------

/** Gera um CPF válido aleatório — e único o suficiente para o banco de teste. */
function gerarCpf() {
  const base = String(randomBytes(4).readUInt32BE(0) % 1_000_000_000).padStart(9, '0');
  const digito = (digitos) => {
    const soma = [...digitos].reduce(
      (total, numero, indice) => total + Number(numero) * (digitos.length + 1 - indice),
      0,
    );
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const primeiro = digito(base);
  return `${base}${primeiro}${digito(`${base}${primeiro}`)}`;
}

test('conciliação detecta e reconstrói o saldo a partir dos lotes', { skip: !habilitado }, async (t) => {
  const LIMITE_TESTE = 500;
  const [{ db }, conciliacao, repositorio] = await Promise.all([
    import('../src/core/database/pool.js'),
    import('../src/modules/pontos/conciliacao.service.js'),
    import('../src/modules/pontos/pontos.repository.js'),
  ]);

  const identificador = randomUUID().replaceAll('-', '').slice(0, 12);
  const clientes = {
    inflado: { id: null, saldoFalso: 900, lotes: 100, nivelEsperado: 'BRONZE' },
    defasado: { id: null, saldoFalso: 50, lotes: 2500, nivelEsperado: 'OURO' },
  };

  t.after(async () => {
    try {
      for (const dados of Object.values(clientes)) {
        if (!dados.id) continue;

        await db.execute(
          "DELETE FROM audit_log WHERE entidade = 'clientes' AND entidade_id = ?",
          [String(dados.id)],
        );
        // Comparação VARCHAR x BIGINT é numérica: evita o erro de collation
        // que o MariaDB 10.4 dá ao comparar `entidade_id` com CAST(... AS CHAR).
        await db.execute(
          `DELETE FROM audit_log
            WHERE entidade = 'transacoes_pontos'
              AND entidade_id IN (
                SELECT id FROM transacoes_pontos WHERE cliente_id = ?
              )`,
          [dados.id],
        );
        await db.execute('DELETE FROM lotes_pontos WHERE cliente_id = ?', [dados.id]);
        await db.execute('DELETE FROM transacoes_pontos WHERE cliente_id = ?', [dados.id]);
        await db.execute('DELETE FROM clientes WHERE id = ?', [dados.id]);
      }
    } finally {
      await db.close();
    }
  });

  // Fotografia da base ANTES de criar as divergências deste cenário.
  const antes = await conciliacao.analisarSaldos({ limite: 1 });

  // Cenário: cache dessincronizado dos lotes nos dois sentidos.
  for (const [chave, dados] of Object.entries(clientes)) {
    const cliente = await db.execute(
      'INSERT INTO clientes (cpf, nome, pontos_saldo) VALUES (?, ?, ?)',
      [gerarCpf(), `Conciliação ${chave} ${identificador}`, dados.saldoFalso],
    );
    dados.id = cliente.insertId;

    await db.execute(
      `INSERT INTO lotes_pontos (cliente_id, transacao_id, pontos_lote, pontos_disponiveis, expira_em)
       VALUES (?, NULL, ?, ?, DATE_ADD(CURDATE(), INTERVAL 365 DAY))`,
      [dados.id, dados.lotes, dados.lotes],
    );

    assert.equal(await conciliacao.saldoEstaIntegro(dados.id), false);
  }

  const depois = await conciliacao.analisarSaldos({ limite: LIMITE_TESTE });

  assert.equal(depois.divergencias.total, antes.divergencias.total + 2);
  assert.equal(
    depois.resumo.clientesInflados - antes.resumo.clientesInflados,
    1,
    'o cliente com cache acima dos lotes deve contar como inflado',
  );
  assert.equal(
    depois.resumo.clientesDefasados - antes.resumo.clientesDefasados,
    1,
    'o cliente com cache abaixo dos lotes deve contar como defasado',
  );
  assert.equal(depois.resumo.pontosInflados - antes.resumo.pontosInflados, 800);
  assert.equal(depois.resumo.pontosDefasados - antes.resumo.pontosDefasados, 2450);

  // A listagem é paginada, mas o agregado considera a base inteira.
  assert.ok(depois.divergencias.exibidas >= 2);
  assert.ok(
    depois.divergencias.total <= LIMITE_TESTE,
    'base de teste com divergências demais para o limite deste cenário',
  );

  const correcao = await conciliacao.corrigirSaldos({ limite: LIMITE_TESTE });

  assert.equal(correcao.corrigidos.length, depois.divergencias.total);
  assert.equal(correcao.resumo.pontosInflados, depois.resumo.pontosInflados);
  assert.equal(correcao.resumo.pontosDefasados, depois.resumo.pontosDefasados);

  for (const [chave, dados] of Object.entries(clientes)) {
    const linha = await db.queryOne(
      'SELECT pontos_saldo, nivel FROM clientes WHERE id = ?',
      [dados.id],
    );

    assert.equal(await conciliacao.saldoEstaIntegro(dados.id), true, `cache de ${chave} deve voltar aos lotes`);
    assert.equal(Number(linha.pontos_saldo), dados.lotes);
    assert.equal(linha.nivel, dados.nivelEsperado, `o nível de ${chave} deve ser recalculado`);

    // Todo movimento entra no razão: a correção também.
    const ajuste = await db.queryOne(
      `SELECT tipo, origem, pontos, saldo_apos
         FROM transacoes_pontos
        WHERE cliente_id = ? AND origem = 'AJUSTE_MANUAL'
        ORDER BY id DESC LIMIT 1`,
      [dados.id],
    );

    assert.equal(ajuste.tipo, 'AJUSTE');
    assert.equal(Number(ajuste.pontos), Math.abs(dados.lotes - dados.saldoFalso));
    assert.equal(Number(ajuste.saldo_apos), dados.lotes);

    const auditoria = await db.queryOne(
      `SELECT COUNT(*) AS total FROM audit_log
        WHERE acao = 'SALDO_CONCILIADO' AND entidade = 'clientes' AND entidade_id = ?`,
      [String(dados.id)],
    );

    assert.equal(Number(auditoria.total), 1, `a correção de ${chave} deve ser auditada`);
  }

  const depoisDaCorrecao = await conciliacao.analisarSaldos({ limite: 1 });
  assert.equal(
    depoisDaCorrecao.divergencias.total,
    0,
    'depois de corrigir tudo o que estava na base, não deve sobrar divergência',
  );
  assert.ok(depoisDaCorrecao.divergencias.total < depois.divergencias.total);

  // Rodar de novo não encontra nada: a correção é idempotente.
  const segundaCorrecao = await conciliacao.corrigirSaldos({ limite: LIMITE_TESTE });
  assert.equal(segundaCorrecao.corrigidos.length, 0);

  // Reforça que o repositório expõe a soma usada como fonte da verdade.
  const soma = await repositorio.somarPontosDisponiveisDoCliente(clientes.inflado.id);
  assert.equal(Number(soma.total), clientes.inflado.lotes);
});
