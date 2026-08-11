# Commit graph v2 — Phase 1 (correctness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three wrong-pixels bugs in the History commit graph — lanes clipped past column 8 (G1), search hits on one branch rendering as unrelated phantom lanes instead of one dashed lane (G2), and a dead `diag` lane kind (G3).

**Architecture:** Two new pure modules carry the new logic so the existing files stay focused. `src/design/graph-geometry.ts` owns the lane arithmetic that was three scattered `140` literals. `src/features/commits/graphAncestry.ts` owns parent rewriting — mapping each commit's true parents onto the nearest ancestor that survives filtering. `layoutGraph` consumes the resolver and grows a return record (`{ rows, maxCol }`) so callers can size the gutter to the actual lane count. The renderer gains a `dashed` flag on existing lane kinds and a `truncated` flag on the node; no new lane kind.

**Tech Stack:** TypeScript, React 18, Vite, Vitest (+ jsdom / React Testing Library), WebdriverIO for e2e. No new dependencies. **No Rust changes in this phase.**

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-commit-graph-v2-design.md`. Read it before Task 1; it records three corrections to issue #68 and the reasoning behind them.
- **Toolchain:** Node 22 + pnpm. The Bash tool does not inherit the interactive shell rc — prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to every `pnpm` command. A fresh worktree has no `node_modules`; run `pnpm install` once before the first test.
- **Running one test file:** `pnpm test <path>` (the `test` script is `vitest run`, which takes a path filter). There is no `pnpm vitest` binary alias.
- **Branch:** work on `docs/commit-graph-v2` or a fresh `fix/commit-graph-correctness` branched off latest `origin/main`. Never commit to `main`. Always in a worktree under `.claude/worktrees/`.
- **`CommitInfo.parents` is never mutated or overwritten.** It is the ancestry source of truth for `CommitDiff`'s "parent → commit" header (`History.tsx:462-464`), `buildRebasePlan`, and `planCommitSelection`. Rewritten links live only inside the layout.
- **No backend, no wire-format change.** `src-tauri/` and `src/lib/types.ts` are untouched in this phase.
- **Row pitch is `COMMIT_ROW_BASE_H + useDensityStep()`**, both already exported (`git-components.tsx:1049`, `useSettingsStore.ts:754`). Never reintroduce a literal `26`.
- **Commit style:** Conventional Commits, imperative subject under 72 chars, `**Why:**` body for non-obvious decisions, trailing `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Verify before claiming done.** Run the stated command and read its output. Type-check with `pnpm tsc --noEmit` before each commit.

---

## File Structure

| File | Responsibility |
|---|---|
| **Create** `src/design/graph-geometry.ts` | Pure lane arithmetic: `GRAPH_PAD`, `LANE_W`, `GRAPH_MAX_W`, `laneX`, `graphWidth`, `isGraphClamped`, `maxVisibleCol`, `commitRowGrid`. Separate from `git-components.tsx` so History and tests can import the math without pulling in React components. |
| **Create** `src/design/graph-geometry.test.ts` | Unit tests for the above, including the col-8 regression. |
| **Create** `src/features/commits/graphAncestry.ts` | Parent rewriting: `createAncestryResolver` → `{ resolve, trueParents }`. One responsibility, independently testable, keeps `graphLayout.ts` about lanes. |
| **Create** `src/features/commits/graphAncestry.test.ts` | Resolver tests: elision, dedupe, truncation, cycle guard. |
| **Create** `src/design/git-components.graph.test.tsx` | `PGGraphRow` rendering: width tracks lane count, col-9 inside viewport, `dashed` → `strokeDasharray`, truncated stub, `aria-hidden`. Follows the `git-components.density.test.tsx` naming and style. |
| **Modify** `src/features/commits/graphLayout.ts` | Return `{ rows, maxCol }`; accept `LayoutOptions`; use the resolver; carry `dashed` on active lanes; set `node.truncated`. |
| **Modify** `src/features/commits/graphLayout.test.ts` | Existing 5 cases destructure `.rows`; new cases for `maxCol`, elision, truncation, fallback. |
| **Modify** `src/design/git-components.tsx` | `GraphLane.dashed`, `GraphNode.truncated`, delete `diag`, required `width`, new `graphW` prop on `PGCommitRow`, geometry from the new module. |
| **Modify** `src/design/git-components.density.test.tsx` | Add the now-required `graphW` prop to its four render calls. |
| **Modify** `src/design/index.ts` | Re-export `./graph-geometry`. |
| **Modify** `src/screens/History.tsx` | Build the ancestry union, consume `{ rows, maxCol }`, thread `graphW` + `clamped`, show the hidden-lane count in the `GRAPH` header. |
| **Modify** `src/screens/Reflog.tsx` | Pass `graphW={0}` — it renders no lanes, so the column is dropped. |
| **Modify** `e2e/specs/history-diff.e2e.ts` | Cover the visible G2 symptom. |

---

## Task 1: Lane geometry module

**Files:**
- Create: `src/design/graph-geometry.ts`
- Create: `src/design/graph-geometry.test.ts`
- Modify: `src/design/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `GRAPH_PAD: number`, `LANE_W: number`, `GRAPH_MAX_W: number`, `laneX(col: number): number`, `graphWidth(maxCol: number): number`, `isGraphClamped(maxCol: number): boolean`, `maxVisibleCol(): number`, `commitRowGrid(graphW: number): string`. Every later task imports from here.

- [ ] **Step 1: Write the failing test**

Create `src/design/graph-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  GRAPH_MAX_W,
  GRAPH_PAD,
  LANE_W,
  commitRowGrid,
  graphWidth,
  isGraphClamped,
  laneX,
  maxVisibleCol,
} from "./graph-geometry";

