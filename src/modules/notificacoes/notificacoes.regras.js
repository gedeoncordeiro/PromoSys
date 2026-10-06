/**
 * Regras puras do módulo de notificações (sem I/O).
 *
 * Ficam separadas do service/repository por um motivo prático: os testes puros
 * não podem importar nada que puxe `src/config/env.js` (que exige DB_USER,
 * DB_NAME e os segredos JWT). Mantendo decisão e formatação aqui, a parte que
 * realmente importa — quem recebe aviso, quando tentar de novo e quando desistir
 * — é coberta por testes que rodam sem banco (`npm test`).
 */

/** Tipos de aviso suportados (espelham o ENUM da migração 002). */
export const TIPOS_NOTIFICACAO = Object.freeze({
  PONTOS_CREDITADOS: 'PONTOS_CREDITADOS',
  PONTOS_ESTORNADOS: 'PONTOS_ESTORNADOS',
  RESGATE_CONFIRMADO: 'RESGATE_CONFIRMADO',
});

/** Canais de entrega (hoje só WhatsApp; a coluna já é ENUM para crescer). */
export const CANAIS = Object.freeze({ WHATSAPP: 'WHATSAPP' });

/** Estados da fila. `FALHA` = tentou e vai tentar de novo; `CANCELADA` = desistiu. */
export const STATUS_NOTIFICACAO = Object.freeze({
  PENDENTE: 'PENDENTE',
  FALHA: 'FALHA',
  ENVIADA: 'ENVIADA',
  CANCELADA: 'CANCELADA',
});

/** Finalidade LGPD que autoriza o aviso por WhatsApp (tabela `consentimentos`). */
export const FINALIDADE_WHATSAPP = 'WHATSAPP';

/** Por que um aviso NÃO foi enfileirado (observabilidade, não é erro). */
export const MOTIVOS_IGNORADO = Object.freeze({
  CANAL_DESABILITADO: 'CANAL_DESABILITADO',
  CLIENTE_INATIVO: 'CLIENTE_INATIVO',
  SEM_TELEFONE: 'SEM_TELEFONE',
  SEM_CONSENTIMENTO: 'SEM_CONSENTIMENTO',
});

/** Classificação da falha de envio (define retentar ou desistir). */
export const MOTIVOS_FALHA = Object.freeze({
  SEM_RESPOSTA: 'SEM_RESPOSTA',
  LIMITE_OU_TIMEOUT: 'LIMITE_OU_TIMEOUT',
  ERRO_DO_PROVEDOR: 'ERRO_DO_PROVEDOR',
  REQUISICAO_REJEITADA: 'REQUISICAO_REJEITADA',
});

/** Mensagem padrão de crédito de pontos ({chaves} são substituídas no envio). */
export const TEMPLATE_CREDITO_PADRAO =
  'Olá, {primeiroNome}! Você acumulou {pontos} pontos (saldo: {saldo}). ' +
  'Compra de {valor} em {unidade}. Obrigado por participar do PromoSys!';

/**
 * Mensagem padrão do estorno.
 *
 * Existe porque avisar o crédito e ficar calado no estorno deixaria o cliente com
 * uma promessa de saldo na mão — pior do que não avisar nada.
 */
export const TEMPLATE_ESTORNO_PADRAO =
  'Olá, {primeiroNome}! O estorno de {pontos} pontos da sua compra foi processado. ' +
  'Seu saldo agora é {saldo} pontos.';

/** Status usado apenas no modo `--dry-run` (nada é gravado no banco). */
export const STATUS_SIMULADO = 'SIMULADO';

/** Limite de tamanho do erro guardado em `ultimo_erro` (VARCHAR(500)). */
export const LIMITE_ERRO = 500;

/**
 * Caracteres de controle e de formato (zero-width, direção de texto...).
 * Usamos propriedades Unicode (`\p{Cc}`/`\p{Cf}`) em vez de uma faixa literal:
 * `no-control-regex` proíbe a faixa crua, e a propriedade ainda cobre casos que
 * a faixa não pegava (ex.: U+200B entre dígitos).
 */
const CARACTERES_INVISIVEIS = /[\p{Cc}\p{Cf}]+/gu;

/** Status que o worker ainda pode tentar (páginas de "fila"). */
export const STATUS_NA_FILA = Object.freeze([STATUS_NOTIFICACAO.PENDENTE, STATUS_NOTIFICACAO.FALHA]);

/**
 * Um telefone só recebe aviso se estiver em E.164 completo (DDI + DDD + número).
 * Números incompletos nunca entram na fila — melhor não avisar do que avisar o
 * número errado de outra pessoa.
 */
export function telefoneValido(valor) {
  return typeof valor === 'string' && /^\+\d{12,15}$/.test(valor.trim());
}

