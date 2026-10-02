/**
 * Repositório de recompensas e resgates.
 *
 * Concorrência:
 *  - `bloquearPorId` (FOR UPDATE) serializa resgates da mesma recompensa,
 *    evitando que o estoque fique negativo em campanhas concorridas.
 *  - `baixarEstoque` usa `WHERE estoque >= ?` como trava adicional.
 */
import { db } from '../../core/database/pool.js';
import { limitOffsetSql, padraoLike } from '../../utils/sql.js';
import { paraDataIso, paraDateSql, paraIsoUtc } from '../../utils/date.js';

const COLUNAS_RECOMPENSA = `
  r.id, r.sku, r.nome, r.descricao, r.tipo, r.pontos_custo, r.valor_referencia,
  r.estoque, r.limite_por_cliente, r.vigencia_inicio, r.vigencia_fim, r.imagem_url,
  r.ativo, r.criado_em, r.atualizado_em
`;

const COLUNAS_ATUALIZAVEIS = {
  sku: 'sku',
  nome: 'nome',
  descricao: 'descricao',
  tipo: 'tipo',
  pontosCusto: 'pontos_custo',
  valorReferencia: 'valor_referencia',
  estoque: 'estoque',
  limitePorCliente: 'limite_por_cliente',
  vigenciaInicio: 'vigencia_inicio',
  vigenciaFim: 'vigencia_fim',
  imagemUrl: 'imagem_url',
  ativo: 'ativo',
};

const COLUNAS_RESGATE = `
  g.id, g.codigo, g.cliente_id, g.recompensa_id, g.unidade_id, g.usuario_id, g.transacao_id,
  g.pontos_debitados, g.saldo_apos, g.status, g.retirado_em, g.criado_em,
  c.nome AS cliente_nome, rc.nome AS recompensa_nome, un.nome AS unidade_nome
`;

const ORIGEM_RESGATE = `
  FROM resgates g
  INNER JOIN clientes c ON c.id = g.cliente_id
  INNER JOIN recompensas rc ON rc.id = g.recompensa_id
  LEFT JOIN unidades un ON un.id = g.unidade_id
`;

// --- Catálogo ---------------------------------------------------------------

export function buscarPorId(recompensaId, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_RECOMPENSA} FROM recompensas r WHERE r.id = ? LIMIT 1`,
    [recompensaId],
    executor,
  );
}

/** Bloqueia a recompensa para leitura+escrita (estoque) dentro de transação. */
export function bloquearPorId(recompensaId, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_RECOMPENSA} FROM recompensas r WHERE r.id = ? FOR UPDATE`,
    [recompensaId],
    executor,
  );
}

export async function listar(
  { busca, tipo, pontosMaximos, apenasVigentes, limit, offset },
  executor,
) {
  const filtros = [];
  const params = [];

  if (apenasVigentes) {
    filtros.push('r.ativo = 1');
    filtros.push('(r.vigencia_inicio IS NULL OR r.vigencia_inicio <= UTC_TIMESTAMP())');
    filtros.push('(r.vigencia_fim IS NULL OR r.vigencia_fim >= UTC_TIMESTAMP())');
  }

  if (tipo) {
    filtros.push('r.tipo = ?');
    params.push(tipo);
  }

  if (pontosMaximos) {
    filtros.push('r.pontos_custo <= ?');
    params.push(pontosMaximos);
  }

  if (busca) {
    filtros.push('(r.nome LIKE ? OR r.sku LIKE ?)');
    const termo = padraoLike(busca);
    params.push(termo, termo);
  }

  const whereSql = filtros.length > 0 ? filtros.join(' AND ') : '1 = 1';

  const [itens, total] = await Promise.all([
    db.query(
      `SELECT ${COLUNAS_RECOMPENSA} FROM recompensas r
        WHERE ${whereSql}
        ORDER BY r.pontos_custo ASC, r.nome ASC
        ${limitOffsetSql(limit, offset)}`,
      params,
      executor,
    ),
    db.queryOne(`SELECT COUNT(*) AS total FROM recompensas r WHERE ${whereSql}`, params, executor),
  ]);

  return { itens, total: total?.total ?? 0 };
}

export function inserir(dados, executor) {
  return db.execute(
    `INSERT INTO recompensas
       (sku, nome, descricao, tipo, pontos_custo, valor_referencia, estoque,
        limite_por_cliente, vigencia_inicio, vigencia_fim, imagem_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.sku,
      dados.nome,
      dados.descricao ?? null,
      dados.tipo,
      dados.pontosCusto,
      dados.valorReferencia ?? null,
      dados.estoque ?? null,
      dados.limitePorCliente ?? null,
      paraDateSql(dados.vigenciaInicio) ?? null,
      paraDateSql(dados.vigenciaFim) ?? null,
      dados.imagemUrl ?? null,
    ],
    executor,
  );
}

export function atualizar(recompensaId, dados, executor) {
  const sets = [];
  const params = [];

  for (const [chave, valor] of Object.entries(dados)) {
    const coluna = COLUNAS_ATUALIZAVEIS[chave];
    if (!coluna || valor === undefined) continue;

    sets.push(`${coluna} = ?`);

    if (chave === 'vigenciaInicio' || chave === 'vigenciaFim') {
      params.push(paraDateSql(valor) ?? null);
    } else if (chave === 'ativo') {
      params.push(valor ? 1 : 0);
    } else {
      params.push(valor);
    }
  }

  if (sets.length === 0) return Promise.resolve({ affectedRows: 0 });

  params.push(recompensaId);

  return db.execute(
    `UPDATE recompensas SET ${sets.join(', ')}, atualizado_em = UTC_TIMESTAMP(3) WHERE id = ?`,
    params,
    executor,
  );
}

/** Baixa de estoque atômica: só decrementa se houver saldo suficiente. */
export function baixarEstoque(recompensaId, quantidade, executor) {
  return db.execute(
    `UPDATE recompensas
        SET estoque = estoque - ?
      WHERE id = ? AND estoque IS NOT NULL AND estoque >= ?`,
    [quantidade, recompensaId, quantidade],
    executor,
  );
}

// --- Resgates ---------------------------------------------------------------

export function inserirResgate(dados, executor) {
  return db.execute(
    `INSERT INTO resgates
       (codigo, cliente_id, recompensa_id, unidade_id, usuario_id, transacao_id,
        pontos_debitados, saldo_apos, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.codigo,
      dados.clienteId,
      dados.recompensaId,
      dados.unidadeId ?? null,
      dados.usuarioId ?? null,
      dados.transacaoId ?? null,
      dados.pontosDebitados,
      dados.saldoApos ?? null,
      dados.status,
    ],
    executor,
  );
}

