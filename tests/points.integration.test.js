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

test('crédito concorrente com mesmo documento fiscal é idempotente', { skip: !habilitado }, async (t) => {
  const [{ db }, { registrarCompra }] = await Promise.all([
    import('../src/core/database/pool.js'),
    import('../src/modules/pontos/pontos.service.js'),
  ]);

  const ids = { unidadeId: null, clienteId: null, regraId: null };

  t.after(async () => {
    try {
      if (ids.clienteId) {
        await db.execute(
          `DELETE FROM audit_log
            WHERE entidade = 'transacoes_pontos'
              AND entidade_id IN (
                SELECT CAST(id AS CHAR) FROM transacoes_pontos WHERE cliente_id = ?
              )`,
          [ids.clienteId],
        );
        await db.execute('DELETE FROM lotes_pontos WHERE cliente_id = ?', [ids.clienteId]);
        await db.execute('DELETE FROM transacoes_pontos WHERE cliente_id = ?', [ids.clienteId]);
        await db.execute('DELETE FROM clientes WHERE id = ?', [ids.clienteId]);
      }
      if (ids.regraId) await db.execute('DELETE FROM regras_pontuacao WHERE id = ?', [ids.regraId]);
      if (ids.unidadeId) await db.execute('DELETE FROM unidades WHERE id = ?', [ids.unidadeId]);
    } finally {
      await db.close();
    }
  });

  const identificador = randomUUID().replaceAll('-', '');
  const unidade = await db.execute(
    'INSERT INTO unidades (codigo, nome) VALUES (?, ?)',
    [`TST${identificador.slice(0, 17)}`, `Teste integração ${identificador}`],
  );
  ids.unidadeId = unidade.insertId;

  const cliente = await db.execute(
    'INSERT INTO clientes (cpf, nome, unidade_cadastro_id) VALUES (?, ?, ?)',
    [gerarCpf(), `Cliente teste ${identificador}`, ids.unidadeId],
  );
  ids.clienteId = cliente.insertId;

  const regra = await db.execute(
    `INSERT INTO regras_pontuacao
       (unidade_id, nome, pontos_por_real, valor_minimo_compra, validade_pontos_dias)
     VALUES (?, ?, 1.000, 0.00, 365)`,
    [ids.unidadeId, `Regra teste ${identificador}`],
  );
  ids.regraId = regra.insertId;

  const compra = {
    clienteId: ids.clienteId,
    unidadeId: ids.unidadeId,
    valor: 15.75,
    documentoFiscal: `TESTE-${identificador}`,
  };

  const resultados = await Promise.all([
    registrarCompra(compra),
    registrarCompra(compra),
  ]);

  assert.deepEqual(
    resultados.map((resultado) => resultado.jaProcessado).sort(),
    [false, true],
  );
  assert.equal(resultados[0].transacaoId, resultados[1].transacaoId);
  assert.equal(resultados[0].pontos, 15);
  assert.equal(resultados[1].pontos, 15);

  const clienteAtual = await db.queryOne(
    'SELECT pontos_saldo FROM clientes WHERE id = ?',
    [ids.clienteId],
  );
  const transacoes = await db.queryOne(
    `SELECT COUNT(*) AS total FROM transacoes_pontos
      WHERE cliente_id = ? AND documento_fiscal = ? AND origem = 'COMPRA'`,
    [ids.clienteId, compra.documentoFiscal],
  );
  const lotes = await db.queryOne(
    'SELECT COUNT(*) AS total FROM lotes_pontos WHERE cliente_id = ?',
    [ids.clienteId],
  );

  assert.equal(Number(clienteAtual.pontos_saldo), 15);
  assert.equal(Number(transacoes.total), 1);
  assert.equal(Number(lotes.total), 1);
});