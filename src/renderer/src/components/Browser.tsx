import { useMemo, useState } from 'react'

import type { DirEntry, PublicShare } from '@shared/types'
import { joinRemote } from '../format'
import { useDevices, useLocalDirectory, usePeerDirectory, usePeerShares } from '../queries'
import { useUi } from '../store'
import { EmptyState } from './EmptyState'
import { IconView, ListView } from './FileViews'
import { DRAG_MIME, LOCAL_DRAG_MIME, type LocalDrag, type RemoteDrag } from './LocalPane'
import { useQuickLook } from './Preview'

/** The main pane. Which of the three things it is showing depends only on the location. */
export function Browser({ onCount }: { onCount: (count: number | null) => void }): React.JSX.Element {
  const location = useUi((state) => state.location)

  if (location.kind === 'welcome') return <Welcome />
  if (location.kind === 'local') return <LocalBrowser path={location.path} onCount={onCount} />
  if (location.shareId === null) return <ShareList deviceId={location.deviceId} onCount={onCount} />

  return (
    <RemoteBrowser
      deviceId={location.deviceId}
      shareId={location.shareId}
      path={location.path}
      onCount={onCount}
    />
  )
}

function Welcome(): React.JSX.Element {
  const { data: devices = [] } = useDevices()
  const nearby = devices.filter((device) => !device.paired)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-10 text-center">
      <div>
        <h1 className="text-[17px] font-semibold">airbridge</h1>
        <p className="mt-1 max-w-md text-[13px] text-(--color-ink-muted)">
          Share a folder from the sidebar, or pick a device to browse what it is sharing with you.
        </p>
      </div>

      {nearby.length > 0 && <PairList devices={nearby} />}
      <ConnectByAddress />
    </div>
  )
}

