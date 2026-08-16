/** Types crossing the main <-> renderer boundary, and the wire format between peers.
 *  Kept free of Electron and Node imports so both sides can compile against them. */

export type Platform = 'darwin' | 'win32' | 'linux'

export interface AppInfo {
  /** Stable per-install identity. Devices are trusted on this plus their cert fingerprint,
   *  never on IP address — see PLAN.md, Q21. */
  deviceId: string
  /** What other machines call us in their sidebar. Defaults to the hostname. */
  deviceName: string
  platform: Platform
  appVersion: string
  electronVersion: string
}

export interface NetworkAddress {
  /** The adapter, e.g. `Wi-Fi` or `en0`. Shown so a person can tell which one to type. */
  name: string
  address: string
}

export interface Share {
  id: string
  /** Display name. Defaults to the folder's own name, and is what peers see. */
  name: string
  /** Absolute path on the publishing machine. Never sent to peers. */
  path: string
  writable: boolean
  /** False when the folder has been deleted, renamed, or its drive unplugged. */
  available: boolean
}

/** What a peer is allowed to know about a share — notably not its path on disk. */
export type PublicShare = Omit<Share, 'path'>

export type EntryKind = 'file' | 'directory'

export interface DirEntry {
  name: string
  kind: EntryKind
  size: number
  /** Epoch milliseconds. */
  mtime: number
}

export interface ServerStatus {
  port: number | null
  fingerprint: string | null
  addresses: NetworkAddress[]
}

/** Everything needed to reach another airbridge instance. */
export interface PeerAddress {
  host: string
  port: number
  token: string
  /** When set, a mismatching certificate aborts the connection instead of prompting. */
  fingerprint?: string
}

export interface PeerShares {
  shares: PublicShare[]
  /** The certificate we actually saw, for the caller to pin. */
  fingerprint: string
}

/** A device seen on the network right now. Presence says nothing about trust. */
export interface DiscoveredPeer {
  deviceId: string
  deviceName: string
  fingerprint: string
  host: string
  port: number
  protocolVersion: number
  paired: boolean
}

/**
 * A device this machine has approved.
 *
 * Two tokens, because pairing is mutual in one approval: `inboundToken` is what we handed
 * them to call us with, `outboundToken` is what they handed us. Revoking a device throws
 * away both, and does not touch anyone else.
 */
export interface TrustedDevice {
  deviceId: string
  deviceName: string
  /** Pinned at pairing. A device presenting a different certificate is refused outright. */
  fingerprint: string
  inboundToken: string
  outboundToken: string
  /** Where it was last reachable, used when mDNS has not found it yet. */
  lastHost: string | null
  lastPort: number | null
  pairedAt: number
}

/** What a device sends when asking to be let in. */
export interface PairRequest {
  deviceId: string
  deviceName: string
  /** Must match the client certificate presented on the same connection. */
  fingerprint: string
  protocolVersion: number
  /** The token the requester grants us, so the trust works in both directions. */
  grantToken: string
}

export interface PairResponse {
  deviceId: string
  deviceName: string
  /** The token we grant the requester. */
  token: string
}

/** A device in the sidebar: discovered, trusted, or both. */
export interface KnownDevice {
  deviceId: string
  deviceName: string
  paired: boolean
  online: boolean
  host: string | null
  port: number | null
}

export interface DownloadResult {
  path: string
  bytes: number
}

/** One thing the user asked to copy. Folders expand to their contents while the job runs. */
export interface TransferItem {
  name: string
  kind: EntryKind
  /** Path relative to the share root. */
  path: string
  /** Known for files, absent for folders until the job walks them. */
  size?: number
}

export type TransferStatus =
  /** Walking the remote tree to find out how much work there is. */
  | 'scanning'
  | 'transferring'
  | 'done'
  | 'failed'
  | 'cancelled'

export interface TransferJob {
  id: string
  deviceId: string
  deviceName: string
  shareName: string
  destination: string
  status: TransferStatus
  /** Zero until scanning finishes, so progress is honest rather than optimistic. */
  totalBytes: number
  transferredBytes: number
  totalFiles: number
  completedFiles: number
  skippedFiles: number
  currentFile: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}
