import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

import type { AppInfo, Platform } from '@shared/types'
import { createStore } from './store'

interface StoredIdentity {
  deviceId: string
  deviceName: string
}

/** The device UUID must survive restarts, upgrades and IP changes — it is the anchor every
 *  pairing is keyed on, so losing it means every paired machine has to re-approve us. */
const store = createStore<StoredIdentity>('identity.json', () => ({
  deviceId: randomUUID(),
  deviceName: hostname()
}))

let ensured = false

function identity(): StoredIdentity {
  const current = store.read()
  // The fallback mints a UUID in memory; persist it the first time we are asked for it.
  if (!ensured) {
    store.write(current)
    ensured = true
  }
  return current
}

export function getDeviceId(): string {
  return identity().deviceId
}

export function getDeviceName(): string {
  return identity().deviceName
}

export function setDeviceName(deviceName: string): void {
  store.update((current) => ({ ...current, deviceName }))
}

export function getAppInfo(): AppInfo {
  const { deviceId, deviceName } = identity()
  return {
    deviceId,
    deviceName,
    platform: process.platform as Platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron
  }
}
