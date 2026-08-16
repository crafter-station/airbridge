import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, utimes } from 'node:fs/promises'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { TLSSocket } from 'node:tls'

import { PROTOCOL_VERSION } from '@shared/protocol'
import type {
  DirEntry,
  DownloadResult,
  PairRequest,
  PairResponse,
  PeerAddress,
  PeerShares,
  PublicShare
} from '@shared/types'
import { getCertificate } from './cert'
import { getDeviceId, getDeviceName } from './identity'

/** Suffix for a transfer still in flight. A killed download must never leave behind a file
 *  that looks complete — the rename to the real name is the commit. */
export const PART_SUFFIX = '.airbridge-part'

interface PeerResponse {
  status: number
  headers: IncomingHttpHeaders
  body: IncomingMessage
  /** The certificate actually presented, for the caller to pin or compare. */
  fingerprint: string
}

interface RequestOptions {
  path: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  /** A body too big to hold in memory. Mutually exclusive with `body`. */
  stream?: { source: Readable; bytes: number }
  signal?: AbortSignal
}

async function peerRequest(
  peer: Omit<PeerAddress, 'token'> & { token?: string },
  options: RequestOptions
): Promise<PeerResponse> {
  // We present our own certificate on every call, not just when pairing: it is what proves
  // to the far side that the bearer token is being used by the machine it was issued to.
  const identity = await getCertificate()

  const payload =
    options.body === undefined ? null : Buffer.from(JSON.stringify(options.body), 'utf8')

  return new Promise((settle, fail) => {
    const request = httpsRequest({
      host: peer.host,
      port: peer.port,
      path: options.path,
      method: options.method ?? 'GET',
      key: identity.key,
      cert: identity.cert,
      // Every airbridge certificate is self-signed, so chain validation would reject all of
      // them. Identity comes from the fingerprint check below instead — which is stricter
      // than a CA chain, since it names one specific machine.
      rejectUnauthorized: false,
      // TODO(M3): a keep-alive agent per peer. Fresh sockets keep the handshake check below
      // trivially correct, but cost a TLS round trip per file during a recursive copy.
      agent: false,
      headers: {
        ...(peer.token ? { authorization: `Bearer ${peer.token}` } : {}),
        ...(payload
          ? { 'content-type': 'application/json', 'content-length': payload.byteLength }
          : {}),
        ...(options.stream
          ? {
              'content-type': 'application/octet-stream',
              'content-length': options.stream.bytes
            }
          : {}),
        ...options.headers
      }
    })

    let fingerprint = ''

    request.on('socket', (socket) => {
      const tls = socket as TLSSocket
      tls.once('secureConnect', () => {
        const certificate = tls.getPeerX509Certificate()
        if (!certificate) {
          tls.destroy(new Error('Peer presented no certificate'))
          return
        }

        fingerprint = certificate.fingerprint256

        if (peer.fingerprint && peer.fingerprint !== fingerprint) {
          // Known device, different key. That is the impersonation case, so it fails loudly
          // rather than asking whether to trust it again.
          tls.destroy(
            new Error(
              `Certificate for ${peer.host} does not match the one recorded at pairing. ` +
                'Refusing to connect.'
            )
          )
        }
      })
    })

    if (options.signal) {
      const abort = (): void => {
        request.destroy(new Error('Transfer cancelled'))
      }
      if (options.signal.aborted) abort()
      else options.signal.addEventListener('abort', abort, { once: true })
    }

    request.on('error', fail)
    request.on('response', (response) =>
      settle({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        fingerprint
      })
    )

    if (options.stream) {
      options.stream.source.on('error', fail)
      options.stream.source.pipe(request)
      return
    }

    if (payload) request.write(payload)
    request.end()
  })
}

async function readBody(response: PeerResponse): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of response.body) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function readJson<T>(response: PeerResponse): Promise<T> {
  const text = await readBody(response)

  if (response.status >= 400) {
    const message = (() => {
      try {
        return (JSON.parse(text) as { error?: string }).error ?? text
      } catch {
        return text
      }
    })()
    throw new Error(`Peer returned ${response.status}: ${message}`)
  }

  return JSON.parse(text) as T
}

function query(path: string): string {
  return `?path=${encodeURIComponent(path)}`
}

export async function fetchPeerIdentity(
  peer: PeerAddress
): Promise<{ deviceId: string; deviceName: string; fingerprint: string }> {
  const response = await peerRequest(peer, { path: '/identity' })
  const identity = await readJson<{ deviceId: string; deviceName: string }>(response)
  return { ...identity, fingerprint: response.fingerprint }
}

/**
 * Ask a device to pair, and wait while a person on the other end decides.
 *
 * `grantToken` travels outward in the request body: pairing is mutual in a single approval,
 * so we hand them a token to call us with at the same moment they hand us one.
 */
export async function requestPairing(
  address: { host: string; port: number },
  grantToken: string
): Promise<PairResponse & { fingerprint: string }> {
  const identity = await getCertificate()

  const body: PairRequest = {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    fingerprint: identity.fingerprint,
    protocolVersion: PROTOCOL_VERSION,
    grantToken
  }

  const response = await peerRequest(address, { path: '/pair', method: 'POST', body })
  const result = await readJson<PairResponse>(response)
  return { ...result, fingerprint: response.fingerprint }
}

