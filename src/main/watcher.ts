import { watch, type FSWatcher } from 'chokidar'

import { listShares } from './shares'

/**
 * Watches every published folder so peers see changes without refreshing.
 *
 * Availability is on a poll rather than a watch, deliberately: an unplugged drive or a
 * renamed folder does not produce a reliable event on either platform, and the check is one
 * `stat` per share every few seconds.
 */
const AVAILABILITY_INTERVAL_MS = 4000

/** File events arrive in bursts — a copy into the folder can fire hundreds. */
const DEBOUNCE_MS = 300

type ChangeListener = (shareId: string) => void
type AvailabilityListener = () => void

const watchers = new Map<string, FSWatcher>()
const debounces = new Map<string, NodeJS.Timeout>()
const changeListeners = new Set<ChangeListener>()
const availabilityListeners = new Set<AvailabilityListener>()

let availabilityTimer: NodeJS.Timeout | null = null
let lastAvailability = new Map<string, boolean>()

export function onShareContentChanged(listener: ChangeListener): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function onShareAvailabilityChanged(listener: AvailabilityListener): () => void {
  availabilityListeners.add(listener)
  return () => availabilityListeners.delete(listener)
}

function announce(shareId: string): void {
  const existing = debounces.get(shareId)
  if (existing) clearTimeout(existing)

  debounces.set(
    shareId,
    setTimeout(() => {
      debounces.delete(shareId)
      for (const listener of changeListeners) listener(shareId)
    }, DEBOUNCE_MS)
  )
}

/** Bring the set of watchers in line with the set of available shares. */
export function refreshWatchers(): void {
  const shares = listShares()
  const wanted = new Map(shares.filter((share) => share.available).map((s) => [s.id, s.path]))

  for (const [shareId, watcher] of watchers) {
    if (!wanted.has(shareId)) {
      void watcher.close()
      watchers.delete(shareId)
    }
  }

  for (const [shareId, path] of wanted) {
    if (watchers.has(shareId)) continue

    const watcher = watch(path, {
      // The initial scan of a large tree is expensive and tells us nothing new.
      ignoreInitial: true,
      // Depth is unbounded, but nothing is read here — only the fact that something moved.
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    })

    watcher.on('all', () => announce(shareId))
    // A watcher that fails should cost us live updates on that share, not crash the app.
    watcher.on('error', () => {})

    watchers.set(shareId, watcher)
  }
}

export function startWatching(): void {
  refreshWatchers()
  lastAvailability = new Map(listShares().map((share) => [share.id, share.available]))

  availabilityTimer ??= setInterval(() => {
    const current = new Map(listShares().map((share) => [share.id, share.available]))

    const changed =
      current.size !== lastAvailability.size ||
      [...current].some(([id, available]) => lastAvailability.get(id) !== available)

    if (!changed) return

    lastAvailability = current
    refreshWatchers()
    for (const listener of availabilityListeners) listener()
  }, AVAILABILITY_INTERVAL_MS)
}

export async function stopWatching(): Promise<void> {
  if (availabilityTimer) {
    clearInterval(availabilityTimer)
    availabilityTimer = null
  }

  for (const timeout of debounces.values()) clearTimeout(timeout)
  debounces.clear()

  await Promise.all([...watchers.values()].map((watcher) => watcher.close()))
  watchers.clear()
}
