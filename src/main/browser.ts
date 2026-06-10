import { app, BrowserWindow, WebContentsView, session, ipcMain, type Session } from 'electron'
import { join } from 'path'
import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import { logAudit } from './audit'
import { pullSession, pushSession } from './session-sync'
import { resolveProfileProxy } from './proxies'
import type { Bookmark, TabState } from '../shared/types'

interface ProfileRow {
  id: string
  client_name: string
  service: string
  squad: 'genesis' | 'high_impact' | null
  url: string
  proxy_id: string | null
}

// Mapas globais para o handler de autenticação de proxy (app.on('login')).
const proxyCreds = new Map<string, { username: string; password: string }>()
const webContentsToProfile = new Map<number, string>()

export function getProxyCredsFor(webContentsId: number): { username: string; password: string } | undefined {
  const pid = webContentsToProfile.get(webContentsId)
  return pid ? proxyCreds.get(pid) : undefined
}

const shellByWindowId = new Map<number, BrowserShell>()
const shellByProfileId = new Map<string, BrowserShell>()

const DEFAULT_CHROME_HEIGHT = 96

/** Transforma texto da barra de endereço em URL (ou busca no Google). */
function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return 'about:blank'
  if (/^https?:\/\//i.test(s)) return s
  if (s.startsWith('about:') || s.startsWith('chrome:')) return s
  if (s.includes('localhost') || /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s)) return 'https://' + s
  return 'https://www.google.com/search?q=' + encodeURIComponent(s)
}

/** Heurística: a URL atual parece uma tela de login (sessão caiu/expirou)? */
function isLoginUrl(url: string): boolean {
  const u = url.toLowerCase()
  if (
    u.includes('accounts.google.com/signin') ||
    u.includes('accounts.google.com/servicelogin') ||
    u.includes('accounts.google.com/v3/signin')
  ) {
    return true
  }
  return /\/(login|sign-?in|entrar|auth)(\b|\/|\?|$)/.test(u)
}

class BrowserShell {
  win: BrowserWindow
  ses: Session
  profile: ProfileRow
  private tabs = new Map<number, WebContentsView>()
  private favicons = new Map<number, string | null>()
  private order: number[] = []
  private activeId = 0
  private nextId = 1
  chromeHeight = DEFAULT_CHROME_HEIGHT
  baselineHash = ''
  private needsLogin = false
  private saveTimer: ReturnType<typeof setInterval> | null = null

  constructor(win: BrowserWindow, ses: Session, profile: ProfileRow) {
    this.win = win
    this.ses = ses
    this.profile = profile
    win.on('resize', () => this.layout())
    // Heartbeat: mantém o "em uso" fresco e auto-salva a sessão (só sobe se mudou).
    this.saveTimer = setInterval(() => void this.heartbeat(), 2 * 60 * 1000)
  }

  /** Atualiza in_use_at (mantém o lock vivo) e salva a sessão se mudou. */
  private async heartbeat(): Promise<void> {
    try {
      await getSupabase()
        .from('profiles')
        .update({ in_use_at: new Date().toISOString() })
        .eq('id', this.profile.id)
    } catch {
      /* ignora falha de heartbeat */
    }
    await this.saveSession()
  }

  /** Salva a sessão se os cookies mudaram desde o último baseline. */
  async saveSession(): Promise<'saved' | 'unchanged'> {
    try {
      const h = await pushSession(this.profile.id, this.ses, this.baselineHash)
      if (h) {
        this.baselineHash = h
        return 'saved'
      }
      return 'unchanged'
    } catch (e) {
      console.error('Erro ao salvar sessão:', e)
      return 'unchanged'
    }
  }

