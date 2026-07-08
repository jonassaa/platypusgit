# Update prompt — design

Status: approved
Date: 2026-07-08

## Goal

When a newer PlatypusGit release exists, prompt the user smoothly to update.
Respect how each platform is actually distributed: Homebrew and `.deb` are
package-managed and must not be hijacked; Windows `.msi` and Linux AppImage are
direct-download and can self-update in place.

## Distribution reality (constraints)

- **macOS** — universal `.dmg`, ad-hoc signed, **not notarized**, primary channel
  is the **Homebrew cask** (`jonassaa/homebrew-platypusgit`). Same `.dmg` may also
  be drag-installed. Self-updating a Homebrew install desyncs `brew`'s bookkeeping
  and the un-notarized self-update path is fragile → **notify-only on all macOS**.
- **Windows** — `.msi`. Direct download → **self-update**.
- **Linux** — `.deb` (package-managed → notify) and `.AppImage` (direct → self-update).
- Releases are cut by publishing a GitHub Release (`vX.Y.Z`); CI builds bundles and
  attaches them. Version is injected from the tag at build time; dev builds are `0.0.0`.

## Behavior split (hybrid)

| Platform / channel        | Capability    | Action offered                                    |
|---------------------------|---------------|---------------------------------------------------|
| Windows `.msi`            | `self-update` | In-app download + install + relaunch              |
| Linux AppImage            | `self-update` | In-app download + install + relaunch              |
| macOS (Homebrew or `.dmg`)| `notify`      | Open release page; show `brew upgrade` hint       |
| Linux `.deb`              | `notify`      | Open release page                                 |
| Dev (`0.0.0`)             | n/a           | No prompt                                         |

Capability is computed at runtime in the backend:

- `windows` → `self-update`
- `macos` → `notify`
- `linux` and `APPIMAGE` env var set → `self-update`
- `linux` and no `APPIMAGE` (`.deb`/dev) → `notify`

## Two data sources, deliberately separated

1. **Discovery (all platforms).** Backend queries the GitHub REST API
   `GET /repos/jonassaa/platypusgit/releases/latest` and semver-compares the tag to
   the running version. This decides *whether to prompt* and supplies version, notes,
   release URL, publish date. It is an unauthenticated public GET — it only drives UI,
   never installs a binary, so it does not need to be signed. Unauthenticated GitHub
   rate limit (60/hr/IP) is ample for a startup + manual check.

2. **Secure install (self-update platforms only).** `tauri-plugin-updater` performs
   its *own* check against a **minisign-signed `latest.json`** manifest, verifies the
   signature, downloads, installs, and relaunches. The actual binary swap is always
   signature-verified. Discovery and install can momentarily disagree only if the
   manifest asset is missing; CI produces both in the same release, so they align.

Rationale: one uniform discovery path gives consistent UX on every platform, while
the security-critical install step stays behind the updater's signature verification.
Notify-only platforms defer trust to the OS package manager / user's own download.

## Check cadence

- **On startup**: one check ~2s after launch, debounced, non-blocking. Errors
  (offline, rate limit) are swallowed — no banner, no noise.
- **Manual**: a "Check for updates" button in Settings. Manual-check errors *are*
  surfaced (user asked).
- No periodic background timer (YAGNI — dev tool restarted often).

## UI surface

- **Titlebar chip** — `⬆ <version>` shown whenever an update is available. Ambient,
  non-blocking reminder. Clicking opens the update panel.
- **Update panel** — version, release notes (from GitHub release body), and the
  primary action:
  - `self-update`: **Install** (drives download w/ progress → relaunch).
  - `notify`: **View release** (opens `releaseUrl`); macOS additionally shows a
    copyable `brew upgrade platypusgit` hint.
  - **Later / dismiss** — hides the panel.
- **Dismiss memory** — dismissed version persisted to `localStorage["pg-update-dismissed"]`.
  Panel won't auto-nag again for that same version; the chip still shows as an ambient
  reminder. A *newer* release than the dismissed one re-nags.
- **Settings → Updates section** — shows current app version (the app surfaces none
  today), the manual check button, and the latest-known status.

## Architecture

### Backend (`src-tauri/src/`)

- `commands/update.rs` (new):
  - `check_for_update() -> UpdateInfo` — fetch latest release, semver-compare, build
    `UpdateInfo`. Returns `available: false` when running version is `0.0.0` (dev) or
    when latest ≤ current. Network/parse work wrapped in `tokio::task::spawn_blocking`.
  - `get_update_capability() -> UpdateCapability` — `"self-update" | "notify"` from
    OS + `APPIMAGE` env.
- HTTP: add `ureq` (blocking, rustls) for the GitHub GET — avoids pulling in heavy
  reqwest/native-tls; runs inside `spawn_blocking`.
- Version-compare + capability are pure helpers, unit-testable without network. The
  JSON→`UpdateInfo` mapping is a pure function fed a fixture in tests.
- `error.rs`: add `AppError::Network` variant (network failure / non-2xx / parse).
  No `unwrap`/`panic` in the command.
