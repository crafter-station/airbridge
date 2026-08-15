import { Menu, Tray, nativeImage, nativeTheme, app } from 'electron'

import { resourcePath } from './resources'
import { markQuitting, showWindow, toggleWindow } from './window'

let tray: Tray | null = null

/** macOS renders template images itself, inverting them for light/dark menu bars. Windows
 *  does not, so we pick a black or white glyph by hand and re-pick when the theme flips. */
function trayIcon(): Electron.NativeImage {
  if (process.platform === 'darwin') {
    const image = nativeImage.createFromPath(resourcePath('trayTemplate.png'))
    image.setTemplateImage(true)
    return image
  }

  const file = nativeTheme.shouldUseDarkColors ? 'tray-white.png' : 'tray-black.png'
  return nativeImage.createFromPath(resourcePath(file))
}

export function createTray(): Tray {
  tray = new Tray(trayIcon())
  tray.setToolTip('airbridge')

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open airbridge', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Quit airbridge',
        click: () => {
          markQuitting()
          app.quit()
        }
      }
    ])
  )

  // A left click should open the window; on macOS that is the menu bar item's whole job,
  // and the context menu still comes up on right click.
  tray.on('click', () => toggleWindow())

  if (process.platform !== 'darwin') {
    nativeTheme.on('updated', () => tray?.setImage(trayIcon()))
  }

  return tray
}