  stopAutoSave(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer)
      this.saveTimer = null
    }
  }

  /** Avalia se a aba ativa está numa tela de login e persiste o estado. */
  private evaluateLogin(): void {
    const view = this.tabs.get(this.activeId)
    if (!view) return
    const value = isLoginUrl(view.webContents.getURL())
    if (value === this.needsLogin) return
    this.needsLogin = value
    void getSupabase()
      .from('profiles')
      .update({ needs_login: value })
      .eq('id', this.profile.id)
      .then(undefined, () => undefined)
  }

  private emit(type: string, data: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send('browser:event', { type, data })
  }

  private tabState(id: number): TabState {
    const wc = this.tabs.get(id)!.webContents
    return {
      id,
      title: wc.getTitle() || 'Nova aba',
      url: wc.getURL(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      favicon: this.favicons.get(id) ?? null
    }
  }

  private layout(): void {
    const view = this.tabs.get(this.activeId)
    if (!view) return
    const [w, h] = this.win.getContentSize()
    view.setBounds({ x: 0, y: this.chromeHeight, width: w, height: Math.max(0, h - this.chromeHeight) })
  }

  newTab(url?: string, activate = true): number {
    const id = this.nextId++
    const view = new WebContentsView({ webPreferences: { session: this.ses } })
    this.tabs.set(id, view)
    this.favicons.set(id, null)
    this.order.push(id)
    this.win.contentView.addChildView(view)
    webContentsToProfile.set(view.webContents.id, this.profile.id)
    this.wireTab(id, view)
    void view.webContents.loadURL(normalizeUrl(url ?? this.profile.url))
    this.emit('tabCreated', this.tabState(id))
    if (activate) this.activate(id)
    else view.setVisible(false)
    return id
  }

  private wireTab(id: number, view: WebContentsView): void {
    const wc = view.webContents
    const update = (): void => {
      this.emit('tabUpdated', this.tabState(id))
      if (id === this.activeId) {
        this.evaluateLogin()
        this.updateWindowTitle()
      }
    }
    wc.on('page-title-updated', update)
    wc.on('did-navigate', update)
    wc.on('did-navigate-in-page', update)
    wc.on('did-start-loading', update)
    wc.on('did-stop-loading', update)
    wc.on('page-favicon-updated', (_e, favicons) => {
      this.favicons.set(id, favicons?.[0] ?? null)
      update()
    })
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (disposition === 'new-window') {
        // Popups (ex.: OAuth do Google) abrem como janela própria na mesma sessão,
        // para que window.opener/window.close funcionem.
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            autoHideMenuBar: true,
            width: 600,
            height: 720,
            webPreferences: { session: this.ses }
          }
        }
      }
      // target=_blank / ctrl+click viram abas no shell.
      this.newTab(url, disposition !== 'background-tab')
      return { action: 'deny' }
    })
    wc.on('destroyed', () => webContentsToProfile.delete(wc.id))
    wc.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && this.handleShortcut(input)) event.preventDefault()
    })
  }

  activate(id: number): void {
    const view = this.tabs.get(id)
    if (!view) return
    const prev = this.tabs.get(this.activeId)
    if (prev && prev !== view) prev.setVisible(false)
    this.activeId = id
    this.win.contentView.addChildView(view) // traz para a frente
    view.setVisible(true)
    this.layout()
    this.evaluateLogin()
    this.updateWindowTitle()
    this.emit('activeChanged', { id })
  }

  closeTab(id: number): void {
    const view = this.tabs.get(id)
    if (!view) return
    this.win.contentView.removeChildView(view)
    webContentsToProfile.delete(view.webContents.id)
    try {
      view.webContents.close()
    } catch {
      /* já destruído */
    }
    this.tabs.delete(id)
    this.favicons.delete(id)
    this.order = this.order.filter((x) => x !== id)
    this.emit('tabClosed', { id })
    if (this.activeId === id) {
      const next = this.order[this.order.length - 1]
      if (next != null) this.activate(next)
      else this.win.close()
    }
  }

  navigate(id: number, url: string): void {
    void this.tabs.get(id)?.webContents.loadURL(normalizeUrl(url))
  }

  back(id: number): void {
    const wc = this.tabs.get(id)?.webContents
    if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  }

  forward(id: number): void {
    const wc = this.tabs.get(id)?.webContents
    if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  }

  reload(id: number): void {
    this.tabs.get(id)?.webContents.reload()
  }

  private cycleTab(dir: number): void {
    if (this.order.length < 2) return
    const idx = this.order.indexOf(this.activeId)
    const next = (idx + dir + this.order.length) % this.order.length
    this.activate(this.order[next])
  }

  /** Atalhos de teclado do navegador. Retorna true se tratou o atalho. */
  handleShortcut(input: Electron.Input): boolean {
    const mod = input.control || input.meta // Ctrl (Win/Linux) ou Cmd (Mac)

    if (!mod) {
      if (input.key === 'F5') {
        this.reload(this.activeId)
        return true
      }
      if (input.alt && input.key === 'ArrowLeft') {
        this.back(this.activeId)
        return true
      }
      if (input.alt && input.key === 'ArrowRight') {
        this.forward(this.activeId)
        return true
      }
      return false
    }

    const key = input.key.toLowerCase()
    switch (key) {
      case 't':
        this.newTab()
        return true
      case 'w':
        this.closeTab(this.activeId)
        return true
      case 'r':
        this.reload(this.activeId)
        return true
      case 'l':
        this.emit('focusAddress', {})
        return true
      case 'tab':
        this.cycleTab(input.shift ? -1 : 1)
        return true
      default:
        if (/^[1-9]$/.test(key)) {
          const n = Number(key)
          const target = n === 9 ? this.order[this.order.length - 1] : this.order[n - 1]
          if (target != null) this.activate(target)
          return true
        }
        return false
    }
  }

  setChromeHeight(px: number): void {
    if (px > 0 && px < 400) {
      this.chromeHeight = Math.round(px)
      this.layout()
    }
  }

  getState(): {
    profile: { id: string; client_name: string; service: string; squad: ProfileRow['squad'] }
    tabs: TabState[]
    activeId: number
    chromeHeight: number
  } {
    return {
      profile: {
        id: this.profile.id,
        client_name: this.profile.client_name,
        service: this.profile.service,
        squad: this.profile.squad
      },
      tabs: this.order.map((id) => this.tabState(id)),
      activeId: this.activeId,
      chromeHeight: this.chromeHeight
    }
  }

  /** Mostra "Cliente · Título do site" na barra de título da janela. */
  private updateWindowTitle(): void {
    if (this.win.isDestroyed()) return
    const view = this.tabs.get(this.activeId)
    const tabTitle = view ? view.webContents.getTitle() : ''
    this.win.setTitle(tabTitle ? `${this.profile.client_name} · ${tabTitle}` : this.profile.client_name)
  }
}

