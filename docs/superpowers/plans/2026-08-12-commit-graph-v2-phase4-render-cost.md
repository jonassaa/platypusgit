# Commit Graph v2 — Phase 4 (render cost) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop History from rebuilding every commit row on unrelated state changes (G9), then stop mounting rows that aren't on screen at all (G10) — including the e2e migration that virtualization forces.

**Architecture:** G9 first and separately, because virtualization hides render cost without removing it. G9 changes `PGCommitRow`'s callback props from per-row closures to an `oid` + shared-handler pair (which also touches `Reflog.tsx`), memoizes the ref pills, and wraps both row components in `React.memo`. G10 then windows the list inside `FocusableScroll` using spacer divs, with scroll-to-index routed through a callback rather than a DOM query.

**Tech Stack:** React 18 + TypeScript, Vitest + RTL (jsdom), WebdriverIO e2e on WebKitGTK.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-commit-graph-v2-design.md`, "Phase 4". Issue #68 G9/G10. G10 is also #61 A8's History half.
- **Toolchain:** prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to every `pnpm`/`cargo` command.
- **No Rust changes.** Pagination is Phase 5; this phase keeps the 500-commit cap exactly as it is.
- **Row pitch is `COMMIT_ROW_BASE_H + useDensityStep()`** (`git-components.tsx:1152`, `useSettingsStore.ts:877`). **Never write a literal `26`** — that is the #70 bug, and virtualization multiplies it into a scroll-position error.
- **E2E rules** — `.claude/skills/e2e-testing/SKILL.md` was read before writing this plan and applies to Task 6: helpers live in `e2e/support/`, never inline in a spec; side-effectful in-page scripts go through `executeOnce()`, read-only ones may use bare `browser.execute`; every wait carries `timeout` + `timeoutMsg`; never `pause()`.
- **Verify e2e with Docker, never a native macOS run** (`pnpm test:e2e:docker`) — a native run collides with other worktrees on host port 4445 and can silently drive another checkout's binary.
- **Verification gate per task:** `pnpm test` and `pnpm tsc --noEmit` clean before committing.

## Out of scope (record, do not implement)

- **Reflog virtualization.** Reflog renders `PGCommitRow` too, but it is a separate, shorter list with its own fetch cap. It is touched here only because Task 1 changes a shared prop contract. #61 A8's tree half is likewise not claimed.
- **CSS `:hover` for rows.** `PGCommitRow` keeps its `useState` hover; that re-render is local to one row and memo does not prevent it. Listed as a "Minor" in #61, not part of G9.
- **G11** — the 500-cap and pagination are Phase 5.

## What is already stable (why G9 is smaller than the spec assumed)

The spec says "`rows` is rebuilt wholesale on every `visible` change, so at the 500-row cap every keystroke in search rebuilds 500 SVGs". True for the *search* path — but re-verified on `main@9856a89`, `rows` and `visible` are both `React.useMemo`'d (`History.tsx:165-188`), so on a **selection** change (the common case) `rows[i]`, `g.lanes` and `g.node` all keep reference identity already. Only three props are fresh per render:

1. `onClick={(e) => onRowClick(c.oid, e)}` and `onContextMenu` (`History.tsx:482-483`)
2. `mapCommitRefs(c.refs, headName)` (`:466`)
3. `visibleRefs` — the `.filter()` on top of it (`:467-468`)

So Tasks 1–2 make `React.memo` actually bite for selection/hover/filter-toggle renders. Task 3 adds the lane-identity cache that the *search* path needs, where `visible` genuinely changes.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/design/git-components.tsx` | `oid` + `onRowClick`/`onRowContext` props; `React.memo` on both row components | modify |
| `src/screens/Reflog.tsx` | Adopt the new prop contract | modify |
| `src/screens/History.tsx` | Shared `useCallback` handlers, memoized refs, windowing, `data-total` | modify |
| `src/features/commits/rowIdentity.ts` | Lane/node reference cache keyed by oid + geometry signature | **create** |
| `src/lib/useWindowedList.ts` | Generic windowing math, shared with #61 A8 later | **create** |
| `src/features/keymap/usePaneList.ts` | Optional `scrollToIndex` callback, DOM query as fallback | modify |
| `src/features/keymap/FocusableScroll.tsx` | Expose `innerRef` + `onScroll` | modify |
| `e2e/support/app.ts` | `scrollCommitListTo(text)` helper | modify |
| six `e2e/specs/*.e2e.ts` | Route text-selection through the helper | modify |

