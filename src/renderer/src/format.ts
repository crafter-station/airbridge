/** Finder's units: powers of 1000 with one decimal below 10, none above. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`

  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes / 1000
  let unit = 0

  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }

  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const THIS_YEAR = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const OLDER = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
})

/** Today shows a time, this year drops the year, anything older keeps it. */
export function formatDate(epochMs: number): string {
  const date = new Date(epochMs)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  if (sameDay) return `Today ${TIME.format(date)}`
  if (date.getFullYear() === now.getFullYear()) return THIS_YEAR.format(date)
  return OLDER.format(date)
}

const KINDS: Record<string, string> = {
  pdf: 'PDF Document',
  txt: 'Plain Text',
  md: 'Markdown',
  png: 'PNG Image',
  jpg: 'JPEG Image',
  jpeg: 'JPEG Image',
  gif: 'GIF Image',
  svg: 'SVG Image',
  mp4: 'MPEG-4 Movie',
  mov: 'QuickTime Movie',
  mp3: 'MP3 Audio',
  wav: 'WAV Audio',
  zip: 'ZIP Archive',
  dmg: 'Disk Image',
  exe: 'Application',
  app: 'Application',
  json: 'JSON',
  csv: 'CSV Document'
}

export function describeKind(name: string, isDirectory: boolean): string {
  if (isDirectory) return 'Folder'

  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  if (!extension) return 'Document'

  return KINDS[extension] ?? `${extension.toUpperCase()} File`
}

export function joinRemote(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}
