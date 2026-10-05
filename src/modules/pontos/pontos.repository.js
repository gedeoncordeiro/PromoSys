/**
 * Repositório de pontos: regras de pontuação, transações, lotes (FIFO) e extrato.
 *
 * Modelo contábil adotado (padrão de mercado em fidelidade):
 *  - `transacoes_pontos` é o LIVRO RAZÃO (imutável): cada crédito/débito gera uma linha.
 *  - `lotes_pontos` é o controle de VALIDADE: cada crédito cria um lote com
 *    data de expiração; débitos consomem os lotes que vencem primeiro (FIFO).
 *  - `clientes.pontos_saldo` é um CACHE materializado do saldo
 *    (= SUM(lotes.pontos_disponiveis)), mantido na mesma transação para
 *    permitir consulta O(1) no balcão do PDV.
 *  - `saldo_apos` em cada transação dá o saldo do momento do movimento, o que
 *    torna o extrato legível sem reprocessar todo o histórico.
 */
import { db } from '../../core/database/pool.js';
import { limitOffsetSql } from '../../utils/sql.js';
import { paraDataIso, paraIsoUtc } from '../../utils/date.js';

// --- Regras de pontuação ----------------------------------------------------

/**
 * Regra vigente para a unidade, com fallback para a regra global (unidade_id NULL).
 * `(r.unidade_id IS NULL) ASC` coloca a regra da unidade na frente da global.
 */
export function buscarRegraVigente(unidadeId, executor) {
  return db.queryOne(
    `SELECT r.id,
            r.unidade_id,
            r.nome,
            r.pontos_por_real,
            r.valor_minimo_compra,
            r.validade_pontos_dias,
            r.prioridade
       FROM regras_pontuacao r
      WHERE r.ativo = 1
        AND r.vigencia_inicio <= UTC_TIMESTAMP()
        AND (r.vigencia_fim IS NULL OR r.vigencia_fim >= UTC_TIMESTAMP())
        AND (r.unidade_id = ? OR r.unidade_id IS NULL)
      ORDER BY (r.unidade_id IS NULL) ASC, r.prioridade DESC, r.vigencia_inicio DESC
      LIMIT 1`,
    [unidadeId ?? null],
    executor,
  );
}

/**
 * Calcula os pontos com aritmética DECIMAL no próprio MySQL.
 * Motivo: `valor * pontos_por_real` em ponto flutuante (JS) pode gerar dízimas
 * e o FLOOR/TRUNCATE erraria por 1 ponto. O DECIMAL do MySQL é exato.
 */
export async function calcularPontos(valor, pontosPorReal, executor) {
  const linha = await db.queryOne(
    `SELECT FLOOR(CAST(? AS DECIMAL(12,2)) * CAST(? AS DECIMAL(6,3))) AS pontos`,
    [valor, pontosPorReal],
    executor,
  );

  return Number(linha?.pontos ?? 0);
}

/** Data de expiração de um lote: hoje + validade da regra (em dias). */
export function calcularExpiracaoLote(validadeDias, executor) {
  return db.queryOne(
    `SELECT DATE_ADD(CURDATE(), INTERVAL ? DAY) AS expira_em`,
    [Number(validadeDias)],
    executor,
  );
}

// --- Transações (livro razão) -----------------------------------------------

