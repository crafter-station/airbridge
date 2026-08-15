import { contextBridge, ipcRenderer } from 'electron'

import { IPC } from '@shared/ipc'
import type { AppInfo } from '@shared/types'

/** The only surface the renderer gets. Every addition here is a hole in context isolation,
 *  so each one stays a narrow, named operation rather than a generic `invoke` passthrough. */
const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.getAppInfo)
}

export type AirbridgeApi = typeof api

contextBridge.exposeInMainWorld('airbridge', api)
