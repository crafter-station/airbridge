import { BrowserWindow, nativeTheme, shell } from 'electron'
import { join } from 'node:path'

let mainWindow: BrowserWindow | null = null

/** Must track --color-chrome and --color-ink in styles.css. The window frame and the title-bar
 *  overlay are painted by the OS, so they cannot read the stylesheet the way everything else
 *  in the window does. */
const CHROME = { light: '#f2f2f2', dark: '#2b2b2d' }
const INK = { light: '#1d1d1f', dark: '#f2f2f5' }

function palette(): { chrome: string; ink: string } {
  const mode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return { chrome: CHROME[mode], ink: INK[mode] }
}

/** Set just before app.quit() so the close handler stops intercepting. Without it the app
 *  can never exit: every close is swallowed to keep shares alive in the tray. */
let quitting = false

export function markQuitting(): void {
  quitting = true
}

/** The window frame is hidden on both platforms so the toolbar can own the top strip, the way
 *  Finder's does. The OS still draws its own controls into that strip — traffic lights inset
 *  on macOS, an overlay on Windows — because faking those is always worse than the real ones. */
const TITLE_BAR_HEIGHT = 38

function chromeOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 12 } }
  }

  if (process.platform === 'win32') {
    const { chrome, ink } = palette()
    return {
      titleBarStyle: 'hidden',
      // Must match --color-chrome, or the strip the OS paints its buttons on shows as a
      // differently-coloured rectangle sitting inside our toolbar.
      titleBarOverlay: { color: chrome, symbolColor: ink, height: TITLE_BAR_HEIGHT }
    }
  }

  return {}
}

function create(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    // Painted before the renderer has anything on screen, so a light flash on a dark desktop
    // is exactly what this avoids.
    backgroundColor: palette().chrome,
    ...chromeOptions(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload touches nothing but contextBridge and ipcRenderer, both of which work in
      // a sandboxed renderer — so there is no reason to give this process Node at all.
      sandbox: true,
      // Chromium's built-in PDF viewer, for the preview panel. It only ever sees bytes from
      // our own protocol; the content policy admits no other source.
      plugins: true
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

  // The renderer follows the OS theme through prefers-color-scheme on its own. These two are
  // OS-drawn surfaces that do not, so they are repainted by hand when the setting flips.
  const followTheme = (): void => {
    if (win.isDestroyed()) return

    const { chrome, ink } = palette()
    win.setBackgroundColor(chrome)

    if (process.platform === 'win32') {
      win.setTitleBarOverlay({ color: chrome, symbolColor: ink, height: TITLE_BAR_HEIGHT })
    }
  }

  nativeTheme.on('updated', followTheme)
  win.on('closed', () => nativeTheme.off('updated', followTheme))

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
