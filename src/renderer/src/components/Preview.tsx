import { useEffect, useState } from 'react'

import {
  localPreviewUrl,
  previewKind,
  remotePreviewUrl,
  TEXT_PREVIEW_BYTES,
  type PreviewKind
} from '@shared/preview'
import type { DirEntry } from '@shared/types'
import { describeKind, formatBytes, formatDate, joinRemote } from '../format'
import { useUi, type PreviewSource } from '../store'
import { ChevronIcon, FileIcon } from './Icons'

/**
 * Quick Look, more or less.
 *
 * Nothing here downloads a file. Media elements are pointed at the preview protocol and pull
 * only the bytes they need through it, so opening a 4GB video costs the same as opening a
 * 4KB one. Text is the exception and is capped explicitly, because a "text" file can be a
 * gigabyte of logs.
 */
/**
 * Space opens a preview of the selected file, the way it does in Finder.
 *
 * It lives with whichever view is showing, because that is the only place that knows what is
 * on screen — the shell has the selection but not the entries it refers to.
 */
export function useQuickLook(source: PreviewSource, entries: DirEntry[] | undefined): void {
  const openPreview = useUi((state) => state.openPreview)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || event.target instanceof HTMLInputElement) return

      const { selection, preview } = useUi.getState()
      if (preview) return

      const [name] = [...selection]
      if (!name) return

      event.preventDefault()
      openPreview(source, entries ?? [], name)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [source, entries, openPreview])
}

export function Preview(): React.JSX.Element | null {
  const preview = useUi((state) => state.preview)
  const closePreview = useUi((state) => state.closePreview)
  const stepPreview = useUi((state) => state.stepPreview)

  useEffect(() => {
    if (!preview) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === ' ') {
        event.preventDefault()
        closePreview()
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') stepPreview(1)
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') stepPreview(-1)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [preview, closePreview, stepPreview])

  if (!preview) return null

  const entry = preview.entries[preview.index]
  if (!entry) return null

  const url = urlFor(preview.source, entry.name)
  const kind = previewKind(entry.name)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={entry.name}
      onClick={closePreview}
      className="fixed inset-0 z-50 flex items-center justify-center bg-(--color-scrim) p-10"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-(--color-chrome-border) bg-(--color-chrome) shadow-2xl"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-(--color-chrome-border) px-3 py-2">
          <FileIcon className="h-4 w-4 shrink-0 text-(--color-ink-muted)" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{entry.name}</div>
            <div className="truncate text-[11px] text-(--color-ink-muted)">
              {describeKind(entry.name, false)} — {formatBytes(entry.size)} —{' '}
              {formatDate(entry.mtime)}
            </div>
          </div>

          {preview.entries.length > 1 && (
            <div className="flex shrink-0 items-center gap-1">
              <StepButton label="Previous" disabled={preview.index === 0} onClick={() => stepPreview(-1)}>
                <ChevronIcon className="h-3.5 w-3.5 rotate-180" />
              </StepButton>
              <span className="text-[11px] tabular-nums text-(--color-ink-muted)">
                {preview.index + 1} / {preview.entries.length}
              </span>
              <StepButton
                label="Next"
                disabled={preview.index === preview.entries.length - 1}
                onClick={() => stepPreview(1)}
              >
                <ChevronIcon className="h-3.5 w-3.5" />
              </StepButton>
            </div>
          )}

          <button
            type="button"
            aria-label="Close"
            onClick={closePreview}
            className="shrink-0 rounded-md px-2 py-1 text-[12px] text-(--color-ink-muted) hover:bg-(--color-hover)"
          >
            Done
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-(--color-surface) p-3">
          {/* Keyed on the URL so switching files tears the old element down rather than
              letting a half-buffered video bleed into the next one. */}
          <Body key={url} kind={kind} url={url} name={entry.name} size={entry.size} />
        </div>
      </div>
    </div>
  )
}

function urlFor(source: PreviewSource, name: string): string {
  if (source.kind === 'local') {
    const separator = source.directory.endsWith('/') || source.directory.endsWith('\\') ? '' : '/'
    return localPreviewUrl(`${source.directory}${separator}${name}`)
  }

  return remotePreviewUrl(source.deviceId, source.shareId, joinRemote(source.directory, name))
}

function Body({
  kind,
  url,
  name,
  size
}: {
  kind: PreviewKind
  url: string
  name: string
  size: number
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)

  if (failed) return <Unsupported name={name} size={size} reason="This file could not be opened." />

  switch (kind) {
    case 'image':
      return (
        <img
          src={url}
          alt={name}
          onError={() => setFailed(true)}
          className="max-h-[70vh] max-w-full object-contain"
        />
      )

    case 'video':
      return (
        <video
          src={url}
          controls
          autoPlay
          // Metadata only: enough for the first frame and a working scrubber, without
          // pulling the file across the network to find out how long it is.
          preload="metadata"
          onError={() => setFailed(true)}
          className="max-h-[70vh] max-w-full"
        />
      )

    case 'audio':
      return <audio src={url} controls autoPlay onError={() => setFailed(true)} className="w-full max-w-lg" />

    case 'pdf':
      return <iframe src={url} title={name} className="h-[70vh] w-full border-0 bg-white" />

    case 'text':
      return <TextPreview url={url} size={size} />

    default:
      return <Unsupported name={name} size={size} reason="No preview for this kind of file." />
  }
}

function TextPreview({ url, size }: { url: string; size: number }): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // A ranged request, so a 2GB log costs the same as a 2KB note.
    fetch(url, { headers: { range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } })
      .then((response) => response.text())
      .then((text) => !cancelled && setContent(text))
      .catch((cause: unknown) => !cancelled && setError(String(cause)))

    return () => {
      cancelled = true
    }
  }, [url])

  if (error) return <p className="text-[12px] text-(--color-danger)">{error}</p>
  if (content === null) return <p className="text-[12px] text-(--color-ink-muted)">Loading…</p>

  const truncated = size > TEXT_PREVIEW_BYTES

  return (
    <div className="h-full w-full self-stretch overflow-auto">
      <pre className="w-full font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap select-text">
        {content}
      </pre>
      {truncated && (
        <p className="mt-3 border-t border-(--color-chrome-border) pt-2 text-[11px] text-(--color-ink-muted)">
          Showing the first {formatBytes(TEXT_PREVIEW_BYTES)} of {formatBytes(size)}. Copy the
          file across to read all of it.
        </p>
      )}
    </div>
  )
}

function Unsupported({
  name,
  size,
  reason
}: {
  name: string
  size: number
  reason: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <FileIcon className="h-16 w-16 text-(--color-ink-muted)" />
      <div>
        <p className="text-[13px] font-medium">{name}</p>
        <p className="text-[12px] text-(--color-ink-muted)">
          {describeKind(name, false)} — {formatBytes(size)}
        </p>
      </div>
      <p className="max-w-sm text-[12px] text-(--color-ink-muted)">{reason}</p>
    </div>
  )
}

function StepButton({
  children,
  label,
  disabled,
  onClick
}: {
  children: React.ReactNode
  label: string
  disabled: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-md p-1 text-(--color-ink-muted) hover:bg-(--color-hover) disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  )
}