export async function listPeerShares(peer: PeerAddress): Promise<PeerShares> {
  const response = await peerRequest(peer, { path: '/shares' })
  const { shares } = await readJson<{ shares: PublicShare[] }>(response)
  return { shares, fingerprint: response.fingerprint }
}

export async function listPeerDirectory(
  peer: PeerAddress,
  shareId: string,
  path: string
): Promise<DirEntry[]> {
  const response = await peerRequest(peer, {
    path: `/shares/${encodeURIComponent(shareId)}/list${query(path)}`
  })
  const { entries } = await readJson<{ entries: DirEntry[] }>(response)
  return entries
}

export interface DownloadOptions {
  /** Overrides the name taken from the remote path — used by Keep Both. */
  fileName?: string
  /** Continue from whatever is already in the `.part` file rather than starting over. */
  resume?: boolean
  signal?: AbortSignal
  /** Called with the size of each chunk as it arrives, not a running total. */
  onProgress?: (chunkBytes: number) => void
}

/**
 * Stream one remote file to disk.
 *
 * Writes to a `.airbridge-part` sibling and renames on success. The rename is the commit: an
 * interrupted transfer leaves an obviously-partial file rather than a plausible-looking
 * truncated one that a person would mistake for the real thing.
 */
export async function downloadFile(
  peer: PeerAddress,
  shareId: string,
  remotePath: string,
  destinationDirectory: string,
  options: DownloadOptions = {}
): Promise<DownloadResult> {
  await mkdir(destinationDirectory, { recursive: true })

  const fileName = options.fileName ?? (basename(remotePath) || 'download')
  const finalPath = join(destinationDirectory, fileName)
  const partPath = `${finalPath}${PART_SUFFIX}`

  const alreadyHave = options.resume
    ? await stat(partPath)
        .then((stats) => stats.size)
        .catch(() => 0)
    : 0

  const response = await peerRequest(peer, {
    path: `/shares/${encodeURIComponent(shareId)}/file${query(remotePath)}`,
    headers: alreadyHave > 0 ? { range: `bytes=${alreadyHave}-` } : undefined,
    signal: options.signal
  })

  if (response.status >= 400) {
    throw new Error(`Peer returned ${response.status}: ${await readBody(response)}`)
  }

  // A server that ignores the Range header sends 200 and the whole file; appending in that
  // case would corrupt the result, so the partial is discarded and we start over.
  const appending = alreadyHave > 0 && response.status === 206
  if (alreadyHave > 0 && !appending) await rm(partPath, { force: true })

  if (options.onProgress) {
    if (appending) options.onProgress(alreadyHave)
    response.body.on('data', (chunk: Buffer) => options.onProgress?.(chunk.length))
  }

  await pipeline(response.body, createWriteStream(partPath, { flags: appending ? 'a' : 'w' }), {
    signal: options.signal
  })

  await rename(partPath, finalPath)

  // Carry the original timestamp across, the way a copy in Finder does. Failure here is
  // cosmetic — the bytes are already committed — so it must not fail the transfer.
  const lastModified = response.headers['last-modified']
  if (lastModified) {
    const modified = new Date(lastModified)
    if (!Number.isNaN(modified.getTime())) {
      await utimes(finalPath, modified, modified).catch(() => {})
    }
  }

  return { path: finalPath, bytes: (await stat(finalPath)).size }
}

/**
 * Send one local file into a writable share.
 *
 * No resume in this direction: the receiving end commits with a rename, so a failed upload
 * leaves nothing to continue from. Retrying re-sends the file, which for the sizes this app
 * moves over a LAN is cheaper than a resumable-upload protocol.
 */
export async function uploadFile(
  peer: PeerAddress,
  shareId: string,
  localPath: string,
  remotePath: string,
  options: { signal?: AbortSignal; onProgress?: (chunkBytes: number) => void } = {}
): Promise<{ bytes: number }> {
  const { size } = await stat(localPath)
  const source = createReadStream(localPath)

  if (options.onProgress) {
    source.on('data', (chunk) => options.onProgress?.((chunk as Buffer).length))
  }

  const response = await peerRequest(peer, {
    method: 'PUT',
    path: `/shares/${encodeURIComponent(shareId)}/file${query(remotePath)}`,
    stream: { source, bytes: size },
    signal: options.signal
  })

  if (response.status >= 400) {
    throw new Error(`Peer returned ${response.status}: ${await readBody(response)}`)
  }

  await readBody(response)
  return { bytes: size }
}

export async function deleteRemote(
  peer: PeerAddress,
  shareId: string,
  remotePath: string
): Promise<void> {
  const response = await peerRequest(peer, {
    method: 'DELETE',
    path: `/shares/${encodeURIComponent(shareId)}/file${query(remotePath)}`
  })

  if (response.status >= 400) {
    throw new Error(`Peer returned ${response.status}: ${await readBody(response)}`)
  }

  await readBody(response)
}
