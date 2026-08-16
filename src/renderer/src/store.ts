import { create } from 'zustand'

import type { DirEntry } from '@shared/types'

export type ViewMode = 'list' | 'icon'
export type SortKey = 'name' | 'mtime' | 'size' | 'kind'

/** Where a previewed file lives, which is all the panel needs to build its URL. */
export type PreviewSource =
  | { kind: 'remote'; deviceId: string; shareId: string; directory: string }
  | { kind: 'local'; directory: string }

export interface PreviewState {
  source: PreviewSource
  /** The whole folder listing, so ← and → can step through it without refetching. */
  entries: DirEntry[]
  index: number
}

/**
 * Where the main pane is pointed.
 *
 * `shareId: null` means the device's list of shares — the level above any folder. Publishing
 * a folder of your own opens `kind: 'local'` instead, which browses the real disk.
 */
export type Location =
  | { kind: 'welcome' }
  | { kind: 'device'; deviceId: string; shareId: string | null; path: string }
  | { kind: 'local'; path: string }

interface UiState {
  location: Location
  /** Straight browser semantics: going somewhere new truncates the forward history. */
  history: Location[]
  historyIndex: number

  selection: Set<string>
  viewMode: ViewMode
  sortKey: SortKey
  sortAscending: boolean

  paneOpen: boolean
  panePath: string | null

  preview: PreviewState | null

  navigate: (location: Location) => void
  back: () => void
  forward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean

  select: (names: string[]) => void
  toggleSelected: (name: string, additive: boolean) => void
  clearSelection: () => void

  setViewMode: (mode: ViewMode) => void
  sortBy: (key: SortKey) => void

  setPaneOpen: (open: boolean) => void
  setPanePath: (path: string) => void

  openPreview: (source: PreviewSource, entries: DirEntry[], name: string) => void
  closePreview: () => void
  stepPreview: (delta: number) => void
}

export const useUi = create<UiState>((set, get) => ({
  location: { kind: 'welcome' },
  history: [{ kind: 'welcome' }],
  historyIndex: 0,

  selection: new Set(),
  viewMode: 'list',
  sortKey: 'name',
  sortAscending: true,

  paneOpen: false,
  panePath: null,

  preview: null,

  navigate: (location) =>
    set((state) => {
      const history = [...state.history.slice(0, state.historyIndex + 1), location]
      return {
        location,
        history,
        historyIndex: history.length - 1,
        selection: new Set(),
        // A preview belongs to the folder it was opened from.
        preview: null
      }
    }),

  back: () =>
    set((state) => {
      if (state.historyIndex === 0) return state
      const historyIndex = state.historyIndex - 1
      return {
        historyIndex,
        location: state.history[historyIndex],
        selection: new Set(),
        preview: null
      }
    }),

  forward: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state
      const historyIndex = state.historyIndex + 1
      return {
        historyIndex,
        location: state.history[historyIndex],
        selection: new Set(),
        preview: null
      }
    }),

  canGoBack: () => get().historyIndex > 0,
  canGoForward: () => get().historyIndex < get().history.length - 1,

  select: (names) => set({ selection: new Set(names) }),

  toggleSelected: (name, additive) =>
    set((state) => {
      if (!additive) return { selection: new Set([name]) }

      const selection = new Set(state.selection)
      if (selection.has(name)) selection.delete(name)
      else selection.add(name)
      return { selection }
    }),

  clearSelection: () => set({ selection: new Set() }),

  setViewMode: (viewMode) => set({ viewMode }),

  // Clicking the column you are already sorted by flips the direction, as it does in Finder.
  sortBy: (key) =>
    set((state) =>
      state.sortKey === key
        ? { sortAscending: !state.sortAscending }
        : { sortKey: key, sortAscending: true }
    ),

  setPaneOpen: (paneOpen) => set({ paneOpen }),
  setPanePath: (panePath) => set({ panePath }),

  openPreview: (source, entries, name) => {
    // Only files are previewable, so folders are dropped from the list the arrow keys walk —
    // otherwise stepping lands on something with nothing to show.
    const files = entries.filter((entry) => entry.kind === 'file')
    const index = files.findIndex((entry) => entry.name === name)
    if (index === -1) return

    set({ preview: { source, entries: files, index } })
  },

  closePreview: () => set({ preview: null }),

  stepPreview: (delta) =>
    set((state) => {
      if (!state.preview) return state

      const index = state.preview.index + delta
      if (index < 0 || index >= state.preview.entries.length) return state

      return {
        preview: { ...state.preview, index },
        // Keep the selection under the panel in step, so closing it leaves the highlight on
        // whatever was last looked at.
        selection: new Set([state.preview.entries[index].name])
      }
    })
}))
