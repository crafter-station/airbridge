import { useMemo } from 'react'

import type { DirEntry } from '@shared/types'
import { describeKind, formatBytes, formatDate } from '../format'
import { useUi, type SortKey } from '../store'
import { ChevronIcon, FileIcon, FolderIcon } from './Icons'

export interface FileViewProps {
  entries: DirEntry[]
  onOpen: (entry: DirEntry) => void
  /** Handed the names being dragged, so the drop target knows what it is receiving. */
  onDragEntries?: (names: string[], event: React.DragEvent) => void
}

/** Dotfiles are hidden by default, as in Finder. There is no toggle in the UI yet, so this is
 *  the only place that decides it. */
function isHidden(entry: DirEntry): boolean {
  return entry.name.startsWith('.')
}

export function useSortedEntries(entries: DirEntry[]): DirEntry[] {
  const sortKey = useUi((state) => state.sortKey)
  const ascending = useUi((state) => state.sortAscending)

  return useMemo(() => {
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
}

export function ListView({ entries, onOpen, onDragEntries }: FileViewProps): React.JSX.Element {
  const sorted = useSortedEntries(entries)
  const selection = useUi((state) => state.selection)
  const toggleSelected = useUi((state) => state.toggleSelected)
  const sortKey = useUi((state) => state.sortKey)
  const ascending = useUi((state) => state.sortAscending)
  const sortBy = useUi((state) => state.sortBy)

  const startDrag = (name: string, event: React.DragEvent): void => {
    // Dragging an unselected row acts on that row alone, matching every file manager.
    const names = selection.has(name) ? [...selection] : [name]
    onDragEntries?.(names, event)
  }

  return (
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
          const isSelected = selection.has(entry.name)

          return (
            <tr
              key={entry.name}
              draggable={onDragEntries !== undefined}
              onDragStart={(event) => startDrag(entry.name, event)}
              onClick={(event) => toggleSelected(entry.name, event.metaKey || event.ctrlKey)}
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

export function IconView({ entries, onOpen, onDragEntries }: FileViewProps): React.JSX.Element {
  const sorted = useSortedEntries(entries)
  const selection = useUi((state) => state.selection)
  const toggleSelected = useUi((state) => state.toggleSelected)

  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1 p-4">
      {sorted.map((entry) => {
        const isSelected = selection.has(entry.name)

        return (
          <li key={entry.name}>
            <button
              type="button"
              draggable={onDragEntries !== undefined}
              onDragStart={(event) => {
                const names = selection.has(entry.name) ? [...selection] : [entry.name]
                onDragEntries?.(names, event)
              }}
              onClick={(event) => toggleSelected(entry.name, event.metaKey || event.ctrlKey)}
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
  )
}
