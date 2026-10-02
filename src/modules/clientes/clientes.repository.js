/**
 * Repositório de clientes — SQL explícito e parametrizado.
 *
 * Performance:
 *  - listagens usam índices (uk_clientes_cpf, idx_clientes_telefone,
 *    idx_clientes_nome, idx_clientes_ativo_nivel)
 *  - `LIMIT/OFFSET` recebem inteiros já validados pelo schema Zod
 *  - o nível do cliente é derivado do saldo no MESMO UPDATE (evita 2ª query)
 */
import { db } from '../../core/database/pool.js';
import { FAIXAS_NIVEL } from '../../config/constants.js';
import { formatarCpf } from '../../utils/cpf.js';
import { formatarTelefone } from '../../utils/telefone.js';
import { paraDataIso, paraIsoUtc, paraDateSql } from '../../utils/date.js';
import { padraoLike, limitOffsetSql } from '../../utils/sql.js';

/** Colunas do cliente sem JOIN — usadas dentro de transações com FOR UPDATE. */
const COLUNAS_CLIENTE_BASE = `
  c.id, c.cpf, c.nome, c.email, c.telefone, c.data_nascimento, c.cidade, c.uf,
  c.pontos_saldo, c.nivel, c.aceita_marketing, c.ativo, c.unidade_cadastro_id,
  c.ultima_visita_em, c.criado_em, c.atualizado_em
`;

const COLUNAS_CLIENTE = `${COLUNAS_CLIENTE_BASE}, un.nome AS unidade_cadastro_nome`;

const ORIGEM = 'FROM clientes c LEFT JOIN unidades un ON un.id = c.unidade_cadastro_id';

/** Colunas que o cliente da API pode alterar (whitelist anti SQL injection). */
const COLUNAS_ATUALIZAVEIS = {
  nome: 'nome',
  email: 'email',
  telefone: 'telefone',
  dataNascimento: 'data_nascimento',
  cidade: 'cidade',
  uf: 'uf',
  aceitaMarketing: 'aceita_marketing',
  ativo: 'ativo',
  unidadeCadastroId: 'unidade_cadastro_id',
};

export function buscarPorId(clienteId, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_CLIENTE} ${ORIGEM} WHERE c.id = ? LIMIT 1`,
    [clienteId],
    executor,
  );
}

export function buscarPorCpf(cpf, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_CLIENTE} ${ORIGEM} WHERE c.cpf = ? LIMIT 1`,
    [cpf],
    executor,
  );
}

/**
 * Bloqueia a linha do cliente para escrita (SELECT ... FOR UPDATE).
 * Só faz sentido DENTRO de uma transação — é o que serializa dois PDVs
 * creditando pontos para o mesmo cliente ao mesmo tempo.
 */
export function bloquearPorId(clienteId, executor) {
  return db.queryOne(
    `SELECT ${COLUNAS_CLIENTE_BASE}
       FROM clientes c
      WHERE c.id = ?
      FOR UPDATE`,
    [clienteId],
    executor,
  );
}