export function buscarResgatePorId(resgateId, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_RESGATE} ${ORIGEM_RESGATE} WHERE g.id = ? LIMIT 1`,
    [resgateId],
    executor,
  );
}

export function contarResgatesDoCliente(clienteId, recompensaId, executor) {
  return db.queryOne(
    `SELECT COUNT(*) AS total
       FROM resgates
      WHERE cliente_id = ? AND recompensa_id = ? AND status <> 'CANCELADO'`,
    [clienteId, recompensaId],
    executor,
  );
}

export async function listarResgates({ clienteId, unidadeId, status, busca, de, ate, limit, offset }, executor) {
  const filtros = [];
  const params = [];

  if (clienteId) {
    filtros.push('g.cliente_id = ?');
    params.push(clienteId);
  }
  if (unidadeId) {
    filtros.push('g.unidade_id = ?');
    params.push(unidadeId);
  }
  if (status) {
    filtros.push('g.status = ?');
    params.push(status);
  }
  if (busca) {
    filtros.push('(g.codigo LIKE ? OR c.nome LIKE ? OR c.cpf LIKE ? OR rc.nome LIKE ?)');
    const termo = padraoLike(busca);
    params.push(termo, termo, termo, termo);
  }
  if (de) {
    filtros.push('g.criado_em >= ?');
    params.push(`${de} 00:00:00`);
  }
  if (ate) {
    filtros.push('g.criado_em <= ?');
    params.push(`${ate} 23:59:59`);
  }
  const whereSql = filtros.length > 0 ? filtros.join(' AND ') : '1 = 1';

  const [itens, total] = await Promise.all([
    db.query(
      `SELECT ${COLUNAS_RESGATE} ${ORIGEM_RESGATE}
        WHERE ${whereSql}
        ORDER BY g.criado_em DESC, g.id DESC
        ${limitOffsetSql(limit, offset)}`,
      params,
      executor,
    ),
    db.queryOne(`SELECT COUNT(*) AS total ${ORIGEM_RESGATE} WHERE ${whereSql}`, params, executor),
  ]);

  return { itens, total: total?.total ?? 0 };
}

/** Marca o resgate como retirado. Idempotente: só afeta status PENDENTE. */
export function confirmarRetirada(resgateId, executor) {
  return db.execute(
    `UPDATE resgates
        SET status = 'ENTREGUE', retirado_em = UTC_TIMESTAMP(3)
      WHERE id = ? AND status = 'PENDENTE'`,
    [resgateId],
    executor,
  );
}

// --- Mappers ---------------------------------------------------------------

export function mapearRecompensa(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    sku: linha.sku,
    nome: linha.nome,
    descricao: linha.descricao,
    tipo: linha.tipo,
    pontosCusto: Number(linha.pontos_custo),
    valorReferencia: linha.valor_referencia !== null ? Number(linha.valor_referencia) : null,
    estoque: linha.estoque !== null ? Number(linha.estoque) : null,
    limitePorCliente:
      linha.limite_por_cliente !== null ? Number(linha.limite_por_cliente) : null,
    vigenciaInicio: paraDataIso(linha.vigencia_inicio),
    vigenciaFim: paraDataIso(linha.vigencia_fim),
    imagemUrl: linha.imagem_url,
    ativo: Boolean(linha.ativo),
    criadoEm: paraIsoUtc(linha.criado_em),
    atualizadoEm: paraIsoUtc(linha.atualizado_em),
  };
}

export function mapearResgate(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    codigo: linha.codigo,
    clienteId: Number(linha.cliente_id),
    clienteNome: linha.cliente_nome ?? null,
    recompensaId: Number(linha.recompensa_id),
    recompensaNome: linha.recompensa_nome ?? null,
    unidadeId: linha.unidade_id !== null ? Number(linha.unidade_id) : null,
    unidadeNome: linha.unidade_nome ?? null,
    usuarioId: linha.usuario_id !== null ? Number(linha.usuario_id) : null,
    transacaoId: linha.transacao_id !== null ? Number(linha.transacao_id) : null,
    pontosDebitados: Number(linha.pontos_debitados),
    saldoApos: linha.saldo_apos !== null ? Number(linha.saldo_apos) : null,
    status: linha.status,
    retiradoEm: paraIsoUtc(linha.retirado_em),
    criadoEm: paraIsoUtc(linha.criado_em),
  };
}
