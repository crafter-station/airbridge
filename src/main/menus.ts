import { BrowserWindow, Menu, dialog, shell } from 'electron'

import type { Share } from '@shared/types'
import { getShare, removeShare, setShareWritable } from './shares'

/**
 * Native context menus rather than HTML ones.
 *
 * These are the management surfaces — make a share writable, stop sharing, unpair a device —
 * and they are rare enough that giving them permanent room in the window would be wrong. A
 * native menu also gets platform behaviour for free, which a div pretending to be a menu
 * never quite does.
 */
export function showShareMenu(
  shareId: string,
  onChanged: () => void
): void {
  const share = getShare(shareId)
  if (!share) return

  Menu.buildFromTemplate([
    {
      label: 'Open in ' + (process.platform === 'darwin' ? 'Finder' : 'File Explorer'),
      enabled: share.available,
      click: () => shell.openPath(share.path)
    },
    { type: 'separator' },
    {
      label: 'Allow editing',
      type: 'checkbox',
      checked: share.writable,
      click: () => {
        setShareWritable(shareId, !share.writable)
        onChanged()
      }
    },
    { type: 'separator' },
    {
      label: 'Stop sharing',
      click: () => {
        if (!confirmStopSharing(share)) return
        removeShare(shareId)
        onChanged()
      }
    }
  ]).popup()
}

/** Removing a share is reversible in a second, but it is still the user's folder — say what
 *  the action does and does not do before doing it. */
function confirmStopSharing(share: Share): boolean {
  const response = dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['Stop Sharing', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: `Stop sharing “${share.name}”?`,
    detail: 'Paired devices will no longer see it. Nothing on disk is deleted.',
    noLink: true
  })

  return response === 0
}

export function showDeviceMenu(
  deviceName: string,
  onUnpair: () => void
): void {
  Menu.buildFromTemplate([
    {
      label: 'Disconnect',
      click: () => {
        const response = dialog.showMessageBoxSync({
          type: 'warning',
          buttons: ['Disconnect', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          message: `Disconnect from “${deviceName}”?`,
          detail:
            'You will each have to approve the other again before you can browse. Nothing ' +
            'already copied is affected.',
          noLink: true
        })

        if (response === 0) onUnpair()
      }
    }
  ]).popup({ window: BrowserWindow.getFocusedWindow() ?? undefined })
}
