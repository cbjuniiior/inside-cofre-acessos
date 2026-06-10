import { useEffect, useState, type FormEvent } from 'react'
import { call } from '../lib/api'
import type { Profile, ProfileInput, ProfileService, Proxy, Squad } from '../../../shared/types'

const SQUAD_OPTIONS: { value: Squad | ''; label: string; dot: string; ring: string }[] = [
  { value: '', label: 'Nenhuma', dot: 'bg-slate-500', ring: 'peer-checked:border-slate-400' },
  { value: 'genesis', label: 'Gênesis', dot: 'bg-purple-500', ring: 'peer-checked:border-purple-500' },
  { value: 'high_impact', label: 'High Impact', dot: 'bg-red-500', ring: 'peer-checked:border-red-500' }
]

const SERVICE_DEFAULT_URL: Record<ProfileService, string> = {
  gmail: 'https://mail.google.com',
  hostinger: 'https://hpanel.hostinger.com',
  cpanel: '',
  outro: ''
}

interface Props {
  profile: Profile | null
  onClose: () => void
  onSaved: () => void
}

export default function ProfileForm({ profile, onClose, onSaved }: Props): JSX.Element {
  const editing = Boolean(profile)
  const [clientName, setClientName] = useState(profile?.client_name ?? '')
  const [squad, setSquad] = useState<Squad | ''>(profile?.squad ?? '')
  const [service, setService] = useState<ProfileService>(profile?.service ?? 'gmail')
  const [url, setUrl] = useState(profile?.url ?? SERVICE_DEFAULT_URL.gmail)
  const [tags, setTags] = useState((profile?.tags ?? []).join(', '))
  const [proxyId, setProxyId] = useState(profile?.proxy_id ?? '')
  const [proxies, setProxies] = useState<Proxy[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        setProxies(await call(window.api.proxies.list()))
      } catch {
        /* sem proxies cadastrados ainda */
      }
    })()
  }, [])

  function onServiceChange(value: ProfileService): void {
    setService(value)
    if (!editing && SERVICE_DEFAULT_URL[value]) setUrl(SERVICE_DEFAULT_URL[value])
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const input: ProfileInput = {
        client_name: clientName.trim(),
        service,
        squad: squad === '' ? null : squad,
        url: url.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        proxy_id: proxyId === '' ? null : proxyId
      }
      if (editing && profile) {
        await call(window.api.profiles.update(profile.id, input))
      } else {
        await call(window.api.profiles.create(input))
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <form onSubmit={submit} className="card animate-scale-in max-h-full w-full max-w-md overflow-auto p-6">
        <h2 className="mb-5 font-display text-xl font-bold text-white">
          {editing ? 'Editar perfil' : 'Novo perfil'}
        </h2>

        <label className="mb-1 block text-sm font-medium text-slate-300">Cliente</label>
        <input
          required
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          className="field mb-3"
        />

        <label className="mb-1 block text-sm font-medium text-slate-300">Squad</label>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {SQUAD_OPTIONS.map((opt) => (
            <label key={opt.value} className="cursor-pointer">
              <input
                type="radio"
                name="squad"
                value={opt.value}
                checked={squad === opt.value}
                onChange={() => setSquad(opt.value)}
                className="peer sr-only"
              />
              <span
                className={`flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-ink-750 px-2 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/5 ${opt.ring} peer-checked:bg-white/5`}
              >
                <span className={`h-2.5 w-2.5 rounded-full ${opt.dot}`} />
                {opt.label}
              </span>
            </label>
          ))}
        </div>

        <label className="mb-1 block text-sm font-medium text-slate-300">Serviço</label>
        <select
          value={service}
          onChange={(e) => onServiceChange(e.target.value as ProfileService)}
          className="field mb-3"
        >
          <option value="gmail">Gmail</option>
          <option value="hostinger">Hostinger</option>
          <option value="cpanel">cPanel</option>
          <option value="outro">Outro</option>
        </select>

        <label className="mb-1 block text-sm font-medium text-slate-300">URL inicial</label>
        <input
          required
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="field mb-3"
        />

        <label className="mb-1 block text-sm font-medium text-slate-300">
          Tags <span className="text-slate-500">(separadas por vírgula)</span>
        </label>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="ex.: agência, prioridade"
          className="field mb-3"
        />

        <label className="mb-1 block text-sm font-medium text-slate-300">Proxy</label>
        <select value={proxyId} onChange={(e) => setProxyId(e.target.value)} className="field mb-1">
          <option value="">Sem proxy (IP direto)</option>
          {proxies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — {p.host}:{p.port}
            </option>
          ))}
        </select>
        <p className="mb-4 text-[11px] text-slate-500">
          O perfil sempre sai por esse IP, em qualquer máquina. Cadastre proxies no botão “Proxies”.
        </p>

        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
