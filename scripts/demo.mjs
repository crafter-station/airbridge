/**
 * Two pre-paired instances with a fixture share, for looking at the UI.
 *
 * Pairing needs a person to click Allow, and both instances need to exist before either
 * knows the other's certificate — so this runs them once to mint their identities, then
 * writes each into the other's trust store and starts them for real.
 *
 *   pnpm build && pnpm demo [folder-to-share]
 *
 * Leave it running; Ctrl-C stops both.
 */
import electronPath from 'electron'
import { spawn } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_PORT = 45789
const GUEST_PORT = 45790

const hostData = mkdtempSync(join(tmpdir(), 'airbridge-demo-host-'))
const guestData = mkdtempSync(join(tmpdir(), 'airbridge-demo-guest-'))

// Share whatever the caller pointed at, or build a small fixture worth looking at.
const shared = process.argv[2] ? resolve(process.argv[2]) : makeFixture()

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'airbridge-demo-files-'))

  mkdirSync(join(root, 'Screenshots'))
  mkdirSync(join(root, 'Notes'))
  mkdirSync(join(root, 'Notes', 'Drafts'))

  const files = [
    ['Quarterly report.pdf', 2_400_000],
    ['budget.csv', 18_400],
    ['logo.svg', 4_200],
    ['demo recording.mp4', 148_000_000],
    ['Screenshots/window.png', 890_000],
    ['Screenshots/sidebar.png', 640_000],
    ['Notes/meeting.md', 3_100],
    ['Notes/Drafts/proposal.md', 9_800]
  ]

  for (const [name, size] of files) {
    writeFileSync(join(root, name), Buffer.alloc(size, 1))
  }

  return root
}

function launch(name, dataDirectory, extraEnv = {}, headless = false, debugPort = null) {
  // A debugging port lets scripts/uishot.mjs drive the renderer and take clean screenshots.
  const args = debugPort ? ['.', `--remote-debugging-port=${debugPort}`] : ['.']

  const child = spawn(electronPath, args, {
    cwd: PROJECT,
    env: {
      ...process.env,
      AIRBRIDGE_ALLOW_MULTI: '1',
      AIRBRIDGE_BIND: '127.0.0.1',
      AIRBRIDGE_NO_DISCOVERY: '1',
      AIRBRIDGE_DATA_DIR: dataDirectory,
      ...(headless ? { AIRBRIDGE_HEADLESS: '1' } : {}),
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'inherit']
  })

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split('\n').filter(Boolean)) console.log(`[${name}] ${line}`)
  })

  return child
}

function read(directory, file) {
  return JSON.parse(readFileSync(join(directory, file), 'utf8'))
}

function trustEntry(theirData, theirPort, token) {
  const identity = read(theirData, 'identity.json')
  const fingerprint = new X509Certificate(read(theirData, 'tls.json').cert).fingerprint256

  return {
    deviceId: identity.deviceId,
    deviceName: identity.deviceName,
    fingerprint,
    inboundToken: token,
    outboundToken: token,
    lastHost: '127.0.0.1',
    lastPort: theirPort,
    pairedAt: Date.now()
  }
}

console.log('minting identities…')
const warmup = [launch('warm-host', hostData, {}, true), launch('warm-guest', guestData, {}, true)]

// Wait for the files rather than a fixed delay: cert generation is fast but not instant, and
// a sleep that is usually long enough is a test that usually passes.
await waitForFiles([hostData, guestData], ['identity.json', 'tls.json'])

for (const child of warmup) child.kill()
await Promise.all(warmup.map((child) => once(child, 'exit').catch(() => {})))

async function waitForFiles(directories, files, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const ready = directories.every((directory) =>
      files.every((file) => existsSync(join(directory, file)))
    )
    if (ready) return
    if (Date.now() > deadline) throw new Error('Instances never wrote their identity files')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// One shared secret in both directions keeps the seeding simple; a real pairing mints two.
const token = 'demo-token-both-directions'

writeFileSync(
  join(hostData, 'trust.json'),
  JSON.stringify([trustEntry(guestData, GUEST_PORT, token)], null, 2)
)
writeFileSync(
  join(guestData, 'trust.json'),
  JSON.stringify([trustEntry(hostData, HOST_PORT, token)], null, 2)
)

writeFileSync(
  join(hostData, 'shares.json'),
  JSON.stringify([{ id: 'demo-share', name: 'Work', path: shared, writable: true }], null, 2)
)

const guestOwn = mkdtempSync(join(tmpdir(), 'airbridge-demo-guest-files-'))
writeFileSync(
  join(guestData, 'shares.json'),
  JSON.stringify([{ id: 'guest-share', name: 'Inbox', path: guestOwn, writable: false }], null, 2)
)

console.log(`\nsharing  ${shared}`)
console.log(`host     ${hostData}`)
console.log(`guest    ${guestData}\n`)

const host = launch('host', hostData, {}, false, 9333)
await new Promise((resolve) => setTimeout(resolve, 2500))
const guest = launch('guest', guestData, {}, false, 9334)

console.log('debug ports: host 9333, guest 9334 — see scripts/uishot.mjs\n')

const stop = () => {
  host.kill()
  guest.kill()
  process.exit(0)
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)

await Promise.race([once(host, 'exit'), once(guest, 'exit')])
stop()
