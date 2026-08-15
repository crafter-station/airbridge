import Fastify, { type FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'

import type { DirEntry } from '@shared/types'
import { getAccessToken } from './auth'
import { getCertificate } from './cert'
import { getDeviceId, getDeviceName } from './identity'
import { isRealPathInside, resolveInside } from './paths'
import { getShare, listPublicShares } from './shares'

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
  requestedPath: string | undefined
): { ok: true; root: string; target: string } | { ok: false; status: number; error: string } {
  const share = getShare(shareId)
  if (!share) return { ok: false, status: 404, error: 'No such share' }
  if (!share.available) return { ok: false, status: 503, error: 'Share is unavailable' }

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

function buildServer(certificate: { key: string; cert: string }): FastifyInstance {
  const server = Fastify({
    https: { key: certificate.key, cert: certificate.cert },
    logger: false
  })

  server.addHook('onRequest', async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${getAccessToken()}`) {
      await reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  /** Who we are. Lets a peer confirm it reached the machine it meant to before pairing. */
  server.get('/identity', async () => ({
    deviceId: getDeviceId(),
    deviceName: getDeviceName()
  }))

  server.get('/shares', async () => ({ shares: listPublicShares() }))

  server.get<{ Params: ShareParams; Querystring: PathQuery }>(
    '/shares/:id/list',
    async (request, reply) => {
      const located = locate(request.params.id, request.query.path)
      if (!located.ok) return reply.code(located.status).send({ error: located.error })

      const stats = await stat(located.target).catch(() => null)
      if (!stats?.isDirectory()) return reply.code(404).send({ error: 'Not a directory' })

      return { entries: await readDirectory(located.target) }
    }
  )

  server.get<{ Params: ShareParams; Querystring: PathQuery }>(
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
      reply.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)

      const range = parseRange(request.headers.range, stats.size)

      if (range) {
        reply.code(206)
        reply.header('content-range', `bytes ${range.start}-${range.end}/${stats.size}`)
        reply.header('content-length', range.end - range.start + 1)
        return reply.send(createReadStream(located.target, { start: range.start, end: range.end }))
      }

      reply.header('content-length', stats.size)
      return reply.send(createReadStream(located.target))
    }
  )

  return server
}

/** Bind the first free port at or above the base, so two instances can coexist on one box. */
async function listen(server: FastifyInstance): Promise<number> {
  for (let port = BASE_PORT; port < BASE_PORT + PORT_ATTEMPTS; port++) {
    try {
      await server.listen({ port, host: '0.0.0.0' })
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
