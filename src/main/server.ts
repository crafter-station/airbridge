import websocket from '@fastify/websocket'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { TLSSocket } from 'node:tls'

import type { DirEntry, PairRequest, ShareEvent } from '@shared/types'
import { getCertificate } from './cert'
import { getDeviceId, getDeviceName } from './identity'
import { isRealPathInside, resolveInside } from './paths'
import { PART_SUFFIX } from './peer'
import { handlePairRequest, PairingError } from './pairing'
import { getShare, listPublicShares } from './shares'
import { findByInboundToken, rememberAddress } from './trust'
import { onShareAvailabilityChanged, onShareContentChanged } from './watcher'

/** Fixed so a person can type it, with room to climb when it is taken — which is exactly
 *  what happens when a second instance is started for loopback testing. */
const BASE_PORT = 45789
const PORT_ATTEMPTS = 20

let instance: FastifyInstance | null = null
let boundPort: number | null = null

export function serverPort(): number | null {
  return boundPort
}

interface ShareParams {
  id: string
}

interface PathQuery {
  path?: string
}

/** Resolve a share plus a client path, or describe why it cannot be reached. */
function locate(
  shareId: string,
  requestedPath: string | undefined,
  options: { forWriting?: boolean } = {}
): { ok: true; root: string; target: string } | { ok: false; status: number; error: string } {
  const share = getShare(shareId)
  if (!share) return { ok: false, status: 404, error: 'No such share' }
  if (!share.available) return { ok: false, status: 503, error: 'Share is unavailable' }

  // Writability is checked here rather than in each handler, so a new write route cannot be
  // added without passing through it.
  if (options.forWriting && !share.writable) {
    return { ok: false, status: 403, error: 'This share is read-only' }
  }

  const target = resolveInside(share.path, requestedPath ?? '')
  if (!target || !isRealPathInside(share.path, target)) {
    return { ok: false, status: 403, error: 'Path is outside the share' }
  }

  return { ok: true, root: share.path, target }
}

/** `bytes=start-end`, with either side optional. Multi-range is not supported; a request for
 *  one is answered with the whole file, which is a legal response. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return null

  // A suffix range, `bytes=-500`, means the last 500 bytes.
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart === '' || rawEnd === '' ? size - 1 : Number(rawEnd)

  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end || start >= size) return null

  return { start, end: Math.min(end, size - 1) }
}

async function readDirectory(directory: string): Promise<DirEntry[]> {
  const dirents = await readdir(directory, { withFileTypes: true })

  const entries = await Promise.all(
    dirents.map(async (dirent): Promise<DirEntry | null> => {
      try {
        // stat, not lstat: a symlink should report the size of what it points at. Whether it
        // may be *opened* is decided separately, by the realpath check in `locate`.
        const stats = await stat(join(directory, dirent.name))
        return {
          name: dirent.name,
          kind: stats.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          mtime: stats.mtimeMs
        }
      } catch {
        // Broken symlink, or a file we may not stat. Omitting it beats failing the listing.
        return null
      }
    })
  )

  // Finder's order: folders first, then case-insensitive natural sort so `file10` follows
  // `file9` rather than `file1`.
  return entries
    .filter((entry): entry is DirEntry => entry !== null)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
}

/** The fingerprint of the certificate the caller presented on this connection, if any. */
function clientFingerprint(request: FastifyRequest): string | null {
  const certificate = (request.socket as TLSSocket).getPeerX509Certificate?.()
  return certificate?.fingerprint256 ?? null
}

