# File-Tree Virtualization Implementation Plan (#61 A8)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop RepoBrowser mounting a DOM row per file. "All files" mode renders every file in the repository today; on a large repo that is thousands of rows and an unusable tree.

**Architecture:** Reuse `src/lib/useWindowedList.ts` — written generic during #68 G10 for exactly this. RepoBrowser already flattens the tree (`flattenFileTree`) to drive `usePaneList`, so it owns the row-count and index axis; it therefore owns the window too and passes a range down. `PGFileTree` gains an optional `window` prop and slices the rows it already flattens. No caller that omits the prop changes behaviour.

**Tech Stack:** React 18 + TypeScript, Vitest + React Testing Library (jsdom).

## Global Constraints

- **Issue:** #61 A8. The History half landed in #80; this is the tree half.
- **Toolchain:** prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **No Rust.** Frontend only.
- **Row pitch comes from the density token, never a literal.** `--row-h` is `calc(24px + var(--row-step))` (`index.css:161`), and `DENSITY_STEP_PX` (`useSettingsStore.ts:465`) is the JS source of truth. Export `FILE_TREE_ROW_BASE_H = 24` and use `+ useDensityStep()`, mirroring `COMMIT_ROW_BASE_H`. A literal desyncs the window from the rows in comfortable density (#70).
- **Scroll-to-index must not be DOM-driven.** `usePaneList` falls back to `querySelector('[data-pg-row][data-selected]')`; under windowing the selected row is frequently unmounted. RepoBrowser must pass `scrollToIndex`, exactly as History does.
- **Gate per task:** `pnpm test` + `pnpm tsc --noEmit` clean before committing. Run `tsc` **after** adding any test file, not only after source edits.
- **Verify e2e with Docker, never native.** Read the log, not the exit code.

## Scope: RepoBrowser only

**CommitPanel's trees are deliberately NOT virtualized.** Both of its trees live inside one `FocusableScroll` (`CommitPanel.tsx:649`) together with headers and the staged/unstaged section chrome, so a tree's rows are offset by whatever precedes them in that shared container — windowing each independently would need a larger refactor to be correct. They also list *changed* files, which is bounded by changeset size, not repo size. RepoBrowser's "All files" tree is the one that renders every file in the repo, and is what A8 is actually about.

Recorded here so the omission reads as a decision, not an oversight.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/lib/useWindowedList.ts` | Accept an externally-owned viewport element | modify |
| `src/lib/useWindowedList.test.ts` | Cover the external-ref path | modify |
| `src/design/git-components.tsx` | `FILE_TREE_ROW_BASE_H`; `PGFileTree` window prop + spacers | modify |
| `src/design/git-components.tree.test.tsx` | Windowing render assertions | **create** |
| `src/screens/RepoBrowser.tsx` | Own the window; feed `scrollToIndex` to `usePaneList` | modify |
| `src/screens/RepoBrowser.virtual.test.tsx` | Screen-level: mounts a fraction, pads to full height | **create** |

---

### Task 1: `useWindowedList` accepts an external viewport

**Files:** `src/lib/useWindowedList.ts`, `src/lib/useWindowedList.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `useWindowedList({ count, rowHeight, overscan?, viewportRef? })`. When `viewportRef` is supplied the hook observes **that** element instead of creating its own; the returned `viewportRef` is then the same object, so History's existing call site is untouched.

**Why:** RepoBrowser's scroll container is a plain `div` it already owns (`RepoBrowser.tsx:744`), and the empty-state and spinner are siblings of `PGFileTree` inside it. Moving ownership into the hook would mean restructuring that DOM; accepting a ref does not.

- [ ] **Step 1: Write the failing test.** Append to `useWindowedList.test.ts` a `renderHook`-style test that passes a ref to a detached element with a known `clientHeight`/`scrollTop` and asserts the range reflects it. If `renderHook` is not already used in the repo, assert the simpler observable instead: that passing `viewportRef` returns *that same ref object* rather than a fresh one.

```ts
it("uses a caller-supplied viewport instead of creating one", () => {
  const external = { current: document.createElement("div") };
  const { result } = renderHook(() =>
    useWindowedList({ count: 100, rowHeight: 10, viewportRef: external }),
  );
  expect(result.current.viewportRef).toBe(external);
});
```

- [ ] **Step 2:** Run — FAIL (`viewportRef` is not an accepted option).
- [ ] **Step 3: Implement.** Add `viewportRef?: React.RefObject<HTMLElement | null>` to the options; inside, `const ownRef = React.useRef<HTMLElement>(null); const viewportRef = o.viewportRef ?? ownRef;` and use it everywhere the hook currently uses its own ref. Widen the internal type from `HTMLDivElement` to `HTMLElement` so both callers fit.
- [ ] **Step 4:** `pnpm test --run src/lib/ src/screens/History.virtual.test.tsx` — the new test passes and History's windowing is unaffected.
- [ ] **Step 5:** `pnpm tsc --noEmit`, commit `refactor(list): let useWindowedList observe a caller-owned viewport (#61 A8)`.

---

### Task 2: `PGFileTree` renders a window

**Files:** `src/design/git-components.tsx`, `src/design/git-components.tree.test.tsx` (**create**)

**Interfaces:**
- Produces: `FILE_TREE_ROW_BASE_H = 24`, and on `PGFileTreeProps`:

```ts
  /**
   * Render only rows [start, end) with spacers standing in for the rest.
   * Omit to render every row — every existing caller does, and behaves
   * exactly as before.
   */
  window?: { start: number; end: number; topPad: number; bottomPad: number };
```

**Invariant this leans on:** `PGFileTree` flattens with `flattenFileTree(nodes, expanded)`, and RepoBrowser flattens with the *same function and the same inputs* to build `rowOrder` (`RepoBrowser.tsx:267`). So an index means the same row on both sides. If that ever diverges, the window slices the wrong rows — the test below pins it.

- [ ] **Step 1: Write the failing test** (`git-components.tree.test.tsx`): build a 50-node flat tree and assert that (a) with no `window` prop all 50 rows render; (b) with `window={{start:10,end:15,topPad:240,bottomPad:840}}` exactly 5 rows render and they are nodes 10–14 by name; (c) the spacer heights are present so the scroll body keeps full height; (d) `FILE_TREE_ROW_BASE_H` is 24, matching `--row-h`'s base.

- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3: Implement.** Export the constant next to `COMMIT_ROW_BASE_H` with a comment tying it to `--row-h`. In `PGFileTree`, after `const flat = flattenFileTree(...)`, slice:

```tsx
  const win = window ?? { start: 0, end: flat.length, topPad: 0, bottomPad: 0 };
  const shown = flat.slice(win.start, win.end);
```

Render `<div style={{ height: win.topPad }} />` before the rows and a matching one after, and map over `shown` — taking care that `rowStage`/`stageSlot` still consider **every** row, not just the visible slice, or the checkbox column would appear and disappear as the user scrolls.

- [ ] **Step 4:** `pnpm test --run src/design/` — green, including the existing tree tests.
- [ ] **Step 5:** `pnpm tsc --noEmit`, commit `feat(tree): render a window of rows when the caller supplies one (#61 A8)`.

---

### Task 3: RepoBrowser owns the window

**Files:** `src/screens/RepoBrowser.tsx`, `src/screens/RepoBrowser.virtual.test.tsx` (**create**)

- [ ] **Step 1: Write the failing test.** Prime the store with ~300 files in "all" mode, render `RepoBrowserScreen`, and assert: far fewer than 300 `[data-pg-row]` rows are mounted; the scroll body's padding + mounted rows equals `300 * FILE_TREE_ROW_BASE_H`; and every mounted row's name is one of the first N files (i.e. the window starts at the top).

- [ ] **Step 2:** Run — FAIL (all 300 mount).
- [ ] **Step 3: Implement.**

```tsx
  const treeScrollRef = React.useRef<HTMLDivElement>(null);
  const treeRowH = FILE_TREE_ROW_BASE_H + useDensityStep();
  const treeWin = useWindowedList({
    count: flatRows.length,
    rowHeight: treeRowH,
    viewportRef: treeScrollRef,
  });
```

Put `ref={treeScrollRef}` and `onScroll={treeWin.onScroll}` on the existing scroll `div` (`:744`), pass `window={treeWin}` to `PGFileTree`, and add `scrollToIndex: treeWin.scrollToIndex` to RepoBrowser's `usePaneList` options — without which keyboard navigation silently stops scrolling once the selected row is unmounted.

- [ ] **Step 4:** `pnpm test --run` — full suite green.
- [ ] **Step 5:** `pnpm tsc --noEmit`, commit `perf(tree): virtualize the RepoBrowser file tree (#61 A8)`.

---

### Task 4: Verification

- [ ] `pnpm test --run` — above the 618 baseline, zero failures.
- [ ] `pnpm tsc --noEmit` and `pnpm exec tsc -p e2e/tsconfig.json --noEmit`.
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` — guard; no Rust touched.
- [ ] `pnpm test:e2e:docker` — **full suite**. `status-stage.e2e.ts` drives folder staging and the tree⇄flat toggle through this exact component, and `keymap.e2e.ts` drives tree keyboard nav, so the blast radius is not limited to RepoBrowser.
- [ ] Squash onto latest `origin/main`, push, draft PR referencing #61 A8.

## Self-Review

**1. Coverage.** A8 asks to virtualize long trees/lists behind the existing flatten step, starting with the tree and History list. History shipped in #80; this is the tree, reusing that helper rather than adding a second implementation. CommitPanel is explicitly scoped out above with reasoning.

**2. Placeholder scan.** Task 1 Step 1 offers a fallback assertion if `renderHook` isn't already a dependency in this repo — check before writing, and use the stronger element-observing test if it is available.

**3. Type consistency.** `window` prop shape `{start, end, topPad, bottomPad}` is exactly `WindowRange` from `useWindowedList.ts` — import and reuse that type rather than redeclaring it, so the two cannot drift. `FILE_TREE_ROW_BASE_H` is defined once in Task 2 and consumed in Task 3.

**Known risk:** the flatten-twice invariant (PGFileTree internally, RepoBrowser for `rowOrder`). It is already relied on today for shift-click ranges, so this does not introduce the coupling — but it does make a divergence render the wrong rows rather than merely mis-select, which is more visible. Task 2's test pins index→row identity.
