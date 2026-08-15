import { app } from 'electron'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A tiny persisted JSON value in the app's userData directory.
 *
 * PLAN.md names electron-store for this, but its current major is ESM-only and the main
 * bundle is CommonJS, so it would have to be un-externalised and bundled. The two things
 * electron-store buys us here — atomic writes and a corruption fallback — are the twenty
 * lines below, so we keep the CommonJS boundary clean instead.
 */
export interface Store<T> {
  read(): T
  write(next: T): void
  update(change: (current: T) => T): T
}

export function createStore<T>(filename: string, fallback: () => T): Store<T> {
  let cache: T | null = null

  const file = (): string => join(app.getPath('userData'), filename)

  const read = (): T => {
    if (cache !== null) return cache
    try {
      cache = JSON.parse(readFileSync(file(), 'utf8')) as T
    } catch {
      // Absent or corrupted. Either way, starting from the fallback beats refusing to boot.
      cache = fallback()
    }
    return cache
  }

  const write = (next: T): void => {
    cache = next
    // Write beside the target and rename over it, so a crash mid-write cannot leave a
    // half-serialised file that parses as valid JSON with missing keys.
    const temporary = `${file()}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temporary, file())
  }

  return {
    read,
    write,
    update: (change) => {
      const next = change(read())
      write(next)
      return next
    }
  }
}
