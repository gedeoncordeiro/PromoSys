/**
 * Regras puras da conciliação de saldos.
 *
 * Separadas do `conciliacao.service.js` de propósito: o service importa o pool
 * do MySQL (e, por consequência, a validação de `process.env`), o que impede
 * carregá-lo em um teste unitário sem banco. Aqui não há I/O — só classificação
 * e resumo, cobertos por testes puros que rodam em `npm test`.
 */
import { formatarCpf } from '../../utils/cpf.js';

/** Como a divergência se apresenta para o negócio. */
export const TIPOS_DIVERGENCIA = Object.freeze({
  CONFORME: 'CONFORME',
  /** cache > lotes: a loja mostra pontos que não existem (risco de resgate indevido). */
  SALDO_INFLADO: 'SALDO_INFLADO',
  /** cache < lotes: existem pontos legítimos que o cliente não vê. */
  SALDO_DEFASADO: 'SALDO_DEFASADO',
});

/**
 * Classifica a divergência a partir de `saldoLotes - saldoMaterializado`.
 *
 * @param {number} diferenca
 * @returns {'CONFORME'|'SALDO_INFLADO'|'SALDO_DEFASADO'}
 */
export function classificarDivergencia(diferenca) {
  if (!Number.isFinite(diferenca) || diferenca === 0) {
    return TIPOS_DIVERGENCIA.CONFORME;
  }

  return diferenca < 0 ? TIPOS_DIVERGENCIA.SALDO_INFLADO : TIPOS_DIVERGENCIA.SALDO_DEFASADO;
}

/**
 * Resume uma lista de divergências (`{ diferenca }`), somando pontos de cada
 * lado. `pontosInflados` é o que o PDV mostrava a mais; `pontosDefasados` é o
 * que ficou escondido do cliente.
 */
export function resumirDivergencias(divergencias = []) {
  const resumo = {
    clientesDivergentes: 0,
    clientesInflados: 0,
    clientesDefasados: 0,
    pontosInflados: 0,
    pontosDefasados: 0,
  };

  for (const item of divergencias) {
    const tipo = classificarDivergencia(Number(item.diferenca));

    if (tipo === TIPOS_DIVERGENCIA.SALDO_INFLADO) {
      resumo.clientesInflados += 1;
      resumo.pontosInflados += Math.abs(Number(item.diferenca));
    } else if (tipo === TIPOS_DIVERGENCIA.SALDO_DEFASADO) {
      resumo.clientesDefasados += 1;
      resumo.pontosDefasados += Number(item.diferenca);
    }
  }

  resumo.clientesDivergentes = resumo.clientesInflados + resumo.clientesDefasados;

  return resumo;
}

/** Converte a linha do SQL no objeto de domínio. */
export function mapearDivergencia(linha) {
  if (!linha) return null;

  const diferenca = Number(linha.diferenca);

  return {
    clienteId: Number(linha.cliente_id),
    cpf: formatarCpf(linha.cpf),
    nome: linha.nome,
    ativo: Boolean(linha.ativo),
    saldoMaterializado: Number(linha.saldo_materializado),
    saldoLotes: Number(linha.saldo_lotes),
    diferenca,
    tipo: classificarDivergencia(diferenca),
  };
}

export default { TIPOS_DIVERGENCIA, classificarDivergencia, resumirDivergencias, mapearDivergencia };
