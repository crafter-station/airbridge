/** Channel names shared by main and preload so a typo can't silently create a dead channel. */

export const IPC = {
  getAppInfo: 'app:get-info',

  serverStatus: 'server:status',

  sharesList: 'shares:list',
  sharesAdd: 'shares:add',
  sharesRemove: 'shares:remove',
  sharesSetWritable: 'shares:set-writable',

  devicesList: 'devices:list',
  devicesPair: 'devices:pair',
  devicesUnpair: 'devices:unpair',

  peerShares: 'peer:shares',
  peerList: 'peer:list',
  peerDownload: 'peer:download'
} as const

/** Pushed from main to every window. The renderer subscribes rather than polling. */
export const EVENTS = {
  devices: 'event:devices',
  shares: 'event:shares'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