function buildServer(certificate: { key: string; cert: string }): FastifyInstance {
  const server = Fastify({
    https: {
      key: certificate.key,
      cert: certificate.cert,
      // Ask every client for a certificate but do not require a CA chain: peers are all
      // self-signed. The certificate is checked against the pinned fingerprint by hand.
      requestCert: true,
      rejectUnauthorized: false
    },
    logger: false,
    // Uploads are arbitrarily large; the route streams to disk rather than buffering.
    bodyLimit: Number.MAX_SAFE_INTEGER
  })

  // Hand uploads to the route as a raw stream instead of letting Fastify buffer and parse.
  server.addContentTypeParser('application/octet-stream', (_request, payload, done) =>
    done(null, payload)
  )

  // Pairing is the one thing an unknown device may do, so it sits outside the authenticated
  // plugin below rather than being special-cased inside the auth hook.
  server.post<{ Body: PairRequest }>('/pair', async (request, reply) => {
    try {
      return await handlePairRequest(
        request.body,
        clientFingerprint(request),
        request.socket.remoteAddress ?? '',
        request.socket.remotePort ?? 0
      )
    } catch (cause) {
      if (cause instanceof PairingError) {
        return reply.code(cause.status).send({ error: cause.message })
      }
      throw cause
    }
  })

  void server.register(websocket)

  void server.register(async (authenticated) => {
    authenticated.addHook('onRequest', async (request, reply) => {
      const header = request.headers.authorization ?? ''
      const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
      const device = token ? findByInboundToken(token) : undefined

      // Two independent facts: a token we issued, and the key we pinned when we issued it.
      // A stolen token alone gets nowhere, because the thief cannot present the certificate.
      if (!device || clientFingerprint(request) !== device.fingerprint) {
        await reply.code(401).send({ error: 'Unauthorized' })
        return
      }

      if (request.socket.remoteAddress) {
        rememberAddress(device.deviceId, request.socket.remoteAddress, device.lastPort ?? 0)
      }
    })

    /** Who we are. Lets a peer confirm it reached the machine it meant to. */
    authenticated.get('/identity', async () => ({
      deviceId: getDeviceId(),
      deviceName: getDeviceName()
    }))

    authenticated.get('/shares', async () => ({ shares: listPublicShares() }))

    /**
     * Change notifications, so a peer's window updates without anyone refreshing.
     *
     * The socket carries no data of its own — only "something under this share moved" — and
     * the peer re-reads whatever it happens to be looking at. That keeps this endpoint from
     * becoming a second, subtly different way to read a directory.
     */
    authenticated.get('/events', { websocket: true }, (socket) => {
      const send = (payload: ShareEvent): void => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload))
      }

      const unsubscribeContent = onShareContentChanged((shareId) =>
        send({ type: 'share-changed', shareId })
      )
      const unsubscribeAvailability = onShareAvailabilityChanged(() =>
        send({ type: 'shares-changed' })
      )

      socket.on('close', () => {
        unsubscribeContent()
        unsubscribeAvailability()
      })
    })

    authenticated.get<{ Params: ShareParams; Querystring: PathQuery }>(
      '/shares/:id/list',
      async (request, reply) => {
        const located = locate(request.params.id, request.query.path)
        if (!located.ok) return reply.code(located.status).send({ error: located.error })

        const stats = await stat(located.target).catch(() => null)
        if (!stats?.isDirectory()) return reply.code(404).send({ error: 'Not a directory' })

        return { entries: await readDirectory(located.target) }
      }
    )

    authenticated.get<{ Params: ShareParams; Querystring: PathQuery }>(
      '/shares/:id/file',
      async (request, reply) => {
        const located = locate(request.params.id, request.query.path)
        if (!located.ok) return reply.code(located.status).send({ error: located.error })

        const stats = await stat(located.target).catch(() => null)
        if (!stats?.isFile()) return reply.code(404).send({ error: 'Not a file' })

        const name = basename(located.target)
        reply.header('accept-ranges', 'bytes')
        reply.header('content-type', 'application/octet-stream')
        reply.header('last-modified', new Date(stats.mtimeMs).toUTCString())
        reply.header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(name)}`
        )

        const range = parseRange(request.headers.range, stats.size)

        if (range) {
          reply.code(206)
          reply.header('content-range', `bytes ${range.start}-${range.end}/${stats.size}`)
          reply.header('content-length', range.end - range.start + 1)
          return reply.send(
            createReadStream(located.target, { start: range.start, end: range.end })
          )
        }

        reply.header('content-length', stats.size)
        return reply.send(createReadStream(located.target))
      }
    )

    /**
     * Upload into a writable share.
     *
     * Same commit discipline as a download: the bytes land in a `.airbridge-part` sibling and
     * are renamed into place once the stream ends, so a dropped connection cannot leave a
     * truncated file wearing the real name.
     */
    authenticated.put<{ Params: ShareParams; Querystring: PathQuery }>(
      '/shares/:id/file',
      async (request, reply) => {
        const located = locate(request.params.id, request.query.path, { forWriting: true })
        if (!located.ok) return reply.code(located.status).send({ error: located.error })

        const partPath = `${located.target}${PART_SUFFIX}`

        try {
          await mkdir(dirname(located.target), { recursive: true })
          await pipeline(request.raw, createWriteStream(partPath))
          await rename(partPath, located.target)
        } catch (cause) {
          await rm(partPath, { force: true })
          throw cause
        }

        return reply.code(201).send({ path: request.query.path ?? '', bytes: (await stat(located.target)).size })
      }
    )

    authenticated.delete<{ Params: ShareParams; Querystring: PathQuery }>(
      '/shares/:id/file',
      async (request, reply) => {
        const located = locate(request.params.id, request.query.path, { forWriting: true })
        if (!located.ok) return reply.code(located.status).send({ error: located.error })

        // Refuse to delete the share root itself: that is the folder the user published, not
        // something inside it.
        if (located.target === located.root) {
          return reply.code(403).send({ error: 'Cannot delete the share itself' })
        }

        const stats = await stat(located.target).catch(() => null)
        if (!stats) return reply.code(404).send({ error: 'No such file' })

        await rm(located.target, { recursive: stats.isDirectory(), force: false })
        return reply.code(204).send()
      }
    )
  })

  return server
}

/** Bind the first free port at or above the base, so two instances can coexist on one box. */
async function listen(server: FastifyInstance): Promise<number> {
  // Every interface, because being reachable from the LAN is the whole point. Overridable so
  // local development can stay on loopback and skip the firewall prompt.
  const host = process.env['AIRBRIDGE_BIND'] || '0.0.0.0'

  for (let port = BASE_PORT; port < BASE_PORT + PORT_ATTEMPTS; port++) {
    try {
      await server.listen({ port, host })
      return port
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw cause
    }
  }

  throw new Error(`No free port in ${BASE_PORT}..${BASE_PORT + PORT_ATTEMPTS - 1}`)
}

export async function startServer(): Promise<number> {
  if (instance && boundPort !== null) return boundPort

  const certificate = await getCertificate()
  instance = buildServer(certificate)
  boundPort = await listen(instance)
  return boundPort
}

export async function stopServer(): Promise<void> {
  await instance?.close()
  instance = null
  boundPort = null
}