describe("graph geometry", () => {
  it("pins the lane constants", () => {
    // Literals, not derived: if any of these move, the SVG path math and the
    // row grids must be re-checked together.
    expect(GRAPH_PAD).toBe(12);
    expect(LANE_W).toBe(16);
    expect(GRAPH_MAX_W).toBe(240);
  });

  it("places lane centres 16px apart from a 12px pad", () => {
    expect(laneX(0)).toBe(12);
    expect(laneX(1)).toBe(28);
    expect(laneX(8)).toBe(140);
  });

  it("sizes a single-lane log to fit its dot", () => {
    expect(graphWidth(0)).toBe(24);
  });

  // THE G1 REGRESSION. The old gutter was a fixed 140px while lane 8 sits at
  // x=140 — the dot (r=4) was half-cut and lane 9+ vanished entirely.
  it("gives column 8 room the old fixed 140px did not", () => {
    expect(graphWidth(8)).toBe(152);
    expect(graphWidth(8)).toBeGreaterThan(140);
    expect(laneX(8) + 4).toBeLessThanOrEqual(graphWidth(8));
  });

  it("keeps every node dot inside the gutter up to the clamp", () => {
    for (let col = 0; col <= maxVisibleCol(); col++) {
      expect(laneX(col) + 4).toBeLessThanOrEqual(graphWidth(col));
    }
  });

  it("clamps runaway lane counts instead of growing without bound", () => {
    expect(maxVisibleCol()).toBe(13);
    expect(graphWidth(13)).toBe(232);
    expect(isGraphClamped(13)).toBe(false);
    expect(graphWidth(14)).toBe(GRAPH_MAX_W);
    expect(isGraphClamped(14)).toBe(true);
    expect(graphWidth(100)).toBe(GRAPH_MAX_W);
    expect(isGraphClamped(100)).toBe(true);
  });

  it("builds a five-column grid with the graph, four without", () => {
    expect(commitRowGrid(152)).toBe("152px 70px 1fr 150px 90px");
    // graphW of 0 means "no graph column at all" (Reflog), which is NOT the
    // same as graphWidth(0)=24, a real one-lane log.
    expect(commitRowGrid(0)).toBe("70px 1fr 150px 90px");
    expect(commitRowGrid(0).split(" ")).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/graph-geometry.test.ts
```

Expected: FAIL — `Failed to resolve import "./graph-geometry"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/design/graph-geometry.ts`:

```ts
// Lane geometry for the History commit graph, in SVG user units.
//
// These numbers used to be four separate literals: PGGraphRow's `width = 140`
// default, `12 + col * 16` inside its path math, the PGCommitRow grid's `140px`,
// and History's matching header grid. A lane in column >= 9 was drawn outside
// the 140px viewport and disappeared, dot included — an SVG element is a
// viewport and clips by default, so there was no overflow, no scrollbar, and no
// warning (issue #68 G1). One module, one source of truth.

/** Left pad before the first lane centre, and the right pad after the last. */
export const GRAPH_PAD = 12;
/** Horizontal distance between adjacent lane centres. */
export const LANE_W = 16;
/** Hard ceiling on gutter width, so a pathological repo can't eat the row. */
export const GRAPH_MAX_W = 240;

/** x centre of a lane column. Node dots and lane strokes share this. */
export const laneX = (col: number): number => GRAPH_PAD + col * LANE_W;

/** Width needed to show every lane up to `maxCol`, clamped to GRAPH_MAX_W. */
export const graphWidth = (maxCol: number): number =>
  Math.min(GRAPH_MAX_W, GRAPH_PAD * 2 + maxCol * LANE_W);

/** True when `maxCol` needs more room than the clamp allows. */
export const isGraphClamped = (maxCol: number): boolean =>
  GRAPH_PAD * 2 + maxCol * LANE_W > GRAPH_MAX_W;

/** Highest column that still fits inside the clamp. */
export const maxVisibleCol = (): number =>
  Math.floor((GRAPH_MAX_W - GRAPH_PAD * 2) / LANE_W);

/**
 * Grid template shared by PGCommitRow and History's column header, so the two
 * cannot drift. `graphW === 0` drops the graph column entirely — that is
 * Reflog, which renders no lanes; it is NOT the same as `graphWidth(0)`, the
 * 24px a genuine one-lane log needs.
 */
export const commitRowGrid = (graphW: number): string =>
  graphW > 0
    ? `${graphW}px 70px 1fr 150px 90px`
    : `70px 1fr 150px 90px`;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/design/graph-geometry.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Re-export from the design barrel**

Add to `src/design/index.ts`, after the `./icons` line to keep it near the top of the pure modules:

```ts
export * from "./graph-geometry";
```

- [ ] **Step 6: Type-check and commit**

```bash
pnpm tsc --noEmit
git add src/design/graph-geometry.ts src/design/graph-geometry.test.ts src/design/index.ts
git commit -m "feat(graph): lane geometry module with a clamped, lane-aware width

Why: the gutter was a fixed 140px while lane x is 12 + col * 16, so column 8
was half-cut and 9+ vanished with no overflow and no warning. The number was
also hardcoded in three places that could drift. One module owns it now.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Ancestry resolver

**Files:**
- Create: `src/features/commits/graphAncestry.ts`
- Create: `src/features/commits/graphAncestry.test.ts`

**Interfaces:**
- Consumes: `CommitInfo` from `@/lib/types`.
- Produces:
  - `interface ResolvedParent { oid: string; elided: boolean }`
  - `interface AncestryResolver { resolve(oid: string): ResolvedParent[]; trueParents(oid: string): string[] }`
  - `createAncestryResolver(visibleCommits: readonly CommitInfo[], ancestry?: readonly CommitInfo[]): AncestryResolver`

  Task 4 calls `resolve` for lane bookkeeping and `trueParents` for node shape.

- [ ] **Step 1: Write the failing test**

Create `src/features/commits/graphAncestry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CommitInfo } from "@/lib/types";
import { createAncestryResolver } from "./graphAncestry";

/** Fake CommitInfo — only `oid` and `parents` are semantically used here. */
function c(oid: string, parents: string[] = []): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary: oid,
    body: null,
    author: "t",
    email: "t@t",
    timestamp: 0,
    parents,
    refs: [],
  };
}

describe("createAncestryResolver", () => {
  it("keeps a visible parent as a direct, non-elided link", () => {
    const all = [c("A", ["B"]), c("B", [])];
    const r = createAncestryResolver(all, all);
    expect(r.resolve("A")).toEqual([{ oid: "B", elided: false }]);
  });

  it("rewrites a filtered-out parent onto the nearest visible ancestor", () => {
    // Full history A → B → C; only A and C survive the filter.
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"]), c("C", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([{ oid: "C", elided: true }]);
  });

  it("spans a long elided run", () => {
    // A → M0 → … → M11 → Z, with only A and Z visible (the 12-elided case
    // drawn in the issue).
    const mid = Array.from({ length: 12 }, (_, i) => `M${i}`);
    const all: CommitInfo[] = [
      c("A", ["M0"]),
      ...mid.map((m, i) => c(m, [i === mid.length - 1 ? "Z" : `M${i + 1}`])),
      c("Z", []),
    ];
    const visible = [c("A", ["M0"]), c("Z", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([{ oid: "Z", elided: true }]);
  });

  it("reports no link when no ancestor is visible (truncated)", () => {
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([]);
  });

  it("reports no link for a true root, and no true parents either", () => {
    const all = [c("R", [])];
    const r = createAncestryResolver(all, all);
    expect(r.resolve("R")).toEqual([]);
    expect(r.trueParents("R")).toEqual([]);
  });

  it("rewrites BOTH sides of a merge whose parents are filtered out", () => {
    // M merges T and F; T → TT, F → FF; only M, TT, FF visible.
    const all = [
      c("M", ["T", "F"]),
      c("T", ["TT"]),
      c("F", ["FF"]),
      c("TT", []),
      c("FF", []),
    ];
    const visible = [c("M", ["T", "F"]), c("TT", []), c("FF", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("M")).toEqual([
      { oid: "TT", elided: true },
      { oid: "FF", elided: true },
    ]);
  });

  it("dedupes when both parents rewrite to the same ancestor", () => {
    // M merges T and F, both children of one visible ancestor P.
    const all = [c("M", ["T", "F"]), c("T", ["P"]), c("F", ["P"]), c("P", [])];
    const visible = [c("M", ["T", "F"]), c("P", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("M")).toEqual([{ oid: "P", elided: true }]);
    // The commit is still a merge — node shape reads trueParents, not resolve.
    expect(r.trueParents("M")).toEqual(["T", "F"]);
  });

  it("prefers the nearer ancestor when two are reachable", () => {
    // A → B → V2 → V1, V1 and V2 both visible. B is filtered out.
    const all = [c("A", ["B"]), c("B", ["V2"]), c("V2", ["V1"]), c("V1", [])];
    const visible = [c("A", ["B"]), c("V2", ["V1"]), c("V1", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([{ oid: "V2", elided: true }]);
  });

  it("falls back to the visible commits' own parents when ancestry is omitted", () => {
    const visible = [c("A", ["B"]), c("B", [])];
    const r = createAncestryResolver(visible);
    expect(r.resolve("A")).toEqual([{ oid: "B", elided: false }]);
    expect(r.trueParents("A")).toEqual(["B"]);
  });

  it("treats an oid outside the loaded window as a dead end", () => {
    // A's parent B is not in the window at all — no entry in the map.
    const visible = [c("A", ["B"])];
    const r = createAncestryResolver(visible, visible);
    expect(r.resolve("A")).toEqual([]);
  });

  it("terminates on a cyclic map instead of hanging", () => {
    // Malformed input: X and Y each claim the other as parent. Real git has no
    // cycles, but the resolver must not spin on bad data.
    const all = [c("A", ["X"]), c("X", ["Y"]), c("Y", ["X"])];
    const visible = [c("A", ["X"])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toEqual([]);
  });

  it("returns a stable memoized result for repeated queries", () => {
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"]), c("C", [])];
    const r = createAncestryResolver(visible, all);
    expect(r.resolve("A")).toBe(r.resolve("A"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/graphAncestry.test.ts
```

Expected: FAIL — `Failed to resolve import "./graphAncestry"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/commits/graphAncestry.ts`:

```ts
import type { CommitInfo } from "@/lib/types";

/**
 * Parent rewriting for the commit graph — the "same-branch search hits must
 * share one lane" fix (issue #68 G2).
 *
 * layoutGraph lays out the POST-filter list, and it keeps a lane alive until it
 * sees the oid that lane awaits. `CommitInfo.parents` holds the TRUE parent
 * oids, which a filter has usually removed, so the awaited oid never arrives:
 * the lane is drawn straight down through every remaining row to the bottom of
 * the log — an edge to a commit that will never appear — while the two commits
 * that genuinely ARE on the same branch get no visual link at all.
 *
 * This module maps each true parent onto the nearest ancestor that survived,
 * flagging the link as elided when it skipped anything. Callers draw elided
 * links dashed, and terminate the lane when nothing resolves.
 *
 * Deliberately frontend-only. Only text/author/path/date/sha filtering happens
 * in the backend; `mine`, `branch`, and `hideMerges` are client-side
 * refinements over `baseCommits`, so a backend rewrite would leave all three
 * still emitting phantom lanes. The ancestry needed is already on the client —
 * useRepoStore holds the unfiltered `commits` next to `searchResults`. See the
 * spec's "Corrections to #68".
 */

export interface ResolvedParent {
  /** Oid of the nearest ancestor present in the laid-out list. */
  oid: string;
  /** True when reaching it skipped at least one commit. */
  elided: boolean;
}

export interface AncestryResolver {
  /**
   * Parent links for `oid`, rewritten onto the visible set and deduped.
   *
   * An empty result means no parent resolves. The caller distinguishes the two
   * reasons via `trueParents`: none at all is a real root; some, but none
   * reachable, is a truncated link whose lane must end.
   */
  resolve(oid: string): ResolvedParent[];
  /** True parent oids as loaded. Node shape (solid/merge) reads these. */
  trueParents(oid: string): string[];
}

export function createAncestryResolver(
  visibleCommits: readonly CommitInfo[],
  ancestry?: readonly CommitInfo[],
): AncestryResolver {
  const visible = new Set(visibleCommits.map((c) => c.oid));

  const parentsOf = new Map<string, string[]>();
  for (const c of ancestry ?? []) parentsOf.set(c.oid, c.parents);
  // The laid-out commits always contribute their own parents, so a hit that
  // reached deeper than the unfiltered window is still classified correctly.
  for (const c of visibleCommits) parentsOf.set(c.oid, c.parents);

  // Keyed by the queried oid. This is the load-bearing memo: a wide filter
  // leaves many visible commits pointing at the SAME filtered-out parent, and
  // without it each repeats the same walk. A single walk cannot blanket-memoize
  // the nodes it visits — an intermediate node's own nearest visible ancestor
  // need not be the one the outer query found.
  const nearestMemo = new Map<string, ResolvedParent | null>();
  const resolveMemo = new Map<string, ResolvedParent[]>();

  function nearestVisible(start: string): ResolvedParent | null {
    const cached = nearestMemo.get(start);
    if (cached !== undefined) return cached;

    if (visible.has(start)) {
      const direct: ResolvedParent = { oid: start, elided: false };
      nearestMemo.set(start, direct);
      return direct;
    }

    // Breadth-first over ancestors, so the nearest one wins. Parents are
    // enqueued in order, which at equal depth reaches the first-parent mainline
    // before a side branch. `seen` guards against malformed cyclic input.
    const queue: string[] = [start];
    const seen = new Set<string>([start]);
    let found: ResolvedParent | null = null;

    search: while (queue.length > 0) {
      const cur = queue.shift()!;
      const parents = parentsOf.get(cur);
      if (!parents) continue; // outside the loaded window — dead end
      for (const p of parents) {
        if (visible.has(p)) {
          found = { oid: p, elided: true };
          break search;
        }
        if (!seen.has(p)) {
          seen.add(p);
          queue.push(p);
        }
      }
    }

    nearestMemo.set(start, found);
    return found;
  }

  return {
    resolve(oid) {
      const cached = resolveMemo.get(oid);
      if (cached) return cached;

      const out: ResolvedParent[] = [];
      const targets = new Set<string>();
      for (const p of parentsOf.get(oid) ?? []) {
        const hit = nearestVisible(p);
        // Two true parents can rewrite onto one visible ancestor — collapse to
        // a single link. The node stays a merge; that reads trueParents.
        if (!hit || targets.has(hit.oid)) continue;
        targets.add(hit.oid);
        out.push(hit);
      }

      resolveMemo.set(oid, out);
      return out;
    },

    trueParents(oid) {
      return parentsOf.get(oid) ?? [];
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm test src/features/commits/graphAncestry.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Type-check and commit**

```bash
pnpm tsc --noEmit
git add src/features/commits/graphAncestry.ts src/features/commits/graphAncestry.test.ts
git commit -m "feat(graph): rewrite parents onto the nearest visible ancestor

Why: layoutGraph lays out the post-filter list but keeps a lane alive until it
sees the true parent oid, which the filter removed — so each search hit trailed
a lane to the bottom of the log while two hits on one branch got no link at
all. Frontend-only on purpose: mine/branch/hideMerges filter client-side, so a
backend rewrite would miss them, and the unfiltered window is already loaded.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `layoutGraph` returns `{ rows, maxCol }`

**Files:**
- Modify: `src/features/commits/graphLayout.ts`
- Modify: `src/features/commits/graphLayout.test.ts`

**Interfaces:**
- Consumes: Task 1's `laneX` is not needed here (layout emits columns, not pixels).
- Produces:
  - `interface LayoutOptions { ancestry?: readonly CommitInfo[]; headOid?: string }`
  - `interface GraphLayout { rows: GraphRow[]; maxCol: number }`
  - `layoutGraph(commits: readonly CommitInfo[], opts?: LayoutOptions): GraphLayout`

  `headOid` is declared now but **unused until Phase 3** (G6/G7) — it is in the options type so the signature does not churn again. Task 7 does not pass it.

This task is deliberately mechanical and separate from Task 4: it is a breaking signature change touching all five existing tests, and a reviewer should be able to accept it without also reasoning about elision.

- [ ] **Step 1: Write the failing test**

Add to `src/features/commits/graphLayout.test.ts`, inside the existing `describe("layoutGraph")`:

```ts
  it("reports maxCol 0 for a single-lane linear history", () => {
    const { rows, maxCol } = layoutGraph([c("A", ["B"]), c("B", ["C"]), c("C", [])]);
    expect(rows).toHaveLength(3);
    expect(maxCol).toBe(0);
  });

  it("reports maxCol across every lane and node in the layout", () => {
    // M forks a second lane out to col 1.
    const { maxCol } = layoutGraph([
      c("M", ["T", "F"]),
      c("F", ["R"]),
      c("T", ["R"]),
      c("R", ["I"]),
      c("I", []),
    ]);
    expect(maxCol).toBe(1);
  });

  // THE G1 INPUT. The old gutter was a fixed 140px, which fits columns 0-7.
  // A 10-way octopus needs col 9, and the caller can only size for it if the
  // layout reports it.
  it("reports a lane count past the old fixed-width gutter", () => {
    const parents = Array.from({ length: 10 }, (_, i) => `P${i}`);
    const { maxCol } = layoutGraph([
      c("O", parents),
      ...parents.map((p) => c(p, ["G"])),
      c("G", []),
    ]);
    expect(maxCol).toBe(9);
    expect(maxCol).toBeGreaterThan(7);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/graphLayout.test.ts
```

Expected: FAIL — the three new tests destructure `.rows`/`.maxCol` from an array, so `rows` is `undefined` and `maxCol` is `undefined`.

- [ ] **Step 3: Change the return type**

In `src/features/commits/graphLayout.ts`, add the two interfaces above `layoutGraph` and change its signature and tail:

```ts
export interface LayoutOptions {
  /**
   * Ancestry pool for parent rewriting — every commit the store knows for this
   * log scope (`commits ∪ searchResults`). Omitted → the laid-out list is its
   * own ancestry, which is the unfiltered case.
   */
  ancestry?: readonly CommitInfo[];
  /**
   * HEAD's oid. Reserved for the primary-lane emphasis and HEAD marker in
   * Phase 3 (#68 G6/G7); declared now so this signature does not churn again.
   */
  headOid?: string;
}

export interface GraphLayout {
  rows: GraphRow[];
  /**
   * Highest lane or node column used by any row. 0 for a single-lane log.
   * Callers size the gutter from this — a fixed width silently clipped
   * everything past column 8 (#68 G1).
   */
  maxCol: number;
}

export function layoutGraph(
  commits: readonly CommitInfo[],
  opts?: LayoutOptions,
): GraphLayout {
```

Track the maximum as rows are built. Immediately before the existing `rows.push({ lanes, node })`, add:

```ts
    for (const ln of lanes) {
      if (ln.col > maxCol) maxCol = ln.col;
      if (ln.to !== undefined && ln.to > maxCol) maxCol = ln.to;
    }
    if (node.col > maxCol) maxCol = node.col;
```

Declare `let maxCol = 0;` next to `let laneBirthCounter = 0;`, and change the final `return rows;` to:

```ts
  return { rows, maxCol };
```

- [ ] **Step 4: Update the five existing tests to destructure**

Each existing test calls `const rows = layoutGraph([...])`. Change each to:

```ts
const { rows } = layoutGraph([...]);
```

There are five: `"linear history: single lane, straight line"`, `"merge: feature branch rejoins main"`, `"octopus merge: three parents each open their own lane"`, `"slot reuse: freed column is reused by a later branch tip"`, `"branch point: multiple children of same commit collapse into one lane"`. No assertions inside them change.

- [ ] **Step 5: Update the one production call site**

`src/screens/History.tsx:169` currently reads:

```ts
const rows = React.useMemo(() => layoutGraph(visible), [visible]);
```

Change to:

```ts
const { rows } = React.useMemo(() => layoutGraph(visible), [visible]);
```

Task 7 replaces this line properly; this keeps the tree compiling in between.

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm test src/features/commits/graphLayout.test.ts
pnpm tsc --noEmit
```

Expected: PASS, 8 tests. Type-check clean.

- [ ] **Step 7: Commit**

```bash
git add src/features/commits/graphLayout.ts src/features/commits/graphLayout.test.ts src/screens/History.tsx
git commit -m "refactor(graph): layoutGraph returns rows plus the max lane column

Why: the gutter width has to come from the actual lane count, and only the
layout knows it. Also declares LayoutOptions.headOid now, unused until the
Phase 3 primary-lane work, so this signature changes once rather than twice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `layoutGraph` consumes the resolver — dashed links and truncated lanes

**Files:**
- Modify: `src/features/commits/graphLayout.ts`
- Modify: `src/features/commits/graphLayout.test.ts`
- Modify: `src/design/git-components.tsx` (type additions only)

**Interfaces:**
- Consumes: `createAncestryResolver`, `ResolvedParent` (Task 2); `GraphLayout`, `LayoutOptions` (Task 3).
- Produces: `GraphLane.dashed?: boolean` and `GraphNode.truncated?: boolean` populated by the layout. Task 5 renders them.

**Design notes the implementer needs:**

`dashed` is a property of the *link*, and a lane spans many rows, so it lives on the active-lane record and is inherited by every row the lane crosses. It resets per link: when a lane reaches its rewritten parent, that commit's own resolution decides the next segment. This is why `dashed` is a flag on the existing kinds rather than a new kind — an elided link must render as a straight run, a half-lane, **and** a curve depending on the row.

Node shape reads **true** parents; lane bookkeeping reads **resolved** parents. A merge whose two parents rewrite onto one ancestor emits a single deduped link but is still a merge.

- [ ] **Step 1: Write the failing test**

Add to `src/features/commits/graphLayout.test.ts`:

```ts
  // THE REPORTED BUG (#68 G2). Two search hits on one branch must stay in the
  // same lane, joined by a dashed segment — not split into unrelated lanes,
  // and not trailing a phantom lane to the bottom of the log.
  it("keeps two same-branch hits in ONE dashed lane", () => {
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", ["D"]), c("D", [])];
    const visible = [c("A", ["B"]), c("D", [])];
    const { rows, maxCol } = layoutGraph(visible, { ancestry: all });

    // One lane, not two.
    expect(maxCol).toBe(0);
    expect(rows[0]!.node.col).toBe(0);
    expect(rows[1]!.node.col).toBe(0);

    // A's outgoing segment is dashed — history elided here.
    const aBot = rows[0]!.lanes.find((l) => l.kind === "half-bot");
    expect(aBot).toBeDefined();
    expect(aBot!.dashed).toBe(true);

    // D receives that dashed segment and, being a root, ends the lane.
    const dTop = rows[1]!.lanes.find((l) => l.kind === "half-top");
    expect(dTop!.dashed).toBe(true);
    expect(rows[1]!.lanes.some((l) => l.kind === "half-bot")).toBe(false);
    expect(rows[1]!.node.truncated).toBeFalsy();
  });

  it("marks a pass-through row of an elided lane dashed too", () => {
    // Visible: A, X, D. A's parent chain to D is elided; X is an unrelated
    // root on its own lane, so A's dashed lane passes THROUGH X's row.
    const all = [
      c("A", ["B"]),
      c("B", ["D"]),
      c("X", []),
      c("D", []),
    ];
    const visible = [c("A", ["B"]), c("X", []), c("D", [])];
    const { rows } = layoutGraph(visible, { ancestry: all });

    const passThrough = rows[1]!.lanes.find((l) => l.kind === "line");
    expect(passThrough).toBeDefined();
    expect(passThrough!.dashed).toBe(true);
  });

  // THE PHANTOM LANE. A hit whose ancestors are all gone must END, freeing the
  // column, instead of drawing an edge to a commit that never appears.
  it("ends a lane whose parent resolves to nothing, and frees the slot", () => {
    const all = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const visible = [c("A", ["B"]), c("Z", [])];
    const { rows, maxCol } = layoutGraph(visible, { ancestry: all });

    // A has a true parent but no visible ancestor → truncated, lane ends.
    expect(rows[0]!.node.truncated).toBe(true);
    expect(rows[0]!.lanes.some((l) => l.kind === "half-bot")).toBe(false);

    // The freed column is reused by the next unrelated commit.
    expect(rows[1]!.node.col).toBe(0);
    expect(maxCol).toBe(0);
  });

  it("distinguishes a true root from a truncated link", () => {
    const { rows } = layoutGraph([c("R", [])]);
    expect(rows[0]!.node.truncated).toBeFalsy();
    expect(rows[0]!.node.solid).toBe(true);
  });

  it("keeps node.merge true when both parents rewrite to one ancestor", () => {
    const all = [c("M", ["T", "F"]), c("T", ["P"]), c("F", ["P"]), c("P", [])];
    const visible = [c("M", ["T", "F"]), c("P", [])];
    const { rows, maxCol } = layoutGraph(visible, { ancestry: all });

    // Still a merge commit...
    expect(rows[0]!.node.merge).toBe(true);
    expect(rows[0]!.node.solid).toBe(false);
    // ...but the deduped link opens no second lane.
    expect(maxCol).toBe(0);
    expect(rows[0]!.lanes.some((l) => l.kind === "fork-bot")).toBe(false);
  });

  it("rewrites both sides of a merge onto their nearest visible ancestors", () => {
    const all = [
      c("M", ["T", "F"]),
      c("T", ["TT"]),
      c("F", ["FF"]),
      c("TT", []),
      c("FF", []),
    ];
    const visible = [c("M", ["T", "F"]), c("TT", []), c("FF", [])];
    const { rows } = layoutGraph(visible, { ancestry: all });

    const forks = rows[0]!.lanes.filter((l) => l.kind === "fork-bot");
    expect(forks).toHaveLength(1);
    expect(forks[0]!.dashed).toBe(true);
  });

  it("lays out identically to before when ancestry is omitted", () => {
    const commits = [c("A", ["B"]), c("B", ["C"]), c("C", [])];
    const withOpts = layoutGraph(commits, {});
    const without = layoutGraph(commits);
    expect(withOpts).toEqual(without);
    expect(without.rows.every((r) => r.lanes.every((l) => !l.dashed))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/commits/graphLayout.test.ts
```

Expected: FAIL — `dashed` and `truncated` are undefined; the phantom-lane test still shows a `half-bot` on row 0.

- [ ] **Step 3: Add the two type fields**

In `src/design/git-components.tsx`:

```ts
export interface GraphLane {
  col: number;
  color: string;
  kind: "line" | "half-top" | "half-bot" | "fork-bot" | "merge-top";
  to?: number;
  /**
   * The link this lane segment belongs to skipped at least one commit — a
   * filter or the log window removed the commits in between. Rendered dashed.
   * A flag rather than a lane kind because an elided link must render as a
   * straight run, a half-lane, AND a curve depending on the row.
   */
  dashed?: boolean;
}

export interface GraphNode {
  col: number;
  color: string;
  solid?: boolean;
  merge?: boolean;
  /**
   * The commit has parents, but none of them resolve to anything in the loaded
   * window — so the lane ends here with a stub rather than running to the
   * bottom of the log. Distinct from a true root, which has no parents at all.
   */
  truncated?: boolean;
}
```

Note the `"diag"` member is dropped from the union here; Task 5 removes its renderer branch. If `pnpm tsc --noEmit` complains about the unreachable renderer branch before Task 5, do Task 5's Step 3 now and commit them together.

- [ ] **Step 4: Wire the resolver into the layout**

In `src/features/commits/graphLayout.ts`:

Import the resolver:

```ts
import { createAncestryResolver } from "./graphAncestry";
```

Extend `ActiveLane` — `dashed` is carried so every row the lane crosses inherits it:

```ts
interface ActiveLane {
  awaitingOid: string;
  color: string;
  /** The link this lane is currently traversing skipped commits. */
  dashed: boolean;
}
```

Build the resolver once, at the top of `layoutGraph`:

```ts
  const ancestry = createAncestryResolver(commits, opts?.ancestry);
```

Inside the per-commit loop, replace every read of `commit.parents` with resolved / true parents:

```ts
    const resolved = ancestry.resolve(commit.oid);
    const trueParents = ancestry.trueParents(commit.oid);
```

The snapshot must carry `dashed` so `half-top`, `merge-top`, and pass-through `line` can read it:

```ts
    const lanesAtTop: Array<{ col: number; color: string; dashed: boolean } | null> =
      active.map((a, i) => (a ? { col: i, color: a.color, dashed: a.dashed } : null));
```

First-parent continuation now uses the resolved link, and its `elided` becomes the lane's `dashed`:

```ts
    if (resolved.length >= 1) {
      active[nodeCol] = {
        awaitingOid: resolved[0]!.oid,
        color: nodeColor,
        dashed: resolved[0]!.elided,
      };
    } else {
      // No resolvable parent: a true root, or a truncated link. Either way the
      // lane ends here — which is what kills the phantom lanes.
      active[nodeCol] = null;
    }
```

Additional parents iterate `resolved` rather than `commit.parents`, and each fork carries that link's `elided`:

```ts
    const forkTargets: Array<{ toCol: number; color: string; dashed: boolean }> = [];
    for (let p = 1; p < resolved.length; p++) {
      const link = resolved[p]!;
      const existing = active.findIndex((a) => a?.awaitingOid === link.oid);
      if (existing !== -1) {
        forkTargets.push({
          toCol: existing,
          color: active[existing]!.color,
          dashed: link.elided,
        });
      } else {
        const slot = allocSlot();
        const color = nextColor();
        active[slot] = { awaitingOid: link.oid, color, dashed: link.elided };
        forkTargets.push({ toCol: slot, color, dashed: link.elided });
      }
    }
```

Every emission site gains `dashed`:

```ts
      if (col === nodeCol) {
        if (top) lanes.push({ col, color: top.color, kind: "half-top", dashed: top.dashed });
        if (bot) lanes.push({ col, color: bot.color, kind: "half-bot", dashed: bot.dashed });
        continue;
      }

      if (collapsingCols.includes(col) && top) {
        lanes.push({ col, color: top.color, kind: "merge-top", to: nodeCol, dashed: top.dashed });
        continue;
      }

      if (top && bot) {
        lanes.push({ col, color: top.color, kind: "line", dashed: top.dashed });
        continue;
      }
```

```ts
    for (const f of forkTargets) {
      if (f.toCol === nodeCol) continue;
      lanes.push({ col: nodeCol, color: f.color, kind: "fork-bot", to: f.toCol, dashed: f.dashed });
    }
```

Node classification reads **true** parents, plus the new `truncated`:

```ts
    const isRoot = trueParents.length === 0;
    const node: GraphNode = {
      col: nodeCol,
      color: nodeColor,
      solid: trueParents.length <= 1,
      merge: trueParents.length >= 2,
      truncated: !isRoot && resolved.length === 0,
    };
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm test src/features/commits/graphLayout.test.ts src/features/commits/graphAncestry.test.ts
pnpm tsc --noEmit
```

Expected: PASS, 15 layout tests + 12 resolver tests. If `"lays out identically to before when ancestry is omitted"` fails on `dashed: false` vs `undefined`, that is real: emit `dashed` unconditionally as a boolean, and the assertion `!l.dashed` still holds.

- [ ] **Step 6: Commit**

```bash
git add src/features/commits/graphLayout.ts src/features/commits/graphLayout.test.ts src/design/git-components.tsx
git commit -m "fix(graph): one dashed lane for same-branch hits, end truncated lanes

Two search hits on one branch now stay in the same lane, joined by a dashed
segment, and a hit with no visible ancestor ends its lane instead of drawing an
edge to a commit that never appears.

Why: dashed rides on the active-lane record rather than being a new lane kind,
because an elided link has to render as a straight run, a half-lane, and a
curve depending on the row. Node shape still reads TRUE parents, so a merge
whose parents both rewrite onto one ancestor stays a merge while emitting a
single deduped link.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Render dashed lanes and truncated stubs; delete the `diag` kind

**Files:**
- Modify: `src/design/git-components.tsx:892-1007` (`PGGraphRow`)
- Create: `src/design/git-components.graph.test.tsx`

**Interfaces:**
- Consumes: `GraphLane.dashed`, `GraphNode.truncated` (Task 4); `laneX` (Task 1).
- Produces: a `PGGraphRow` that renders `strokeDasharray` for dashed lanes and a stub for truncated nodes, and no longer has a `diag` branch.

- [ ] **Step 1: Write the failing test**

Create `src/design/git-components.graph.test.tsx`:

```tsx
// PGGraphRow rendering. Every assertion here maps to a bug in issue #68: the
// gutter clipped lanes past column 8 (G1), and an elided link had no dashed
// treatment while a stuck lane had no terminator (G2).
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PGGraphRow, type GraphLane, type GraphNode } from "./git-components";
import { graphWidth, laneX } from "./graph-geometry";

function renderGraph(lanes: GraphLane[], node?: GraphNode, maxCol = 0) {
  const { container } = render(
    <PGGraphRow lanes={lanes} node={node} width={graphWidth(maxCol)} height={26} />,
  );
  return container.querySelector("svg")!;
}

describe("PGGraphRow", () => {
  it("draws a plain lane with no dash pattern", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    const line = svg.querySelector("line")!;
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("dashes an elided lane segment", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line", dashed: true }]);
    expect(svg.querySelector("line")!.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("dashes an elided half-lane and an elided curve alike", () => {
    // The reason `dashed` is a flag and not a lane kind: one elided link
    // renders as a straight run, a half-lane, and a curve depending on the row.
    const svg = renderGraph([
      { col: 0, color: "red", kind: "half-bot", dashed: true },
      { col: 0, color: "red", kind: "fork-bot", to: 1, dashed: true },
    ], undefined, 1);
    const dashed = [...svg.querySelectorAll("[stroke-dasharray]")];
    expect(dashed).toHaveLength(2);
  });

  // THE G1 REGRESSION. A col-9 lane used to be drawn outside a fixed 140px
  // viewport and vanish, node dot included, with no overflow and no warning.
  it("keeps a column-9 lane and its dot inside the viewport", () => {
    const svg = renderGraph(
      [{ col: 9, color: "red", kind: "line" }],
      { col: 9, color: "red", solid: true },
      9,
    );
    const width = Number(svg.getAttribute("width"));
    expect(width).toBe(graphWidth(9));
    expect(width).toBeGreaterThan(140);

    expect(Number(svg.querySelector("line")!.getAttribute("x1"))).toBe(laneX(9));
    const dot = svg.querySelector("circle")!;
    expect(Number(dot.getAttribute("cx")) + 4).toBeLessThanOrEqual(width);
  });

  it("puts the node dot on the same x as its lane", () => {
    const svg = renderGraph(
      [{ col: 3, color: "red", kind: "line" }],
      { col: 3, color: "red" },
      3,
    );
    expect(svg.querySelector("circle")!.getAttribute("cx")).toBe(
      svg.querySelector("line")!.getAttribute("x1"),
    );
  });

  it("draws a dashed stub under a truncated node", () => {
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "half-top" }],
      { col: 0, color: "red", truncated: true },
    );
    const stub = svg.querySelector('[data-graph-stub="true"]');
    expect(stub).not.toBeNull();
    expect(stub!.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("draws no stub for an ordinary node", () => {
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "half-top" }],
      { col: 0, color: "red" },
    );
    expect(svg.querySelector('[data-graph-stub="true"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/git-components.graph.test.tsx
```

Expected: FAIL — no `stroke-dasharray` anywhere, no stub element, and (before Task 6) `width` is not required so the col-9 test measures 140.

- [ ] **Step 3: Implement in `PGGraphRow`**

Replace the four remaining literal `12 + ln.col * 16` / `12 + node.col * 16` expressions with `laneX(...)`, importing from the new module:

```ts
import { laneX } from "./graph-geometry";
```

Add a shared dash constant near the top of the component file:

```ts
/** Dash pattern for an elided link — visibly broken at a 1.5px stroke. */
const ELIDED_DASH = "3 3";
```

Give every lane branch the pattern. Straight kinds (`line`, `half-top`, `half-bot`) and curve kinds (`fork-bot`, `merge-top`) all take:

```tsx
strokeDasharray={ln.dashed ? ELIDED_DASH : undefined}
```

React omits the attribute entirely for `undefined`, which is what the "plain lane" test asserts.

Also give every lane element its kind as a data attribute, on the same line:

```tsx
data-lane-kind={ln.kind}
```

Task 9's e2e assertion needs to distinguish "a lane continues below this row"
(`half-bot`, `line`) from a terminated one, and there is no other way to select a
lane by role from outside. Adding it here keeps the design-system change in the
design-system task.

**Delete the `diag` branch** (the `if (ln.kind === "diag") { … }` block). `layoutGraph` has never emitted it, so it was unreachable rendering that read as a supported edge type. Task 4 already removed `"diag"` from the union.

After the existing node `<circle>` elements, add the truncated stub:

```tsx
{node?.truncated && (
  <line
    data-graph-stub="true"
    x1={laneX(node.col)}
    x2={laneX(node.col)}
    y1={height / 2 + 6}
    y2={height / 2 + 11}
    stroke={node.color}
    strokeWidth="1.5"
    strokeDasharray="2 2"
  />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test src/design/git-components.graph.test.tsx
pnpm tsc --noEmit
```

Expected: the six non-width tests PASS. The col-9 test still FAILS on width until Task 6 makes `width` required and callers pass it — that is the intended order; leave it failing and note it in the commit.

If you prefer a green commit here, do Task 6 Step 3 now and commit Tasks 5 and 6 together.

- [ ] **Step 5: Commit**

```bash
git add src/design/git-components.tsx src/design/git-components.graph.test.tsx
git commit -m "feat(graph): dash elided lanes, stub truncated nodes, drop dead diag kind

Why: strokeDasharray goes on every lane kind rather than a new one, since a
single elided link renders as a straight run, a half-lane, and a curve
depending on the row. The diag branch had no producer in layoutGraph and read
as a supported edge type, so the next person extending the layout would inherit
whatever its curve did with \`to\`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Size the gutter from the lane count

**Files:**
- Modify: `src/design/git-components.tsx` (`PGGraphRow` props, `PGCommitRow` props and grid)
- Modify: `src/design/git-components.density.test.tsx`

**Interfaces:**
- Consumes: `graphWidth`, `commitRowGrid`, `isGraphClamped` (Task 1).
- Produces:
  - `PGGraphRow` props: `width: number` (**required**), `clamped?: boolean`.
  - `PGCommitRow` props: `graphW: number` (**required**).

  Task 7 (History) and Task 8 (Reflog) are the two call sites.

- [ ] **Step 1: Write the failing test**

Add to `src/design/git-components.graph.test.tsx`. **Merge these into the file's
existing import statements** rather than adding duplicate `from "./git-components"`
/ `from "./graph-geometry"` lines — add `PGCommitRow` to the first and
`commitRowGrid, isGraphClamped, GRAPH_MAX_W` to the second. The new `describe`
block reuses `renderGraph` from Task 5.

```tsx
describe("PGCommitRow graph column", () => {
  function renderRow(graphW: number) {
    const { container } = render(
      <PGCommitRow
        graphW={graphW}
        lanes={[{ col: 0, color: "red", kind: "line" }]}
        node={{ col: 0, color: "red" }}
        sha="abc1234"
        message="feat: something"
        author="Tester"
        date="2026-08-11"
      />,
    );
    const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
    return { row, svg: container.querySelector("svg") };
  }

  it("sizes the grid's first column from graphW", () => {
    const { row } = renderRow(152);
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(152));
    expect(row.style.gridTemplateColumns.startsWith("152px")).toBe(true);
  });

  it("drops the graph column entirely for graphW 0", () => {
    const { row, svg } = renderRow(0);
    expect(row.style.gridTemplateColumns).toBe(commitRowGrid(0));
    expect(svg).toBeNull();
  });

  it("stops widening past the clamp", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }], undefined, 20);
    expect(isGraphClamped(20)).toBe(true);
    expect(Number(svg.getAttribute("width"))).toBe(GRAPH_MAX_W);
  });

  it("fades the right edge when lanes are clamped away, and not otherwise", () => {
    const { container: faded } = render(
      <PGGraphRow
        lanes={[{ col: 0, color: "red", kind: "line" }]}
        width={GRAPH_MAX_W}
        height={26}
        clamped
      />,
    );
    expect(faded.querySelector('[data-graph-clamped="true"]')).not.toBeNull();

    const { container: plain } = render(
      <PGGraphRow
        lanes={[{ col: 0, color: "red", kind: "line" }]}
        width={graphWidth(0)}
        height={26}
      />,
    );
    expect(plain.querySelector('[data-graph-clamped="true"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/git-components.graph.test.tsx
```

Expected: FAIL — `graphW` is not a prop, so the grid stays the hardcoded `140px …` and the SVG renders for `graphW: 0`.

- [ ] **Step 3: Make width required and add the clamp affordance**

In `PGGraphRow`, drop the `width = 140` default so it is required, mirroring what #71 did for `height` — a default is exactly what let this bug hide:

```tsx
/**
 * `width` and `height` are both REQUIRED.
 *
 * `height` must be the caller's actual row pitch: lane geometry is in SVG user
 * units (`y2={height}`, control points at `height / 2`), so it cannot read
 * `--row-step`. `width` must come from `graphWidth(maxCol)`: a default is what
 * let lanes past column 8 fall outside the viewport and vanish (#68 G1).
 */
export function PGGraphRow({
  lanes = [],
  node,
  width,
  height,
  clamped,
}: {
  lanes?: GraphLane[];
  node?: GraphNode;
  width: number;
  height: number;
  /** Lane count exceeds what the clamped width can show — fade the right edge. */
  clamped?: boolean;
}) {
```

Add the fade as the last child inside the `<svg>`, so it paints over any lane reaching the edge:

```tsx
{clamped && (
  <>
    <defs>
      <linearGradient id="pg-graph-clip-fade" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stopColor="var(--bg-0)" stopOpacity="0" />
        <stop offset="100%" stopColor="var(--bg-0)" stopOpacity="1" />
      </linearGradient>
    </defs>
    <rect
      data-graph-clamped="true"
      x={width - 16}
      y={0}
      width={16}
      height={height}
      fill="url(#pg-graph-clip-fade)"
    />
  </>
)}
```

In `PGCommitRow`, add the required prop and use the shared grid:

```tsx
  /**
   * Width of the graph gutter in px, from `graphWidth(maxCol)`. 0 drops the
   * column entirely — Reflog renders no lanes.
   */
  graphW: number;
```

```tsx
  gridTemplateColumns: commitRowGrid(graphW),
```

and make the gutter conditional:

```tsx
{graphW > 0 && (
  <PGGraphRow lanes={lanes} node={node} width={graphW} height={h} clamped={clamped} />
)}
```

Thread `clamped?: boolean` through `PGCommitRowProps` as well, forwarding to `PGGraphRow`. Row components need explicit prop threading — they do not spread `...rest`.

- [ ] **Step 4: Fix the existing density tests**

`src/design/git-components.density.test.tsx` renders `PGCommitRow` four times with no `graphW`, which is now a type error. Add `graphW={graphWidth(0)}` to the `renderCommitRow` helper and to the standalone `rowHeight={40}` render, importing `graphWidth` from `./graph-geometry`. Its assertions are about height and must not change.

- [ ] **Step 5: Run the full frontend suite**

```bash
pnpm test src/design src/features/commits
pnpm tsc --noEmit
```

Expected: PASS, including the previously-failing col-9 width test from Task 5. Type-check will still flag `History.tsx` and `Reflog.tsx` for the missing `graphW` — Tasks 7 and 8 fix those; do not add a default to silence it.

- [ ] **Step 6: Commit**

```bash
git add src/design/git-components.tsx src/design/git-components.graph.test.tsx src/design/git-components.density.test.tsx
git commit -m "fix(graph): size the gutter from the lane count instead of a fixed 140px

PGGraphRow.width and PGCommitRow.graphW are required, both derived from
graphWidth(maxCol), and the row grid comes from the shared commitRowGrid so the
row and History's header cannot drift.

Why: no default. A width default is precisely what let lanes past column 8 fall
outside the SVG viewport and disappear silently, dot included.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire History — ancestry union, gutter width, clamp affordance

**Files:**
- Modify: `src/screens/History.tsx:169,397-417,435-455`
- Create: `src/screens/History.graph.test.tsx`

**Interfaces:**
- Consumes: `layoutGraph` + `LayoutOptions` (Tasks 3-4), `graphWidth` / `isGraphClamped` / `commitRowGrid` / `maxVisibleCol` (Task 1), `PGCommitRow.graphW` + `clamped` (Task 6).
- Produces: nothing downstream.

**The key line.** `ancestry` is the union of the unfiltered window and the search results, not just `commits`. Search hits carry their own true `parents` and can reach deeper than `commits[499]`, so the union resolves strictly more links than either alone.

- [ ] **Step 1: Write the failing test**

Create `src/screens/History.graph.test.tsx`. The store priming below is copied from `src/screens/History.diff.test.tsx:47-72` — History reads enough of the store that a partial `setState` renders an empty screen, and the nav/keymap/focus stores must be reset too or state leaks between files. The `as never` cast is that file's existing convention for a partial store shape.

```tsx
// History's graph column must size itself to the lanes actually present, and it
// must feed layoutGraph the unfiltered window as ancestry so two search hits on
// one branch resolve to a single dashed lane (#68 G1/G2).
import { describe, expect, it, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { HistoryScreen } from "./History";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useKeymapStore, useFocusStore } from "@/features/keymap";
import { graphWidth } from "@/design/graph-geometry";
import type { CommitInfo } from "@/lib/types";

/** 40-char oids: History renders shortOid, and selection keys off the full oid. */
const oid = (label: string) => label.repeat(40).slice(0, 40);

const mk = (label: string, parents: string[] = []): CommitInfo => ({
  oid: oid(label),
  shortOid: oid(label).slice(0, 7),
  summary: `subject ${label}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents,
  refs: [],
});

// Linear: A → B → C.
const A = mk("a", [oid("b")]);
const B = mk("b", [oid("c")]);
const C = mk("c");
const LINEAR = [A, B, C];

function primeStore(over: Partial<Record<string, unknown>> = {}) {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: LINEAR,
    searchResults: null,
    searching: false,
    searchCommits: async () => {},
    branches: [],
    status: [],
    loading: false,
    ...over,
  } as never);
  useNavStore.setState({ intent: null });
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
}

const rows = (c: HTMLElement) => c.querySelectorAll('[data-testid="commit-row"]');

beforeEach(() => primeStore());

describe("History graph column", () => {
  it("sizes the gutter to a single-lane log", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));
    const svg = container.querySelector('[data-testid="commit-row"] svg')!;
    expect(svg.getAttribute("width")).toBe(String(graphWidth(0)));
  });

  it("keeps the header grid in step with the row grid", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));
    const row = container.querySelector<HTMLElement>('[data-testid="commit-row"]')!;
    const header = container.querySelector<HTMLElement>('[data-testid="commit-header"]')!;
    expect(header.style.gridTemplateColumns).toBe(row.style.gridTemplateColumns);
  });

  // The UNION is the point: searchResults has no intervening commits by
  // construction, so without `commits` as ancestry these two hits cannot be
  // linked and each would trail its own phantom lane.
  it("feeds the unfiltered window as ancestry so search hits share one lane", async () => {
    primeStore({ searchResults: [A, C] });
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(2));

    // One lane: both rows keep the minimal single-lane gutter.
    for (const svg of container.querySelectorAll('[data-testid="commit-row"] svg')) {
      expect(svg.getAttribute("width")).toBe(String(graphWidth(0)));
    }
    // And the elided link is drawn dashed.
    expect(container.querySelector("[stroke-dasharray]")).not.toBeNull();
  });

  it("does not dash anything when nothing is elided", async () => {
    const { container } = render(<HistoryScreen />);
    await waitFor(() => expect(rows(container).length).toBe(3));
    expect(container.querySelector("[stroke-dasharray]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/screens/History.graph.test.tsx
```

Expected: FAIL — `graphW` is missing (type error), there is no `commit-header` test id, and no ancestry is passed.

- [ ] **Step 3: Build the ancestry union and consume `maxCol`**

Replace `src/screens/History.tsx:169`:

```ts
  // Ancestry pool for parent rewriting. The UNION matters: `searchResults` has
  // no intervening commits by construction, and `commits` may not reach as deep
  // as a narrow filter's oldest hit, so each supplies links the other lacks.
  const ancestry = React.useMemo(
    () => (searchResults ? [...commits, ...searchResults] : commits),
    [commits, searchResults],
  );

  const { rows, maxCol } = React.useMemo(
    () => layoutGraph(visible, { ancestry }),
    [visible, ancestry],
  );

  const graphW = graphWidth(maxCol);
  const graphClamped = isGraphClamped(maxCol);
  const hiddenLanes = graphClamped ? maxCol - maxVisibleCol() : 0;
```

Add the imports:

```ts
import {
  commitRowGrid,
  graphWidth,
  isGraphClamped,
  maxVisibleCol,
} from "@/design";
```

- [ ] **Step 4: Drive the header grid and label from the same numbers**

At `History.tsx:397-417`, replace the hardcoded grid and the `GRAPH` label:

```tsx
      <div
        data-testid="commit-header"
        style={{
          display: "grid",
          gridTemplateColumns: commitRowGrid(graphW),
          /* …the rest of the existing style block is unchanged… */
        }}
      >
        <span style={{ paddingLeft: 12 }}>
          {/* The count of lanes that did not fit belongs here, in text: the
              gutter is a decorative graphic, and Phase 3 (G8) marks it
              aria-hidden, so a fade alone would state this nowhere. */}
          {hiddenLanes > 0 ? `GRAPH +${hiddenLanes}` : "GRAPH"}
        </span>
        <span>SHA</span>
        <span>SUBJECT</span>
        <span>AUTHOR</span>
        <span>DATE</span>
      </div>
```

- [ ] **Step 5: Pass the width to every row**

At `History.tsx:441`, add the two props to `PGCommitRow`:

```tsx
            <PGCommitRow
              key={c.oid}
              graphW={graphW}
              clamped={graphClamped}
              lanes={g?.lanes}
              /* …existing props unchanged… */
            />
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm test src/screens/History.graph.test.tsx
pnpm test src/screens
pnpm tsc --noEmit
```

Expected: the new file PASSES. The other `History.*.test.tsx` files must still pass — if one asserts on the old grid string, update it to `commitRowGrid(graphWidth(0))` rather than a literal.

- [ ] **Step 7: Commit**

```bash
git add src/screens/History.tsx src/screens/History.graph.test.tsx
git commit -m "fix(history): size the graph gutter to real lanes, feed ancestry to layout

Why: ancestry is the UNION of the unfiltered window and the search results.
searchResults has no intervening commits by construction, and commits may not
reach as deep as a narrow filter's oldest hit, so each supplies links the other
lacks. The count of lanes past the clamp goes in the GRAPH column header rather
than the SVG, because the graphic is decorative.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Drop Reflog's empty graph column

**Files:**
- Modify: `src/screens/Reflog.tsx:238-246`

**Interfaces:**
- Consumes: `PGCommitRow.graphW` (Task 6).
- Produces: nothing downstream.

**Why this is in scope.** Reflog renders `PGCommitRow` with no `lanes` and no `node` — a 140px empty gutter used purely as spacing. Task 6 made `graphW` required, so the refactor forces a decision here; this plan takes the honest one rather than preserving a pointless empty column. This is a deliberate visual change to a screen outside #68's stated scope, recorded in the spec.

- [ ] **Step 1: Confirm the current behaviour before changing it**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit 2>&1 | grep -i reflog
```

Expected: an error saying `graphW` is missing from the `PGCommitRow` call at `Reflog.tsx:238`. This confirms Task 6 made the prop genuinely required rather than optional-with-default.

- [ ] **Step 2: Pass `graphW={0}`**

```tsx
            <PGCommitRow
              key={`${e.oid}-${e.timestamp}`}
              // Reflog has no lanes to draw — 0 drops the graph column
              // entirely, rather than reserving an empty gutter. Distinct from
              // graphWidth(0), which is a real one-lane log.
              graphW={0}
              sha={e.shortOid}
              message={`${opLabel(e.op)}: ${e.message || "(no message)"}`}
              author=""
              date={relativeTime(e.timestamp)}
              selected={selectedOid === e.oid}
              onClick={() => void selectEntry(e.oid)}
            />
```

- [ ] **Step 3: Verify the whole tree type-checks and the suite is green**

```bash
pnpm tsc --noEmit
pnpm test
```

Expected: no type errors anywhere; the full vitest suite passes.

- [ ] **Step 4: Commit**

```bash
git add src/screens/Reflog.tsx
git commit -m "refactor(reflog): drop the empty graph gutter from reflog rows

Why: Reflog passes no lanes and no node, so the 140px column was pure spacing.
Making graphW required forced the choice; the message column gets the space.
Deliberate visual change, recorded in the commit-graph-v2 spec.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: E2E coverage for the reported symptom

**Files:**
- Modify: `src/screens/History.tsx:827` (add a test id to the search input)
- Modify: `e2e/specs/history-diff.e2e.ts`

**Interfaces:**
- Consumes: the shipped behaviour from Tasks 1-8, including `data-lane-kind` from Task 5.
- Produces: nothing downstream.

- [ ] **Step 1: Read the project e2e skill first**

**Required by CLAUDE.md before writing or debugging any e2e spec.** Read `.claude/skills/e2e-testing/SKILL.md` — selector conventions and traps, the driver-bridge 5s-penalty rules, native-dialog stubbing, fixture geometry gotchas, rebuild discipline, and the debugging flow. Do not skip this; the conventions are not guessable.

- [ ] **Step 2: Give the search input a test id**

The History search input has **no `data-testid`** — only `placeholder="Search message, author, sha, path… (e.g. author:bob)"` (`History.tsx:827`). Selecting on that placeholder string would couple the spec to user-facing copy. Add the id:

```tsx
data-testid="history-search"
```

`PGInput` spreads `...rest` onto its DOM node, so the attribute passes through without further threading. (Row components like `PGCommitRow` do not — that distinction matters elsewhere, not here.)

- [ ] **Step 3: Check the fixture can express the case**

The test needs a repo where two commits on one branch match a search term with at least one non-matching commit between them. Read `e2e/support/tempRepo.ts` and check the fixture `history-diff.e2e.ts` already uses. If it has no such pair, add commits whose subjects are, oldest to newest: `feat: parser init`, `chore: unrelated one`, `chore: unrelated two`, `fix: parser bug` — searching `parser` then matches the oldest and newest with two rows elided between them.

Note the search is debounced by `SEARCH_DEBOUNCE_MS = 250` (`History.tsx:46`) and runs against the real backend, so wait on the row count rather than on a fixed sleep.

- [ ] **Step 4: Write the spec**

Add to `e2e/specs/history-diff.e2e.ts`, matching the file's existing style for navigation and waits:

```ts
  it("keeps two same-branch search hits in one lane with no phantom lane", async () => {
    // Two hits on one branch, two non-matching commits between them (#68 G2).
    await $('[data-testid="history-search"]').setValue("parser");

    await browser.waitUntil(
      async () => (await $$('[data-testid="commit-row"]').length) === 2,
      { timeoutMsg: "expected exactly the two commits matching 'parser'" },
    );

    const rows = await $$('[data-testid="commit-row"]');

    // Both hits sit in the SAME lane: their node dots share an x.
    const cx = await Promise.all(
      rows.map(async (r) => (await r.$("svg circle")).getAttribute("cx")),
    );
    expect(cx[0]).toEqual(cx[1]);

    // The elided span between them is drawn dashed.
    expect(await $('[data-testid="commit-row"] [stroke-dasharray]')).toBeExisting();

    // THE PHANTOM LANE: the last matching row must not carry a lane continuing
    // downward toward a commit that will never be rendered. `data-lane-kind`
    // comes from Task 5.
    const trailing = await rows[rows.length - 1].$$(
      'svg [data-lane-kind="half-bot"], svg [data-lane-kind="line"]',
    );
    expect(trailing).toHaveLength(0);
  });
```

- [ ] **Step 5: Rebuild the snapshot and run only this spec**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:build
pnpm test:e2e:run --spec e2e/specs/history-diff.e2e.ts
```

`test:e2e:run` silently tests the previous binary if the rebuild is skipped, so never reorder these. Also run the e2e typecheck gate, which the root `tsc` does not cover:

```bash
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

Expected: the spec passes.

**Prefer Docker outright while other agents are active.** Port 4445 is a HOST
port for native runs, so if any other worktree has an e2e binary running, the
runner attaches to *that* binary — a different checkout. Unrelated specs still
pass (against someone else's build) and only assertions touching your change
fail, which reads like a bug in your code. Check the served bundle hash against
your own `dist/assets/`, and `ps aux | grep platypusgit` to see which worktree
owns the process — do not kill another session's run. Docker keeps 4445 inside a
per-worktree container:

```bash
pnpm test:e2e:docker full --spec e2e/specs/history-diff.e2e.ts
```

It also sidesteps the macOS `ensureMacAppFocus` flake entirely, and matches the
WebKitGTK + xvfb stack CI gates on.

- [ ] **Step 6: Commit**

```bash
git add e2e/specs/history-diff.e2e.ts e2e/support src/screens/History.tsx
git commit -m "test(e2e): same-branch search hits share one lane, no phantom lane (#68)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Squash and open the PR

- [ ] **Step 1: Rebase onto the latest main**

```bash
git fetch origin
git rebase origin/main
```

Resolve any conflict in `git-components.tsx` — it is the file other sessions touch most.

- [ ] **Step 2: Run every gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

Rust is untouched this phase, so `cargo test` is not required — but run `cargo check --manifest-path src-tauri/Cargo.toml` once to confirm that is actually true.

- [ ] **Step 3: Squash to one commit**

The `main` ruleset is squash-only, so squash locally to keep the merged message clean rather than an auto-concatenation:

```bash
git reset --soft origin/main
git status   # review everything that is about to be one commit
```

Write the message to a file and commit with `-F`, so the body keeps its line breaks:

```
fix(graph): commit graph correctness — clipping, search lanes, dead kind (#68)

Phase 1 of the commit-graph-v2 spec: the three wrong-pixels bugs.

G1 — the gutter was a fixed 140px while lane x is 12 + col * 16, so column 8
was half-cut and 9+ vanished entirely, node dot included. An SVG element is a
viewport and clips by default, so there was no overflow, no scrollbar, and no
warning. Width now derives from the layout's actual max lane column, clamped at
240px with a fade and a lane count in the GRAPH header past the clamp.

G2 — two search hits on one branch now stay in one lane joined by a dashed
segment, and a hit whose ancestors are all filtered out ends its lane instead of
drawing an edge to a commit that never appears.

G3 — deleted the diag lane kind, which had no producer.

Why frontend-only for G2: the issue routes it through get_log_filtered, but only
text/author/path/date/sha filtering is backend-side. mine/branch/hideMerges are
client-side refinements over baseCommits, so a backend rewrite would leave all
three still emitting phantom lanes. The ancestry needed is already loaded —
useRepoStore holds the unfiltered `commits` next to `searchResults` — so the
rewrite lives in layoutGraph and fixes every filter path at once, with no Rust
change and no wire-format churn. CommitInfo.parents is never touched, which
keeps CommitDiff's parent header, buildRebasePlan, and planCommitSelection
correct.

Why dashed is a flag, not a lane kind: one elided link renders as a straight
run, a half-lane, and a curve depending on the row.

Also drops Reflog's 140px empty graph gutter — it renders no lanes, and making
the width required forced the choice.

Spec: docs/superpowers/specs/2026-08-11-commit-graph-v2-design.md

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

- [ ] **Step 4: Push and open the PR**

```bash
git push --force-with-lease
```

Open the PR with a body covering: the three items shipped (G1/G2/G3) and the four phases still outstanding; the three corrections to #68 (G2 frontend-only, G7's dimming contradiction, G10's already-satisfied row-height premise); the deliberate Reflog change; and a link to the spec. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Do not merge: the branch must be rebased onto the latest `main` immediately before merge, and `main` is squash-only.

---

## Remaining phases

The spec commits to all 11 items. Phases 2-5 get their own plans, written when their turn comes rather than now — each builds on the API this phase ships, and a plan written against an imagined `layoutGraph` would be rewritten before it ran.

| Phase | Items | Depends on |
|---|---|---|
| 2 — colour & theme | G4 stable collision-aware lane colours, G5 `--graph-*` in `applyTheme` | `ActiveLane` from Task 4 (adds `colorKey`) |
| 3 — rendering quality | G6 casing bridges + primary lane, G7 HEAD ring, G8 crisp strokes + `aria-hidden` | `LayoutOptions.headOid` declared in Task 3 |
| 4 — render cost | G9 memo + stable props, G10 virtualize + the six-spec e2e migration | Phase 1's row props; `COMMIT_ROW_BASE_H` + `useDensityStep()` |
| 5 — scale | G11 frontier-cursor pagination + resumable layout | G10; the only phase touching Rust |

Two things to carry forward so they are not rediscovered:

- **Phase 4 must migrate six e2e spec files.** `history-diff`, `reflog`, `keymap`, `palette`, `rebase`, and `history-ops` all select commit rows by visible text, and `history-diff.e2e.ts:25` asserts an exact row count. Windowing unmounts off-screen rows and breaks every one.
- **Phase 5's page cursor is the walk frontier, not a single oid.** At a page boundary the frontier is a *set* — every lane's awaited parent — so resuming from the last emitted commit silently drops every other live branch.