- `lib.rs`: register `check_for_update`, `get_update_capability` in `invoke_handler!`;
  register `tauri_plugin_updater::Builder` and `tauri_plugin_process` plugins.
- `Cargo.toml`: add `tauri-plugin-updater`, `tauri-plugin-process`, `ureq`.
  Stub the two new ops? — these are commands, not `GitBackend` trait methods, so no
  `CliBackend` stub is needed.

### Config & permissions

- `tauri.conf.json` → `plugins.updater`:
  ```json
  {
    "endpoints": ["https://github.com/jonassaa/platypusgit/releases/latest/download/latest.json"],
    "pubkey": "<minisign public key>"
  }
  ```
- `capabilities/default.json`: add `updater:default`, `process:allow-restart`.

### Frontend (`src/`)

- `features/update/` (new):
  - `useUpdateStore` (Zustand): `{ status, info, capability, dismissedVersion,
    progress, error }`. Actions:
    - `check(manual: boolean)` — calls `checkForUpdate()`; on `manual` surfaces errors,
      on startup swallows them.
    - `install()` — self-update only: `@tauri-apps/plugin-updater` `check()` →
      `downloadAndInstall(onProgress)` → `@tauri-apps/plugin-process` `relaunch()`.
    - `openReleasePage()` — notify: open `info.releaseUrl`.
    - `dismiss()` — set `dismissedVersion = info.latestVersion`, persist, hide panel.
  - `UpdateChip.tsx` — titlebar chip.
  - `UpdatePanel.tsx` — notes + action + dismiss; renders `brew upgrade` hint on macOS.
- `AppShell.tsx` — mount chip in titlebar; startup-check effect (2s debounce,
  non-blocking); route chip click → panel open.
- `screens/Settings.tsx` — Updates section: current version, manual check button, status.
- `lib/tauri.ts` — `checkForUpdate()`, `getUpdateCapability()` typed wrappers (frontend
  never calls `invoke` directly). The updater/process plugin JS APIs are used directly
  in the store (they are the plugins' public API).
- `lib/types.ts` — `UpdateInfo`, `UpdateCapability`.
- `lib/errors.ts` — add `Network` to the `AppError` union (1:1 with Rust).

### CI (`.github/workflows/release.yml`)

- **One-time human setup** (not automatable by the assistant — see Open items):
  - `pnpm tauri signer generate` → produces a minisign keypair.
  - Add `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as repo
    secrets. Put the public key in `tauri.conf.json` `plugins.updater.pubkey`.
- **windows** and **linux** jobs: export the two signing env vars before `tauri build`.
  With signing configured, the build emits updater artifacts + `.sig` files
  (`.msi` + `.msi.sig`, `.AppImage` + `.AppImage.sig`).
- **New `updater-manifest` job** (needs windows + linux): assemble `latest.json`:
  ```json
  {
    "version": "X.Y.Z",
    "notes": "<release notes>",
    "pub_date": "<RFC3339>",
    "platforms": {
      "windows-x86_64": { "signature": "<msi .sig>", "url": "<msi asset URL>" },
      "linux-x86_64":   { "signature": "<AppImage .sig>", "url": "<AppImage asset URL>" }
    }
  }
  ```
  Attach `latest.json` to the release. macOS is intentionally absent (notify-only).
  URLs point at the stable-named release assets already produced.
- macOS `.dmg`, Homebrew cask bump, and `.deb` flow are unchanged.

## Testing

- **Rust** (`cargo test`): unit-test semver-compare (older/newer/equal/`0.0.0`),
  capability computation (mock OS + `APPIMAGE`), and JSON→`UpdateInfo` parse from a
  committed fixture. No network in tests.
- **Frontend** (`pnpm test`): component tests — chip renders only when `available`;
  dismiss persists and suppresses re-nag for same version but not a newer one;
  capability drives the action label ("Install" vs "View release"); `mockInvoke`
  stubs `check_for_update` / `get_update_capability`.
- **E2E** (`e2e/specs/`): one spec — stub the invoke responses so chip + panel render;
  assert self-update vs notify copy. Kept minimal; real network is not reachable in
  e2e, and the updater install path is not exercised (no signed manifest in the test
  binary).

## Security posture

- Discovery GET is unsigned but only toggles UI; it can never trigger a binary swap.
- Every self-update install is minisign-verified by `tauri-plugin-updater` against the
  configured public key before it touches disk.
- Notify-only platforms never download a binary in-app; trust defers to Homebrew / apt
  / the user's manual download.

## YAGNI / out of scope

- No periodic background update timer.
- No macOS Homebrew-Caskroom detection / macOS self-update.
- No delta/differential updates.
- No auto-install-on-quit; install is always user-initiated.

## Open items (human, before self-update goes live)

1. Generate the minisign keypair and add `TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repo secrets; paste the public key into
   `tauri.conf.json`. Until done, self-update is dormant (updater check fails
   quietly); **notify-only works immediately on every platform**.
