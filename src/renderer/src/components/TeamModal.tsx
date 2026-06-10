import { useEffect, useState } from 'react'
import { call } from '../lib/api'
import type { AuthUser, Member, Role, Squad, VaultAccess } from '../../../shared/types'

const SQUAD_CHOICES: { value: Squad | ''; label: string }[] = [
  { value: '', label: 'Inside (toda a equipe)' },
  { value: 'genesis', label: 'Gênesis' },
  { value: 'high_impact', label: 'High Impact' }
]

interface Props {
  currentUser: AuthUser
  onClose: () => void
}

const DOWNLOAD_URL = 'https://github.com/cbjuniiior/inside-cofre-acessos/releases/latest'

function welcomeMessage(email: string, password: string, fromName: string): string {
  return `Olá! 👋 Você foi adicionado(a) ao *Inside Cofre de Acessos* — o app que a equipe usa pra acessar as contas dos clientes.

📥 *Baixe e instale o app:*
${DOWNLOAD_URL}
(No Windows, baixe o arquivo que termina em *setup.exe*. Se aparecer aviso do Windows, clique em "Mais informações → Executar assim mesmo".)

🔑 *Seu acesso:*
E-mail: ${email}
Senha temporária: ${password}

➡️ *Primeiros passos:*
1. Instale e abra o app
2. Entre com o e-mail e a senha acima
3. Troque sua senha em "Conta → Alterar senha"
4. Me avise que eu libero seu acesso ao cofre (vou te enviar uma 2ª senha, a do cofre)

Qualquer dúvida, é só chamar! — ${fromName}`
}

function vaultMessage(password: string, fromName: string): string {
  return `Pronto! 🔐 Liberei seu acesso ao *cofre* do Inside Cofre de Acessos.

🔑 *Senha do cofre (a 2ª senha):*
${password}

➡️ *No app:*
1. Faça login normalmente (seu e-mail + senha)
2. Quando pedir a "senha do cofre", use a senha acima
3. Depois troque por uma senha sua em "Conta → Senha do cofre"

Agora você já consegue abrir as contas dos clientes! — ${fromName}`
}

