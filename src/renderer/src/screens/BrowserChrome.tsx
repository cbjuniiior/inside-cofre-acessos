import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Bookmark, BrowserProfileInfo, TabState } from '../../../shared/types'

function upsertTab(list: TabState[], tab: TabState): TabState[] {
  const i = list.findIndex((t) => t.id === tab.id)
  if (i === -1) return [...list, tab]
  const copy = list.slice()
  copy[i] = tab
  return copy
}

export default function BrowserChrome(): JSX.Element {
  const [profile, setProfile] = useState<BrowserProfileInfo | null>(null)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeId, setActiveId] = useState(0)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [address, setAddress] = useState('')
  const addressFocused = useRef(false)
  const chromeRef = useRef<HTMLDivElement>(null)

  const active = tabs.find((t) => t.id === activeId) ?? null

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

  return (
    <div className="flex h-full flex-col bg-ink-950">
      <div ref={chromeRef} className="select-none border-b border-black/40 bg-ink-850">
        {/* Tira de abas */}
        <div className="flex items-end gap-1 px-2 pt-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => window.api.browser.activateTab(t.id)}
              className={`group flex max-w-[210px] items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs transition ${
                t.id === activeId
                  ? 'bg-ink-700 text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
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
                className="ml-1 hidden rounded px-1 text-slate-400 hover:bg-white/10 hover:text-white group-hover:inline"
              >
                ×
              </span>
            </button>
          ))}
          <button
            onClick={() => window.api.browser.newTab()}
            className="mb-0.5 rounded px-2 py-1 text-base text-slate-400 hover:bg-white/10 hover:text-white"
            title="Nova aba"
          >
            +
          </button>
        </div>

        {/* Barra de navegação */}
        <div className="flex items-center gap-1.5 px-3 py-2">
          <button
            onClick={() => active && window.api.browser.back(active.id)}
            disabled={!active?.canGoBack}
            className="rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10 disabled:opacity-25"
            title="Voltar"
          >
            ←
          </button>
          <button
            onClick={() => active && window.api.browser.forward(active.id)}
            disabled={!active?.canGoForward}
            className="rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10 disabled:opacity-25"
            title="Avançar"
          >
            →
          </button>
          <button
            onClick={() => active && window.api.browser.reload(active.id)}
            className="rounded-lg px-2 py-1 text-slate-300 hover:bg-white/10"
            title="Recarregar"
          >
            ⟳
          </button>

          <form onSubmit={go} className="mx-1 flex-1">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={() => (addressFocused.current = true)}
              onBlur={() => {
                addressFocused.current = false
                setAddress(active?.url ?? '')
              }}
              placeholder="Buscar no Google ou digitar um endereço"
              className="w-full rounded-full border border-white/10 bg-ink-750 px-4 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
          </form>

          <button
            onClick={addCurrentBookmark}
            className="rounded-lg px-2 py-1 text-brand-400 hover:bg-white/10"
            title="Adicionar aos favoritos"
          >
            ★
          </button>
          <span
            className="max-w-[160px] truncate pl-1 text-xs text-slate-500"
            title={profile?.client_name}
          >
            {profile?.client_name}
          </span>
        </div>

        {/* Barra de bookmarks */}
        {bookmarks.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 px-3 pb-2">
            {bookmarks.map((b) => (
              <span
                key={b.id}
                className="group inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-300"
              >
                <button
                  onClick={() => active && window.api.browser.navigate(active.id, b.url)}
                  className="max-w-[160px] truncate hover:text-brand-400"
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