/**
 * Mascara o telefone para log/relatório: `+5511987654321` → `+5511****4321`.
 * O número completo nunca aparece em log (LGPD) — só no registro da fila.
 */
export function mascararTelefone(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length < 6) return '****';
  return `+${digitos.slice(0, 4)}****${digitos.slice(-4)}`;
}

/**
 * Situação mais recente do consentimento para WhatsApp.
 *
 * A trilha em `consentimentos` é append-only (aceite e revogação são linhas
 * novas), então vale sempre o registro mais recente — desempate por `id`.
 *
 * @param {Array<{ finalidade: string, aceito: unknown, versao?: string|null,
 *                 criado_em?: Date|string|null, id?: number|string }>} [registros]
 * @returns {{ aceito: boolean, versao: string|null, desde: Date|string|null }|null}
 *          `null` = cliente nunca decidiu sobre WhatsApp.
 */
export function consentimentoWhatsapp(registros = []) {
  const doCanal = registros
    .filter((registro) => registro?.finalidade === FINALIDADE_WHATSAPP)
    .sort(compararMaisRecente);

  const ultimo = doCanal[0];
  if (!ultimo) return null;

  return {
    aceito: ultimo.aceito === true || ultimo.aceito === 1 || ultimo.aceito === '1',
    versao: ultimo.versao ?? null,
    desde: ultimo.criado_em ?? null,
  };
}

/** Ordena do mais recente para o mais antigo (data e, no empate, maior id). */
function compararMaisRecente(a, b) {
  const dataA = a?.criado_em ? new Date(a.criado_em).getTime() : 0;
  const dataB = b?.criado_em ? new Date(b.criado_em).getTime() : 0;
  if (dataA !== dataB) return dataB - dataA;
  return Number(b?.id ?? 0) - Number(a?.id ?? 0);
}

/** Decide se o cliente pode receber o aviso (e por que não, se não puder). */
export function podeNotificar({ habilitado = true, cliente, consentimentos = [] } = {}) {
  if (!habilitado) return { elegivel: false, motivo: MOTIVOS_IGNORADO.CANAL_DESABILITADO };
  if (!cliente) return { elegivel: false, motivo: MOTIVOS_IGNORADO.CLIENTE_INATIVO };
  if (cliente.ativo !== undefined && !cliente.ativo) {
    return { elegivel: false, motivo: MOTIVOS_IGNORADO.CLIENTE_INATIVO };
  }

  if (!telefoneValido(cliente.telefone)) {
    return { elegivel: false, motivo: MOTIVOS_IGNORADO.SEM_TELEFONE };
  }

  const consentimento = consentimentoWhatsapp(consentimentos);
  if (!consentimento?.aceito) {
    return { elegivel: false, motivo: MOTIVOS_IGNORADO.SEM_CONSENTIMENTO, consentimento };
  }

  return { elegivel: true, consentimento };
}

/**
 * Formatação numérica em pt-BR feita à mão (sem `Intl`).
 *
 * Motivo: o resultado de `Intl.NumberFormat('pt-BR')` depende de o runtime ter
 * ICU completo. Em Node com ICU reduzido o mesmo código imprime "1,234" e
 * "R$149.90" — a mensagem que o cliente recebe não pode mudar de forma conforme
 * a build do Node. Aqui a formatação é determinística e testável.
 */