export function inserirTransacao(dados, executor) {
  return db.execute(
    `INSERT INTO transacoes_pontos
       (cliente_id, unidade_id, usuario_id, tipo, origem, pontos, valor_compra,
        documento_fiscal, descricao, saldo_apos, estorno_de_transacao_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dados.clienteId,
      dados.unidadeId ?? null,
      dados.usuarioId ?? null,
      dados.tipo,
      dados.origem,
      dados.pontos,
      dados.valorCompra ?? null,
      dados.documentoFiscal ?? null,
      dados.descricao ?? null,
      dados.saldoApos ?? null,
      dados.estornoDeTransacaoId ?? null,
    ],
    executor,
  );
}

export function buscarTransacaoPorId(transacaoId, executor) {
  return db.queryOne(
    `SELECT id, cliente_id, unidade_id, usuario_id, tipo, origem, pontos, valor_compra,
            documento_fiscal, descricao, saldo_apos, estorno_de_transacao_id, criado_em
       FROM transacoes_pontos
      WHERE id = ?
      LIMIT 1`,
    [transacaoId],
    executor,
  );
}

/** Idempotência do crédito por documento fiscal (NFC-e/SAT) dentro da loja. */
export function buscarTransacaoPorDocumento({ unidadeId, documentoFiscal, origem }, executor) {
  return db.queryOne(
    `SELECT id, cliente_id, pontos, saldo_apos, criado_em
       FROM transacoes_pontos
      WHERE unidade_id = ?
        AND documento_fiscal = ?
        AND origem = ?
        AND tipo = 'CREDITO'
      LIMIT 1`,
    [unidadeId, documentoFiscal, origem],
    executor,
  );
}

/** Verifica se a transação original já possui estorno ativo. */
export function buscarEstornoDe(transacaoId, executor) {
  return db.queryOne(
    `SELECT id, pontos, criado_em
       FROM transacoes_pontos
      WHERE estorno_de_transacao_id = ?
      LIMIT 1`,
    [transacaoId],
    executor,
  );
}

// --- Lotes (controle de validade / FIFO) ------------------------------------

export function inserirLote({ clienteId, transacaoId, pontos, expiraEm }, executor) {
  return db.execute(
    `INSERT INTO lotes_pontos (cliente_id, transacao_id, pontos_lote, pontos_disponiveis, expira_em)
     VALUES (?, ?, ?, ?, ?)`,
    [clienteId, transacaoId ?? null, pontos, pontos, expiraEm],
    executor,
  );
}

/**
 * Lotes com saldo, do que vence primeiro para o que vence por último.
 * `FOR UPDATE` impede que dois caixas consumam o mesmo lote simultaneamente.
 */
export function listarLotesDisponiveis(clienteId, executor) {
  return db.query(
    `SELECT id, pontos_disponiveis, expira_em
       FROM lotes_pontos
      WHERE cliente_id = ? AND pontos_disponiveis > 0
      ORDER BY expira_em ASC, id ASC
      FOR UPDATE`,
    [clienteId],
    executor,
  );
}

/**
 * Debita um lote. O `AND pontos_disponiveis >= ?` é a trava de consistência:
 * se outra transação consumiu o lote antes, `affectedRows` volta 0 e o service
 * aborta com erro em vez de deixar o lote negativo.
 */
export function debitarLote(loteId, pontos, executor) {
  return db.execute(
    `UPDATE lotes_pontos
        SET pontos_disponiveis = pontos_disponiveis - ?
      WHERE id = ? AND pontos_disponiveis >= ?`,
    [pontos, loteId, pontos],
    executor,
  );
}

/** Total de pontos que expiram nos próximos N dias (aviso no PDV/app). */
export function somarLotesAVencer(clienteId, dias, executor) {
  return db.queryOne(
    `SELECT COALESCE(SUM(pontos_disponiveis), 0) AS total,
            MIN(expira_em) AS proxima_expiracao
       FROM lotes_pontos
      WHERE cliente_id = ?
        AND pontos_disponiveis > 0
        AND expira_em <= DATE_ADD(CURDATE(), INTERVAL ? DAY)`,
    [clienteId, Number(dias)],
    executor,
  );
}

/** Lotes vencidos — consumidos pelo job src/jobs/expirar-pontos.js. */
export function listarLotesVencidos(limite, executor) {
  return db.query(
    `SELECT l.id, l.cliente_id, l.transacao_id, l.pontos_disponiveis, l.expira_em
       FROM lotes_pontos l
      WHERE l.pontos_disponiveis > 0 AND l.expira_em < CURDATE()
      ORDER BY l.expira_em ASC
      LIMIT ${Number(limite)}`,
    [],
    executor,
  );
}

/** Bloqueia um lote para expiração dentro de transação. */
export function bloquearLotePorId(loteId, executor) {
  return db.queryOne(
    `SELECT id, cliente_id, transacao_id, pontos_disponiveis, expira_em
       FROM lotes_pontos
      WHERE id = ?
      FOR UPDATE`,
    [loteId],
    executor,
  );
}

// --- Conciliação de saldos (integridade do cache) ---------------------------

/**
 * `clientes.pontos_saldo` é um CACHE materializado; a fonte da verdade é
 * SUM(lotes_pontos.pontos_disponiveis). A subquery agrega os lotes por cliente
 * (uma linha por cliente, inclusive quem não tem lote — via LEFT JOIN) e o
 * WHERE deixa passar apenas as linhas em que os dois valores divergem.
 */
const CONCILIACAO_FROM = `
  FROM clientes c
  LEFT JOIN (
        SELECT cliente_id, SUM(pontos_disponiveis) AS pontos_lotes
          FROM lotes_pontos
         GROUP BY cliente_id
       ) lp ON lp.cliente_id = c.id`;

const CONCILIACAO_WHERE = 'WHERE COALESCE(lp.pontos_lotes, 0) <> c.pontos_saldo';

/**
 * Clientes com saldo dessincronizado, do maior desvio para o menor.
 * Leitura pura: nenhuma escrita acontece aqui.
 */
export function listarDivergenciasDeSaldo({ limit, offset }, executor) {
  return db.query(
    `SELECT c.id                           AS cliente_id,
            c.cpf,
            c.nome,
            c.ativo,
            c.pontos_saldo                 AS saldo_materializado,
            COALESCE(lp.pontos_lotes, 0)   AS saldo_lotes,
            COALESCE(lp.pontos_lotes, 0) - c.pontos_saldo AS diferenca
       ${CONCILIACAO_FROM}
       ${CONCILIACAO_WHERE}
      ORDER BY ABS(COALESCE(lp.pontos_lotes, 0) - c.pontos_saldo) DESC, c.id ASC
      ${limitOffsetSql(limit, offset)}`,
    [],
    executor,
  );
}

/** Total de clientes divergentes (paginado no relatório, contado exato aqui). */
export function contarDivergenciasDeSaldo(executor) {
  return db.queryOne(`SELECT COUNT(*) AS total ${CONCILIACAO_FROM} ${CONCILIACAO_WHERE}`, [], executor);
}

/**
 * Agregados da divergência em uma única consulta (evita varrer a tabela no
 * Node). `GREATEST(x, 0)` separa o que falta do que sobra em cada lado.
 */
export function resumirDivergenciasDeSaldo(executor) {
  return db.queryOne(
    `SELECT COUNT(*) AS clientes,
            COALESCE(SUM(CASE WHEN COALESCE(lp.pontos_lotes, 0) < c.pontos_saldo THEN 1 ELSE 0 END), 0) AS clientes_inflados,
            COALESCE(SUM(CASE WHEN COALESCE(lp.pontos_lotes, 0) > c.pontos_saldo THEN 1 ELSE 0 END), 0) AS clientes_defasados,
            COALESCE(SUM(GREATEST(c.pontos_saldo - COALESCE(lp.pontos_lotes, 0), 0)), 0) AS pontos_inflados,
            COALESCE(SUM(GREATEST(COALESCE(lp.pontos_lotes, 0) - c.pontos_saldo, 0)), 0) AS pontos_defasados
       ${CONCILIACAO_FROM}
       ${CONCILIACAO_WHERE}`,
    [],
    executor,
  );
}

/**
 * Lotes já vencidos e ainda com saldo — sintoma de job de expiração atrasado.
 * Não é divergência de cache: o lote continua sendo a verdade até ser expirado.
 */
export function resumirLotesVencidosPendentes(executor) {
  return db.queryOne(
    `SELECT COUNT(*) AS lotes, COALESCE(SUM(pontos_disponiveis), 0) AS pontos
       FROM lotes_pontos
      WHERE pontos_disponiveis > 0 AND expira_em < CURDATE()`,
    [],
    executor,
  );
}

/** Cabeçalho do relatório: volumes gerais do programa de fidelidade. */
export function resumirBase(executor) {
  return db.queryOne(
    `SELECT (SELECT COUNT(*) FROM clientes)                    AS clientes,
            (SELECT COUNT(*) FROM clientes WHERE ativo = 1)     AS clientes_ativos,
            (SELECT COALESCE(SUM(pontos_saldo), 0) FROM clientes) AS saldo_materializado,
            (SELECT COALESCE(SUM(pontos_disponiveis), 0) FROM lotes_pontos) AS saldo_lotes`,
    [],
    executor,
  );
}

/**
 * Soma dos lotes de um cliente — usada DENTRO da correção, já com a linha do
 * cliente bloqueada (`FOR UPDATE`). Não precisa de lock nos lotes: a ordem
 * cliente → lote adotada em todo o motor serializa as escritas concorrentes.
 */
export function somarPontosDisponiveisDoCliente(clienteId, executor) {
  return db.queryOne(
    `SELECT COALESCE(SUM(pontos_disponiveis), 0) AS total
       FROM lotes_pontos
      WHERE cliente_id = ?`,
    [clienteId],
    executor,
  );
}

// --- Extrato ---------------------------------------------------------------

export async function listarExtrato({ clienteId, tipo, origem, de, ate, limit, offset }, executor) {
  const filtros = ['t.cliente_id = ?'];
  const params = [clienteId];

  if (tipo) {
    filtros.push('t.tipo = ?');
    params.push(tipo);
  }
  if (origem) {
    filtros.push('t.origem = ?');
    params.push(origem);
  }
  if (de) {
    filtros.push('t.criado_em >= ?');
    params.push(`${de} 00:00:00`);
  }
  if (ate) {
    filtros.push('t.criado_em <= ?');
    params.push(`${ate} 23:59:59`);
  }

  const whereSql = filtros.join(' AND ');

  const [itens, total] = await Promise.all([
    db.query(
      `SELECT t.id, t.cliente_id, t.unidade_id, t.usuario_id, t.tipo, t.origem, t.pontos,
              t.valor_compra, t.documento_fiscal, t.descricao, t.saldo_apos,
              t.estorno_de_transacao_id, t.criado_em,
              u.nome AS unidade_nome
         FROM transacoes_pontos t
         LEFT JOIN unidades u ON u.id = t.unidade_id
        WHERE ${whereSql}
        ORDER BY t.criado_em DESC, t.id DESC
        ${limitOffsetSql(limit, offset)}`,
      params,
      executor,
    ),
    db.queryOne(
      `SELECT COUNT(*) AS total FROM transacoes_pontos t WHERE ${whereSql}`,
      params,
      executor,
    ),
  ]);

  return { itens, total: total?.total ?? 0 };
}

// --- Mappers ---------------------------------------------------------------

export function mapearTransacao(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    clienteId: Number(linha.cliente_id),
    unidadeId: linha.unidade_id !== null ? Number(linha.unidade_id) : null,
    unidadeNome: linha.unidade_nome ?? null,
    usuarioId: linha.usuario_id !== null ? Number(linha.usuario_id) : null,
    tipo: linha.tipo,
    origem: linha.origem,
    pontos: Number(linha.pontos),
    valorCompra: linha.valor_compra !== null ? Number(linha.valor_compra) : null,
    documentoFiscal: linha.documento_fiscal,
    descricao: linha.descricao,
    saldoApos: linha.saldo_apos !== null ? Number(linha.saldo_apos) : null,
    estornoDeTransacaoId:
      linha.estorno_de_transacao_id !== null ? Number(linha.estorno_de_transacao_id) : null,
    criadoEm: paraIsoUtc(linha.criado_em),
  };
}

export function mapearLote(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    pontosDisponiveis: Number(linha.pontos_disponiveis),
    expiraEm: paraDataIso(linha.expira_em),
  };
}

export function mapearRegra(linha) {
  if (!linha) return null;

  return {
    id: Number(linha.id),
    unidadeId: linha.unidade_id !== null ? Number(linha.unidade_id) : null,
    nome: linha.nome,
    pontosPorReal: Number(linha.pontos_por_real),
    valorMinimoCompra: Number(linha.valor_minimo_compra),
    validadePontosDias: Number(linha.validade_pontos_dias),
  };
}
