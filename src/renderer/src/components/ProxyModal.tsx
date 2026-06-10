import { useEffect, useState } from 'react'
import { call } from '../lib/api'
import type { Proxy, ProxyInput, ProxyProtocol } from '../../../shared/types'

const EMPTY = {
  label: '',
  host: '',
  port: '',
  protocol: 'http' as ProxyProtocol,
  username: '',
  password: ''
}

export default function ProxyModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<{ id: string | 'form'; msg: string; ok: boolean } | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError('')
    try {
      setProxies(await call(window.api.proxies.list()))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function reset(): void {
    setForm({ ...EMPTY })
    setEditingId(null)
    setTest(null)
  }

  function startEdit(p: Proxy): void {
    setEditingId(p.id)
    setForm({
      label: p.label,
      host: p.host,
      port: String(p.port),
      protocol: p.protocol,
      username: '',
      password: ''
    })
    setTest(null)
  }

  function formToInput(): ProxyInput {
    return {
      label: form.label.trim(),
      host: form.host.trim(),
      port: Number(form.port),
      protocol: form.protocol,
      username: form.username || null,
      password: form.password || null
    }
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError('')
    try {
      if (editingId) await call(window.api.proxies.update(editingId, formToInput()))
      else await call(window.api.proxies.create(formToInput()))
      reset()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: Proxy): Promise<void> {
    if (!confirm(`Excluir o proxy "${p.label}"? Perfis que o usam ficarão sem proxy.`)) return
    try {
      await call(window.api.proxies.remove(p.id))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir')
    }
  }

  async function testForm(): Promise<void> {
    setTest({ id: 'form', msg: 'Testando…', ok: true })
    try {
      const { ip } = await call(window.api.proxies.test(formToInput()))
      setTest({ id: 'form', msg: `IP de saída: ${ip}`, ok: true })
    } catch (e) {
      setTest({ id: 'form', msg: e instanceof Error ? e.message : 'Falha', ok: false })
    }
  }

  async function testSaved(p: Proxy): Promise<void> {
    setTest({ id: p.id, msg: 'Testando…', ok: true })
    try {
      const { ip } = await call(window.api.proxies.testSaved(p.id))
      setTest({ id: p.id, msg: `IP: ${ip}`, ok: true })
    } catch (e) {
      setTest({ id: p.id, msg: e instanceof Error ? e.message : 'Falha', ok: false })
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="card flex max-h-full w-full max-w-2xl flex-col p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-white">Proxies</h2>
        <p className="mb-4 text-sm text-slate-400">
          Cadastre proxies reutilizáveis e atribua a perfis. Cada perfil sai sempre pelo mesmo IP.
        </p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        {/* Formulário de novo/editar */}
        <div className="mb-4 rounded-xl border border-white/10 bg-ink-850 p-3">
          <div className="mb-2 grid grid-cols-2 gap-2">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Apelido (ex.: Residencial SP)"
              className="field col-span-2"
            />
            <input
              value={form.host}
              onChange={(e) => setForm({ ...form, host: e.target.value })}
              placeholder="host / ip"
              className="field"
            />
            <input
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })}
              placeholder="porta"
              className="field"
            />
            <select
              value={form.protocol}
              onChange={(e) => setForm({ ...form, protocol: e.target.value as ProxyProtocol })}
              className="field"
            >
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="socks5">SOCKS5</option>
            </select>
            <div />
            <input
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder={editingId ? 'usuário (manter em branco = não mudar)' : 'usuário (opcional)'}
              autoComplete="off"
              className="field"
            />
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder={editingId ? 'senha (manter em branco)' : 'senha (opcional)'}
              autoComplete="new-password"
              className="field"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={save}
              disabled={busy || !form.label || !form.host || !form.port}
              className="btn-primary"
            >
              {busy ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Adicionar proxy'}
            </button>
            <button
              onClick={testForm}
              disabled={!form.host || !form.port}
              className="btn-ghost"
            >
              Testar IP
            </button>
            {editingId && (
              <button onClick={reset} className="text-xs text-slate-500 hover:text-slate-300">
                cancelar edição
              </button>
            )}
            {test?.id === 'form' && (
              <span className={`text-xs ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {test.msg}
              </span>
            )}
          </div>
        </div>

        {/* Lista */}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="text-sm text-slate-400">Carregando…</p>
          ) : proxies.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum proxy cadastrado ainda.</p>
          ) : (
            <ul className="space-y-2">
              {proxies.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-850 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {p.label}{' '}
                      <span className="ml-1 rounded bg-white/5 px-1.5 py-0.5 text-[10px] uppercase text-slate-400">
                        {p.protocol}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {p.host}:{p.port}
                      {p.has_creds ? ' • com autenticação' : ''}
                      {test?.id === p.id && (
                        <span className={`ml-2 ${test.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {test.msg}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={() => testSaved(p)} className="btn-ghost py-1 text-xs">
                      Testar IP
                    </button>
                    <button onClick={() => startEdit(p)} className="btn-ghost py-1 text-xs">
                      Editar
                    </button>
                    <button
                      onClick={() => remove(p)}
                      className="rounded-lg border border-white/10 px-2.5 py-1 text-xs font-medium text-red-400 hover:bg-red-500/10"
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
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
