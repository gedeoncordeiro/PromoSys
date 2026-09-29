/**
 * Constantes de domínio do programa de fidelidade.
 * Espelham os ENUMs definidos em src/database/migrations/001_init.sql.
 */

export const PERFIS = Object.freeze({
  ADMIN: 'ADMIN',
  GERENTE: 'GERENTE',
  OPERADOR: 'OPERADOR', // atendente de PDV
  AUDITOR: 'AUDITOR', // somente leitura (auditoria/compliance)
});

export const TODOS_OS_PERFIS = Object.freeze(Object.values(PERFIS));

export const TIPOS_TRANSACAO = Object.freeze({
  CREDITO: 'CREDITO',
  DEBITO: 'DEBITO',
  EXPIRACAO: 'EXPIRACAO',
  ESTORNO: 'ESTORNO',
  AJUSTE: 'AJUSTE',
});

export const ORIGENS_PONTOS = Object.freeze({
  COMPRA: 'COMPRA',
  BONUS: 'BONUS',
  INDICACAO: 'INDICACAO',
  RESGATE: 'RESGATE',
  EXPIRACAO: 'EXPIRACAO',
  ESTORNO: 'ESTORNO',
  AJUSTE_MANUAL: 'AJUSTE_MANUAL',
});

export const STATUS_RESGATE = Object.freeze({
  PENDENTE: 'PENDENTE',
  ENTREGUE: 'ENTREGUE',
  CANCELADO: 'CANCELADO',
  EXPIRADO: 'EXPIRADO',
});

export const NIVEIS = Object.freeze({
  BRONZE: 'BRONZE',
  PRATA: 'PRATA',
  OURO: 'OURO',
  DIAMANTE: 'DIAMANTE',
});

/** Tipos de recompensa disponíveis no catálogo. */
export const TIPOS_RECOMPENSA = Object.freeze({
  PRODUTO: 'PRODUTO',
  DESCONTO: 'DESCONTO',
  SERVICO: 'SERVICO',
  VOUCHER: 'VOUCHER',
});

/** Tamanho padrão de página em listagens paginadas. */
export const PAGINACAO = Object.freeze({
  LIMITE_PADRAO: 20,
  LIMITE_MAXIMO: 100,
});

/**
 * Faixas de nível do cliente (ordem decrescente de exigência).
 * Fonte única da verdade: o `nivel` do cliente é derivado do saldo de pontos
 * ativo e recalculado a cada movimento de pontos.
 */
export const FAIXAS_NIVEL = Object.freeze([
  { nivel: NIVEIS.DIAMANTE, minimo: 5_000 },
  { nivel: NIVEIS.OURO, minimo: 2_000 },
  { nivel: NIVEIS.PRATA, minimo: 500 },
  { nivel: NIVEIS.BRONZE, minimo: 0 },
]);

/** Dias de antecedência usados na consulta de pontos a expirar. */
export const AVISO_EXPIRACAO_DIAS = 30;
