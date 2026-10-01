/** Cria o database configurado sem selecionar schema na conexão inicial. */
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const NOME_DATABASE_VALIDO = /^[A-Za-z0-9_]{1,64}$/;
const DATABASES_RESERVADOS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

async function criarDatabase() {
  if (
    !NOME_DATABASE_VALIDO.test(env.DB_NAME) ||
    DATABASES_RESERVADOS.has(env.DB_NAME.toLowerCase())
  ) {
    throw new Error('DB_NAME deve ser um identificador válido e não reservado do MySQL.');
  }

  const conexao = await mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectTimeout: env.DB_CONNECT_TIMEOUT,
  });

  try {
    await conexao.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    process.stdout.write(`Database "${env.DB_NAME}" pronto.\n`);
  } finally {
    await conexao.end();
  }
}

criarDatabase().catch((erro) => {
  process.stderr.write(`Falha ao criar database: ${erro.message}\n`);
  process.exitCode = 1;
});