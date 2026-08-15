/** Types crossing the main <-> renderer boundary. Kept free of Electron and Node imports
 *  so both sides can compile against them. */

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
