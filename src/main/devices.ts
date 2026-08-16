import { EVENTS } from '@shared/ipc'
import type { KnownDevice, PeerAddress, TrustedDevice } from '@shared/types'
import { discoveredPeers, refreshPairedFlags } from './discovery'
import { broadcast } from './events'
import { requestPairing } from './peer'
import { listTrusted, mintToken, revokeTrusted, upsertTrusted } from './trust'

/**
 * One list combining what is on the network with what has been approved.
 *
 * They are genuinely different facts and both matter to the user: a trusted device that is
 * offline should still be visible (so they know it exists), and an untrusted device that is
 * online should still be visible (so they can pair with it).
 */
export function knownDevices(): KnownDevice[] {
  const online = new Map(discoveredPeers().map((peer) => [peer.deviceId, peer]))
  const devices = new Map<string, KnownDevice>()

  for (const trusted of listTrusted()) {
    const live = online.get(trusted.deviceId)
    devices.set(trusted.deviceId, {
      deviceId: trusted.deviceId,
      deviceName: live?.deviceName ?? trusted.deviceName,
      paired: true,
      online: live !== undefined,
      host: live?.host ?? trusted.lastHost,
      port: live?.port ?? trusted.lastPort
    })
  }

  for (const peer of online.values()) {
    if (devices.has(peer.deviceId)) continue
    devices.set(peer.deviceId, {
      deviceId: peer.deviceId,
      deviceName: peer.deviceName,
      paired: false,
      online: true,
      host: peer.host,
      port: peer.port
    })
  }

  return [...devices.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return a.deviceName.localeCompare(b.deviceName)
  })
}

export function notifyDevicesChanged(): void {
  broadcast(EVENTS.devices, knownDevices())
}

/**
 * Turn a device id into something we can actually call.
 *
 * mDNS wins over the remembered address because it is current; the remembered address is the
 * fallback for when discovery is blocked, which is the failure mode Connect-by-IP exists for.
 */
export function resolvePeer(deviceId: string): PeerAddress {
  const trusted = listTrusted().find((device) => device.deviceId === deviceId)
  if (!trusted) throw new Error('That device is not paired')

  const live = discoveredPeers().find((peer) => peer.deviceId === deviceId)
  const host = live?.host ?? trusted.lastHost
  const port = live?.port ?? trusted.lastPort

  if (!host || !port) throw new Error(`${trusted.deviceName} is not reachable right now`)

  return { host, port, token: trusted.outboundToken, fingerprint: trusted.fingerprint }
}

/**
 * Pair with a device at a known address — either one mDNS found, or one typed in by hand.
 *
 * This blocks for as long as it takes a person on the other machine to answer the prompt,
 * which is why the caller surfaces it as a pending state rather than a spinner with a
 * timeout.
 */
export async function pairWith(host: string, port: number): Promise<TrustedDevice> {
  const grantToken = mintToken()
  const response = await requestPairing({ host, port }, grantToken)

  const device: TrustedDevice = {
    deviceId: response.deviceId,
    deviceName: response.deviceName,
    fingerprint: response.fingerprint,
    // Mirrored: what we granted them is our inbound token, what they granted us is outbound.
    inboundToken: grantToken,
    outboundToken: response.token,
    lastHost: host,
    lastPort: port,
    pairedAt: Date.now()
  }

  upsertTrusted(device)
  refreshPairedFlags()
  notifyDevicesChanged()

  return device
}

export function unpair(deviceId: string): void {
  revokeTrusted(deviceId)
  refreshPairedFlags()
  notifyDevicesChanged()
}
