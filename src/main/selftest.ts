import { app } from 'electron'

import { pairWith, resolvePeer } from './devices'
import { downloadFile, listPeerDirectory, listPeerShares } from './peer'

/**
 * Drive a complete client-side round trip against another instance and report the result on
 * stdout.
 *
 * The server side is covered by `scripts/smoke.mjs`, which speaks HTTP directly. This exists
 * because the *client* half — pairing, certificate pinning, token exchange, resolving a
 * device id to an address, streaming a file to disk — only runs inside the main process, and
 * a test harness has no way in. Two real instances talking to each other is the honest test.
 *
 * Dev builds only, and only when handed a target.
 */
export async function runSelfTest(target: string): Promise<void> {
  const [host, portText] = target.split(':')
  const port = Number(portText)

  try {
    const device = await withRetries(() => pairWith(host, port))

    const { shares } = await listPeerShares(resolvePeer(device.deviceId))
    const share = shares[0]
    if (!share) throw new Error('Peer published no shares')

    const entries = await listPeerDirectory(resolvePeer(device.deviceId), share.id, '')
    const file = entries.find((entry) => entry.kind === 'file')
    if (!file) throw new Error('Peer share contained no files')

    const nested = await listPeerDirectory(resolvePeer(device.deviceId), share.id, 'nested')

    const downloaded = await downloadFile(
      resolvePeer(device.deviceId),
      share.id,
      file.name,
      app.getPath('userData')
    )

    report('SELFTEST_OK', {
      pairedWith: device.deviceName,
      deviceId: device.deviceId,
      shareCount: shares.length,
      shareName: share.name,
      entryCount: entries.length,
      nestedCount: nested.length,
      downloadedName: file.name,
      downloadedBytes: downloaded.bytes,
      downloadedTo: downloaded.path
    })
  } catch (cause) {
    report('SELFTEST_FAIL', { error: cause instanceof Error ? cause.message : String(cause) })
  }
}

/** The peer may still be binding its port when we start, so connection refusals are retried
 *  while anything else fails immediately — a wrong answer is not worth waiting out. */
async function withRetries<T>(work: () => Promise<T>, attempts = 40): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work()
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code
      const retryable = code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT'
      if (!retryable || attempt >= attempts) throw cause
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

function report(status: string, detail: Record<string, unknown>): void {
  process.stdout.write(`${status} ${JSON.stringify(detail)}\n`)
}
