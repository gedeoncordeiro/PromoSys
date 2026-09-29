/**
 * Conversão de datas para JSON.
 * O banco trabalha em UTC; a API expõe ISO-8601 (UTC) e datas puras em YYYY-MM-DD.
 */

/** `Date` | string | null  ->  'YYYY-MM-DD' | null */
export function paraDataIso(valor) {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString().slice(0, 10);
}

/** `Date` | string | null  ->  'YYYY-MM-DDTHH:mm:ss.sssZ' | null */
export function paraIsoUtc(valor) {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return null;
  return data.toISOString();
}

/** 'YYYY-MM-DD' -> Date (meia-noite UTC) — para gravar em colunas DATE. */
export function paraDateSql(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor;
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor)) ? new Date(`${valor}T00:00:00.000Z`) : new Date(valor);
}
