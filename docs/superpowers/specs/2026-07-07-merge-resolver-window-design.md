# Merge Resolver Window — Design

**Status:** Approved (user answered scoping questions 2026-07-07, approved design with "go")
**Date:** 2026-07-07
**Source:** Issue #25, point 2 — "separate merge conflict resolver window. keyboard
shortcuts to select side per conflict. rider/Jetbrains UI implementation for this
is great so please mimic that."

## Why

Resolving conflicts today means the read-only 3-column view on the Conflict
screen plus whole-file accept ours/theirs, or bouncing out to an external
mergetool. Real merges need per-conflict decisions and manual fixups. Rider's
merge dialog is the reference UX: a dedicated window, three panes, chevrons and
shortcuts to take a side per conflict, editable result.

## Decisions (user-confirmed)

1. **Real OS window** — a second Tauri webview window, not an in-app takeover.
2. **Editable result pane** — CodeMirror 6 in the middle; hand-edits allowed.
3. **Conflict screen stays as launcher** — list, quick accepts, abort/finalize,
   read-only 3-column detail all unchanged; the window is an addition.
4. **Auto-advance** — Apply stages the file and loads the next conflicted file
   in the same window; last file closes the window.

## Architecture

### Window plumbing

- One resolver window max, fixed label `merge`, same Vite bundle. URL:
  `/?window=merge&repoId=<id>&path=<path>`. `main.tsx` branches on the
  `window` query param: mounts `<MergeWindow/>` instead of `<AppShell/>`.
- Created from the frontend via `WebviewWindow` (`@tauri-apps/api/webviewWindow`),
  ~1400×900, title `Resolve: <path>`. If the window already exists: focus it and
  emit `merge://open-file` with the new path so it switches files.
- Capabilities (`src-tauri/capabilities/default.json`): add `merge` to
  `windows`, add `core:webview:allow-create-webview-window` (main needs it to
  spawn the window), and window close/minimize/start-dragging for `merge`.
- **Cross-window sync via Tauri events, no shared JS state.** The resolver
  window fetches everything itself over IPC (`conflict_sides`, `get_status`).
  It emits `merge://resolved` after each successful Apply and `merge://closed`
  on exit; `AppShell` listens and calls `refreshAll()`. The resolver window has
  its own store instances (fresh webview) — that is fine, it only needs
  conflict data.
- The resolver window uses the native titlebar (no custom overlay chrome) —
  it is a utility dialog, not app chrome.

### Chunking: frontend diff3 over index stages

`conflict_sides` already returns base/ours/theirs strings from index stages
1/2/3. The resolver computes a diff3 chunk model in TS using **`node-diff3`**
(tiny, MIT): a sequence of chunks, each either

- `stable` — identical in all three, or
- `change` — non-conflicting change from one side (auto-applied), or
- `conflict` — both sides changed: `{ base, ours, theirs }` line ranges.

Rationale over alternatives: independent of the user's `merge.conflictStyle`
config (no marker parsing), deterministic, provides the line-alignment data the
side panes and scroll-sync need anyway, and it is a pure function — unit-testable
without git.

The chunk model lives in `src/features/merge/mergeModel.ts` (pure, tested):
build model from `ConflictSides`, assemble result text, map result offsets ↔
chunk ids, per-chunk resolution state.

### Resolution model

Chunk states: `unresolved` | `resolved(ours | theirs | both | manual)`.

