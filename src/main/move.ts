import { cp, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Move one file or folder into a directory, keeping its name.
 *
 * Shared by the local pane and the share server, so both refuse the same things: moving a
 * folder into itself, and silently replacing something already there. Overwriting on a move
 * destroys the one copy of whatever was in the way, so a clash is an error the person sees.
 */
export async function moveInto(source: string, destinationDirectory: string): Promise<string> {
  const from = resolve(source)
  const into = resolve(destinationDirectory)
  const target = join(into, basename(from))

  if (target === from) return target

  const inside = relative(from, into)
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new Error(`Cannot move “${basename(from)}” into itself`)
  }

  if (await stat(target).catch(() => null)) {
    throw new Error(`“${basename(from)}” already exists in that folder`)
  }

  try {
    await rename(from, target)
  } catch (cause) {
    // A different volume — another drive, a USB stick — cannot be renamed across. Copy, then
    // remove the original only once the copy is complete.
    if ((cause as NodeJS.ErrnoException).code !== 'EXDEV') throw cause
    await cp(from, target, { recursive: true, errorOnExist: true, force: false })
    await rm(from, { recursive: true })
  }

  return target
}

/** Move several, stopping at the first failure so the error names the item that caused it. */
export async function moveAllInto(sources: string[], destinationDirectory: string): Promise<void> {
  for (const source of sources) await moveInto(source, destinationDirectory)
}
