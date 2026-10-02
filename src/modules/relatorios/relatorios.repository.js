import { db } from '../../core/database/pool.js';
import { limitOffsetSql, padraoLike } from '../../utils/sql.js';

const COLUNAS_RESGATE_RESUMO = `
  g.id, g.codigo, g.cliente_id, g.recompensa_id, g.unidade_id, g.usuario_id, g.transacao_id,
  g.pontos_debitados, g.saldo_apos, g.status, g.retirado_em, g.criado_em,
  c.nome AS cliente_nome, rc.nome AS recompensa_nome, un.nome AS unidade_nome
`;

const ORIGEM_RESGATE_RESUMO = `
  FROM resgates g
  INNER JOIN clientes c ON c.id = g.cliente_id
  INNER JOIN recompensas rc ON rc.id = g.recompensa_id
  LEFT JOIN unidades un ON un.id = g.unidade_id
`;

export async function obterResumoOperacional(unidadeId) {
  const unidadeClienteSql = unidadeId ? 'WHERE unidade_cadastro_id = ?' : '';
  const resumoParams = unidadeId ? [unidadeId] : [];
  const unidadeResgateSql = unidadeId ? 'WHERE unidade_id = ?' : '';
  const resgateParams = unidadeId ? [unidadeId] : [];

  const [totais, status, pendentes, recentes] = await Promise.all([
    db.queryOne(
      `SELECT
         (SELECT COUNT(*) FROM clientes ${unidadeClienteSql}) AS clientes,
         (SELECT COUNT(*) FROM recompensas r
           WHERE r.ativo = 1
             AND (r.vigencia_inicio IS NULL OR r.vigencia_inicio <= UTC_TIMESTAMP())
             AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= UTC_TIMESTAMP())) AS recompensas`,
      resumoParams,
    ),
    db.query(
      `SELECT status, COUNT(*) AS total FROM resgates ${unidadeResgateSql} GROUP BY status`,
      resgateParams,
    ),
    db.query(
      `SELECT ${COLUNAS_RESGATE_RESUMO} ${ORIGEM_RESGATE_RESUMO}
        ${unidadeResgateSql ? `${unidadeResgateSql} AND g.status = 'PENDENTE'` : "WHERE g.status = 'PENDENTE'"}
        ORDER BY g.criado_em DESC, g.id DESC
        LIMIT 5`,
      resgateParams,
    ),
    db.query(
      `SELECT ${COLUNAS_RESGATE_RESUMO} ${ORIGEM_RESGATE_RESUMO}
        ${unidadeResgateSql ? unidadeResgateSql.replace('unidade_id', 'g.unidade_id') : ''}
        ORDER BY g.criado_em DESC, g.id DESC
        LIMIT 6`,
      resgateParams,
    ),
  ]);

  return { totais, status, pendentes, recentes };
}

function montarFiltrosTransacoes({ de, ate, unidadeId, busca, tipo, origem }) {
  const filtros = ['1 = 1'];
  const params = [];

  if (de) {
    filtros.push('t.criado_em >= ?');
    params.push(`${de} 00:00:00`);
  }
  if (ate) {
    filtros.push('t.criado_em <= ?');
    params.push(`${ate} 23:59:59`);
  }
  if (unidadeId) {
    filtros.push('t.unidade_id = ?');
    params.push(unidadeId);
  }
  if (tipo) {
    filtros.push('t.tipo = ?');
    params.push(tipo);
  }
  if (origem) {
    filtros.push('t.origem = ?');
    params.push(origem);
  }
  if (busca) {
    filtros.push('(c.nome LIKE ? OR c.cpf LIKE ? OR t.documento_fiscal LIKE ?)');
    const termo = padraoLike(busca);
    params.push(termo, termo, termo);
  }

  return { whereSql: filtros.join(' AND '), params };
}

