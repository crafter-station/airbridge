# airbridge

Share a folder from Windows to macOS, or the other way round, over your local network. Pick a
folder, and it's live — the other machine sees it in a Finder-like window and drags files out.

No cloud, no accounts, no SMB configuration.

> Status: **M0** — scaffold only. See [PLAN.md](./PLAN.md) for the design and milestones.

## Development

```sh
pnpm install
pnpm dev          # electron-vite dev server with HMR
pnpm build        # typecheck + production bundle into out/
pnpm preview      # run the production bundle
pnpm typecheck
pnpm icons        # regenerate the tray glyph PNGs into resources/
```

### Running two instances on one machine

The protocol needs two peers, so most of it can be tested without a second computer. The single
instance lock is opt-out:

```sh
AIRBRIDGE_ALLOW_MULTI=1 pnpm preview      # bash
$env:AIRBRIDGE_ALLOW_MULTI=1; pnpm preview  # PowerShell
```

## Layout

```
src/main/        Electron main process — server, discovery, shares, tray
src/preload/     The one narrow bridge into the renderer
src/renderer/    React UI
src/shared/      Types and channel names both sides compile against
scripts/         Icon generation
resources/       Tray glyphs, copied next to the app when packaged
```
