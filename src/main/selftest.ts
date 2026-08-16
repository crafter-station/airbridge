import { app } from 'electron'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { DirEntry, TransferJob } from '@shared/types'
import { pairWith, resolvePeer } from './devices'
import { downloadFile, listPeerDirectory, listPeerShares, PART_SUFFIX } from './peer'
import { listJobs, startCopy } from './transfers'

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

    const resumed = await verifyResume(device.deviceId, share.id, file.name, downloaded)

    const destination = join(app.getPath('userData'), 'copied')
    const copied = await copyWholeShare(device.deviceId, share.id, share.name, entries, destination)
    // The same copy again, into the same folder: every file now collides.
    const recopied = await copyWholeShare(
      device.deviceId,
      share.id,
      share.name,
      entries,
      destination
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
      downloadedTo: downloaded.path,
      resumed,
      copied,
      recopied,
      afterRecopy: (await readdir(destination)).sort()
    })
  } catch (cause) {
    report('SELFTEST_FAIL', { error: cause instanceof Error ? cause.message : String(cause) })
  }
}

/**
 * Prove that an interrupted transfer picks up where it stopped rather than starting over.
 *
 * Fakes the interruption by planting a truncated `.part` file, then asking for the same file
 * with resume on. If the append path is wrong the result is corrupt rather than merely slow,
 * which is exactly the kind of bug that hides until someone's wifi drops mid-copy.
 */
async function verifyResume(
  deviceId: string,
  shareId: string,
  fileName: string,
  original: { path: string; bytes: number }
): Promise<{ requested: number; finalBytes: number; identical: boolean }> {
  const directory = join(app.getPath('userData'), 'resume-check')
  await mkdir(directory, { recursive: true })

  const head = Math.floor(original.bytes / 3)
  const expected = await readFile(original.path)

  await writeFile(join(directory, `${fileName}${PART_SUFFIX}`), expected.subarray(0, head))

  const result = await downloadFile(resolvePeer(deviceId), shareId, fileName, directory, {
    resume: true
  })

  const actual = await readFile(result.path)
  return { requested: head, finalBytes: result.bytes, identical: actual.equals(expected) }
}

/** Copy the entire share through the real transfer engine and count what landed. */
async function copyWholeShare(
  deviceId: string,
  shareId: string,
  shareName: string,
  entries: DirEntry[],
  destination: string
): Promise<{ status: string; files: number; bytes: number; destination: string }> {
  await mkdir(destination, { recursive: true })

  const job = startCopy({
    peer: resolvePeer(deviceId),
    deviceId,
    deviceName: 'selftest',
    shareId,
    shareName,
    items: entries.map((entry) => ({
      name: entry.name,
      kind: entry.kind,
      path: entry.name,
      size: entry.size
    })),
    destination
  })

  const finished = await waitForJob(job.id)

  return {
    status: finished.status,
    files: finished.completedFiles,
    bytes: finished.transferredBytes,
    destination
  }
}

async function waitForJob(id: string, timeoutMs = 60_000): Promise<TransferJob> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    const job = listJobs().find((candidate) => candidate.id === id)
    if (!job) throw new Error('Transfer job vanished')
    if (job.status !== 'scanning' && job.status !== 'transferring') return job
    if (Date.now() > deadline) throw new Error('Transfer job did not finish in time')
    await new Promise((resolve) => setTimeout(resolve, 100))
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
