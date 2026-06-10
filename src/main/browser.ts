import { app, BrowserWindow, WebContentsView, session, ipcMain, type Session } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { getSupabase } from './supabase'
import { getCurrentUser } from './auth'
import { logAudit } from './audit'
import { pullSession, pushSession, type LocalStorageMap, type IndexedDbMap } from './session-sync'
import { resolveProfileProxy } from './proxies'
import type { Bookmark, TabState } from '../shared/types'

interface ProfileRow {
  id: string
  client_name: string
  service: string
  squad: 'genesis' | 'high_impact' | null
  url: string
  proxy_id: string | null
  in_use_by: string | null
  in_use_by_email: string | null
  in_use_by_name: string | null
  in_use_at: string | null
}

// Janela em que o lock de "em uso" é considerado vivo (heartbeat renova a cada 2 min).
const LOCK_FRESH_MS = 5 * 60 * 1000

/**
 * User-Agent nativo do Chromium do Electron SEM o token `Electron/<versão>`.
 *
 * Importante: NÃO forjamos um UA de Chrome inteiro nem reescrevemos os User-Agent
 * Client Hints (Sec-CH-UA). Forçar esses valores cria um conjunto de sinais
 * incoerente (UA spoofado vs. client hints reais/parciais do Electron) que é
 * justamente o que o servidor do Google usa para barrar webviews. Manter tudo
 * nativo e coerente, removendo apenas o token óbvio `Electron/`, é a abordagem
 * usada pelo gmail-desktop/meru e a que tem maior chance de passar no login.
 */
export function chromeUserAgent(): string {
  const base = app.userAgentFallback || ''
  return base.replace(/ Electron\/[^ ]+/, '')
}

/**
 * Script (roda na página via executeJavaScript) que exporta TODOS os bancos
 * IndexedDB da origem atual como JSON: `{ [db]: { version, stores: { [store]:
 * { keyPath, autoIncrement, entries: [{ key?, value }] } } } }`. As duas
 * requisições (getAll/getAllKeys) são emitidas antes do await para a transação
 * não auto-commitar no meio. Há um teto de tamanho para não sincronizar caches
 * gigantes. Tokens de auth (ex.: localforage `keyvaluepairs`) são pequenos.
 */
const IDB_DUMP_SCRIPT = `(async () => {
  const CAP = 3000000; let total = 0; const out = {};
  const reqP = (r) => new Promise((res) => { r.onsuccess = () => res(r.result); r.onerror = () => res(undefined); });
  try {
    const dbs = indexedDB.databases ? await indexedDB.databases() : [];
    for (const info of dbs) {
      const name = info.name; if (!name) continue;
      const db = await new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null); });
      if (!db) continue;
      const stores = {};
      for (const sName of Array.from(db.objectStoreNames)) {
        try {
          const os = db.transaction(sName, 'readonly').objectStore(sName);
          const keyPath = os.keyPath; const autoIncrement = !!os.autoIncrement;
          const gv = os.getAll(); const gk = os.getAllKeys();
          const values = (await reqP(gv)) || []; const keys = (await reqP(gk)) || [];
          const entries = [];
          for (let i = 0; i < values.length; i++) {
            let j; try { j = JSON.stringify(values[i]); } catch (e) { continue; }
            if (j === undefined) continue;
            total += j.length; if (total > CAP) break;
            const e = { value: values[i] };
            if (keyPath == null) e.key = keys[i];
            entries.push(e);
          }
          stores[sName] = { keyPath: keyPath == null ? null : keyPath, autoIncrement, entries };
        } catch (e) { /* pula store problemático */ }
      }
      out[name] = { version: db.version, stores };
      db.close();
      if (total > CAP) break;
    }
  } catch (e) { /* origem sem IndexedDB */ }
  return JSON.stringify(out);
})()`

/**
 * Monta o script de restauração (localStorage + IndexedDB) para uma origem.
 * Cria os bancos/stores se não existirem (com o mesmo keyPath/autoIncrement) e
 * grava as entradas. Retorna true se concluiu — o chamador recarrega a aba.
 */
