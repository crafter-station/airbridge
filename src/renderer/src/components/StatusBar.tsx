import { formatBytes } from '../format'
import { useTransfers } from '../queries'

/**
 * Finder's bottom strip: how much is here, and what is happening. Transfers live here rather
 * than in a separate window because a copy is something you glance at, not something you
 * manage.
 */
export function StatusBar({ itemCount }: { itemCount: number | null }): React.JSX.Element {
  const { data: jobs = [] } = useTransfers()
  const active = jobs.filter((job) => job.status === 'scanning' || job.status === 'transferring')
  const failed = jobs.filter((job) => job.status === 'failed')

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
          <div className="h-1 w-28 shrink-0 overflow-hidden rounded-full bg-black/10">
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
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-black/5"
          >
            Cancel
          </button>
        </div>
      )}

      {active.length === 0 && failed.length > 0 && (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-red-600">{failed[failed.length - 1].error}</span>
          <button
            type="button"
            onClick={() => void window.airbridge.transfers.clear()}
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-black/5"
          >
            Dismiss
          </button>
        </div>
      )}
    </footer>
  )
}
