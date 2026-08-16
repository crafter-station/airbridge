/**
 * End-to-end check of the sharing server against a real, running instance.
 *
 * Everything here talks over the wire rather than importing the app's modules, because the
 * HTTP contract is what a peer actually depends on — including the parts that only exist at
 * runtime, like the TLS handshake and the port fallback. The script generates its own
 * certificate and acts as a second device.
 *
 *   pnpm build && pnpm smoke
 */
import electronPath from 'electron'
import { spawn } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { request } from 'node:https'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generate } from 'selfsigned'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 45789
const PROTOCOL_VERSION = 1

let failures = 0
let checks = 0

function check(description, condition, detail) {
  checks++
  if (condition) {
    console.log(`  ok   ${description}`)
  } else {
    failures++
    console.log(`  FAIL ${description}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/**
 * An HTTPS call that trusts the self-signed certificate but reports the one it saw, and
 * presents a client certificate of its own — which is what the server checks the bearer
 * token against.
 */
function call(path, { token, headers = {}, identity, method = 'GET', body, raw } = {}) {
  // `body` is JSON; `raw` is an octet-stream upload.
  const payload = raw ?? (body === undefined ? null : Buffer.from(JSON.stringify(body), 'utf8'))
  const contentType = raw ? 'application/octet-stream' : 'application/json'

  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method,
        rejectUnauthorized: false,
        agent: false,
        ...(identity ? { key: identity.key, cert: identity.cert } : {}),
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(payload
            ? { 'content-type': contentType, 'content-length': payload.byteLength }
            : {}),
          ...headers
        }
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks)
          })
        )
      }
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function waitForServer(child, identity, token, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (child.exitCode !== null) throw new Error(`App exited early with code ${child.exitCode}`)
    try {
      await call('/shares', { token, identity })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Server never came up on port ${PORT}`)
}

// --- Fixture ---------------------------------------------------------------------------

const fixture = mkdtempSync(join(tmpdir(), 'airbridge-smoke-'))
const outside = mkdtempSync(join(tmpdir(), 'airbridge-outside-'))
const dataDirectory = mkdtempSync(join(tmpdir(), 'airbridge-data-'))

writeFileSync(join(outside, 'secret.txt'), 'do not share me')
writeFileSync(join(fixture, 'hello.txt'), 'Hello from airbridge!')
writeFileSync(join(fixture, 'file10.txt'), 'ten')
writeFileSync(join(fixture, 'file9.txt'), 'nine')
// A legitimate file whose name starts with dots, to catch prefix-matching containment checks.
writeFileSync(join(fixture, '..notes.txt'), 'legitimate')
mkdirSync(join(fixture, 'nested'))
writeFileSync(join(fixture, 'nested', 'inner.bin'), Buffer.alloc(4096, 7))

// Symlinks need Developer Mode or elevation on Windows, so the escape test is conditional.
let symlinkCreated = false
try {
  symlinkSync(outside, join(fixture, 'escape'), 'dir')
  symlinkCreated = true
} catch {
  console.log('  note symlink escape test skipped (no permission to create symlinks)')
}

// This script is the second device: its certificate is what the server pins, and its token
// is what the server issued. Seeding both is the same state a real pairing would leave.
const generated = await generate([{ name: 'commonName', value: 'airbridge-smoke' }], {
  keyType: 'ec',
  curve: 'P-256',
  algorithm: 'sha256'
})
const identity = { key: generated.private, cert: generated.cert }
const fingerprint = new X509Certificate(generated.cert).fingerprint256

const otherGenerated = await generate([{ name: 'commonName', value: 'airbridge-imposter' }], {
  keyType: 'ec',
  curve: 'P-256',
  algorithm: 'sha256'
})
const imposter = { key: otherGenerated.private, cert: otherGenerated.cert }

const shareId = '00000000-0000-4000-8000-00000000cafe'
const deviceId = '00000000-0000-4000-8000-0000000000aa'
const token = 'smoke-token'

const writableShareId = '00000000-0000-4000-8000-00000000beef'
const dropbox = mkdtempSync(join(tmpdir(), 'airbridge-dropbox-'))

writeFileSync(
  join(dataDirectory, 'shares.json'),
  JSON.stringify(
    [
      { id: shareId, name: 'Smoke', path: fixture, writable: false },
      { id: writableShareId, name: 'Dropbox', path: dropbox, writable: true }
    ],
    null,
    2
  )
)
writeFileSync(
  join(dataDirectory, 'trust.json'),
  JSON.stringify(
    [
      {
        deviceId,
        deviceName: 'Smoke Tester',
        fingerprint,
        inboundToken: token,
        outboundToken: 'unused',
        lastHost: '127.0.0.1',
        lastPort: PORT,
        pairedAt: Date.now()
      }
    ],
    null,
    2
  )
)

// --- Run -------------------------------------------------------------------------------

console.log(`fixture ${fixture}`)

const child = spawn(electronPath, ['.'], {
  cwd: PROJECT,
  env: {
    ...process.env,
    AIRBRIDGE_HEADLESS: '1',
    AIRBRIDGE_ALLOW_MULTI: '1',
      AIRBRIDGE_BIND: '127.0.0.1',
      AIRBRIDGE_NO_DISCOVERY: '1',
    AIRBRIDGE_DATA_DIR: dataDirectory
  },
  stdio: 'inherit'
})

try {
  await waitForServer(child, identity, token)

  // --- Authentication ---

  const noToken = await call('/shares', { identity })
  check('rejects a request with no token', noToken.status === 401, noToken.status)

  const wrongToken = await call('/shares', { token: 'nope', identity })
  check('rejects a wrong token', wrongToken.status === 401, wrongToken.status)

  const noCertificate = await call('/shares', { token })
  check(
    'rejects a valid token with no client certificate',
    noCertificate.status === 401,
    noCertificate.status
  )

  const wrongCertificate = await call('/shares', { token, identity: imposter })
  check(
    'rejects a valid token presented with the wrong certificate',
    wrongCertificate.status === 401,
    wrongCertificate.status
  )

  // --- Pairing ---

  const staleVersion = await call('/pair', {
    identity,
    method: 'POST',
    body: {
      deviceId,
      deviceName: 'Smoke Tester',
      fingerprint,
      protocolVersion: PROTOCOL_VERSION + 1,
      grantToken: 'x'
    }
  })
  check('refuses a mismatched protocol version', staleVersion.status === 426, staleVersion.status)

  const claimedFingerprint = await call('/pair', {
    identity,
    method: 'POST',
    body: {
      deviceId,
      deviceName: 'Smoke Tester',
      fingerprint: 'AA:BB:CC',
      protocolVersion: PROTOCOL_VERSION,
      grantToken: 'x'
    }
  })
  check(
    'refuses a fingerprint the connection did not prove',
    claimedFingerprint.status === 400,
    claimedFingerprint.status
  )

  const noClientCertificate = await call('/pair', {
    method: 'POST',
    body: {
      deviceId,
      deviceName: 'Smoke Tester',
      fingerprint,
      protocolVersion: PROTOCOL_VERSION,
      grantToken: 'x'
    }
  })
  check(
    'refuses to pair without a client certificate',
    noClientCertificate.status === 400,
    noClientCertificate.status
  )

  // Already trusted on this exact key: a reconnection, not a new decision, so no prompt.
  const rePair = await call('/pair', {
    identity,
    method: 'POST',
    body: {
      deviceId,
      deviceName: 'Smoke Tester',
      fingerprint,
      protocolVersion: PROTOCOL_VERSION,
      grantToken: 'refreshed'
    }
  })
  check('re-pairs a known device without prompting', rePair.status === 200, rePair.status)
  check(
    'returns the token already issued to that device',
    JSON.parse(rePair.body.toString()).token === token,
    rePair.body.toString()
  )

  // --- Shares ---

  const shares = await call('/shares', { token, identity })
  const shareList = JSON.parse(shares.body.toString()).shares
  check('lists the share', shareList.some((share) => share.id === shareId))
  check(
    'never sends the folder path to peers',
    shareList.every((share) => share.path === undefined)
  )

  const listing = await call(`/shares/${shareId}/list`, { token, identity })
  const entries = JSON.parse(listing.body.toString()).entries
  const names = entries.map((entry) => entry.name)
  check('lists directory contents', names.includes('hello.txt') && names.includes('nested'))
  check('sorts folders before files', entries[0].kind === 'directory', names.join(', '))
  check(
    'sorts names naturally, not lexically',
    names.indexOf('file9.txt') < names.indexOf('file10.txt'),
    names.join(', ')
  )

  const nested = await call(`/shares/${shareId}/list?path=nested`, { token, identity })
  const nestedEntries = JSON.parse(nested.body.toString()).entries
  check('descends into subfolders', nestedEntries[0]?.name === 'inner.bin')
  check('reports file size', nestedEntries[0]?.size === 4096, nestedEntries[0]?.size)

  // --- Streaming ---

  const file = await call(`/shares/${shareId}/file?path=hello.txt`, { token, identity })
  check('streams a file', file.body.toString() === 'Hello from airbridge!', file.body.toString())
  check('advertises range support', file.headers['accept-ranges'] === 'bytes')

  const ranged = await call(`/shares/${shareId}/file?path=hello.txt`, {
    token,
    identity,
    headers: { range: 'bytes=6-9' }
  })
  check('answers a byte range with 206', ranged.status === 206, ranged.status)
  check('returns the right slice', ranged.body.toString() === 'from', ranged.body.toString())
  check(
    'sets content-range',
    ranged.headers['content-range'] === 'bytes 6-9/21',
    ranged.headers['content-range']
  )

  const suffix = await call(`/shares/${shareId}/file?path=hello.txt`, {
    token,
    identity,
    headers: { range: 'bytes=-9' }
  })
  // `bytes=-9` is the last nine bytes of the 21-byte file, not the last nine characters of
  // any particular word.
  check('handles a suffix range', suffix.body.toString() === 'irbridge!', suffix.body.toString())

  const unsatisfiable = await call(`/shares/${shareId}/file?path=hello.txt`, {
    token,
    identity,
    headers: { range: 'bytes=999-' }
  })
  check(
    'ignores an out-of-bounds range rather than erroring',
    unsatisfiable.status === 200,
    unsatisfiable.status
  )

  // --- Containment ---

  const escapes = ['../../etc/passwd', 'nested/../..', '../']

  if (process.platform === 'win32') {
    // A bare `X:` is a drive-relative root: path.resolve jumps to that drive's own working
    // directory and abandons the share entirely. Only a *different* drive letter does that —
    // one matching the share's own drive keeps the accumulated path, so it stays contained.
    const otherDrive = fixture.toUpperCase().startsWith('Z:') ? 'Y:' : 'Z:'
    escapes.push(`${otherDrive}/secret.txt`)
  }

  for (const attempt of escapes) {
    const traversal = await call(`/shares/${shareId}/list?path=${encodeURIComponent(attempt)}`, {
      token,
      identity
    })
    check(`refuses traversal via ${attempt}`, traversal.status === 403, traversal.status)
  }

  // A leading slash is share-relative, not filesystem-absolute.
  const rooted = await call(`/shares/${shareId}/file?path=${encodeURIComponent('/hello.txt')}`, {
    token,
    identity
  })
  check(
    'treats a leading slash as relative to the share',
    rooted.status === 200 && rooted.body.toString() === 'Hello from airbridge!',
    rooted.status
  )

  // An escaped separator is one odd filename, not a traversal — it must miss, not leak.
  const encodedSeparator = await call(
    `/shares/${shareId}/file?path=${encodeURIComponent('..%2F..%2Fsecret.txt')}`,
    { token, identity }
  )
  check(
    'does not decode an escaped separator into a traversal',
    encodedSeparator.status === 404 && !encodedSeparator.body.includes('do not share me'),
    encodedSeparator.status
  )

  const oddName = await call(`/shares/${shareId}/file?path=${encodeURIComponent('..notes.txt')}`, {
    token,
    identity
  })
  check(
    'serves a file whose name begins with dots',
    oddName.status === 200 && oddName.body.toString() === 'legitimate',
    oddName.status
  )

  if (symlinkCreated) {
    const escaped = await call(`/shares/${shareId}/list?path=escape`, { token, identity })
    check('refuses to follow a symlink out of the share', escaped.status === 403, escaped.status)
  }

  // --- Missing things ---

  const missingShare = await call('/shares/does-not-exist/list', { token, identity })
  check('404s an unknown share', missingShare.status === 404, missingShare.status)

  const missingFile = await call(`/shares/${shareId}/file?path=nope.txt`, { token, identity })
  check('404s a missing file', missingFile.status === 404, missingFile.status)

  const directoryAsFile = await call(`/shares/${shareId}/file?path=nested`, { token, identity })
  check('refuses to stream a directory', directoryAsFile.status === 404, directoryAsFile.status)

  // --- Writing ---

  const readOnlyUpload = await call(`/shares/${shareId}/file?path=intruder.txt`, {
    token,
    identity,
    method: 'PUT',
    raw: Buffer.from('should not land')
  })
  check('refuses to upload into a read-only share', readOnlyUpload.status === 403, readOnlyUpload.status)
  check(
    'and writes nothing when it refuses',
    !existsSync(join(fixture, 'intruder.txt'))
  )

  const readOnlyDelete = await call(`/shares/${shareId}/file?path=hello.txt`, {
    token,
    identity,
    method: 'DELETE'
  })
  check('refuses to delete from a read-only share', readOnlyDelete.status === 403, readOnlyDelete.status)
  check('and leaves the file alone', existsSync(join(fixture, 'hello.txt')))

  const payload = Buffer.alloc(200_000, 9)
  const upload = await call(`/shares/${writableShareId}/file?path=uploaded.bin`, {
    token,
    identity,
    method: 'PUT',
    raw: payload
  })
  check('accepts an upload into a writable share', upload.status === 201, upload.status)
  check(
    'writes the exact bytes',
    existsSync(join(dropbox, 'uploaded.bin')) &&
      readFileSync(join(dropbox, 'uploaded.bin')).equals(payload)
  )
  check(
    'leaves no partial file behind',
    !existsSync(join(dropbox, `uploaded.bin.airbridge-part`))
  )

  const nestedUpload = await call(
    `/shares/${writableShareId}/file?path=${encodeURIComponent('a/b/deep.txt')}`,
    { token, identity, method: 'PUT', raw: Buffer.from('nested') }
  )
  check('creates missing folders on the way in', nestedUpload.status === 201, nestedUpload.status)
  check('and puts the file where it was asked', existsSync(join(dropbox, 'a', 'b', 'deep.txt')))

  const escapingUpload = await call(
    `/shares/${writableShareId}/file?path=${encodeURIComponent('../escaped.txt')}`,
    { token, identity, method: 'PUT', raw: Buffer.from('nope') }
  )
  check('refuses an upload that escapes the share', escapingUpload.status === 403, escapingUpload.status)

  const deleteRoot = await call(`/shares/${writableShareId}/file`, {
    token,
    identity,
    method: 'DELETE'
  })
  check('refuses to delete the share itself', deleteRoot.status === 403, deleteRoot.status)
  check('and the folder is still there', existsSync(dropbox))

  const deleteMissing = await call(`/shares/${writableShareId}/file?path=ghost.txt`, {
    token,
    identity,
    method: 'DELETE'
  })
  check('404s deleting something absent', deleteMissing.status === 404, deleteMissing.status)

  const remove = await call(`/shares/${writableShareId}/file?path=uploaded.bin`, {
    token,
    identity,
    method: 'DELETE'
  })
  check('deletes a file', remove.status === 204, remove.status)
  check('and it is gone', !existsSync(join(dropbox, 'uploaded.bin')))
} finally {
  child.kill()
  await once(child, 'exit').catch(() => {})
  for (const directory of [fixture, outside, dataDirectory, dropbox]) {
    rmSync(directory, { recursive: true, force: true })
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
