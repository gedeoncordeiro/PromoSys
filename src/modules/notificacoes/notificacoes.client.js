/**
 * Cliente do provedor de mensagens (WhatsApp).
 *
 * ▸ Nenhuma configuração vem de `process.env` aqui: o cliente recebe tudo por
 *   parâmetro. Isso mantém o módulo sem dependência de `src/config/env.js`, o que
 *   permite testá-lo com um `fetch` falso e sem banco.
 * ▸ A credencial nunca aparece em mensagem de erro: os cabeçalhos são montados
 *   aqui e o corpo da resposta é truncado (o `higienizarErro` ainda mascara o
 *   token se o provedor ecoar a credencial).
 * ▸ Provedores suportados: `log` (só registra — desenvolvimento, sem custo) e
 *   `http` (POST JSON para o endpoint configurado, formato de Evolution API e
 *   similares).
 */

/** Falha de entrega com o status HTTP anexado (usado na classificação). */
export class ErroProvedor extends Error {
  constructor(mensagem, { status = null, corpo = null } = {}) {
    super(mensagem);
    this.name = 'ErroProvedor';
    this.status = status;
    this.corpo = corpo;
  }
}

const LIMITE_TRECHO = 200;

/** Trecho do corpo da resposta, sem quebras de linha (não vaza senha: ver cabeçalhos). */
function trecho(texto) {
  return String(texto ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITE_TRECHO);
}

/** Aborta a requisição no prazo e devolve um erro reconhecível como timeout. */
async function comPrazo(executar, timeoutMs) {
  const controlador = new AbortController();
  const relogio = setTimeout(() => controlador.abort(), timeoutMs);

  try {
    return await executar(controlador.signal);
  } catch (erro) {
    if (erro?.name === 'AbortError') {
      const timeout = new Error(`Provedor não respondeu em ${timeoutMs}ms`);
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw erro;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Provedor de desenvolvimento: registra a mensagem e considera entregue.
 * Serve para rodar o job de ponta a ponta sem contratar um provedor.
 *
 * O destino padrão do registro é `process.stdout.write` (e não o logger Pino)
 * para que este módulo continue sem dependência de `src/config/env.js` — o que
 * é o que permite testá-lo sem banco e sem variáveis de ambiente.
 */
export function provedorLog({
  registrar = (linha) => process.stdout.write(`${linha}\n`),
} = {}) {
  return {
    nome: 'log',
    async enviar({ destino, mensagem, tipo }) {
      registrar(`[notificacao:log] ${tipo} → ${destino}: ${mensagem}`);
      return { status: 200, resposta: 'registrado' };
    },
  };
}

/**
 * Provedor HTTP genérico.
 *
 * @param {object} opcoes
 * @param {string} opcoes.url             endpoint de envio (obrigatório)
 * @param {string} [opcoes.apiKey]        enviada no cabeçalho `apikey`
 * @param {string} [opcoes.instancia]     instância/conta do provedor
 * @param {number} [opcoes.timeoutMs]
 * @param {typeof fetch} [opcoes.fetchImpl] injeção para teste
 */
export function provedorHttp({
  url,
  apiKey = null,
  instancia = null,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
  cabecalhosExtras = {},
} = {}) {
  if (!url) throw new Error('Provedor HTTP exige WHATSAPP_API_URL configurada.');
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch indisponível neste runtime (Node 18+ é obrigatório).');
  }

  return {
    nome: 'http',
    async enviar({ destino, mensagem, tipo }) {
      const resposta = await comPrazo(
        (signal) =>
          fetchImpl(url, {
            method: 'POST',
            signal,
            headers: {
              'content-type': 'application/json',
              ...(apiKey ? { apikey: apiKey } : {}),
              ...cabecalhosExtras,
            },
            body: JSON.stringify({
              canal: 'WHATSAPP',
              tipo,
              instancia,
              destino,
              mensagem,
            }),
          }),
        timeoutMs,
      );

      const corpo = trecho(await resposta.text?.());

      if (!resposta.ok) {
        throw new ErroProvedor(`Provedor respondeu ${resposta.status}${corpo ? `: ${corpo}` : ''}`, {
          status: resposta.status,
          corpo,
        });
      }

      return { status: resposta.status, resposta: corpo };
    },
  };
}

/**
 * Escolhe o provedor a partir da configuração do ambiente.
 * @param {{ provedor?: string, url?: string, apiKey?: string, instancia?: string,
 *           timeoutMs?: number, fetchImpl?: typeof fetch, registrar?: Function }} config
 */
export function criarProvedor(config = {}) {
  if (config.provedor === 'http') return provedorHttp(config);
  return provedorLog({ registrar: config.registrar });
}
