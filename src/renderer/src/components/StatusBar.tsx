import { formatBytes } from '../format'
import { useTransfers, useUpdate } from '../queries'
import { useUi } from '../store'

/** Version and update state, at the far end of the strip where it stays out of the way. */
function UpdateStatus(): React.JSX.Element | null {
  const { data: update } = useUpdate()
  if (!update) return null

  const button = 'shrink-0 rounded px-1.5 py-0.5 hover:bg-(--color-hover)'

  switch (update.status) {
    case 'checking':
      return <span className="shrink-0">Checking for updates…</span>
    case 'downloading':
      return (
        <span className="shrink-0">
          Downloading {update.version}
          {update.percent ? ` — ${Math.round(update.percent)}%` : '…'}
        </span>
      )
    case 'ready':
      return (
        <button
          type="button"
          onClick={() => void window.airbridge.update.install()}
          className={`${button} text-(--color-accent)`}
        >
          Restart to update to {update.version}
        </button>
      )
    default:
      return (
        <button
          type="button"
          onClick={() => void window.airbridge.update.check()}
          title={update.status === 'error' ? update.message : undefined}
          className={button}
        >
          v{update.currentVersion}
          {update.status === 'up-to-date' && ' · Up to date'}
          {update.status === 'error' && ' · Update check failed'}
          {' · Check for updates'}
        </button>
      )
  }
}

/**
 * Finder's bottom strip: how much is here, and what is happening. Transfers live here rather
 * than in a separate window because a copy is something you glance at, not something you
 * manage.
 */
export function StatusBar({ itemCount }: { itemCount: number | null }): React.JSX.Element {
  const { data: jobs = [] } = useTransfers()
  const active = jobs.filter((job) => job.status === 'scanning' || job.status === 'transferring')
  const failed = jobs.filter((job) => job.status === 'failed')
  const notice = useUi((state) => state.notice)
  const setNotice = useUi((state) => state.setNotice)

  const totalBytes = active.reduce((sum, job) => sum + job.totalBytes, 0)
  const doneBytes = active.reduce((sum, job) => sum + job.transferredBytes, 0)
  const fraction = totalBytes > 0 ? doneBytes / totalBytes : 0

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-(--color-chrome-border) bg-(--color-chrome) px-3 text-[11px] text-(--color-ink-muted)">
      <span className="shrink-0">
        {itemCount === null ? '' : `${itemCount} ${itemCount === 1 ? 'item' : 'items'}`}
      </span>

      {active.length > 0 && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-(--color-pressed)">
            <div
              className="h-full rounded-full bg-(--color-accent) transition-[width] duration-200"
              style={{ width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <span className="truncate">
            {active.length === 1
              ? (active[0].currentFile ?? 'Preparing…')
              : `${active.length} transfers`}
            {totalBytes > 0 && ` — ${formatBytes(doneBytes)} of ${formatBytes(totalBytes)}`}
          </span>
          <button
            type="button"
            onClick={() => active.forEach((job) => void window.airbridge.transfers.cancel(job.id))}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-(--color-hover)"
          >
            Cancel
          </button>
        </div>
      )}

      {active.length === 0 && notice && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-(--color-danger)">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-(--color-hover)"
          >
            Dismiss
          </button>
        </div>
      )}

      {active.length === 0 && !notice && failed.length > 0 && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-(--color-danger)">{failed[failed.length - 1].error}</span>
          <button
            type="button"
            onClick={() => void window.airbridge.transfers.clear()}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-(--color-hover)"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="ml-auto flex shrink-0 items-center">
        <UpdateStatus />
      </div>
    </footer>
  )
}
