const API_BASE = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '')
const ACCESS_KEY = 'promosys.access'
const REFRESH_KEY = 'promosys.refresh'

export interface ApiUser {
  id: number
  nome: string
  email: string
  cpf: string | null
  perfil: string
  unidadeId: number | null
  unidadeNome: string | null
  ativo: boolean
  ultimoLoginEm: string | null
}

export interface Session {
  accessToken: string
  refreshToken: string
  tokenType: 'Bearer'
  expiresIn: string
  usuario: ApiUser
}

export interface ApiPage<T> {
  data: T[]
  meta: { total: number; limit: number; offset: number; page: number; pages: number; hasNext: boolean }
}

export interface Client {
  id: number
  cpf: string
  nome: string
  email: string | null
  telefone: string | null
  dataNascimento: string | null
  cidade: string | null
  uf: string | null
  pontosSaldo: number
  nivel: string
  aceitaMarketing: boolean
  ativo: boolean
  unidadeCadastroId: number | null
  unidadeCadastroNome: string | null
  ultimaVisitaEm: string | null
  criadoEm: string | null
  atualizadoEm: string | null
}

export interface Reward {
  id: number
  sku: string
  nome: string
  descricao: string | null
  tipo: string
  pontosCusto: number
  valorReferencia: number | null
  estoque: number | null
  limitePorCliente: number | null
  vigenciaInicio: string | null
  vigenciaFim: string | null
  imagemUrl: string | null
  ativo: boolean
  criadoEm: string | null
  atualizadoEm: string | null
}

export interface Redemption {
  id: number
  codigo: string
  clienteId: number
  clienteNome: string | null
  recompensaId: number
  recompensaNome: string | null
  unidadeId: number | null
  unidadeNome: string | null
  usuarioId: number | null
  transacaoId: number | null
  pontosDebitados: number
  saldoApos: number | null
  status: string
  retiradoEm: string | null
  criadoEm: string | null
}

export interface Transaction {
  id: number
  clienteId: number
  unidadeId: number | null
  unidadeNome: string | null
  usuarioId: number | null
  tipo: string
  origem: string
  pontos: number
  valorCompra: number | null
  documentoFiscal: string | null
  descricao: string | null
  saldoApos: number | null
  estornoDeTransacaoId: number | null
  criadoEm: string | null
}

export interface Summary {
  clients: number
  rewards: number
  pending: number
  statusCounts: { name: string; value: number; color: string }[]
  pendingItems: Redemption[]
  recentItems: Redemption[]
}

export class ApiError extends Error {
  code: string
  status: number

  constructor(message: string, status: number, code = 'REQUEST_ERROR') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function getAccessToken() {
  return sessionStorage.getItem(ACCESS_KEY)
}

export function getRefreshToken() {
  return sessionStorage.getItem(REFRESH_KEY)
}

export function saveSession(session: Pick<Session, 'accessToken' | 'refreshToken'>) {
  sessionStorage.setItem(ACCESS_KEY, session.accessToken)
  sessionStorage.setItem(REFRESH_KEY, session.refreshToken)
}

export function clearSession() {
  sessionStorage.removeItem(ACCESS_KEY)
  sessionStorage.removeItem(REFRESH_KEY)
}

export async function api<T>(path: string, options: RequestInit & { auth?: boolean } = {}, canRefresh = true): Promise<T> {
  const { auth = true, ...init } = options
  const headers = new Headers(init.headers)
  if (auth && getAccessToken()) headers.set('Authorization', `Bearer ${getAccessToken()}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (response.status === 401 && auth && canRefresh && path !== '/auth/refresh') {
    const refreshToken = getRefreshToken()
    if (refreshToken) {
      try {
        const refreshed = await api<{ data: Pick<Session, 'accessToken' | 'refreshToken'> }>('/auth/refresh', {
          method: 'POST', auth: false, body: JSON.stringify({ refreshToken }),
        }, false)
        saveSession(refreshed.data)
        return api<T>(path, options, false)
      } catch {
        // The session is cleared below if refresh also failed.
      }
    }
    clearSession()
    window.dispatchEvent(new Event('promosys:session-expired'))
  }

  const payload = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(payload?.error?.message ?? 'Não foi possível concluir a solicitação.', response.status, payload?.error?.code)
  }
  return payload as T
}