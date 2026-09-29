/**
 * Utilitários de CPF — documento-chave do cadastro no varejo físico.
 * O banco armazena sempre 11 dígitos (CHAR(11)), sem máscara.
 */

/** Remove qualquer caractere não numérico. */
export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D+/g, '');
}

/** Validação completa (dígitos verificadores) do CPF. */
export function ehCpfValido(valor) {
  const cpf = somenteDigitos(valor);

  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 000.000.000-00, 111.111.111-11...

  const calcularDigito = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i += 1) {
      soma += Number(base[i]) * (base.length + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  const base = cpf.slice(0, 9);
  const primeiroDigito = calcularDigito(base);
  const segundoDigito = calcularDigito(base + primeiroDigito);

  return cpf === `${base}${primeiroDigito}${segundoDigito}`;
}

/**
 * Normaliza para os 11 dígitos ou retorna `null` quando inválido.
 * Use em services antes de gravar — o retorno `null` vira erro de validação.
 */
export function normalizarCpf(valor) {
  const cpf = somenteDigitos(valor);
  return ehCpfValido(cpf) ? cpf : null;
}

/** Formata para exibição: 12345678909 -> 123.456.789-09 */
export function formatarCpf(valor) {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return valor ?? null;
  return cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}
