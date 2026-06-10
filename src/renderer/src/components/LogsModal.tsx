import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from '../lib/api'
import { actionMeta, dayLabel, timeAgo } from '../lib/auditView'
import type { AuditCategory, AuditEntry, Member } from '../../../shared/types'

const PAGE_SIZE = 50

const CATEGORIES: { value: AuditCategory | ''; label: string }[] = [
  { value: '', label: 'Todas as ações' },
  { value: 'perfil', label: 'Perfis' },
  { value: 'sessao', label: 'Sessões' },
  { value: 'equipe', label: 'Equipe' },
  { value: 'cofre', label: 'Cofre' },
  { value: 'proxy', label: 'Proxies' },
  { value: 'login', label: 'Logins' }
]

interface Props {
  onClose: () => void
}

export default function LogsModal({ onClose }: Props): JSX.Element {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [search, setSearch] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [category, setCategory] = useState<AuditCategory | ''>('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const debounce = useRef<number>()

  const fetchPage = useCallback(
    async (before?: string): Promise<AuditEntry[]> => {
      return call(
        window.api.audit.query({
          search: search.trim() || undefined,
          userEmail: userEmail || undefined,
          category: category || undefined,
          before
        })
      )
    },
    [search, userEmail, category]
  )

  // Recarrega ao mudar filtros (busca com debounce).
  useEffect(() => {
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const page = await fetchPage()
        setEntries(page)
        setHasMore(page.length === PAGE_SIZE)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao carregar logs')
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => window.clearTimeout(debounce.current)
  }, [fetchPage])

  useEffect(() => {
    void (async () => {
      try {
        setMembers(await call(window.api.members.list()))
      } catch {
        /* sem lista de membros o filtro fica só com busca livre */
      }
    })()
  }, [])

  async function loadMore(): Promise<void> {
    const last = entries[entries.length - 1]
    if (!last) return
    setLoadingMore(true)
    try {
      const page = await fetchPage(last.created_at)
      setEntries((prev) => [...prev, ...page])
      setHasMore(page.length === PAGE_SIZE)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar mais')
    } finally {
      setLoadingMore(false)
    }
  }

  function exportCsv(): void {
    const esc = (v: string | null): string => `"${(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['data', 'usuario', 'email', 'acao', 'alvo', 'detalhe'].join(';'),
      ...entries.map((a) =>
        [
          esc(new Date(a.created_at).toLocaleString('pt-BR')),
          esc(a.user_name),
          esc(a.user_email),
          esc(a.action),
          esc(a.profile_name),
          esc(a.detail)
        ].join(';')
      )
    ]
    // ﻿ (BOM) para o Excel abrir com acentuação correta.
    const blob = new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `logs-atividades-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function clearFilters(): void {
    setSearch('')
    setUserEmail('')
    setCategory('')
  }

  const hasFilters = Boolean(search.trim() || userEmail || category)

  // Agrupa por dia preservando a ordem (mais recente primeiro).
  const groups: { day: string; items: AuditEntry[] }[] = []
  for (const a of entries) {
    const day = dayLabel(a.created_at)
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(a)
    else groups.push({ day, items: [a] })
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="card animate-scale-in flex h-full w-full max-w-3xl flex-col p-6">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-white">Logs de atividades</h2>
          <button
            onClick={exportCsv}
            disabled={entries.length === 0}
            className="btn-ghost py-1.5 text-xs disabled:opacity-40"
            title="Exporta as entradas carregadas abaixo"
          >
            ⬇ Exportar CSV
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-400">
          Tudo o que a equipe fez no cofre. Use os filtros para investigar.
        </p>

        {/* Filtros */}
        <div className="mb-4 flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
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
              placeholder="Buscar por usuário, perfil, ação ou detalhe…"
              className="field pl-9"
            />
          </div>
          <select value={userEmail} onChange={(e) => setUserEmail(e.target.value)} className="field w-auto">
            <option value="">Todos os membros</option>
            {members.map((m) => (
              <option key={m.id} value={m.email ?? ''}>
                {m.name || m.email}
              </option>
            ))}
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as AuditCategory | '')}
            className="field w-auto"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="btn-ghost py-2 text-xs">
              Limpar
            </button>
          )}
        </div>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {/* Lista */}
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {loading ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-500">
              {hasFilters ? 'Nada encontrado com esses filtros.' : 'Sem registros.'}
            </p>
          ) : (
            <>
              {groups.map((g) => (
                <div key={g.day} className="mb-4">
                  <p className="sticky top-0 z-[1] mb-2 bg-ink-900/95 py-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500 backdrop-blur">
                    {g.day}
                  </p>
                  <ul className="space-y-2">
                    {g.items.map((a) => (
                      <li
                        key={a.id}
                        className="flex gap-3 rounded-lg border border-white/[0.06] bg-ink-850 p-3 text-xs"
                      >
                        <span
                          className={`mt-1 h-2 w-2 shrink-0 rounded-full ${actionMeta(a.action).dot}`}
                        />
                        <div className="min-w-0 flex-1">
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
                          {a.detail && <p className="mt-0.5 text-[11px] text-slate-500">{a.detail}</p>}
                          {a.user_email && a.user_name && (
                            <p className="mt-0.5 text-[10px] text-slate-600">{a.user_email}</p>
                          )}
                        </div>
                        <p
                          className="shrink-0 font-mono text-[10px] text-slate-600"
                          title={new Date(a.created_at).toLocaleString('pt-BR')}
                        >
                          {timeAgo(a.created_at)}
                          <br />
                          {new Date(a.created_at).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {hasMore && (
                <div className="pb-2 text-center">
                  <button onClick={loadMore} disabled={loadingMore} className="btn-ghost text-xs">
                    {loadingMore ? 'Carregando…' : 'Carregar mais'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-400 hover:text-slate-200"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
