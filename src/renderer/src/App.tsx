import { useCallback, useEffect, useState } from 'react'

import type { DirEntry, PeerAddress, PublicShare, ServerStatus, Share } from '@shared/types'

/**
 * M1 development console.
 *
 * Deliberately plain: its job is to exercise publish → discover → browse → copy end to end
 * so the transport can be trusted before the Finder shell is built on top of it in M4, which
 * replaces this file wholesale.
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
  }, [])

  const addFolder = useCallback(async () => {
    const added = await window.airbridge.shares.add()
    if (added) setShares(await window.airbridge.shares.list())
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
          <Field label="Token">
            <span className="select-text font-mono break-all">{status.token}</span>
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
        <Button onClick={addFolder}>Add folder…</Button>
      </div>

      {shares.length === 0 && (
        <p className="text-(--color-ink-muted)">Nothing shared yet.</p>
      )}

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
                onChange={async (event) =>
                  setShares(
                    await window.airbridge.shares.setWritable(share.id, event.target.checked)
                  )
                }
              />
              Writable
            </label>

            <Button
              onClick={async () => setShares(await window.airbridge.shares.remove(share.id))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RemotePanel(): React.JSX.Element {
  const [form, setForm] = useState({ host: '127.0.0.1', port: '45790', token: '' })
  const [peer, setPeer] = useState<PeerAddress | null>(null)
  const [shares, setShares] = useState<PublicShare[]>([])
  const [fingerprint, setFingerprint] = useState('')
  const [openShare, setOpenShare] = useState<PublicShare | null>(null)
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  const connect = (): Promise<void> =>
    run(async () => {
      const next: PeerAddress = {
        host: form.host.trim(),
        port: Number(form.port),
        token: form.token.trim()
      }
      const result = await window.airbridge.peer.shares(next)
      setPeer(next)
      setShares(result.shares)
      setFingerprint(result.fingerprint)
      setOpenShare(null)
      setEntries([])
    })

  const browse = (share: PublicShare, nextPath: string): Promise<void> =>
    run(async () => {
      if (!peer) return
      setEntries(await window.airbridge.peer.list(peer, share.id, nextPath))
      setOpenShare(share)
      setPath(nextPath)
    })

  const download = (entry: DirEntry): Promise<void> =>
    run(async () => {
      if (!peer || !openShare) return
      const result = await window.airbridge.peer.download(
        peer,
        openShare.id,
        joinPath(path, entry.name)
      )
      setMessage(`Saved ${formatBytes(result.bytes)} to ${result.path}`)
    })

  return (
    <section className="flex flex-col gap-4 overflow-y-auto p-6">
      <h2 className="text-base font-semibold">Connect to a device</h2>

      <div className="flex flex-wrap items-end gap-2">
        <Input
          label="Host"
          value={form.host}
          onChange={(host) => setForm({ ...form, host })}
          className="w-32"
        />
        <Input
          label="Port"
          value={form.port}
          onChange={(port) => setForm({ ...form, port })}
          className="w-20"
        />
        <Input
          label="Token"
          value={form.token}
          onChange={(token) => setForm({ ...form, token })}
          className="w-56"
        />
        <Button onClick={connect} disabled={busy}>
          Connect
        </Button>
      </div>

      {fingerprint && (
        <p className="text-[10px] text-(--color-ink-muted)">
          Certificate <span className="select-text font-mono">{fingerprint}</span>
        </p>
      )}

      {message && (
        <p className="rounded-md bg-(--color-sidebar) px-3 py-2 text-xs select-text">{message}</p>
      )}

      {shares.length > 0 && (
        <nav className="flex flex-wrap gap-1.5">
          {shares.map((share) => (
            <Button key={share.id} onClick={() => browse(share, '')} disabled={!share.available}>
              {share.name}
            </Button>
          ))}
        </nav>
      )}

      {openShare && (
        <>
          <Breadcrumb
            share={openShare}
            path={path}
            onNavigate={(next) => void browse(openShare, next)}
          />
          <ul className="flex flex-col">
            {entries.map((entry) => (
              <li key={entry.name}>
                <button
                  type="button"
                  disabled={busy}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-(--color-sidebar)"
                  onClick={() =>
                    entry.kind === 'directory'
                      ? void browse(openShare, joinPath(path, entry.name))
                      : void download(entry)
                  }
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

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
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
