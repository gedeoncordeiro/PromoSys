/**
 * Conexão MySQL via Pool (mysql2/promise).
 *
 * ▸ Por que Pool: em varejo físico os PDVs geram picos de escrita concorrente.
 *   O Pool reaproveita conexões TCP já autenticadas (evita handshake por query),
 *   limita a concorrência (`connectionLimit`) e enfileira o excedente
 *   (`queueLimit`), protegendo o `max_connections` do servidor MySQL.
 *
 * ▸ Por que `execute` (prepared statements): o MySQL faz cache do plano de
 *   execução e os parâmetros nunca são interpolados na string SQL.
 *
 * ▸ Fuso horário: a aplicação trabalha SEMPRE em UTC. `timezone: 'Z'` no driver
 *   + `SET SESSION time_zone = '+00:00'` na conexão. A conversão para
 *   America/Sao_Paulo é responsabilidade da camada de apresentação.
 */
import mysql from 'mysql2/promise';
import { env } from '../../config/env.js';
import { logger } from '../logger.js';

/** Níveis de isolamento aceitos (whitelist evita SQL injection no SET). */
const NIVEIS_ISOLAMENTO = new Set([
  'READ UNCOMMITTED',
  'READ COMMITTED',
  'REPEATABLE READ',
  'SERIALIZABLE',
]);

const OPCOES_POOL = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,

  // --- Dimensionamento do pool -------------------------------------------
  waitForConnections: true,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  maxIdle: env.DB_MAX_IDLE,
  idleTimeout: env.DB_IDLE_TIMEOUT,
  queueLimit: env.DB_QUEUE_LIMIT, // 0 = fila ilimitada (sem erro por saturação)
  connectTimeout: env.DB_CONNECT_TIMEOUT,

  // --- Sessão / tipos ------------------------------------------------------
  charset: 'utf8mb4',
  timezone: 'Z', // datas lidas/escritas em UTC
  dateStrings: false,
  decimalNumbers: true, // DECIMAL -> number (valores monetários até 10^10)
  supportBigNumbers: true,
  bigNumberStrings: false,
  namedPlaceholders: false,
  multipleStatements: false, // hardening: bloqueia SQL empilhado
  enableKeepAlive: true,
  keepAliveInitialDelay: 10_000,
  // Cache de prepared statements por conexão (`execute`)
  maxPreparedStatements: 200,
};

class Database {
  #pool;

  constructor() {
    this.#pool = mysql.createPool(OPCOES_POOL);

    // Garante UTC em toda conexão nova, independente da config do servidor.
    this.#pool.on('connection', (conexao) => {
      conexao.query("SET SESSION time_zone = '+00:00'");
    });

    // Visibilidade de saturação: dispara quando a fila do pool está cheia.
    this.#pool.on('enqueue', () => {
      logger.warn(
        { connectionLimit: env.DB_CONNECTION_LIMIT, queueLimit: env.DB_QUEUE_LIMIT },
        'Pool de conexões saturado: requisição aguardando conexão livre',
      );
    });
  }

  /** Pool cru — use apenas quando precisar de API de baixo nível. */
  get pool() {
    return this.#pool;
  }

  /**
   * SELECT / queries que retornam linhas.
   * @param {string} sql
   * @param {unknown[]} [params]
   * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} [executor]
   *        `db` (padrão) para autocommit ou a conexão da transação em curso.
   * @returns {Promise<any[]>}
   */
  async query(sql, params = [], executor = this.#pool) {
    const [linhas] = await executor.query(sql, params);
    return linhas;
  }

  /** Retorna a primeira linha ou `null`. */
  async queryOne(sql, params = [], executor = this.#pool) {
    const linhas = await this.query(sql, params, executor);
    return linhas[0] ?? null;
  }

  /**
   * INSERT / UPDATE / DELETE via prepared statement.
   * @returns {Promise<import('mysql2').ResultSetHeader>}
   */
  async execute(sql, params = [], executor = this.#pool) {
    const [resultado] = await executor.execute(sql, params);
    return resultado;
  }

  /**
   * Executa `handler` dentro de uma transação ACID.
   * Faz commit no sucesso e rollback em qualquer exceção, liberando a conexão.
   *
   * @template T
   * @param {(conexao: import('mysql2/promise').PoolConnection) => Promise<T>} handler
   * @param {{ isolationLevel?: string }} [opcoes]
   * @returns {Promise<T>}
   */
  async withTransaction(handler, { isolationLevel = 'READ COMMITTED' } = {}) {
    const nivel = String(isolationLevel).toUpperCase();
    if (!NIVEIS_ISOLAMENTO.has(nivel)) {
      throw new Error(`Nível de isolamento inválido: ${isolationLevel}`);
    }

    const conexao = await this.#pool.getConnection();
    try {
      await conexao.query(`SET TRANSACTION ISOLATION LEVEL ${nivel}`);
      await conexao.beginTransaction();

      const resultado = await handler(conexao);

      await conexao.commit();
      return resultado;
    } catch (erro) {
      try {
        await conexao.rollback();
      } catch (erroRollback) {
        logger.error({ err: erroRollback }, 'Falha ao executar rollback da transação');
      }
      throw erro;
    } finally {
      conexao.release();
    }
  }

  /** Health check: valida que o pool consegue abrir/obter uma conexão viva. */
  async ping() {
    const conexao = await this.#pool.getConnection();
    try {
      await conexao.ping();
    } finally {
      conexao.release();
    }
  }

  /** Estatísticas do pool (útil em /health/ready e dashboards). */
  stats() {
    const interno = this.#pool.pool ?? {};
    return {
      connectionLimit: env.DB_CONNECTION_LIMIT,
      total: interno._allConnections?.length ?? 0,
      livres: interno._freeConnections?.length ?? 0,
      naFila: interno._connectionQueue?.length ?? 0,
    };
  }

  /** Encerra o pool — chamado no shutdown gracioso (hook onClose do Fastify). */
  async close() {
    await this.#pool.end();
  }
}

/** Instância única (singleton) do pool para toda a aplicação. */
export const db = new Database();

export default db;
