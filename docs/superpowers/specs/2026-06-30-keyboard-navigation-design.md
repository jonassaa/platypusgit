# Keyboard Navigation — Design

**Status:** Approved (scope: "All" — full Keyboard Navigation foundation + discoverability)
**Date:** 2026-06-30
**Feature ref:** `features.md` → Keyboard Navigation (KN0 + KN1)

## Goal

Make platypusgit fully driveable from the keyboard — the north-star "extreme
usability" promise. Match and beat TortoiseGit's keyboard ergonomics. A
developer never reaches for the mouse on common flows (stage, commit, switch
branch, browse history, navigate diffs).

This spec covers **KN0 (foundation)** plus the **KN1 discoverability** items that
fall out almost for free once the registry exists. KN2 (per-binding user
overrides, additional presets, export/import) is explicitly out of scope but the
data model is designed so KN2 is additive — no rewrite.

## Two axes of movement (the mental model)

- **Arrow keys = directional navigation _within_ the focused pane.** Up/down
  moves selection in lists; left/right collapses/expands tree nodes.
- **Alt/Option + Arrow keys = move focus _between_ panes.** Shifts the active
  pane in the arrow's direction.
- High-contrast focus ring on the active pane and active row, always visible.

## Architecture

Everything lives under `src/features/keymap/`, colocated per the repo's
per-feature convention. The keymap is **data, not handlers** — a single binding
table maps `action id → key chord`; screens register handlers for action ids and
never read raw key events.

### 1. Action catalog (`registry.ts`)

- `ActionId` — string-literal union of every bindable action
  (`nav.files`, `nav.commit`, … `nav.reflog`, `nav.settings`,
  `app.cheatSheet`, `app.closeOverlay`,
  `pane.focusLeft/Right/Up/Down`,
  `list.up/down/expand/collapse/activate`,
  `repo.fetch`, `repo.pull`, `repo.push`).
