import { app, BrowserWindow, dialog, net } from 'electron'
import electronUpdater from 'electron-updater'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { EVENTS } from '@shared/ipc'
import type { UpdateState } from '@shared/types'
import { broadcast } from './events'
import { listJobs } from './transfers'
import { markQuitting } from './window'

const { autoUpdater } = electronUpdater

const REPOSITORY = 'crafter-station/airbridge'

/** Hourly: the app lives in the tray for days, and a fix should reach it the same day. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Let startup — server, discovery, the first window — settle before touching the network. */
const FIRST_CHECK_DELAY_MS = 15_000

/** Opening the window checks too, but not every time someone flicks it open and shut. */
const WINDOW_CHECK_MIN_GAP_MS = 10 * 60 * 1000

/**
 * How this copy replaces itself.
 *
 * - `installer`: an NSIS install on Windows. electron-updater re-runs the installer.
 * - `bundle`: macOS. Squirrel.Mac refuses an app without a Developer ID, so we swap the .app
 *   in place from the release .dmg after quitting.
 * - `portable`: the Windows zip. Same idea — unzip the release over the folder after quitting.
 */
type Mode = 'installer' | 'bundle' | 'portable'

function mode(): Mode {
  if (process.platform === 'darwin') return 'bundle'
  const installed = existsSync(join(dirname(app.getPath('exe')), `Uninstall ${app.getName()}.exe`))
  return installed ? 'installer' : 'portable'
}

let state: UpdateState = { status: 'idle', currentVersion: app.getVersion() }
let lastCheck = 0
let checking: Promise<void> | null = null
let installing = false

/** For `bundle` and `portable`: the downloaded release, waiting for the app to quit. */
let pending: { version: string; file: string } | null = null

/** One prompt per version: asking again every hour about the same release is nagging. */
const prompted = new Set<string>()

function setState(next: Omit<UpdateState, 'currentVersion'>): void {
  state = { ...next, currentVersion: app.getVersion() }
  broadcast(EVENTS.update, state)
}

export function updateState(): UpdateState {
  return state
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

// --- Windows installer: electron-updater does the work ------------------------------------

function wireInstaller(): void {
  autoUpdater.autoDownload = true
  // Declining "Restart Now" still gets the update — it goes in when the app next quits.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('download-progress', (progress) =>
    setState({ status: 'downloading', version: state.version, percent: progress.percent })
  )
  autoUpdater.on('update-downloaded', (info) => void onReady(info.version))
  autoUpdater.on('error', (error) => setState({ status: 'error', message: error.message }))
}

async function checkWithInstaller(): Promise<void> {
  const result = await autoUpdater.checkForUpdates()
  const version = result?.updateInfo.version
  if (!version || !isNewer(version, app.getVersion())) {
    setState({ status: 'up-to-date' })
    return
  }
  // The download is already under way (autoDownload); 'update-downloaded' takes it from here.
  if (state.status !== 'ready') setState({ status: 'downloading', version, percent: 0 })
}

// --- macOS and the Windows zip: download the release asset ourselves ----------------------

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

function assetFor(version: string, assets: ReleaseAsset[]): ReleaseAsset | undefined {
  if (process.platform === 'win32') {
    return assets.find((asset) => asset.name === `airbridge-${version}-win.zip`)
  }
  // electron-builder suffixes the arm64 dmg and leaves the x64 one bare.
  const name =
    process.arch === 'arm64' ? `airbridge-${version}-arm64.dmg` : `airbridge-${version}.dmg`
  return assets.find((asset) => asset.name === name)
}

/** The sha512 electron-builder recorded for a file, from latest(-mac).yml, if it lists it. */
async function expectedHash(assets: ReleaseAsset[], fileName: string): Promise<string | null> {
  const manifest = assets.find(
    (asset) => asset.name === (process.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml')
  )
  if (!manifest) return null

  const text = await (await net.fetch(manifest.browser_download_url)).text()
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`url: ${escaped}\\s+sha512: (\\S+)`).exec(text)?.[1] ?? null
}

async function download(url: string, file: string): Promise<Buffer> {
  const response = await net.fetch(url)
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status})`)

  const total = Number(response.headers.get('content-length')) || 0
  const chunks: Uint8Array[] = []
  let received = 0

  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    if (total > 0) {
      setState({ status: 'downloading', version: state.version, percent: (received / total) * 100 })
    }
  }

  const bytes = Buffer.concat(chunks)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes)
  return bytes
}

async function checkWithAsset(): Promise<void> {
  const response = await net.fetch(`https://api.github.com/repos/${REPOSITORY}/releases/latest`, {
    headers: { accept: 'application/vnd.github+json' }
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)

  const release = (await response.json()) as { tag_name?: string; assets?: ReleaseAsset[] }
  const version = release.tag_name?.replace(/^v/, '')

  if (!version || !isNewer(version, app.getVersion())) {
    setState({ status: 'up-to-date' })
    return
  }
  if (pending?.version === version) return

  const assets = release.assets ?? []
  const asset = assetFor(version, assets)
  if (!asset) throw new Error(`Version ${version} has no download for this computer`)

  setState({ status: 'downloading', version, percent: 0 })

  const file = join(app.getPath('temp'), 'airbridge-update', asset.name)
  const bytes = await download(asset.browser_download_url, file)

  // A truncated or tampered download would replace a working app with a broken one, so a
  // mismatch stops here. The zip is not in latest.yml, so it rests on HTTPS alone.
  const expected = await expectedHash(assets, asset.name)
  if (expected && createHash('sha512').update(bytes).digest('base64') !== expected) {
    await rm(file, { force: true })
    throw new Error('The downloaded update did not match its checksum')
  }

  pending = { version, file }
  await onReady(version)
}

