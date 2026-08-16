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

// --- Application icon ------------------------------------------------------------------
//
// The tray mask is 16 pixels wide; scaling it up 64 times would look like exactly what it is.
// The app icon is drawn from polygons instead, supersampled, so the diagonals come out clean.
// electron-builder derives the .ico and .icns from this one file.

const ICON_SIZE = 1024
const SAMPLES = 3

/** Two arrows crossing, in a 0..1 space, matching the tray glyph's idea at a size that can
 *  afford real edges. */
const ARROWS = [
  // Pointing right, upper.
  [
    [0.12, 0.305],
    [0.6, 0.305],
    [0.6, 0.235],
    [0.82, 0.36],
    [0.6, 0.485],
    [0.6, 0.415],
    [0.12, 0.415]
  ],
  // Pointing left, lower.
  [
    [0.88, 0.585],
    [0.4, 0.585],
    [0.4, 0.515],
    [0.18, 0.64],
    [0.4, 0.765],
    [0.4, 0.695],
    [0.88, 0.695]
  ]
]

function insidePolygon(polygon, x, y) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A rounded square, close enough to the shape both platforms expect of an app icon. */
function insideRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, 0, x - (1 - radius))
  const dy = Math.max(radius - y, 0, y - (1 - radius))
  return dx * dx + dy * dy <= radius * radius
}

function renderAppIcon() {
  const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4)

  for (let py = 0; py < ICON_SIZE; py++) {
    for (let px = 0; px < ICON_SIZE; px++) {
      let background = 0
      let glyph = 0

      // Supersample: the only thing separating a drawn icon from a scaled-up mask is what
      // happens along the diagonals.
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / ICON_SIZE
          const y = (py + (sy + 0.5) / SAMPLES) / ICON_SIZE

          if (!insideRoundedSquare(x, y, 0.22)) continue
          background++
          if (ARROWS.some((arrow) => insidePolygon(arrow, x, y))) glyph++
        }
      }

      const total = SAMPLES * SAMPLES
      const alpha = Math.round((background / total) * 255)
      const white = glyph / total

      // A gentle vertical gradient, so the tile does not read as flat colour.
      const shade = py / ICON_SIZE
      const base = [Math.round(30 + 18 * shade), Math.round(108 - 22 * shade), Math.round(255 - 40 * shade)]

      const offset = (py * ICON_SIZE + px) * 4
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = Math.round(base[channel] * (1 - white) + 255 * white)
      }
      pixels[offset + 3] = alpha
    }
  }

  return encodePng(ICON_SIZE, ICON_SIZE, pixels)
}

const BUILD = join(RESOURCES, '..', 'build')
mkdirSync(BUILD, { recursive: true })
writeFileSync(join(BUILD, 'icon.png'), renderAppIcon())
console.log(`build/icon.png  ${ICON_SIZE}x${ICON_SIZE}`)
