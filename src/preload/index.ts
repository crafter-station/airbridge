import { contextBridge, ipcRenderer } from 'electron'

import { IPC } from '@shared/ipc'
import type {
  AppInfo,
  DirEntry,
  DownloadResult,
  PeerAddress,
  PeerShares,
  ServerStatus,
  Share
} from '@shared/types'

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
      ipcRenderer.invoke(IPC.sharesSetWritable, id, writable)
  },

  peer: {
    shares: (peer: PeerAddress): Promise<PeerShares> => ipcRenderer.invoke(IPC.peerShares, peer),
    list: (peer: PeerAddress, shareId: string, path: string): Promise<DirEntry[]> =>
      ipcRenderer.invoke(IPC.peerList, peer, shareId, path),
    download: (peer: PeerAddress, shareId: string, path: string): Promise<DownloadResult> =>
      ipcRenderer.invoke(IPC.peerDownload, peer, shareId, path)
  }
}

export type AirbridgeApi = typeof api

contextBridge.exposeInMainWorld('airbridge', api)
