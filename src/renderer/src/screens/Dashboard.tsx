import { useCallback, useEffect, useState } from 'react'
import { call } from '../lib/api'
import type { AuditEntry, AuthUser, Profile, Squad } from '../../../shared/types'
import ProfileForm from '../components/ProfileForm'
import AccountModal from '../components/AccountModal'
import TeamModal from '../components/TeamModal'
import ProxyModal from '../components/ProxyModal'
import logo from '../assets/inside-logo.svg'

const SERVICE_LABEL: Record<Profile['service'], string> = {
  gmail: 'Gmail',
  hostinger: 'Hostinger',
  cpanel: 'cPanel',
  outro: 'Outro'
}

const SERVICE_ICON: Record<Profile['service'], string> = {
  gmail: '✉️',
  hostinger: '🌐',
  cpanel: '🛠️',
  outro: '🔗'
}

const SQUAD: Record<Squad, { label: string; dot: string; text: string; bg: string; border: string }> = {
  genesis: {
    label: 'Gênesis',
    dot: 'bg-purple-500',
    text: 'text-purple-300',
    bg: 'bg-purple-500/15',
    border: 'border-l-purple-500'
  },
  high_impact: {
    label: 'High Impact',
    dot: 'bg-red-500',
    text: 'text-red-300',
    bg: 'bg-red-500/15',
    border: 'border-l-red-500'
  }
}

type ViewMode = 'list' | 'cards'
type SquadFilter = 'all' | Squad

interface Props {
  user: AuthUser
  onSignOut: () => void
  onLock: () => void
  onAccountChanged: () => void
}

function SquadBadge({ squad }: { squad: Squad }): JSX.Element {
  const s = SQUAD[squad]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full ${s.bg} px-2 py-0.5 text-[10px] font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  )
}

