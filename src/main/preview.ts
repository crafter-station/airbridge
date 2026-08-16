import { protocol } from 'electron'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'

import { PREVIEW_SCHEME } from '@shared/preview'
import { resolvePeer } from './devices'
import { openPeerFile } from './peer'

/**
 * Bytes for the preview panel, from either machine.
 *
 * The renderer cannot talk to a peer itself — it holds no token, presents no certificate, and
 * its content policy forbids outside connections. So previews go through a protocol handled
 * in main, which attaches the credentials and forwards the request. The URL carries only
 * identifiers; nothing secret is ever visible to the page.
 *
 * Range is passed through in both directions rather than absorbed. That is the whole reason a
 * 150MB video opens immediately: the media element fetches the header, seeks by asking for a
 * window of bytes, and nothing is ever written to disk or held in memory.
 */

/** The renderer builds these URLs; this side only has to take them apart again. */
function decodeSegment(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

/** Called before app ready — `protocol.handle` alone does not grant streaming or fetch. */
export function registerPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PREVIEW_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        // Without `stream`, a <video> gets one non-seekable response and the scrubber does
        // nothing. Without `supportFetchAPI`, the text preview cannot read a prefix.
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}

/** `bytes=start-end`, either side optional. */
function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Number(rawEnd)

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null

  return { start, end: Math.min(end, size - 1) }
}

function streamResponse(
  node: NodeJS.ReadableStream,
  status: number,
  headers: Record<string, string>
): Response {
  // Readable.toWeb hands Chromium a stream it can consume incrementally, so playback starts
  // on the first chunk rather than when the response completes.
  return new Response(Readable.toWeb(node as Readable) as ReadableStream, { status, headers })
}

async function serveLocal(path: string, rangeHeader: string | null): Promise<Response> {
  const stats = await stat(path).catch(() => null)
  if (!stats?.isFile()) return new Response('Not found', { status: 404 })

  const range = parseRange(rangeHeader, stats.size)

  if (range) {
    return streamResponse(createReadStream(path, { start: range.start, end: range.end }), 206, {
      'content-type': 'application/octet-stream',
      'content-length': String(range.end - range.start + 1),
      'content-range': `bytes ${range.start}-${range.end}/${stats.size}`,
      'accept-ranges': 'bytes'
    })
  }

  return streamResponse(createReadStream(path), 200, {
    'content-type': 'application/octet-stream',
    'content-length': String(stats.size),
    'accept-ranges': 'bytes'
  })
}

async function serveRemote(
  deviceId: string,
  shareId: string,
  path: string,
  rangeHeader: string | null
): Promise<Response> {
  const upstream = await openPeerFile(resolvePeer(deviceId), shareId, path, rangeHeader)

  if (upstream.status >= 400) {
    upstream.body.resume()
    return new Response('Unavailable', { status: upstream.status })
  }

  // Carry through only what the media stack needs to seek. The peer's other headers are
  // its business, not the page's.
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream' }
  for (const name of ['content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers[name]
    if (typeof value === 'string') headers[name] = value
  }

  return streamResponse(upstream.body, upstream.status, headers)
}

export function handlePreviewRequests(): void {
  protocol.handle(PREVIEW_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const range = request.headers.get('range')
      // `airbridge://remote/<deviceId>/<shareId>/<path>` or `airbridge://local/<path>`.
      const segments = url.pathname.split('/').filter(Boolean)

      if (url.hostname === 'local' && segments.length === 1) {
        return await serveLocal(decodeSegment(segments[0]), range)
      }

      if (url.hostname === 'remote' && segments.length === 3) {
        const [deviceId, shareId, encodedPath] = segments
        return await serveRemote(deviceId, shareId, decodeSegment(encodedPath), range)
      }

      return new Response('Bad request', { status: 400 })
    } catch (cause) {
      // A peer that went offline mid-preview is ordinary, not exceptional.
      return new Response(cause instanceof Error ? cause.message : 'Failed', { status: 502 })
    }
  })
}
