import { randomBytes } from 'node:crypto'

import type { TrustedDevice } from '@shared/types'
import { createStore } from './store'

const store = createStore<TrustedDevice[]>('trust.json', () => [])

/** 192 bits of entropy, URL-safe so it survives being pasted into a header or a form. */
export function mintToken(): string {
  return randomBytes(24).toString('base64url')
}

export function listTrusted(): TrustedDevice[] {
  return store.read()
}

export function getTrusted(deviceId: string): TrustedDevice | undefined {
  return store.read().find((device) => device.deviceId === deviceId)
}

/**
 * The inbound half of authentication: which device, if any, does this bearer token belong to?
 *
 * A match is necessary but not sufficient — the caller must also check that the connection
 * presented the certificate recorded at pairing.
 */
export function findByInboundToken(token: string): TrustedDevice | undefined {
  return store.read().find((device) => device.inboundToken === token)
}

export function upsertTrusted(device: TrustedDevice): TrustedDevice {
  store.update((devices) => [
    ...devices.filter((existing) => existing.deviceId !== device.deviceId),
    device
  ])
  return device
}

export function revokeTrusted(deviceId: string): void {
  store.update((devices) => devices.filter((device) => device.deviceId !== deviceId))
}

/** Remember where a device answered, so it stays reachable when mDNS is having a bad day. */
export function rememberAddress(deviceId: string, host: string, port: number): void {
  store.update((devices) =>
    devices.map((device) =>
      device.deviceId === deviceId ? { ...device, lastHost: host, lastPort: port } : device
    )
  )
}
