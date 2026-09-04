# Multiple windows, not just tabs (#256)

Status: approved (2026-09-04)

## Problem

Repositories open as tabs in one window (#90). Tabs are for *switching*; windows
are for *comparing* — porting a change between two repos, watching a build in
one while working in another, one repository per monitor. A tab strip cannot do
any of those, and this is a multi-monitor-heavy audience.

Upstream demand is the same story: GitHub Desktop's "support multiple windows"
has 223 reactions, Fork's has 16.

## Non-goals

- **Not** a redesign of the tab model. Tabs stay exactly as they are; windows are
  added alongside, and every window has a full tab strip.
- **Not** a second UI mode. A window is the whole app: same shell, same screens,
  same keymap, same settings.
- **Not** cross-window drag of tabs. "Move tab to new window" is a menu/command
  action; dragging a tab out of the strip onto the desktop is a follow-up.
- **Not** per-window settings. Settings, recents and the keymap stay global.

## The shape

### One bundle, N windows

The merge resolver already proves the pattern: a second Tauri window running the
same bundle, routed by a query param in `src/main.tsx`. Repository windows need
no param at all — anything that is not `?window=merge` is the full app. What
distinguishes one repository window from another is its **label**:

- `main` — the window Tauri creates from `tauri.conf.json`. Always exists first.
- `pg-1`, `pg-2`, … — sibling windows, created at runtime; the number is the
  lowest one not currently taken.
- `merge` — the resolver, unchanged.

Labels are deterministic and short on purpose: they are the key for per-window
storage, they are what a capability glob has to match, and they are what an e2e
spec passes to `browser.tauri.switchWindow(...)`.

### Each window owns its own repositories

`useRepoStore` holds exactly one repository's state and `useTabsStore` holds the
open set — both are module-level Zustand stores, so a second webview gets a
second, independent copy for free. Nothing about the frontend state model
changes.

The backend is the shared half, and the decision that makes everything else
simple is: **two windows on one repository get two `RepoId`s.** `open_repo`
mints a fresh id per open, and we keep it that way rather than sharing one
handle. That means:

- Window A closing a tab evicts *its* `RepoId` only. Window B is untouched — the
  cross-window corruption the issue worried about cannot happen because there is
  nothing shared to corrupt.
- Terminal sessions (keyed by `RepoId`) and rebase state (keyed by `RepoId`) stay
  per-window without any refcounting.
- Same-repository operations in two windows do not serialize on one inner mutex.
  That is acceptable and already the app's reality: `watcher.rs` opens its own
  second `git2::Repository` on the same repository for exactly this reason
  ("git is built for concurrent processes"), and the app has always tolerated a
  terminal running git beside it. The verify-and-mutate invariants that matter
  are already written defensively against external mutation — `stash_drop_at`
  takes an `expect_oid` and re-checks it under the lock.

The price is a second `git2::Repository` per window per repository, which is the
same price the watcher already pays.

### Per-window backend state

Three pieces of `AppState` were implicitly single-window and become per-window:

| State | Was | Becomes |
|---|---|---|
| `watcher::WatchState` | one live watch, on "the" active repository | one live watch **per window label**; the `fs://changed` payload already carries `repoId`, so the frontend filter is unchanged |
| `CliLaunchState` | take-once, whoever asks first | taken by the primary window only |
| the `cli-launch` event | `app.emit` — broadcast, so every window would open the repository | `emit_to` one chosen window |

A fourth is new: a **window registry** (`src-tauri/src/windows.rs`) mapping a
window label to the repositories it currently holds (`RepoId` + path). It exists
for three jobs, all of which need an answer only the backend can give:

1. **Launch routing.** `pgit ~/foo` in a running app must focus the window that
   already has `~/foo` open, else the last-focused window. The registry is where
   "who has it" lives, and a `Focused(true)` window event is where "last focused"
   comes from.
2. **Window close cleanup.** Closing one window while the process keeps running
   has to evict that window's repositories and pty sessions and stop its watch —
   otherwise every closed window leaks a `git2::Repository` and a shell for the
   rest of the session. Process exit used to cover this; with several windows it
   no longer does.
3. **Deciding whether a close was a close or a quit** (below).

### Session restore, and the close-vs-quit rule

Each window persists its own open set. `main` keeps writing the existing
`pg-open-repos` key — an upgrading user's session restores exactly as before —
and a sibling writes `pg-open-repos:<label>`. A separate `pg-windows` key lists
the sibling labels (and their remembered bounds) so `main` can recreate them at
launch; each recreated window then restores its own set, lazily, exactly as
today.

Distinguishing "the user closed this one window" from "the user quit the app" is
the one genuinely awkward question, because both destroy windows. The rule that
needs no flags and no event ordering:

> **A window destroyed while another repository window is still alive is
> forgotten. A window destroyed with none left is remembered.**

Rust implements it directly: on `WindowEvent::Destroyed`, if any repository
window remains, it emits `window://closed` **to one of the survivors**, which
prunes that label from `pg-windows` and drops its storage. If nothing survives,
there is nobody to emit to and nothing is pruned — which is precisely the quit
case.

The consequence, spelled out because it is a behaviour someone will ask about:
on macOS, ⌘Q with three windows open restores three windows. On Windows and
Linux, where quitting *is* closing the windows one at a time, the last window
standing is what comes back. That is what VS Code does, and it beats the two
alternatives (restore windows the user deliberately closed; or restore nothing).

Bounds are remembered for **sibling** windows only. `main` keeps the launch
geometry it has today — restoring its position is a separate change with its own
blast radius, and the multi-monitor case the issue names is about the *extra*
windows.

### Window chrome

Nothing to do. Every piece of window chrome already asks for *its own* window:
`PGWindowControls`, the window title effect in `AppShell`, `RevealOnFirstPaint`
and the system-appearance watch all go through `getCurrentWindow()`. A sibling
window gets its own traffic lights / minimise-maximise-close, its own
`repo — branch — PlatypusGit` title (#219), and its own theme subscription.

Two settings are the exception, because they live in `tauri.conf.json` and a
runtime-created window does not inherit it: the macOS `titleBarStyle: "Overlay"`
+ traffic-light position, and the non-macOS `decorations: false`. Both are passed
explicitly at creation, chosen off `platform()`. Deliberately at creation rather
than stripped afterwards — the comment in `lib.rs` records that stripping the
frame after the fact was *visible* on Windows.

## User-facing surface

- **New window** (`Mod+Shift+N`) — an empty window on Welcome.
- **New window with this repository** — seeds the new window with the active tab's
  repository; the current window keeps its tab.
- **Move tab to new window** — same, but the tab leaves this window.
- All three in the command palette (category *Repository*), the last two also on
  the tab context menu.
- **Close window** is the OS close button. No app-level chrome for it.

## What this does not solve

- Dragging a tab between two existing windows.
- Restoring `main`'s own position and size.
- A window list / "bring all to front" menu.

These are follow-ups, not part of #256.