function agruparMilhares(digitos) {
  return String(digitos).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Formata pontos com separador de milhar pt-BR (1234 → "1.234"). */
export function formatarPontos(valor) {
  const numero = Math.trunc(Number(valor) || 0);
  const sinal = numero < 0 ? '-' : '';
  return `${sinal}${agruparMilhares(Math.abs(numero))}`;
}

/** Formata moeda pt-BR (149.9 → "R$ 149,90"). `null`/inválido vira string vazia. */
export function formatarValor(valor) {
  if (valor === null || valor === undefined || valor === '') return '';

  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '';

  const [inteiro, centavos] = Math.abs(numero).toFixed(2).split('.');
  return `R$ ${numero < 0 ? '-' : ''}${agruparMilhares(inteiro)},${centavos}`;
}

/** Primeiro nome (o resto vira "sobrenome" longo demais para WhatsApp). */
export function primeiroNome(nome) {
  return String(nome ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Renderiza a mensagem a partir do payload gravado na outbox.
 * Placeholders desconhecidos ficam como estão — a mensagem nunca sai com
 * "undefined" nem com dado faltando trocado por vazio por acidente.
 */
export function montarMensagem({ tipo, dados = {}, template = TEMPLATE_CREDITO_PADRAO } = {}) {
  const variaveis = variaveisDaMensagem(tipo, dados);

  return template.replace(/\{(\w+)\}/g, (original, chave) =>
    Object.hasOwn(variaveis, chave) ? variaveis[chave] : original,
  );
}

/** Mapa de substituições por tipo de aviso. */
function variaveisDaMensagem(tipo, dados) {
  const base = {
    nome: String(dados.clienteNome ?? ''),
    primeiroNome: primeiroNome(dados.clienteNome),
    saldo: formatarPontos(dados.saldoApos),
    unidade: dados.unidadeNome ?? 'nossa loja',
  };

  if (tipo === TIPOS_NOTIFICACAO.PONTOS_CREDITADOS) {
    return {
      ...base,
      pontos: formatarPontos(dados.pontos),
      valor: formatarValor(dados.valorCompra) || 'sua compra',
      documento: dados.documentoFiscal ?? '',
    };
  }

  if (tipo === TIPOS_NOTIFICACAO.PONTOS_ESTORNADOS) {
    return { ...base, pontos: formatarPontos(dados.pontos) };
  }

  if (tipo === TIPOS_NOTIFICACAO.RESGATE_CONFIRMADO) {
    return { ...base, recompensa: dados.recompensaNome ?? 'seu prêmio', codigo: dados.codigo ?? '' };
  }

  return base;
}

/**
 * Próxima tentativa com backoff exponencial (base, 2×base, 4×base...) limitado
 * por um teto. O teto é o que impede a fila de "morrer" com intervalo de dias
 * quando o provedor fica fora do ar no fim de semana inteiro.
 *
 * @param {number} tentativas já realizadas (1 = primeira falha)
 * @param {Date} [agora]
 * @returns {Date}
 */
export function calcularProximaTentativa(
  tentativas,
  agora = new Date(),
  { baseSegundos = 60, tetoSegundos = 6 * 60 * 60 } = {},
) {
  const numero = Math.max(1, Number(tentativas) || 1);
  const exponencial = baseSegundos * 2 ** (numero - 1);
  const segundos = Math.min(exponencial, tetoSegundos);

  return new Date(agora.getTime() + segundos * 1000);
}

/**
 * Classifica a falha do provedor:
 *  ▸ 408/425/429 e 5xx → vale tentar de novo (problema passageiro)
 *  ▸ timeout/queda de rede (sem status) → vale tentar de novo
 *  ▸ demais 4xx → requisição rejeitada; insistir só gasta dinheiro
 */
export function classificarFalha(erro) {
  const nome = String(erro?.name ?? '');
  if (nome === 'AbortError' || nome === 'TimeoutError') {
    return { retentavel: true, motivo: MOTIVOS_FALHA.SEM_RESPOSTA, status: null };
  }

  const status = Number(erro?.status ?? erro?.statusCode ?? 0);
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    return { retentavel: true, motivo: MOTIVOS_FALHA.SEM_RESPOSTA, status: null };
  }

  if (status === 408 || status === 425 || status === 429) {
    return { retentavel: true, motivo: MOTIVOS_FALHA.LIMITE_OU_TIMEOUT, status };
  }

  if (status >= 500) {
    return { retentavel: true, motivo: MOTIVOS_FALHA.ERRO_DO_PROVEDOR, status };
  }

  return { retentavel: false, motivo: MOTIVOS_FALHA.REQUISICAO_REJEITADA, status };
}

/**
 * Prepara o texto do erro para guardar em `ultimo_erro`: remove quebras/controle,
 * trunca no limite da coluna e mascara qualquer segredo recebido — a mensagem do
 * provedor pode ecoar a própria credencial.
 */
export function higienizarErro(
  erro,
  { limite = LIMITE_ERRO, segredos = [] } = {},
) {
  let texto = String(erro?.message ?? erro ?? '').replace(CARACTERES_INVISIVEIS, ' ');

  for (const segredo of segredos) {
    const valor = String(segredo ?? '');
    if (valor.length >= 8) texto = texto.split(valor).join('****');
  }

  texto = texto.trim();

  return texto.length > limite ? `${texto.slice(0, limite - 1)}…` : texto;
}

/** Contadores de uma execução do worker (vai para o log e para o `--json`). */
export function resumirProcessamento(resultados = []) {
  const resumo = {
    analisadas: resultados.length,
    enviadas: 0,
    reagendadas: 0,
    canceladas: 0,
    ignoradas: 0,
    simuladas: 0,
  };

  for (const resultado of resultados) {
    if (resultado.status === STATUS_NOTIFICACAO.ENVIADA) resumo.enviadas += 1;
    else if (resultado.status === STATUS_NOTIFICACAO.CANCELADA) resumo.canceladas += 1;
    else if (resultado.status === STATUS_NOTIFICACAO.FALHA) resumo.reagendadas += 1;
    else if (resultado.status === STATUS_SIMULADO) resumo.simuladas += 1;
    else resumo.ignoradas += 1;
  }

  return resumo;
}
