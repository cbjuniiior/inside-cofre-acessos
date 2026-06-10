import { useCallback, useEffect, useState } from 'react'
import { call } from '../lib/api'
import type { AuditEntry, AuthUser, Profile, Squad } from '../../../shared/types'
import ProfileForm from '../components/ProfileForm'
import AccountModal from '../components/AccountModal'
import TeamModal from '../components/TeamModal'
import ProxyModal from '../components/ProxyModal'
import LogsModal from '../components/LogsModal'
import { actionMeta, timeAgo } from '../lib/auditView'
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
type SquadFilter = 'all' | 'inside' | Squad

const INSIDE_BADGE = {
  label: 'Inside',
  dot: 'bg-brand-500',
  text: 'text-brand-300',
  bg: 'bg-brand-500/15'
}

interface Props {
  user: AuthUser
  onSignOut: () => void
  onLock: () => void
  onAccountChanged: () => void
}

function SquadBadge({ squad }: { squad: Squad | null }): JSX.Element {
  const s = squad ? SQUAD[squad] : INSIDE_BADGE
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
  const [showLogs, setShowLogs] = useState(false)

  const isAdmin = user.role === 'admin'

  function changeView(v: ViewMode): void {
    setView(v)
    localStorage.setItem('cofre_view', v)
  }

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError('')
      try {
        const [p, a] = await Promise.all([
          call(window.api.profiles.list()),
          // O log de atividades é exclusivo de admins.
          isAdmin ? call(window.api.audit.list()) : Promise.resolve([] as AuditEntry[])
        ])
        setProfiles(p)
        setAudit(a)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [isAdmin]
  )

  useEffect(() => {
    void load()
    const onFocus = (): void => void load(true)
    window.addEventListener('focus', onFocus)
    const timer = window.setInterval(() => void load(true), 15000)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.clearInterval(timer)
    }
  }, [load])

  function inUse(p: Profile): boolean {
    if (!p.in_use_by_email || !p.in_use_at) return false
    return Date.now() - new Date(p.in_use_at).getTime() < 10 * 60 * 1000
  }

  function confirmOpenInUse(who: string | null): boolean {
    return confirm(
      `Este perfil está em uso por ${who || 'outro usuário'}. Abrir em dois lugares ao mesmo tempo pode derrubar a sessão (especialmente Gmail).\n\nAbrir mesmo assim?`
    )
  }

  async function open(p: Profile, force = false): Promise<void> {
    if (!force && inUse(p)) {
      if (!confirmOpenInUse(p.in_use_by_name || p.in_use_by_email)) return
      force = true
    }
    try {
      await call(window.api.profiles.open(p.id, force))
      await load(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao abrir o perfil'
      // Lock detectado no servidor (a lista local podia estar desatualizada).
      if (!force && msg.includes('em uso por')) {
        if (confirmOpenInUse(null)) await open(p, true)
        return
      }
      setError(msg)
    }
  }

  async function remove(p: Profile): Promise<void> {
    if (isAdmin) {
      if (!confirm(`Excluir o perfil "${p.client_name}"? A sessão salva também será removida.`)) return
      try {
        await call(window.api.profiles.remove(p.id))
        await load()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao excluir')
      }
      return
    }
    // Membro não exclui direto: solicita e um admin aprova ou recusa.
    if (
      !confirm(
        `Solicitar a exclusão de "${p.client_name}"? O perfil ficará oculto até um admin aprovar.`
      )
    )
      return
    try {
      await call(window.api.profiles.requestDelete(p.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao solicitar exclusão')
    }
  }

  async function approveDelete(p: Profile): Promise<void> {
    if (!confirm(`Aprovar a exclusão de "${p.client_name}"? A sessão salva também será removida.`))
      return
    try {
      await call(window.api.profiles.approveDelete(p.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao aprovar exclusão')
    }
  }

  async function rejectDelete(p: Profile): Promise<void> {
    try {
      await call(window.api.profiles.rejectDelete(p.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao recusar exclusão')
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

  // Exclusões pendentes ficam fora da lista principal; admins as veem na fila de aprovação.
  const pendingDeletes = profiles.filter((p) => p.pending_delete)
  const activeProfiles = profiles.filter((p) => !p.pending_delete)

  const filtered = activeProfiles.filter((p) => {
    if (squadFilter === 'inside' ? p.squad !== null : squadFilter !== 'all' && p.squad !== squadFilter)
      return false
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
          className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_6px_18px_-10px_rgba(229,80,165,0.9)] transition hover:bg-brand-400 active:scale-95"
        >
          Abrir
        </button>
        {isAdmin && (
          <button
            onClick={() => {
              setEditing(p)
              setShowForm(true)
            }}
            className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5"
          >
            Editar
          </button>
        )}
        <button
          onClick={() => remove(p)}
          className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-red-400 transition hover:bg-red-500/10"
          title={isAdmin ? 'Excluir perfil' : 'Solicitar exclusão (um admin precisa aprovar)'}
        >
          Excluir
        </button>
      </div>
    )
  }

  // Membros só enxergam o próprio squad + Inside; o filtro acompanha isso.
  const squadFilters: { value: SquadFilter; label: string; dot?: string }[] = [
    { value: 'all', label: 'Todas' },
    { value: 'inside', label: 'Inside', dot: 'bg-brand-500' },
    ...(isAdmin || user.squad === 'genesis'
      ? [{ value: 'genesis' as const, label: 'Gênesis', dot: 'bg-purple-500' }]
      : []),
    ...(isAdmin || user.squad === 'high_impact'
      ? [{ value: 'high_impact' as const, label: 'High Impact', dot: 'bg-red-500' }]
      : [])
  ]
  const showSquadFilter = isAdmin || user.squad !== null

  return (
    <div className="flex h-full">
      {/* ===== Sidebar ===== */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/30 p-4">
        <div className="px-2 pb-5 pt-2">
          <img src={logo} alt="Inside" className="h-6 w-auto" />
        </div>

        <nav className="space-y-1">
          <div className="nav-item nav-active cursor-default">
            <span className="text-base">🗂️</span>
            Perfis
            <span className="ml-auto font-mono text-xs text-slate-500">{activeProfiles.length}</span>
          </div>
          {isAdmin && (
            <button onClick={() => setShowProxies(true)} className="nav-item">
              <span className="text-base">🛰️</span>
              Proxies
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowTeam(true)} className="nav-item">
              <span className="text-base">👥</span>
              Equipe
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowLogs(true)} className="nav-item">
              <span className="text-base">📜</span>
              Logs
            </button>
          )}
        </nav>

        <div className="mt-auto space-y-2">
          <button
            onClick={() => setShowAccount(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5 text-left transition hover:bg-white/[0.05]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white">
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{displayName}</span>
              <span className="block truncate text-[11px] text-slate-500">
                {isAdmin ? 'Administrador' : 'Membro'}
              </span>
            </span>
          </button>
          <div className="flex gap-2">
            <button onClick={lock} className="btn-ghost flex-1 py-2 text-xs">
              Travar
            </button>
            <button onClick={signOut} className="btn-ghost flex-1 py-2 text-xs">
              Sair
            </button>
          </div>
        </div>
      </aside>

      {/* ===== Conteúdo ===== */}
      <main className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-white/[0.06] px-7 py-5">
          <div>
            <h1 className="font-display text-xl font-bold text-white">Perfis</h1>
            <p className="text-xs text-slate-500">
              <span className="font-mono text-slate-400">{activeProfiles.length}</span> contas ·{' '}
              <span className="font-mono text-slate-400">{filtered.length}</span> exibidas
            </p>
          </div>
          <button
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            className="btn-primary"
          >
            + Novo perfil
          </button>
        </header>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 px-7 pt-5">
          <div className="relative min-w-[220px] flex-1">
            <svg
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente, serviço ou tag…"
              className="field pl-10"
            />
          </div>

          {showSquadFilter && (
            <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-ink-850 p-1">
              {squadFilters.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setSquadFilter(f.value)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    squadFilter === f.value ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.dot && <span className={`h-1.5 w-1.5 rounded-full ${f.dot}`} />}
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 rounded-xl border border-white/[0.07] bg-ink-850 p-1">
            <button
              onClick={() => changeView('list')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                view === 'list' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ☰ Lista
            </button>
            <button
              onClick={() => changeView('cards')}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                view === 'cards' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              ▦ Cards
            </button>
          </div>
        </div>

        {error && <p className="mx-7 mt-3 text-sm text-red-400">{error}</p>}

        {/* Fila de exclusões aguardando aprovação (só admins) */}
        {isAdmin && pendingDeletes.length > 0 && (
          <div className="mx-7 mt-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4">
            <p className="mb-3 text-sm font-semibold text-amber-300">
              ⏳ Exclusões aguardando aprovação ({pendingDeletes.length})
            </p>
            <ul className="space-y-2">
              {pendingDeletes.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-850 p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-white">{p.client_name}</p>
                      <SquadBadge squad={p.squad} />
                    </div>
                    <p className="text-xs text-slate-500">
                      solicitada por {p.delete_requested_by_name || 'membro'}
                      {p.delete_requested_at
                        ? ` · ${new Date(p.delete_requested_at).toLocaleString('pt-BR')}`
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => approveDelete(p)}
                      className="rounded-lg bg-red-500/90 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500"
                    >
                      Aprovar exclusão
                    </button>
                    <button
                      onClick={() => rejectDelete(p)}
                      className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/5"
                    >
                      Recusar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-7 pb-7 pt-5">
          {loading ? (
            <p className="text-sm text-slate-400">Carregando perfis…</p>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-3 text-5xl opacity-30">🗂️</div>
              <p className="text-sm text-slate-400">Nenhum perfil aqui.</p>
            </div>
          ) : view === 'list' ? (
            <ul className="space-y-2">
              {filtered.map((p, i) => {
                const sq = p.squad ? SQUAD[p.squad] : null
                return (
                  <li
                    key={p.id}
                    style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                    className={`card animate-fade-up flex items-center gap-3.5 border-l-2 p-3.5 transition hover:border-white/[0.14] hover:bg-white/[0.02] ${
                      sq ? sq.border : 'border-l-white/[0.1]'
                    }`}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-lg">
                      {SERVICE_ICON[p.service]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-white">{p.client_name}</p>
                        <SquadBadge squad={p.squad} />
                      </div>
                      <p className="truncate font-mono text-xs text-slate-500">
                        {SERVICE_LABEL[p.service]} · {p.url}
                      </p>
                    </div>
                    {inUse(p) && (
                      <span className="hidden items-center gap-1.5 text-[11px] font-medium text-amber-400 md:flex">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                        {p.in_use_by_name || p.in_use_by_email}
                      </span>
                    )}
                    {p.needs_login && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        relogar
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
            <ul className="grid grid-cols-1 gap-3.5 md:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((p, i) => {
                const sq = p.squad ? SQUAD[p.squad] : null
                return (
                  <li
                    key={p.id}
                    style={{ animationDelay: `${Math.min(i, 12) * 28}ms` }}
                    className={`card animate-fade-up group border-l-2 p-4 transition hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-glow ${
                      sq ? sq.border : 'border-l-white/[0.1]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] text-xl">
                          {SERVICE_ICON[p.service]}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-white">{p.client_name}</p>
                          <p className="truncate font-mono text-xs text-slate-500">
                            {SERVICE_LABEL[p.service]}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {p.needs_login && (
                          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                            relogar
                          </span>
                        )}
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
                      <SquadBadge squad={p.squad} />
                      {p.tags.map((t) => (
                        <span key={t} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400">
                          {t}
                        </span>
                      ))}
                    </div>

                    {inUse(p) && (
                      <p className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-amber-400">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
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

      {/* ===== Atividade (log — exclusivo de admins) ===== */}
      {isAdmin && (
        <aside className="hidden w-72 shrink-0 flex-col overflow-auto border-l border-white/[0.06] p-5 xl:flex">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Atividade recente
            </h2>
            <button
              onClick={() => setShowLogs(true)}
              className="text-[11px] font-medium text-brand-300 hover:text-brand-200"
            >
              ver tudo →
            </button>
          </div>
          <p className="mb-4 text-[10px] text-slate-600">Log de ações da equipe · só admins veem</p>
          {audit.length === 0 ? (
            <p className="text-xs text-slate-600">Sem registros.</p>
          ) : (
            <ul className="space-y-3.5">
              {audit.slice(0, 50).map((a) => (
                <li key={a.id} className="flex gap-3 text-xs">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${actionMeta(a.action).dot}`}
                  />
                  <div className="min-w-0">
                    <p className="text-slate-300">
                      <span className="font-medium text-white">
                        {a.user_name || a.user_email || 'alguém'}
                      </span>{' '}
                      {a.action}
                      {a.profile_name ? (
                        <span className="text-slate-400"> · {a.profile_name}</span>
                      ) : (
                        ''
                      )}
                    </p>
                    {a.detail && (
                      <p className="mt-0.5 text-[11px] text-slate-500" title={a.detail}>
                        {a.detail}
                      </p>
                    )}
                    <p
                      className="mt-0.5 font-mono text-[10px] text-slate-600"
                      title={new Date(a.created_at).toLocaleString('pt-BR')}
                    >
                      {timeAgo(a.created_at)} ·{' '}
                      {new Date(a.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {showForm && (
        <ProfileForm
          profile={editing}
          user={user}
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
      {showLogs && <LogsModal onClose={() => setShowLogs(false)} />}
    </div>
  )
}