---

### Task 1: `PGCommitRow` takes an oid and shared handlers

**Files:**
- Modify: `src/design/git-components.tsx` (`PGCommitRowProps`, `PGCommitRow`)
- Modify: `src/screens/Reflog.tsx:238-250`
- Modify: `src/screens/History.tsx:470-484`
- Test: `src/design/git-components.rowprops.test.tsx` (**create**)

**Interfaces:**
- Produces: `PGCommitRowProps` gains `oid?: string`, `onRowClick?: (oid: string, e: React.MouseEvent) => void`, `onRowContext?: (oid: string, e: React.MouseEvent) => void`. The existing `onClick`/`onContextMenu` are **removed** — leaving both paths would let a caller keep passing closures and silently defeat Task 4's memo.

**Why `oid` and not a generic `rowKey`:** Reflog's row action is already oid-based (`selectEntry(e.oid)`, `selected={selectedOid === e.oid}`), so `oid` serves both callers honestly. Reflog's React `key` stays `${oid}-${timestamp}` — that is a separate concern from the identity it passes to its handler.

- [ ] **Step 1: Write the failing test**

Create `src/design/git-components.rowprops.test.tsx`:

```tsx
// PGCommitRow reports its own identity, so callers pass ONE stable handler pair
// instead of a fresh closure per row (#68 G9).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { PGCommitRow } from "./git-components";

const base = { graphW: 0, sha: "abc1234", message: "m", author: "a", date: "d" };

describe("PGCommitRow row callbacks", () => {
  it("hands its oid to a shared click handler", () => {
    const onRowClick = vi.fn();
    const { getByTestId } = render(
      <PGCommitRow {...base} oid="deadbeef" onRowClick={onRowClick} />,
    );
    fireEvent.click(getByTestId("commit-row"));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0]![0]).toBe("deadbeef");
  });

  it("hands its oid to a shared context handler", () => {
    const onRowContext = vi.fn();
    const { getByTestId } = render(
      <PGCommitRow {...base} oid="deadbeef" onRowContext={onRowContext} />,
    );
    fireEvent.contextMenu(getByTestId("commit-row"));
    expect(onRowContext.mock.calls[0]![0]).toBe("deadbeef");
  });

  it("stays inert when no handlers are supplied", () => {
    const { getByTestId } = render(<PGCommitRow {...base} />);
    expect(() => fireEvent.click(getByTestId("commit-row"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.rowprops.test.tsx`
Expected: FAIL — `onRowClick` is not a known prop, so the handler is never called.

- [ ] **Step 3: Write minimal implementation**

**3a.** In `PGCommitRowProps`, replace `onClick`/`onContextMenu` with:

```ts
  /** Row identity, handed back to the shared handlers below. */
  oid?: string;
  /**
   * Shared across every row — History passes one `useCallback` pair rather
   * than a closure per row, which is what lets React.memo actually skip rows
   * whose own props did not change (#68 G9).
   */
  onRowClick?: (oid: string, e: React.MouseEvent) => void;
  onRowContext?: (oid: string, e: React.MouseEvent) => void;
```

**3b.** In the component signature swap `onClick, onContextMenu` for `oid, onRowClick, onRowContext`, and on the row `<div>`:

```tsx
      onClick={onRowClick && oid !== undefined ? (e) => onRowClick(oid, e) : undefined}
      onContextMenu={
        onRowContext && oid !== undefined ? (e) => onRowContext(oid, e) : undefined
      }
```

**3c.** `Reflog.tsx:238-250` — add `oid={e.oid}` and replace `onClick={() => void selectEntry(e.oid)}` with `onRowClick={onRowClick}`, hoisting above the map:

```tsx
  const onRowClick = React.useCallback(
    (oid: string) => void selectEntry(oid),
    [selectEntry],
  );
```

**3d.** `History.tsx:470-484` — pass `oid={c.oid}` and the shared pair (defined in Task 2); for this task, temporarily inline `onRowClick={(oid, e) => onRowClick(oid, e)}` so the file compiles, and Task 2 replaces it.

- [ ] **Step 4: Run tests**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/ src/screens/`
Expected: PASS.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/design/git-components.tsx src/design/git-components.rowprops.test.tsx src/screens/Reflog.tsx src/screens/History.tsx
git commit -m "refactor(graph): commit rows report their oid to shared handlers (#68 G9)"
```

