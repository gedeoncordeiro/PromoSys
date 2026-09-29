/**
 * Runner de migrações SQL.
 *
 *   npm run migrate
 *
 * Como funciona:
 *   - lê `src/database/migrations/*.sql` em ordem alfabética (por isso o
 *     prefixo numérico: 001_, 002_, ...)
 *   - registra cada arquivo aplicado na tabela `_migrations` com checksum
 *     SHA-256 (detecta migração alterada depois de aplicada)
 *   - executa os arquivos com `multipleStatements` numa conexão dedicada —
 *     o pool da aplicação permanece com multipleStatements DESLIGADO
 *     (proteção contra SQL empilhado em queries de negócio)
 *
 * Observação: DDL no MySQL provoca commit implícito, então migrações não são
 * transacionais. Mantenha uma mudança lógica por arquivo.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const DIRETORIO_ATUAL = path.dirname(fileURLToPath(import.meta.url));
const PASTA_MIGRATIONS = path.join(DIRETORIO_ATUAL, 'migrations');

async function abrirConexaoAdministrativa() {
  return mysql.createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
    connectTimeout: env.DB_CONNECT_TIMEOUT,
  });
}

async function garantirTabelaDeControle(conexao) {
  await conexao.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
      nome         VARCHAR(255) NOT NULL,
      checksum     CHAR(64)     NOT NULL,
      duracao_ms   INT UNSIGNED NULL,
      executada_em TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_migrations_nome (nome)
    ) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_0900_ai_ci
  `);
}

async function listarArquivos() {
  const arquivos = await readdir(PASTA_MIGRATIONS);
  return arquivos.filter((arquivo) => arquivo.endsWith('.sql')).sort();
}

async function aplicarMigracoes() {
  const conexao = await abrirConexaoAdministrativa();

  try {
    await garantirTabelaDeControle(conexao);

    const [registros] = await conexao.query('SELECT nome, checksum FROM _migrations');
    const aplicadas = new Map(registros.map((registro) => [registro.nome, registro.checksum]));
    const arquivos = await listarArquivos();

    if (arquivos.length === 0) {
      console.log('Nenhum arquivo de migração encontrado.');
      return;
    }

    let executadas = 0;

    for (const arquivo of arquivos) {
      const sql = await readFile(path.join(PASTA_MIGRATIONS, arquivo), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const checksumAnterior = aplicadas.get(arquivo);

      if (checksumAnterior) {
        if (checksumAnterior !== checksum) {
          console.warn(
            `[aviso] ${arquivo} já foi aplicada, mas o arquivo mudou (checksum divergente). ` +
              'Crie uma nova migração em vez de editar a existente.',
          );
        } else {
          console.log(`[ok]    ${arquivo} (já aplicada)`);
        }
        continue;
      }

      const inicio = Date.now();
      process.stdout.write(`[run]   ${arquivo} ... `);

      await conexao.query(sql);

      const duracao = Date.now() - inicio;
      await conexao.query(
        'INSERT INTO _migrations (nome, checksum, duracao_ms) VALUES (?, ?, ?)',
        [arquivo, checksum, duracao],
      );

      console.log(`aplicada em ${duracao}ms`);
      executadas += 1;
    }

    console.log(
      executadas > 0
        ? `\n${executadas} migração(ões) aplicada(s) com sucesso.`
        : '\nBanco de dados já está atualizado.',
    );
  } finally {
    await conexao.end();
  }
}

aplicarMigracoes().catch((erro) => {
  console.error(`\nFalha ao aplicar migrações: ${erro.message}`);
  process.exitCode = 1;
});
