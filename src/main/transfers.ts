import { app, dialog } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, mkdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

import { EVENTS } from '@shared/ipc'
import type { PeerAddress, TransferItem, TransferJob } from '@shared/types'
import { broadcast } from './events'
import { downloadFile, listPeerDirectory } from './peer'

/** Four at a time. Enough to keep a gigabit link busy on small files without turning a
 *  folder of thousands into a thousand simultaneous TLS handshakes. */
const CONCURRENCY = 4

/** Progress arrives per chunk, which is far faster than anything a person can read. */
const BROADCAST_INTERVAL_MS = 250

type CollisionChoice = 'keep-both' | 'replace' | 'skip' | 'cancel'

interface PlannedFile {
  remotePath: string
  destinationDirectory: string
  fileName: string
  size: number
}

interface RunningJob {
  job: TransferJob
  controller: AbortController
}

const jobs = new Map<string, RunningJob>()
let broadcastTimer: NodeJS.Timeout | null = null

export function listJobs(): TransferJob[] {
  return [...jobs.values()].map((entry) => entry.job).sort((a, b) => b.startedAt - a.startedAt)
}

/** Coalesce progress into one message every quarter second. Per-chunk broadcasts would spend
 *  more time crossing the IPC boundary than moving bytes. */
function scheduleBroadcast(immediate = false): void {
  if (immediate) {
    if (broadcastTimer) {
      clearTimeout(broadcastTimer)
      broadcastTimer = null
    }
    broadcast(EVENTS.transfers, listJobs())
    return
  }

  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    broadcast(EVENTS.transfers, listJobs())
  }, BROADCAST_INTERVAL_MS)
}

export function cancelJob(id: string): void {
  jobs.get(id)?.controller.abort()
}

/** Drop finished rows from the list. Anything still running is left alone. */
export function clearFinishedJobs(): void {
  for (const [id, entry] of jobs) {
    if (entry.job.status !== 'scanning' && entry.job.status !== 'transferring') jobs.delete(id)
  }
  scheduleBroadcast(true)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Finder's naming: `report.pdf` becomes `report 2.pdf`, then `report 3.pdf`. */
async function keepBothName(
  directory: string,
  fileName: string,
  claimed: ReadonlySet<string>
): Promise<string> {
  const extension = extname(fileName)
  const stem = fileName.slice(0, fileName.length - extension.length)

  for (let counter = 2; ; counter++) {
    const candidate = `${stem} ${counter}${extension}`
    const path = join(directory, candidate)
    if (!claimed.has(path) && !(await exists(path))) return candidate
  }
}

const COLLISION_CHOICES: CollisionChoice[] = ['keep-both', 'replace', 'skip', 'cancel']

async function askCollision(
  fileName: string,
  remaining: number
): Promise<{ choice: CollisionChoice; applyToAll: boolean }> {
  // The loopback tests exercise real collisions, and nobody is there to answer the prompt.
  // Gated on the build being unpackaged so it cannot be forced on a shipped app.
  const scripted = process.env['AIRBRIDGE_COLLISION_POLICY'] as CollisionChoice | undefined
  if (!app.isPackaged && scripted && COLLISION_CHOICES.includes(scripted)) {
    return { choice: scripted, applyToAll: true }
  }

  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Keep Both', 'Replace', 'Skip', 'Cancel'],
    defaultId: 0,
    cancelId: 3,
    title: 'airbridge',
    message: `An item named “${fileName}” already exists in this location.`,
    detail: 'Do you want to replace it with the one you are copying?',
    // Finder offers this only when there is more than one decision left to make.
    ...(remaining > 1
      ? { checkboxLabel: `Apply to all ${remaining} conflicts`, checkboxChecked: false }
      : {}),
    noLink: true
  })

  return { choice: COLLISION_CHOICES[response] ?? 'cancel', applyToAll: checkboxChecked }
}

/**
 * Walk the remote tree, mirroring its shape into the destination.
 *
 * Done up front so the job knows its own size: a progress bar that discovers more work as it
 * goes is worse than no progress bar, and the collision prompts all happen before any bytes
 * move rather than interrupting a copy that is already half done.
 */
