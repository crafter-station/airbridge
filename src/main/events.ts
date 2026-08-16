import { BrowserWindow } from 'electron'

/** Push a change to every open window. The renderer never polls: shares, peers and transfers
 *  all change without anyone clicking anything, and a hidden window that reappears stale is
 *  worse than one that was never told. */
export function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}
