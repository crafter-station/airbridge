# airbridge

An Electron menu-bar/tray app for Windows and macOS. Publish a local folder in one click; any
paired machine on the LAN browses it and copies files out. Symmetric — both machines do both.

## Architecture

The main process owns everything stateful:

| Piece | Responsibility |
| --- | --- |
| Fastify HTTPS server | Serves shares. Self-signed cert generated on first run, persisted. |
| Discovery | `bonjour-service`, advertises `_airbridge._tcp` on physical interfaces only. |
| Share registry | Published folders and their writable flag. |
| Trust store | Paired devices, keyed on UUID + cert fingerprint (`electron-store`). |
| Watcher | `chokidar` per share, debounced, pushed over WebSocket. |
| Transfer engine | Download queue, 4 concurrent, resume, collision handling. |
| Tray / menu bar | Window close hides; sharing continues; quit is explicit. |

The preload exposes a narrow typed IPC bridge. The renderer is React + Tailwind, Zustand for UI
state, TanStack Query for both remote and local directory listings.

## Protocol

The mDNS TXT record carries `uuid`, `name`, `v` (protocol version) and `fp` (SHA-256 cert
fingerprint). Fixed port 45789, falling back upward if taken.

```
POST   /pair                    → host shows native Allow/Deny, returns bearer token
GET    /shares                  → [{ id, name, writable, available }]
GET    /shares/:id/list?path=   → [{ name, kind, size, mtime }]
GET    /shares/:id/file?path=   → stream, honours Range
PUT    /shares/:id/file?path=   → upload   (writable shares only)
DELETE /shares/:id/file?path=   → delete   (writable shares only)
WS     /events                  → filesystem change push
```

Every route except `/pair` requires `Authorization: Bearer`. Every `path` is resolved and verified
to sit inside the share root before any I/O. The client pins the cert fingerprint recorded at
pairing; a mismatch is a hard failure, never a re-prompt.

Connections are mutually authenticated. Every peer presents its own certificate, and the server
checks that the certificate on the connection is the one pinned for the token's owner — so a
stolen token alone gets nowhere. `/pair` relies on the same thing: the fingerprint in the request
body is only a claim, and the fingerprint is broadcast in the mDNS record, so anyone on the
network could assert it. Only the machine holding the private key can present it.

## Transfers

Folders copy recursively, four files at a time. Each file streams to `name.airbridge-part` and is
atomically renamed on completion, so an interrupted transfer never leaves something that looks
finished. Retry resumes via `Range` from the bytes already on disk. Name collisions raise Finder's
dialog — *Keep Both* / *Replace* / *Skip*, with apply-to-all.

## UI

Single window, Finder-flavoured: source list sidebar (devices → their shares, plus your own
published folders), toolbar with back/forward/breadcrumb and a view switcher, List and Icon views
only. The local pane slides in from the right on toolbar toggle or when a drag starts, and
remembers its state. Dragging between panes is ordinary HTML5 drag-and-drop inside the window, so
it is instant and involves no OS drag. Dotfiles hidden by default; symlinks not followed past the
share root.

## Milestones

Vertical slice first — the risk is in transport and discovery, not CSS.

- [x] **M0 — Scaffold.** electron-vite + React + TS + pnpm, tray/menu bar, builds on both platforms.
- [x] **M1 — Server.** Publish a folder, list and stream it over HTTPS, hardcoded trust. Two
      instances on Windows, different ports.
- [x] **M2 — Discovery + pairing.** mDNS with adapter filtering, approval dialog, UUID+fingerprint
      trust store, Connect-by-IP fallback. *First real Mac smoke test lands here.*
- [x] **M3 — Transfers.** Recursive folder copy, `.part` + atomic rename, Range resume, collisions,
      progress.
- [ ] **M4 — Finder UI.** Sidebar, List/Icon views, toolbar, local pane drawer, cross-pane drag.
- [ ] **M5 — Live.** chokidar → WebSocket, unavailable-share handling.
- [ ] **M6 — Write + ship.** Per-share write toggle, upload/delete, CSP and sandbox hardening, app
      icon, unsigned packaged builds for both OSes.

## Decisions

Recorded from the design interview, with the reasoning that survives the choice.

| # | Decision | Why |
| --- | --- | --- |
| Q1 | Own HTTP server, not native SMB or WebDAV | Only option where "select folder → it's alive" is one click on both platforms, with no admin rights. WebDAV mounting stays available as a later additive change. |
| Q3 | Pull only, but symmetric | Both machines publish and both browse. Push is a separate UI surface and protocol path. |
| Q4 | Write access behind a per-share toggle, off by default | Cheap over HTTP, makes the app feel like a real drive; default-off means an accidental share cannot be trashed remotely. |
| Q5 | Shares are live, never snapshots | Server reads the directory on request; no index to go stale. |
| Q6 | Finder-flavoured, List + Icon views only | Column view is the expensive one and the least useful for a flat share. |
| Q7 | Per-connection approval, not PIN pairing | One click on the machine already in front of you beats reading a code off one screen and typing it into another. |
| Q8 | Two-pane file manager | Electron's `startDrag` needs the file on disk *before* the drag begins, and it does not expose the OS promised-file APIs. Dragging between our own panes sidesteps that entirely — and shows source and destination at once. |
| Q9 | Lives in the tray / menu bar | Closing the window must not stop sharing. |
| Q10 | Many simultaneous shares | The registry is a map either way; one-at-a-time means constantly re-picking folders. |
| Q13 | HTTPS, self-signed, fingerprint pinned at approval | One dependency and an afternoon, and the difference between safe at home and safe anywhere. |
| Q14 | Recursive folder copy, not zip-stream | Resume and honest per-file progress beat throughput on small files. |
| Q17 | Loopback-first testing | Two instances on Windows catch essentially all protocol bugs; platform-specific branches stay isolated and small. |
| Q18 | Unsigned builds for v1 | A one-time Gatekeeper right-click against $200/yr and a day of CI plumbing. |
| Q19 | Filter virtual adapters, plus Connect-by-IP | mDNS on `172.17.x.x` is invisible to the LAN; the manual fallback makes discovery failure an annoyance rather than a dead end. IPv4 only. |
| Q20 | Missing shares go "Unavailable", not deleted | An unplugged drive should not silently cost you a share set up weeks ago. |
| Q21 | Trust keyed on UUID + cert fingerprint | DHCP reassigns addresses; keying on IP means either re-approving forever or trusting whoever inherits it. |

## Deferred, not forgotten

Push-to-device, WebDAV mounting for true drag into Finder, launch-at-login, code signing and
notarisation.

## Known risks

- **mDNS on the target network** is the top risk and cannot be reproduced on one machine.
  Connect-by-IP exists so discovery failure is never fatal.
- **Windows Defender** prompts on first listen and needs the network profile set to Private.
- **Cert pinning in Node** requires a custom HTTPS agent rather than plain `fetch` — small, but
  easy to get subtly wrong.
- **chokidar on very large trees** can be heavy; may need to fall back to polling only the open
  directory.
