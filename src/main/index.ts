import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { getProxyCredsFor, chromeUserAgent } from './browser'
import { initAutoUpdate } from './updater'

// Remove o token `Electron/<versão>` do User-Agent a nível de processo (afeta
// todas as janelas/sessions de forma coerente). É o sinal mais óbvio de webview;
// mantemos o resto do UA e os Client Hints nativos para não criar incoerência.
app.userAgentFallback = chromeUserAgent()

// Desabilita WebAuthn/passkey: a tela de login do Google dispara automaticamente
// o prompt "Inserir chave de segurança na porta USB". Como essas contas logam
// com senha, suprimir o WebAuthn leva o fluxo direto ao campo de senha.
// (Switch deve ser aplicado antes do app ficar pronto.)
app.commandLine.appendSwitch('disable-features', 'WebAuthentication')

let mainWindow: BrowserWindow | null = null

// Em dev, usa o PNG do ícone na barra de tarefas; empacotado, o ícone vem do .exe.
export const DEV_ICON = app.isPackaged ? undefined : join(__dirname, '../../build/icon.png')

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 880,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'Inside Cofre de Acessos',
    icon: DEV_ICON,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Links externos abrem no navegador padrão, não em janelas do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Autenticação de proxy por perfil: responde com as credenciais do perfil dono da janela.
app.on('login', (event, webContents, _details, authInfo, callback) => {
  if (authInfo.isProxy) {
    const creds = getProxyCredsFor(webContents.id)
    if (creds) {
      event.preventDefault()
      callback(creds.username, creds.password)
      return
    }
  }
  // Demais casos: comportamento padrão (cancela o prompt).
})

app.whenReady().then(() => {
  registerIpc()
  createMainWindow()
  if (mainWindow) initAutoUpdate(mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
