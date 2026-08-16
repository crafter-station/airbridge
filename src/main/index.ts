import { app, dialog, ipcMain, shell } from 'electron'

import { EVENTS, IPC } from '@shared/ipc'
import type {
  DirEntry,
  KnownDevice,
  LocalListing,
  LocalPlace,
  PeerShares,
  ServerStatus,
  Share,
  TransferItem,
  TransferJob,
  TrustedDevice
} from '@shared/types'
import { getCertificate } from './cert'
import { knownDevices, notifyDevicesChanged, pairWith, resolvePeer, unpair } from './devices'
import { onPeersChanged, startDiscovery, stopDiscovery } from './discovery'
import { broadcast } from './events'
import { ensureIdentity, getAppInfo } from './identity'
import { listLocal, localPlaces } from './local'
import { showDeviceMenu, showShareMenu } from './menus'
import { localAddresses } from './network'
import { listPeerDirectory, listPeerShares } from './peer'
import { startPeerEvents, stopPeerEvents, syncConnections } from './peerEvents'
import { cancelJob, clearFinishedJobs, listJobs, startCopy, startUpload } from './transfers'
import { onShareAvailabilityChanged, refreshWatchers, startWatching, stopWatching } from './watcher'
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
  // Watchers follow the share list: adding a folder should start watching it immediately,
  // not at the next availability sweep.
  refreshWatchers()
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

  ipcMain.handle(IPC.sharesMenu, (_event, id: string): void => {
    showShareMenu(id, () => announceShares())
  })

  ipcMain.handle(IPC.devicesList, (): KnownDevice[] => knownDevices())

  ipcMain.handle(IPC.devicesMenu, (_event, deviceId: string, deviceName: string): void => {
    showDeviceMenu(deviceName, () => {
      unpair(deviceId)
      syncConnections()
    })
  })

  // Pairing and unpairing both change which peers we should hold an event socket to. Wired
  // here rather than inside devices.ts, which peerEvents.ts already depends on.
  ipcMain.handle(
    IPC.devicesPair,
    async (_event, host: string, port: number): Promise<TrustedDevice> => {
      const device = await pairWith(host, port)
      syncConnections()
      return device
    }
  )

  ipcMain.handle(IPC.devicesUnpair, (_event, deviceId: string): KnownDevice[] => {
    unpair(deviceId)
    syncConnections()
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

  ipcMain.handle(IPC.localList, (_event, path: string): Promise<LocalListing> => listLocal(path))

  ipcMain.handle(IPC.localPlaces, (): LocalPlace[] => localPlaces())

  ipcMain.handle(IPC.transfersList, (): TransferJob[] => listJobs())

  ipcMain.handle(
    IPC.transfersCopy,
    async (
      _event,
      deviceId: string,
      shareId: string,
      shareName: string,
      items: TransferItem[],
      destination?: string
    ): Promise<TransferJob | null> => {
      // A destination given by the caller comes from the local pane (M4). Without one, fall
      // back to asking, which is what the M3 console does.
      let target = destination
      if (!target) {
        const picked = await dialog.showOpenDialog({
          title: 'Copy to',
          buttonLabel: 'Copy Here',
          properties: ['openDirectory', 'createDirectory']
        })
        if (picked.canceled || !picked.filePaths[0]) return null
        target = picked.filePaths[0]
      }

      const device = knownDevices().find((known) => known.deviceId === deviceId)

      return startCopy({
        peer: resolvePeer(deviceId),
        deviceId,
        deviceName: device?.deviceName ?? deviceId,
        shareId,
        shareName,
        items,
        destination: target
      })
    }
  )

  ipcMain.handle(
    IPC.transfersUpload,
    (
      _event,
      deviceId: string,
      shareId: string,
      shareName: string,
      localPaths: string[],
      remoteDirectory: string
    ): TransferJob => {
      const device = knownDevices().find((known) => known.deviceId === deviceId)

      return startUpload({
        peer: resolvePeer(deviceId),
        deviceId,
        deviceName: device?.deviceName ?? deviceId,
        shareId,
        shareName,
        localPaths,
        remoteDirectory
      })
    }
  )

  ipcMain.handle(IPC.transfersCancel, (_event, id: string): void => cancelJob(id))

  ipcMain.handle(IPC.transfersClear, (): TransferJob[] => {
    clearFinishedJobs()
    return listJobs()
  })

  ipcMain.handle(IPC.transfersReveal, (_event, path: string): void => shell.showItemInFolder(path))
}

if (!allowMultipleInstances && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())

  void app.whenReady().then(async () => {
    ensureIdentity()
    registerHandlers()

    // Sharing starts with the app, not with the window: the point of living in the tray is
    // that a share published this morning is still reachable this afternoon.
    const port = await startServer()

    // mDNS opens a multicast socket, which is a second firewall prompt during local work.
    // Peers seeded by hand are reachable through their remembered address without it.
    if (process.env['AIRBRIDGE_NO_DISCOVERY'] !== '1') {
      await startDiscovery(port)
      onPeersChanged(() => {
        notifyDevicesChanged()
        // A device coming back online is the moment its event socket can be re-established.
        syncConnections()
      })
    }

    startWatching()
    onShareAvailabilityChanged(() => announceShares())
    startPeerEvents()

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
    stopPeerEvents()
    void stopWatching()
      .then(() => stopDiscovery())
      .then(() => stopServer())
  })
}
