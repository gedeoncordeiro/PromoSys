/**
 * Normalização de telefone para o padrão E.164 (+5511987654321).
 * Essencial para casar o cadastro do PDV com o número usado no WhatsApp.
 */
import { somenteDigitos } from './cpf.js';

const DDI_BRASIL = '55';

/**
 * @param {string} valor telefone com ou sem máscara
 * @param {{ ddiPadrao?: string }} [opcoes]
 * @returns {string|null} E.164 válido ou `null` se não for possível normalizar
 */
export function normalizarTelefone(valor, { ddiPadrao = DDI_BRASIL } = {}) {
  let digitos = somenteDigitos(valor);
  if (!digitos) return null;

  // Remove zeros de operadora/DDD discados (ex.: 011...)
  digitos = digitos.replace(/^0+/, '');

  const extrairLocal = (completo) => {
    // Espera DDI (1-3) + DDD (2) + número (8-9)
    for (const tamanhoDdi of [1, 2, 3]) {
      const ddd = completo.slice(tamanhoDdi, tamanhoDdi + 2);
      const numero = completo.slice(tamanhoDdi + 2);
      if (numero.length >= 8 && numero.length <= 9 && /^[1-9]\d$/.test(ddd)) {
        return { ddi: completo.slice(0, tamanhoDdi), ddd, numero };
      }
    }
    return null;
  };

  let partes;

  if (digitos.startsWith(DDI_BRASIL) && digitos.length >= 12) {
    partes = extrairLocal(digitos);
  } else if (digitos.length === 10 || digitos.length === 11) {
    partes = extrairLocal(`${ddiPadrao}${digitos}`);
  } else {
    partes = extrairLocal(digitos);
  }

  if (!partes) return null;

  const { ddi, ddd, numero } = partes;
  return `+${ddi}${ddd}${numero}`;
}

/** Formata para exibição: +5511987654321 -> (11) 98765-4321 */
export function formatarTelefone(valor) {
  const e164 = normalizarTelefone(valor);
  if (!e164) return valor ?? null;

  // Toma os últimos 10/11 dígitos (DDD + número) do E.164, sem manipular o DDI.
  const local = e164.slice(1).slice(-11);

  if (local.length === 11) {
    return local.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  }
  if (local.length === 10) {
    return local.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  }
  return e164;
}
