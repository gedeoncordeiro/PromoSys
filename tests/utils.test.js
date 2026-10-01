import test from 'node:test';
import assert from 'node:assert/strict';

import { ehCpfValido, formatarCpf, normalizarCpf } from '../src/utils/cpf.js';
import { paraDataIso, paraDateSql, paraIsoUtc } from '../src/utils/date.js';
import { metaPaginacao, normalizarPaginacao } from '../src/utils/pagination.js';
import { formatarTelefone, normalizarTelefone } from '../src/utils/telefone.js';

test('CPF valida, normaliza e formata documentos', async (t) => {
  await t.test('aceita CPF válido com máscara ou sem máscara', () => {
    assert.equal(ehCpfValido('529.982.247-25'), true);
    assert.equal(normalizarCpf('529.982.247-25'), '52998224725');
  });

  await t.test('rejeita documentos inválidos e sequências repetidas', () => {
    assert.equal(ehCpfValido('111.111.111-11'), false);
    assert.equal(normalizarCpf('123'), null);
  });

  await t.test('formata documentos válidos sem alterar entradas incompletas', () => {
    assert.equal(formatarCpf('52998224725'), '529.982.247-25');
    assert.equal(formatarCpf('123'), '123');
  });
});

test('telefone normaliza para E.164 e formata número brasileiro', async (t) => {
  await t.test('normaliza entrada nacional com máscara', () => {
    assert.equal(normalizarTelefone('(11) 98765-4321'), '+5511987654321');
  });

  await t.test('formata número E.164 para exibição', () => {
    assert.equal(formatarTelefone('+5511987654321'), '(11) 98765-4321');
  });

  await t.test('retorna null quando não é possível normalizar', () => {
    assert.equal(normalizarTelefone('123'), null);
  });
});

test('datas convertem para formatos ISO sem lançar em entradas inválidas', async (t) => {
  await t.test('converte datas e timestamps para ISO UTC', () => {
    const data = new Date('2026-10-01T12:34:56.000Z');
    assert.equal(paraDataIso(data), '2026-10-01');
    assert.equal(paraIsoUtc(data), '2026-10-01T12:34:56.000Z');
  });

  await t.test('converte data SQL para meia-noite UTC', () => {
    assert.equal(paraDateSql('2026-10-01').toISOString(), '2026-10-01T00:00:00.000Z');
  });

  await t.test('normaliza valores ausentes ou inválidos', () => {
    assert.equal(paraDataIso(null), null);
    assert.equal(paraIsoUtc('data-invalida'), null);
    assert.equal(paraDateSql(''), null);
  });
});

test('paginação limita entradas e produz metadados consistentes', async (t) => {
  await t.test('normaliza limite e deslocamento', () => {
    assert.deepEqual(normalizarPaginacao({ limit: 0, offset: -5 }), { limit: 20, offset: 0 });
    assert.deepEqual(normalizarPaginacao({ limit: 1000, offset: 5 }), { limit: 100, offset: 5 });
  });

  await t.test('calcula páginas e hasNext', () => {
    assert.deepEqual(metaPaginacao({ total: 25, limit: 10, offset: 10 }), {
      total: 25,
      limit: 10,
      offset: 10,
      page: 2,
      pages: 3,
      hasNext: true,
    });
  });
});