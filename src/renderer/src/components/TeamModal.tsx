import { useEffect, useState } from 'react'
import { call } from '../lib/api'
import type { AuthUser, Member, Role, VaultAccess } from '../../../shared/types'

interface Props {
  currentUser: AuthUser
  onClose: () => void
}

export default function TeamModal({ currentUser, onClose }: Props): JSX.Element {
  const [members, setMembers] = useState<Member[]>([])
  const [access, setAccess] = useState<Map<string, VaultAccess>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tempFor, setTempFor] = useState<{ name: string; password: string } | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError('')
    try {
      const [m, a] = await Promise.all([
        call(window.api.members.list()),
        call(window.api.vault.listAccess())
      ])
      setMembers(m)
      setAccess(new Map(a.map((x) => [x.user_id, x])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function setRole(m: Member, role: Role): Promise<void> {
    try {
      await call(window.api.members.setRole(m.id, role))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar papel')
    }
  }

  async function grant(m: Member): Promise<void> {
    setError('')
    try {
      const temp = await call(window.api.vault.grantAccess(m.id))
      setTempFor({ name: m.name || m.email || 'membro', password: temp })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao conceder acesso')
    }
  }

  async function revoke(m: Member): Promise<void> {
    if (!confirm(`Revogar o acesso ao cofre de "${m.name || m.email}"?`)) return
    try {
      await call(window.api.vault.revokeAccess(m.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao revogar')
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="card flex max-h-full w-full max-w-2xl flex-col p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-white">Equipe</h2>
        <p className="mb-4 text-sm text-slate-400">
          Admins gerenciam perfis, papéis e o acesso ao cofre.
        </p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {tempFor && (
          <div className="mb-4 rounded-lg border border-brand-500/40 bg-brand-500/10 p-3">
            <p className="text-sm text-slate-200">
              Senha temporária do cofre para <b>{tempFor.name}</b>:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded bg-ink-950 px-3 py-1.5 text-sm font-bold tracking-wide text-brand-300">
                {tempFor.password}
              </code>
              <button
                onClick={() => navigator.clipboard?.writeText(tempFor.password)}
                className="btn-ghost py-1.5"
              >
                Copiar
              </button>
              <button
                onClick={() => setTempFor(null)}
                className="ml-auto text-xs text-slate-500 hover:text-slate-300"
              >
                ok, já anotei
              </button>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Repasse com segurança. No primeiro acesso, peça para a pessoa trocar em “Conta → Senha do cofre”.
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : (
            <ul className="space-y-2">
              {members.map((m) => {
                const isSelf = m.id === currentUser.id
                const acc = access.get(m.id)
                const hasAccess = Boolean(acc)
                return (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-850 p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        {m.name || m.email}
                        {isSelf && <span className="ml-1 text-xs text-slate-500">(você)</span>}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {m.email}
                        {hasAccess ? (
                          <span className="ml-2 text-emerald-400">
                            • acesso ao cofre{acc?.must_change ? ' (senha temporária)' : ''}
                          </span>
                        ) : (
                          <span className="ml-2 text-slate-500">• sem acesso ao cofre</span>
                        )}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {/* Acesso ao cofre */}
                      {hasAccess ? (
                        <>
                          <button onClick={() => grant(m)} className="btn-ghost py-1 text-xs">
                            Resetar senha
                          </button>
                          {!isSelf && (
                            <button
                              onClick={() => revoke(m)}
                              className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10"
                            >
                              Revogar
                            </button>
                          )}
                        </>
                      ) : (
                        <button
                          onClick={() => grant(m)}
                          className="rounded-lg bg-brand-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-600"
                        >
                          Conceder acesso
                        </button>
                      )}

                      {/* Papel */}
                      <div className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-ink-800 p-1">
                        {(['member', 'admin'] as Role[]).map((r) => (
                          <button
                            key={r}
                            disabled={isSelf || m.role === r}
                            onClick={() => setRole(m, r)}
                            className={`rounded-md px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
                              m.role === r
                                ? r === 'admin'
                                  ? 'bg-brand-500 text-white'
                                  : 'bg-white/10 text-white'
                                : 'text-slate-400 hover:text-slate-200 disabled:opacity-40'
                            }`}
                            title={isSelf ? 'Você não pode alterar o próprio papel' : ''}
                          >
                            {r === 'admin' ? 'Admin' : 'Membro'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end">
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
