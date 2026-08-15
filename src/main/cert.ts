import { X509Certificate } from 'node:crypto'
import { generate } from 'selfsigned'

import { createStore } from './store'

interface StoredCertificate {
  key: string
  cert: string
}

export interface Certificate extends StoredCertificate {
  /** Colon-separated uppercase SHA-256, e.g. `A1:B2:...`. This is the value pinned at
   *  pairing time and re-checked on every later connection. */
  fingerprint: string
}

const store = createStore<StoredCertificate | null>('tls.json', () => null)

let cached: Certificate | null = null

/** Ten years. The certificate is never validated against a clock — identity comes from the
 *  pinned fingerprint — but an expiry far in the future keeps tooling from complaining. */
const LIFETIME_MS = 10 * 365 * 24 * 60 * 60 * 1000

/**
 * The machine's TLS identity, generated once and kept forever.
 *
 * Regenerating it would look exactly like an impersonation attempt to every already-paired
 * device, so this is deliberately write-once: the fingerprint is half of what pairing trusts.
 */
export async function getCertificate(): Promise<Certificate> {
  if (cached) return cached

  let stored = store.read()

  if (!stored) {
    const notBeforeDate = new Date()
    const generated = await generate([{ name: 'commonName', value: 'airbridge' }], {
      // P-256 generates in milliseconds where RSA-2048 takes a noticeable pause on first run.
      keyType: 'ec',
      curve: 'P-256',
      algorithm: 'sha256',
      notBeforeDate,
      notAfterDate: new Date(notBeforeDate.getTime() + LIFETIME_MS)
    })
    stored = { key: generated.private, cert: generated.cert }
    store.write(stored)
  }

  cached = { ...stored, fingerprint: new X509Certificate(stored.cert).fingerprint256 }
  return cached
}
