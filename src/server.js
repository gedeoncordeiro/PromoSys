/**
 * Ponto de entrada do processo.
 *
 * Responsabilidades:
 *  - subir o servidor HTTP
 *  - tratar falhas de boot (porta ocupada, banco indisponível)
 *  - shutdown gracioso: para de aceitar conexões, espera as requisições em voo
 *    e fecha o pool MySQL (sem matar transações em andamento)
 */
import { buildApp } from './app.js';
import { env } from './config/env.js';

/** Tempo máximo aguardando as requisições em voo antes de forçar a saída. */
const TIMEOUT_SHUTDOWN_MS = 10_000;

async function iniciar() {
  const app = await buildApp();

  // --- Tratamento de falhas globais do processo -----------------------------
  let finalizando = false;

  const encerrar = async (sinal, codigoSaida = 0) => {
    if (finalizando) return;
    finalizando = true;

    app.log.info({ sinal }, 'Encerrando a API (shutdown gracioso)...');

    const forcarSaida = setTimeout(() => {
      app.log.error('Shutdown excedeu o tempo limite: encerrando à força.');
      process.exit(1);
    }, TIMEOUT_SHUTDOWN_MS);
    forcarSaida.unref();

    try {
      await app.close(); // dispara o hook onClose -> db.close()
      app.log.info('API encerrada com sucesso.');
      process.exit(codigoSaida);
    } catch (erro) {
      app.log.error({ err: erro }, 'Erro ao encerrar a API.');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));

  process.on('unhandledRejection', (motivo) => {
    app.log.fatal({ err: motivo }, 'Promise rejeitada sem tratamento: encerrando o processo.');
    void encerrar('unhandledRejection', 1);
  });

  process.on('uncaughtException', (erro) => {
    app.log.fatal({ err: erro }, 'Exceção não capturada: encerrando o processo.');
    void encerrar('uncaughtException', 1);
  });

  // --- Listen --------------------------------------------------------------
  try {
    await app.listen({ port: env.PORT, host: env.HOST });

    app.log.info(
      {
        ambiente: env.NODE_ENV,
        prefixo: env.API_PREFIX,
        docs: env.ENABLE_DOCS ? '/docs' : null,
        banco: `${env.DB_HOST}:${env.DB_PORT}/${env.DB_NAME}`,
      },
      'PromoSys API pronta para receber requisições',
    );
  } catch (erro) {
    app.log.fatal({ err: erro }, 'Não foi possível iniciar o servidor HTTP');
    process.exit(1);
  }
}

void iniciar();
