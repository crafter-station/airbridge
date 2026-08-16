import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

import { EVENTS, IPC } from '@shared/ipc'
import type {
  AppInfo,
  DirEntry,
  DownloadResult,
  KnownDevice,
  PeerShares,
  ServerStatus,
  Share,
  TrustedDevice
} from '@shared/types'

/** Wrap a push channel as a subscribe function that hands back its own unsubscribe, so a
 *  React effect can clean up without the renderer ever touching ipcRenderer. */
function subscribe<T>(channel: string) {
  return (listener: (payload: T) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => {
      ipcRenderer.off(channel, handler)
    }
  }
}

/** The only surface the renderer gets. Every addition here is a hole in context isolation,
 *  so each one stays a narrow, named operation rather than a generic `invoke` passthrough. */
const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.getAppInfo),

  serverStatus: (): Promise<ServerStatus> => ipcRenderer.invoke(IPC.serverStatus),

  shares: {
    list: (): Promise<Share[]> => ipcRenderer.invoke(IPC.sharesList),
    add: (): Promise<Share | null> => ipcRenderer.invoke(IPC.sharesAdd),
    remove: (id: string): Promise<Share[]> => ipcRenderer.invoke(IPC.sharesRemove, id),
    setWritable: (id: string, writable: boolean): Promise<Share[]> =>
      ipcRenderer.invoke(IPC.sharesSetWritable, id, writable),
    onChanged: subscribe<Share[]>(EVENTS.shares)
  },

  devices: {
    list: (): Promise<KnownDevice[]> => ipcRenderer.invoke(IPC.devicesList),
    pair: (host: string, port: number): Promise<TrustedDevice> =>
      ipcRenderer.invoke(IPC.devicesPair, host, port),
    unpair: (deviceId: string): Promise<KnownDevice[]> =>
      ipcRenderer.invoke(IPC.devicesUnpair, deviceId),
    onChanged: subscribe<KnownDevice[]>(EVENTS.devices)
  },

  peer: {
    shares: (deviceId: string): Promise<PeerShares> => ipcRenderer.invoke(IPC.peerShares, deviceId),
    list: (deviceId: string, shareId: string, path: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke(IPC.peerList, deviceId, shareId, path),
    download: (deviceId: string, shareId: string, path: string): Promise<DownloadResult> =>
      ipcRenderer.invoke(IPC.peerDownload, deviceId, shareId, path)
  }
}

export type AirbridgeApi = typeof api

contextBridge.exposeInMainWorld('airbridge', api)
