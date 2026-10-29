import { connect } from 'node:net'

import { EVENTS } from '@shared/ipc'
import type { KnownDevice, PeerAddress, TrustedDevice } from '@shared/types'
import { discoveredPeers, refreshPairedFlags } from './discovery'
import { broadcast } from './events'
import { requestPairing } from './peer'
import { BASE_PORT, serverPort } from './server'
import { listTrusted, mintToken, rememberAddress, revokeTrusted, upsertTrusted } from './trust'

/** How long one address gets to accept a TCP connection before it is written off. */
const PROBE_TIMEOUT_MS = 2500

/** How long a confirmed address is trusted without probing again. Short, because a laptop
 *  can change networks between one click and the next. */
const REACHABLE_TTL_MS = 15_000

const reachable = new Map<string, { host: string; port: number; at: number }>()

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

/** Resolve when something accepts a TCP connection at this address, reject otherwise. */
function probe(host: string, port: number): Promise<{ host: string; port: number }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => {
      socket.destroy()
      resolve({ host, port })
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error(`${host}:${port} timed out`))
    })
    socket.once('error', reject)
  })
}

/**
 * Turn a device id into an address that is answering right now.
 *
 * A device can have several plausible addresses — each adapter it advertised on, plus where
 * it last called us from — and any of them can be stale: DHCP hands out a new lease, a laptop
 * moves from Ethernet to Wi-Fi, a record lingers after the machine slept without saying
 * goodbye. Picking one up front is how a call ends in ETIMEDOUT against an address nobody
 * holds any more, so all of them are tried at once and the first to accept wins.
 */
export async function resolvePeer(deviceId: string): Promise<PeerAddress> {
  const trusted = listTrusted().find((device) => device.deviceId === deviceId)
  if (!trusted) throw new Error('That device is not paired')

  const credentials = { token: trusted.outboundToken, fingerprint: trusted.fingerprint }

  const cached = reachable.get(deviceId)
  if (cached && Date.now() - cached.at < REACHABLE_TTL_MS) {
    return { host: cached.host, port: cached.port, ...credentials }
  }

  const live = discoveredPeers().find((peer) => peer.deviceId === deviceId)
  const candidates = new Map<string, { host: string; port: number }>()
  const consider = (host: string | null | undefined, port: number | null | undefined): void => {
    if (host && port) candidates.set(`${host}:${port}`, { host, port })
  }

  for (const host of live?.addresses ?? []) consider(host, live?.port)
  consider(trusted.lastHost, trusted.lastPort)
  // They called us from this address, so it routes; their port is whatever mDNS last said.
  consider(trusted.lastHost, live?.port)
  // Where nearly every install listens. 1.0.0 recorded a peer's ephemeral source port at
  // pairing, so without this a device mDNS cannot see was unreachable for good.
  consider(trusted.lastHost, BASE_PORT)

  if (candidates.size === 0) throw new Error(`${trusted.deviceName} is not reachable right now`)

  let winner: { host: string; port: number }
  try {
    winner = await Promise.any([...candidates.values()].map(({ host, port }) => probe(host, port)))
  } catch {
    reachable.delete(deviceId)
    const tried = [...candidates.keys()].join(', ')
    throw new Error(
      `${trusted.deviceName} is not answering (tried ${tried}). Check that airbridge is open on ` +
        'it, that both machines are on the same network, and that its firewall allows airbridge.'
    )
  }

  reachable.set(deviceId, { ...winner, at: Date.now() })
  if (winner.host !== trusted.lastHost || winner.port !== trusted.lastPort) {
    rememberAddress(deviceId, winner.host, winner.port)
  }

  return { ...winner, ...credentials }
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
  const response = await requestPairing({ host, port }, grantToken, serverPort())

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
  reachable.delete(deviceId)
  revokeTrusted(deviceId)
  refreshPairedFlags()
  notifyDevicesChanged()
}