export default function TeamModal({ currentUser, onClose }: Props): JSX.Element {
  const [members, setMembers] = useState<Member[]>([])
  const [access, setAccess] = useState<Map<string, VaultAccess>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tempFor, setTempFor] = useState<{ name: string; password: string } | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newSquad, setNewSquad] = useState<Squad | ''>('')
  const [creating, setCreating] = useState(false)
  const [loginTemp, setLoginTemp] = useState<{ email: string; password: string } | null>(null)
  const [copied, setCopied] = useState('')

  function copy(text: string, tag: string): void {
    void navigator.clipboard?.writeText(text)
    setCopied(tag)
    window.setTimeout(() => setCopied(''), 2000)
  }

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

  async function setSquad(m: Member, squad: Squad | null): Promise<void> {
    try {
      await call(window.api.members.setSquad(m.id, squad))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao alterar squad')
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

  async function addMember(): Promise<void> {
    setCreating(true)
    setError('')
    try {
      const r = await call(
        window.api.members.create(newEmail.trim(), newName.trim(), newSquad === '' ? null : newSquad)
      )
      setLoginTemp({ email: r.email, password: r.tempPassword })
      setNewEmail('')
      setNewName('')
      setNewSquad('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao adicionar membro')
    } finally {
      setCreating(false)
    }
  }

  async function removeMember(m: Member): Promise<void> {
    if (!confirm(`Remover "${m.name || m.email}" do time? A conta de login será apagada.`)) return
    try {
      await call(window.api.members.remove(m.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao remover')
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="card animate-scale-in flex max-h-full w-full max-w-2xl flex-col p-6">
        <h2 className="mb-1 font-display text-xl font-bold text-white">Equipe</h2>
        <p className="mb-4 text-sm text-slate-400">
          Admins gerenciam perfis, papéis e o acesso ao cofre.
        </p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {/* Adicionar membro */}
        <div className="mb-4 rounded-xl border border-white/10 bg-ink-850 p-3">
          <p className="mb-2 text-sm font-medium text-slate-300">Adicionar membro</p>
          <div className="flex flex-wrap gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome"
              className="field min-w-[120px] flex-1"
            />
            <input
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              type="email"
              placeholder="e-mail"
              className="field min-w-[160px] flex-1"
            />
            <select
              value={newSquad}
              onChange={(e) => setNewSquad(e.target.value as Squad | '')}
              className="field min-w-[150px] flex-1"
              title="Squad do membro: define quais acessos ele enxerga"
            >
              {SQUAD_CHOICES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={addMember}
              disabled={creating || !newEmail.trim()}
              className="btn-primary"
            >
              {creating ? 'Criando…' : 'Adicionar'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Membro de um squad vê os acessos do squad + os marcados como Inside. Membro Inside vê
            só os acessos Inside. Admins veem tudo.
          </p>
          {loginTemp && (
            <div className="mt-3 rounded-lg border border-brand-500/40 bg-brand-500/10 p-3 text-sm text-slate-200">
              <p className="mb-2 font-medium text-white">✅ Membro criado</p>
              <div className="space-y-1 text-[13px]">
                <p>
                  E-mail: <b>{loginTemp.email}</b>
                </p>
                <p className="flex items-center gap-2">
                  Senha temporária:
                  <code className="rounded bg-ink-950 px-2 py-0.5 font-bold text-brand-300">
                    {loginTemp.password}
                  </code>
                  <button
                    onClick={() => copy(loginTemp.password, 'pw')}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    {copied === 'pw' ? 'copiado ✓' : 'copiar senha'}
                  </button>
                </p>
              </div>
              <button
                onClick={() =>
                  copy(welcomeMessage(loginTemp.email, loginTemp.password, currentUser.name), 'msg')
                }
                className="mt-3 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
              >
                {copied === 'msg' ? 'Mensagem copiada ✓' : '📋 Copiar mensagem pro WhatsApp'}
              </button>
              <p className="mt-2 text-[11px] text-slate-400">
                Cole no WhatsApp do colaborador. Depois, conceda o acesso ao cofre abaixo.
              </p>
            </div>
          )}
        </div>

        {tempFor && (
          <div className="mb-4 rounded-lg border border-brand-500/40 bg-brand-500/10 p-3">
            <p className="text-sm text-slate-200">
              Senha temporária do cofre para <b>{tempFor.name}</b>:
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="rounded bg-ink-950 px-3 py-1.5 text-sm font-bold tracking-wide text-brand-300">
                {tempFor.password}
              </code>
              <button onClick={() => copy(tempFor.password, 'vpw')} className="btn-ghost py-1.5">
                {copied === 'vpw' ? 'copiado ✓' : 'copiar senha'}
              </button>
              <button
                onClick={() => setTempFor(null)}
                className="ml-auto text-xs text-slate-500 hover:text-slate-300"
              >
                ok, já anotei
              </button>
            </div>
            <button
              onClick={() => copy(vaultMessage(tempFor.password, currentUser.name), 'vmsg')}
              className="mt-3 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              {copied === 'vmsg' ? 'Mensagem copiada ✓' : '📋 Copiar mensagem pro WhatsApp'}
            </button>
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

                      {/* Squad */}
                      <select
                        value={m.squad ?? ''}
                        onChange={(e) =>
                          setSquad(m, e.target.value === '' ? null : (e.target.value as Squad))
                        }
                        className="field w-auto shrink-0 px-2 py-1 text-xs"
                        title="Define quais acessos este membro enxerga"
                      >
                        {SQUAD_CHOICES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.value === '' ? 'Inside' : s.label}
                          </option>
                        ))}
                      </select>

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

                      {!isSelf && (
                        <button
                          onClick={() => removeMember(m)}
                          className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10"
                          title="Remover do time"
                        >
                          Remover
                        </button>
                      )}
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
