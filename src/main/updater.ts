import electronUpdater from 'electron-updater'
import { app, type BrowserWindow } from 'electron'

const { autoUpdater } = electronUpdater

let mainWin: BrowserWindow | null = null

export function initAutoUpdate(win: BrowserWindow): void {
  mainWin = win
  // Auto-update só funciona no app empacotado (não em dev).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    mainWin?.webContents.send('update:ready', { version: info.version })
  })
  autoUpdater.on('error', (err) => {
    console.error('Auto-update:', err instanceof Error ? err.message : err)
  })

  autoUpdater.checkForUpdates().catch((e) => {
    console.error('checkForUpdates:', e instanceof Error ? e.message : e)
  })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall()
}
