import { useEffect, useState } from 'react'

import type { TransferItem } from '@shared/types'
import { useLocalDirectory, useLocalPlaces } from '../queries'
import { useUi } from '../store'
import { ChevronIcon, FolderIcon, PlaceIcon } from './Icons'

/** What a drag out of the remote pane carries. Not a real file — the bytes are still on the
 *  other machine — so it is a copy instruction rather than a payload. */
export interface RemoteDrag {
  deviceId: string
  shareId: string
  shareName: string
  items: TransferItem[]
}

export const DRAG_MIME = 'application/x-airbridge-items'

/**
 * The destination half of the window.
 *
 * Dragging happens between our own two panes rather than out to Finder, because Electron's
 * `startDrag` needs the file to already exist on disk before the gesture begins and does not
 * expose the OS promised-file APIs. Dropping here is the same gesture with none of that
 * problem — and it shows source and destination at once, which Finder itself cannot.
 */
export function LocalPane(): React.JSX.Element {
  const panePath = useUi((state) => state.panePath)
  const setPanePath = useUi((state) => state.setPanePath)
  const { data: places = [] } = useLocalPlaces()
  const { data: listing, isLoading } = useLocalDirectory(panePath)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  // Open on the first sensible place rather than an empty pane.
  useEffect(() => {
    if (!panePath && places.length > 0) setPanePath(places[0].path)
  }, [panePath, places, setPanePath])

  const copyInto = async (destination: string, event: React.DragEvent): Promise<void> => {
    const raw = event.dataTransfer.getData(DRAG_MIME)
    if (!raw) return

    const drag = JSON.parse(raw) as RemoteDrag
    await window.airbridge.transfers.copy(
      drag.deviceId,
      drag.shareId,
      drag.shareName,
      drag.items,
      destination
    )
  }

  const folders = (listing?.entries ?? []).filter(
    (entry) => entry.kind === 'directory' && !entry.name.startsWith('.')
  )

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-(--color-chrome-border) bg-(--color-chrome)">
      <div className="flex items-center gap-1 border-b border-(--color-chrome-border) px-2 py-1.5">
        <button
          type="button"
          title="Up one folder"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && setPanePath(listing.parent)}
          className="rounded p-1 text-(--color-ink-muted) hover:bg-black/5 disabled:opacity-30"
        >
          <ChevronIcon className="h-3.5 w-3.5 -rotate-90" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium" title={panePath ?? ''}>
          {panePath?.split(/[\\/]/).filter(Boolean).pop() ?? 'This device'}
        </span>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-(--color-chrome-border) px-2 py-1.5">
        {places.map((place) => (
          <button
            key={place.path}
            type="button"
            title={place.path}
            onClick={() => setPanePath(place.path)}
            // Dropping straight onto a shortcut saves navigating there first.
            onDragOver={(event) => {
              event.preventDefault()
              setDropTarget(place.path)
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              event.preventDefault()
              setDropTarget(null)
              void copyInto(place.path, event)
            }}
            className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] ${
              dropTarget === place.path
                ? 'bg-(--color-accent) text-white'
                : 'text-(--color-ink-muted) hover:bg-black/5'
            }`}
          >
            <PlaceIcon icon={place.icon} className="h-3.5 w-3.5" />
            {place.name}
          </button>
        ))}
      </div>

      {/* The whole pane is a drop target for the folder currently open, so the common case —
          "put it here" — needs no aiming at a particular row. */}
      <div
        data-drop="pane"
        onDragOver={(event) => {
          event.preventDefault()
          setDropTarget(panePath)
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => {
          event.preventDefault()
          setDropTarget(null)
          if (panePath) void copyInto(panePath, event)
        }}
        className={`flex-1 overflow-y-auto p-1 ${
          dropTarget === panePath ? 'bg-(--color-accent)/10 ring-2 ring-(--color-accent) ring-inset' : ''
        }`}
      >
        {isLoading && <p className="px-2 py-1 text-xs text-(--color-ink-muted)">Loading…</p>}

        {!isLoading && folders.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-(--color-ink-muted)">
            Drop here to copy into this folder.
          </p>
        )}

        <ul className="flex flex-col gap-px">
          {folders.map((entry) => {
            const path = joinLocal(panePath ?? '', entry.name)

            return (
              <li key={entry.name}>
                <button
                  type="button"
                  data-drop="folder"
                  data-path={path}
                  onDoubleClick={() => setPanePath(path)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setDropTarget(path)
                  }}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setDropTarget(null)
                    void copyInto(path, event)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] ${
                    dropTarget === path ? 'bg-(--color-accent) text-white' : 'hover:bg-black/5'
                  }`}
                >
                  <FolderIcon
                    className={`h-4 w-4 shrink-0 ${
                      dropTarget === path ? 'text-white' : 'text-(--color-accent)'
                    }`}
                  />
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </aside>
  )
}

function joinLocal(base: string, name: string): string {
  if (!base) return name
  return base.endsWith('/') || base.endsWith('\\') ? `${base}${name}` : `${base}/${name}`
}
