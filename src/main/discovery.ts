import Bonjour from 'bonjour-service'
import type { Service } from 'bonjour-service'
import { isIPv4 } from 'node:net'

import { PROTOCOL_VERSION, SERVICE_TYPE, TXT } from '@shared/protocol'
import type { DiscoveredPeer } from '@shared/types'
import { getCertificate } from './cert'
import { getDeviceId, getDeviceName } from './identity'
import { localAddresses } from './network'
import { getTrusted } from './trust'

/** multicast-dns takes an `interface` option that bonjour-service does not declare. */
type BonjourOptions = ConstructorParameters<typeof Bonjour>[0] & { interface?: string }

interface Advertiser {
  bonjour: Bonjour
  service: Service | null
}

const advertisers: Advertiser[] = []
const peers = new Map<string, DiscoveredPeer>()
const listeners = new Set<(peers: DiscoveredPeer[]) => void>()

export function onPeersChanged(listener: (peers: DiscoveredPeer[]) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function discoveredPeers(): DiscoveredPeer[] {
  return [...peers.values()].sort((a, b) => a.deviceName.localeCompare(b.deviceName))
}

function notify(): void {
  const snapshot = discoveredPeers()
  for (const listener of listeners) listener(snapshot)
}

function textValue(service: Service, key: string): string {
  const value = (service.txt as Record<string, unknown> | undefined)?.[key]
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return ''
}

/** Prefer an IPv4 address from the record; fall back to whoever sent it to us. */
function addressOf(service: Service): string | null {
  const ipv4 = service.addresses?.find((address) => isIPv4(address))
  return ipv4 ?? service.referer?.address ?? null
}

function absorb(service: Service): void {
  const deviceId = textValue(service, TXT.deviceId)
  const host = addressOf(service)

  // Our own advertisement comes straight back at us over multicast loopback.
  if (!deviceId || !host || deviceId === getDeviceId()) return

  peers.set(deviceId, {
    deviceId,
    deviceName: textValue(service, TXT.deviceName) || service.name,
    fingerprint: textValue(service, TXT.fingerprint),
    host,
    port: service.port,
    protocolVersion: Number(textValue(service, TXT.protocolVersion)) || 0,
    paired: getTrusted(deviceId) !== undefined
  })

  notify()
}

function forget(service: Service): void {
  const deviceId = textValue(service, TXT.deviceId)
  if (deviceId && peers.delete(deviceId)) notify()
}

/**
 * Start advertising and browsing.
 *
 * One mDNS stack per physical interface, because multicast-dns binds to a single address:
 * advertising only on the default route silently loses a machine reachable over the other
 * adapter, and advertising on a Docker bridge publishes an address nothing can route to.
 */
export async function startDiscovery(port: number): Promise<void> {
  const certificate = await getCertificate()

  const text = {
    [TXT.deviceId]: getDeviceId(),
    [TXT.deviceName]: getDeviceName(),
    [TXT.fingerprint]: certificate.fingerprint,
    [TXT.protocolVersion]: String(PROTOCOL_VERSION)
  }

  const addresses = localAddresses().map((entry) => entry.address)

  // With no LAN adapter at all there is still loopback, which is exactly the case when two
  // instances are being tested on one machine.
  const interfaces: (string | undefined)[] = addresses.length > 0 ? addresses : [undefined]

  for (const address of interfaces) {
    const options: BonjourOptions = address ? { interface: address } : {}

    // An unreachable adapter should cost us that adapter, not the whole discovery system.
    const bonjour = new Bonjour(options, (error: unknown) =>
      console.warn(`[discovery] ${address ?? 'default'}:`, error)
    )

    const advertiser: Advertiser = { bonjour, service: null }

    try {
      advertiser.service = bonjour.publish({
        name: `${getDeviceName()} (${getDeviceId().slice(0, 8)})`,
        type: SERVICE_TYPE,
        protocol: 'tcp',
        port,
        txt: text,
        disableIPv6: true
      })

      const browser = bonjour.find({ type: SERVICE_TYPE, protocol: 'tcp' })
      browser.on('up', absorb)
      browser.on('down', forget)
      browser.on('txt-update', absorb)
      browser.on('srv-update', absorb)
    } catch (cause) {
      console.warn(`[discovery] could not advertise on ${address ?? 'default'}:`, cause)
    }

    advertisers.push(advertiser)
  }
}

/** Re-evaluate `paired` after a pairing or revocation, without waiting for a new record. */
export function refreshPairedFlags(): void {
  for (const [deviceId, peer] of peers) {
    peers.set(deviceId, { ...peer, paired: getTrusted(deviceId) !== undefined })
  }
  notify()
}

export async function stopDiscovery(): Promise<void> {
  await Promise.all(
    advertisers.map(
      (advertiser) =>
        new Promise<void>((resolve) => {
          // Send goodbye packets before tearing the socket down, so peers drop us promptly
          // instead of showing a dead device until the record's TTL expires.
          advertiser.bonjour.unpublishAll(() => advertiser.bonjour.destroy(() => resolve()))
        })
    )
  )

  advertisers.length = 0
  peers.clear()
}
