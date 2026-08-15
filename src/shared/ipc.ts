/** Channel names shared by main and preload so a typo can't silently create a dead channel. */

export const IPC = {
  getAppInfo: 'app:get-info',

  serverStatus: 'server:status',

  sharesList: 'shares:list',
  sharesAdd: 'shares:add',
  sharesRemove: 'shares:remove',
  sharesSetWritable: 'shares:set-writable',

  peerShares: 'peer:shares',
  peerList: 'peer:list',
  peerDownload: 'peer:download'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
