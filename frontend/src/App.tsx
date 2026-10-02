import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  Gift,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Target,
  TicketCheck,
  UserRound,
  UserRoundPlus,
  UsersRound,
  X,
} from 'lucide-react'
import {
  api,
  clearSession,
  getAccessToken,
  getRefreshToken,
  saveSession,
  type ApiPage,
  type ApiUser,
  type Client,
  type Redemption,
  type Reward,
  type Session,
  type Summary,
  type Transaction,
} from './lib/api'
import './promosys.css'

type PageId = 'overview' | 'operations' | 'clients' | 'rewards' | 'redemptions' | 'finance' | 'points-report' | 'units'

const pageLabels: Record<PageId, string> = {
  overview: 'Visão geral',
  operations: 'Operações',
  clients: 'Clientes',
  rewards: 'Recompensas',
  redemptions: 'Resgates',
  finance: 'Caixa e financeiro',
  'points-report': 'Pontos por cliente',
  units: 'Desempenho por unidade',
}

const navItems: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'operations', label: 'Operações', icon: BriefcaseBusiness },
  { id: 'clients', label: 'Clientes', icon: UsersRound },
  { id: 'rewards', label: 'Recompensas', icon: Gift },
  { id: 'redemptions', label: 'Resgates', icon: TicketCheck },
  { id: 'finance', label: 'Caixa e financeiro', icon: CircleDollarSign },
  { id: 'points-report', label: 'Pontos por cliente', icon: Target },
  { id: 'units', label: 'Desempenho por unidade', icon: Store },
]

function formatNumber(value: number) {
  return new Intl.NumberFormat('pt-BR').format(value)
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function localDateValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function App() {
  const [user, setUser] = useState<ApiUser | null>(null)
  const [checkingSession, setCheckingSession] = useState(() => Boolean(getAccessToken()))
  const [page, setPage] = useState<PageId>('overview')
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error' } | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    const expireSession = () => {
      setUser(null)
      setCheckingSession(false)
    }
    window.addEventListener('promosys:session-expired', expireSession)
    return () => window.removeEventListener('promosys:session-expired', expireSession)
  }, [])

  useEffect(() => {
    const token = getAccessToken()
    if (!token) return

    let active = true
    api<{ data: ApiUser }>('/auth/me')
      .then((response) => { if (active) setUser(response.data) })
      .catch(() => {
        clearSession()
        if (active) setUser(null)
      })
      .finally(() => { if (active) setCheckingSession(false) })

    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!notice) return
    const timeout = window.setTimeout(() => setNotice(null), 4200)
    return () => window.clearTimeout(timeout)
  }, [notice])

  async function signIn(identificador: string, senha: string) {
    const response = await api<{ data: Session }>('/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ identificador, senha }),
    })
    saveSession(response.data)
    setUser(response.data.usuario)
    setPage('overview')
  }

  async function signOut() {
    const refreshToken = getRefreshToken()
    try {
      if (refreshToken) {
        await api('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        })
      }
    } finally {
      clearSession()
      setUser(null)
    }
  }

  if (checkingSession) {
    return <div className="session-loading"><LoaderCircle className="spin" size={21} /> Verificando sessão</div>
  }

  if (!user) return <LoginScreen onLogin={signIn} />

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /></div>
          <div className="brand-name">promo<span>sys</span><small>CLUBE DE VANTAGENS</small></div>
          <button className="icon-button mobile-close" aria-label="Fechar menu" onClick={() => setMobileNavOpen(false)}><X size={19} /></button>
        </div>

        <div className="store-chip"><span className="store-dot" /><span>Operação ativa</span><ChevronDown size={14} /></div>
        <div className="nav-caption">ESPAÇO DE TRABALHO</div>
        <nav className="primary-nav" aria-label="Navegação principal">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              className={`nav-item ${page === id ? 'nav-item-active' : ''}`}
              key={id}
              onClick={() => { setPage(id); setMobileNavOpen(false) }}
            >
              <Icon size={18} strokeWidth={1.9} />
              <span>{label}</span>
              {id === 'redemptions' && page === id ? <span className="nav-count">•</span> : null}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <div className="note-icon"><Sparkles size={16} /></div>
          <strong>Relacionamento que volta</strong>
          <p>Cada compra é uma nova oportunidade de fidelizar.</p>
        </div>

        <div className="sidebar-footer">
          <div className="user-avatar">{initials(user.nome)}</div>
          <div className="user-meta"><strong>{user.nome}</strong><span>{user.perfil}</span></div>
          <button className="icon-button signout-button" aria-label="Sair" title="Sair" onClick={signOut}><LogOut size={17} /></button>
        </div>
      </aside>

      {mobileNavOpen ? <button className="nav-scrim" aria-label="Fechar navegação" onClick={() => setMobileNavOpen(false)} /> : null}

      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button><span>PromoSys</span><span className="crumb-separator">/</span><strong>{pageLabels[page]}</strong></div>
          <div className="topbar-actions"><div className="today-label"><CalendarDays size={15} /><span>{new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(new Date())}</span></div><button className="icon-button notification-button" aria-label="Notificações"><Bell size={18} /><span /></button><div className="topbar-avatar">{initials(user.nome)}</div></div>
        </header>

        <div className="content-wrap">
          {page === 'overview' ? <Overview onNavigate={setPage} user={user} /> : null}
          {page === 'operations' ? <OperationsPage user={user} onNavigate={setPage} /> : null}
          {page === 'clients' ? <ClientsPage notify={setNotice} user={user} /> : null}
          {page === 'rewards' ? <RewardsPage user={user} notify={setNotice} /> : null}
          {page === 'redemptions' ? <RedemptionsPage user={user} notify={setNotice} /> : null}
          {page === 'finance' ? <FinancePage user={user} notify={setNotice} /> : null}
          {page === 'points-report' ? <PointsReportPage user={user} /> : null}
          {page === 'units' ? <UnitsPerformancePage user={user} /> : null}
        </div>
      </main>
      {notice ? <div className={`toast toast-${notice.kind}`} role="status"><span className="toast-icon">{notice.kind === 'success' ? <Check size={16} /> : <X size={16} />}</span>{notice.message}</div> : null}
    </div>
  )
}

function LoginScreen({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [identificador, setIdentificador] = useState('')
  const [senha, setSenha] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await onLogin(identificador.trim(), senha)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-shell">
      <section className="login-story">
        <div className="login-brand"><div className="brand-mark brand-mark-light"><span /><span /><span /></div><div className="brand-name">promo<span>sys</span></div></div>
        <div className="story-content">
          <div className="eyebrow light-eyebrow"><span /> FIDELIDADE FEITA PARA O VAREJO</div>
          <h1>O próximo cliente fiel começa <em>no caixa.</em></h1>
          <p>Uma operação mais próxima, simples e inteligente para cada loja.</p>
        </div>
        <div className="story-bottom"><div className="story-seal"><ShieldCheck size={17} /><span>ACESSO PROTEGIDO</span></div><span>PromoSys · {new Date().getFullYear()}</span></div>
        <div className="story-art" aria-hidden="true"><div className="art-ring art-ring-one" /><div className="art-ring art-ring-two" /><div className="art-spark">✳</div><div className="art-ticket"><Gift size={23} /><span>+ pontos<br />a cada compra</span></div></div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <div className="mobile-login-brand"><div className="brand-mark"><span /><span /><span /></div><div className="brand-name">promo<span>sys</span></div></div>
          <div className="form-overline">BEM-VINDO DE VOLTA</div>
          <h2>Acesse sua operação</h2>
          <p className="login-subtitle">Entre com seu e-mail ou CPF de operador.</p>
          <form className="login-form" onSubmit={handleSubmit}>
            <label htmlFor="login-id">E-mail ou CPF</label>
            <div className="input-icon-wrap"><UserRound size={17} /><input id="login-id" autoComplete="username" value={identificador} onChange={(event) => setIdentificador(event.target.value)} placeholder="nome@loja.com.br" required /></div>
            <div className="password-label"><label htmlFor="login-password">Senha</label><span><ShieldCheck size={13} /> Conexão segura</span></div>
            <div className="input-icon-wrap"><span className="lock-glyph">••</span><input id="login-password" type="password" autoComplete="current-password" value={senha} onChange={(event) => setSenha(event.target.value)} placeholder="Sua senha de acesso" required /></div>
            {error ? <div className="form-error" role="alert">{error}</div> : null}
            <button className="button button-primary login-submit" type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="spin" size={18} /> : null}<span>{submitting ? 'Entrando...' : 'Entrar na operação'}</span><ArrowRight size={17} /></button>
          </form>
          <div className="login-help"><span className="help-line" /><span>Precisa de acesso? Fale com o administrador da sua rede.</span><span className="help-line" /></div>
        </div>
        <div className="login-panel-footer"><span>© {new Date().getFullYear()} PromoSys</span><span>Fidelidade com propósito.</span></div>
      </section>
    </main>
  )
}