---

### Task 2: Stable handlers and memoized refs in History

**Files:**
- Modify: `src/screens/History.tsx:387-406` (handlers), `:464-486` (row map)
- Test: `src/screens/History.render.test.tsx` (**create**)

**Interfaces:**
- Consumes: Task 1's `oid` / `onRowClick` / `onRowContext`.
- Produces: nothing new externally; the row map stops allocating per render.

**Note on `onRowContext`:** it currently takes the whole `CommitInfo` because it needs `c.summary` for the menu. With an oid-only signature History looks the commit up — add a `byOid` map memoized on `visible`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/History.render.test.tsx`. It asserts the observable consequence — selecting a row must not re-render every other row — by counting renders through a spy on the row component is brittle; instead assert prop identity, which is what memo keys off:

```tsx
// Selecting a commit must not hand every OTHER row fresh props, or React.memo
// can never skip them (#68 G9).
import { describe, expect, it, beforeEach } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import type { CommitInfo } from "@/lib/types";

const oid = (l: string) => l.repeat(40).slice(0, 40);
const mk = (l: string, parents: string[] = []): CommitInfo => ({
  oid: oid(l), shortOid: oid(l).slice(0, 7), summary: `subject ${l}`, body: null,
  author: "Dev", email: "dev@example.com", timestamp: 1_700_000_000, parents, refs: [],
});
const LINEAR = [mk("a", [oid("b")]), mk("b", [oid("c")]), mk("c")];

beforeEach(() => {
  useKeymapStore.getState().reset?.();
  useFocusStore.setState({ focusedPane: null, pendingContentFocus: false });
  useNavStore.setState({ intent: null });
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: LINEAR, searchResults: null, searching: false,
    searchCommits: async () => {}, branches: [], status: [], loading: false,
  } as never);
});

describe("History row rendering", () => {
  it("keeps unrelated rows' DOM nodes identical across a selection change", () => {
    // Reference identity of the DOM node is the observable proxy for "React
    // did not rebuild this row's subtree".
    return (async () => {
      const { container } = render(<HistoryScreen />);
      await waitFor(() =>
        expect(container.querySelectorAll('[data-testid="commit-row"]').length).toBe(3),
      );
      const rowsBefore = [...container.querySelectorAll('[data-testid="commit-row"]')];
      fireEvent.click(rowsBefore[2]!);
      await waitFor(() =>
        expect(rowsBefore[2]!.getAttribute("data-selected")).toBe("true"),
      );
      const rowsAfter = [...container.querySelectorAll('[data-testid="commit-row"]')];
      // Same nodes, reused — not torn down and rebuilt.
      expect(rowsAfter[0]).toBe(rowsBefore[0]);
      expect(rowsAfter[1]).toBe(rowsBefore[1]);
    })();
  });
});
```

- [ ] **Step 2: Run test to verify it currently passes or fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/screens/History.render.test.tsx`
Expected: **PASS even before the change** — React reuses DOM nodes on re-render regardless of memo. Record this: it is a regression guard for Task 4's memo (which can break reconciliation if `key` handling is got wrong), not a driver for Task 2. Keep it; do not weaken it into something that passes vacuously.

- [ ] **Step 3: Write the implementation**

In `History.tsx`:

```tsx
  const onRowClick = React.useCallback((oidClicked: string, e: React.MouseEvent) => {
    setSel((prev) =>
      clickSelection(order, prev, oidClicked, {
        toggle: e.metaKey || e.ctrlKey,
        range: e.shiftKey,
      }),
    );
    setLeadOid(oidClicked);
  }, [order]);

  /** Oid → commit, so the context handler can take an oid like the click one. */
  const byOid = React.useMemo(
    () => new Map(visible.map((c) => [c.oid, c])),
    [visible],
  );

  const onRowContext = React.useCallback(
    (oidClicked: string, e: React.MouseEvent) => {
      const c = byOid.get(oidClicked);
      if (!c) return;
      if (multiSelected && selectedSet.has(c.oid)) {
        onCommitMulti(e, sel.keys);
        return;
      }
      setSel(clickSelection(order, sel, c.oid, {}));
      setLeadOid(c.oid);
      onCommitContext(e, { sha: c.oid, subject: c.summary });
    },
    [byOid, multiSelected, selectedSet, sel, order, onCommitMulti, onCommitContext],
  );
```

