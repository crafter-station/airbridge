// electron-builder afterPack hook for macOS. Two things, both about how macOS recognises the
// app when it decides on Local Network access, since there is no Developer ID to do it:
//
// 1. The executable's LC_UUID. Every app built on the same Electron release ships the same
//    prebuilt binary, so they share one UUID — and for an app with no team id, Local Network
//    privacy looks the app up by that UUID. It found another Electron app on the machine,
//    applied *its* answer, and never listed or asked about airbridge. A UUID derived from our
//    bundle id is ours alone, and stays the same across versions so the answer survives
//    updates.
// 2. The signature. Without an identity the app keeps the ad-hoc signature Electron ships
//    with, identified as "Electron". Re-signing ad-hoc names it after our bundle id. Still no
//    certificate; it has to happen after (1), since patching the binary breaks the signature.
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const LC_UUID = 0x1b
const MH_MAGIC_64 = 0xfeedfacf
const FAT_MAGIC = 0xcafebabe

/** Rewrite LC_UUID in one 64-bit Mach-O image starting at `base`. */
function patchImage(buffer, base, uuid) {
  if (buffer.readUInt32LE(base) !== MH_MAGIC_64) throw new Error('Not a 64-bit Mach-O image')

  const commands = buffer.readUInt32LE(base + 16)
  let offset = base + 32
  for (let index = 0; index < commands; index++) {
    const command = buffer.readUInt32LE(offset)
    if (command === LC_UUID) {
      uuid.copy(buffer, offset + 8)
      return
    }
    offset += buffer.readUInt32LE(offset + 4)
  }
  throw new Error('No LC_UUID load command')
}

function patchUuid(executable, uuid) {
  const buffer = readFileSync(executable)

  if (buffer.readUInt32BE(0) === FAT_MAGIC) {
    const count = buffer.readUInt32BE(4)
    for (let index = 0; index < count; index++) {
      // Each fat_arch entry is 20 bytes; the image offset is its third field.
      const imageOffset = buffer.readUInt32BE(8 + index * 20 + 8)
      // Each architecture gets its own UUID, as a real universal build has.
      const perArch = Buffer.from(uuid)
      perArch[15] ^= index
      patchImage(buffer, imageOffset, perArch)
    }
  } else {
    patchImage(buffer, 0, uuid)
  }

  writeFileSync(executable, buffer)
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const { appInfo } = context.packager
  const app = join(context.appOutDir, `${appInfo.productFilename}.app`)

  // An RFC 4122 name-based UUID shape, so tools that print it do not choke on it.
  const uuid = createHash('sha256').update(appInfo.id).digest().subarray(0, 16)
  uuid[6] = (uuid[6] & 0x0f) | 0x50
  uuid[8] = (uuid[8] & 0x3f) | 0x80
  patchUuid(join(app, 'Contents', 'MacOS', appInfo.productFilename), uuid)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', appInfo.id, app])
}
