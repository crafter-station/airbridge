import { app, ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import { getAppInfo } from './identity'
import { createTray } from './tray'
import { markQuitting, showWindow } from './window'

/** Loopback testing needs two instances on one machine (M1), so the lock is opt-out.
 *  Set AIRBRIDGE_ALLOW_MULTI=1 to run a second copy against the first. */
const allowMultipleInstances = process.env['AIRBRIDGE_ALLOW_MULTI'] === '1'

if (!allowMultipleInstances && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(() => {
    ipcMain.handle(IPC.getAppInfo, () => getAppInfo())

    createTray()
    showWindow()

    // macOS: clicking the dock icon after the window was closed should bring it back.
    app.on('activate', () => showWindow())
  })

  // Deliberately empty: closing the last window hides the app, it does not quit it. Shares
  // stay published until the user quits from the tray.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => markQuitting())
}
