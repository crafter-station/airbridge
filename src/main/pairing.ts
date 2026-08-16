import { app, dialog } from 'electron'

import { PROTOCOL_VERSION } from '@shared/protocol'
import type { PairRequest, PairResponse, TrustedDevice } from '@shared/types'
import { getDeviceId, getDeviceName } from './identity'
import { getTrusted, mintToken, upsertTrusted } from './trust'

export class PairingError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'PairingError'
  }
}

/** Device IDs the user said no to. Remembered for the session so a machine that keeps asking
 *  cannot turn the approval prompt into a denial-of-service on the user's attention. */
const denied = new Set<string>()

/** At most one prompt at a time. A second request while one is open is refused rather than
 *  stacked, so approvals are never answered by a click meant for a different device. */
let prompting = false

function shortFingerprint(fingerprint: string): string {
  // The first and last few groups are plenty to compare across two screens by eye.
  const groups = fingerprint.split(':')
  return groups.length <= 8
    ? fingerprint
    : `${groups.slice(0, 4).join(':')} … ${groups.slice(-4).join(':')}`
}

async function askUser(request: PairRequest): Promise<boolean> {
  // The loopback tests drive a real pairing handshake, and nobody is there to click Allow.
  // Gated on the build being unpackaged as well as on the variable, so it is not something
  // that can be switched on against a shipped app.
  if (!app.isPackaged && process.env['AIRBRIDGE_AUTO_APPROVE'] === '1') return true

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow', "Don't Allow"],
    defaultId: 1,
    cancelId: 1,
    title: 'airbridge',
    message: `“${request.deviceName}” wants to connect`,
    detail:
      'It will be able to browse and copy from the folders you share.\n\n' +
      `Fingerprint  ${shortFingerprint(request.fingerprint)}`,
    noLink: true
  })

  return response === 0
}

/**
 * Handle an inbound pairing request.
 *
 * `presentedFingerprint` comes from the client certificate on the same TLS connection, not
 * from the request body. That distinction is the whole security of this step: the body's
 * fingerprint is a claim, and the fingerprint is broadcast in the mDNS record, so anyone on
 * the network could assert it. Only the machine holding the private key can present it.
 */
export async function handlePairRequest(
  request: PairRequest,
  presentedFingerprint: string | null,
  remoteHost: string,
  remotePort: number
): Promise<PairResponse> {
  if (request.protocolVersion !== PROTOCOL_VERSION) {
    throw new PairingError(
      426,
      `Protocol version ${request.protocolVersion} does not match ${PROTOCOL_VERSION}. ` +
        'One of the two machines needs updating.'
    )
  }

  if (!request.deviceId || !request.fingerprint || !request.grantToken) {
    throw new PairingError(400, 'Incomplete pairing request')
  }

  if (!presentedFingerprint) {
    throw new PairingError(400, 'Pairing requires a client certificate')
  }

  if (presentedFingerprint !== request.fingerprint) {
    throw new PairingError(400, 'Certificate does not match the fingerprint in the request')
  }

  if (denied.has(request.deviceId)) {
    throw new PairingError(403, 'Pairing was declined')
  }

  const existing = getTrusted(request.deviceId)

  // A known device on the same key is just reconnecting — after a reinstall or a token
  // rotation — and the user already answered this question. A known device on a *different*
  // key is the case worth interrupting for, so it falls through to the prompt.
  if (existing && existing.fingerprint === presentedFingerprint) {
    upsertTrusted({
      ...existing,
      deviceName: request.deviceName,
      outboundToken: request.grantToken,
      lastHost: remoteHost,
      lastPort: remotePort
    })
    return { deviceId: getDeviceId(), deviceName: getDeviceName(), token: existing.inboundToken }
  }

  if (prompting) {
    throw new PairingError(429, 'Another pairing request is already waiting for an answer')
  }

  prompting = true
  let allowed: boolean
  try {
    allowed = await askUser(request)
  } finally {
    prompting = false
  }

  if (!allowed) {
    denied.add(request.deviceId)
    throw new PairingError(403, 'Pairing was declined')
  }

  const device: TrustedDevice = {
    deviceId: request.deviceId,
    deviceName: request.deviceName,
    fingerprint: presentedFingerprint,
    inboundToken: mintToken(),
    outboundToken: request.grantToken,
    lastHost: remoteHost,
    lastPort: remotePort,
    pairedAt: Date.now()
  }

  upsertTrusted(device)

  return { deviceId: getDeviceId(), deviceName: getDeviceName(), token: device.inboundToken }
}

/** Forget a denial, so the user can change their mind without restarting the app. */
export function clearDenial(deviceId: string): void {
  denied.delete(deviceId)
}
