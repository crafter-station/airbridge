import { useEffect, useMemo, useState } from 'react'

import type { DirEntry } from '@shared/types'
import { describeKind, formatBytes, formatDate } from '../format'
import { useUi, type SortKey } from '../store'
import { ChevronIcon, FileIcon, FolderIcon } from './Icons'

export interface FileViewProps {
  entries: DirEntry[]
  onOpen: (entry: DirEntry) => void
  /** Handed the names being dragged, so the drop target knows what it is receiving. */
  onDragEntries?: (names: string[], event: React.DragEvent) => void
  /** Whether the drag in flight may be dropped onto this folder. */
  canDropOn?: (folder: DirEntry) => boolean
  onDropOn?: (folder: DirEntry, event: React.DragEvent) => void
}

/**
 * Selection, dragging and folder-drop behaviour shared by both views, so list and icons can
 * never disagree about what a click or a drop does.
 */
function useItemBehaviour({ onDragEntries, canDropOn, onDropOn }: FileViewProps) {
  const selection = useUi((state) => state.selection)
  const clickItem = useUi((state) => state.clickItem)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  return {
    selection,
    dropTarget,
    props: (entry: DirEntry) => ({
      draggable: onDragEntries !== undefined,
      onDragStart: (event: React.DragEvent) => {
        // Dragging an unselected item acts on that item alone, matching every file manager.
        const names = selection.has(entry.name) ? [...selection] : [entry.name]
        onDragEntries?.(names, event)
      },
      onClick: (event: React.MouseEvent) =>
        clickItem(entry.name, { toggle: event.metaKey || event.ctrlKey, range: event.shiftKey }),
      onDragOver: (event: React.DragEvent) => {
        if (entry.kind !== 'directory' || !canDropOn?.(entry)) return
        event.preventDefault()
        // Claimed here, so the pane behind does not also light up as the target.
        event.stopPropagation()
        setDropTarget(entry.name)
      },
      onDragLeave: () => setDropTarget((current) => (current === entry.name ? null : current)),
      onDrop: (event: React.DragEvent) => {
        if (entry.kind !== 'directory' || !canDropOn?.(entry)) return
        event.preventDefault()
        event.stopPropagation()
        setDropTarget(null)
        onDropOn?.(entry, event)
      }
    })
  }
}

/** Clicking the empty space around the items clears the selection, as in Finder. */
function Backdrop({ children }: { children: React.ReactNode }): React.JSX.Element {
  const clearSelection = useUi((state) => state.clearSelection)
  return (
    <div
      className="min-h-full flex-1"
      onClick={(event) => {
        if (event.target === event.currentTarget) clearSelection()
      }}
    >
      {children}
    </div>
  )
}

/** Dotfiles are hidden by default, as in Finder. There is no toggle in the UI yet, so this is
 *  the only place that decides it. */
function isHidden(entry: DirEntry): boolean {
  return entry.name.startsWith('.')
}

export function useSortedEntries(entries: DirEntry[]): DirEntry[] {
  const sortKey = useUi((state) => state.sortKey)
  const ascending = useUi((state) => state.sortAscending)
  const setVisibleNames = useUi((state) => state.setVisibleNames)

  const sorted = useMemo(() => {
    const visible = entries.filter((entry) => !isHidden(entry))
    const direction = ascending ? 1 : -1

    return [...visible].sort((a, b) => {
      // Folders stay above files in either direction, which is what Finder does.
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1

      switch (sortKey) {
        case 'mtime':
          return (a.mtime - b.mtime) * direction
        case 'size':
          return (a.size - b.size) * direction
        case 'kind':
          return (
            describeKind(a.name, a.kind === 'directory').localeCompare(
              describeKind(b.name, b.kind === 'directory')
            ) * direction
          )
        default:
          return (
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) *
            direction
          )
      }
    })
  }, [entries, sortKey, ascending])

  // Shift-click ranges and select-all follow what is on screen, sort order included.
  useEffect(() => setVisibleNames(sorted.map((entry) => entry.name)), [sorted, setVisibleNames])

  return sorted
}

