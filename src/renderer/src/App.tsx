import { useCallback, useEffect, useState } from 'react'
import { call } from './lib/api'
import type { AuthUser } from '../../shared/types'
import Login from './screens/Login'
import Unlock from './screens/Unlock'
import Dashboard from './screens/Dashboard'

type Stage = 'loading' | 'config-missing' | 'error' | 'signed-out' | 'locked' | 'ready'

export default function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)

  useEffect(() => {
    return window.api.update.onReady((info) => setUpdateVersion(info.version))
  }, [])

  const refresh = useCallback(async () => {
    try {
      if (!window.api) {
        throw new Error('A ponte do preload (window.api) não carregou.')
      }
      const { configured } = await call(window.api.config.status())
      if (!configured) {
        setStage('config-missing')
        return
      }
      const current = await call(window.api.auth.currentUser())
      if (!current) {
        setUser(null)
        setStage('signed-out')
        return
      }
      setUser(current)
      const unlocked = await call(window.api.vault.isUnlocked())
      setStage(unlocked ? 'ready' : 'locked')
    } catch (e) {
      console.error(e)
      setErrorMsg(e instanceof Error ? e.message : String(e))
      setStage('error')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (stage === 'loading') {
    return (
      <div className="flex h-full items-center justify-center bg-ink-900 text-slate-400">Carregando…</div>
    )
  }

  if (stage === 'config-missing') {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-3 bg-ink-900 p-8 text-center">
        <h1 className="text-xl font-semibold text-white">Supabase não configurado</h1>
        <p className="text-sm text-slate-400">
          Crie o arquivo <code className="rounded bg-white/10 px-1 text-slate-200">.env</code> na raiz do projeto com{' '}
          <code className="rounded bg-white/10 px-1 text-slate-200">MAIN_VITE_SUPABASE_URL</code> e{' '}
          <code className="rounded bg-white/10 px-1 text-slate-200">MAIN_VITE_SUPABASE_ANON_KEY</code>, depois reinicie o app.
        </p>
      </div>
    )
  }

  if (stage === 'error') {
    return (
      <div className="mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 bg-ink-900 p-8 text-center">
        <h1 className="text-xl font-semibold text-white">Não foi possível iniciar</h1>
        <p className="break-words text-sm text-red-400">{errorMsg}</p>
        <button
          onClick={() => {
            setStage('loading')
            void refresh()
          }}
          className="btn-primary"
        >
          Tentar de novo
        </button>
      </div>
    )
  }

  if (stage === 'signed-out') {
    return <Login onSignedIn={refresh} />
  }

  if (stage === 'locked') {
    return <Unlock onUnlocked={refresh} onSignOut={refresh} userEmail={user?.email ?? ''} />
  }

  return (
    <>
      <Dashboard user={user!} onSignOut={refresh} onLock={refresh} onAccountChanged={refresh} />
      {updateVersion && (
        <div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-brand-500/40 bg-ink-800 px-4 py-2.5 shadow-glow">
          <span className="text-sm text-slate-200">
            Atualização {updateVersion} pronta para instalar.
          </span>
          <button
            onClick={() => window.api.update.install()}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
          >
            Reiniciar e atualizar
          </button>
          <button
            onClick={() => setUpdateVersion(null)}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            depois
          </button>
        </div>
      )}
    </>
  )
}
