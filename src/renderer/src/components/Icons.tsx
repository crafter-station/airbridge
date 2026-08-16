/**
 * Hand-drawn glyphs rather than an icon package.
 *
 * The set is small and specific — Finder's folder, a document, a few sidebar marks — and a
 * general-purpose icon library would bring a thousand others along with a look that is not
 * this one.
 */

type IconProps = { className?: string }

export function FolderIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M2.5 6.5a2 2 0 0 1 2-2h4.2a2 2 0 0 1 1.5.7l1 1.2h10.3a2 2 0 0 1 2 2v9.1a2 2 0 0 1-2 2h-17a2 2 0 0 1-2-2V6.5Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M2.5 9.4h21v9.1a2 2 0 0 1-2 2h-17a2 2 0 0 1-2-2V9.4Z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  )
}

export function FileIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M5 3.5A1.5 1.5 0 0 1 6.5 2h7.2L20 8.3v12.2a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 5 20.5v-17Z"
        fill="currentColor"
        opacity="0.35"
      />
      <path d="M13.7 2 20 8.3h-4.8a1.5 1.5 0 0 1-1.5-1.5V2Z" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

export function DeviceIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="11" rx="1.6" fill="currentColor" opacity="0.35" />
      <path d="M2 18.2h20l-1.4 1.6a1.5 1.5 0 0 1-1.1.5H4.5a1.5 1.5 0 0 1-1.1-.5L2 18.2Z" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

export function ChevronIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="m9 5 7 7-7 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ListViewIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {[6, 12, 18].map((y) => (
        <g key={y}>
          <rect x="3" y={y - 1.4} width="2.8" height="2.8" rx="0.6" fill="currentColor" />
          <rect x="8.4" y={y - 1} width="12.6" height="2" rx="1" fill="currentColor" />
        </g>
      ))}
    </svg>
  )
}

export function IconViewIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      {[4, 13.5].flatMap((y) =>
        [4, 13.5].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="6.5" height="6.5" rx="1.4" fill="currentColor" />
        ))
      )}
    </svg>
  )
}

export function PaneIcon({ className }: IconProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
      />
      <path d="M14.5 5v14" stroke="currentColor" strokeWidth="1.8" />
      <rect x="14.5" y="5" width="6.5" height="14" fill="currentColor" opacity="0.25" />
    </svg>
  )
}

export function PlaceIcon({
  icon,
  className
}: IconProps & { icon: string }): React.JSX.Element {
  const paths: Record<string, string> = {
    home: 'M4 10.8 12 4l8 6.8V19a1.4 1.4 0 0 1-1.4 1.4h-3.4v-5.2H8.8v5.2H5.4A1.4 1.4 0 0 1 4 19v-8.2Z',
    desktop: 'M3 5.4h18v10.2H3V5.4Zm5.6 13h6.8l.7 2H7.9l.7-2Z',
    documents: 'M5 3.6h8l6 6v10.8H5V3.6Z',
    downloads: 'M12 3.4v9.4m0 0 4-4m-4 4-4-4M4 17.6h16v3H4v-3Z',
    drive: 'M3.6 6.4h16.8v11.2H3.6V6.4Zm2.6 8.2h3.2v1.6H6.2v-1.6Z'
  }

  const isStroke = icon === 'downloads'

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d={paths[icon] ?? paths.documents}
        fill={isStroke ? 'none' : 'currentColor'}
        stroke={isStroke ? 'currentColor' : 'none'}
        strokeWidth={isStroke ? 1.9 : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