export async function listar({ busca, ativo, nivel, unidadeCadastroId, cidade, uf, pontosMin, pontosMax, ordenarPor, limit, offset }, executor) {
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

  if (unidadeCadastroId) {
    filtros.push('c.unidade_cadastro_id = ?');
    params.push(unidadeCadastroId);
  }

  if (cidade) {
    filtros.push('c.cidade LIKE ?');
    params.push(padraoLike(cidade));
  }

  if (uf) {
    filtros.push('c.uf = ?');
    params.push(uf);
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

  const whereSql = filtros.join(' AND ');
  const orderSql = {
    nome: 'c.nome ASC',
    saldo_desc: 'c.pontos_saldo DESC, c.nome ASC',
    saldo_asc: 'c.pontos_saldo ASC, c.nome ASC',
    visita_desc: 'c.ultima_visita_em DESC, c.nome ASC',
  }[ordenarPor ?? 'nome'];
  const [itens, total] = await Promise.all([
    db.query(
      `SELECT ${COLUNAS_CLIENTE} ${ORIGEM}
        WHERE ${whereSql}
        ORDER BY ${orderSql}
        ${limitOffsetSql(limit, offset)}`,
      params,
      executor,
    ),
    db.queryOne(
      `SELECT COUNT(*) AS total FROM clientes c WHERE ${whereSql}`,
      params,
      executor,
    ),
  ]);

  return { itens, total: total?.total ?? 0 };
}

export function inserir(dados, executor) {
  return db.execute(
    `INSERT INTO clientes
       (cpf, nome, email, telefone, data_nascimento, cidade, uf,
        aceita_marketing, unidade_cadastro_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.cpf,
      dados.nome,
      dados.email ?? null,
      dados.telefone ?? null,
      paraDateSql(dados.dataNascimento),
      dados.cidade ?? null,
      dados.uf ?? null,
      dados.aceitaMarketing ? 1 : 0,
      dados.unidadeCadastroId ?? null,
    ],
    executor,
  );
}

/** UPDATE parcial: monta o SET apenas com os campos informados. */
export function atualizar(clienteId, dados, executor) {
  const sets = [];
  const params = [];

  for (const [chave, valor] of Object.entries(dados)) {
    const coluna = COLUNAS_ATUALIZAVEIS[chave];
    if (!coluna || valor === undefined) continue;

    sets.push(`${coluna} = ?`);
    params.push(
      chave === 'dataNascimento'
        ? paraDateSql(valor)
        : chave === 'aceitaMarketing' || chave === 'ativo'
          ? valor
            ? 1
            : 0
          : valor,
    );
  }

  if (sets.length === 0) return Promise.resolve({ affectedRows: 0 });

  params.push(clienteId);

  return db.execute(
    `UPDATE clientes SET ${sets.join(', ')}, atualizado_em = UTC_TIMESTAMP(3) WHERE id = ?`,
    params,
    executor,
  );
}

export function inativar(clienteId, executor) {
  return db.execute(
    `UPDATE clientes SET ativo = 0, atualizado_em = UTC_TIMESTAMP(3) WHERE id = ?`,
    [clienteId],
    executor,
  );
}

/**
 * Aplica o delta de pontos e recalcula o nível na mesma operação.
 *
 * Cuidado com a semântica do MySQL: em um UPDATE, as atribuições são avaliadas
 * da ESQUERDA para a DIREITA e as seguintes enxergam o valor já atualizado.
 * Por isso `nivel` vem ANTES de `pontos_saldo` — assim o CASE compara com o
 * saldo ANTERIOR somado ao delta (valor final), que é o desejado.
 *
 * @param {number} delta pontos a somar (positivo) ou subtrair (negativo)
 */
export function ajustarSaldoEAtualizarNivel(clienteId, delta, executor) {
  const whens = FAIXAS_NIVEL.filter((faixa) => faixa.minimo > 0).map(
    (faixa) => `WHEN (pontos_saldo + ?) >= ${Number(faixa.minimo)} THEN '${faixa.nivel}'`,
  );

  const sql = `
    UPDATE clientes
       SET nivel = CASE ${whens.join(' ')} ELSE 'BRONZE' END,
           pontos_saldo = pontos_saldo + ?,
           atualizado_em = UTC_TIMESTAMP(3)
     WHERE id = ?`;

  const params = [...whens.map(() => delta), delta, clienteId];

  return db.execute(sql, params, executor);
}

export function registrarVisita(clienteId, executor) {
  return db.execute(
    'UPDATE clientes SET ultima_visita_em = UTC_TIMESTAMP(3) WHERE id = ?',
    [clienteId],
    executor,
  );
}

export async function existeCpf(cpf, executor) {
  const linha = await db.queryOne('SELECT 1 AS existe FROM clientes WHERE cpf = ? LIMIT 1', [cpf], executor);
  return Boolean(linha);
}

/** Linha do banco -> objeto de API (CPF e telefone formatados para exibição). */
export function mapearCliente(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    cpf: formatarCpf(linha.cpf),
    nome: linha.nome,
    email: linha.email,
    telefone: linha.telefone ? formatarTelefone(linha.telefone) : null,
    dataNascimento: paraDataIso(linha.data_nascimento),
    cidade: linha.cidade,
    uf: linha.uf,
    pontosSaldo: Number(linha.pontos_saldo),
    nivel: linha.nivel,
    aceitaMarketing: Boolean(linha.aceita_marketing),
    ativo: Boolean(linha.ativo),
    unidadeCadastroId:
      linha.unidade_cadastro_id !== null ? Number(linha.unidade_cadastro_id) : null,
    unidadeCadastroNome: linha.unidade_cadastro_nome ?? null,
    ultimaVisitaEm: paraIsoUtc(linha.ultima_visita_em),
    criadoEm: paraIsoUtc(linha.criado_em),
    atualizadoEm: paraIsoUtc(linha.atualizado_em),
  };
}
