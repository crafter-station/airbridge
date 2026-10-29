import { app, dialog, net, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { markQuitting } from './window'

const { autoUpdater } = electronUpdater

const REPOSITORY = 'crafter-station/airbridge'
const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases/latest`

/** The app lives in the tray for days at a time, so checking only at launch is not enough. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** Let startup — server, discovery, the first window — settle before touching the network. */
const FIRST_CHECK_DELAY_MS = 15_000

/**
 * Whether this copy can replace itself.
 *
 * Only an NSIS install on Windows can. macOS refuses to apply an update to an unsigned app,
 * and the portable Windows zip has no installer to re-run — updating it would install a
 * second copy somewhere else. Both of those get told about the release instead.
 */
function canSelfUpdate(): boolean {
  if (process.platform !== 'win32') return false
  return existsSync(join(dirname(app.getPath('exe')), `Uninstall ${app.getName()}.exe`))
}

/** Numeric x.y.z comparison. Releases are tagged plainly, so pre-release suffixes are ignored. */
function isNewer(candidate: string, current: string): boolean {
  const parse = (version: string): number[] =>
    version
      .replace(/^v/, '')
      .split('-')[0]
      .split('.')
      .map((part) => Number(part) || 0)

  const [a, b] = [parse(candidate), parse(current)]
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0)
  }
  return false
}

/** One prompt per version: a tray app that nags every six hours about the same release is
 *  worse than one that never mentions it. */
const announced = new Set<string>()

let installing = false

function startSelfUpdating(): void {
  autoUpdater.autoDownload = true
  // Declining "Restart now" still gets the update — it goes in the next time the app quits.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (error) => console.warn('[updater]', error))

  autoUpdater.on('update-downloaded', async (info) => {
    if (announced.has(info.version)) return
    announced.add(info.version)

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update ready',
      message: `airbridge ${info.version} is ready to install.`,
      detail: 'Restart now to use it, or it will be installed the next time airbridge quits.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1
    })

    if (response === 0) {
      installing = true
      markQuitting()
      autoUpdater.quitAndInstall()
    }
  })
}

async function latestRelease(): Promise<{ version: string; url: string } | null> {
  const response = await net.fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' }
  })
  if (!response.ok) return null

  const release = (await response.json()) as { tag_name?: string; html_url?: string }
  if (!release.tag_name) return null
  return { version: release.tag_name.replace(/^v/, ''), url: release.html_url ?? RELEASES_PAGE }
}

async function announceRelease(manual: boolean): Promise<void> {
  const release = await latestRelease()

  if (!release || !isNewer(release.version, app.getVersion())) {
    if (manual) await showUpToDate()
    return
  }

  if (!manual && announced.has(release.version)) return
  announced.add(release.version)

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Update available',
    message: `airbridge ${release.version} is available.`,
    detail: `You have ${app.getVersion()}. Download the new version from GitHub to update.`,
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1
  })

  if (response === 0) await shell.openExternal(release.url)
}

async function showUpToDate(): Promise<void> {
  await dialog.showMessageBox({
    type: 'info',
    title: 'No updates',
    message: `airbridge ${app.getVersion()} is the latest version.`
  })
}

/** Check now. `manual` is a person asking from the menu, who deserves an answer either way. */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!app.isPackaged || installing) {
    if (manual) await showUpToDate()
    return
  }

  try {
    if (!canSelfUpdate()) {
      await announceRelease(manual)
      return
    }

    const result = await autoUpdater.checkForUpdates()
    const available = result && isNewer(result.updateInfo.version, app.getVersion())
    if (manual && !available) await showUpToDate()
    // When there is one, it downloads in the background and 'update-downloaded' asks.
  } catch (cause) {
    console.warn('[updater] check failed:', cause)
    if (manual) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not reach GitHub to check for updates.',
        detail: cause instanceof Error ? cause.message : String(cause)
      })
    }
  }
}

export function startUpdater(): void {
  // A dev build has no published version to compare against.
  if (!app.isPackaged) return

  if (canSelfUpdate()) startSelfUpdating()

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}
