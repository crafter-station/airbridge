import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { basename } from 'node:path'

import type { PublicShare, Share } from '@shared/types'
import { createStore } from './store'

interface StoredShare {
  id: string
  name: string
  path: string
  writable: boolean
}

const store = createStore<StoredShare[]>('shares.json', () => [])

function isAvailable(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Availability is computed on read, never stored: a share whose drive is unplugged is
 *  temporarily unreachable, not deleted. Removing it is always an explicit act. */
function decorate(share: StoredShare): Share {
  return { ...share, available: isAvailable(share.path) }
}

export function listShares(): Share[] {
  return store.read().map(decorate)
}

/** The view a peer gets: no absolute paths, which would leak the account name and layout. */
export function listPublicShares(): PublicShare[] {
  return listShares().map(({ path: _path, ...rest }) => rest)
}

export function getShare(id: string): Share | undefined {
  const found = store.read().find((share) => share.id === id)
  return found && decorate(found)
}

export function addShare(path: string): Share {
  const existing = store.read().find((share) => share.path === path)
  if (existing) return decorate(existing)

  const share: StoredShare = {
    id: randomUUID(),
    name: basename(path) || path,
    path,
    writable: false
  }

  store.update((shares) => [...shares, share])
  return decorate(share)
}

export function removeShare(id: string): void {
  store.update((shares) => shares.filter((share) => share.id !== id))
}

export function setShareWritable(id: string, writable: boolean): Share | undefined {
  store.update((shares) =>
    shares.map((share) => (share.id === id ? { ...share, writable } : share))
  )
  return getShare(id)
}

export function renameShare(id: string, name: string): Share | undefined {
  store.update((shares) => shares.map((share) => (share.id === id ? { ...share, name } : share)))
  return getShare(id)
}
