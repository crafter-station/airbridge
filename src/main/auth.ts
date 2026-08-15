import { randomBytes } from 'node:crypto'

import { createStore } from './store'

interface StoredAuth {
  token: string
}

/**
 * The single bearer token this instance accepts.
 *
 * M1 only: trust is hard-coded, so anyone holding this string can read every share. M2
 * replaces it with per-device tokens minted when a pairing request is approved, at which
 * point revoking one machine stops meaning "revoke all of them".
 */
const store = createStore<StoredAuth>('auth.json', () => ({
  token: randomBytes(16).toString('hex')
}))

let ensured = false

export function getAccessToken(): string {
  const current = store.read()
  if (!ensured) {
    store.write(current)
    ensured = true
  }
  return current.token
}
