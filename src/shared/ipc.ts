/** Channel names shared by main and preload so a typo can't silently create a dead channel. */

export const IPC = {
  getAppInfo: 'app:get-info'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
