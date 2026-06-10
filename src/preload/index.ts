import { contextBridge, ipcRenderer } from 'electron'
import type {
  ApiResult,
  AuthUser,
  AuditEntry,
  AuditQuery,
  Bookmark,
  BrowserProfileInfo,
  Member,
  Profile,
  ProfileInput,
  Proxy,
  ProxyInput,
  Role,
  Squad,
  TabState,
  VaultAccess,
  VaultStatus
} from '../shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<ApiResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<ApiResult<T>>
}

interface BrowserState {
  profile: BrowserProfileInfo
  tabs: TabState[]
  activeId: number
  chromeHeight: number
}

interface BrowserEvent {
  type: 'tabCreated' | 'tabUpdated' | 'tabClosed' | 'activeChanged' | 'focusAddress'
  data: unknown
}

const api = {
  config: {
    status: () => invoke<{ configured: boolean }>('config:status')
  },
  auth: {
    signIn: (email: string, password: string) => invoke<AuthUser>('auth:signIn', email, password),
    signOut: () => invoke<void>('auth:signOut'),
    currentUser: () => invoke<AuthUser | null>('auth:currentUser'),
    updateName: (name: string) => invoke<AuthUser>('auth:updateName', name),
    changePassword: (password: string) => invoke<void>('auth:changePassword', password)
  },
  vault: {
    status: () => invoke<VaultStatus>('vault:status'),
    initialize: (masterPassword: string) => invoke<void>('vault:initialize', masterPassword),
    unlock: (masterPassword: string) => invoke<boolean>('vault:unlock', masterPassword),
    isUnlocked: () => invoke<boolean>('vault:isUnlocked'),
    lock: () => invoke<void>('vault:lock'),
    changePassword: (newPassword: string) => invoke<void>('vault:changePassword', newPassword),
    grantAccess: (userId: string) => invoke<string>('vault:grantAccess', userId),
    revokeAccess: (userId: string) => invoke<void>('vault:revokeAccess', userId),
    listAccess: () => invoke<VaultAccess[]>('vault:listAccess')
  },
  profiles: {
    list: () => invoke<Profile[]>('profiles:list'),
    create: (input: ProfileInput) => invoke<Profile>('profiles:create', input),
    update: (id: string, input: ProfileInput) => invoke<Profile>('profiles:update', id, input),
    remove: (id: string) => invoke<void>('profiles:remove', id),
    requestDelete: (id: string) => invoke<void>('profiles:requestDelete', id),
    approveDelete: (id: string) => invoke<void>('profiles:approveDelete', id),
    rejectDelete: (id: string) => invoke<void>('profiles:rejectDelete', id),
    open: (id: string) => invoke<void>('profiles:open', id)
  },
  audit: {
    list: () => invoke<AuditEntry[]>('audit:list'),
    query: (q: AuditQuery) => invoke<AuditEntry[]>('audit:query', q)
  },
  members: {
    list: () => invoke<Member[]>('members:list'),
    setRole: (id: string, role: Role) => invoke<void>('members:setRole', id, role),
    setSquad: (id: string, squad: Squad | null) => invoke<void>('members:setSquad', id, squad),
    create: (email: string, name: string, squad: Squad | null) =>
      invoke<{ tempPassword: string; email: string }>('members:create', email, name, squad),
    remove: (userId: string) => invoke<void>('members:remove', userId)
  },
  proxies: {
    list: () => invoke<Proxy[]>('proxies:list'),
    create: (input: ProxyInput) => invoke<Proxy>('proxies:create', input),
    update: (id: string, input: ProxyInput) => invoke<Proxy>('proxies:update', id, input),
    remove: (id: string) => invoke<void>('proxies:remove', id),
    test: (input: ProxyInput) => invoke<{ ip: string }>('proxies:test', input),
    testSaved: (id: string) => invoke<{ ip: string }>('proxies:testSaved', id)
  },
  browser: {
    getState: () => ipcRenderer.invoke('browser:getState') as Promise<BrowserState | null>,
    newTab: (url?: string) => ipcRenderer.invoke('browser:newTab', url),
    closeTab: (id: number) => ipcRenderer.invoke('browser:closeTab', id),
    activateTab: (id: number) => ipcRenderer.invoke('browser:activateTab', id),
    navigate: (id: number, url: string) => ipcRenderer.invoke('browser:navigate', id, url),
    back: (id: number) => ipcRenderer.invoke('browser:back', id),
    forward: (id: number) => ipcRenderer.invoke('browser:forward', id),
    reload: (id: number) => ipcRenderer.invoke('browser:reload', id),
    setChromeHeight: (px: number) => ipcRenderer.invoke('browser:setChromeHeight', px),
    saveSession: () => ipcRenderer.invoke('browser:saveSession') as Promise<'saved' | 'unchanged'>,
    listBookmarks: () => ipcRenderer.invoke('browser:listBookmarks') as Promise<Bookmark[]>,
    addBookmark: (title: string, url: string) =>
      ipcRenderer.invoke('browser:addBookmark', title, url) as Promise<Bookmark>,
    removeBookmark: (id: string) => ipcRenderer.invoke('browser:removeBookmark', id),
    onEvent: (cb: (e: BrowserEvent) => void) => {
      const listener = (_e: unknown, payload: BrowserEvent): void => cb(payload)
      ipcRenderer.on('browser:event', listener)
      return () => {
        ipcRenderer.removeListener('browser:event', listener)
      }
    }
  },
  update: {
    onReady: (cb: (info: { version: string }) => void) => {
      const listener = (_e: unknown, info: { version: string }): void => cb(info)
      ipcRenderer.on('update:ready', listener)
      return () => {
        ipcRenderer.removeListener('update:ready', listener)
      }
    },
    install: () => ipcRenderer.invoke('update:install')
  }
}

export type CofreApi = typeof api

contextBridge.exposeInMainWorld('api', api)
