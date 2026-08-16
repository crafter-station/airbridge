import { WebSocket } from 'ws'

import { EVENTS } from '@shared/ipc'
import type { PeerEvent, ShareEvent } from '@shared/types'
import { getCertificate } from './cert'
import { resolvePeer } from './devices'
import { broadcast } from './events'
import { listTrusted } from './trust'

/** Long enough that a peer being off for the night is not a reconnect storm, short enough
 *  that waking a laptop reconnects before anyone notices. */
const RETRY_MS = 5000

interface Connection {
  socket: WebSocket | null
  retry: NodeJS.Timeout | null
  closed: boolean
}

const connections = new Map<string, Connection>()

/** Extra subscribers alongside the renderer broadcast, so the self test can observe an event
 *  arriving in a headless instance where there is no window to receive one. */
const listeners = new Set<(event: PeerEvent) => void>()

export function onPeerEvent(listener: (event: PeerEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Keep a change-notification socket open to every paired device.
 *
 * Sockets, not polling: a folder that changes once an hour would otherwise cost a request
 * every few seconds against every peer, and a folder being actively worked in would still
 * show stale contents for as long as the interval.
 */
export function startPeerEvents(): void {
  syncConnections()
}

/** Open sockets for newly-paired devices and drop them for revoked ones. */
export function syncConnections(): void {
  const paired = new Set(listTrusted().map((device) => device.deviceId))

  for (const [deviceId, connection] of connections) {
    if (!paired.has(deviceId)) {
      close(connection)
      connections.delete(deviceId)
    }
  }

  for (const deviceId of paired) {
    if (!connections.has(deviceId)) {
      const connection: Connection = { socket: null, retry: null, closed: false }
      connections.set(deviceId, connection)
      void connect(deviceId, connection)
    }
  }
}

function close(connection: Connection): void {
  connection.closed = true
  if (connection.retry) clearTimeout(connection.retry)
  connection.socket?.close()
  connection.socket = null
}

function scheduleRetry(deviceId: string, connection: Connection): void {
  if (connection.closed || connection.retry) return

  connection.retry = setTimeout(() => {
    connection.retry = null
    void connect(deviceId, connection)
  }, RETRY_MS)
}

async function connect(deviceId: string, connection: Connection): Promise<void> {
  if (connection.closed) return

  let peer: ReturnType<typeof resolvePeer>
  try {
    peer = resolvePeer(deviceId)
  } catch {
    // Offline, or no address yet. Try again once discovery has had another go.
    scheduleRetry(deviceId, connection)
    return
  }

  const identity = await getCertificate()

  // The same rules as every other call: our certificate goes out, theirs is checked against
  // the fingerprint pinned at pairing, and the bearer token identifies the session.
  const socket = new WebSocket(`wss://${peer.host}:${peer.port}/events`, {
    key: identity.key,
    cert: identity.cert,
    rejectUnauthorized: false,
    headers: { authorization: `Bearer ${peer.token}` }
  })

  connection.socket = socket

  socket.on('upgrade', (response) => {
    const presented = (response.socket as import('node:tls').TLSSocket)
      .getPeerX509Certificate?.()
      ?.fingerprint256

    if (peer.fingerprint && presented !== peer.fingerprint) {
      socket.terminate()
    }
  })

  socket.on('message', (raw) => {
    try {
      const peerEvent: PeerEvent = { deviceId, event: JSON.parse(String(raw)) as ShareEvent }
      broadcast(EVENTS.peer, peerEvent)
      for (const listener of listeners) listener(peerEvent)
    } catch {
      // A peer sending nonsense is not worth tearing the connection down for.
    }
  })

  socket.on('close', () => {
    connection.socket = null
    scheduleRetry(deviceId, connection)
  })

  socket.on('error', () => {
    // 'close' always follows, which is where the retry is scheduled.
  })
}

export function stopPeerEvents(): void {
  for (const connection of connections.values()) close(connection)
  connections.clear()
}
