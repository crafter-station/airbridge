import { useDevices, usePeerShares } from '../queries'
import { useUi } from '../store'
import { ChevronIcon, IconViewIcon, ListViewIcon, PaneIcon } from './Icons'

/**
 * The top strip. It doubles as the window's drag handle, so everything clickable inside it
 * has to opt back out with `app-no-drag` or the click is swallowed by the move gesture.
 */
export function Toolbar(): React.JSX.Element {
  const { location, back, forward, canGoBack, canGoForward } = useUi()
  const viewMode = useUi((state) => state.viewMode)
  const setViewMode = useUi((state) => state.setViewMode)
  const paneOpen = useUi((state) => state.paneOpen)
  const setPaneOpen = useUi((state) => state.setPaneOpen)

  return (
    <header className="app-drag flex h-[38px] shrink-0 items-center gap-2 border-b border-(--color-chrome-border) bg-(--color-chrome) pr-[var(--titlebar-inset-right)] pl-[var(--titlebar-inset)]">
      <div className="app-no-drag flex items-center">
        <IconButton label="Back" onClick={back} disabled={!canGoBack()}>
          <ChevronIcon className="h-3.5 w-3.5 rotate-180" />
        </IconButton>
        <IconButton label="Forward" onClick={forward} disabled={!canGoForward()}>
          <ChevronIcon className="h-3.5 w-3.5" />
        </IconButton>
      </div>

      <Breadcrumb location={location} />

      <div className="app-no-drag ml-auto flex items-center gap-1">
        <SegmentedButton
          label="List view"
          active={viewMode === 'list'}
          onClick={() => setViewMode('list')}
        >
          <ListViewIcon className="h-4 w-4" />
        </SegmentedButton>
        <SegmentedButton
          label="Icon view"
          active={viewMode === 'icon'}
          onClick={() => setViewMode('icon')}
        >
          <IconViewIcon className="h-4 w-4" />
        </SegmentedButton>

        <span className="mx-1 h-4 w-px bg-(--color-chrome-border)" />

        <SegmentedButton
          label={paneOpen ? 'Hide local folder' : 'Show local folder'}
          active={paneOpen}
          onClick={() => setPaneOpen(!paneOpen)}
        >
          <PaneIcon className="h-4 w-4" />
        </SegmentedButton>
      </div>
    </header>
  )
}

function Breadcrumb({ location }: { location: ReturnType<typeof useUi.getState>['location'] }) {
  const navigate = useUi((state) => state.navigate)
  const { data: devices = [] } = useDevices()
  const deviceId = location.kind === 'device' ? location.deviceId : null
  const { data: shares = [] } = usePeerShares(deviceId)

  if (location.kind === 'welcome') {
    return <span className="text-[13px] font-medium">airbridge</span>
  }

  if (location.kind === 'local') {
    const segments = location.path.split(/[\\/]/).filter(Boolean)
    return (
      <Crumbs
        parts={segments.map((segment, index) => ({
          label: segment,
          // Rebuilding from the original string preserves the leading slash or drive letter.
          onClick: () => {
            const upto = location.path.split(/[\\/]/).slice(0, index + 1)
            navigate({ kind: 'local', path: upto.join('/') || '/' })
          }
        }))}
      />
    )
  }

  const device = devices.find((candidate) => candidate.deviceId === location.deviceId)
  const share = shares.find((candidate) => candidate.id === location.shareId)

  const parts = [
    {
      label: device?.deviceName ?? 'Device',
      onClick: () => navigate({ ...location, shareId: null, path: '' })
    }
  ]

  if (share) {
    parts.push({
      label: share.name,
      onClick: () => navigate({ ...location, path: '' })
    })

    for (const [index, segment] of location.path.split('/').filter(Boolean).entries()) {
      const upto = location.path.split('/').filter(Boolean).slice(0, index + 1)
      parts.push({ label: segment, onClick: () => navigate({ ...location, path: upto.join('/') }) })
    }
  }

  return <Crumbs parts={parts} />
}

function Crumbs({
  parts
}: {
  parts: { label: string; onClick: () => void }[]
}): React.JSX.Element {
  return (
    <div className="app-no-drag flex min-w-0 items-center gap-0.5 text-[13px]">
      {parts.map((part, index) => (
        <span key={`${part.label}-${index}`} className="flex min-w-0 items-center gap-0.5">
          {index > 0 && <ChevronIcon className="h-2.5 w-2.5 shrink-0 text-(--color-ink-muted)" />}
          <button
            type="button"
            onClick={part.onClick}
            className={`truncate rounded px-1 py-0.5 hover:bg-black/5 ${
              index === parts.length - 1 ? 'font-medium' : 'text-(--color-ink-muted)'
            }`}
          >
            {part.label}
          </button>
        </span>
      ))}
    </div>
  )
}

function IconButton({
  children,
  label,
  onClick,
  disabled
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-(--color-ink-muted) hover:bg-black/5 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function SegmentedButton({
  children,
  label,
  active,
  onClick
}: {
  children: React.ReactNode
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-md p-1.5 ${
        active ? 'bg-black/10 text-(--color-ink)' : 'text-(--color-ink-muted) hover:bg-black/5'
      }`}
    >
      {children}
    </button>
  )
}
