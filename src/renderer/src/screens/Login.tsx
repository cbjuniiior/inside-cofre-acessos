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
    <div className="flex h-full items-center justify-center bg-ink-900 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-8 shadow-xl">
        <div className="mb-6">
          <img src={logo} alt="Inside" className="mb-4 h-7 w-auto" />
          <h1 className="text-base font-semibold text-white">Cofre de Acessos</h1>
          <p className="mt-1 text-sm text-slate-400">Entre com sua conta do time.</p>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-300">E-mail</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field mb-4"
          placeholder="voce@inside.com"
        />

        <label className="mb-1 block text-sm font-medium text-slate-300">Senha</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field mb-4"
        />

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
