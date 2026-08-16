# airbridge

Share a folder from Windows to macOS, or the other way round, over your local network. Pick a
folder, and it's live — the other machine sees it in a Finder-like window and drags files out.

No cloud, no accounts, no SMB configuration.

> Status: **M3** — pairing, browsing and copying work; the Finder UI lands in M4. See
> [PLAN.md](./PLAN.md) for the design and milestones.

## Development

```sh
pnpm install
pnpm dev          # electron-vite dev server with HMR
pnpm build        # typecheck + production bundle into out/
pnpm preview      # run the production bundle
pnpm typecheck
pnpm test         # smoke + loopback (needs pnpm build first)
pnpm icons        # regenerate the tray glyph PNGs into resources/
```

## Tests

Two suites, both driving real running instances rather than mocks.

- **`pnpm smoke`** starts one instance and talks HTTPS at it as a second device, using a
  certificate it generates itself. Covers auth, pairing rejections, listing, ranged streaming and
  every path-containment case.
- **`pnpm loopback`** starts *two* instances and has one pair with, browse and copy from the
  other, then checks the bytes that landed on disk. This is the only way to exercise the client
  half — pairing, certificate pinning, token exchange, resume, collision naming, streaming to
  disk — since it runs inside the main process where a test harness has no reach.

## Environment variables

All development-only. Everything below the first row is additionally gated on the build being
unpackaged, so none of it can be switched on against a shipped app.

| Variable | Effect |
| --- | --- |
| `AIRBRIDGE_DATA_DIR` | Use a specific userData directory. Two instances otherwise share one, giving them the same identity and certificate. |
| `AIRBRIDGE_ALLOW_MULTI=1` | Skip the single-instance lock. |
| `AIRBRIDGE_HEADLESS=1` | Start without showing a window. |
| `AIRBRIDGE_AUTO_APPROVE=1` | Approve inbound pairing requests without prompting. Set this on the machine being *asked*. |
| `AIRBRIDGE_COLLISION_POLICY` | `keep-both`, `replace`, `skip` or `cancel` — answer every name collision this way instead of prompting. |
| `AIRBRIDGE_SELFTEST_TARGET` | `host:port` — pair, browse and copy from that peer at startup, print the result, then quit. |

## Layout

```
src/main/        Electron main process — server, discovery, shares, transfers, tray
src/preload/     The one narrow bridge into the renderer
src/renderer/    React UI
src/shared/      Types, channel names and wire constants both sides compile against
scripts/         Icon generation and the test suites
resources/       Tray glyphs, copied next to the app when packaged
```
