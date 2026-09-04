# Multiple windows — implementation plan (#256)

Spec: `docs/superpowers/specs/2026-09-04-multiple-windows-spec.md`

One PR. The pieces are small individually but land together: half of them are
correctness fixes that only matter *because* the other half exists (a per-window
watcher is pointless without a second window, and a second window is broken
without it).

## 1. Backend — `src-tauri/src/windows.rs` (new)

- `REPO_WINDOW_PREFIX = "pg-"`, `MAIN_WINDOW = "main"`, `MERGE_WINDOW = "merge"`.
- `is_repo_window(label)` — `main` or `pg-*`. The merge resolver is not one.
- `WindowRegistry` (managed state):
  - `repos: Mutex<HashMap<String, Vec<WindowRepo>>>` — label → `{ id, path }`.
  - `focused: Mutex<Option<String>>` — last repository window to take focus.
  - `register(label, repos)`, `take(label) -> Vec<WindowRepo>`, `note_focus(label)`.
  - `route(&self, path, live: &[String]) -> Option<String>` — pure routing: a
    live window holding `path`, else the last-focused live one, else the first
    live one sorted. Unit-tested without a Tauri app.
  - `next_label(&self, live: &[String]) -> String` — lowest free `pg-N`.
- Commands (`commands/windows.rs`): `register_window_repos`, `next_window_label`,
  `focus_window`.

## 2. Backend — wiring in `lib.rs`

- `.manage(WindowRegistry::default())`.
- `.on_window_event` → `Focused(true)` records focus; `Destroyed` runs
  `windows::on_window_destroyed`: take the registry entry, `backend.close` each
  `RepoId`, `terminal` close each, `watcher.stop(label)`, then — only if another
  repository window survives — `emit_to(survivor, "window://closed", label)`.
- single-instance handler: route the intent with `registry.route(...)`,
  `emit_to(target, "cli-launch", intent)`, and show/unminimize/focus **that**
  window instead of hard-coded `main`.

## 3. Backend — per-window watcher

`watcher::WatchState` gains a label-keyed map of slots (`stop(label)`,
`start(label, …)`, `watching(label)`), and `commands::watch::watch_repo` /
`unwatch_repo` take `window: tauri::Window`. Payloads are unchanged, so the
frontend's `repoId` filter still does the tab-switch race guard.

## 4. Capabilities

`capabilities/default.json`: add `"pg-*"` to `windows`, plus the permissions a
sibling window needs that `main` never did — `set-position`, `set-size`,
`outer-position`, `outer-size`, `scale-factor`, `set-focus`, `unminimize`,
`is-maximized`, `maximize`.

## 5. Frontend — `src/features/windows/` (new)

- `windowKind.ts` (pure): `MAIN_LABEL`, `isRepoWindowLabel`, `openReposKey(label)`
  (main → `pg-open-repos`, sibling → `pg-open-repos:<label>`), and the
  `pg-windows` registry codec (`loadWindowRecords` / `saveWindowRecords`,
  tolerant of junk exactly like `loadOpenRepos`).
- `openAppWindow.ts`: `openAppWindow({ seedPaths, bounds })` — asks the backend
  for the next label, writes the seed set into that label's storage key BEFORE
  creating the window (so the new window restores into it with no IPC), then
  `new WebviewWindow(label, …)` with the platform-correct decorations, cascaded
  bounds, and the same `backgroundColor` as `main`.
- `restoreWindows.ts`: primary-only. Recreates sibling windows from `pg-windows`.
- `useWindowBounds.ts`: sibling-only; debounced `tauri://move` / `tauri://resize`
  writeback into the record.
- `useWindowLifecycle.ts`: mounts the above and the `window://closed` listener
  that prunes a forgotten sibling's records.

## 6. Frontend — tabs become per-window

- `tabs.ts`: `loadOpenRepos` / `saveOpenRepos` take a storage key.
- `useTabsStore`: `persist()` uses this window's key and also calls
  `registerWindowRepos` so the backend registry stays honest;
  `moveTabToNewWindow(path)` = seed a new window, then `close(path)` here.
- `useCliLaunch`: only the primary window takes the first-launch intent; the
  forwarded event is already targeted.

## 7. Frontend — the actions

`window.new`, `window.newWithRepo`, `window.moveTabOut` in the keymap catalog
(category *Repository*), `Mod+Shift+N` for the first; tab context-menu entries
for the last two.

## 8. Docs + tests

- `docs/dev/architecture.md` — `windows.rs`, `commands/windows.rs`, the three new
  commands, `features/windows/`.
- `docs/dev/frontend.md` — the multi-window model, per-window storage keys, the
  close-vs-quit rule.
- `CLAUDE.md` — one rule line: per-window state must be keyed by window label.
- Vitest: window-label/key derivation, `pg-windows` codec, per-window tab
  persistence, `moveTabToNewWindow`, primary-only launch intent.
- Rust: `route`, `next_label`, registry take/close, per-window watch slots.
- E2E: `multi-window.e2e.ts` — open a second window, assert it has its own tab
  strip and repository, close it. Driven with `browser.tauri.switchWindow("pg-1")`,
  which is why the labels are deterministic.