Memoize the ref pills per oid, replacing the per-render `mapCommitRefs` + `.filter()`:

```tsx
  const refsByOid = React.useMemo(() => {
    const m = new Map<string, CommitRef[]>();
    for (const c of visible) {
      const all = mapCommitRefs(c.refs, headName);
      m.set(c.oid, refFilter === "local" ? all.filter((r) => !r.remote) : all);
    }
    return m;
  }, [visible, headName, refFilter]);
```

and in the row map use `oid={c.oid}`, `refs={refsByOid.get(c.oid)}`, `onRowClick={onRowClick}`, `onRowContext={onRowContext}`.

- [ ] **Step 4: Run tests**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/screens/`
Expected: PASS, including the existing `History.keyboard`, `History.multiselect`, `History.diff`, `History.graph` suites — those exercise selection, ranges and context menus, which are exactly what this task rewires.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/screens/History.tsx src/screens/History.render.test.tsx
git commit -m "perf(graph): stabilize History row props for memoization (#68 G9)"
```

---

### Task 3: Lane identity cache across re-layout

**Files:**
- Create: `src/features/commits/rowIdentity.ts`
- Test: `src/features/commits/rowIdentity.test.ts`
- Modify: `src/screens/History.tsx` (wrap the `rows` memo)

**Interfaces:**
- Produces: `createRowCache(): { stabilize(commits: readonly CommitInfo[], rows: GraphRow[]): GraphRow[] }`. Returns an array where each entry is the *previous* `GraphRow` object when that oid's geometry is unchanged, so `lanes`/`node` keep reference identity across a re-layout.

**Why this is needed even though `rows` is already memoized:** the memo's deps include `visible`, so the *search* path — the one the spec calls out, 500 SVGs per keystroke — invalidates it on every keystroke. Rows whose geometry did not actually change should still skip re-render.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createRowCache } from "./rowIdentity";
import { layoutGraph } from "./graphLayout";
import type { CommitInfo } from "@/lib/types";

const c = (oid: string, parents: string[] = []): CommitInfo => ({
  oid, shortOid: oid.slice(0, 7), summary: oid, body: null,
  author: "t", email: "t@t", timestamp: 0, parents, refs: [],
});

