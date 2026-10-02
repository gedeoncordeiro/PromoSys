import * as repositorio from './relatorios.repository.js';
import { mapearCliente } from '../clientes/clientes.repository.js';
import { mapearResgate } from '../recompensas/recompensas.repository.js';
import { ForbiddenError } from '../../core/errors/app-error.js';
import { PERFIS } from '../../config/constants.js';
import { normalizarPaginacao, metaPaginacao } from '../../utils/pagination.js';
import { paraIsoUtc } from '../../utils/date.js';

function aplicarEscopoUnidade(filtros, auth) {
  if ([PERFIS.ADMIN, PERFIS.AUDITOR].includes(auth.perfil)) return filtros;

  const unidadeId = Number(auth.unidadeId);
  if (!Number.isInteger(unidadeId) || unidadeId <= 0) {
    throw new ForbiddenError('Seu usuário precisa estar vinculado a uma unidade para consultar este relatório.');
  }
  if (filtros.unidadeId && Number(filtros.unidadeId) !== unidadeId) {
    throw new ForbiddenError('Você só pode consultar os dados da unidade vinculada ao seu usuário.');
  }
  return { ...filtros, unidadeId };
}

export async function financeiro(filtros, auth) {
  const escopo = aplicarEscopoUnidade(filtros, auth);
  const { limit, offset } = normalizarPaginacao(escopo);
  const { itens, total, resumo } = await repositorio.listarFinanceiro({ ...escopo, limit, offset });
  return {
    resumo: {
      vendas: Number(resumo?.vendas ?? 0),
      pontosCompra: Number(resumo?.pontos_compra ?? 0),
      pontosCreditados: Number(resumo?.pontos_creditados ?? 0),
      transacoes: Number(resumo?.transacoes ?? 0),
    },
    itens: itens.map((item) => ({
      id: Number(item.id),
      clienteId: Number(item.cliente_id),
      clienteNome: item.cliente_nome,
      unidadeId: item.unidade_id === null ? null : Number(item.unidade_id),
      unidadeNome: item.unidade_nome,
      usuarioId: item.usuario_id === null ? null : Number(item.usuario_id),
      tipo: item.tipo,
      origem: item.origem,
      pontos: Number(item.pontos),
      valorCompra: item.valor_compra === null ? null : Number(item.valor_compra),
      documentoFiscal: item.documento_fiscal,
      descricao: item.descricao,
      saldoApos: item.saldo_apos === null ? null : Number(item.saldo_apos),
      estornoDeTransacaoId: item.estorno_de_transacao_id === null ? null : Number(item.estorno_de_transacao_id),
      criadoEm: paraIsoUtc(item.criado_em),
    })),
    meta: metaPaginacao({ total, limit, offset }),
  };
}

export async function unidades(filtros, auth) {
  const escopo = aplicarEscopoUnidade(filtros, auth);
  const { rows } = await repositorio.listarUnidades(escopo);
  return rows.map((row) => ({
    id: Number(row.id),
    codigo: row.codigo,
    nome: row.nome,
    cidade: row.cidade,
    uf: row.uf,
    vendas: Number(row.vendas ?? 0),
    pontosCompra: Number(row.pontos_compra ?? 0),
    transacoes: Number(row.transacoes ?? 0),
    novosClientes: Number(row.novos_clientes ?? 0),
  }));
}

export async function pontosClientes(filtros, auth) {
  const escopo = aplicarEscopoUnidade(filtros, auth);
  const { limit, offset } = normalizarPaginacao(escopo);
  const { itens, total } = await repositorio.listarPontosClientes({ ...escopo, limit, offset });
  return {
    itens: itens.map(mapearCliente),
    meta: metaPaginacao({ total, limit, offset }),
  };
}

export async function resumoOperacional(filtros, auth) {
  const escopo = aplicarEscopoUnidade(filtros, auth);
  const { totais, status, pendentes, recentes } = await repositorio.obterResumoOperacional(escopo.unidadeId);
  const contagens = new Map(status.map((item) => [item.status, Number(item.total)]));
  const statusCounts = [
    { name: 'Pendentes', value: contagens.get('PENDENTE') ?? 0, color: '#e6a845' },
    { name: 'Entregues', value: contagens.get('ENTREGUE') ?? 0, color: '#69a886' },
    { name: 'Cancelados', value: contagens.get('CANCELADO') ?? 0, color: '#de7863' },
    { name: 'Expirados', value: contagens.get('EXPIRADO') ?? 0, color: '#a8b2ad' },
  ];

  return {
    clients: Number(totais?.clientes ?? 0),
    rewards: Number(totais?.recompensas ?? 0),
    pending: contagens.get('PENDENTE') ?? 0,
    statusCounts,
    pendingItems: pendentes.map(mapearResgate),
    recentItems: recentes.map(mapearResgate),
  };
}