export async function listarFinanceiro(filtros) {
  const { limit, offset } = filtros;
  const { whereSql, params } = montarFiltrosTransacoes(filtros);
  const [itens, total, resumo] = await Promise.all([
    db.query(
      `SELECT t.id, t.cliente_id, c.nome AS cliente_nome, t.unidade_id, u.nome AS unidade_nome,
              t.usuario_id, t.tipo, t.origem, t.pontos, t.valor_compra, t.documento_fiscal,
              t.descricao, t.saldo_apos, t.estorno_de_transacao_id, t.criado_em
         FROM transacoes_pontos t
         JOIN clientes c ON c.id = t.cliente_id
         LEFT JOIN unidades u ON u.id = t.unidade_id
        WHERE ${whereSql}
        ORDER BY t.criado_em DESC, t.id DESC
        ${limitOffsetSql(limit, offset)}`,
      params,
    ),
    db.queryOne(
      `SELECT COUNT(*) AS total FROM transacoes_pontos t
         JOIN clientes c ON c.id = t.cliente_id
        WHERE ${whereSql}`,
      params,
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(CASE WHEN t.origem = 'COMPRA' AND t.tipo = 'CREDITO' THEN t.valor_compra ELSE 0 END), 0) AS vendas,
              COALESCE(SUM(CASE WHEN t.origem = 'COMPRA' AND t.tipo = 'CREDITO' THEN t.pontos ELSE 0 END), 0) AS pontos_compra,
              COALESCE(SUM(CASE WHEN t.tipo = 'CREDITO' THEN t.pontos ELSE 0 END), 0) AS pontos_creditados,
              COUNT(*) AS transacoes
         FROM transacoes_pontos t
         JOIN clientes c ON c.id = t.cliente_id
        WHERE ${whereSql}`,
      params,
    ),
  ]);

  return { itens, total: Number(total?.total ?? 0), resumo };
}

export async function listarUnidades({ de, ate, unidadeId }) {
  const filtros = ['u.ativo = 1'];
  const transacaoParams = [];
  const cadastroParams = [];
  const unidadeParams = [];
  if (unidadeId) {
    filtros.push('u.id = ?');
    unidadeParams.push(unidadeId);
  }
  const transacaoDatas = [];
  const cadastroDatas = [];
  if (de) {
    transacaoDatas.push('t.criado_em >= ?');
    cadastroDatas.push('c.criado_em >= ?');
    transacaoParams.push(`${de} 00:00:00`);
    cadastroParams.push(`${de} 00:00:00`);
  }
  if (ate) {
    transacaoDatas.push('t.criado_em <= ?');
    cadastroDatas.push('c.criado_em <= ?');
    transacaoParams.push(`${ate} 23:59:59`);
    cadastroParams.push(`${ate} 23:59:59`);
  }

  const unidadeWhere = filtros.join(' AND ');
  const transactionWhere = transacaoDatas.length ? `WHERE ${transacaoDatas.join(' AND ')}` : '';
  const clientWhere = cadastroDatas.length ? `WHERE ${cadastroDatas.join(' AND ')}` : '';
  const rows = await db.query(
      `SELECT u.id, u.codigo, u.nome, u.cidade, u.uf,
              COALESCE(t.vendas, 0) AS vendas,
              COALESCE(t.pontos_compra, 0) AS pontos_compra,
              COALESCE(t.transacoes, 0) AS transacoes,
              COALESCE(c.novos_clientes, 0) AS novos_clientes
         FROM unidades u
         LEFT JOIN (
           SELECT t.unidade_id,
                  SUM(CASE WHEN t.origem = 'COMPRA' AND t.tipo = 'CREDITO' THEN t.valor_compra ELSE 0 END) AS vendas,
                  SUM(CASE WHEN t.origem = 'COMPRA' AND t.tipo = 'CREDITO' THEN t.pontos ELSE 0 END) AS pontos_compra,
                  COUNT(*) AS transacoes
             FROM transacoes_pontos t ${transactionWhere}
            GROUP BY t.unidade_id
         ) t ON t.unidade_id = u.id
         LEFT JOIN (
           SELECT c.unidade_cadastro_id, COUNT(*) AS novos_clientes
             FROM clientes c ${clientWhere}
            GROUP BY c.unidade_cadastro_id
         ) c ON c.unidade_cadastro_id = u.id
        WHERE ${unidadeWhere}
        ORDER BY vendas DESC, u.nome ASC`,
      [...transacaoParams, ...cadastroParams, ...unidadeParams],
    );

  return { rows };
}

export async function listarPontosClientes({ busca, nivel, ativo, pontosMin, pontosMax, ordenarPor, unidadeId, limit, offset }) {
  const filtros = ['1 = 1'];
  const params = [];
  if (ativo !== undefined) {
    filtros.push('c.ativo = ?');
    params.push(ativo ? 1 : 0);
  }
  if (nivel) {
    filtros.push('c.nivel = ?');
    params.push(nivel);
  }
  if (unidadeId) {
    filtros.push('c.unidade_cadastro_id = ?');
    params.push(unidadeId);
  }
  if (pontosMin !== undefined) {
    filtros.push('c.pontos_saldo >= ?');
    params.push(pontosMin);
  }
  if (pontosMax !== undefined) {
    filtros.push('c.pontos_saldo <= ?');
    params.push(pontosMax);
  }
  if (busca) {
    filtros.push('(c.nome LIKE ? OR c.cpf LIKE ? OR c.telefone LIKE ?)');
    const termo = padraoLike(busca);
    params.push(termo, termo, termo);
  }

  const orderSql = {
    saldo_desc: 'c.pontos_saldo DESC, c.nome ASC',
    saldo_asc: 'c.pontos_saldo ASC, c.nome ASC',
    nome: 'c.nome ASC',
  }[ordenarPor];
  const whereSql = filtros.join(' AND ');
  const [itens, total] = await Promise.all([
    db.query(
      `SELECT c.*, u.nome AS unidade_cadastro_nome
         FROM clientes c
         LEFT JOIN unidades u ON u.id = c.unidade_cadastro_id
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        ${limitOffsetSql(limit, offset)}`,
      params,
    ),
    db.queryOne(`SELECT COUNT(*) AS total FROM clientes c WHERE ${whereSql}`, params),
  ]);
  return { itens, total: Number(total?.total ?? 0) };
}
