import { app } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, parse } from 'node:path'

import type { DirEntry, LocalListing, LocalPlace } from '@shared/types'

/**
 * The right-hand pane browses the real filesystem, so unlike the share server this has no
 * root to stay inside — the user is looking at their own disk. Entries that cannot be read
 * are omitted rather than failing the listing, because a folder of a thousand files should
 * not disappear over one unreadable entry.
 */
export async function listLocal(path: string): Promise<LocalListing> {
  const dirents = await readdir(path, { withFileTypes: true })

  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirEntry | null> => {
      try {
        const stats = await stat(join(path, dirent.name))
        return {
          name: dirent.name,
          kind: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          mtime: stats.mtimeMs
        }
      } catch {
        return null
      }
    })
  )

  const parent = dirname(path)

  return {
    path,
    // `dirname` of a filesystem root returns the root itself, which is how we spot the top.
    parent: parent === path ? null : parent,
    entries: entries
      .filter((entry): entry is DirEntry => entry !== null)
      .sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      })
  }
}

/** The shortcuts Finder keeps in its sidebar, plus whatever the OS calls them. */
export function localPlaces(): LocalPlace[] {
  const places: LocalPlace[] = [
    { name: 'Home', path: app.getPath('home'), icon: 'home' },
    { name: 'Desktop', path: app.getPath('desktop'), icon: 'desktop' },
    { name: 'Documents', path: app.getPath('documents'), icon: 'documents' },
    { name: 'Downloads', path: app.getPath('downloads'), icon: 'downloads' }
  ]

  // On Windows the drive the user lives on is a genuinely useful destination; on macOS the
  // equivalent is `/`, which almost never is.
  if (process.platform === 'win32') {
    const { root } = parse(app.getPath('home'))
    places.push({ name: root.replace(/\\$/, ''), path: root, icon: 'drive' })
  }

  return places
}
