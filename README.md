# airbridge

Share a folder from Windows to macOS, or the other way round, over your local network. Pick a
folder, and it's live — the other machine sees it in a Finder-like window and drags files out.

No cloud, no accounts, no SMB configuration.

> Status: **v1 complete** — all six milestones in [PLAN.md](./PLAN.md) are done. Builds are
> unsigned, so the first launch needs a right-click → Open on macOS and a "Run anyway" on
> Windows.

## Install

The repository is private, so both paths below need you signed in — `gh auth login` for the
prebuilt one, ordinary git credentials for the source one.

### Windows — prebuilt, one line

Downloads the latest release, unpacks it to `%LOCALAPPDATA%\Programs\airbridge`, and runs it.
Needs [GitHub CLI](https://cli.github.com).

```powershell
gh release download --repo crafter-station/airbridge --pattern "*win.zip" --dir "$env:TEMP\airbridge-dl" --clobber; Expand-Archive (Get-ChildItem "$env:TEMP\airbridge-dl\*.zip").FullName "$env:LOCALAPPDATA\Programs\airbridge" -Force; & "$env:LOCALAPPDATA\Programs\airbridge\airbridge.exe"
```

### macOS — from source, one line

There is no macOS binary in the release: electron-builder cannot cross-build a `.dmg` from
Windows, which is where this was developed. So the Mac installs by building, which needs
[bun](https://bun.sh) and git. It ends by opening the `.dmg` for you to drag across.

```sh
git clone https://github.com/crafter-station/airbridge.git ~/airbridge && cd ~/airbridge && bun install && bun run package && open dist/*.dmg
```

To just run it without installing, swap the tail for `bun run build && bun run preview`.

The same line works on Windows in PowerShell 7 (`pwsh`), producing an installer in `dist\`:

```powershell
git clone https://github.com/crafter-station/airbridge.git $HOME\airbridge && cd $HOME\airbridge && bun install && bun run package && ii dist
```

> Windows PowerShell 5.1 has no `&&`. Use `pwsh`, or replace each `&&` with `;`.

Any of pnpm, npm or bun will do — no script shells out to a particular one. bun is suggested
only because it installs fastest.

## How it works

Each machine runs a small HTTPS server and advertises itself over mDNS. Connecting asks the
other machine to approve, once; after that both sides hold a token *and* the certificate
fingerprint they saw, and every later request has to present both. Nothing leaves your network,
and there is no account anywhere.

Published folders are live — the server reads the directory when asked, and a file watcher
pushes changes so the other window updates without a refresh. Copying drags between the two
panes rather than out to Finder, because Electron cannot start an OS drag for a file that is
still on the far machine.

The window follows your system appearance. There is no theme switch, deliberately — the OS
already has one.

## Preview

Double-click a file, or select it and press **Space**. ← and → step through the folder; **Esc**
closes.

Images, video, audio, PDFs and text all render in place. Nothing is downloaded to do it: media
elements are pointed at an internal protocol that forwards byte-range requests to the other
machine, so a 4GB video opens as fast as a 4KB one and seeking fetches only the window around
the playhead. Text is capped at 256KB, because a `.log` can be enormous.

## Building

```sh
pnpm package        # installer for the current platform, into dist/
pnpm package:dir    # unpacked build, faster, for checking it runs
```

macOS builds have to be made on a Mac — electron-builder cannot produce a `.dmg` from Windows.

## Development

Any package manager works. If you use **pnpm** it must be **11** — the lockfile and
`pnpm-workspace.yaml` use fields pnpm 9 rejects outright. The version is pinned in
`package.json`, so `corepack pnpm …` fetches the right one without touching your global
install. `bun install` and `npm install` need no such care.

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

## Looking at the UI

```sh
pnpm demo [folder]     # two pre-paired instances sharing a fixture folder
```

Pairing needs someone to click Allow and each instance needs the other's certificate before it
can be trusted, so `demo` runs them once to mint identities, cross-seeds the trust stores, then
starts them for real. Both expose a DevTools port (host 9333, guest 9334) because synthetic
OS-level clicks do not reach an Electron window reliably:

```sh
node scripts/uishot.mjs 9334 shot.png "text:Work" "wait:table" "click:[title='Icon view']"
```

Steps run in order — `click:SELECTOR`, `text:EXACT TEXT`, `dblclick:`, `wait:`, `sleep:`, `eval:`,
`evalfile:` — and the page is captured at the end.

## Environment variables

| Variable | Effect |
| --- | --- |
| `AIRBRIDGE_DATA_DIR` | Use a specific userData directory. Two instances otherwise share one, giving them the same identity and certificate. |
| `AIRBRIDGE_ALLOW_MULTI=1` | Skip the single-instance lock. |
| `AIRBRIDGE_HEADLESS=1` | Start without showing a window. |
| `AIRBRIDGE_BIND` | Address to listen on. Defaults to `0.0.0.0`; `127.0.0.1` keeps local work off the LAN and away from the firewall prompt. |
| `AIRBRIDGE_NO_DISCOVERY=1` | Skip mDNS. Peers with a remembered address still work. |

These three bypass a decision a person is supposed to make, so they additionally require an
unpackaged build and do nothing at all in a shipped app:

| Variable | Effect |
| --- | --- |
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