function buildRestoreScript(ls: Record<string, string>, idb: IndexedDbMap[string]): string {
  return `(async () => {
    try {
      const ls = ${JSON.stringify(ls)};
      for (const k in ls) { try { localStorage.setItem(k, ls[k]); } catch (e) {} }
    } catch (e) {}
    try {
      const idb = ${JSON.stringify(idb)};
      for (const name of Object.keys(idb)) {
        const dbData = idb[name];
        const storeNames = Object.keys(dbData.stores || {});
        const mkStores = (d, names) => { for (const s of names) { if (!d.objectStoreNames.contains(s)) { const sd = dbData.stores[s]; d.createObjectStore(s, { keyPath: sd.keyPath == null ? undefined : sd.keyPath, autoIncrement: !!sd.autoIncrement }); } } };
        let db = await new Promise((res, rej) => { const r = indexedDB.open(name); r.onupgradeneeded = () => mkStores(r.result, storeNames); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
        const missing = storeNames.filter((s) => !db.objectStoreNames.contains(s));
        if (missing.length) {
          const v = db.version + 1; db.close();
          db = await new Promise((res, rej) => { const r = indexedDB.open(name, v); r.onupgradeneeded = () => mkStores(r.result, missing); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
        }
        for (const s of storeNames) {
          const entries = (dbData.stores[s] && dbData.stores[s].entries) || [];
          if (!entries.length) continue;
          await new Promise((res) => { const tx = db.transaction(s, 'readwrite'); const os = tx.objectStore(s); for (const e of entries) { try { if ('key' in e) os.put(e.value, e.key); else os.put(e.value); } catch (err) {} } tx.oncomplete = () => res(); tx.onerror = () => res(); tx.onabort = () => res(); });
        }
        db.close();
      }
      return true;
    } catch (e) { return false; }
  })()`
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
  private cookiePushTimer: ReturnType<typeof setTimeout> | null = null
  // Estado vindo do servidor a injetar nas abas (por origem) + controle.
  private pendingLocalStorage: LocalStorageMap = {}
  private pendingIndexedDb: IndexedDbMap = {}
  private restoredOrigins = new Set<string>()
  // Último estado capturado (fallback quando as abas já foram destruídas).
  private lastLocalStorage: LocalStorageMap = {}
  private lastIndexedDb: IndexedDbMap = {}

  // Push quase imediato quando cookies mudam: o Google rotaciona os tokens de
  // sessão (__Secure-*PSIDTS) a cada ~30 min e invalida tudo se outra máquina
  // injetar um token antigo. Subir a rotação na hora fecha essa janela.
  private onCookieChanged = (): void => {
    if (this.cookiePushTimer) return // já há um push agendado — agrupa a rajada
    this.cookiePushTimer = setTimeout(() => {
      this.cookiePushTimer = null
      void this.saveSession()
    }, 5000)
  }

  constructor(win: BrowserWindow, ses: Session, profile: ProfileRow) {
    this.win = win
    this.ses = ses
    this.profile = profile
    win.on('resize', () => this.layout())
    // Heartbeat: mantém o "em uso" fresco e auto-salva a sessão (só sobe se mudou).
    this.saveTimer = setInterval(() => void this.heartbeat(), 2 * 60 * 1000)
    ses.cookies.on('changed', this.onCookieChanged)
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

  setPendingState(ls: LocalStorageMap, idb: IndexedDbMap): void {
    this.pendingLocalStorage = ls
    this.pendingIndexedDb = idb
  }

  /**
   * DIAGNÓSTICO (Ctrl+Shift+D): despeja todos os tipos de storage da aba ativa
   * (cookies, localStorage, sessionStorage, IndexedDB) num arquivo, para
   * descobrir ONDE um site guarda o token de auth. Temporário/investigativo.
   */
  async dumpStorageDiagnostic(): Promise<void> {
    const view = this.tabs.get(this.activeId)
    if (!view || view.webContents.isDestroyed()) return
    const wc = view.webContents

    const script = `(async () => {
      const out = { url: location.href, origin: location.origin, localStorage: {}, sessionStorage: {}, indexedDB: {} }
      const dump = (store, target) => { try { for (const k of Object.keys(store)) { const v = store.getItem(k); target[k] = { len: (v||'').length, sample: (v||'').slice(0, 500) } } } catch (e) { target.__error = String(e) } }
      dump(localStorage, out.localStorage)
      dump(sessionStorage, out.sessionStorage)
      try {
        const dbs = indexedDB.databases ? await indexedDB.databases() : []
        for (const info of dbs) {
          const name = info.name; out.indexedDB[name] = {}
          await new Promise((resolve) => {
            const req = indexedDB.open(name)
            req.onsuccess = () => {
              const db = req.result; const stores = Array.from(db.objectStoreNames)
              let pending = stores.length; if (!pending) { db.close(); return resolve() }
              for (const s of stores) {
                try {
                  const os = db.transaction(s, 'readonly').objectStore(s)
                  const gv = os.getAll(); const gk = os.getAllKeys()
                  gv.onsuccess = () => { gk.onsuccess = () => {
                    out.indexedDB[name][s] = (gv.result||[]).map((v,i) => { try { const j = JSON.stringify(v); return { key: gk.result[i], len: j.length, sample: j.slice(0, 800) } } catch { return { key: gk.result[i], unserializable: true } } })
                    if (--pending === 0) { db.close(); resolve() }
                  } }
                  gv.onerror = () => { out.indexedDB[name][s] = { error: 'getAll' }; if (--pending===0){db.close();resolve()} }
                } catch (e) { out.indexedDB[name][s] = { error: String(e) }; if (--pending===0){db.close();resolve()} }
              }
            }
            req.onerror = () => { out.indexedDB[name] = { error: 'open' }; resolve() }
            req.onblocked = () => resolve()
          })
        }
      } catch (e) { out.indexedDBError = String(e) }
      return JSON.stringify(out)
    })()`

    try {
      const json = (await wc.executeJavaScript(script)) as string
      const parsed = JSON.parse(json)
      const cookies = await this.ses.cookies.get({})
      const full = {
        profile: this.profile.client_name,
        capturedUrl: parsed.url,
        cookies: cookies.map((c) => ({
          domain: c.domain,
          name: c.name,
          valueLen: c.value.length,
          session: c.session,
          httpOnly: c.httpOnly,
          secure: c.secure
        })),
        localStorage: parsed.localStorage,
        sessionStorage: parsed.sessionStorage,
        indexedDB: parsed.indexedDB,
        indexedDBError: parsed.indexedDBError
      }
      const file = join(app.getPath('userData'), 'storage-diagnostic.json')
      writeFileSync(file, JSON.stringify(full, null, 2))
      this.emit('focusAddress', {}) // feedback visual mínimo
      console.log('Diagnóstico de storage salvo em:', file)
    } catch (e) {
      console.error('Falha no diagnóstico de storage:', e)
    }
  }

  /** Origem http(s) da aba, ou null se não navegável. */
  private originOf(wc: Electron.WebContents): string | null {
    try {
      const u = new URL(wc.getURL())
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null
    } catch {
      return null
    }
  }

  /** Lê o localStorage de cada aba aberta, agrupado por origem. */
  private async captureLocalStorage(): Promise<LocalStorageMap> {
    const map: LocalStorageMap = {}
    for (const view of this.tabs.values()) {
      const wc = view.webContents
      if (wc.isDestroyed()) continue
      const origin = this.originOf(wc)
      if (!origin) continue
      try {
        const json = (await wc.executeJavaScript('JSON.stringify(window.localStorage)')) as string
        const entries = JSON.parse(json) as Record<string, string>
        if (entries && Object.keys(entries).length) map[origin] = entries
      } catch {
        /* aba sem acesso ao localStorage — ignora */
      }
    }
    return map
  }

  /** Lê todos os bancos IndexedDB de cada aba aberta, agrupado por origem. */
  private async captureIndexedDb(): Promise<IndexedDbMap> {
    const map: IndexedDbMap = {}
    for (const view of this.tabs.values()) {
      const wc = view.webContents
      if (wc.isDestroyed()) continue
      const origin = this.originOf(wc)
      if (!origin) continue
      try {
        const json = (await wc.executeJavaScript(IDB_DUMP_SCRIPT)) as string
        const dbs = JSON.parse(json) as IndexedDbMap[string]
        if (dbs && Object.keys(dbs).length) map[origin] = dbs
      } catch {
        /* aba sem acesso ao IndexedDB — ignora */
      }
    }
    return map
  }

  /**
   * Injeta localStorage + IndexedDB do servidor na aba (uma vez por origem) e
   * recarrega, para o SPA inicializar já autenticado. Sem isso, sites que guardam
   * o token no IndexedDB (Kiwify/localforage, apps Firebase) abrem deslogados.
   */
  private async restoreStateInto(wc: Electron.WebContents): Promise<void> {
    if (wc.isDestroyed()) return
    const origin = this.originOf(wc)
    if (!origin || this.restoredOrigins.has(origin)) return
    const ls = this.pendingLocalStorage[origin]
    const idb = this.pendingIndexedDb[origin]
    const hasLs = ls && Object.keys(ls).length > 0
    const hasIdb = idb && Object.keys(idb).length > 0
    if (!hasLs && !hasIdb) return
    this.restoredOrigins.add(origin)
    const script = buildRestoreScript(ls ?? {}, idb ?? {})
    try {
      const ok = (await wc.executeJavaScript(script)) as boolean
      if (ok && !wc.isDestroyed()) wc.reload()
    } catch {
      /* não conseguiu injetar — segue sem restaurar */
    }
  }

  /** Salva a sessão (cookies + localStorage + IndexedDB) se algo mudou. */
  async saveSession(): Promise<'saved' | 'unchanged'> {
    try {
      let ls = this.lastLocalStorage
      let idb = this.lastIndexedDb
      try {
        ls = await this.captureLocalStorage()
        idb = await this.captureIndexedDb()
        this.lastLocalStorage = ls
        this.lastIndexedDb = idb
      } catch {
        /* abas indisponíveis — usa o último estado capturado */
      }
      const h = await pushSession(this.profile.id, this.ses, ls, idb, this.baselineHash)
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
    if (this.cookiePushTimer) {
      clearTimeout(this.cookiePushTimer)
      this.cookiePushTimer = null
    }
    this.ses.cookies.removeListener('changed', this.onCookieChanged)
  }

  /** Último save + liberação do lock antes do app encerrar. */
  async flushForQuit(): Promise<void> {
    this.stopAutoSave()
    try {
      await this.saveSession()
      await getSupabase()
        .from('profiles')
        .update({ in_use_by: null, in_use_by_email: null, in_use_by_name: null, in_use_at: null })
        .eq('id', this.profile.id)
    } catch (e) {
      console.error('Erro no flush de sessão ao encerrar:', e)
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
    wc.on('dom-ready', () => void this.restoreStateInto(wc))
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
      case 'd':
        if (input.shift) {
          void this.dumpStorageDiagnostic()
          return true
        }
        return false
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

export async function openProfileBrowser(profileId: string, force = false): Promise<void> {
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

  // Lock duro: uso simultâneo rotaciona tokens em duas máquinas e o Google
  // derruba a sessão. Só abre por cima com confirmação explícita (force).
  const lockFresh =
    profile.in_use_at != null && Date.now() - new Date(profile.in_use_at).getTime() < LOCK_FRESH_MS
  if (!force && lockFresh && profile.in_use_by && profile.in_use_by !== user?.id) {
    const who = profile.in_use_by_name || profile.in_use_by_email || 'outro usuário'
    throw new Error(
      `Perfil em uso por ${who}. Abrir em duas máquinas ao mesmo tempo pode derrubar a sessão.`
    )
  }

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

  const {
    hash: baselineHash,
    localStorage: pendingLs,
    indexedDB: pendingIdb
  } = await pullSession(profileId, ses)

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
  shell.setPendingState(pendingLs, pendingIdb)

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

  // Intercepta o 'close' (antes da destruição) para salvar com as abas ainda
  // vivas — essencial para capturar o localStorage, que some quando a aba morre.
  let closeHandled = false
  win.on('close', (e) => {
    if (closeHandled || flushingQuit) return // já tratado, ou o before-quit cuida do flush
    e.preventDefault()
    closeHandled = true
    const save = (async () => {
      try {
        const result = await shell.saveSession()
        await sb
          .from('profiles')
          .update({ in_use_by: null, in_use_by_email: null, in_use_by_name: null, in_use_at: null })
          .eq('id', profileId)
        if (result === 'saved') await logAudit('salvou sessão', profileId, profile.client_name)
      } catch (e) {
        console.error('Erro ao salvar a sessão ao fechar o perfil:', e)
      } finally {
        shell.stopAutoSave()
        if (!win.isDestroyed()) win.destroy()
      }
    })()
    pendingSaves.add(save)
    void save.finally(() => pendingSaves.delete(save))
  })

  win.on('closed', () => {
    shell.stopAutoSave()
    shellByWindowId.delete(win.id)
    shellByProfileId.delete(profileId)
    proxyCreds.delete(profileId)
  })
}

// ===== Flush garantido no encerramento do app =====
// O save no 'closed' é assíncrono; se o app sair junto (última janela fechada,
// quit pelo menu, etc.), o push para o Supabase morre no meio e o servidor fica
// com um snapshot velho — receita de desconexão do Gmail. Aqui seguramos o quit
// até todos os saves terminarem (com teto de 10s para nunca travar a saída).
const pendingSaves = new Set<Promise<unknown>>()
let flushingQuit = false

app.on('before-quit', (event) => {
  if (flushingQuit) return
  const shells = [...shellByProfileId.values()].filter((s) => !s.win.isDestroyed())
  if (shells.length === 0 && pendingSaves.size === 0) return
  event.preventDefault()
  flushingQuit = true
  const timeout = new Promise((resolve) => setTimeout(resolve, 10_000))
  void Promise.race([
    Promise.allSettled([...shells.map((s) => s.flushForQuit()), ...pendingSaves]),
    timeout
  ]).then(() => app.quit())
})

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
