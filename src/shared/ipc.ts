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

  localList: 'local:list',
  localPlaces: 'local:places',

  transfersList: 'transfers:list',
  transfersCopy: 'transfers:copy',
  transfersCancel: 'transfers:cancel',
  transfersClear: 'transfers:clear',
  transfersReveal: 'transfers:reveal'
} as const

/** Pushed from main to every window. The renderer subscribes rather than polling. */
export const EVENTS = {
  devices: 'event:devices',
  shares: 'event:shares',
  transfers: 'event:transfers',
  /** Something changed on a peer; the renderer re-reads what it is showing. */
  peer: 'event:peer'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
