/**
 * URLs for the preview protocol, built the same way on both sides of the bridge.
 *
 * Paths are base64url because they travel in a URL and may contain a Windows drive letter, a
 * space, a `#` or a `?`. Encoding them removes every one of those questions rather than
 * answering each in two places.
 */

export const PREVIEW_SCHEME = 'airbridge'

export function encodePreviewSegment(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function remotePreviewUrl(deviceId: string, shareId: string, path: string): string {
  return `${PREVIEW_SCHEME}://remote/${deviceId}/${shareId}/${encodePreviewSegment(path)}`
}

export function localPreviewUrl(path: string): string {
  return `${PREVIEW_SCHEME}://local/${encodePreviewSegment(path)}`
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none'

const BY_EXTENSION: Record<string, PreviewKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  bmp: 'image',
  ico: 'image',
  svg: 'image',

  mp4: 'video',
  m4v: 'video',
  webm: 'video',
  mov: 'video',
  ogv: 'video',

  mp3: 'audio',
  m4a: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  aac: 'audio',

  pdf: 'pdf',

  txt: 'text',
  md: 'text',
  markdown: 'text',
  json: 'text',
  csv: 'text',
  tsv: 'text',
  log: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  toml: 'text',
  ini: 'text',
  css: 'text',
  html: 'text',
  js: 'text',
  jsx: 'text',
  ts: 'text',
  tsx: 'text',
  go: 'text',
  rs: 'text',
  py: 'text',
  rb: 'text',
  java: 'text',
  c: 'text',
  h: 'text',
  cpp: 'text',
  cs: 'text',
  sh: 'text',
  sql: 'text'
}

/**
 * What to render for a file.
 *
 * Decided by extension rather than by sniffing content: sniffing means fetching bytes before
 * knowing whether they are worth fetching, which is the opposite of what a preview should do
 * to a 4GB video.
 */
export function previewKind(name: string): PreviewKind {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return BY_EXTENSION[extension] ?? 'none'
}

/** How much of a text file to read. Enough to be useful, small enough to stay instant. */
export const TEXT_PREVIEW_BYTES = 256 * 1024
