# End-to-End Testing (Phase 1) — Design

Status: approved 2026-07-02

## Problem

Three test layers exist (Rust backend integration, frontend pure logic, frontend
component tests with mocked IPC), but nothing exercises the real stack end to
end: real webview → real Tauri IPC → real libgit2 backend → real repository on
disk. Regressions in wiring (command registration, serde shape drift between
Rust and TS, store-to-IPC glue) only surface when a human runs the app.

CLAUDE.md previously recorded that webview-level E2E was impossible on macOS
because Tauri's WebDriver bridge lacked macOS support. That is no longer true:
the WebdriverIO Tauri service now ships an **embedded WebDriver provider**
(`tauri-plugin-wdio-webdriver`) that runs inside the app itself and supports
macOS, Linux, and Windows without external drivers or paid services.

## Goals

- Real E2E: launch the actual debug binary, drive the real webview, hit the
  real libgit2 backend against real temp repositories.
- Run locally on macOS (primary dev machine) and on Linux CI.
- Cover the highest-risk surface first: repo open, status, staging, commit,
  branches, stash, history, diff (the "Phase 1" slice).
- Keep app-code changes minimal and debug-build-only.

## Non-goals

- Conflict/rebase/reset/cherry-pick flows (Phase 2).
- Remote operations, command palette, settings persistence (Phase 3).
- Pixel-level assertions on the commit graph — assert structure (row counts,
  labels), not rendering.
- Windows coverage. Nothing precludes it later; not wired in this slice.
- macOS CI runner — local macOS runs cover WKWebView; CI uses Linux.

## Stack decision

**Chosen: WebdriverIO + `@wdio/tauri-service` (v1.2+) with the embedded
provider.** Official recommended path in Tauri docs; free; actively maintained;
macOS + Linux + Windows from one config; tests can also invoke Tauri commands
directly when needed.

Alternatives considered:

- `tauri-plugin-playwright` — better DX (locators, auto-wait, traces) but
  v0.4.x with frequent breaking changes, single maintainer, and requires
  `withGlobalTauri: true`. Revisit if it matures.
- Playwright against headless Chromium with mocked IPC — not E2E; duplicates
  the existing vitest component layer. Rejected.
- CrabNebula tauri-driver — macOS support requires a paid API key. Kept as
  fallback if the embedded provider proves unworkable.

## Architecture

```
e2e/
├── wdio.conf.ts          WDIO config; tauri service launches the debug binary
├── tsconfig.json         Node-side TS config for specs (separate from app tsconfig)
├── specs/
│   ├── smoke.e2e.ts          launch, Welcome renders, open repo via recents
│   ├── status-stage.e2e.ts   status buckets, stage/unstage, discard
│   ├── commit.e2e.ts         commit staged → log grows, status clean
│   ├── branches.e2e.ts       create/checkout branch, titlebar chip updates
│   ├── stash.e2e.ts          stash save → clean, pop → changes return
│   └── history-diff.e2e.ts   graph rows on branchy fixture, diff view, stage hunk
└── support/
    ├── tempRepo.ts       Node port of the Rust TempRepo fixture
    └── app.ts            seedRecents(path), openRepoViaRecents(), resetApp()
```

- `pnpm test:e2e` is `test:e2e:build && test:e2e:run`. `test:e2e:build` runs
  `pnpm tauri build --debug --no-bundle --features tauri/custom-protocol
  --config src-tauri/tauri.e2e.conf.json` (the config overlay turns on
  `withGlobalTauri` for this build only) and copies the resulting binary to
  gitignored `e2e/.bin/`. `test:e2e:run` runs `wdio run e2e/wdio.conf.ts`
  against that snapshot — use it standalone for spec-only iteration.
- Mocha framework (WDIO default), `expect-webdriverio` assertions.
- E2E specs are excluded from vitest globs and from the app `tsconfig`.

## App changes (all minimal)

1. **Rust:** add `tauri-plugin-wdio-webdriver` as a dependency and register it
   in `lib.rs` behind `#[cfg(debug_assertions)]`. Release builds contain no
   trace of it.
2. **Capabilities:** add the plugin's permissions to
   `capabilities/default.json`. Permissions for an unregistered plugin are
   inert in release builds.
3. **Selectors:** add `data-testid` attributes where text/structure selectors
   would be brittle: Welcome recent rows, status file rows, stage/unstage
   controls, commit button, titlebar branch chip, history commit rows.
   Behavior untouched.

## Repo-open seam

E2E cannot drive the native directory picker. No test-only code path is added
to the app; instead tests use the existing recents mechanism:

1. Test creates a temp repo on disk (`tempRepo.ts`).
2. `browser.execute` writes `localStorage["pg-recent-repos"]` with the repo path.
3. Reload the webview; Welcome now lists the repo under Recent.
4. Click the recent row — this runs the real `openRepo` store action through
   real IPC into the real backend.

## Fixtures

`e2e/support/tempRepo.ts` mirrors `src-tauri/tests/support/` in Node:
`mkdtemp` + shelling out to `git` (init, config user, add, commit, branch,
checkout, merge). Phase 1 needs three shapes:

- **basic** — a few commits on main, clean tree.
- **dirty** — modified + untracked + staged files in known states.
- **branchy** — main plus a merged feature branch, for graph assertions.

## Isolation

- Fresh temp repo per test; temp dirs removed in `afterEach`.
- Between tests: clear localStorage, reset app to Welcome (`resetApp()` —
  reload webview).
- One app session per spec file (service restarts the binary per spec).

## Test cases (Phase 1)

1. App launches; Welcome screen renders.
2. Open repo via seeded recents → RepoBrowser shows the file tree.
3. Status buckets correct for the dirty fixture (modified / untracked / staged).
4. Stage a file → moves to staged; unstage → moves back.
5. Discard a modified file via the file context menu → change gone on disk.
   (File-level discard has no confirm dialog; hunk-level discard's native
   confirm is stubbed via window.confirm override.)
6. Commit staged changes → new commit at top of log, status clean, message matches.
7. Create branch → titlebar chip shows it; checkout previous branch → chip updates.
8. Stash save → status clean; stash pop → changes return.
9. History on branchy fixture → expected number of commit rows, graph present.
10. Open diff for a modified file → hunk visible; stage the hunk → status reflects it.

## CI

New `.github/workflows/e2e.yml`:

- `ubuntu-latest`, on PRs to `main`.
- Install webkit2gtk + Tauri Linux system deps; pnpm + Rust toolchain caches.
- `pnpm test:e2e:build` to produce the debug binary, then
  `xvfb-run --auto-servernum pnpm test:e2e:run` to run WDIO against it
  (split into two steps so a build failure and a test failure are
  distinguishable in the CI log).

## Documentation updates

- CLAUDE.md testing section: replace the "no macOS WebDriver" paragraph with
  the four-layer picture (add E2E layer + how to run it).

## Risks

- Embedded provider is young (mid-2025). If launch/config fights back, the
  same specs run against the CrabNebula provider or Linux-only CI as fallback.
- WDIO adds a second test runner next to vitest. Accepted: different layer,
  different lifecycle (needs a built binary).
- Timing flakiness in a real webview. Mitigation: `waitUntil`-style assertions
  everywhere, no fixed sleeps.
