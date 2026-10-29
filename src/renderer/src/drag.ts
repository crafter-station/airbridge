import type { TransferItem } from '@shared/types'

/**
 * What a drag between airbridge's own panes carries.
 *
 * Every drag stays inside this window — Electron cannot hand Finder a file that is still on
 * the other machine — so the rules for what a drop does are all here, in one place:
 *
 * - remote → this computer: copy (a download)
 * - this computer → a writable share: copy (an upload)
 * - within one side, onto a folder: move
 */

/** Items still on the other machine. A copy instruction, not a payload. */
export interface RemoteDrag {
  kind: 'remote'
  deviceId: string
  shareId: string
  shareName: string
  items: TransferItem[]
}

/** Paths on this computer. */
export interface LocalDrag {
  kind: 'local'
  paths: string[]
}

export type Drag = RemoteDrag | LocalDrag

const MIME = 'application/x-airbridge-drag'

/**
 * The drag in flight. A drop target has to decide during `dragover` whether to light up, and
 * browsers withhold the payload until the drop itself — so it is kept here as well.
 */
let current: Drag | null = null

export function beginDrag(drag: Drag, event: React.DragEvent): void {
  current = drag
  event.dataTransfer.setData(MIME, JSON.stringify(drag))
  event.dataTransfer.effectAllowed = 'copyMove'
  // Cleared on the source element's dragend, which fires whether or not anything took it.
  event.currentTarget.addEventListener('dragend', () => (current = null), { once: true })
}

export function activeDrag(): Drag | null {
  return current
}

/** The drag being dropped, read from the event so a stale `current` can never be used. */
export function droppedDrag(event: React.DragEvent): Drag | null {
  const raw = event.dataTransfer.getData(MIME)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Drag
  } catch {
    return null
  }
}

/** Whether `path` is one of the dragged items or inside one — dropping there is a no-op at
 *  best and a folder-into-itself error at worst, so such a target should not light up. */
export function isWithinDragged(path: string, dragged: string[]): boolean {
  const normal = (value: string): string => value.replace(/\\/g, '/')
  const target = normal(path)
  return dragged.some((item) => {
    const source = normal(item)
    return target === source || target.startsWith(`${source}/`)
  })
}
