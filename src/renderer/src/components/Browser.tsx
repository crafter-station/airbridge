import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import type { DirEntry, PublicShare } from '@shared/types'
import { activeDrag, beginDrag, droppedDrag, isWithinDragged, type Drag } from '../drag'
import { joinRemote } from '../format'
import { useDevices, useLocalDirectory, usePeerDirectory, usePeerShares } from '../queries'
import { reporting, useUi } from '../store'
import { EmptyState } from './EmptyState'
import { IconView, ListView } from './FileViews'
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

  const client = useQueryClient()
  const refetchShare = (): Promise<void> =>
    client.invalidateQueries({ queryKey: ['peer-dir', deviceId, shareId] })

  const startDrag = (names: string[], event: React.DragEvent): void => {
    const dragged = (entries ?? []).filter((entry) => names.includes(entry.name))

    beginDrag(
      {
        kind: 'remote',
        deviceId,
        shareId,
        shareName: share?.name ?? 'Share',
        items: dragged.map((entry) => ({
          name: entry.name,
          kind: entry.kind,
          path: joinRemote(path, entry.name),
          size: entry.size
        }))
      },
      event
    )

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

  /** Whether a drag can land in `directory` of this share: local files upload, and items from
   *  this same share move. Either way the share has to accept writes. */
  const accepts = (drag: Drag | null, directory: string): boolean => {
    if (!drag || !share?.writable) return false
    if (drag.kind === 'local') return true
    const paths = drag.items.map((item) => item.path)
    return (
      drag.deviceId === deviceId && drag.shareId === shareId && !isWithinDragged(directory, paths)
    )
  }

  const dropInto = (drag: Drag | null, directory: string): Promise<void> =>
    reporting(async () => {
      if (!drag || !share || !accepts(drag, directory)) return

      if (drag.kind === 'local') {
        await window.airbridge.transfers.upload(deviceId, shareId, share.name, drag.paths, directory)
        return
      }

      await window.airbridge.peer.move(
        deviceId,
        shareId,
        drag.items.map((item) => item.path),
        directory
      )
      await refetchShare()
    })

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

    const View = viewMode === 'list' ? ListView : IconView
    return (
      <View
        entries={entries}
        onOpen={open}
        onDragEntries={startDrag}
        canDropOn={(folder) => accepts(activeDrag(), joinRemote(path, folder.name))}
        onDropOn={(folder, event) => void dropInto(droppedDrag(event), joinRemote(path, folder.name))}
      />
    )
  }

  return (
    <div
      className={`flex min-h-full flex-1 flex-col ${
        receiving ? 'bg-(--color-accent)/10 ring-2 ring-(--color-accent) ring-inset' : ''
      }`}
      onDragOver={(event) => {
        // Only local files land on the folder as a whole; a read-only share must not light
        // up and then silently do nothing. Moves need a folder row to aim at.
        if (activeDrag()?.kind !== 'local' || !accepts(activeDrag(), path)) return
        event.preventDefault()
        setReceiving(true)
      }}
      onDragLeave={() => setReceiving(false)}
      onDrop={(event) => {
        event.preventDefault()
        setReceiving(false)
        const drag = droppedDrag(event)
        if (drag?.kind === 'local') void dropInto(drag, path)
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
  const setPaneOpen = useUi((state) => state.setPaneOpen)
  const client = useQueryClient()

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

  const pathOf = (name: string): string => `${path}/${name}`

  /** Our own files move; files from another machine are copied down into the folder. */
  const accepts = (drag: Drag | null, directory: string): boolean =>
    drag?.kind === 'remote' || (drag?.kind === 'local' && !isWithinDragged(directory, drag.paths))

  const dropInto = (drag: Drag | null, directory: string): Promise<void> =>
    reporting(async () => {
      if (!drag || !accepts(drag, directory)) return

      if (drag.kind === 'remote') {
        const { deviceId, shareId, shareName, items } = drag
        await window.airbridge.transfers.copy(deviceId, shareId, shareName, items, directory)
        return
      }

      await window.airbridge.local.move(drag.paths, directory)
      await client.invalidateQueries({ queryKey: ['local-dir'] })
    })

  const View = viewMode === 'list' ? ListView : IconView
  return (
    <View
      entries={listing.entries}
      onOpen={open}
      onDragEntries={(names, event) => {
        beginDrag({ kind: 'local', paths: names.map(pathOf) }, event)
        // Somewhere to drop them: a share on another device, or the local pane.
        setPaneOpen(true)
      }}
      canDropOn={(folder) => accepts(activeDrag(), pathOf(folder.name))}
      onDropOn={(folder, event) => void dropInto(droppedDrag(event), pathOf(folder.name))}
    />
  )
}