function OperationsPage({ user, onNavigate }: { user: ApiUser; onNavigate: (page: PageId) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    Promise.all([
      api<ApiPage<Client>>('/clientes?ativo=true&limit=1'),
      api<ApiPage<Redemption>>('/resgates?status=PENDENTE&limit=1'),
      api<ApiPage<Reward>>('/recompensas?ativo=true&limit=1'),
    ])
      .then(([clients, pending, rewards]) => {
        if (active) setSummary({
          clients: clients.meta.total,
          rewards: rewards.meta.total,
          pending: pending.meta.total,
          statusCounts: [],
          pendingItems: pending.data,
          recentItems: [],
        })
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados operacionais.')
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false }
  }, [])

  return (
    <section className="page page-enter">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><span /> OPERAÇÃO</div>
          <h1>Centro de comando</h1>
          <p>Acesse os módulos de rotina e acompanhe os indicadores reais da operação.</p>
        </div>
        <span className="chip chip-wine"><Store size={13} /> {user.unidadeNome ?? 'Todas as unidades'}</span>
      </div>

      {error ? <InlineError message={error} onRetry={() => window.location.reload()} /> : null}

      <div className="metric-grid">
        <MetricCard title="Clientes ativos" value={summary?.clients} loading={loading} icon={<UsersRound size={18} />} tone="lime" caption="Base ativa" action={() => onNavigate('points-report')} />
        <MetricCard title="Recompensas ativas" value={summary?.rewards} loading={loading} icon={<Gift size={18} />} tone="coral" caption="No catálogo" action={() => onNavigate('rewards')} />
        <MetricCard title="Resgates pendentes" value={summary?.pending} loading={loading} icon={<Clock3 size={18} />} tone="gold" caption="Aguardando retirada" action={() => onNavigate('redemptions')} />
      </div>

      <section className="panel recent-panel">
        <div className="panel-heading">
          <div><span className="section-kicker">ROTINA OPERACIONAL</span><h2>Módulos de gestão</h2></div>
        </div>
        <div className="ops-actions-grid">
          <button className="ops-action-card" onClick={() => onNavigate('finance')}>
            <span className="quick-icon quick-icon-coral"><CircleDollarSign size={17} /></span>
            <span><strong>Caixa e financeiro</strong><small>Vendas, créditos e estornos por período.</small></span>
          </button>
          <button className="ops-action-card" onClick={() => onNavigate('points-report')}>
            <span className="quick-icon quick-icon-lime"><Target size={17} /></span>
            <span><strong>Pontos por cliente</strong><small>Consulte saldo, nível e atividade.</small></span>
          </button>
          <button className="ops-action-card" onClick={() => onNavigate('units')}>
            <span className="quick-icon quick-icon-gold"><Store size={17} /></span>
            <span><strong>Desempenho por unidade</strong><small>Compare lojas e movimentações.</small></span>
          </button>
          <button className="ops-action-card" onClick={() => onNavigate('clients')}>
            <span className="quick-icon quick-icon-lime"><UserRoundPlus size={17} /></span>
            <span><strong>Clientes</strong><small>Busca avançada e segmentação.</small></span>
          </button>
          <button className="ops-action-card" onClick={() => onNavigate('rewards')}>
            <span className="quick-icon quick-icon-gold"><ShoppingBag size={17} /></span>
            <span><strong>Recompensas</strong><small>Gerencie o catálogo disponível.</small></span>
          </button>
          <button className="ops-action-card" onClick={() => onNavigate('redemptions')}>
            <span className="quick-icon quick-icon-coral"><TicketCheck size={17} /></span>
            <span><strong>Resgates</strong><small>Filtre e processe retiradas.</small></span>
          </button>
        </div>
      </section>
    </section>
  )
}

type UnitReport = { id: number; codigo: string; nome: string; cidade: string | null; uf: string | null; vendas: number; pontosCompra: number; transacoes: number; novosClientes: number }