async function plan(
  peer: PeerAddress,
  shareId: string,
  items: TransferItem[],
  destination: string,
  signal: AbortSignal
): Promise<PlannedFile[]> {
  const planned: PlannedFile[] = []

  const walk = async (remotePath: string, localDirectory: string): Promise<void> => {
    signal.throwIfAborted()

    for (const entry of await listPeerDirectory(peer, shareId, remotePath)) {
      const childRemote = remotePath ? `${remotePath}/${entry.name}` : entry.name

      if (entry.kind === 'directory') {
        await walk(childRemote, join(localDirectory, entry.name))
      } else {
        planned.push({
          remotePath: childRemote,
          destinationDirectory: localDirectory,
          fileName: entry.name,
          size: entry.size
        })
      }
    }
  }

  for (const item of items) {
    if (item.kind === 'directory') {
      await walk(item.path, join(destination, item.name))
    } else {
      planned.push({
        remotePath: item.path,
        destinationDirectory: destination,
        fileName: item.name,
        size: item.size ?? 0
      })
    }
  }

  return planned
}

/** Resolve every name clash before the first byte moves. Returns null if the user cancelled. */
async function resolveCollisions(planned: PlannedFile[]): Promise<PlannedFile[] | null> {
  const clashes = await Promise.all(
    planned.map((file) => exists(join(file.destinationDirectory, file.fileName)))
  )

  const total = clashes.filter(Boolean).length
  if (total === 0) return planned

  const resolved: PlannedFile[] = []
  // Names chosen by Keep Both are not on disk yet, so two files renamed in the same folder
  // would otherwise both be offered the same free name.
  const claimed = new Set<string>()
  let blanket: CollisionChoice | null = null
  let remaining = total

  for (const [index, file] of planned.entries()) {
    if (!clashes[index]) {
      resolved.push(file)
      continue
    }

    const answer: { choice: CollisionChoice; applyToAll: boolean } = blanket
      ? { choice: blanket, applyToAll: true }
      : await askCollision(file.fileName, remaining)

    if (answer.applyToAll) blanket = answer.choice
    remaining--

    if (answer.choice === 'cancel') return null
    if (answer.choice === 'skip') continue

    if (answer.choice === 'replace') {
      resolved.push(file)
      continue
    }

    const fileName = await keepBothName(file.destinationDirectory, file.fileName, claimed)
    claimed.add(join(file.destinationDirectory, fileName))
    resolved.push({ ...file, fileName })
  }

  return resolved
}

async function runPool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await work(items[index])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

async function execute(entry: RunningJob, peer: PeerAddress, shareId: string, items: TransferItem[]): Promise<void> {
  const { job, controller } = entry

  try {
    const planned = await plan(peer, shareId, items, job.destination, controller.signal)

    const resolved = await resolveCollisions(planned)
    if (!resolved) {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      scheduleBroadcast(true)
      return
    }

    job.skippedFiles = planned.length - resolved.length
    job.totalFiles = resolved.length
    job.totalBytes = resolved.reduce((total, file) => total + file.size, 0)
    job.status = 'transferring'
    scheduleBroadcast(true)

    // Directories are created up front so an empty folder still appears in the destination.
    for (const directory of new Set(resolved.map((file) => file.destinationDirectory))) {
      await mkdir(directory, { recursive: true })
    }

    await runPool(resolved, CONCURRENCY, async (file) => {
      controller.signal.throwIfAborted()
      job.currentFile = file.fileName

      await downloadFile(peer, shareId, file.remotePath, file.destinationDirectory, {
        fileName: file.fileName,
        resume: true,
        signal: controller.signal,
        onProgress: (bytes) => {
          job.transferredBytes += bytes
          scheduleBroadcast()
        }
      })

      job.completedFiles++
      scheduleBroadcast()
    })

    job.status = 'done'
    job.currentFile = null
  } catch (cause) {
    if (controller.signal.aborted) {
      job.status = 'cancelled'
    } else {
      job.status = 'failed'
      job.error = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    job.finishedAt = Date.now()
    scheduleBroadcast(true)
  }
}

/**
 * Queue a copy and return immediately with the job.
 *
 * Nothing here waits: the caller gets a row it can watch, and the work runs on in the
 * background so closing the window mid-copy does not abandon it.
 */
export function startCopy(details: {
  peer: PeerAddress
  deviceId: string
  deviceName: string
  shareId: string
  shareName: string
  items: TransferItem[]
  destination: string
}): TransferJob {
  const job: TransferJob = {
    id: randomUUID(),
    deviceId: details.deviceId,
    deviceName: details.deviceName,
    shareName: details.shareName,
    destination: details.destination,
    status: 'scanning',
    totalBytes: 0,
    transferredBytes: 0,
    totalFiles: 0,
    completedFiles: 0,
    skippedFiles: 0,
    currentFile: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null
  }

  const entry: RunningJob = { job, controller: new AbortController() }
  jobs.set(job.id, entry)
  scheduleBroadcast(true)

  void execute(entry, details.peer, details.shareId, details.items)

  return job
}
