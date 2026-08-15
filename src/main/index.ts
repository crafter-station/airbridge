import { app, dialog, ipcMain } from 'electron'

import { IPC } from '@shared/ipc'
import type {
  DirEntry,
  DownloadResult,
  PeerAddress,
  PeerShares,
  ServerStatus,
  Share
} from '@shared/types'
import { getAccessToken } from './auth'
import { getCertificate } from './cert'
import { getAppInfo } from './identity'
import { localAddresses } from './network'
import { downloadFile, listPeerDirectory, listPeerShares } from './peer'
import { serverPort, startServer, stopServer } from './server'
import { addShare, listShares, removeShare, setShareWritable } from './shares'
import { createTray } from './tray'
import { markQuitting, showWindow } from './window'

/** Loopback testing needs two instances on one machine (PLAN.md, Q17), so the lock is
 *  opt-out. Set AIRBRIDGE_ALLOW_MULTI=1 to run a second copy against the first. */
const allowMultipleInstances = process.env['AIRBRIDGE_ALLOW_MULTI'] === '1'

function registerHandlers(): void {
  ipcMain.handle(IPC.getAppInfo, () => getAppInfo())

  ipcMain.handle(IPC.serverStatus, async (): Promise<ServerStatus> => {
    const certificate = await getCertificate()
    return {
      port: serverPort(),
      fingerprint: certificate.fingerprint,
      token: getAccessToken(),
      addresses: localAddresses()
    }
  })

  ipcMain.handle(IPC.sharesList, (): Share[] => listShares())

  ipcMain.handle(IPC.sharesAdd, async (): Promise<Share | null> => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose a folder to share',
      properties: ['openDirectory', 'createDirectory']
    })

    const [path] = picked.filePaths
    return picked.canceled || !path ? null : addShare(path)
  })

  ipcMain.handle(IPC.sharesRemove, (_event, id: string): Share[] => {
    removeShare(id)
    return listShares()
  })

  ipcMain.handle(IPC.sharesSetWritable, (_event, id: string, writable: boolean): Share[] => {
    setShareWritable(id, writable)
    return listShares()
  })

  ipcMain.handle(IPC.peerShares, (_event, peer: PeerAddress): Promise<PeerShares> =>
    listPeerShares(peer)
  )

  ipcMain.handle(
    IPC.peerList,
    (_event, peer: PeerAddress, shareId: string, path: string): Promise<DirEntry[]> =>
      listPeerDirectory(peer, shareId, path)
  )

  ipcMain.handle(
    IPC.peerDownload,
    (_event, peer: PeerAddress, shareId: string, path: string): Promise<DownloadResult> =>
      downloadFile(peer, shareId, path, app.getPath('downloads'), { resume: true })
  )
}

if (!allowMultipleInstances && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(async () => {
    registerHandlers()

    // Sharing starts with the app, not with the window: the point of living in the tray is
    // that a share published this morning is still reachable this afternoon.
    await startServer()

    createTray()

    // The smoke tests drive a real instance over the network and have no use for a window.
    if (process.env['AIRBRIDGE_HEADLESS'] !== '1') showWindow()

    // macOS: clicking the dock icon after the window was closed should bring it back.
    app.on('activate', () => showWindow())
  })

  // Deliberately empty: closing the last window hides the app, it does not quit it.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
    void stopServer()
  })
}