function FinancePage({ user, notify }: { user: ApiUser; notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void }) {
  const today = localDateValue(new Date())
  const monthStart = `${today.slice(0, 7)}-01`
  const [de, setDe] = useState(monthStart)
  const [ate, setAte] = useState(today)
  const [unidadeId, setUnidadeId] = useState(String(user.unidadeId ?? ''))
  const [tipo, setTipo] = useState('')
  const [origem, setOrigem] = useState('')
  const [busca, setBusca] = useState('')
  const [offset, setOffset] = useState(0)
  const [dados, setDados] = useState<{ resumo: { vendas: number; pontosCompra: number; pontosCreditados: number; transacoes: number }; itens: Transaction[]; meta: ApiPage<Transaction>['meta'] } | null>(null)
  const [unidades, setUnidades] = useState<UnitReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [saleLookupOpen, setSaleLookupOpen] = useState(false)
  const [selectedSaleClient, setSelectedSaleClient] = useState<Client | null>(null)
  const pageSize = 20
  const globalProfile = ['ADMIN', 'AUDITOR'].includes(user.perfil)

  useEffect(() => {
    let active = true
    api<{ data: UnitReport[] }>('/relatorios/unidades')
      .then((response) => { if (active) setUnidades(response.data) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
        if (de) params.set('de', de)
        if (ate) params.set('ate', ate)
        if (unidadeId) params.set('unidadeId', unidadeId)
        if (tipo) params.set('tipo', tipo)
        if (origem) params.set('origem', origem)
        if (busca.trim().length >= 2) params.set('busca', busca.trim())
        const result = await api<{ data: NonNullable<typeof dados> }>(`/relatorios/financeiro?${params}`)
        if (active) setDados(result.data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar o financeiro.')
      } finally {
        if (active) setLoading(false)
      }
    }, 240)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [de, ate, unidadeId, tipo, origem, busca, offset, refreshKey])

  return <section className="page page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span /> LIVRO-RAZÃO</div><h1>Caixa e financeiro</h1><p>Compras registradas no programa, créditos e movimentações do período.</p></div><div className="finance-heading-actions"><span className="catalog-total"><CircleDollarSign size={16} /> {dados ? `${formatNumber(dados.resumo.transacoes)} movimentos` : '—'}</span>{['ADMIN', 'GERENTE', 'OPERADOR'].includes(user.perfil) ? <button className="button button-primary" onClick={() => setSaleLookupOpen(true)}><Plus size={16} /> Registrar venda</button> : null}</div></div>
    <div className="report-filters">
      <label>De<input type="date" value={de} max={ate} onChange={(event) => { setDe(event.target.value); setOffset(0) }} /></label>
      <label>Até<input type="date" value={ate} min={de} onChange={(event) => { setAte(event.target.value); setOffset(0) }} /></label>
      {globalProfile ? <label>Unidade<select value={unidadeId} onChange={(event) => { setUnidadeId(event.target.value); setOffset(0) }}><option value="">Todas as unidades</option>{unidades.map((unit) => <option key={unit.id} value={unit.id}>{unit.nome}</option>)}</select></label> : null}
      <label>Tipo<select value={tipo} onChange={(event) => { setTipo(event.target.value); setOffset(0) }}><option value="">Todos</option>{['CREDITO', 'DEBITO', 'ESTORNO', 'EXPIRACAO', 'AJUSTE'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Origem<select value={origem} onChange={(event) => { setOrigem(event.target.value); setOffset(0) }}><option value="">Todas</option>{['COMPRA', 'BONUS', 'INDICACAO', 'RESGATE', 'EXPIRACAO', 'ESTORNO', 'AJUSTE_MANUAL'].map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</select></label>
      <label className="report-search">Buscar<input value={busca} onChange={(event) => { setBusca(event.target.value); setOffset(0) }} placeholder="Cliente, CPF ou documento" /></label>
    </div>
    {error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}
    <div className="report-metrics">
      <article><span>VENDAS IDENTIFICADAS</span><strong>{loading ? '—' : formatCurrency(dados?.resumo.vendas ?? 0)}</strong><small>Compras com crédito de pontos</small></article>
      <article><span>PONTOS DE COMPRA</span><strong>{loading ? '—' : formatNumber(dados?.resumo.pontosCompra ?? 0)}</strong><small>Créditos originados por compras</small></article>
      <article><span>PONTOS CREDITADOS</span><strong>{loading ? '—' : formatNumber(dados?.resumo.pontosCreditados ?? 0)}</strong><small>Todos os créditos no filtro aplicado</small></article>
    </div>
    <section className="panel table-panel">
      {loading ? <TableLoading /> : dados?.itens.length ? <div className="table-scroll"><table><thead><tr><th>DATA</th><th>CLIENTE</th><th>UNIDADE</th><th>TIPO / ORIGEM</th><th>VALOR</th><th>PONTOS</th><th>DOCUMENTO</th></tr></thead><tbody>{dados.itens.map((item) => <tr key={item.id}><td>{formatDate(item.criadoEm)}</td><td><strong>{(item as Transaction & { clienteNome?: string }).clienteNome ?? `Cliente #${item.clienteId}`}</strong></td><td>{item.unidadeNome ?? '—'}</td><td><span className="code-text">{item.tipo} · {item.origem}</span></td><td>{item.valorCompra === null ? '—' : formatCurrency(item.valorCompra)}</td><td>{formatNumber(item.pontos)}</td><td>{item.documentoFiscal ?? '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon={<CircleDollarSign size={22} />} title="Nenhuma movimentação encontrada" description="Altere o período ou os filtros para consultar outros registros." compact />}
      <div className="table-pagination"><span>{dados?.meta.total ? `${formatNumber(dados.meta.total)} movimentações` : 'Nenhum registro'}</span><div><button className="button button-outline button-small" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button><span className="page-number">{dados?.meta.page ?? 1} / {Math.max(dados?.meta.pages ?? 1, 1)}</span><button className="button button-outline button-small" disabled={!dados?.meta.hasNext || loading} onClick={() => setOffset(offset + pageSize)}>Próxima</button></div></div>
    </section>
    {saleLookupOpen ? <SaleClientLookupModal onClose={() => setSaleLookupOpen(false)} onSelect={(client) => { setSaleLookupOpen(false); setSelectedSaleClient(client) }} /> : null}
    {selectedSaleClient ? <PurchaseModal client={selectedSaleClient} user={user} onClose={() => setSelectedSaleClient(null)} onSuccess={() => { setSelectedSaleClient(null); setRefreshKey((value) => value + 1) }} notify={notify} /> : null}
  </section>
}

function SaleClientLookupModal({ onClose, onSelect }: { onClose: () => void; onSelect: (client: Client) => void }) {
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) {
      setClients([])
      setLoading(false)
      setError('')
      return
    }

    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ busca: term, ativo: 'true', limit: '8' })
        const response = await api<ApiPage<Client>>(`/clientes?${params}`)
        if (active) setClients(response.data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível buscar clientes.')
      } finally {
        if (active) setLoading(false)
      }
    }, 220)

    return () => { active = false; window.clearTimeout(timeout) }
  }, [search])

  return <Modal title="Registrar venda" eyebrow="CAIXA · SELECIONE O CLIENTE" onClose={onClose}>
    <div className="sale-client-search"><Search size={16} /><input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, CPF ou telefone" aria-label="Buscar cliente para venda" /></div>
    {loading ? <div className="client-search-state"><LoaderCircle size={14} className="spin" /> Buscando clientes...</div> : null}
    {error ? <div className="form-error" role="alert">{error}</div> : null}
    {!loading && search.trim().length >= 2 && !error && clients.length === 0 ? <EmptyState icon={<UsersRound size={19} />} title="Cliente não encontrado" description="Confira o nome, CPF ou telefone informado." compact /> : null}
    {clients.length ? <div className="client-search-results">{clients.map((client) => <button className="client-search-row" key={client.id} onClick={() => onSelect(client)}><span className={`client-avatar avatar-${client.nivel.toLowerCase()}`}>{initials(client.nome)}</span><span><strong>{client.nome}</strong><small>{client.cpf} · {formatNumber(client.pontosSaldo)} pontos</small></span><ArrowRight size={15} /></button>)}</div> : null}
  </Modal>
}

function PointsReportPage({ user }: { user: ApiUser }) {
  const [busca, setBusca] = useState('')
  const [nivel, setNivel] = useState('')
  const [pontosMin, setPontosMin] = useState('')
  const [pontosMax, setPontosMax] = useState('')
  const [ordenarPor, setOrdenarPor] = useState('saldo_desc')
  const [unidadeId, setUnidadeId] = useState(String(user.unidadeId ?? ''))
  const [offset, setOffset] = useState(0)
  const [clients, setClients] = useState<ApiPage<Client> | null>(null)
  const [unidades, setUnidades] = useState<UnitReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const pageSize = 20
  const globalProfile = ['ADMIN', 'AUDITOR'].includes(user.perfil)

  useEffect(() => {
    let active = true
    api<{ data: UnitReport[] }>('/relatorios/unidades')
      .then((response) => { if (active) setUnidades(response.data) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), ordenarPor })
        if (busca.trim().length >= 2) params.set('busca', busca.trim())
        if (nivel) params.set('nivel', nivel)
        if (pontosMin) params.set('pontosMin', pontosMin)
        if (pontosMax) params.set('pontosMax', pontosMax)
        if (unidadeId) params.set('unidadeId', unidadeId)
        const result = await api<ApiPage<Client>>(`/relatorios/pontos-clientes?${params}`)
        if (active) setClients(result)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar o relatório de pontos.')
      } finally {
        if (active) setLoading(false)
      }
    }, 240)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [busca, nivel, pontosMin, pontosMax, ordenarPor, unidadeId, offset, refreshKey])

  return <section className="page page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span /> RELACIONAMENTO</div><h1>Pontos por cliente</h1><p>Consulte saldos atuais, níveis e clientes da unidade.</p></div><span className="catalog-total"><Target size={16} /> {clients ? `${formatNumber(clients.meta.total)} clientes` : '—'}</span></div>
    <div className="report-filters points-filters">
      <label className="report-search">Buscar<input value={busca} onChange={(event) => { setBusca(event.target.value); setOffset(0) }} placeholder="Nome, CPF ou telefone" /></label>
      <label>Nível<select value={nivel} onChange={(event) => { setNivel(event.target.value); setOffset(0) }}><option value="">Todos</option>{['BRONZE', 'PRATA', 'OURO', 'DIAMANTE'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Saldo mínimo<input type="number" min="0" value={pontosMin} onChange={(event) => { setPontosMin(event.target.value); setOffset(0) }} placeholder="0" /></label>
      <label>Saldo máximo<input type="number" min="0" value={pontosMax} onChange={(event) => { setPontosMax(event.target.value); setOffset(0) }} placeholder="Sem limite" /></label>
      {globalProfile ? <label>Unidade<select value={unidadeId} onChange={(event) => { setUnidadeId(event.target.value); setOffset(0) }}><option value="">Todas as unidades</option>{unidades.map((unit) => <option key={unit.id} value={unit.id}>{unit.nome}</option>)}</select></label> : null}
      <label>Ordenar<select value={ordenarPor} onChange={(event) => { setOrdenarPor(event.target.value); setOffset(0) }}><option value="saldo_desc">Maior saldo</option><option value="saldo_asc">Menor saldo</option><option value="nome">Nome</option></select></label>
    </div>
    {error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}
    <section className="panel table-panel">
      {loading ? <TableLoading /> : clients?.data.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>UNIDADE</th><th>NÍVEL</th><th>SALDO ATUAL</th><th>ÚLTIMA VISITA</th></tr></thead><tbody>{clients.data.map((client) => <tr key={client.id}><td><span className="table-person"><span className={`client-avatar avatar-${client.nivel.toLowerCase()}`}>{initials(client.nome)}</span><strong>{client.nome}</strong></span></td><td>{client.unidadeCadastroNome ?? '—'}</td><td><LevelBadge level={client.nivel} /></td><td><strong className="points-cell">{formatNumber(client.pontosSaldo)} <small>pts</small></strong></td><td>{formatDate(client.ultimaVisitaEm)}</td></tr>)}</tbody></table></div> : <EmptyState icon={<UsersRound size={22} />} title="Nenhum cliente neste filtro" description="Ajuste a busca ou os limites de saldo para ampliar o resultado." compact />}
      <div className="table-pagination"><span>{clients?.meta.total ? `${formatNumber(clients.meta.total)} clientes` : 'Nenhum registro'}</span><div><button className="button button-outline button-small" disabled={!offset || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button><span className="page-number">{clients?.meta.page ?? 1} / {Math.max(clients?.meta.pages ?? 1, 1)}</span><button className="button button-outline button-small" disabled={!clients?.meta.hasNext || loading} onClick={() => setOffset(offset + pageSize)}>Próxima</button></div></div>
    </section>
  </section>
}

function UnitsPerformancePage({ user }: { user: ApiUser }) {
  const today = localDateValue(new Date())
  const monthStart = `${today.slice(0, 7)}-01`
  const [de, setDe] = useState(monthStart)
  const [ate, setAte] = useState(today)
  const [unidadeId, setUnidadeId] = useState('')
  const [units, setUnits] = useState<UnitReport[]>([])
  const [unitOptions, setUnitOptions] = useState<UnitReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const globalProfile = ['ADMIN', 'AUDITOR'].includes(user.perfil)

  useEffect(() => {
    let active = true
    api<{ data: UnitReport[] }>('/relatorios/unidades')
      .then((response) => { if (active) setUnitOptions(response.data) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams()
        if (de) params.set('de', de)
        if (ate) params.set('ate', ate)
        if (unidadeId) params.set('unidadeId', unidadeId)
        const response = await api<{ data: UnitReport[] }>(`/relatorios/unidades?${params}`)
        if (active) setUnits(response.data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar o desempenho das unidades.')
      } finally {
        if (active) setLoading(false)
      }
    }, 200)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [de, ate, unidadeId, refreshKey])

  const totalSales = units.reduce((sum, unit) => sum + unit.vendas, 0)
  const totalPoints = units.reduce((sum, unit) => sum + unit.pontosCompra, 0)
  const totalClients = units.reduce((sum, unit) => sum + unit.novosClientes, 0)
  const maxSales = Math.max(...units.map((unit) => unit.vendas), 0)

  return <section className="page page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span /> VISÃO MULTILOJA</div><h1>Desempenho por unidade</h1><p>Compare vendas identificadas, créditos de pontos e novos cadastros.</p></div><span className="catalog-total"><Store size={16} /> {formatNumber(units.length)} unidades</span></div>
    <div className="report-filters">
      <label>De<input type="date" value={de} max={ate} onChange={(event) => setDe(event.target.value)} /></label>
      <label>Até<input type="date" value={ate} min={de} onChange={(event) => setAte(event.target.value)} /></label>
      {globalProfile ? <label>Unidade<select value={unidadeId} onChange={(event) => setUnidadeId(event.target.value)}><option value="">Todas as unidades</option>{unitOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.nome}</option>)}</select></label> : null}
    </div>
    {error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}
    <div className="report-metrics">
      <article><span>VENDAS IDENTIFICADAS</span><strong>{loading ? '—' : formatCurrency(totalSales)}</strong><small>Compras vinculadas a uma unidade</small></article>
      <article><span>PONTOS DE COMPRA</span><strong>{loading ? '—' : formatNumber(totalPoints)}</strong><small>Créditos atribuídos no período</small></article>
      <article><span>NOVOS CADASTROS</span><strong>{loading ? '—' : formatNumber(totalClients)}</strong><small>Clientes cadastrados no período</small></article>
    </div>
    {loading ? <section className="panel"><TableLoading /></section> : units.length ? <div className="unit-performance-list">{units.map((unit) => <article className="unit-performance-row" key={unit.id}><div className="unit-performance-heading"><div><span>{unit.codigo}{unit.cidade ? ` · ${unit.cidade}${unit.uf ? `/${unit.uf}` : ''}` : ''}</span><h2>{unit.nome}</h2></div><strong>{formatCurrency(unit.vendas)}</strong></div><div className="unit-sales-track"><span style={{ width: `${maxSales ? Math.max((unit.vendas / maxSales) * 100, unit.vendas ? 2 : 0) : 0}%` }} /></div><div className="unit-performance-meta"><span>{formatNumber(unit.transacoes)} movimentações</span><span>{formatNumber(unit.pontosCompra)} pontos por compra</span><span>{formatNumber(unit.novosClientes)} novos clientes</span></div></article>)}</div> : <EmptyState icon={<Store size={22} />} title="Nenhuma unidade encontrada" description="Não há unidades ativas para os filtros selecionados." />}
  </section>
}

function Overview({ onNavigate, user }: { onNavigate: (page: PageId) => void; user: ApiUser }) {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const canCreateClients = ['ADMIN', 'GERENTE', 'OPERADOR'].includes(user.perfil)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
      const result = await api<{ data: Summary }>('/relatorios/operacao')
      if (active) setSummary(result.data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar o resumo.')
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [refreshKey])

  return (
    <section className="page page-enter">
      <div className="page-heading dashboard-heading">
        <div><div className="eyebrow"><span /> PAINEL DA OPERAÇÃO</div><h1>Bom dia, {user.nome.split(' ')[0]}.</h1><p>Veja o que está acontecendo com o seu clube hoje.</p></div>
        <button className="button button-outline refresh-action" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}><Activity size={16} className={loading ? 'spin' : ''} /> Atualizar dados</button>
      </div>

      {error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}

      <div className="metric-grid">
        <MetricCard title="Clientes no clube" value={summary?.clients} loading={loading} icon={<UsersRound size={18} />} tone="lime" caption="Base cadastrada" />
        <MetricCard title="Recompensas ativas" value={summary?.rewards} loading={loading} icon={<Gift size={18} />} tone="coral" caption="No catálogo" />
        <MetricCard title="Aguardando retirada" value={summary?.pending} loading={loading} icon={<Clock3 size={18} />} tone="gold" caption="Resgates pendentes" action={() => onNavigate('redemptions')} />
      </div>

      <div className="dashboard-grid">
        <section className="panel status-panel">
          <div className="panel-heading"><div><span className="section-kicker">ACOMPANHAMENTO</span><h2>Fluxo de resgates</h2></div><button className="text-action" onClick={() => onNavigate('redemptions')}>Ver resgates <ArrowRight size={15} /></button></div>
          {loading ? <div className="chart-loading"><span /><span /><span /><span /><span /><span /><span /></div> : <RedemptionChart data={summary?.statusCounts ?? []} />}
          <div className="chart-footer"><span><i className="legend-dot dot-pending" />Pendentes</span><span><i className="legend-dot dot-delivered" />Entregues</span><span><i className="legend-dot dot-cancelled" />Cancelados</span><span><i className="legend-dot dot-expired" />Expirados</span></div>
        </section>

        <section className="panel pending-panel">
          <div className="panel-heading"><div><span className="section-kicker">AÇÃO NECESSÁRIA</span><h2>Retiradas pendentes</h2></div><span className="count-pill">{summary?.pending ?? '—'}</span></div>
          {loading ? <div className="skeleton-lines"><span /><span /><span /></div> : summary?.pendingItems.length ? <div className="pending-list">{summary.pendingItems.slice(0, 4).map((item) => <button key={item.id} className="pending-row" onClick={() => onNavigate('redemptions')}><div className="pending-gift"><Gift size={16} /></div><div className="pending-info"><strong>{item.recompensaNome ?? 'Recompensa'}</strong><span>{item.clienteNome ?? `Cliente #${item.clienteId}`} · {formatDate(item.criadoEm)}</span></div><ArrowRight size={15} className="pending-arrow" /></button>)}</div> : <EmptyState icon={<BadgeCheck size={21} />} title="Tudo em dia" description="Nenhuma retirada aguardando confirmação." compact />}
          <button className="panel-footer-link" onClick={() => onNavigate('redemptions')}>Abrir fila de resgates <ArrowRight size={15} /></button>
        </section>
      </div>

      <section className="panel recent-panel">
        <div className="panel-heading"><div><span className="section-kicker">MOVIMENTAÇÃO</span><h2>Resgates recentes</h2></div><button className="text-action" onClick={() => onNavigate('redemptions')}>Histórico completo <ArrowRight size={15} /></button></div>
        {loading ? <div className="skeleton-table"><span /><span /><span /></div> : summary?.recentItems.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>RECOMPENSA</th><th>CÓDIGO</th><th>DATA</th><th>STATUS</th></tr></thead><tbody>{summary.recentItems.slice(0, 5).map((item) => <tr key={item.id}><td><span className="table-person"><span className="mini-avatar">{initials(item.clienteNome ?? 'C')}</span><strong>{item.clienteNome ?? `Cliente #${item.clienteId}`}</strong></span></td><td>{item.recompensaNome ?? '—'}</td><td><span className="code-text">{item.codigo}</span></td><td>{formatDate(item.criadoEm)}</td><td><StatusBadge status={item.status} /></td></tr>)}</tbody></table></div> : <EmptyState icon={<TicketCheck size={21} />} title="Nenhum resgate por aqui" description="Os resgates feitos na operação aparecerão nesta lista." compact />}
      </section>

      <div className="quick-actions"><span className="section-kicker">ATALHOS DE OPERAÇÃO</span><div className="quick-action-list">{canCreateClients ? <button onClick={() => onNavigate('clients')}><span className="quick-icon quick-icon-lime"><UserRoundPlus size={17} /></span><span><strong>Cadastrar cliente</strong><small>Adicionar à base do clube</small></span><ArrowUpRight size={16} /></button> : null}<button onClick={() => onNavigate('rewards')}><span className="quick-icon quick-icon-coral"><Gift size={17} /></span><span><strong>Ver recompensas</strong><small>Consultar o catálogo ativo</small></span><ArrowUpRight size={16} /></button><button onClick={() => onNavigate('redemptions')}><span className="quick-icon quick-icon-gold"><ShoppingBag size={17} /></span><span><strong>Entregar prêmio</strong><small>Confirmar retirada no balcão</small></span><ArrowUpRight size={16} /></button></div></div>
    </section>
  )
}

