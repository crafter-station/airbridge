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
  /** Bearer token for this instance. Hard-coded trust for M1; replaced by per-device tokens
   *  issued at pairing in M2. */
  token: string | null
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

export interface DownloadResult {
  path: string
  bytes: number
}
