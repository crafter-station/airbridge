import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { Browser } from './components/Browser'
import { LocalPane } from './components/LocalPane'
import { Sidebar } from './components/Sidebar'
import { StatusBar } from './components/StatusBar'
import { Toolbar } from './components/Toolbar'
import { useUi } from './store'

/** Nothing polls. Every list that can change is pushed from the main process and written
 *  straight into the cache, so a refetch on window focus would only cause flicker. */
const client = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: false, staleTime: 30_000 }
  }
})

export function App(): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <Shell />
    </QueryClientProvider>
  )
}

function Shell(): React.JSX.Element {
  const paneOpen = useUi((state) => state.paneOpen)
  const [itemCount, setItemCount] = useState<number | null>(null)

  useKeyboardShortcuts()

  return (
    <div className="flex h-full flex-col">
      <Toolbar />

      <div className="flex min-h-0 flex-1">
        <Sidebar />

        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-white">
          <Browser onCount={setItemCount} />
        </main>

        {paneOpen && <LocalPane />}
      </div>

      <StatusBar itemCount={itemCount} />
    </div>
  )
}

function useKeyboardShortcuts(): void {
  const { back, forward, clearSelection, setViewMode, setPaneOpen } = useUi()
  const paneOpen = useUi((state) => state.paneOpen)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const accel = event.metaKey || event.ctrlKey

      // Never steal a key from a text field the user is typing in.
      if (event.target instanceof HTMLInputElement) return

      if (event.key === 'Escape') return clearSelection()

      if (accel && event.key === '[') return back()
      if (accel && event.key === ']') return forward()
      if (accel && event.key === '1') return setViewMode('list')
      if (accel && event.key === '2') return setViewMode('icon')
      if (accel && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setPaneOpen(!paneOpen)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [back, forward, clearSelection, setViewMode, setPaneOpen, paneOpen])
}