async function listBookmarks(profileId: string): Promise<Bookmark[]> {
  const sb = getSupabase()
  const { data, error } = await sb
    .from('bookmarks')
    .select('id, profile_id, title, url')
    .eq('profile_id', profileId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Bookmark[]
}

async function addBookmark(profileId: string, title: string, url: string): Promise<Bookmark> {
  const sb = getSupabase()
  const user = await getCurrentUser()
  const { data, error } = await sb
    .from('bookmarks')
    .insert({ profile_id: profileId, title, url, created_by: user?.id ?? null })
    .select('id, profile_id, title, url')
    .single()
  if (error) throw new Error(error.message)
  return data as Bookmark
}

async function removeBookmark(id: string): Promise<void> {
  const sb = getSupabase()
  const { error } = await sb.from('bookmarks').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function openProfileBrowser(profileId: string): Promise<void> {
  const existing = shellByProfileId.get(profileId)
  if (existing && !existing.win.isDestroyed()) {
    existing.win.focus()
    return
  }

  const sb = getSupabase()
  const user = await getCurrentUser()

  const { data, error } = await sb.from('profiles').select('*').eq('id', profileId).single()
  if (error) throw new Error(error.message)
  const profile = data as ProfileRow

  await sb
    .from('profiles')
    .update({
      in_use_by: user?.id ?? null,
      in_use_by_email: user?.email ?? null,
      in_use_by_name: user?.name ?? null,
      in_use_at: new Date().toISOString()
    })
    .eq('id', profileId)

  const ses = session.fromPartition(`persist:profile-${profileId}`)

  if (profile.proxy_id) {
    const resolved = await resolveProfileProxy(profile.proxy_id)
    if (resolved) {
      await ses.setProxy({ proxyRules: resolved.rules })
      if (resolved.username) {
        proxyCreds.set(profileId, { username: resolved.username, password: resolved.password ?? '' })
      }
    } else {
      await ses.setProxy({ mode: 'direct' })
    }
  } else {
    await ses.setProxy({ mode: 'direct' })
  }

  const baselineHash = await pullSession(profileId, ses)

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    autoHideMenuBar: true,
    title: `${profile.client_name} — ${profile.service}`,
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  })

  // Impede que a página do "chrome" sobrescreva o título — quem manda é o updateWindowTitle.
  win.on('page-title-updated', (e) => e.preventDefault())

  const shell = new BrowserShell(win, ses, profile)
  shell.baselineHash = baselineHash

  // Atalhos também quando o foco está na barra do navegador (chrome).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && shell.handleShortcut(input)) event.preventDefault()
  })
  shellByWindowId.set(win.id, shell)
  shellByProfileId.set(profileId, shell)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=browser`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { search: 'view=browser' })
  }

  // Primeira aba com a URL do perfil. A UI busca o estado via browser:getState.
  shell.newTab(profile.url)

  await logAudit('abriu perfil', profileId, profile.client_name)

  win.on('closed', () => {
    shell.stopAutoSave()
    shellByWindowId.delete(win.id)
    shellByProfileId.delete(profileId)
    proxyCreds.delete(profileId)
    void (async () => {
      try {
        const result = await shell.saveSession()
        await sb
          .from('profiles')
          .update({ in_use_by: null, in_use_by_email: null, in_use_by_name: null, in_use_at: null })
          .eq('id', profileId)
        if (result === 'saved') await logAudit('salvou sessão', profileId, profile.client_name)
      } catch (e) {
        console.error('Erro ao salvar a sessão ao fechar o perfil:', e)
      }
    })()
  })
}

export function registerBrowserIpc(): void {
  const shellOf = (e: Electron.IpcMainInvokeEvent): BrowserShell | null => {
    const win = BrowserWindow.fromWebContents(e.sender)
    return win ? shellByWindowId.get(win.id) ?? null : null
  }

  ipcMain.handle('browser:getState', (e) => shellOf(e)?.getState() ?? null)
  ipcMain.handle('browser:newTab', (e, url?: string) => shellOf(e)?.newTab(url))
  ipcMain.handle('browser:closeTab', (e, id: number) => shellOf(e)?.closeTab(id))
  ipcMain.handle('browser:activateTab', (e, id: number) => shellOf(e)?.activate(id))
  ipcMain.handle('browser:navigate', (e, id: number, url: string) => shellOf(e)?.navigate(id, url))
  ipcMain.handle('browser:back', (e, id: number) => shellOf(e)?.back(id))
  ipcMain.handle('browser:forward', (e, id: number) => shellOf(e)?.forward(id))
  ipcMain.handle('browser:reload', (e, id: number) => shellOf(e)?.reload(id))
  ipcMain.handle('browser:setChromeHeight', (e, px: number) => shellOf(e)?.setChromeHeight(px))
  ipcMain.handle('browser:saveSession', (e) => shellOf(e)?.saveSession() ?? 'unchanged')

  ipcMain.handle('browser:listBookmarks', (e) => {
    const s = shellOf(e)
    return s ? listBookmarks(s.profile.id) : []
  })
  ipcMain.handle('browser:addBookmark', (e, title: string, url: string) => {
    const s = shellOf(e)
    if (!s) throw new Error('Janela de navegador não encontrada.')
    return addBookmark(s.profile.id, title, url)
  })
  ipcMain.handle('browser:removeBookmark', (_e, id: string) => removeBookmark(id))
}
