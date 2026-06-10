import { ipcMain } from 'electron'
import * as auth from './auth'
import * as vault from './vault'
import * as profiles from './profiles'
import * as audit from './audit'
import * as members from './members'
import * as proxies from './proxies'
import { isConfigured } from './supabase'
import { openProfileBrowser, registerBrowserIpc } from './browser'
import { installUpdate } from './updater'
import type { ApiResult, ProfileInput, ProxyInput, Role, Squad } from '../shared/types'

function wrap<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  return async (_event: Electron.IpcMainInvokeEvent, ...args: unknown[]): Promise<ApiResult<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }
}

export function registerIpc(): void {
  ipcMain.handle('config:status', wrap(async () => ({ configured: isConfigured() })))

  ipcMain.handle(
    'auth:signIn',
    wrap(async (email: string, password: string) => {
      const user = await auth.signIn(email, password)
      void audit.logAudit('entrou no app', null, null)
      return user
    })
  )
  ipcMain.handle('auth:signOut', wrap(() => auth.signOut()))
  ipcMain.handle('auth:currentUser', wrap(() => auth.getCurrentUser()))
  ipcMain.handle('auth:updateName', wrap((name: string) => auth.updateName(name)))
  ipcMain.handle('auth:changePassword', wrap((pw: string) => auth.changePassword(pw)))

  ipcMain.handle('vault:status', wrap(() => vault.vaultStatus()))
  ipcMain.handle('vault:initialize', wrap((pw: string) => vault.initializeVault(pw)))
  ipcMain.handle('vault:unlock', wrap((pw: string) => vault.unlockVault(pw)))
  ipcMain.handle('vault:isUnlocked', wrap(async () => vault.isUnlocked()))
  ipcMain.handle('vault:lock', wrap(async () => vault.lock()))
  ipcMain.handle('vault:changePassword', wrap((pw: string) => vault.changeVaultPassword(pw)))
  ipcMain.handle('vault:grantAccess', wrap((userId: string) => vault.grantAccess(userId)))
  ipcMain.handle('vault:revokeAccess', wrap((userId: string) => vault.revokeAccess(userId)))
  ipcMain.handle('vault:listAccess', wrap(() => vault.listVaultAccess()))

  ipcMain.handle('profiles:list', wrap(() => profiles.listProfiles()))
  ipcMain.handle('profiles:create', wrap((input: ProfileInput) => profiles.createProfile(input)))
  ipcMain.handle('profiles:update', wrap((id: string, input: ProfileInput) => profiles.updateProfile(id, input)))
  ipcMain.handle('profiles:remove', wrap((id: string) => profiles.removeProfile(id)))
  ipcMain.handle('profiles:requestDelete', wrap((id: string) => profiles.requestDeleteProfile(id)))
  ipcMain.handle('profiles:approveDelete', wrap((id: string) => profiles.approveDeleteProfile(id)))
  ipcMain.handle('profiles:rejectDelete', wrap((id: string) => profiles.rejectDeleteProfile(id)))
  ipcMain.handle('profiles:open', wrap((id: string) => openProfileBrowser(id)))

  ipcMain.handle('audit:list', wrap(() => audit.listAudit()))

  ipcMain.handle('members:list', wrap(() => members.listMembers()))
  ipcMain.handle('members:setRole', wrap((id: string, role: Role) => members.setMemberRole(id, role)))
  ipcMain.handle('members:setSquad', wrap((id: string, squad: Squad | null) => members.setMemberSquad(id, squad)))
  ipcMain.handle(
    'members:create',
    wrap((email: string, name: string, squad: Squad | null) => members.createMember(email, name, squad))
  )
  ipcMain.handle('members:remove', wrap((userId: string) => members.deleteMember(userId)))

  ipcMain.handle('proxies:list', wrap(() => proxies.listProxies()))
  ipcMain.handle('proxies:create', wrap((input: ProxyInput) => proxies.createProxy(input)))
  ipcMain.handle('proxies:update', wrap((id: string, input: ProxyInput) => proxies.updateProxy(id, input)))
  ipcMain.handle('proxies:remove', wrap((id: string) => proxies.removeProxy(id)))
  ipcMain.handle('proxies:test', wrap((input: ProxyInput) => proxies.testProxyConfig(input)))
  ipcMain.handle('proxies:testSaved', wrap((id: string) => proxies.testProxyById(id)))

  ipcMain.handle('update:install', wrap(async () => installUpdate()))

  registerBrowserIpc()
}