function MetricCard({ title, value, loading, icon, tone, caption, action }: { title: string; value?: number; loading: boolean; icon: ReactNode; tone: string; caption: string; action?: () => void }) {
  return <button className={`metric-card metric-${tone}`} onClick={action} disabled={!action}><div className="metric-top"><span className="metric-icon">{icon}</span>{action ? <ArrowUpRight size={16} className="metric-link" /> : null}</div><span className="metric-title">{title}</span><strong className="metric-value">{loading ? <span className="value-skeleton" /> : formatNumber(value ?? 0)}</strong><span className="metric-caption">{caption}</span></button>
}

function RedemptionChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  let offset = 0
  const gradientStops = data.map((item) => {
    const start = total ? (offset / total) * 100 : 0
    offset += item.value
    const end = total ? (offset / total) * 100 : 0
    return `${item.color} ${start}% ${end}%`
  }).join(', ')

  return <div className="chart-body"><div className="donut-wrap"><div className="donut-chart" style={{ background: total ? `conic-gradient(${gradientStops})` : 'conic-gradient(#e8ece8 0 100%)' }}><div className="donut-hole"><strong>{formatNumber(total)}</strong><span>resgates</span></div></div></div><div className="chart-summary"><span className="chart-summary-label">TOTAL NO PERÍODO</span><strong>{formatNumber(total)}</strong><p>Resgates registrados<br />em todos os status.</p><div className="chart-mini-stats">{data.slice(0, 2).map((item) => <div key={item.name}><span>{item.name}</span><strong>{formatNumber(item.value)}</strong></div>)}</div></div></div>
}

