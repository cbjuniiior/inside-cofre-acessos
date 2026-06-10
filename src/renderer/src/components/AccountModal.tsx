import { useState } from 'react'
import { call } from '../lib/api'
import type { AuthUser } from '../../../shared/types'

interface Props {
  user: AuthUser
  onClose: () => void
  onUpdated: () => void
}

export default function AccountModal({ user, onClose, onUpdated }: Props): JSX.Element {
  const [name, setName] = useState(user.name === user.email ? '' : user.name)
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState('')

  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState('')

  const [vpw, setVpw] = useState('')
  const [vpw2, setVpw2] = useState('')
  const [savingVpw, setSavingVpw] = useState(false)
  const [vpwMsg, setVpwMsg] = useState('')

  async function saveName(): Promise<void> {
    setSavingName(true)
    setNameMsg('')
    try {
      await call(window.api.auth.updateName(name))
      setNameMsg('Nome salvo ✓')
      onUpdated()
    } catch (e) {
      setNameMsg(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSavingName(false)
    }
  }

  async function savePassword(): Promise<void> {
    setPwMsg('')
    if (pw.length < 6) {
      setPwMsg('A senha deve ter ao menos 6 caracteres.')
      return
    }
    if (pw !== pw2) {
      setPwMsg('As senhas não conferem.')
      return
    }
    setSavingPw(true)
    try {
      await call(window.api.auth.changePassword(pw))
      setPw('')
      setPw2('')
      setPwMsg('Senha alterada ✓')
    } catch (e) {
      setPwMsg(e instanceof Error ? e.message : 'Erro ao alterar senha')
    } finally {
      setSavingPw(false)
    }
  }

  async function saveVaultPassword(): Promise<void> {
    setVpwMsg('')
    if (vpw.length < 8) {
      setVpwMsg('A senha do cofre deve ter ao menos 8 caracteres.')
      return
    }
    if (vpw !== vpw2) {
      setVpwMsg('As senhas não conferem.')
      return
    }
    setSavingVpw(true)
    try {
      await call(window.api.vault.changePassword(vpw))
      setVpw('')
      setVpw2('')
      setVpwMsg('Senha do cofre alterada ✓')
    } catch (e) {
      setVpwMsg(e instanceof Error ? e.message : 'Erro ao alterar a senha do cofre')
    } finally {
      setSavingVpw(false)
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="card w-full max-w-md p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-white">Minha conta</h2>
        <p className="mb-5 text-sm text-slate-400">{user.email}</p>

        <label className="mb-1 block text-sm font-medium text-slate-300">Seu nome</label>
        <div className="mb-1 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como você aparece para o time"
            className="field flex-1"
          />
          <button onClick={saveName} disabled={savingName || !name.trim()} className="btn-primary">
            {savingName ? '…' : 'Salvar'}
          </button>
        </div>
        {nameMsg && <p className="mb-4 text-xs text-slate-400">{nameMsg}</p>}

        <hr className="my-5 border-white/10" />

        <label className="mb-1 block text-sm font-medium text-slate-300">Alterar senha</label>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Nova senha"
          autoComplete="new-password"
          className="field mb-2"
        />
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder="Confirme a nova senha"
          autoComplete="new-password"
          className="field mb-1"
        />
        {pwMsg && <p className="mb-2 text-xs text-slate-400">{pwMsg}</p>}
        <button onClick={savePassword} disabled={savingPw} className="btn-ghost w-full">
          {savingPw ? 'Alterando…' : 'Alterar senha'}
        </button>

        <hr className="my-5 border-white/10" />

        <label className="mb-1 block text-sm font-medium text-slate-300">Senha do cofre</label>
        <p className="mb-2 text-xs text-slate-500">
          Usada para destravar as sessões. É separada da senha de login acima.
        </p>
        <input
          type="password"
          value={vpw}
          onChange={(e) => setVpw(e.target.value)}
          placeholder="Nova senha do cofre"
          autoComplete="new-password"
          className="field mb-2"
        />
        <input
          type="password"
          value={vpw2}
          onChange={(e) => setVpw2(e.target.value)}
          placeholder="Confirme a senha do cofre"
          autoComplete="new-password"
          className="field mb-1"
        />
        {vpwMsg && <p className="mb-2 text-xs text-slate-400">{vpwMsg}</p>}
        <button onClick={saveVaultPassword} disabled={savingVpw} className="btn-ghost w-full">
          {savingVpw ? 'Alterando…' : 'Alterar senha do cofre'}
        </button>

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
