import { useState, type FormEvent } from 'react'
import { call } from '../lib/api'
import logo from '../assets/inside-logo.svg'

export default function Login({ onSignedIn }: { onSignedIn: () => void }): JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await call(window.api.auth.signIn(email.trim(), password))
      onSignedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha no login')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="animate-fade-up w-full max-w-sm">
        <form onSubmit={submit} className="card overflow-hidden p-8">
          {/* linha de destaque no topo do card */}
          <div className="-mx-8 -mt-8 mb-7 h-px bg-gradient-to-r from-transparent via-brand-500/60 to-transparent" />

          <img src={logo} alt="Inside" className="mb-5 h-7 w-auto" />
          <h1 className="font-display text-2xl font-bold text-white">Cofre de Acessos</h1>
          <p className="mb-7 mt-1.5 text-sm text-slate-400">
            Acesso seguro às contas dos clientes.
          </p>

          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
            E-mail
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field mb-4"
            placeholder="voce@inside.com"
          />

          <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
            Senha
          </label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field mb-5"
          />

          {error && (
            <p className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full">
            {busy ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        <p className="mt-5 text-center text-xs text-slate-600">
          Inside · ferramenta interna do time
        </p>
      </div>
    </div>
  )
}