/**
 * Hand the swap to a script that outlives us. It waits for this process to exit — a running
 * app cannot overwrite itself, least of all on Windows — then replaces it and relaunches.
 */
async function spawnReplacement(update: { file: string }): Promise<void> {
  const directory = join(app.getPath('temp'), 'airbridge-update')

  if (process.platform === 'darwin') {
    // .../airbridge.app/Contents/MacOS/airbridge → .../airbridge.app
    const bundle = resolve(app.getPath('exe'), '..', '..', '..')
    const script = join(directory, 'install.sh')
    await writeFile(
      script,
      `#!/bin/bash
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.5; done
MOUNT="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$1" >/dev/null || { open "$2"; exit 1; }
rm -rf "$2.old"
# Keep the old copy until the new one is fully in place, so a failed copy can be undone.
if mv "$2" "$2.old" && ditto "$MOUNT/airbridge.app" "$2"; then
  rm -rf "$2.old"
else
  rm -rf "$2"; mv "$2.old" "$2"
fi
hdiutil detach -quiet "$MOUNT"
xattr -dr com.apple.quarantine "$2" 2>/dev/null
open "$2"
`,
      { mode: 0o755 }
    )
    spawn('/bin/bash', [script, update.file, bundle], { detached: true, stdio: 'ignore' }).unref()
    return
  }

  const folder = dirname(app.getPath('exe'))
  const script = join(directory, 'install.ps1')
  await writeFile(
    script,
    `param($Zip, $Folder, $Exe)
while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }
Expand-Archive -Path $Zip -DestinationPath $Folder -Force
Start-Process -FilePath $Exe
`
  )
  spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      script,
      update.file,
      folder,
      app.getPath('exe')
    ],
    { detached: true, stdio: 'ignore', windowsHide: true }
  ).unref()
}

// --- Shared ------------------------------------------------------------------------------

/** Nobody is looking and nothing is moving, so restarting costs nobody anything. */
function isIdle(): boolean {
  const busy = listJobs().some((job) => job.status === 'scanning' || job.status === 'transferring')
  const visible = BrowserWindow.getAllWindows().some((window) => window.isVisible())
  return !busy && !visible
}

async function onReady(version: string): Promise<void> {
  setState({ status: 'ready', version })

  if (isIdle()) {
    await installNow()
    return
  }

  if (prompted.has(version)) return
  prompted.add(version)

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Update ready',
    message: `airbridge ${version} is ready to install.`,
    detail: 'Restart now to use it, or it will be installed the next time airbridge quits.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1
  })

  if (response === 0) await installNow()
}

/** Quit and come back on the new version. */
export async function installNow(): Promise<void> {
  if (state.status !== 'ready' || installing) return
  installing = true
  markQuitting()

  if (mode() === 'installer') {
    // Silent, and relaunch afterwards: the person already chose the install directory once.
    autoUpdater.quitAndInstall(true, true)
    return
  }

  if (pending) await spawnReplacement(pending)
  app.quit()
}

/** Called on quit: a downloaded update the person put off goes in now. */
export function installOnQuit(): void {
  if (installing || !pending || mode() === 'installer') return
  installing = true
  void spawnReplacement(pending)
}

/**
 * Look for a newer release, and download it if there is one. Concurrent calls share one
 * check. `manual` is a person who asked, and so is shown an answer even when there is none.
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (!app.isPackaged) {
    setState({ status: 'up-to-date' })
    return
  }
  if (installing || state.status === 'ready') return

  checking ??= (async () => {
    lastCheck = Date.now()
    if (state.status !== 'downloading') setState({ status: 'checking' })
    try {
      if (mode() === 'installer') await checkWithInstaller()
      else await checkWithAsset()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      console.warn('[updater] check failed:', message)
      setState({ status: 'error', message })
    }
  })().finally(() => {
    checking = null
  })

  await checking

  // From the tray there may be no window to show the answer in, so it gets a dialog.
  if (manual && state.status === 'up-to-date') {
    await dialog.showMessageBox({
      type: 'info',
      title: 'No updates',
      message: `airbridge ${app.getVersion()} is the latest version.`
    })
  }
  if (manual && state.status === 'error') {
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: state.message
    })
  }
}

/** The window opening is a good moment to look, as long as we have not just looked. */
export function checkOnWindowShown(): void {
  if (Date.now() - lastCheck > WINDOW_CHECK_MIN_GAP_MS) void checkForUpdates()
}

export async function startUpdater(): Promise<void> {
  // A dev build has no published version to compare against.
  if (!app.isPackaged) return

  if (mode() === 'installer') wireInstaller()

  // Leftovers from the last swap: the downloaded file and the script that applied it.
  await rm(join(app.getPath('temp'), 'airbridge-update'), { recursive: true, force: true })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}
