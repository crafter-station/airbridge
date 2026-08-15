import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null

/** Set just before app.quit() so the close handler stops intercepting. Without it the app
 *  can never exit: every close is swallowed to keep shares alive in the tray. */
let quitting = false

export function markQuitting(): void {
  quitting = true
}

function create(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f6f6f6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // electron-vite emits a CommonJS preload; sandbox stays off to match that toolchain.
      // Revisit as part of the M6 hardening pass.
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Closing the window must not stop sharing — that is the entire point of living in the tray.
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })

  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

export function showWindow(): void {
  mainWindow ??= create()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

export function toggleWindow(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
    return
  }
  showWindow()
}