describe("createRowCache", () => {
  it("reuses row objects when geometry is unchanged", () => {
    const commits = [c("A", ["B"]), c("B", ["C"]), c("C")];
    const cache = createRowCache();
    const first = cache.stabilize(commits, layoutGraph(commits).rows);
    const second = cache.stabilize(commits, layoutGraph(commits).rows);
    expect(second[0]).toBe(first[0]);
    expect(second[1]!.lanes).toBe(first[1]!.lanes);
  });

  it("replaces a row whose geometry changed", () => {
    const cache = createRowCache();
    const linear = [c("A", ["B"]), c("B")];
    const forked = [c("A", ["B", "X"]), c("B"), c("X")];
    const first = cache.stabilize(linear, layoutGraph(linear).rows);
    const second = cache.stabilize(forked, layoutGraph(forked).rows);
    expect(second[0]).not.toBe(first[0]);
  });

  it("drops oids that left the list, so the cache cannot grow without bound", () => {
    const cache = createRowCache();
    const big = [c("A", ["B"]), c("B", ["C"]), c("C")];
    cache.stabilize(big, layoutGraph(big).rows);
    const small = [c("C")];
    cache.stabilize(small, layoutGraph(small).rows);
    expect(cache.size()).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/rowIdentity.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```ts
// Reference-identity cache for laid-out graph rows (#68 G9).
//
// `layoutGraph` is memoized on `visible`, so a SEARCH keystroke rebuilds every
// row object even where the drawn geometry is identical. React.memo compares by
// reference, so without this each keystroke re-renders 500 SVGs.
import type { CommitInfo } from "@/lib/types";
import type { GraphRow } from "./graphLayout";

/** Compact geometry fingerprint. Anything that changes pixels must appear here. */
function signature(row: GraphRow): string {
  const lanes = row.lanes
    .map((l) => `${l.col},${l.kind},${l.color},${l.to ?? ""},${l.dashed ? 1 : 0},${l.primary ? 1 : 0}`)
    .join("|");
  const n = row.node;
  return `${lanes}#${n.col},${n.color},${n.solid ? 1 : 0},${n.merge ? 1 : 0},${n.truncated ? 1 : 0},${n.head ? 1 : 0}`;
}

export function createRowCache() {
  let prev = new Map<string, { sig: string; row: GraphRow }>();
  return {
    stabilize(commits: readonly CommitInfo[], rows: GraphRow[]): GraphRow[] {
      const next = new Map<string, { sig: string; row: GraphRow }>();
      const out = rows.map((row, i) => {
        const oid = commits[i]?.oid;
        if (oid === undefined) return row;
        const sig = signature(row);
        const hit = prev.get(oid);
        const kept = hit && hit.sig === sig ? hit.row : row;
        next.set(oid, { sig, row: kept });
        return kept;
      });
      // Rebuilt from THIS pass only, so oids that scrolled or filtered out are
      // dropped rather than accumulating for the session.
      prev = next;
      return out;
    },
    size: () => prev.size,
  };
}
```

- [ ] **Step 4: Wire into History and run**

In `History.tsx`, hold one cache per mounted screen and stabilize after layout:

```tsx
  const rowCache = React.useRef(createRowCache());
  const { rows: rawRows, maxCol } = React.useMemo(
    () => layoutGraph(visible, { ancestry, headOid: head?.tip ?? undefined }),
    [visible, ancestry, head?.tip],
  );
  const rows = React.useMemo(
    () => rowCache.current.stabilize(visible, rawRows),
    [visible, rawRows],
  );
```

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/ src/screens/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/features/commits/rowIdentity.ts src/features/commits/rowIdentity.test.ts src/screens/History.tsx
git commit -m "perf(graph): keep lane identity stable across re-layout (#68 G9)"
```

---

### Task 4: Memoize the row components

**Files:**
- Modify: `src/design/git-components.tsx` (`PGGraphRow`, `PGCommitRow`)
- Test: `src/design/git-components.graph.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

```tsx
describe("row memoization (#68 G9)", () => {
  it("skips re-rendering a commit row whose props are unchanged", () => {
    let renders = 0;
    function Probe({ tick, sel }: { tick: number; sel: boolean }) {
      renders++;
      return <PGCommitRow graphW={0} sha="a" message={`m${0 * tick}`} author="x" date="d" selected={sel} />;
    }
    // Sanity: the probe itself is not memoized, so this is about PGCommitRow.
    const { rerender, container } = render(<MemoHost tick={0} />);
    const first = container.querySelector('[data-testid="commit-row"]');
    rerender(<MemoHost tick={1} />);
    expect(container.querySelector('[data-testid="commit-row"]')).toBe(first);
    expect(renders).toBeGreaterThan(0);
  });
});
```

Replace the sketch above with this concrete, self-contained version — a parent whose state changes while the row's props do not:

```tsx
describe("row memoization (#68 G9)", () => {
  function Host() {
    const [tick, setTick] = React.useState(0);
    return (
      <div>
        <button data-testid="bump" onClick={() => setTick((t) => t + 1)}>
          {tick}
        </button>
        <PGGraphRow lanes={LANES} node={NODE} width={graphWidth(0)} height={26} />
      </div>
    );
  }
  const LANES: GraphLane[] = [{ col: 0, color: "red", kind: "line" }];
  const NODE: GraphNode = { col: 0, color: "red", solid: true };

  it("does not rebuild the graph SVG when only the parent's state changed", () => {
    const { getByTestId, container } = render(<Host />);
    const svgBefore = container.querySelector("svg");
    fireEvent.click(getByTestId("bump"));
    expect(getByTestId("bump").textContent).toBe("1");
    // Same element instance: memo skipped the subtree entirely.
    expect(container.querySelector("svg")).toBe(svgBefore);
  });
});
```

Add `React` and `fireEvent` to that file's imports if absent, and hoist `LANES`/`NODE` above `Host`.

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.graph.test.tsx`
Expected: FAIL — without memo React re-renders `PGGraphRow`; note that React may still reuse the DOM node, so if this passes before the change, strengthen it by asserting on a render counter injected via a `color` prop change instead. Do not proceed on a vacuous green.

- [ ] **Step 3: Implement**

Wrap both exports:

```tsx
export const PGGraphRow = React.memo(function PGGraphRow({ … }) { … });
export const PGCommitRow = React.memo(function PGCommitRow({ … }) { … });
```

`React.memo`'s default shallow compare is correct here: after Tasks 1–3 every prop is either a primitive or a reference stabilized upstream.

- [ ] **Step 4: Run the full suite**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run`
Expected: PASS. Watch for suites that relied on a row re-rendering from parent state — if one breaks, the prop it depends on is not stabilized, and the fix belongs in Task 2/3, not in loosening the memo.

- [ ] **Step 5: Commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/design/git-components.tsx src/design/git-components.graph.test.tsx
git commit -m "perf(graph): memoize PGGraphRow and PGCommitRow (#68 G9)"
```

---

### Task 5: Window the commit list

**Files:**
- Create: `src/lib/useWindowedList.ts`, `src/lib/useWindowedList.test.ts`
- Modify: `src/features/keymap/FocusableScroll.tsx`, `src/features/keymap/usePaneList.ts`, `src/screens/History.tsx`
- Test: `src/screens/History.virtual.test.tsx` (**create**)

**Interfaces:**
- Produces: `useWindowedList({ count, rowHeight, overscan }): { start, end, topPad, bottomPad, onScroll, viewportRef, scrollToIndex }`.
- `FocusableScroll` gains `innerRef?: React.Ref<HTMLDivElement>` and `onScroll?: React.UIEventHandler`.
- `usePaneList` gains `scrollToIndex?: (i: number) => void` — when supplied it replaces the DOM query at `usePaneList.ts:89-95`.

**Three things that break if done naively, all called out by the spec:**
1. **Spacer divs, not a short list.** `FocusableScroll.onKeyDown` implements `End` as `scrollTop = scrollHeight` and PageUp/Dn off `clientHeight`. Without top/bottom spacers keeping `scrollHeight` exact, End jumps to the wrong place.
2. **Scroll-to-index must not be DOM-driven.** `usePaneList.ts:91` finds `[data-pg-row][data-selected]` and calls `scrollIntoView`. Under windowing the selected row is frequently unmounted, so keyboard nav would silently stop scrolling.
3. **Row pitch comes from `COMMIT_ROW_BASE_H + useDensityStep()`.** A literal 26 desynchronizes the window from the rows at any non-compact density.

- [ ] **Step 1: Write the failing test for the windowing math**

```ts
import { describe, expect, it } from "vitest";
import { windowRange } from "./useWindowedList";

describe("windowRange", () => {
  it("returns the visible slice plus overscan", () => {
    const r = windowRange({ scrollTop: 0, viewportH: 100, rowHeight: 10, count: 100, overscan: 2 });
    expect(r.start).toBe(0);
    expect(r.end).toBe(12); // 10 visible + 2 overscan
  });

  it("clamps at both ends", () => {
    expect(windowRange({ scrollTop: 0, viewportH: 100, rowHeight: 10, count: 3, overscan: 8 }).end).toBe(3);
    const tail = windowRange({ scrollTop: 990, viewportH: 100, rowHeight: 10, count: 100, overscan: 2 });
    expect(tail.end).toBe(100);
    expect(tail.start).toBeLessThan(100);
  });

  it("keeps total padded height equal to the full list height", () => {
    const r = windowRange({ scrollTop: 300, viewportH: 100, rowHeight: 10, count: 100, overscan: 2 });
    expect(r.topPad + (r.end - r.start) * 10 + r.bottomPad).toBe(1000);
  });

  it("survives a zero viewport (first paint, before layout)", () => {
    const r = windowRange({ scrollTop: 0, viewportH: 0, rowHeight: 10, count: 50, overscan: 2 });
    expect(r.end).toBeGreaterThan(r.start);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/lib/useWindowedList.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the math and the hook**

```ts
// Fixed-pitch list windowing. Kept generic so #61 A8 can reuse it for the file
// tree rather than growing a second implementation.
import React from "react";

export interface WindowRange {
  start: number;
  end: number;
  topPad: number;
  bottomPad: number;
}

export function windowRange(o: {
  scrollTop: number;
  viewportH: number;
  rowHeight: number;
  count: number;
  overscan: number;
}): WindowRange {
  const { scrollTop, viewportH, rowHeight, count, overscan } = o;
  // Before first layout the viewport measures 0; render one screen's worth
  // anyway so the list is never blank and e2e can find a row immediately.
  const visible = Math.max(1, Math.ceil((viewportH || rowHeight * 20) / rowHeight));
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, start + visible + overscan * 2);
  return {
    start,
    end,
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (count - end) * rowHeight),
  };
}

export function useWindowedList(o: { count: number; rowHeight: number; overscan?: number }) {
  const { count, rowHeight, overscan = 8 } = o;
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(0);

  React.useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportH(el.clientHeight);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = React.useCallback(() => {
    const el = viewportRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  /** Store-driven, because the target row is usually not mounted. */
  const scrollToIndex = React.useCallback(
    (i: number) => {
      const el = viewportRef.current;
      if (!el) return;
      const top = i * rowHeight;
      const bottom = top + rowHeight;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight;
      }
    },
    [rowHeight],
  );

  const range = windowRange({ scrollTop, viewportH, rowHeight, count, overscan });
  return { ...range, onScroll, viewportRef, scrollToIndex };
}
```

- [ ] **Step 4: Thread it through FocusableScroll, usePaneList and History**

`FocusableScroll` — accept and merge an external ref plus `onScroll`:

```tsx
  innerRef?: React.RefObject<HTMLDivElement | null>;
  onScroll?: React.UIEventHandler<HTMLDivElement>;
```

Use `innerRef ?? ref` for the element and pass `onScroll` through. Keep the internal ref as the fallback so every existing call site is unaffected.

`usePaneList` — take an optional `scrollToIndex` and prefer it:

```ts
  React.useEffect(() => {
    if (!isFocused) return;
    if (opts.scrollToIndex) {
      // Windowed lists: the selected row is frequently unmounted, so a DOM
      // query would find nothing and scrolling would silently stop.
      opts.scrollToIndex(selectedIndex);
      return;
    }
    const row = document.querySelector<HTMLElement>(
      `[data-pg-pane="${paneId}"] [data-pg-row][data-selected]`,
    );
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedIndex, isFocused, paneId, opts.scrollToIndex]);
```

`History.tsx` — window the map, and add the count hook the e2e migration needs:

```tsx
  const rowH = COMMIT_ROW_BASE_H + useDensityStep();
  const win = useWindowedList({ count: visible.length, rowHeight: rowH });
```

then render inside `FocusableScroll` (passing `innerRef={win.viewportRef}` and `onScroll={win.onScroll}`):

```tsx
  <div data-testid="commit-list" data-total={visible.length}>
    <div style={{ height: win.topPad }} />
    {visible.slice(win.start, win.end).map((c, i) => {
      const g = rows[win.start + i];
      …
    })}
    <div style={{ height: win.bottomPad }} />
  </div>
```

and pass `scrollToIndex: win.scrollToIndex` into History's `usePaneList` options.

Then create `src/screens/History.virtual.test.tsx` asserting: a 300-commit store renders far fewer than 300 rows; `[data-testid="commit-list"]` reports `data-total="300"`; and the padded height math keeps `topPad + rendered + bottomPad` equal to `300 * rowH`.

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/lib/ src/screens/ src/features/keymap/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/lib/useWindowedList.ts src/lib/useWindowedList.test.ts src/features/keymap/FocusableScroll.tsx src/features/keymap/usePaneList.ts src/screens/History.tsx src/screens/History.virtual.test.tsx
git commit -m "perf(graph): virtualize the History commit list (#68 G10)"
```

---

### Task 6: E2E migration (same PR as Task 5, non-negotiable)

**Files:**
- Modify: `e2e/support/app.ts` (new helper)
- Modify: `e2e/specs/history-diff.e2e.ts`, `history-ops.e2e.ts`, `keymap.e2e.ts`, `palette.e2e.ts`, `rebase.e2e.ts`, `settings.e2e.ts`

**Why same PR:** these specs select commit rows by visible text and one asserts an exact row count. Virtualization breaks them the moment it lands, so shipping Task 5 without this is shipping a red suite.

**`reflog.e2e.ts` is NOT in the list** even though it matches `commit-row` — Reflog is not virtualized (see Out of scope). Verify before editing: if a spec's rows all fit one screen, it needs no change.

- [ ] **Step 1: Add the helper**

In `e2e/support/app.ts` — read-only scroll probing, so bare `browser.execute` is correct here (`executeOnce` is for side-effectful scripts):

```ts
/**
 * Scroll the windowed History list until a row containing `text` is mounted.
 * Virtualization means a row that exists in the model may not be in the DOM,
 * so a bare selector wait would time out on a commit that is merely off-screen.
 */
export async function scrollCommitListTo(text: string): Promise<void> {
  const sel = `[data-testid="commit-row"]*=${text}`;
  if (await $(sel).isExisting()) return;
  const total = Number(
    (await $('[data-testid="commit-list"]').getAttribute("data-total")) ?? "0",
  );
  for (let i = 0; i < total; i += 10) {
    await browser.execute((n: number) => {
      const el = document.querySelector<HTMLElement>("[data-pg-focus-target]");
      if (el) el.scrollTop = n;
    }, i * 26);
    if (await $(sel).isExisting()) return;
  }
  throw new Error(`commit row matching "${text}" never appeared after scrolling`);
}
```

- [ ] **Step 2: Convert the exact-count assertion**

`history-diff.e2e.ts:25` currently waits on `$$('[data-testid="commit-row"]').length === expected`. Under windowing that count is the *mounted* count. Replace with the model count:

```ts
await browser.waitUntil(
  async () =>
    (await $('[data-testid="commit-list"]').getAttribute("data-total")) ===
    String(expected),
  { timeout: 15_000, timeoutMsg: `commit list never reported ${expected} rows` },
);
```

- [ ] **Step 3: Route text selection through the helper**

For each remaining spec, replace a bare `await $('[data-testid="commit-row"]*=TEXT').click()` with `await scrollCommitListTo("TEXT"); await $('[data-testid="commit-row"]*=TEXT').click();`. Import the helper from `../support/app`.

- [ ] **Step 4: Typecheck and run the affected specs**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test:e2e:docker full --spec e2e/specs/history-diff.e2e.ts --spec e2e/specs/history-ops.e2e.ts --spec e2e/specs/keymap.e2e.ts --spec e2e/specs/palette.e2e.ts --spec e2e/specs/rebase.e2e.ts --spec e2e/specs/settings.e2e.ts
```

Docker, never native — see Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add e2e/
git commit -m "test(e2e): scroll the windowed commit list before selecting rows (#68 G10)"
```

---

### Task 7: Full verification

- [ ] **Step 1:** `pnpm test --run` — all green, count strictly above the 588 baseline.
- [ ] **Step 2:** `pnpm tsc --noEmit` and `pnpm exec tsc -p e2e/tsconfig.json --noEmit` — both clean.
- [ ] **Step 3:** `cargo check --manifest-path src-tauri/Cargo.toml` — clean (guard; no Rust touched).
- [ ] **Step 4:** `pnpm test:e2e:docker` — **full suite**, because Task 1 changed a shared design-system prop contract and Task 5 changed a shared scroll component, so blast radius is not limited to History.
- [ ] **Step 5:** Squash onto latest `origin/main`, push, open a draft PR referencing #68 G9/G10 and #61 A8.

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| G9 callbacks → `oid` + shared handlers, touching Reflog | 1, 2 |
| G9 memoize `refs` per oid | 2 |
| G9 cache `lanes` by oid + geometry signature | 3 |
| G9 `React.memo` on both row components | 4 |
| G9 lands before G10, separately | task order + separate commits |
| G10 row pitch from `COMMIT_ROW_BASE_H + useDensityStep()` | 5 (Global Constraints) |
| G10 spacer divs so `scrollHeight` stays exact | 5 |
| G10 overscan ~8 | 5 (`overscan = 8` default) |
| G10 store/ref-driven scroll-to-index | 5 |
| G10 share the helper with #61 A8 | 5 (`src/lib/useWindowedList.ts`, deliberately generic) |
| G10 `data-testid="commit-list"` + `data-total` | 5, 6 |
| G10 e2e helper + six specs, same PR | 6 |
| Read the e2e skill first | done before writing this plan |

**2. Placeholder scan.** Task 4 Step 1 contains a sketch followed by the concrete version — the sketch is labelled and explicitly replaced; the executable test is the second block. Task 5 Step 4's History test is described rather than written out in full, which is the one place this plan is thinner than the rest: write it against the three named assertions.

**3. Type consistency.** `oid` / `onRowClick` / `onRowContext` are introduced in Task 1 and consumed under those names in Tasks 2 and 5. `windowRange` / `useWindowedList` are defined in Task 5 and used only there. `createRowCache().stabilize(commits, rows)` matches its call site. `scrollCommitListTo` is defined once in `e2e/support/app.ts` and imported by five specs.

**Known risk:** Task 4 Step 2 may pass before the change (React reuses DOM nodes without memo). The plan says explicitly not to accept a vacuous green and to strengthen the assertion instead — the same failure mode that bit Phase 2+3's first colour tests.
