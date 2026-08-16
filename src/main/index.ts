import { app, dialog, ipcMain } from 'electron'

import { EVENTS, IPC } from '@shared/ipc'
import type {
  DirEntry,
  DownloadResult,
  KnownDevice,
  PeerShares,
  ServerStatus,
  Share,
  TrustedDevice
} from '@shared/types'
import { getCertificate } from './cert'
import { knownDevices, notifyDevicesChanged, pairWith, resolvePeer, unpair } from './devices'
import { onPeersChanged, startDiscovery, stopDiscovery } from './discovery'
import { broadcast } from './events'
import { getAppInfo } from './identity'
import { localAddresses } from './network'
import { downloadFile, listPeerDirectory, listPeerShares } from './peer'
import { serverPort, startServer, stopServer } from './server'
import { addShare, listShares, removeShare, setShareWritable } from './shares'
import { createTray } from './tray'
import { markQuitting, showWindow } from './window'

/**
 * Two instances of one Electron app share a userData directory, which would give them the
 * same device id, certificate and shares — so loopback testing (PLAN.md, Q17) would be
 * testing a machine against itself. Pointing each instance at its own directory makes them
 * genuinely separate devices.
 *
 * Set before anything touches a store, because the first read is what fixes the location.
 */
const dataDirectory = process.env['AIRBRIDGE_DATA_DIR']
if (dataDirectory) app.setPath('userData', dataDirectory)

/** Loopback testing needs two instances on one machine, so the lock is opt-out. */
const allowMultipleInstances = process.env['AIRBRIDGE_ALLOW_MULTI'] === '1'

function announceShares(): Share[] {
  const shares = listShares()
  broadcast(EVENTS.shares, shares)
  return shares
}

function registerHandlers(): void {
  ipcMain.handle(IPC.getAppInfo, () => getAppInfo())

  ipcMain.handle(IPC.serverStatus, async (): Promise<ServerStatus> => {
    const certificate = await getCertificate()
    return {
      port: serverPort(),
      fingerprint: certificate.fingerprint,
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
    if (picked.canceled || !path) return null

    const share = addShare(path)
    announceShares()
    return share
  })

  ipcMain.handle(IPC.sharesRemove, (_event, id: string): Share[] => {
    removeShare(id)
    return announceShares()
  })

  ipcMain.handle(IPC.sharesSetWritable, (_event, id: string, writable: boolean): Share[] => {
    setShareWritable(id, writable)
    return announceShares()
  })

  ipcMain.handle(IPC.devicesList, (): KnownDevice[] => knownDevices())

  ipcMain.handle(
    IPC.devicesPair,
    (_event, host: string, port: number): Promise<TrustedDevice> => pairWith(host, port)
  )

  ipcMain.handle(IPC.devicesUnpair, (_event, deviceId: string): KnownDevice[] => {
    unpair(deviceId)
    return knownDevices()
  })

  ipcMain.handle(
    IPC.peerShares,
    (_event, deviceId: string): Promise<PeerShares> => listPeerShares(resolvePeer(deviceId))
  )

  ipcMain.handle(
    IPC.peerList,
    (_event, deviceId: string, shareId: string, path: string): Promise<DirEntry[]> =>
      listPeerDirectory(resolvePeer(deviceId), shareId, path)
  )

  ipcMain.handle(
    IPC.peerDownload,
    (_event, deviceId: string, shareId: string, path: string): Promise<DownloadResult> =>
      downloadFile(resolvePeer(deviceId), shareId, path, app.getPath('downloads'), {
        resume: true
      })
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
    const port = await startServer()
    await startDiscovery(port)

    onPeersChanged(() => notifyDevicesChanged())

    createTray()

    // The smoke tests drive a real instance over the network and have no use for a window.
    if (process.env['AIRBRIDGE_HEADLESS'] !== '1') showWindow()

    const selfTestTarget = process.env['AIRBRIDGE_SELFTEST_TARGET']
    if (!app.isPackaged && selfTestTarget) {
      const { runSelfTest } = await import('./selftest')
      await runSelfTest(selfTestTarget)
      app.quit()
      return
    }

    // macOS: clicking the dock icon after the window was closed should bring it back.
    app.on('activate', () => showWindow())
  })

  // Deliberately empty: closing the last window hides the app, it does not quit it.
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    markQuitting()
    void stopDiscovery().then(() => stopServer())
  })
}
