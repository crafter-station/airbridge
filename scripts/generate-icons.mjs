/**
 * Renders the tray glyph — two arrows crossing, ⇄ — into the PNGs the tray needs.
 *
 * Tray icons are tiny and monochrome, so the source of truth is a hand-placed pixel mask
 * rather than a vector file: at 16px an SVG rasteriser's guesses are worse than ours.
 * Larger sizes are integer-scaled from the same mask so they stay crisp.
 *
 *   node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const RESOURCES = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

// prettier-ignore
const GLYPH = [
  '................',
  '................',
  '.........#......',
  '.........###....',
  '..############..',
  '..############..',
  '.........###....',
  '.........#......',
  '......#.........',
  '....###.........',
  '..############..',
  '..############..',
  '....###.........',
  '......#.........',
  '................',
  '................'
]

const SIZE = GLYPH.length

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Minimal 8-bit RGBA PNG. `pixels` is a flat RGBA byte array of width * height * 4. */
function encodePng(width, height, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA

  // Every scanline carries a leading filter byte; 0 means "no filtering", which costs a
  // little size and saves a lot of code for images this small.
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0
    pixels.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function render(scale, [r, g, b]) {
  const size = SIZE * scale
  const pixels = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const lit = GLYPH[Math.floor(y / scale)][Math.floor(x / scale)] === '#'
      const offset = (y * size + x) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = lit ? 255 : 0
    }
  }

  return encodePng(size, size, pixels)
}

const BLACK = [0, 0, 0]
const WHITE = [255, 255, 255]

const outputs = [
  // macOS inverts template images for us, so one black glyph covers both menu bar themes.
  ['trayTemplate.png', 1, BLACK],
  ['trayTemplate@2x.png', 2, BLACK],
  // Windows gets no such help: tray.ts picks the file that contrasts with the taskbar.
  ['tray-black.png', 1, BLACK],
  ['tray-black@2x.png', 2, BLACK],
  ['tray-white.png', 1, WHITE],
  ['tray-white@2x.png', 2, WHITE]
]

mkdirSync(RESOURCES, { recursive: true })
for (const [name, scale, colour] of outputs) {
  writeFileSync(join(RESOURCES, name), render(scale, colour))
  console.log(`resources/${name}  ${SIZE * scale}x${SIZE * scale}`)
}