export function ListView(props: FileViewProps): React.JSX.Element {
  const { entries, onOpen } = props
  const sorted = useSortedEntries(entries)
  const { selection, dropTarget, props: itemProps } = useItemBehaviour(props)
  const sortKey = useUi((state) => state.sortKey)
  const ascending = useUi((state) => state.sortAscending)
  const sortBy = useUi((state) => state.sortBy)

  return (
    <Backdrop>
    <table className="w-full border-collapse text-[13px]">
      <thead className="sticky top-0 z-10 bg-(--color-chrome)">
        <tr className="text-left text-(--color-ink-muted)">
          <Header column="name" current={sortKey} ascending={ascending} onSort={sortBy}>
            Name
          </Header>
          <Header
            column="mtime"
            current={sortKey}
            ascending={ascending}
            onSort={sortBy}
            className="w-40"
          >
            Date Modified
          </Header>
          <Header
            column="size"
            current={sortKey}
            ascending={ascending}
            onSort={sortBy}
            className="w-24 text-right"
          >
            Size
          </Header>
          <Header
            column="kind"
            current={sortKey}
            ascending={ascending}
            onSort={sortBy}
            className="w-36"
          >
            Kind
          </Header>
        </tr>
      </thead>

      <tbody>
        {sorted.map((entry) => {
          // A folder being hovered with a drop looks selected: it is where things will land.
          const isSelected = selection.has(entry.name) || dropTarget === entry.name

          return (
            <tr
              key={entry.name}
              {...itemProps(entry)}
              onDoubleClick={() => onOpen(entry)}
              className={`cursor-default select-none ${
                isSelected ? 'bg-(--color-accent) text-(--color-on-accent)' : 'odd:bg-(--color-stripe)'
              }`}
            >
              <td className="flex items-center gap-2 px-3 py-[5px]">
                {entry.kind === 'directory' ? (
                  <FolderIcon
                    className={`h-4 w-4 shrink-0 ${isSelected ? 'text-(--color-on-accent)' : 'text-(--color-accent)'}`}
                  />
                ) : (
                  <FileIcon
                    className={`h-4 w-4 shrink-0 ${isSelected ? 'text-(--color-on-accent)' : 'text-(--color-ink-muted)'}`}
                  />
                )}
                <span className="truncate">{entry.name}</span>
              </td>
              <td
                className={`px-3 ${isSelected ? 'text-(--color-on-accent)/80' : 'text-(--color-ink-muted)'}`}
              >
                {formatDate(entry.mtime)}
              </td>
              <td
                className={`px-3 text-right tabular-nums ${
                  isSelected ? 'text-(--color-on-accent)/80' : 'text-(--color-ink-muted)'
                }`}
              >
                {entry.kind === 'directory' ? '--' : formatBytes(entry.size)}
              </td>
              <td
                className={`truncate px-3 ${isSelected ? 'text-(--color-on-accent)/80' : 'text-(--color-ink-muted)'}`}
              >
                {describeKind(entry.name, entry.kind === 'directory')}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
    </Backdrop>
  )
}

function Header({
  children,
  column,
  current,
  ascending,
  onSort,
  className
}: {
  children: React.ReactNode
  column: SortKey
  current: SortKey
  ascending: boolean
  onSort: (key: SortKey) => void
  className?: string
}): React.JSX.Element {
  return (
    <th
      className={`border-b border-(--color-chrome-border) px-3 py-1.5 font-normal ${className ?? ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 hover:text-(--color-ink)"
      >
        {children}
        {current === column && (
          <ChevronIcon className={`h-2.5 w-2.5 ${ascending ? 'rotate-90' : '-rotate-90'}`} />
        )}
      </button>
    </th>
  )
}

export function IconView(props: FileViewProps): React.JSX.Element {
  const { entries, onOpen } = props
  const sorted = useSortedEntries(entries)
  const { selection, dropTarget, props: itemProps } = useItemBehaviour(props)

  return (
    <Backdrop>
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1 p-4">
      {sorted.map((entry) => {
        const isSelected = selection.has(entry.name) || dropTarget === entry.name

        return (
          <li key={entry.name}>
            <button
              type="button"
              {...itemProps(entry)}
              onDoubleClick={() => onOpen(entry)}
              className="flex w-full cursor-default flex-col items-center gap-1.5 rounded-lg px-1 py-2 select-none"
            >
              {entry.kind === 'directory' ? (
                <FolderIcon className="h-12 w-12 text-(--color-accent)" />
              ) : (
                <FileIcon className="h-12 w-12 text-(--color-ink-muted)" />
              )}
              <span
                className={`line-clamp-2 rounded px-1.5 py-0.5 text-center text-[12px] ${
                  isSelected ? 'bg-(--color-accent) text-(--color-on-accent)' : ''
                }`}
              >
                {entry.name}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
    </Backdrop>
  )
}
