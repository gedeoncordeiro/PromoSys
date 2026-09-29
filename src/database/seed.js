/**
 * Seeds de desenvolvimento.
 *
 *   npm run seed
 *
 * Executa os arquivos de `src/database/seeds/*.sql` (dados de catálogo/unidades)
 * e cria os usuários iniciais com o hash bcrypt gerado em runtime — nunca
 * deixamos hash de senha fixo em arquivo SQL.
 *
 * Idempotente: pode rodar quantas vezes for preciso.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { hashSenha } from '../utils/password.js';

const DIRETORIO_ATUAL = path.dirname(fileURLToPath(import.meta.url));
const PASTA_SEEDS = path.join(DIRETORIO_ATUAL, 'seeds');

/**
 * Usuários iniciais. As senhas podem ser sobrescritas por variáveis de ambiente
 * (SEED_ADMIN_SENHA, SEED_GERENTE_SENHA, SEED_OPERADOR_SENHA) — nunca use estas
 * credenciais em produção.
 */
function usuariosIniciais() {
  return [
    {
      nome: 'Administrador PromoSys',
      email: 'admin@promosys.com.br',
      cpf: '39053344705',
      perfil: 'ADMIN',
      unidadeCodigo: null,
      senha: process.env.SEED_ADMIN_SENHA ?? 'Admin@123',
    },
    {
      nome: 'Gerente Loja Shopping',
      email: 'gerente@promosys.com.br',
      cpf: '52998224725',
      perfil: 'GERENTE',
      unidadeCodigo: 'LOJA-02',
      senha: process.env.SEED_GERENTE_SENHA ?? 'Gerente@123',
    },
    {
      nome: 'Operador PDV Centro',
      email: 'operador@promosys.com.br',
      cpf: '11144477735',
      perfil: 'OPERADOR',
      unidadeCodigo: 'LOJA-01',
      senha: process.env.SEED_OPERADOR_SENHA ?? 'Oper@123',
    },
  ];
}

async function abrirConexao() {
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

async function executarArquivosSql(conexao) {
  const arquivos = (await readdir(PASTA_SEEDS)).filter((a) => a.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    const sql = await readFile(path.join(PASTA_SEEDS, arquivo), 'utf8');
    process.stdout.write(`[run]   ${arquivo} ... `);
    await conexao.query(sql);
    console.log('ok');
  }
}

async function criarUsuarios(conexao) {
  for (const usuario of usuariosIniciais()) {
    let unidadeId = null;

    if (usuario.unidadeCodigo) {
      const [linhas] = await conexao.execute('SELECT id FROM unidades WHERE codigo = ? LIMIT 1', [
        usuario.unidadeCodigo,
      ]);
      unidadeId = linhas[0]?.id ?? null;
    }

    const senhaHash = await hashSenha(usuario.senha);

    await conexao.execute(
      `INSERT INTO usuarios (nome, email, cpf, senha_hash, perfil, unidade_id, ativo)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         nome = VALUES(nome),
         senha_hash = VALUES(senha_hash),
         perfil = VALUES(perfil),
         unidade_id = VALUES(unidade_id),
         ativo = 1`,
      [usuario.nome, usuario.email, usuario.cpf, senhaHash, usuario.perfil, unidadeId],
    );

    console.log(`[user]  ${usuario.email} (${usuario.perfil}) senha: ${usuario.senha}`);
  }
}

async function executarSeeds() {
  const conexao = await abrirConexao();

  try {
    await executarArquivosSql(conexao);
    await criarUsuarios(conexao);

    console.log('\nSeeds aplicados com sucesso.');
    console.log('Troque as senhas padrão antes de qualquer ambiente compartilhado.\n');
  } finally {
    await conexao.end();
  }
}

executarSeeds().catch((erro) => {
  console.error(`\nFalha ao aplicar seeds: ${erro.message}`);
  process.exitCode = 1;
});