export default function Dashboard({ user, onSignOut, onLock, onAccountChanged }: Props): JSX.Element {
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [squadFilter, setSquadFilter] = useState<SquadFilter>('all')
  const [view, setView] = useState<ViewMode>(
    () => (localStorage.getItem('cofre_view') as ViewMode) || 'list'
  )
  const [editing, setEditing] = useState<Profile | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showAccount, setShowAccount] = useState(false)
  const [showTeam, setShowTeam] = useState(false)
  const [showProxies, setShowProxies] = useState(false)

  const isAdmin = user.role === 'admin'

  function changeView(v: ViewMode): void {
    setView(v)
    localStorage.setItem('cofre_view', v)
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [p, a] = await Promise.all([
        call(window.api.profiles.list()),
        call(window.api.audit.list())
      ])
      setProfiles(p)
      setAudit(a)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function open(p: Profile): Promise<void> {
    try {
      await call(window.api.profiles.open(p.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir o perfil')
    }
  }

  async function remove(p: Profile): Promise<void> {
    if (!confirm(`Excluir o perfil "${p.client_name}"? A sessão salva também será removida.`)) return
    try {
      await call(window.api.profiles.remove(p.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir')
    }
  }

  async function lock(): Promise<void> {
    await call(window.api.vault.lock())
    onLock()
  }

  async function signOut(): Promise<void> {
    await call(window.api.auth.signOut())
    onSignOut()
  }

  const filtered = profiles.filter((p) => {
    if (squadFilter !== 'all' && p.squad !== squadFilter) return false
    const q = search.toLowerCase()
    return (
      p.client_name.toLowerCase().includes(q) ||
      p.service.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
    )
  })

  const displayName = user.name && user.name !== user.email ? user.name : user.email
  const initial = (displayName || '?').charAt(0).toUpperCase()

  function Actions({ p }: { p: Profile }): JSX.Element {
    return (
      <div className="flex shrink-0 gap-2">
        <button
          onClick={() => open(p)}
          className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600"
        >
          Abrir
        </button>
        {isAdmin && (
          <>
            <button
              onClick={() => {
                setEditing(p)
                setShowForm(true)
              }}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/5"
            >
              Editar
            </button>
            <button
              onClick={() => remove(p)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
            >
              Excluir
            </button>
          </>
        )}
      </div>
    )
  }

  const squadFilters: { value: SquadFilter; label: string; dot?: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'genesis', label: 'Gênesis', dot: 'bg-purple-500' },
    { value: 'high_impact', label: 'High Impact', dot: 'bg-red-500' }
  ]

  return (
    <div className="flex h-full flex-col bg-ink-900">
      <header className="flex items-center justify-between border-b border-white/5 px-6 py-4">
        <div className="flex items-center gap-3">
          <img src={logo} alt="Inside" className="h-6 w-auto" />
          <span className="h-7 w-px bg-white/10" />
          <div>
            <h1 className="text-sm font-semibold text-white">Cofre de Acessos</h1>
            <p className="text-xs text-slate-400">{profiles.length} perfis</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                setEditing(null)
                setShowForm(true)
              }}
              className="btn-primary"
            >
              + Novo perfil
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowProxies(true)} className="btn-ghost">
              Proxies
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowTeam(true)} className="btn-ghost">
              Equipe
            </button>
          )}
          <button
            onClick={() => setShowAccount(true)}
            className="flex items-center gap-2 rounded-lg border border-white/10 py-1.5 pl-1.5 pr-3 text-sm font-medium text-slate-300 transition hover:bg-white/5"
            title="Minha conta"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-xs font-bold text-white">
              {initial}
            </span>
            <span className="max-w-[140px] truncate">{displayName}</span>
          </button>
          <button onClick={lock} className="btn-ghost">
            Travar
          </button>
          <button onClick={signOut} className="btn-ghost">
            Sair
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 flex-col p-6">
          {/* Barra de ferramentas: busca + filtros de squad + alternância de view */}
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, serviço ou tag…"
              className="field min-w-[220px] flex-1"
            />

            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-ink-800 p-1">
              {squadFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setSquadFilter(f.value)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    squadFilter === f.value
                      ? 'bg-white/10 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-ink-800 p-1">
              <button
                onClick={() => changeView('list')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  view === 'list' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Lista"
              >
                ☰ Lista
              </button>
              <button
                onClick={() => changeView('cards')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  view === 'cards' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Cards"
              >
                ▦ Cards
              </button>
            </div>
          </div>

          {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <p className="text-sm text-slate-400">Carregando perfis…</p>
            ) : filtered.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-3 text-4xl opacity-40">🗂️</div>
                <p className="text-sm text-slate-400">Nenhum perfil aqui.</p>
              </div>
            ) : view === 'list' ? (
              <ul className="space-y-2">
                {filtered.map((p) => {
                  const sq = p.squad ? SQUAD[p.squad] : null
                  return (
                    <li
                      key={p.id}
                      className={`card flex items-center gap-3 border-l-2 p-3 transition hover:bg-white/[0.03] ${
                        sq ? sq.border : 'border-l-white/10'
                      }`}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-750 text-base">
                        {SERVICE_ICON[p.service]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-medium text-white">{p.client_name}</p>
                          {p.squad && <SquadBadge squad={p.squad} />}
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {SERVICE_LABEL[p.service]} · {p.url}
                        </p>
                      </div>
                      {p.in_use_by_email && (
                        <span className="hidden items-center gap-1.5 text-[11px] font-medium text-amber-400 md:flex">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          {p.in_use_by_name || p.in_use_by_email}
                        </span>
                      )}
                      {p.has_session && (
                        <span className="hidden rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400 sm:inline">
                          sessão
                        </span>
                      )}
                      {p.proxy_id && (
                        <span className="hidden rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400 sm:inline">
                          proxy
                        </span>
                      )}
                      <Actions p={p} />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => {
                  const sq = p.squad ? SQUAD[p.squad] : null
                  return (
                    <li
                      key={p.id}
                      className={`card group border-l-2 p-4 transition hover:border-brand-500/40 hover:shadow-glow ${
                        sq ? sq.border : 'border-l-white/10'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-750 text-lg">
                            {SERVICE_ICON[p.service]}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-white">{p.client_name}</p>
                            <p className="truncate text-xs text-slate-500">
                              {SERVICE_LABEL[p.service]} · {p.url}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          {p.has_session && (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                              sessão
                            </span>
                          )}
                          {p.proxy_id && (
                            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-400">
                              proxy
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-1">
                        {p.squad && <SquadBadge squad={p.squad} />}
                        {p.tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400"
                          >
                            {t}
                          </span>
                        ))}
                      </div>

                      {p.in_use_by_email && (
                        <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          em uso por {p.in_use_by_name || p.in_use_by_email}
                        </p>
                      )}

                      <div className="mt-4">
                        <Actions p={p} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </main>

        <aside className="hidden w-72 shrink-0 overflow-auto border-l border-white/5 p-5 lg:block">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Atividade recente
          </h2>
          {audit.length === 0 ? (
            <p className="text-xs text-slate-600">Sem registros.</p>
          ) : (
            <ul className="space-y-3">
              {audit.slice(0, 30).map((a) => (
                <li key={a.id} className="text-xs text-slate-400">
                  <span className="font-medium text-slate-200">
                    {a.user_name || a.user_email || 'alguém'}
                  </span>{' '}
                  {a.action}
                  {a.profile_name ? <span className="text-slate-500"> · {a.profile_name}</span> : ''}
                  <span className="mt-0.5 block text-[10px] text-slate-600">
                    {new Date(a.created_at).toLocaleString('pt-BR')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {showForm && (
        <ProfileForm
          profile={editing}
          onClose={() => setShowForm(false)}
          onSaved={async () => {
            setShowForm(false)
            await load()
          }}
        />
      )}

      {showAccount && (
        <AccountModal user={user} onClose={() => setShowAccount(false)} onUpdated={onAccountChanged} />
      )}

      {showTeam && <TeamModal currentUser={user} onClose={() => setShowTeam(false)} />}

      {showProxies && <ProxyModal onClose={() => setShowProxies(false)} />}
    </div>
  )
}
