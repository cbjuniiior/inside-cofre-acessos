import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Bookmark, BrowserProfileInfo, ProfileService, TabState } from '../../../shared/types'

const SERVICE_LABEL: Record<ProfileService, string> = {
  gmail: 'Gmail',
  hostinger: 'Hostinger',
  cpanel: 'cPanel',
  outro: 'Outro'
}

const SQUAD = {
  genesis: { dot: 'bg-purple-500', chip: 'border-purple-500/30 bg-purple-500/10', line: 'bg-purple-500' },
  high_impact: { dot: 'bg-red-500', chip: 'border-red-500/30 bg-red-500/10', line: 'bg-red-500' }
} as const

function upsertTab(list: TabState[], tab: TabState): TabState[] {
  const i = list.findIndex((t) => t.id === tab.id)
  if (i === -1) return [...list, tab]
  const copy = list.slice()
  copy[i] = tab
  return copy
}

const Icon = {
  back: 'M15 18l-6-6 6-6',
  fwd: 'M9 18l6-6-6-6',
  reload: 'M3 12a9 9 0 1 0 2.6-6.36L3 8m0-5v5h5'
} as const

function NavIcon({ d }: { d: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d={d} />
    </svg>
  )
}

export default function BrowserChrome(): JSX.Element {
  const [profile, setProfile] = useState<BrowserProfileInfo | null>(null)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeId, setActiveId] = useState(0)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [address, setAddress] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const addressFocused = useRef(false)
  const addressRef = useRef<HTMLInputElement>(null)
  const chromeRef = useRef<HTMLDivElement>(null)

  const active = tabs.find((t) => t.id === activeId) ?? null
  const squad = profile?.squad ? SQUAD[profile.squad] : null
  const secure = (active?.url ?? '').startsWith('https://')

  useEffect(() => {
    void (async () => {
      const state = await window.api.browser.getState()
      if (state) {
        setProfile(state.profile)
        setTabs(state.tabs)
        setActiveId(state.activeId)
      }
      setBookmarks(await window.api.browser.listBookmarks())
    })()

    const off = window.api.browser.onEvent(({ type, data }) => {
      if (type === 'tabCreated' || type === 'tabUpdated') {
        setTabs((prev) => upsertTab(prev, data as TabState))
      } else if (type === 'tabClosed') {
        const { id } = data as { id: number }
        setTabs((prev) => prev.filter((t) => t.id !== id))
      } else if (type === 'activeChanged') {
        setActiveId((data as { id: number }).id)
      } else if (type === 'focusAddress') {
        addressRef.current?.focus()
        addressRef.current?.select()
      }
    })
    return off
  }, [])

  useEffect(() => {
    const el = chromeRef.current
    if (!el) return
    const report = (): void => void window.api.browser.setChromeHeight(el.offsetHeight)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bookmarks.length])

  useEffect(() => {
    if (!addressFocused.current) setAddress(active?.url ?? '')
  }, [active?.url, activeId])

  const go = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      if (active) void window.api.browser.navigate(active.id, address)
    },
    [active, address]
  )

  async function addCurrentBookmark(): Promise<void> {
    if (!active) return
    const bm = await window.api.browser.addBookmark(active.title || active.url, active.url)
    setBookmarks((prev) => [...prev, bm])
  }

  async function removeBookmark(id: string): Promise<void> {
    await window.api.browser.removeBookmark(id)
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
  }

  async function saveSession(): Promise<void> {
    setSaveMsg('Salvando…')
    const r = await window.api.browser.saveSession()
    setSaveMsg(r === 'saved' ? 'Salva ✓' : 'Sem mudanças')
    window.setTimeout(() => setSaveMsg(''), 2200)
  }

  return (
    <div className="flex h-full flex-col bg-ink-950 font-sans text-slate-200">
      <div ref={chromeRef} className="select-none border-b border-black/50">
        {/* Faixa de identidade da squad */}
        <div className={`h-[3px] ${squad ? squad.line : 'bg-brand-500/70'}`} />

        {/* Tira de abas + identidade do cliente */}
        <div className="flex items-center gap-2 bg-ink-900 px-2 pt-1.5">
          <div className="flex flex-1 items-end gap-1 overflow-x-auto pb-0">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => window.api.browser.activateTab(t.id)}
                className={`group flex h-8 max-w-[210px] items-center gap-2 rounded-t-lg px-3 text-xs transition ${
                  t.id === activeId
                    ? 'bg-ink-850 text-white'
                    : 'text-slate-400 hover:bg-white/[0.05]'
                }`}
              >
                {t.favicon ? (
                  <img src={t.favicon} className="h-4 w-4 shrink-0 rounded-sm" alt="" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-sm bg-white/10" />
                )}
                <span className="truncate">{t.loading ? 'Carregando…' : t.title}</span>
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    window.api.browser.closeTab(t.id)
                  }}
                  className="-mr-1 ml-0.5 hidden rounded p-0.5 text-slate-400 hover:bg-white/10 hover:text-white group-hover:inline"
                >
                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </span>
              </button>
            ))}
            <button
              onClick={() => window.api.browser.newTab()}
              className="mb-1 ml-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-lg text-slate-400 hover:bg-white/[0.06] hover:text-white"
              title="Nova aba"
            >
              +
            </button>
          </div>

          {profile && (
            <div
              className={`mb-1.5 flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 ${
                squad ? squad.chip : 'border-white/10 bg-white/[0.04]'
              }`}
              title={`Cliente: ${profile.client_name}`}
            >
              <span className={`h-2 w-2 rounded-full ${squad ? squad.dot : 'bg-brand-500'}`} />
              <span className="text-xs">
                <span className="font-semibold text-white">{profile.client_name}</span>
                <span className="text-slate-400"> · {SERVICE_LABEL[profile.service]}</span>
              </span>
            </div>
          )}
        </div>

        {/* Barra de navegação */}
        <div className="flex items-center gap-2 bg-ink-850 px-3 py-2">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => active && window.api.browser.back(active.id)}
              disabled={!active?.canGoBack}
              className="icon-btn"
              title="Voltar"
            >
              <NavIcon d={Icon.back} />
            </button>
            <button
              onClick={() => active && window.api.browser.forward(active.id)}
              disabled={!active?.canGoForward}
              className="icon-btn"
              title="Avançar"
            >
              <NavIcon d={Icon.fwd} />
            </button>
            <button
              onClick={() => active && window.api.browser.reload(active.id)}
              className="icon-btn"
              title="Recarregar"
            >
              <NavIcon d={Icon.reload} />
            </button>
          </div>

          <form onSubmit={go} className="flex-1">
            <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-black/40 px-3.5 py-1.5 transition focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/25">
              <span className={secure ? 'text-emerald-400' : 'text-slate-500'} title={secure ? 'Conexão segura' : 'Sem HTTPS'}>
                {secure ? (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
                  </svg>
                )}
              </span>
              <input
                ref={addressRef}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                onFocus={(e) => {
                  addressFocused.current = true
                  e.target.select()
                }}
                onBlur={() => {
                  addressFocused.current = false
                  setAddress(active?.url ?? '')
                }}
                placeholder="Buscar no Google ou digitar um endereço"
                className="w-full bg-transparent font-mono text-[13px] text-slate-100 placeholder-slate-500 outline-none"
              />
            </div>
          </form>

          <button onClick={saveSession} className="icon-btn relative" title="Salvar sessão agora">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
              <path d="M5 4h11l3 3v13H5z" />
              <path d="M8 4v5h7M8 14h8v6H8z" />
            </svg>
          </button>
          {saveMsg && <span className="text-[11px] text-emerald-400">{saveMsg}</span>}
          <button onClick={addCurrentBookmark} className="icon-btn text-brand-400 hover:text-brand-300" title="Adicionar aos favoritos">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <path d="M12 17.3l-5.4 3.3 1.5-6.1L3 10.4l6.3-.5L12 4l2.7 5.9 6.3.5-5.1 4.1 1.5 6.1z" />
            </svg>
          </button>
        </div>

        {/* Barra de carregamento */}
        <div className="h-[2px] overflow-hidden bg-transparent">
          {active?.loading && <div className="bar-indeterminate h-full w-1/2 bg-brand-500" />}
        </div>

        {/* Barra de favoritos */}
        {bookmarks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 bg-ink-900 px-3 py-1.5">
            {bookmarks.map((b) => (
              <span
                key={b.id}
                className="group inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-xs text-slate-300 hover:bg-white/[0.07]"
              >
                <button
                  onClick={() => active && window.api.browser.navigate(active.id, b.url)}
                  className="max-w-[160px] truncate hover:text-brand-300"
                  title={b.url}
                >
                  {b.title}
                </button>
                <button
                  onClick={() => removeBookmark(b.id)}
                  className="hidden text-slate-500 hover:text-red-400 group-hover:inline"
                  title="Remover"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* A área abaixo é coberta pela WebContentsView (conteúdo da aba). */}
      <div className="flex-1" />
    </div>
  )
}
