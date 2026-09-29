/**
 * Helpers de SQL.
 */

/** Escapa curingas do LIKE em entrada de usuário (busca por nome/CPF/telefone). */
export function escaparLike(valor) {
  return String(valor ?? '').replace(/[\\%_]/g, (caractere) => `\\${caractere}`);
}

/** Monta o padrão de busca: 'ana' -> '%ana%' */
export function padraoLike(valor) {
  return `%${escaparLike(valor)}%`;
}

/**
 * Fragmento seguro para LIMIT/OFFSET.
 * Preferimos interpolar inteiros já validados a usar placeholders, pois o
 * prepared statement do MySQL trata LIMIT ? como string em alguns drivers.
 */
export function limitOffsetSql(limit, offset) {
  return `LIMIT ${Number(limit)} OFFSET ${Number(offset)}`;
}
