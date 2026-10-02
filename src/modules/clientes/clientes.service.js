/**
 * Regras de negócio de clientes.
 *
 * - CPF é a chave de negócio: sempre validado (dígitos verificadores) e
 *   normalizado para 11 dígitos antes de tocar o banco.
 * - Telefone é normalizado para E.164 (integração futura com WhatsApp).
 * - Duplicidade é garantida pelo índice único `uk_clientes_cpf`: a checagem
 *   prévia existe apenas para devolver uma mensagem amigável — a corrida entre
 *   dois PDVs é resolvida pelo banco (ER_DUP_ENTRY -> 409).
 */
import * as repositorio from './clientes.repository.js';
import { registrarAuditoria } from '../../core/audit.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/app-error.js';
import { normalizarCpf } from '../../utils/cpf.js';
import { normalizarTelefone } from '../../utils/telefone.js';
import { normalizarPaginacao, metaPaginacao } from '../../utils/pagination.js';

/** Normaliza e valida os campos de contato; lança 422 quando inválidos. */
function normalizarDados(dados) {
  const normalizado = { ...dados };

  if (dados.cpf !== undefined) {
    const cpf = normalizarCpf(dados.cpf);
    if (!cpf) {
      throw new ValidationError('CPF inválido.', { campo: 'cpf' });
    }
    normalizado.cpf = cpf;
  }

  if (dados.telefone !== undefined && dados.telefone !== null) {
    const telefone = normalizarTelefone(dados.telefone);
    if (!telefone) {
      throw new ValidationError('Telefone inválido. Informe DDD + número.', { campo: 'telefone' });
    }
    normalizado.telefone = telefone;
  }

  return normalizado;
}

export async function criar(dados, contexto = {}) {
  const normalizado = normalizarDados(dados);

  if (await repositorio.existeCpf(normalizado.cpf)) {
    throw new ConflictError('Já existe um cliente cadastrado com este CPF.', {
      campo: 'cpf',
      cpf: normalizado.cpf,
    });
  }

  const { insertId } = await repositorio.inserir(normalizado);
  const cliente = await repositorio.buscarPorId(insertId);

  await registrarAuditoria({
    ...contexto,
    acao: 'CLIENTE_CRIADO',
    entidade: 'clientes',
    entidadeId: insertId,
    dadosNovos: repositorio.mapearCliente(cliente),
  });

  return repositorio.mapearCliente(cliente);
}

export async function obterPorId(clienteId) {
  const cliente = await repositorio.buscarPorId(clienteId);
  if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });

  return repositorio.mapearCliente(cliente);
}

export async function obterPorCpf(cpf) {
  const cpfNormalizado = normalizarCpf(cpf);
  if (!cpfNormalizado) throw new ValidationError('CPF inválido.', { campo: 'cpf' });

  const cliente = await repositorio.buscarPorCpf(cpfNormalizado);
  if (!cliente) throw new NotFoundError('Cliente não encontrado para o CPF informado.');

  return repositorio.mapearCliente(cliente);
}

export async function listar(filtros) {
  const { limit, offset } = normalizarPaginacao(filtros);
  const { itens, total } = await repositorio.listar({ ...filtros, limit, offset });

  return {
    itens: itens.map(repositorio.mapearCliente),
    meta: metaPaginacao({ total, limit, offset }),
  };
}

function escaparCsv(valor) {
  const texto = String(valor ?? '').replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${texto}"`;
}

export async function exportarCsv() {
  const { itens } = await repositorio.listar({ limit: 5000, offset: 0 });
  const clientes = itens.map(repositorio.mapearCliente);

  const cabecalho = ['nome', 'cpf', 'email', 'telefone', 'cidade', 'uf', 'pontosSaldo', 'nivel', 'ativo', 'ultimaVisitaEm', 'unidadeCadastroNome'];
  const linhas = [cabecalho.join(',')];

  for (const cliente of clientes) {
    const linha = [
      cliente?.nome,
      cliente?.cpf,
      cliente?.email,
      cliente?.telefone,
      cliente?.cidade,
      cliente?.uf,
      cliente?.pontosSaldo,
      cliente?.nivel,
      cliente?.ativo ? 'true' : 'false',
      cliente?.ultimaVisitaEm ?? '',
      cliente?.unidadeCadastroNome ?? '',
    ].map(escaparCsv).join(',');

    linhas.push(linha);
  }

  return linhas.join('\n');
}

export async function atualizar(clienteId, dados, contexto = {}) {
  const anterior = await repositorio.buscarPorId(clienteId);
  if (!anterior) throw new NotFoundError('Cliente não encontrado.', { clienteId });

  const normalizado = normalizarDados(dados);
  await repositorio.atualizar(clienteId, normalizado);

  const atualizado = await repositorio.buscarPorId(clienteId);

  await registrarAuditoria({
    ...contexto,
    acao: 'CLIENTE_ATUALIZADO',
    entidade: 'clientes',
    entidadeId: clienteId,
    dadosAnteriores: repositorio.mapearCliente(anterior),
    dadosNovos: repositorio.mapearCliente(atualizado),
  });

  return repositorio.mapearCliente(atualizado);
}

/**
 * Inativação lógica (soft delete).
 * O histórico de pontos e resgates precisa sobreviver ao "desligamento" do
 * cliente do programa — por isso o cadastro nunca é apagado fisicamente.
 */
export async function inativar(clienteId, { motivo, ...contexto } = {}) {
  const cliente = await repositorio.buscarPorId(clienteId);
  if (!cliente) throw new NotFoundError('Cliente não encontrado.', { clienteId });

  if (!cliente.ativo) {
    return { ...repositorio.mapearCliente(cliente), jaInativo: true };
  }

  await repositorio.inativar(clienteId);

  await registrarAuditoria({
    ...contexto,
    acao: 'CLIENTE_INATIVADO',
    entidade: 'clientes',
    entidadeId: clienteId,
    dadosAnteriores: { ativo: true },
    dadosNovos: { ativo: false, motivo: motivo ?? null },
  });

  return { ...repositorio.mapearCliente(await repositorio.buscarPorId(clienteId)), jaInativo: false };
}
