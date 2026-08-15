/**
 * End-to-end check of the sharing server against a real, running instance.
 *
 * Everything here talks over the wire rather than importing the app's modules, because the
 * HTTP contract is what a peer actually depends on — including the parts that only exist at
 * runtime, like the TLS handshake and the port fallback.
 *
 *   pnpm build && pnpm smoke
 */
import electronPath from 'electron'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 45789

function userDataDirectory() {
  if (process.platform === 'win32') return join(process.env.APPDATA, 'airbridge')
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'airbridge')
  }
  return join(homedir(), '.config', 'airbridge')
}

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

/** A raw HTTPS call that trusts the self-signed certificate but reports its fingerprint,
 *  mirroring what `src/main/peer.ts` does. */
function call(path, { token, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        rejectUnauthorized: false,
        agent: false,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }
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
    req.on('socket', (socket) =>
      socket.once('secureConnect', () => {
        req.fingerprint = socket.getPeerX509Certificate()?.fingerprint256
      })
    )
    req.on('error', reject)
    req.end()
  })
}

async function waitForServer(child, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (child.exitCode !== null) throw new Error(`App exited early with code ${child.exitCode}`)
    try {
      await call('/shares')
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

const shareId = '00000000-0000-4000-8000-00000000cafe'
mkdirSync(userDataDirectory(), { recursive: true })
writeFileSync(
  join(userDataDirectory(), 'shares.json'),
  JSON.stringify([{ id: shareId, name: 'Smoke', path: fixture, writable: false }], null, 2)
)

// --- Run -------------------------------------------------------------------------------

console.log(`fixture ${fixture}`)

const child = spawn(electronPath, ['.'], {
  cwd: PROJECT,
  env: { ...process.env, AIRBRIDGE_HEADLESS: '1', AIRBRIDGE_ALLOW_MULTI: '1' },
  stdio: 'inherit'
})

try {
  await waitForServer(child)

  const token = JSON.parse(await readFile(join(userDataDirectory(), 'auth.json'), 'utf8')).token

  const unauthorised = await call('/shares')
  check('rejects a request with no token', unauthorised.status === 401, unauthorised.status)

  const wrongToken = await call('/shares', { token: 'nope' })
  check('rejects a wrong token', wrongToken.status === 401, wrongToken.status)

  const shares = await call('/shares', { token })
  const shareList = JSON.parse(shares.body.toString()).shares
  check('lists the share', shareList.some((share) => share.id === shareId))
  check(
    'never sends the folder path to peers',
    shareList.every((share) => share.path === undefined)
  )

  const listing = await call(`/shares/${shareId}/list`, { token })
  const entries = JSON.parse(listing.body.toString()).entries
  const names = entries.map((entry) => entry.name)
  check('lists directory contents', names.includes('hello.txt') && names.includes('nested'))
  check('sorts folders before files', entries[0].kind === 'directory', names.join(', '))
  check(
    'sorts names naturally, not lexically',
    names.indexOf('file9.txt') < names.indexOf('file10.txt'),
    names.join(', ')
  )

  const nested = await call(`/shares/${shareId}/list?path=nested`, { token })
  const nestedEntries = JSON.parse(nested.body.toString()).entries
  check('descends into subfolders', nestedEntries[0]?.name === 'inner.bin')
  check('reports file size', nestedEntries[0]?.size === 4096, nestedEntries[0]?.size)

  const file = await call(`/shares/${shareId}/file?path=hello.txt`, { token })
  check('streams a file', file.body.toString() === 'Hello from airbridge!', file.body.toString())
  check('advertises range support', file.headers['accept-ranges'] === 'bytes')

  const ranged = await call(`/shares/${shareId}/file?path=hello.txt`, {
    token,
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
    headers: { range: 'bytes=-9' }
  })
  // `bytes=-9` is the last nine bytes of the 21-byte file, not the last nine characters of
  // any particular word.
  check('handles a suffix range', suffix.body.toString() === 'irbridge!', suffix.body.toString())

  const unsatisfiable = await call(`/shares/${shareId}/file?path=hello.txt`, {
    token,
    headers: { range: 'bytes=999-' }
  })
  check(
    'ignores an out-of-bounds range rather than erroring',
    unsatisfiable.status === 200,
    unsatisfiable.status
  )

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
      token
    })
    check(`refuses traversal via ${attempt}`, traversal.status === 403, traversal.status)
  }

  // A leading slash is share-relative, not filesystem-absolute.
  const rooted = await call(`/shares/${shareId}/file?path=${encodeURIComponent('/hello.txt')}`, {
    token
  })
  check(
    'treats a leading slash as relative to the share',
    rooted.status === 200 && rooted.body.toString() === 'Hello from airbridge!',
    rooted.status
  )

  // An escaped separator is one odd filename, not a traversal — it must miss, not leak.
  const encodedSeparator = await call(
    `/shares/${shareId}/file?path=${encodeURIComponent('..%2F..%2Fsecret.txt')}`,
    { token }
  )
  check(
    'does not decode an escaped separator into a traversal',
    encodedSeparator.status === 404 && !encodedSeparator.body.includes('do not share me'),
    encodedSeparator.status
  )

  const oddName = await call(`/shares/${shareId}/file?path=${encodeURIComponent('..notes.txt')}`, {
    token
  })
  check(
    'serves a file whose name begins with dots',
    oddName.status === 200 && oddName.body.toString() === 'legitimate',
    oddName.status
  )

  if (symlinkCreated) {
    const escaped = await call(`/shares/${shareId}/list?path=escape`, { token })
    check('refuses to follow a symlink out of the share', escaped.status === 403, escaped.status)
  }

  const missingShare = await call('/shares/does-not-exist/list', { token })
  check('404s an unknown share', missingShare.status === 404, missingShare.status)

  const missingFile = await call(`/shares/${shareId}/file?path=nope.txt`, { token })
  check('404s a missing file', missingFile.status === 404, missingFile.status)

  const directoryAsFile = await call(`/shares/${shareId}/file?path=nested`, { token })
  check('refuses to stream a directory', directoryAsFile.status === 404, directoryAsFile.status)
} finally {
  child.kill()
  await once(child, 'exit').catch(() => {})
  rmSync(fixture, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