function PairList({
  devices
}: {
  devices: { deviceId: string; deviceName: string; host: string | null; port: number | null }[]
}): React.JSX.Element {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pair = async (deviceId: string, host: string, port: number): Promise<void> => {
    setPending(deviceId)
    setError(null)
    try {
      await window.airbridge.devices.pair(host, port)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h2 className="mb-2 text-[11px] font-semibold tracking-wide text-(--color-ink-muted)">
        Nearby
      </h2>
      <ul className="flex flex-col gap-1">
        {devices.map((device) => (
          <li
            key={device.deviceId}
            className="flex items-center gap-3 rounded-lg border border-(--color-chrome-border) bg-(--color-surface) px-3 py-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-[13px]">{device.deviceName}</span>
            <button
              type="button"
              disabled={pending !== null || !device.host}
              onClick={() => void pair(device.deviceId, device.host ?? '', device.port ?? 0)}
              className="rounded-md bg-(--color-accent) px-2.5 py-1 text-[12px] text-(--color-on-accent) disabled:opacity-40"
            >
              {pending === device.deviceId ? 'Waiting…' : 'Connect'}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[12px] text-(--color-danger)">{error}</p>}
      {pending && (
        <p className="mt-2 text-[12px] text-(--color-ink-muted)">
          Approve the request on the other machine.
        </p>
      )}
    </div>
  )
}

/** mDNS fails in ways nothing in the app can fix — a VPN, a guest network, multicast blocked
 *  by an access point. Typing an address is the escape hatch that always works. */
function ConnectByAddress(): React.JSX.Element {
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = async (): Promise<void> => {
    const [host, port] = address.trim().split(':')
    if (!host) return

    setBusy(true)
    setError(null)
    try {
      await window.airbridge.devices.pair(host, Number(port) || 45789)
      setAddress('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void connect()
      }}
      className="flex w-full max-w-sm flex-col gap-1.5"
    >
      <label className="text-[11px] font-semibold tracking-wide text-(--color-ink-muted)">
        Connect by address
      </label>
      <div className="flex gap-1.5">
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="192.168.1.24"
          className="min-w-0 flex-1 rounded-md border border-(--color-chrome-border) bg-(--color-surface) px-2 py-1 text-[13px] select-text"
        />
        <button
          type="submit"
          disabled={busy || address.trim() === ''}
          className="rounded-md border border-(--color-chrome-border) bg-(--color-surface) px-2.5 py-1 text-[12px] hover:bg-(--color-sidebar) disabled:opacity-40"
        >
          Connect
        </button>
      </div>
      {error && <p className="text-[12px] text-(--color-danger)">{error}</p>}
    </form>
  )
}

function ShareList({
  deviceId,
  onCount
}: {
  deviceId: string
  onCount: (count: number | null) => void
}): React.JSX.Element {
  const { data: devices = [] } = useDevices()
  const device = devices.find((candidate) => candidate.deviceId === deviceId)
  const { data: shares, isLoading, error } = usePeerShares(device?.paired ? deviceId : null)
  const navigate = useUi((state) => state.navigate)

  onCount(shares?.length ?? null)

  if (device && !device.paired) {
    return (
      <EmptyState title={`${device.deviceName} is not connected yet`}>
        <PairList devices={[device]} />
      </EmptyState>
    )
  }

  if (isLoading) return <EmptyState title="Loading…" />
  if (error) {
    return (
      <EmptyState title="Could not reach that device">
        <p className="max-w-md text-[13px] text-(--color-ink-muted)">{String(error)}</p>
      </EmptyState>
    )
  }
  if (!shares || shares.length === 0) {
    return <EmptyState title={`${device?.deviceName ?? 'This device'} is not sharing anything.`} />
  }

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 p-4">
      {shares.map((share) => (
        <ShareTile
          key={share.id}
          share={share}
          onOpen={() => navigate({ kind: 'device', deviceId, shareId: share.id, path: '' })}
        />
      ))}
    </ul>
  )
}

function ShareTile({
  share,
  onOpen
}: {
  share: PublicShare
  onOpen: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        disabled={!share.available}
        onDoubleClick={onOpen}
        onClick={onOpen}
        className="flex w-full flex-col gap-1 rounded-lg border border-(--color-chrome-border) bg-(--color-surface) p-3 text-left hover:border-(--color-accent) disabled:opacity-50 disabled:hover:border-(--color-chrome-border)"
      >
        <span className="truncate text-[13px] font-medium">{share.name}</span>
        <span className="text-[11px] text-(--color-ink-muted)">
          {share.available ? (share.writable ? 'Read and write' : 'Read only') : 'Unavailable'}
        </span>
      </button>
    </li>
  )
}

function RemoteBrowser({
  deviceId,
  shareId,
  path,
  onCount
}: {
  deviceId: string
  shareId: string
  path: string
  onCount: (count: number | null) => void
}): React.JSX.Element {
  const { data: entries, isLoading, error } = usePeerDirectory(deviceId, shareId, path)
  const { data: shares = [] } = usePeerShares(deviceId)
  const navigate = useUi((state) => state.navigate)
  const viewMode = useUi((state) => state.viewMode)
  const setPaneOpen = useUi((state) => state.setPaneOpen)
  const openPreview = useUi((state) => state.openPreview)
  const [receiving, setReceiving] = useState(false)

  useQuickLook(
    useMemo(
      () => ({ kind: 'remote' as const, deviceId, shareId, directory: path }),
      [deviceId, shareId, path]
    ),
    entries
  )

  onCount(entries?.length ?? null)

  const share = shares.find((candidate) => candidate.id === shareId)

  const startDrag = (names: string[], event: React.DragEvent): void => {
    const dragged = (entries ?? []).filter((entry) => names.includes(entry.name))

    const payload: RemoteDrag = {
      deviceId,
      shareId,
      shareName: share?.name ?? 'Share',
      items: dragged.map((entry) => ({
        name: entry.name,
        kind: entry.kind,
        path: joinRemote(path, entry.name),
        size: entry.size
      }))
    }

    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
    event.dataTransfer.effectAllowed = 'copy'

    // The destination has to be on screen to be dropped on. Opening it as the drag starts is
    // what makes "just drag it over" work without a separate step.
    setPaneOpen(true)
  }

  const open = (entry: DirEntry): void => {
    if (entry.kind === 'directory') {
      navigate({ kind: 'device', deviceId, shareId, path: joinRemote(path, entry.name) })
      return
    }

    // A file cannot be opened on this machine — it is not here. Previewing is the nearest
    // honest equivalent of Finder's double-click.
    openPreview({ kind: 'remote', deviceId, shareId, directory: path }, entries ?? [], entry.name)
  }

  /** Dropping local files here uploads them, but only into a share marked writable. */
  const receive = async (event: React.DragEvent): Promise<void> => {
    const raw = event.dataTransfer.getData(LOCAL_DRAG_MIME)
    if (!raw || !share?.writable) return

    const drag = JSON.parse(raw) as LocalDrag
    await window.airbridge.transfers.upload(
      deviceId,
      shareId,
      share.name,
      drag.paths,
      path
    )
  }

  const body = (): React.JSX.Element => {
    if (isLoading) return <EmptyState title="Loading…" />
    if (error) {
      return (
        <EmptyState title="Could not open that folder">
          <p className="max-w-md text-[13px] text-(--color-ink-muted)">{String(error)}</p>
        </EmptyState>
      )
    }
    if (!entries || entries.length === 0) {
      return (
        <EmptyState
          title={
            share?.writable ? 'This folder is empty. Drop files here to copy them across.' : 'This folder is empty.'
          }
        />
      )
    }

    return viewMode === 'list' ? (
      <ListView entries={entries} onOpen={open} onDragEntries={startDrag} />
    ) : (
      <IconView entries={entries} onOpen={open} onDragEntries={startDrag} />
    )
  }

  return (
    <div
      className={`flex min-h-full flex-1 flex-col ${
        receiving ? 'bg-(--color-accent)/10 ring-2 ring-(--color-accent) ring-inset' : ''
      }`}
      onDragOver={(event) => {
        // Only claim the drop when it is local files and the share will accept them —
        // otherwise a read-only share would light up and then silently do nothing.
        if (!share?.writable || !event.dataTransfer.types.includes(LOCAL_DRAG_MIME)) return
        event.preventDefault()
        setReceiving(true)
      }}
      onDragLeave={() => setReceiving(false)}
      onDrop={(event) => {
        event.preventDefault()
        setReceiving(false)
        void receive(event)
      }}
    >
      {body()}
    </div>
  )
}

/** Your own published folders, browsed straight off the disk. */
function LocalBrowser({
  path,
  onCount
}: {
  path: string
  onCount: (count: number | null) => void
}): React.JSX.Element {
  const { data: listing, isLoading, error } = useLocalDirectory(path)
  const navigate = useUi((state) => state.navigate)
  const viewMode = useUi((state) => state.viewMode)
  const openPreview = useUi((state) => state.openPreview)

  useQuickLook(
    useMemo(() => ({ kind: 'local' as const, directory: path }), [path]),
    listing?.entries
  )

  onCount(listing?.entries.length ?? null)

  if (isLoading) return <EmptyState title="Loading…" />
  if (error) {
    return (
      <EmptyState title="Could not open that folder">
        <p className="max-w-md text-[13px] text-(--color-ink-muted)">
          It may have been moved, renamed, or its drive unplugged.
        </p>
      </EmptyState>
    )
  }
  if (!listing || listing.entries.length === 0) {
    return <EmptyState title="This folder is empty." />
  }

  const open = (entry: DirEntry): void => {
    if (entry.kind === 'directory') {
      navigate({ kind: 'local', path: `${path}/${entry.name}` })
      return
    }

    openPreview({ kind: 'local', directory: path }, listing?.entries ?? [], entry.name)
  }

  return viewMode === 'list' ? (
    <ListView entries={listing.entries} onOpen={open} />
  ) : (
    <IconView entries={listing.entries} onOpen={open} />
  )
}
