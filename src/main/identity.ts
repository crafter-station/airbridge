import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AppInfo, Platform } from '@shared/types'

interface StoredIdentity {
  deviceId: string
  deviceName: string
}

let cached: StoredIdentity | null = null

function identityFile(): string {
  return join(app.getPath('userData'), 'identity.json')
}

/** The device UUID must survive restarts, upgrades and IP changes — it is the anchor every
 *  pairing is keyed on, so losing it means every paired machine has to re-approve us. */
function load(): StoredIdentity {
  if (cached) return cached

  const file = identityFile()
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<StoredIdentity>
    if (typeof parsed.deviceId === 'string' && typeof parsed.deviceName === 'string') {
      cached = { deviceId: parsed.deviceId, deviceName: parsed.deviceName }
      return cached
    }
  } catch {
    // No identity yet, or it was corrupted. Either way we mint a fresh one below.
  }

  cached = { deviceId: randomUUID(), deviceName: hostname() }
  writeFileSync(file, JSON.stringify(cached, null, 2), 'utf8')
  return cached
}

export function getAppInfo(): AppInfo {
  const { deviceId, deviceName } = load()
  return {
    deviceId,
    deviceName,
    platform: process.platform as Platform,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron
  }
}

export function setDeviceName(name: string): void {
  const current = load()
  cached = { ...current, deviceName: name }
  writeFileSync(identityFile(), JSON.stringify(cached, null, 2), 'utf8')
}