- `ActionDef` — `{ id, title, category, scope }` where
  `scope: "global" | "pane"`. Global actions fire regardless of focus
  (subject to don't-fight-inputs); pane actions are delivered to the focused
  pane only.
- `category` groups actions in the cheat-sheet ("Navigation", "Panes",
  "Lists & trees", "Repository", "App").
- `ACTIONS: Record<ActionId, ActionDef>` — the catalog, single source of truth.

### 2. Chord model (`chord.ts`)

- Chord string canonical form: `"Mod+1"`, `"Alt+ArrowLeft"`, `"?"`,
  `"Shift+/"`. `Mod` = ⌘ on macOS, Ctrl elsewhere (resolved at dispatch).
- `eventToChord(e: KeyboardEvent): string` — normalizes a DOM event to canonical
  form (modifier order fixed: Mod, Ctrl, Alt, Shift; `e.key` for the base).
- `formatChord(chord): string` — pretty display (`⌘1`, `⌥←`, `?`) for menus,
  tooltips, cheat-sheet. Platform-aware glyphs.
- Pure, fully unit-tested.

### 3. Preset (`presets.ts`)

- `KeymapPreset` — `{ id, name, bindings: Partial<Record<ActionId, string[]>> }`.
  One action may have multiple chords.
- `PLATYPUSGIT_PRESET` — the one built-in default, binding every action:
  `nav.*` → `Mod+1`…`Mod+9` + `Mod+,` for settings, `app.cheatSheet` → `?`,
  `app.closeOverlay` → `Escape`, `pane.focus*` → `Alt+Arrow*`,
  `list.*` → arrows / `Enter`, `repo.fetch/pull/push` → `Mod+Shift+F/L/P`.
- `BUILTIN_PRESETS: KeymapPreset[]` — list of one for now; picker iterates it.

### 4. Dispatcher + handler registry (`useKeymapStore.ts`, `useAction.ts`)

- `useKeymapStore` (Zustand) holds: `activePresetId`, derived reverse map
  `chord → ActionId[]`, and a live registry of `ActionId → handler` (with a
  scope-aware layer: global handlers + the focused pane's handlers).
- `useAction(id, handler, deps)` — hook a component calls to register a handler
  for an action while mounted. Cleans up on unmount.
- A single global `keydown` listener (installed in `AppShell`) resolves
  `eventToChord` → action ids → first registered enabled handler, calls it,
  `preventDefault()`.
- **Don't-fight-inputs:** if the event target is `INPUT` / `TEXTAREA` /
  `contentEditable`, the dispatcher ignores everything except actions explicitly
  flagged `allowInInput` (only `app.closeOverlay`/Escape). This replaces the
  ad-hoc `INPUT/TEXTAREA` guard currently inline in `AppShell`.

### 5. Focus model (`useFocusStore.ts`, `PGPane`)

- `useFocusStore` tracks the registered panes for the current screen (id +
  spatial neighbors) and the currently-focused pane id.
- `PGPane` — wrapper component: registers itself on mount with an id and a
  `neighbors` map (`{ left?, right?, up?, down? }`), renders a focus ring via
  `data-pg-focused` + CSS in `index.css`, and focuses on click.
- `pane.focus*` actions (Alt+Arrow) move focus along neighbors.
- `usePaneList` helper standardizes arrow-key list/tree navigation (up/down
  selection, left/right expand-collapse, Enter activate) for a pane's items, so
  every list screen behaves identically.
- Applied to the primary multi-pane screens first (RepoBrowser, CommitPanel,
  History); remaining screens adopt `PGPane`/`usePaneList` incrementally — the
  primitives are the deliverable, full per-screen audit is tracked separately.

### 6. Settings: keymap picker

- New `<Section title="Keyboard">` in `Settings.tsx`. A `Select` listing
  `BUILTIN_PRESETS` (one entry today), bound to `activePresetId`.
- `activePresetId` persisted in `useSettingsStore` (new `PersistedState` field,
  default `"platypusgit"`); `useKeymapStore` reads it.

### 7. Cheat-sheet overlay (`CheatSheet.tsx`)

- `?` toggles a modal overlay listing every action grouped by `category`, each
  with its `formatChord`-rendered chords, read straight from the active preset +
  catalog. Escape / `?` / click-out closes. Zero hardcoded key lists — derived.

### 8. Chords in context menus

- `ContextMenuItem.shortcut` already exists. Where a menu item corresponds to a
  registered action, populate `shortcut` via `formatChord` from the active
  preset so menus reflect the live keymap.

## Data flow

```
KeyboardEvent
  → eventToChord (chord.ts)
  → useKeymapStore reverse map (chord → ActionId[])
  → don't-fight-inputs filter
  → resolve handler (global registry ∪ focused-pane registry)
  → handler() + preventDefault
```

Settings picker writes `activePresetId` → `useKeymapStore` rebuilds reverse map
→ cheat-sheet & context menus re-render with new chords. One source of truth.

## Error handling

- No IPC / no Rust changes — this is entirely frontend. No `AppError` surface.
- Unknown/empty chord → dispatcher no-ops (event passes through).
- Duplicate chord bound to two global actions → first registered wins; logged to
  console in dev. (KN2 adds real conflict detection.)

## Testing

- **Pure logic (`pnpm test`):** `chord.test.ts` (eventToChord / formatChord
  round-trips, modifier ordering, platform glyphs), `presets.test.ts` (every
  `ActionId` in catalog has a binding; no chord collisions within the preset),
  reverse-map builder.
- **Component (`pnpm test`, jsdom + RTL):** dispatcher fires the right handler
  for a chord; don't-fight-inputs suppresses inside a textarea but allows
  Escape; cheat-sheet renders an entry per action; `PGPane` Alt+Arrow moves
  focus to the declared neighbor.
- No Rust tests (no backend change).

## Out of scope (KN2 / future)

- Per-binding user overrides layered on a preset; conflict detection UI.
- Additional presets (Rider/JetBrains, GitKraken, Sublime Merge).
- Export / import keymaps.
- Exhaustive per-screen arrow-key audit of every secondary screen (primitives
  ship; adoption is incremental).
