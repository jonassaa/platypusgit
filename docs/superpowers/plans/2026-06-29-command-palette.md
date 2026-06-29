# Command palette / fuzzy finder (⌘P) — plan

**Spec:** `docs/superpowers/specs/2026-06-29-command-palette-design.md`
**Date:** 2026-06-29

## Steps

1. **Pure fuzzy match (TDD).**
   - Write `src/features/palette/fuzzyMatch.test.ts` first (subsequence, case-insensitive, scoring order, indices, empty/non-match).
   - Implement `src/features/palette/fuzzyMatch.ts` to pass.
   - Verify: `pnpm test`.

2. **Palette store.**
   - `src/features/palette/usePaletteStore.ts` — `{ open, query, openPalette, closePalette, setQuery }`.

3. **Nav intent for screen switch.**
   - Add `{ kind: "switch-screen"; screen: string }` to `NavIntent` in `useNavStore.ts`.
   - In `AppShell.tsx`, route `switch-screen` → `setScreen(intent.screen)` and clear intent.

4. **Command palette component.**
   - `src/features/palette/CommandPalette.tsx`:
     - Read branches/allFiles/commits from `useRepoStore`; build command list from activity items + global actions.
     - Run `fuzzyMatch` over candidates, sort by score, group by type, cap per group, flatten for nav.
     - Keyboard: Arrow up/down, Enter, Esc. Mouse hover/click. Backdrop click closes.
     - On open: focus input, reset query/active, call `refreshAllFiles()`.
     - Selection dispatch: branch→checkout, file→diff-file intent, commit→commit-vs-wt intent, command→action or switch-screen intent.
     - Portal to `document.body`, centered modal + backdrop, design-system styling.

5. **Wire into AppShell.**
   - Global ⌘P/Ctrl+P keydown listener (ignore inputs/textareas/contentEditable), toggles `openPalette()`.
   - Render `<CommandPalette />` once at shell level.

6. **Component test.**
   - `src/features/palette/CommandPalette.test.tsx`: open→type→ArrowDown→Enter fires intent; Esc closes.

7. **Verify all green.**
   - `pnpm tsc --noEmit`, `pnpm test`, `pnpm vite build`. No Rust touched.

## Decisions

- File default action = diff (`diff-file` intent), not open-in-editor — predictable, keyboard-only.
- Commit default action = commit-vs-working-tree diff (`commit-vs-wt`), reusing existing intent.
- Screen switching via new `switch-screen` intent rather than hoisting screen state — keeps AppShell the single router.
- No backend changes; `allFiles` in-memory list is the file source.
