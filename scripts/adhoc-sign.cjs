// electron-builder afterPack hook. With no signing identity, the app keeps the ad-hoc
// signature Electron ships with, whose identifier is "Electron" — so macOS files the Local
// Network permission for every unsigned Electron app under one name. Re-signing ad-hoc with
// our bundle id gives the permission something of ours to attach to. Still no certificate.
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    '--identifier',
    context.packager.appInfo.id,
    app
  ])
}