- At load, `change` chunks are auto-applied into the result (Rider's "apply
  non-conflicting changes" as default behavior, no button). `conflict` chunks
  render base content in the result, highlighted as unresolved.
- Accept ours / accept theirs / accept both (ours-then-theirs order) replace
  the conflict region in the result via a CodeMirror transaction and set state.
- Hand-editing inside an unresolved conflict region auto-marks it
  `resolved(manual)`.
- Accepts are editor transactions, so native CM6 undo (⌘Z) restores both text
  and (via position mapping) the chunk's visual state.
- **Apply is disabled until every conflict chunk is resolved.** Closing the
  window is always allowed; if any chunk was touched, confirm discard first.

### Non-text conflicts

- **Deleted on one side** (ours or theirs is null) and **binary** conflicts get
  a chooser panel instead of the 3-pane editor: keep surviving/one side vs
  take other side, wired to the existing `accept_ours`/`accept_theirs` ops.
  This keeps auto-advance uniform across all conflict types.

### Apply + auto-advance

- New backend op `save_resolution(repo_id, path, content)`: write `content` to
  the worktree file, then stage it (same index dance as `mark_resolved`).
  Standard new-op path: `GitBackend` trait method → `Libgit2Backend` impl →
  `CliBackend` `NotImplemented` stub → command in `commands/conflict.rs` →
  register in `invoke_handler!` → TS wrapper in `lib/tauri.ts`.
- After Apply the resolver re-fetches status; if conflicted files remain, load
  the next in place (header shows "file 2 of 5"); otherwise emit
  `merge://resolved` + close. Main window refreshes on the event and Finalize
  lights up via existing logic.

## Layout (Rider three-pane)

```
┌─ Resolve: src/foo.ts ────────────── conflict 2/4 · file 1/3 ─┐
│ OURS (yours)      │ RESULT (editable)  │ THEIRS (incoming)   │
│ read-only render  │ CodeMirror 6       │ read-only render    │
│ chunk highlights  │ conflict regions   │ chunk highlights    │
│ gutter ≫ per      │ highlighted until  │ gutter ≪ per        │
│ conflict          │ resolved           │ conflict            │
├──────────────────────────────────────────────────────────────┤
│ shortcut hints                        [Close]  [Apply ⌘↵]    │
└──────────────────────────────────────────────────────────────┘
```

- Side panes are custom read-only renders (not CodeMirror) — uniform monospace
  line heights keep alignment simple; changed/conflict regions use the
  existing `--git-*` theme tokens.
- Gutter chevron buttons per conflict: `≫` on ours takes ours, `≪` on theirs
  takes theirs (mouse path for the same actions as the shortcuts).
- Scroll-sync across the three panes by chunk-anchor mapping (the chunk table
  gives line correspondences). No Rider-style connector polygons in v1.
- No syntax highlighting in v1 (matches the current conflict panes); CM6
  language packs are a later add.

## Keyboard

Self-contained handler in the resolver window reusing the existing `chord.ts`
parser — not the full keymap store (dispatcher, panes, palette, presets are
main-window machinery). Fixed chords, shown in the footer:

| Chord | Action |
| --- | --- |
| `F7` / `⇧F7` | next / previous conflict (matches diff-nav convention) |
| `⌘1` (`Mod+1`) | accept ours for current conflict |
| `⌘2` (`Mod+2`) | accept theirs for current conflict |
| `⌘3` (`Mod+3`) | accept both (ours then theirs) |
| `⌘↵` (`Mod+Enter`) | Apply (matches commit chord convention) |
| `Esc` / `⌘W` | close window (confirm if dirty) |

All are modifier chords or F-keys → they work while the CM editor is focused
and do not collide with CM editing keys. Preset-based remapping of resolver
chords is deferred; noted as future work.

## Launch points

- Conflict screen: Enter / double-click on a conflict row opens the resolver
  window for that file.
- "Open merge editor" button in the detail action bar (primary position).
- Context-menu item "Open merge editor" on conflict rows.
- Existing quick accept-ours/theirs, external mergetool, restart resolution,
  abort, finalize all stay as-is.

## New dependencies

- `codemirror` (CM6 core packages) — editable result pane.
- `node-diff3` — diff3 chunking.

## Testing

- **Unit (vitest):** `mergeModel` — chunk building from base/ours/theirs
  (incl. auto-apply of non-conflicting changes), result assembly, accept
  ours/theirs/both transitions, manual-edit auto-resolve, offset mapping,
  scroll-anchor mapping. Fixture-driven, no git needed.
- **Component (jsdom):** `MergeWindow` with `mockInvoke` — loads sides, chord
  accepts update state, Apply gating (disabled until all resolved), Apply →
  `save_resolution` invoked → advances to next file, chooser panel for
  deleted/binary conflicts.
- **Rust:** `save_resolution` against `TempRepo` — content written to worktree,
  path staged (stage 0), conflict cleared from index, status clean for path.
- **e2e:** `e2e/specs/merge-window.e2e.ts` drives the real second window
  (`browser.tauri.switchWindow("merge")`) through the full in-window flow —
  chord + chevron accept → Apply → auto-advance across two files → finalize in
  the main window — asserted against repo truth (file contents, `MERGE_HEAD`,
  porcelain). **Platform note (the `Risk` flagged here, resolved):** this is
  reliable **headless on Linux/WebKitGTK** (CI + `pnpm test:e2e:docker`,
  verified 3/3), but flaky on a **macOS-native** run — WKWebView's
  foreground-focus self-heal can't hold a consistent active window across the
  second window's open/transition/close, so `switchWindow` intermittently hits
  "No window could be found". So: run this spec headless (Docker/CI), not
  macOS-native. The launch wiring (list Enter, row double-click, detail button,
  context menu → `openMergeWindow`) is additionally unit-covered by
  `src/screens/Conflict.launcher.test.tsx`.

## Out of scope (deliberate)

- Rider connector polygons between panes.
- Syntax highlighting in the merge editor.
- Keymap-preset remapping of resolver chords (self-contained handler in v1).
- Per-side "ignore change" (Rider's ✕) — accept ours/theirs/both covers v1.
- Multi-monitor window position persistence.
