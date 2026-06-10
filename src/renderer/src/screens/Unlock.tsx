import { useEffect, useState, type FormEvent } from 'react'
import { call } from '../lib/api'
import type { VaultStatus } from '../../../shared/types'
import logo from '../assets/inside-logo.svg'

interface Props {
  userEmail: string
  onUnlocked: () => void
  onSignOut: () => void
}

export default function Unlock({ userEmail, onUnlocked, onSignOut }: Props): JSX.Element {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setStatus(await call(window.api.vault.status()))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao checar o cofre')
        setStatus({ initialized: true, hasSlot: true, canBootstrap: false, mustChange: false })
      }
    })()
  }, [])

  const creating = status ? !status.initialized : false
  const noAccess = status ? status.initialized && !status.hasSlot && !status.canBootstrap : false
  const bootstrap = status ? status.initialized && !status.hasSlot && status.canBootstrap : false

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (creating) {
        if (password.length < 8) throw new Error('A senha-mestra deve ter ao menos 8 caracteres.')
        if (password !== confirm) throw new Error('As senhas não conferem.')
        await call(window.api.vault.initialize(password))
        onUnlocked()
        return
      }
      const ok = await call(window.api.vault.unlock(password))
      if (!ok) {
        setError(bootstrap ? 'Senha-mestra incorreta.' : 'Senha do cofre incorreta.')
        return
      }
      onUnlocked()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao destravar')
    } finally {
      setBusy(false)
    }
  }

  async function signOut(): Promise<void> {
    await call(window.api.auth.signOut())
    onSignOut()
  }

  if (!status) {
    return <div className="flex h-full items-center justify-center bg-ink-900 text-slate-400">Carregando…</div>
  }

  if (noAccess) {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 p-6">
        <div className="card w-full max-w-sm p-8 text-center shadow-xl">
          <img src={logo} alt="Inside" className="mx-auto mb-4 h-6 w-auto opacity-90" />
          <h1 className="text-lg font-semibold text-white">Sem acesso ao cofre</h1>
          <p className="mt-2 text-sm text-slate-400">
            Sua conta ({userEmail}) ainda não tem acesso ao cofre. Peça a um <b>admin</b> para liberar
            — ele vai te passar uma senha temporária.
          </p>
          <button
            onClick={signOut}
            className="mt-5 w-full rounded-lg py-2 text-sm font-medium text-slate-500 hover:text-slate-300"
          >
            Sair da conta
          </button>
        </div>
      </div>
    )
  }

  const title = creating ? 'Defina a senha-mestra' : bootstrap ? 'Liberar seu acesso' : 'Destravar cofre'
  const subtitle = creating
    ? 'Esta senha protege as sessões dos clientes. Guarde com cuidado.'
    : bootstrap
      ? 'Primeiro acesso: digite a senha-mestra do workspace para criar a sua senha do cofre.'
      : `Logado como ${userEmail}.`

  return (
    <div className="flex h-full items-center justify-center bg-ink-900 p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-8 shadow-xl">
        <div className="mb-6">
          <img src={logo} alt="Inside" className="mb-4 h-6 w-auto opacity-90" />
          <h1 className="text-lg font-semibold text-white">{title}</h1>
          <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-300">
          {bootstrap ? 'Senha-mestra do workspace' : 'Senha do cofre'}
        </label>
        <input
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field mb-4"
        />

        {creating && (
          <>
            <label className="mb-1 block text-sm font-medium text-slate-300">Confirme a senha</label>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="field mb-4"
            />
          </>
        )}

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Processando…' : creating ? 'Criar e destravar' : bootstrap ? 'Liberar acesso' : 'Destravar'}
        </button>

        <button
          type="button"
          onClick={signOut}
          className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-slate-500 hover:text-slate-300"
        >
          Sair da conta
        </button>
      </form>
    </div>
  )
}