function ClientsPage({ notify, user }: { notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void; user: ApiUser }) {
  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [level, setLevel] = useState('')
  const [minimumPoints, setMinimumPoints] = useState('')
  const [maximumPoints, setMaximumPoints] = useState('')
  const [sortBy, setSortBy] = useState('nome')
  const [offset, setOffset] = useState(0)
  const [clients, setClients] = useState<ApiPage<Client> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<Client | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [exporting, setExporting] = useState(false)
  const pageSize = 20
  const canCreate = ['ADMIN', 'GERENTE', 'OPERADOR'].includes(user.perfil)

  async function exportCsv() {
    setExporting(true)
    try {
      const params = new URLSearchParams({ ativo: String(activeOnly) })
      if (search.trim().length >= 2) params.set('busca', search.trim())
      if (level) params.set('nivel', level)
      if (minimumPoints) params.set('pontosMin', minimumPoints)
      if (maximumPoints) params.set('pontosMax', maximumPoints)
      params.set('ordenarPor', sortBy)

      const response = await fetch(`/api/v1/clientes/export?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${getAccessToken()}`,
        },
      })

      if (!response.ok) {
        throw new Error('Não foi possível exportar a lista de clientes.')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `clientes-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
      notify({ message: 'Lista de clientes exportada em CSV.', kind: 'success' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível exportar os clientes.'
      notify({ message, kind: 'error' })
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset), ativo: String(activeOnly), ordenarPor: sortBy })
        if (search.trim().length >= 2) params.set('busca', search.trim())
        if (level) params.set('nivel', level)
        if (minimumPoints) params.set('pontosMin', minimumPoints)
        if (maximumPoints) params.set('pontosMax', maximumPoints)
        const result = await api<ApiPage<Client>>(`/clientes?${params}`)
        if (active) setClients(result)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar clientes.')
      } finally {
        if (active) setLoading(false)
      }
    }, 260)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [search, activeOnly, level, minimumPoints, maximumPoints, sortBy, offset, refreshKey])

  async function created() {
    setCreateOpen(false)
    setOffset(0)
    setRefreshKey((value) => value + 1)
    notify({ message: 'Cliente cadastrado no clube.', kind: 'success' })
  }

  return (
    <section className="page page-enter">
      <div className="page-heading"><div><div className="eyebrow"><span /> RELACIONAMENTO</div><h1>Clientes</h1><p>Encontre pessoas do clube e acompanhe seus pontos.</p></div>{canCreate ? <button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={17} /> Novo cliente</button> : null}</div>
      <div className="list-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setOffset(0) }} placeholder="Buscar por nome, CPF ou telefone" aria-label="Buscar clientes" /><kbd>⌘ K</kbd></div><label className="toggle-filter"><input type="checkbox" checked={activeOnly} onChange={(event) => { setActiveOnly(event.target.checked); setOffset(0) }} /><span className="toggle-track" /><span>Somente ativos</span></label><div className="toolbar-actions"><button className="button button-outline button-small" onClick={() => void exportCsv()} disabled={exporting || loading}>{exporting ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} {exporting ? 'Exportando...' : 'Exportar CSV'}</button><span className="toolbar-total">{clients ? `${formatNumber(clients.meta.total)} clientes` : '—'}</span></div></div>
      <div className="inline-filters"><label>Nível<select value={level} onChange={(event) => { setLevel(event.target.value); setOffset(0) }}><option value="">Todos os níveis</option>{['BRONZE', 'PRATA', 'OURO', 'DIAMANTE'].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label>Pontos mínimos<input type="number" min="0" value={minimumPoints} onChange={(event) => { setMinimumPoints(event.target.value); setOffset(0) }} placeholder="0" /></label><label>Pontos máximos<input type="number" min="0" value={maximumPoints} onChange={(event) => { setMaximumPoints(event.target.value); setOffset(0) }} placeholder="Sem limite" /></label><label>Ordenar por<select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setOffset(0) }}><option value="nome">Nome</option><option value="saldo_desc">Maior saldo</option><option value="saldo_asc">Menor saldo</option><option value="visita_desc">Visita recente</option></select></label></div>
      {error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}
      <section className="panel table-panel">
        {loading ? <TableLoading /> : clients?.data.length ? <div className="table-scroll"><table className="clients-table"><thead><tr><th>CLIENTE</th><th>CPF</th><th>CELULAR</th><th>NÍVEL</th><th>SALDO</th><th>ÚLTIMA VISITA</th><th /></tr></thead><tbody>{clients.data.map((client) => <tr key={client.id} onClick={() => setSelected(client)} className="clickable-row"><td><span className="table-person"><span className={`client-avatar avatar-${client.nivel.toLowerCase()}`}>{initials(client.nome)}</span><span className="person-lines"><strong>{client.nome}</strong><small>{client.email ?? 'Sem e-mail cadastrado'}</small></span></span></td><td className="muted-cell">{formatCpf(client.cpf)}</td><td>{client.telefone ?? '—'}</td><td><LevelBadge level={client.nivel} /></td><td><strong className="points-cell">{formatNumber(client.pontosSaldo)} <small>pts</small></strong></td><td>{formatDate(client.ultimaVisitaEm)}</td><td><ArrowUpRight size={15} className="row-open-icon" /></td></tr>)}</tbody></table></div> : <EmptyState icon={<UsersRound size={22} />} title={search ? 'Nenhum cliente encontrado' : 'Sua base começa aqui'} description={search ? 'Tente buscar por outro nome, CPF ou telefone.' : 'Cadastre o primeiro cliente para iniciar o relacionamento.'} action={!search && canCreate ? <button className="button button-primary button-small" onClick={() => setCreateOpen(true)}><Plus size={15} /> Cadastrar cliente</button> : undefined} />}
        <div className="table-pagination"><span>{clients?.meta.total ? `Mostrando ${offset + 1}–${Math.min(offset + pageSize, clients.meta.total)} de ${formatNumber(clients.meta.total)}` : 'Nenhum registro nesta página'}</span><div><button className="button button-outline button-small" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Anterior</button><span className="page-number">{clients?.meta.page ?? 1} / {Math.max(clients?.meta.pages ?? 1, 1)}</span><button className="button button-outline button-small" disabled={!clients?.meta.hasNext || loading} onClick={() => setOffset(offset + pageSize)}>Próxima</button></div></div>
      </section>
      {createOpen ? <CreateClientModal onClose={() => setCreateOpen(false)} onCreated={created} notify={notify} /> : null}
      {selected ? <ClientDrawer client={selected} user={user} onClose={() => setSelected(null)} notify={notify} onChanged={() => setRefreshKey((value) => value + 1)} /> : null}
    </section>
  )
}

function CreateClientModal({ onClose, onCreated, notify }: { onClose: () => void; onCreated: () => void; notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void }) {
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    const form = new FormData(event.currentTarget)
    const data = Object.fromEntries(form.entries())
    try {
      await api('/clientes', {
        method: 'POST',
        body: JSON.stringify({
          cpf: String(data.cpf), nome: String(data.nome), email: String(data.email || '') || undefined,
          telefone: String(data.telefone || '') || undefined, cidade: String(data.cidade || '') || undefined,
          uf: String(data.uf || '') || undefined, aceitaMarketing: form.has('aceitaMarketing'),
        }),
      })
      onCreated()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível cadastrar.'
      setFormError(message)
      notify({ message, kind: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Novo cliente" eyebrow="CADASTRO NO CLUBE" onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid"><Field label="Nome completo" name="nome" placeholder="Ex.: Marina Oliveira" required /><Field label="CPF" name="cpf" placeholder="000.000.000-00" required /><Field label="E-mail" name="email" type="email" placeholder="marina@email.com" /><Field label="Celular" name="telefone" placeholder="(11) 99999-9999" /><Field label="Cidade" name="cidade" placeholder="São Paulo" /><Field label="UF" name="uf" placeholder="SP" maxLength={2} /></div>
      <label className="consent-check"><input type="checkbox" name="aceitaMarketing" /><span className="check-box"><Check size={13} /></span><span>Cliente aceita receber comunicações e ofertas do clube.</span></label>
      {formError ? <div className="form-error" role="alert">{formError}</div> : null}
      <div className="modal-actions"><button className="button button-outline" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? <LoaderCircle size={17} className="spin" /> : <UserRoundPlus size={16} />}{saving ? 'Salvando...' : 'Cadastrar cliente'}</button></div>
    </form>
  </Modal>
}

function ClientDrawer({ client, user, onClose, notify, onChanged }: { client: Client; user: ApiUser; onClose: () => void; notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void; onChanged: () => void }) {
  const [details, setDetails] = useState<Client>(client)
  const [balance, setBalance] = useState<{ pontosSaldo: number; nivel: string; pontosAVencer: number; proximaExpiracao: string | null } | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      try {
        const [person, points, history] = await Promise.all([
        api<{ data: Client }>(`/clientes/${client.id}`),
        api<{ data: { pontosSaldo: number; nivel: string; pontosAVencer: number; proximaExpiracao: string | null } }>(`/pontos/clientes/${client.id}/saldo`),
        api<ApiPage<Transaction>>(`/pontos/clientes/${client.id}/extrato?limit=6`),
        ])
        if (active) {
          setDetails(person.data)
          setBalance(points.data)
          setTransactions(history.data)
        }
      } catch (err) {
        if (active) notify({ message: err instanceof Error ? err.message : 'Falha ao consultar cliente.', kind: 'error' })
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [client.id, notify, refreshKey])

  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="client-drawer" aria-label={`Detalhes de ${client.nome}`}><div className="drawer-header"><span className="section-kicker">PERFIL DO CLUBE</span><button className="icon-button" aria-label="Fechar detalhes" onClick={onClose}><X size={18} /></button></div><div className="drawer-person"><div className={`drawer-avatar avatar-${details.nivel.toLowerCase()}`}>{initials(details.nome)}</div><div><h2>{details.nome}</h2><span className="drawer-email">{details.email ?? 'Sem e-mail cadastrado'}</span></div><LevelBadge level={details.nivel} /></div><div className="drawer-contact"><span><UserRound size={15} /> CPF {formatCpf(details.cpf)}</span><span><Activity size={15} /> {details.telefone ?? 'Sem celular cadastrado'}</span></div>
    <div className="balance-card"><div className="balance-top"><span>SALDO DISPONÍVEL</span><CircleDollarSign size={17} /></div><strong>{loading ? '—' : formatNumber(balance?.pontosSaldo ?? details.pontosSaldo)} <small>pts</small></strong><div className="balance-bottom"><span>Nível {balance?.nivel ?? details.nivel}</span><span>{balance?.pontosAVencer ? `${formatNumber(balance.pontosAVencer)} pts a vencer` : 'Sem pontos próximos do vencimento'}</span></div></div>
    {['ADMIN', 'GERENTE', 'OPERADOR'].includes(user.perfil) ? <button className="button button-primary credit-button" onClick={() => setPurchaseOpen(true)}><Plus size={17} /> Registrar compra e creditar pontos</button> : null}
    <div className="drawer-section-heading"><div><span className="section-kicker">MOVIMENTAÇÕES</span><h3>Extrato de pontos</h3></div><button className="icon-button" aria-label="Atualizar extrato" onClick={() => setRefreshKey((value) => value + 1)}><Activity size={16} /></button></div>
    {loading ? <div className="skeleton-lines"><span /><span /><span /></div> : transactions.length ? <div className="transaction-list">{transactions.map((item) => <div className="transaction-row" key={item.id}><span className={`transaction-icon ${item.tipo === 'CREDITO' ? 'transaction-credit' : 'transaction-debit'}`}>{item.tipo === 'CREDITO' ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><span className="transaction-description"><strong>{item.descricao ?? item.origem}</strong><small>{formatDate(item.criadoEm)}</small></span><strong className={item.tipo === 'CREDITO' ? 'positive-points' : 'negative-points'}>{item.tipo === 'CREDITO' ? '+' : '−'}{formatNumber(item.pontos)}</strong></div>)}</div> : <EmptyState icon={<Activity size={20} />} title="Sem movimentações" description="Este cliente ainda não acumulou pontos." compact />}
    <div className="drawer-footnote"><ShieldCheck size={14} /> Histórico protegido e auditado</div>
    {purchaseOpen ? <PurchaseModal client={details} user={user} onClose={() => setPurchaseOpen(false)} onSuccess={() => { setPurchaseOpen(false); setRefreshKey((value) => value + 1); onChanged() }} notify={notify} /> : null}
  </aside></div>
}

function PurchaseModal({ client, user, onClose, onSuccess, notify }: { client: Client; user: ApiUser; onClose: () => void; onSuccess: () => void; notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void }) {
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [storeId, setStoreId] = useState(String(user.unidadeId ?? client.unidadeCadastroId ?? ''))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setFormError('')
    const form = new FormData(event.currentTarget)
    try {
      const response = await api<{ data: { pontos: number; saldoApos: number; jaProcessado: boolean } }>('/pontos/compras', {
        method: 'POST',
        body: JSON.stringify({ clienteId: client.id, unidadeId: Number(storeId), valor: Number(form.get('valor')), documentoFiscal: String(form.get('documentoFiscal') || '') || undefined }),
      })
      const { pontos, saldoApos, jaProcessado } = response.data
      notify({ message: jaProcessado ? 'Esta nota já havia sido processada.' : `${formatNumber(pontos)} pontos creditados · saldo ${formatNumber(saldoApos)} pts.`, kind: 'success' })
      onSuccess()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível registrar a compra.'
      setFormError(message)
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Registrar compra" eyebrow={`PONTOS PARA ${client.nome.toUpperCase()}`} onClose={onClose}>
    <form className="modal-form" onSubmit={submit}><div className="purchase-highlight"><span className="purchase-highlight-icon"><ShoppingBag size={18} /></span><span><strong>Crédito de pontos</strong><small>O cálculo seguirá a regra ativa da unidade.</small></span></div><Field label="Valor da compra (R$)" name="valor" type="number" min="0.01" step="0.01" placeholder="0,00" required /><label className="field-label" htmlFor="store-id">ID da unidade</label><input className="field-input" id="store-id" inputMode="numeric" type="number" min="1" value={storeId} onChange={(event) => setStoreId(event.target.value)} placeholder="Informe o ID da loja" required /><p className="field-hint">Seu perfil ou o cadastro do cliente pode preencher este campo automaticamente.</p><Field label="Documento fiscal (NFC-e/SAT)" name="documentoFiscal" placeholder="Chave da nota, para evitar duplicidade" maxLength={44} /><p className="field-hint">O documento é opcional, mas garante idempotência se o caixa repetir o envio.</p>{formError ? <div className="form-error" role="alert">{formError}</div> : null}<div className="modal-actions"><button className="button button-outline" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit" disabled={saving || !storeId}>{saving ? <LoaderCircle size={17} className="spin" /> : <CircleDollarSign size={16} />}{saving ? 'Registrando...' : 'Confirmar compra'}</button></div></form>
  </Modal>
}

function RewardsPage({ user, notify }: { user: ApiUser; notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void }) {
  const [rewards, setRewards] = useState<ApiPage<Reward> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedReward, setSelectedReward] = useState<Reward | null>(null)
  const canRedeem = ['ADMIN', 'GERENTE', 'OPERADOR'].includes(user.perfil)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ limit: '100', apenasVigentes: 'false' })
        if (search.trim().length >= 2) params.set('busca', search.trim())
        const result = await api<ApiPage<Reward>>(`/recompensas?${params}`)
        if (active) setRewards(result)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar recompensas.')
      } finally {
        if (active) setLoading(false)
      }
    }, 220)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [search, refreshKey])

  return <section className="page page-enter"><div className="page-heading"><div><div className="eyebrow"><span /> CATÁLOGO DO CLUBE</div><h1>Recompensas</h1><p>Prêmios e experiências disponíveis para resgate.</p></div><span className="catalog-total"><Gift size={16} /> {rewards ? `${formatNumber(rewards.meta.total)} itens` : '—'}</span></div><div className="list-toolbar reward-toolbar"><div className="search-field"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar recompensa ou SKU" aria-label="Buscar recompensas" /></div><span className="toolbar-note"><Sparkles size={15} /> Catálogo ativo da rede</span></div>{error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}
    {loading ? <div className="reward-grid">{[1, 2, 3, 4].map((value) => <div className="reward-skeleton" key={value} />)}</div> : rewards?.data.length ? <div className="reward-grid">{rewards.data.map((reward, index) => <article className={`reward-card reward-card-${index % 4}`} key={reward.id}><div className="reward-card-top"><span className="reward-art"><Gift size={23} /></span><span className={`reward-state ${reward.ativo ? 'reward-state-on' : ''}`}>{reward.ativo ? 'Disponível' : 'Inativa'}</span></div><div className="reward-type">{reward.tipo}</div><h2>{reward.nome}</h2><p>{reward.descricao ?? 'Uma vantagem especial para clientes do clube.'}</p><div className="reward-card-bottom"><span><strong>{formatNumber(reward.pontosCusto)}</strong> pontos</span><span>{reward.estoque === null ? 'Estoque livre' : `${formatNumber(reward.estoque)} un.`}</span></div>{canRedeem && reward.ativo ? <button className="button button-outline button-small reward-redeem-button" onClick={() => setSelectedReward(reward)}><Gift size={14} /> Iniciar resgate</button> : null}</article>)}</div> : <EmptyState icon={<Gift size={22} />} title="Catálogo vazio" description="As recompensas cadastradas pela gerência aparecerão aqui." />}
    {selectedReward ? <RedeemRewardModal reward={selectedReward} user={user} onClose={() => setSelectedReward(null)} onSuccess={(code) => { setSelectedReward(null); notify({ message: `Resgate ${code} criado. Apresente o código no balcão.`, kind: 'success' }) }} /> : null}
  </section>
}

function RedeemRewardModal({ reward, user, onClose, onSuccess }: { reward: Reward; user: ApiUser; onClose: () => void; onSuccess: (code: string) => void }) {
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [storeId, setStoreId] = useState(String(user.unidadeId ?? ''))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      if (search.trim().length < 2 || selectedClient) {
        setClients([])
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const params = new URLSearchParams({ busca: search.trim(), limit: '8', ativo: 'true' })
        const result = await api<ApiPage<Client>>(`/clientes?${params}`)
        if (active) setClients(result.data)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível buscar clientes.')
      } finally {
        if (active) setLoading(false)
      }
    }, 240)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [search, selectedClient])

  async function redeem() {
    if (!selectedClient || !storeId) return
    setSaving(true)
    setError('')
    try {
      const response = await api<{ data: Redemption }>(`/recompensas/${reward.id}/resgates`, {
        method: 'POST',
        body: JSON.stringify({ clienteId: selectedClient.id, unidadeId: Number(storeId) }),
      })
      onSuccess(response.data.codigo)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível concluir o resgate.')
    } finally {
      setSaving(false)
    }
  }

  return <Modal title="Iniciar resgate" eyebrow="BENEFÍCIO DO CLUBE" onClose={onClose}>
    <div className="redeem-summary"><span className="reward-art"><Gift size={20} /></span><span><strong>{reward.nome}</strong><small>{formatNumber(reward.pontosCusto)} pontos · {reward.estoque === null ? 'estoque livre' : `${formatNumber(reward.estoque)} disponíveis`}</small></span></div>
    <div className="modal-form redeem-form">
      {selectedClient ? <div className="selected-client"><span className="mini-avatar">{initials(selectedClient.nome)}</span><span><strong>{selectedClient.nome}</strong><small>{formatNumber(selectedClient.pontosSaldo)} pts disponíveis · {selectedClient.nivel}</small></span><button className="icon-button" aria-label="Trocar cliente" onClick={() => { setSelectedClient(null); setSearch('') }}><X size={16} /></button></div> : <><label className="field-label" htmlFor="redeem-client-search">Buscar cliente<input className="field-input" id="redeem-client-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, CPF ou telefone" autoComplete="off" /></label>{loading ? <div className="client-search-state"><LoaderCircle className="spin" size={16} /> Buscando clientes...</div> : search.length >= 2 && clients.length === 0 ? <div className="client-search-state">Nenhum cliente ativo encontrado.</div> : clients.length ? <div className="client-search-results">{clients.map((client) => <button className="client-search-row" key={client.id} onClick={() => { setSelectedClient(client); setStoreId(String(user.unidadeId ?? client.unidadeCadastroId ?? '')) }}><span className="mini-avatar">{initials(client.nome)}</span><span><strong>{client.nome}</strong><small>{formatCpf(client.cpf)} · {formatNumber(client.pontosSaldo)} pts</small></span><ArrowRight size={15} /></button>)}</div> : <p className="field-hint">Digite pelo menos duas letras para localizar um cliente.</p>}</>}
      <label className="field-label" htmlFor="redeem-store-id">ID da unidade<input className="field-input" id="redeem-store-id" type="number" min="1" value={storeId} onChange={(event) => setStoreId(event.target.value)} placeholder="ID da loja" required /></label>
      {selectedClient && selectedClient.pontosSaldo < reward.pontosCusto ? <div className="form-error">Saldo insuficiente para este resgate.</div> : null}
      {error ? <div className="form-error" role="alert">{error}</div> : null}
      <div className="modal-actions"><button className="button button-outline" onClick={onClose}>Cancelar</button><button className="button button-primary" onClick={() => void redeem()} disabled={saving || !selectedClient || !storeId || selectedClient.pontosSaldo < reward.pontosCusto}>{saving ? <LoaderCircle size={16} className="spin" /> : <Gift size={15} />}{saving ? 'Processando...' : 'Confirmar resgate'}</button></div>
    </div>
  </Modal>
}

function RedemptionsPage({ notify, user }: { notify: (notice: { message: string; kind: 'success' | 'error' } | null) => void; user: ApiUser }) {
  const [status, setStatus] = useState('PENDENTE')
  const today = localDateValue(new Date())
  const [de, setDe] = useState(`${today.slice(0, 7)}-01`)
  const [ate, setAte] = useState(today)
  const [search, setSearch] = useState('')
  const [redemptions, setRedemptions] = useState<ApiPage<Redemption> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState<number | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const canConfirm = ['ADMIN', 'GERENTE', 'OPERADOR'].includes(user.perfil)

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ status, limit: '50' })
        if (de) params.set('de', de)
        if (ate) params.set('ate', ate)
        if (user.unidadeId && !['ADMIN', 'AUDITOR'].includes(user.perfil)) params.set('unidadeId', String(user.unidadeId))
        if (search.trim().length >= 2) params.set('busca', search.trim())
        const result = await api<ApiPage<Redemption>>(`/resgates?${params}`)
        if (active) setRedemptions(result)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Não foi possível carregar resgates.')
      } finally {
        if (active) setLoading(false)
      }
    }, 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [status, de, ate, search, refreshKey, user.perfil, user.unidadeId])

  async function confirmPickup(id: number) {
    setConfirming(id)
    try {
      await api(`/resgates/${id}/confirmar-retirada`, { method: 'POST' })
      notify({ message: 'Retirada confirmada com sucesso.', kind: 'success' })
      setRefreshKey((value) => value + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Não foi possível confirmar retirada.'
      notify({ message, kind: 'error' })
    } finally {
      setConfirming(null)
    }
  }

  return <section className="page page-enter"><div className="page-heading"><div><div className="eyebrow"><span /> BALCÃO DE RETIRADA</div><h1>Resgates</h1><p>Acompanhe os prêmios solicitados e confirme a entrega.</p></div><div className="redemption-total"><span className="pending-pulse" />{redemptions ? `${formatNumber(redemptions.meta.total)} ${status.toLowerCase()}` : 'Carregando'}</div></div>
    <div className="list-toolbar redemption-toolbar"><div className="status-tabs" role="tablist" aria-label="Filtrar status">{[['PENDENTE', 'Pendentes'], ['ENTREGUE', 'Entregues'], ['CANCELADO', 'Cancelados'], ['EXPIRADO', 'Expirados']].map(([value, label]) => <button role="tab" aria-selected={status === value} className={status === value ? 'status-tab status-tab-active' : 'status-tab'} key={value} onClick={() => setStatus(value)}>{label}</button>)}</div><button className="icon-button" aria-label="Atualizar resgates" onClick={() => setRefreshKey((value) => value + 1)}><Activity size={17} /></button></div>
    <div className="inline-filters redemption-filters"><label className="wide-filter">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, cliente, CPF ou recompensa" /></label><label>De<input type="date" value={de} max={ate} onChange={(event) => setDe(event.target.value)} /></label><label>Até<input type="date" value={ate} min={de} onChange={(event) => setAte(event.target.value)} /></label></div>
    {error ? <InlineError message={error} onRetry={() => setRefreshKey((value) => value + 1)} /> : null}
    <section className="panel redemption-panel">{loading ? <TableLoading /> : redemptions?.data.length ? <div className="redemption-list">{redemptions.data.map((item) => <article className="redemption-card" key={item.id}><div className={`redemption-illustration redeem-${item.status.toLowerCase()}`}><Gift size={22} /></div><div className="redemption-main"><div className="redemption-title-row"><h2>{item.recompensaNome ?? 'Recompensa'}</h2><StatusBadge status={item.status} /></div><p>{item.clienteNome ?? `Cliente #${item.clienteId}`} {item.unidadeNome ? `· ${item.unidadeNome}` : ''}</p><div className="redemption-meta"><span><CalendarDays size={14} /> {formatDate(item.criadoEm)}</span><span><ShoppingBag size={14} /> {formatNumber(item.pontosDebitados)} pts</span><span className="redemption-code">{item.codigo}</span></div></div>{item.status === 'PENDENTE' && canConfirm ? <button className="button button-primary button-small confirm-button" onClick={() => void confirmPickup(item.id)} disabled={confirming === item.id}>{confirming === item.id ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />} Confirmar entrega</button> : item.status === 'PENDENTE' ? <span className="redemption-done"><Clock3 size={17} /></span> : <span className="redemption-done"><BadgeCheck size={17} /></span>}</article>)}</div> : <EmptyState icon={<TicketCheck size={22} />} title="Nenhum resgate neste filtro" description="Quando houver movimentações neste status, elas aparecerão aqui." compact />}</section>
  </section>
}

function Modal({ title, eyebrow, children, onClose }: { title: string; eyebrow: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><span className="section-kicker">{eyebrow}</span><h2 id="modal-title">{title}</h2></div><button type="button" className="icon-button" aria-label="Fechar" onClick={onClose}><X size={18} /></button></div>{children}</section></div>
}

function Field({ label, name, placeholder, type = 'text', required = false, maxLength, min, step }: { label: string; name: string; placeholder?: string; type?: string; required?: boolean; maxLength?: number; min?: string; step?: string }) {
  return <label className="field-label" htmlFor={name}>{label}<input className="field-input" id={name} name={name} type={type} placeholder={placeholder} required={required} maxLength={maxLength} min={min} step={step} /></label>
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="inline-error"><span>{message}</span><button onClick={onRetry}>Tentar novamente <ArrowRight size={14} /></button></div>
}

function EmptyState({ icon, title, description, action, compact = false }: { icon: ReactNode; title: string; description: string; action?: ReactNode; compact?: boolean }) {
  return <div className={`empty-state ${compact ? 'empty-state-compact' : ''}`}><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{description}</p>{action}</div>
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = { PENDENTE: 'Pendente', ENTREGUE: 'Entregue', CANCELADO: 'Cancelado', EXPIRADO: 'Expirado' }
  return <span className={`status-badge status-${status.toLowerCase()}`}><i />{labels[status] ?? status}</span>
}

function LevelBadge({ level }: { level: string }) {
  const labels: Record<string, string> = { BRONZE: 'Bronze', PRATA: 'Prata', OURO: 'Ouro', DIAMANTE: 'Diamante' }
  return <span className={`level-badge level-${level.toLowerCase()}`}><i />{labels[level] ?? level}</span>
}

function TableLoading() {
  return <div className="table-loading"><span /><span /><span /><span /><span /></div>
}

function formatCpf(value: string) {
  const digits = value.replace(/\D/g, '')
  return digits.length === 11 ? digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : value
}

export default App
