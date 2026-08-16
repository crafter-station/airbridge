import { useCallback, useEffect, useState } from 'react'

import type {
  DirEntry,
  KnownDevice,
  PublicShare,
  ServerStatus,
  Share,
  TransferJob
} from '@shared/types'

/**
 * M3 development console.
 *
 * Deliberately plain: its job is to exercise publish → discover → pair → browse → copy end
 * to end so the transport can be trusted before the Finder shell is built on top of it in
 * M4, which replaces this file wholesale.
 */
export function App(): React.JSX.Element {
  return (
    <div className="grid h-full grid-cols-2 divide-x divide-(--color-chrome-border)">
      <LocalPanel />
      <RemotePanel />
    </div>
  )
}

function LocalPanel(): React.JSX.Element {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [shares, setShares] = useState<Share[]>([])
  const [deviceName, setDeviceName] = useState('')

  useEffect(() => {
    void window.airbridge.serverStatus().then(setStatus)
    void window.airbridge.shares.list().then(setShares)
    void window.airbridge.getAppInfo().then((info) => setDeviceName(info.deviceName))
    return window.airbridge.shares.onChanged(setShares)
  }, [])

  return (
    <section className="flex flex-col gap-5 overflow-y-auto p-6">
      <header>
        <h2 className="text-base font-semibold">This device</h2>
        <p className="text-(--color-ink-muted)">{deviceName}</p>
      </header>

      {status && (
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          <Field label="Port">{status.port ?? 'not listening'}</Field>
          <Field label="Addresses">
            {status.addresses.length === 0 ? (
              <span className="text-(--color-ink-muted)">no LAN address found</span>
            ) : (
              status.addresses.map((entry) => (
                <div key={entry.address}>
                  <span className="select-text font-mono">{entry.address}</span>{' '}
                  <span className="text-(--color-ink-muted)">{entry.name}</span>
                </div>
              ))
            )}
          </Field>
          <Field label="Fingerprint">
            <span className="select-text font-mono text-[10px] break-all">
              {status.fingerprint}
            </span>
          </Field>
        </dl>
      )}

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Shared folders</h3>
        <Button onClick={() => void window.airbridge.shares.add()}>Add folder…</Button>
      </div>

      {shares.length === 0 && <p className="text-(--color-ink-muted)">Nothing shared yet.</p>}

      <ul className="flex flex-col gap-1.5">
        {shares.map((share) => (
          <li
            key={share.id}
            className="flex items-center gap-3 rounded-md border border-(--color-chrome-border) bg-white px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{share.name}</div>
              <div className="truncate text-xs text-(--color-ink-muted)">{share.path}</div>
            </div>

            {!share.available && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                Unavailable
              </span>
            )}

            <label className="flex items-center gap-1.5 text-xs text-(--color-ink-muted)">
              <input
                type="checkbox"
                checked={share.writable}
                onChange={(event) =>
                  void window.airbridge.shares.setWritable(share.id, event.target.checked)
                }
              />
              Writable
            </label>

            <Button onClick={() => void window.airbridge.shares.remove(share.id)}>Remove</Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RemotePanel(): React.JSX.Element {
  const [devices, setDevices] = useState<KnownDevice[]>([])
  const [manual, setManual] = useState({ host: '', port: '45789' })
  const [openDevice, setOpenDevice] = useState<KnownDevice | null>(null)
  const [shares, setShares] = useState<PublicShare[]>([])
  const [openShare, setOpenShare] = useState<PublicShare | null>(null)
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.airbridge.devices.list().then(setDevices)
    return window.airbridge.devices.onChanged(setDevices)
  }, [])

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await work()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  const pair = (host: string, port: number): Promise<void> =>
    run(async () => {
      setMessage(`Waiting for ${host} to approve…`)
      const device = await window.airbridge.devices.pair(host, port)
      setMessage(`Paired with ${device.deviceName}`)
      setDevices(await window.airbridge.devices.list())
    })

  const open = (device: KnownDevice): Promise<void> =>
    run(async () => {
      const result = await window.airbridge.peer.shares(device.deviceId)
      setOpenDevice(device)
      setShares(result.shares)
      setOpenShare(null)
      setEntries([])
    })

  const browse = (share: PublicShare, nextPath: string): Promise<void> =>
    run(async () => {
      if (!openDevice) return
      setEntries(await window.airbridge.peer.list(openDevice.deviceId, share.id, nextPath))
      setOpenShare(share)
      setPath(nextPath)
    })

  const copy = (entries: DirEntry[]): Promise<void> =>
    run(async () => {
      if (!openDevice || !openShare) return
      const job = await window.airbridge.transfers.copy(
        openDevice.deviceId,
        openShare.id,
        openShare.name,
        entries.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          path: joinPath(path, entry.name),
          size: entry.size
        }))
      )
      setSelected(new Set())
      if (job) setMessage(`Copying to ${job.destination}`)
    })

  return (
    <section className="flex flex-col gap-4 overflow-y-auto p-6">
      <h2 className="text-base font-semibold">Devices</h2>

      {devices.length === 0 && (
        <p className="text-(--color-ink-muted)">
          Nothing found yet. If the other machine is running airbridge, connect by address
          below.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {devices.map((device) => (
          <li
            key={device.deviceId}
            className="flex items-center gap-2 rounded-md border border-(--color-chrome-border) bg-white px-3 py-2"
          >
            <span
              aria-hidden
              className={`h-2 w-2 rounded-full ${device.online ? 'bg-green-500' : 'bg-gray-300'}`}
            />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{device.deviceName}</div>
              <div className="truncate text-xs text-(--color-ink-muted)">
                {device.host ? `${device.host}:${device.port}` : 'address unknown'}
              </div>
            </div>

            {device.paired ? (
              <>
                <Button onClick={() => void open(device)} disabled={busy || !device.host}>
                  Browse
                </Button>
                <Button onClick={() => void window.airbridge.devices.unpair(device.deviceId)}>
                  Unpair
                </Button>
              </>
            ) : (
              <Button
                onClick={() => void pair(device.host ?? '', device.port ?? 0)}
                disabled={busy || !device.host}
              >
                Pair
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-end gap-2 border-t border-(--color-chrome-border) pt-4">
        <Input
          label="Connect by address"
          value={manual.host}
          onChange={(host) => setManual({ ...manual, host })}
          className="w-36"
        />
        <Input
          label="Port"
          value={manual.port}
          onChange={(port) => setManual({ ...manual, port })}
          className="w-20"
        />
        <Button
          onClick={() => void pair(manual.host.trim(), Number(manual.port))}
          disabled={busy || manual.host.trim() === ''}
        >
          Pair
        </Button>
      </div>

      {message && (
        <p className="rounded-md bg-(--color-sidebar) px-3 py-2 text-xs select-text">{message}</p>
      )}

      {shares.length > 0 && (
        <nav className="flex flex-wrap gap-1.5">
          {shares.map((share) => (
            <Button key={share.id} onClick={() => void browse(share, '')} disabled={!share.available}>
              {share.name}
            </Button>
          ))}
        </nav>
      )}

      {openShare && (
        <>
          <div className="flex items-center justify-between">
            <Breadcrumb
              share={openShare}
              path={path}
              onNavigate={(next) => void browse(openShare, next)}
            />
            <Button
              onClick={() => void copy(entries.filter((entry) => selected.has(entry.name)))}
              disabled={busy || selected.size === 0}
            >
              Copy {selected.size > 0 ? `${selected.size} ` : ''}to…
            </Button>
          </div>

          <ul className="flex flex-col">
            {entries.map((entry) => (
              <li key={entry.name} className="flex items-center gap-2 px-2 py-1 hover:bg-(--color-sidebar)">
                <input
                  type="checkbox"
                  checked={selected.has(entry.name)}
                  onChange={(event) => {
                    const next = new Set(selected)
                    if (event.target.checked) next.add(entry.name)
                    else next.delete(entry.name)
                    setSelected(next)
                  }}
                />
                <button
                  type="button"
                  disabled={busy || entry.kind !== 'directory'}
                  className="flex flex-1 items-center gap-2 text-left disabled:cursor-default"
                  onClick={() => void browse(openShare, joinPath(path, entry.name))}
                >
                  <span className="w-4 text-(--color-ink-muted)">
                    {entry.kind === 'directory' ? '▸' : '·'}
                  </span>
                  <span className="flex-1 truncate">{entry.name}</span>
                  {entry.kind === 'file' && (
                    <span className="text-xs text-(--color-ink-muted)">
                      {formatBytes(entry.size)}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {entries.length === 0 && (
              <li className="px-2 py-1 text-(--color-ink-muted)">Empty folder.</li>
            )}
          </ul>
        </>
      )}

      <Transfers />
    </section>
  )
}

function Transfers(): React.JSX.Element | null {
  const [jobs, setJobs] = useState<TransferJob[]>([])

  useEffect(() => {
    void window.airbridge.transfers.list().then(setJobs)
    return window.airbridge.transfers.onChanged(setJobs)
  }, [])

  if (jobs.length === 0) return null

  return (
    <section className="flex flex-col gap-2 border-t border-(--color-chrome-border) pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Transfers</h3>
        <Button onClick={() => void window.airbridge.transfers.clear()}>Clear finished</Button>
      </div>

      <ul className="flex flex-col gap-2">
        {jobs.map((job) => {
          const fraction = job.totalBytes > 0 ? job.transferredBytes / job.totalBytes : 0
          const running = job.status === 'scanning' || job.status === 'transferring'

          return (
            <li
              key={job.id}
              className="flex flex-col gap-1 rounded-md border border-(--color-chrome-border) bg-white px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">
                  {job.shareName} → {job.destination}
                </span>
                {running ? (
                  <Button onClick={() => void window.airbridge.transfers.cancel(job.id)}>
                    Cancel
                  </Button>
                ) : (
                  <Button onClick={() => void window.airbridge.transfers.reveal(job.destination)}>
                    Reveal
                  </Button>
                )}
              </div>

              <div className="h-1 overflow-hidden rounded-full bg-(--color-sidebar)">
                <div
                  className="h-full bg-(--color-accent) transition-[width] duration-200"
                  style={{ width: `${Math.round(fraction * 100)}%` }}
                />
              </div>

              <div className="flex justify-between text-xs text-(--color-ink-muted)">
                <span className="truncate">
                  {job.status === 'scanning' && 'Scanning…'}
                  {job.status === 'transferring' && (job.currentFile ?? 'Copying…')}
                  {job.status === 'done' &&
                    `Copied ${job.completedFiles} ${job.completedFiles === 1 ? 'file' : 'files'}` +
                      (job.skippedFiles > 0 ? `, skipped ${job.skippedFiles}` : '')}
                  {job.status === 'cancelled' && 'Cancelled'}
                  {job.status === 'failed' && job.error}
                </span>
                <span className="shrink-0">
                  {formatBytes(job.transferredBytes)}
                  {job.totalBytes > 0 && ` / ${formatBytes(job.totalBytes)}`}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function Breadcrumb({
  share,
  path,
  onNavigate
}: {
  share: PublicShare
  path: string
  onNavigate: (path: string) => void
}): React.JSX.Element {
  const segments = path.split('/').filter(Boolean)

  return (
    <div className="flex flex-wrap items-center gap-1 text-xs text-(--color-ink-muted)">
      <button type="button" className="hover:underline" onClick={() => onNavigate('')}>
        {share.name}
      </button>
      {segments.map((segment, index) => (
        <span key={`${segment}-${index}`} className="flex items-center gap-1">
          <span>/</span>
          <button
            type="button"
            className="hover:underline"
            onClick={() => onNavigate(segments.slice(0, index + 1).join('/'))}
          >
            {segment}
          </button>
        </span>
      ))}
    </div>
  )
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <dt className="text-(--color-ink-muted)">{label}</dt>
      <dd className="m-0 min-w-0">{children}</dd>
    </>
  )
}

function Button({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-(--color-chrome-border) bg-white px-2.5 py-1 text-xs hover:bg-(--color-sidebar) disabled:opacity-40"
    >
      {children}
    </button>
  )
}

function Input({
  label,
  value,
  onChange,
  className
}: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs text-(--color-ink-muted)">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`select-text rounded-md border border-(--color-chrome-border) bg-white px-2 py-1 text-(--color-ink) ${className ?? ''}`}
      />
    </label>
  )
}

function joinPath(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}
