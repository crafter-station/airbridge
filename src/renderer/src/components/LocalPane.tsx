import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { activeDrag, beginDrag, droppedDrag, isWithinDragged, type Drag } from '../drag'
import { useLocalDirectory, useLocalPlaces } from '../queries'
import { nextSelection, reporting, useUi } from '../store'
import { ChevronIcon, FileIcon, FolderIcon, PlaceIcon } from './Icons'

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
  const client = useQueryClient()

  // Its own selection, separate from the main pane's: the two show different folders.
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  useEffect(() => {
    setSelection(new Set())
    setAnchor(null)
  }, [panePath])

  // Open on the first sensible place rather than an empty pane.
  useEffect(() => {
    if (!panePath && places.length > 0) setPanePath(places[0].path)
  }, [panePath, places, setPanePath])

  /** Files from another machine are copied here; files from this one are moved. */
  const accepts = (drag: Drag | null, destination: string): boolean =>
    drag?.kind === 'remote' ||
    (drag?.kind === 'local' && !isWithinDragged(destination, drag.paths))

  const dropInto = (destination: string, event: React.DragEvent): Promise<void> =>
    reporting(async () => {
      const drag = droppedDrag(event)
      if (!drag || !accepts(drag, destination)) return

      if (drag.kind === 'remote') {
        const { deviceId, shareId, shareName, items } = drag
        await window.airbridge.transfers.copy(deviceId, shareId, shareName, items, destination)
        return
      }

      await window.airbridge.local.move(drag.paths, destination)
      await client.invalidateQueries({ queryKey: ['local-dir'] })
    })

  /** Light up `target` for the drag in flight, if it would accept it. */
  const hover = (target: string, event: React.DragEvent): void => {
    if (!accepts(activeDrag(), target)) return
    event.preventDefault()
    event.stopPropagation()
    setDropTarget(target)
  }

  // Folders are drop targets; files are here so they can be dragged the other way, into a
  // writable share. Dotfiles stay hidden, as in the main pane.
  const entries = useMemo(
    () => (listing?.entries ?? []).filter((entry) => !entry.name.startsWith('.')),
    [listing]
  )
  const names = useMemo(() => entries.map((entry) => entry.name), [entries])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-(--color-chrome-border) bg-(--color-chrome)">
      <div className="flex items-center gap-1 border-b border-(--color-chrome-border) px-2 py-1.5">
        <button
          type="button"
          title="Up one folder"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && setPanePath(listing.parent)}
          className="rounded p-1 text-(--color-ink-muted) hover:bg-(--color-hover) disabled:opacity-30"
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
            onDragOver={(event) => hover(place.path, event)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(event) => {
              event.preventDefault()
              setDropTarget(null)
              void dropInto(place.path, event)
            }}
            className={`flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] ${
              dropTarget === place.path
                ? 'bg-(--color-accent) text-(--color-on-accent)'
                : 'text-(--color-ink-muted) hover:bg-(--color-hover)'
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
        onDragOver={(event) => panePath && hover(panePath, event)}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => {
          event.preventDefault()
          setDropTarget(null)
          if (panePath) void dropInto(panePath, event)
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelection(new Set())
        }}
        className={`flex-1 overflow-y-auto p-1 ${
          dropTarget === panePath ? 'bg-(--color-accent)/10 ring-2 ring-(--color-accent) ring-inset' : ''
        }`}
      >
        {isLoading && <p className="px-2 py-1 text-xs text-(--color-ink-muted)">Loading…</p>}

        {!isLoading && entries.length === 0 && (
          <p className="px-2 py-3 text-center text-xs text-(--color-ink-muted)">
            Drop here to copy into this folder.
          </p>
        )}

        <ul className="flex flex-col gap-px">
          {entries.map((entry) => {
            const path = joinLocal(panePath ?? '', entry.name)
            const isFolder = entry.kind === 'directory'
            const highlighted = dropTarget === path || selection.has(entry.name)

            return (
              <li key={entry.name}>
                <button
                  type="button"
                  data-drop={isFolder ? 'folder' : undefined}
                  data-path={path}
                  draggable
                  onClick={(event) => {
                    const next = nextSelection(selection, anchor, names, entry.name, {
                      toggle: event.metaKey || event.ctrlKey,
                      range: event.shiftKey
                    })
                    setSelection(next.selection)
                    setAnchor(next.anchor)
                  }}
                  onDragStart={(event) => {
                    // The whole selection when dragging part of it, otherwise just this one.
                    const dragged = selection.has(entry.name) ? [...selection] : [entry.name]
                    beginDrag(
                      { kind: 'local', paths: dragged.map((name) => joinLocal(panePath ?? '', name)) },
                      event
                    )
                  }}
                  onDoubleClick={() => isFolder && setPanePath(path)}
                  onDragOver={(event) => isFolder && hover(path, event)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(event) => {
                    if (!isFolder) return
                    event.preventDefault()
                    event.stopPropagation()
                    setDropTarget(null)
                    void dropInto(path, event)
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] select-none ${
                    highlighted ? 'bg-(--color-accent) text-(--color-on-accent)' : 'hover:bg-(--color-hover)'
                  }`}
                >
                  {isFolder ? (
                    <FolderIcon
                      className={`h-4 w-4 shrink-0 ${
                        highlighted ? 'text-(--color-on-accent)' : 'text-(--color-accent)'
                      }`}
                    />
                  ) : (
                    <FileIcon
                      className={`h-4 w-4 shrink-0 ${
                        highlighted ? 'text-(--color-on-accent)' : 'text-(--color-ink-muted)'
                      }`}
                    />
                  )}
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
