/**
 * Leitura de flags de linha de comando para os jobs (`npm run x -- --flag`).
 *
 * Por que um módulo e não `process.argv` direto no job: os jobs são arquivos de
 * entrada e executam ao serem importados, o que impede testá-los. Isolando o
 * parsing aqui, a validação das flags fica coberta por testes puros.
 *
 * Regras:
 *  ▸ apenas flags DECLARADAS são aceitas — um `--corrigri` digitado no cron
 *    falha alto em vez de rodar silenciosamente em modo relatório;
 *  ▸ `--nome` vale para flags booleanas; `--nome=valor` para inteiro/texto;
 *  ▸ flag booleana com valor (`--json=1`) e texto sem valor (`--json`) são erro.
 */

/** @typedef {'booleana'|'inteiro'|'texto'} TipoFlag */

/**
 * Erro de USO das flags (não é falha de execução). O job trata este caso com
 * código de saída 2 e imprime a ajuda, separando-o de um erro de negócio.
 */
export class FlagInvalidaError extends Error {
  constructor(mensagem) {
    super(mensagem);
    this.name = 'FlagInvalidaError';
  }
}

/**
 * @param {string[]} argv argumentos crus (normalmente `process.argv.slice(2)`)
 * @param {Record<string, { tipo: TipoFlag, padrao?: boolean|number|string, minimo?: number }>} especificacao
 * @returns {Record<string, boolean|number|string>}
 */
export function lerFlags(argv = [], especificacao = {}) {
  const opcoes = {};

  for (const [nome, definicao] of Object.entries(especificacao)) {
    opcoes[nome] = definicao.padrao ?? (definicao.tipo === 'booleana' ? false : undefined);
  }

  for (const arg of argv) {
    if (!arg.startsWith('-')) continue;

    const [bruto, ...resto] = arg.split('=');
    const nome = bruto.replace(/^--?/, '');
    const valorBruto = resto.length > 0 ? resto.join('=') : undefined;
    const definicao = especificacao[nome];

    if (!definicao) {
      throw new FlagInvalidaError(`Flag desconhecida: ${bruto}`);
    }

    if (definicao.tipo === 'booleana') {
      if (valorBruto !== undefined) {
        throw new FlagInvalidaError(`A flag ${bruto} não aceita valor.`);
      }
      opcoes[nome] = true;
      continue;
    }

    if (valorBruto === undefined || valorBruto === '') {
      throw new FlagInvalidaError(`A flag ${bruto} exige um valor (use ${bruto}=valor).`);
    }

    if (definicao.tipo === 'inteiro') {
      const numero = Number(valorBruto);
      if (!Number.isInteger(numero)) {
        throw new FlagInvalidaError(
          `A flag ${bruto} espera um número inteiro (recebido: "${valorBruto}").`,
        );
      }
      if (definicao.minimo !== undefined && numero < definicao.minimo) {
        throw new FlagInvalidaError(`A flag ${bruto} espera um valor >= ${definicao.minimo}.`);
      }
      opcoes[nome] = numero;
      continue;
    }

    opcoes[nome] = valorBruto;
  }

  return opcoes;
}

export default lerFlags;
