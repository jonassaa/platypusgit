# Keyboard Navigation v2 — Design

**Status:** Implemented (supersedes `2026-06-30-keyboard-navigation-design.md`)
**Date:** 2026-07-02

## Why a v2

KN0/KN1 shipped primitives but the experience didn't hold up:

- Arrow keys *scrolled* most panes instead of moving a selection — only the
  RepoBrowser tree and the activity bar had real list navigation.
- `scope: "pane"` existed in the catalog but the dispatcher never enforced it;
  every consumer hand-rolled an `isFocused` guard.
- `app.closeOverlay` claimed every Escape even with nothing open.
- ⌘P lived in a hardcoded listener outside the keymap; palette rows carried
  hardcoded `⌘1` strings — three sources of shortcut truth.
- `e.key`-based chords made Alt+letter bindings impossible on macOS (Alt+F →
  "ƒ") and broke on non-US layouts.
- No Tab ordering, no default-selection highlight, no focus-aware styling.

## Architecture (one command system)

`src/features/keymap/` is the single source of truth. Data flow:

```
KeyboardEvent (capture-phase window listener in AppShell)
  → resolveChord (chord.ts; e.code for letters/digits, DoubleShift detection)
  → reverse map (active preset, presets.ts)
  → input policy (real-modifier chords allowed while typing; bare keys only
    with allowInInput — Escape, DoubleShift; suppressInInput blocks even
    modifier chords the caret owns — Alt+Arrow word/paragraph movement)
  → pane action  → handler registered for the FOCUSED pane (usePaneList)
    global action → innermost mounted handler → else catalog default runner
  → preventDefault; local DOM handlers skip e.defaultPrevented events
```

- **`actions.ts`** — catalog. Every action: `{ id, title, category, scope,
  allowInInput?, suppressInInput?, run? }`. Global app behaviors (navigation
  via nav intents, palette open, repo ops via `features/repo/ops.ts`, pane
  traversal, cheat-sheet) are **default runners in the catalog**, not
  useEffect wiring. Runners return `false` to decline (nothing to do → key
  falls through). Exception: `palette.open` claims its chord even when the
  palette is already open — an unclaimed ⌘P/Ctrl+P falls through to the
  webview's native Print dialog.
- **`chord.ts`** — canonical chords. Letters/digits resolve from `e.code`
  (layout- and Alt-safe); symbols/named keys from `e.key`. `DoubleShift` is a
  synthetic chord (two lone Shift taps < 350 ms, dispatcher-detected).
- **`presets.ts`** — `rider` (default) + `platypusgit` classic. Shared COMMON
  block for panes/lists/overlay. KN2 user overrides stay additive.
- **`useKeymapStore.ts`** — dispatcher; enforces pane scope against
  `useFocusStore.focused`, falls back to default runners for global actions.
- **`useFocusStore.ts`** — spatial pane focus (Alt+Arrows) + `cycle()` for
  Tab/Shift+Tab reading-order pane cycling (skipped while an interactive
  element has DOM focus).
- **`usePaneList.ts`** — arrows/Home/End move selection, Enter activates,
  Space toggles (stage/unstage). Registers handlers with `paneId`; keeps the
  selected `[data-pg-row][data-selected]` row scrolled into view.
- **`useOverlayStore.ts`** — cheat-sheet open state (runner-driven).

## Rider keymap (default preset)

| Action | Chord |
| --- | --- |
| Commit screen | ⌘K |
| Push | ⌘⇧K |
| Pull / update | ⌘T |
| Fetch | ⌘⇧T *(platypusgit extension — Rider has no Git-Fetch default; ⌘⇧T there is "Go to Test". Pairs with ⌘T.)* |
| Refresh (sync) | ⌘⌥Y |
| Diff viewer | ⌘D |
| History / log | ⌘9 |
| Palette | ⌘P / ⌘⇧A / double-Shift |
| Screens without a Rider chord | ⌘1, ⌘4…⌘7, reflog ⌘⇧9, settings ⌘, |
| Panes | ⌥Arrows spatial, Tab/⇧Tab cycle |
| Lists | ↑↓ select, ←→ collapse/expand, ↵ activate, Space toggle, Home/End |

Each screen has exactly one chord (2026-07 keymap review): the old ⌘2/⌘3/⌘8
aliases double-bound commit/history/diff and made two clashing number schemes.
The classic preset keeps the full sequential ⌘1…⌘9; its repo ops now share the
rider chords — the original classic set sat on entrenched bindings (⌘⇧P = VS
Code command palette, on a *push*; ⌘⇧F = find-in-files; ⌘⇧R = hard-reload).

**Platform note (documented trade-off):** `Mod` is Ctrl on Windows/Linux, so
tool-window numbers arrive as Ctrl+N and settings as Ctrl+, — JetBrains on
those platforms uses Alt+N / Ctrl+Alt+S. One cross-platform table beats
per-platform preset forks at this scope. `Mod+Alt+letter` chords are avoided
for anything new: on Windows, Ctrl+Alt = AltGr, which types characters on many
European layouts (⌘⌥Y refresh predates this rule and survives review — Y has
no common AltGr assignment).

**Tab rule:** Tab/⇧Tab cycle panes only while no interactive element (input,
button, link, select) holds DOM focus; otherwise native Tab behavior wins.
Pane focus delegation targets `[data-pg-focus-target]` elements (never
buttons), so the rule is deterministic per pane. Known gap: hijacking Tab is
unfriendly to screen-reader traversal — revisit with a broader a11y pass.

## Focus & selection styling

- Focused pane: 1 px accent inset ring (`[data-pg-pane][data-pg-focused]::after`).
- Selected rows carry `data-pg-row` + `data-selected`; CSS renders them vivid
  in the focused pane, dimmed elsewhere (JetBrains-style), via
  `--bg-selection-focused` / `--bg-selection-dim` tokens.

## Palette integration

`PaletteItem.actionId?` links rows to catalog actions; `CommandPalette`
renders the live chord (`chordFor`) as a `<kbd data-pal-chord>` chip and
re-renders on preset change. No hardcoded chord strings anywhere outside
`presets.ts`.

## Screens wired for list navigation

History, CommitPanel (cross-section selection + Space staging), DiffViewer,
CommitDiff, Branches (branches/tags/stashes as one flat list, Enter checks
out), Reflog (Enter opens action dialog), FileHistory (Enter opens diff),
Conflict, RepoBrowser tree (DOM-level, unchanged), activity bar.

## Testing

182 vitest tests incl.: chord parsing (code-based, DoubleShift), preset
completeness/collisions per preset, dispatcher (scope gating, input policy,
decline chains, default runners, DoubleShift), focus cycling, usePaneList
(multi-list coexistence, clamping, toggle), palette chord chips, and
screen-level keyboard tests (History, CommitPanel).
