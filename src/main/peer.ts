import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { TLSSocket } from 'node:tls'

import type { DirEntry, DownloadResult, PeerAddress, PeerShares, PublicShare } from '@shared/types'

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
}

function peerRequest(peer: PeerAddress, options: RequestOptions): Promise<PeerResponse> {
  return new Promise((settle, fail) => {
    const request = httpsRequest({
      host: peer.host,
      port: peer.port,
      path: options.path,
      method: options.method ?? 'GET',
      // Every airbridge certificate is self-signed, so chain validation would reject all of
      // them. Identity comes from the fingerprint check below instead — which is stricter
      // than a CA chain, since it names one specific machine.
      rejectUnauthorized: false,
      // TODO(M3): a keep-alive agent per peer. Fresh sockets keep the handshake check below
      // trivially correct, but cost a TLS round trip per file during a recursive copy.
      agent: false,
      headers: { authorization: `Bearer ${peer.token}`, ...options.headers }
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

    request.on('error', fail)
    request.on('response', (response) =>
      settle({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        fingerprint
      })
    )

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

/**
 * Stream one remote file to disk.
 *
 * Writes to a `.airbridge-part` sibling and renames on success, so an interrupted transfer
 * leaves an obviously-partial file rather than a plausible-looking truncated one. M3 layers
 * the queue, resume and collision handling on top of this.
 */
export async function downloadFile(
  peer: PeerAddress,
  shareId: string,
  remotePath: string,
  destinationDirectory: string,
  options: { fileName?: string; resume?: boolean } = {}
): Promise<DownloadResult> {
  await mkdir(destinationDirectory, { recursive: true })

  const fileName = options.fileName ?? (basename(remotePath) || 'download')
  const finalPath = join(destinationDirectory, fileName)
  const partPath = `${finalPath}${PART_SUFFIX}`

  const alreadyHave = options.resume ? await stat(partPath).then((s) => s.size).catch(() => 0) : 0

  const response = await peerRequest(peer, {
    path: `/shares/${encodeURIComponent(shareId)}/file${query(remotePath)}`,
    headers: alreadyHave > 0 ? { range: `bytes=${alreadyHave}-` } : undefined
  })

  if (response.status >= 400) {
    throw new Error(`Peer returned ${response.status}: ${await readBody(response)}`)
  }

  // A server that ignores the Range header sends 200 and the whole file; appending in that
  // case would corrupt the result, so the partial is discarded and we start over.
  const appending = alreadyHave > 0 && response.status === 206
  if (alreadyHave > 0 && !appending) await rm(partPath, { force: true })

  await pipeline(response.body, createWriteStream(partPath, { flags: appending ? 'a' : 'w' }))
  await rename(partPath, finalPath)

  return { path: finalPath, bytes: (await stat(finalPath)).size }
}
