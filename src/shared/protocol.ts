/** Wire constants both peers must agree on. */

/** Bumped whenever the HTTP or mDNS contract changes incompatibly. Advertised in the TXT
 *  record so a newer build can refuse an older one with a useful message rather than a
 *  confusing 400. */
export const PROTOCOL_VERSION = 1

/** Advertised as `_airbridge._tcp`. */
export const SERVICE_TYPE = 'airbridge'

/** TXT record keys. Kept to two characters — the whole record shares one UDP packet with
 *  everything else mDNS puts in there. */
export const TXT = {
  deviceId: 'id',
  deviceName: 'nm',
  fingerprint: 'fp',
  protocolVersion: 'v'
} as const
