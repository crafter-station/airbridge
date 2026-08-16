import { useDevices, useOwnShares } from '../queries'
import { useUi } from '../store'
import { DeviceIcon, FolderIcon } from './Icons'

/** Finder's source list: sections of flat rows, one selected at a time, no disclosure arrows
 *  at this depth. Sizes and weights follow it closely — this is the most recognisable part of
 *  the window, and getting it approximately right reads as wrong. */
export function Sidebar(): React.JSX.Element {
  const { data: devices = [] } = useDevices()
  const { data: shares = [] } = useOwnShares()
  const location = useUi((state) => state.location)
  const navigate = useUi((state) => state.navigate)

  const paired = devices.filter((device) => device.paired)
  const available = devices.filter((device) => !device.paired)

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-(--color-chrome-border) bg-(--color-sidebar) px-2.5 pt-2 pb-3">
      {paired.length > 0 && (
        <Section title="Devices">
          {paired.map((device) => (
            <Row
              key={device.deviceId}
              selected={location.kind === 'device' && location.deviceId === device.deviceId}
              onClick={() =>
                navigate({ kind: 'device', deviceId: device.deviceId, shareId: null, path: '' })
              }
              icon={<DeviceIcon className="h-4 w-4 text-(--color-accent)" />}
              trailing={
                <span
                  aria-label={device.online ? 'Online' : 'Offline'}
                  className={`h-1.5 w-1.5 rounded-full ${
                    device.online ? 'bg-green-500' : 'bg-black/20'
                  }`}
                />
              }
            >
              {device.deviceName}
            </Row>
          ))}
        </Section>
      )}

      {available.length > 0 && (
        <Section title="Nearby">
          {available.map((device) => (
            <Row
              key={device.deviceId}
              selected={false}
              onClick={() =>
                navigate({ kind: 'device', deviceId: device.deviceId, shareId: null, path: '' })
              }
              icon={<DeviceIcon className="h-4 w-4 text-black/30" />}
            >
              {device.deviceName}
            </Row>
          ))}
        </Section>
      )}

      <Section
        title="Sharing"
        action={
          <button
            type="button"
            title="Share a folder"
            onClick={() => void window.airbridge.shares.add()}
            className="app-no-drag rounded px-1 text-sm leading-none text-(--color-ink-muted) hover:text-(--color-ink)"
          >
            +
          </button>
        }
      >
        {shares.length === 0 && (
          <p className="px-2 py-1 text-xs text-(--color-ink-muted)">No shared folders.</p>
        )}
        {shares.map((share) => (
          <Row
            key={share.id}
            selected={location.kind === 'local' && location.path === share.path}
            onClick={() => navigate({ kind: 'local', path: share.path })}
            icon={
              <FolderIcon
                className={`h-4 w-4 ${share.available ? 'text-(--color-accent)' : 'text-black/25'}`}
              />
            }
            trailing={
              share.writable ? (
                <span className="text-[10px] tracking-wide text-(--color-ink-muted)">RW</span>
              ) : undefined
            }
          >
            {share.name}
          </Row>
        ))}
      </Section>
    </nav>
  )
}

function Section({
  title,
  action,
  children
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section>
      <div className="flex items-center justify-between px-2 pb-1">
        <h2 className="text-[11px] font-semibold tracking-wide text-(--color-ink-muted)">
          {title}
        </h2>
        {action}
      </div>
      <ul className="flex flex-col gap-px">{children}</ul>
    </section>
  )
}

function Row({
  children,
  icon,
  trailing,
  selected,
  onClick
}: {
  children: React.ReactNode
  icon: React.ReactNode
  trailing?: React.ReactNode
  selected: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`app-no-drag flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left text-[13px] ${
          selected ? 'bg-(--color-accent) text-white' : 'hover:bg-black/5'
        }`}
      >
        <span className={selected ? 'text-white' : undefined}>{icon}</span>
        <span className="min-w-0 flex-1 truncate">{children}</span>
        {trailing}
      </button>
    </li>
  )
}
