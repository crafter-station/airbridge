/**
 * Two real instances, on one machine, talking to each other.
 *
 * `smoke.mjs` covers the server by speaking HTTP at it. This covers the half that only ever
 * runs inside the main process — pairing, certificate pinning, token exchange, resolving a
 * device id to an address, streaming a file to disk — by starting a second instance and
 * having it perform the whole round trip for real.
 *
 * Each instance gets its own userData directory, so they are genuinely different devices
 * rather than one app looking at itself. The second one also proves the port fallback works,
 * since the first has already taken 45789.
 *
 *   pnpm build && pnpm loopback
 */
import electronPath from 'electron'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

const hostData = mkdtempSync(join(tmpdir(), 'airbridge-host-'))
const guestData = mkdtempSync(join(tmpdir(), 'airbridge-guest-'))
const fixture = mkdtempSync(join(tmpdir(), 'airbridge-loop-'))

// Keyed by name, because the self test copies whichever file sorts first and the point is to
// check the bytes that landed, not to guess which one it picked.
const FILES = {
  'aaa-first.txt': 'the quick brown fox jumps over the lazy dog',
  'second.txt': 'another'
}

for (const [name, content] of Object.entries(FILES)) {
  writeFileSync(join(fixture, name), content)
}
mkdirSync(join(fixture, 'nested'))
writeFileSync(join(fixture, 'nested', 'deep.bin'), Buffer.alloc(2048, 3))

writeFileSync(
  join(hostData, 'shares.json'),
  JSON.stringify(
    [{ id: 'loopback-share', name: 'Loopback', path: fixture, writable: false }],
    null,
    2
  )
)

function launch(name, dataDirectory, extraEnv) {
  const child = spawn(electronPath, ['.'], {
    cwd: PROJECT,
    env: {
      ...process.env,
      AIRBRIDGE_HEADLESS: '1',
      AIRBRIDGE_ALLOW_MULTI: '1',
      AIRBRIDGE_DATA_DIR: dataDirectory,
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'inherit']
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split('\n').filter(Boolean)) console.log(`  [${name}] ${line}`)
  })

  return child
}

/** Resolve with the parsed detail of the first SELFTEST_ line the guest prints. */
function selfTestResult(child, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    let buffered = ''

    const timer = setTimeout(() => reject(new Error('Timed out waiting for the self test')), timeoutMs)

    const finish = (value) => {
      clearTimeout(timer)
      resolve(value)
    }

    child.stdout.on('data', (chunk) => {
      buffered += chunk
      for (const line of buffered.split('\n')) {
        const match = /^(SELFTEST_OK|SELFTEST_FAIL) (.*)$/.exec(line.trim())
        if (match) finish({ status: match[1], detail: JSON.parse(match[2]) })
      }
    })

    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Guest exited (${code}) without reporting`))
    })
  })
}

// Auto-approve belongs on the *host*: it is the machine being asked to allow the connection,
// and without it the pairing request blocks on a dialog nobody can see.
const host = launch('host', hostData, { AIRBRIDGE_AUTO_APPROVE: '1' })
let guest

try {
  // Give the host time to bind 45789 so the guest lands on 45790 and exercises the fallback.
  await new Promise((resolve) => setTimeout(resolve, 3000))

  guest = launch('guest', guestData, {
    AIRBRIDGE_SELFTEST_TARGET: '127.0.0.1:45789',
    AIRBRIDGE_COLLISION_POLICY: 'keep-both'
  })

  const { status, detail } = await selfTestResult(guest)

  check('the guest completed a full round trip', status === 'SELFTEST_OK', detail.error)

  if (status === 'SELFTEST_OK') {
    check('paired with a distinct device', Boolean(detail.deviceId), detail.deviceId)
    check('saw the published share', detail.shareName === 'Loopback', detail.shareName)
    check('listed the share root', detail.entryCount === 3, detail.entryCount)
    check('listed a subfolder', detail.nestedCount === 1, detail.nestedCount)

    const expected = FILES[detail.downloadedName]
    check('downloaded one of the shared files', expected !== undefined, detail.downloadedName)
    check(
      'the bytes on disk match the original',
      expected !== undefined && readFileSync(detail.downloadedTo, 'utf8') === expected,
      detail.downloadedTo
    )
    check(
      'committed the file rather than leaving a partial',
      !String(detail.downloadedTo).endsWith('.airbridge-part') &&
        !existsSync(`${detail.downloadedTo}.airbridge-part`),
      detail.downloadedTo
    )

    check(
      'resumed from a partial file instead of restarting',
      detail.resumed?.identical === true && detail.resumed.finalBytes === expected?.length,
      JSON.stringify(detail.resumed)
    )

    check('the whole-share copy finished', detail.copied?.status === 'done', detail.copied?.status)
    check(
      'copied every file in the share',
      detail.copied?.files === Object.keys(FILES).length + 1,
      `${detail.copied?.files} files`
    )
    check(
      'mirrored the folder structure',
      existsSync(join(detail.copied.destination, 'nested', 'deep.bin')),
      detail.copied?.destination
    )
    check(
      'copied nested file contents intact',
      readFileSync(join(detail.copied.destination, 'nested', 'deep.bin')).equals(
        Buffer.alloc(2048, 3)
      )
    )

    // The second copy hit a collision on every file, answered with Keep Both.
    check('the colliding copy finished', detail.recopied?.status === 'done', detail.recopied?.status)
    check(
      'Keep Both numbered the duplicates Finder-style',
      detail.afterRecopy?.includes('aaa-first 2.txt') &&
        detail.afterRecopy?.includes('second 2.txt'),
      JSON.stringify(detail.afterRecopy)
    )
    check(
      'Keep Both put the number before the extension',
      !detail.afterRecopy?.some((name) => name.endsWith('.txt 2')),
      JSON.stringify(detail.afterRecopy)
    )
    check(
      'the originals survived the second copy',
      readFileSync(join(detail.copied.destination, 'aaa-first.txt'), 'utf8') ===
        FILES['aaa-first.txt']
    )
  }
} finally {
  guest?.kill()
  host.kill()
  await Promise.all([
    guest ? once(guest, 'exit').catch(() => {}) : null,
    once(host, 'exit').catch(() => {})
  ])
  for (const directory of [hostData, guestData, fixture]) {
    rmSync(directory, { recursive: true, force: true })
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
