import { create } from 'zustand'

export type ViewMode = 'list' | 'icon'
export type SortKey = 'name' | 'mtime' | 'size' | 'kind'

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

  navigate: (location) =>
    set((state) => {
      const history = [...state.history.slice(0, state.historyIndex + 1), location]
      return {
        location,
        history,
        historyIndex: history.length - 1,
        selection: new Set()
      }
    }),

  back: () =>
    set((state) => {
      if (state.historyIndex === 0) return state
      const historyIndex = state.historyIndex - 1
      return { historyIndex, location: state.history[historyIndex], selection: new Set() }
    }),

  forward: () =>
    set((state) => {
      if (state.historyIndex >= state.history.length - 1) return state
      const historyIndex = state.historyIndex + 1
      return { historyIndex, location: state.history[historyIndex], selection: new Set() }
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
  setPanePath: (panePath) => set({ panePath })
}))
