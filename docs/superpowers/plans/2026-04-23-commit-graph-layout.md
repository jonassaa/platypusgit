# Commit Graph Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stub `buildLanes` in `HistoryScreen` with a real multi-lane graph layout so branches, merges, and unmerged parallel branches render JetBrains-style on the History screen.

**Architecture:** A pure TypeScript `layoutGraph(commits)` function computes per-row `GraphRow = { lanes, node }` in a single top-to-bottom pass, tracking live lanes in an array with leftmost-match-wins collapse semantics. The existing `PGGraphRow` primitive is extended with two new lane kinds (`fork-bot`, `merge-top`) to render curves that start or end at node-level mid-row. `HistoryScreen` calls `layoutGraph(visible)` via `useMemo` and indexes the result into the existing `PGCommitRow` render loop.

**Tech Stack:** TypeScript, React 19, Vite 7, Vitest (new dev dep), existing design-system primitives in `src/design/git-components.tsx`.

**Spec:** `docs/superpowers/specs/2026-04-23-commit-graph-layout-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Add `vitest` devDep + `test` script (modify) |
| `vite.config.ts` | Extend `defineConfig` with a `test` block (modify) |
| `src/features/commits/graphLayout.ts` | **NEW.** Pure `layoutGraph(commits) → GraphRow[]` + types |
| `src/features/commits/graphLayout.test.ts` | **NEW.** Vitest coverage for each topology class + ASCII helper |
| `src/design/git-components.tsx` | Extend `GraphLane.kind` union, add `fork-bot` / `merge-top` SVG paths in `PGGraphRow` (modify) |
| `src/screens/History.tsx` | Delete inline `buildLanes`, call `layoutGraph` via `useMemo` (modify) |

---

## Task 1: Add Vitest and smoke test

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/features/commits/graphLayout.test.ts`

- [ ] **Step 1: Install vitest**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm add -D vitest
```

Expected: adds `vitest` to `devDependencies`.

- [ ] **Step 2: Add the `test` script**

Edit `package.json`, adding to the `scripts` block so it reads:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3: Configure vitest in vite.config.ts**

Read the current `vite.config.ts` first. It will have a `defineConfig({ ... })` call. Add a `test` property alongside `plugins` / `resolve`:

```ts
test: {
  environment: "node",
  include: ["src/**/*.test.ts"],
},
```

Also add this triple-slash directive at the very top of the file if it's missing (needed for vitest's type augmentation of `defineConfig`):

```ts
/// <reference types="vitest" />
```

- [ ] **Step 4: Write a smoke test so we can verify the runner**

Create `src/features/commits/graphLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";

describe("graphLayout", () => {
  it("test runner is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: 1 test file, 1 passing, exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/features/commits/graphLayout.test.ts
git commit -m "chore: add vitest test runner"
```

---

## Task 2: Extend PGGraphRow with fork-bot and merge-top kinds

**Files:**
- Modify: `src/design/git-components.tsx` (around lines 839–924)

These are visual primitives with no algorithmic logic — tested visually by later tasks that exercise them through the layout algorithm. We add them first so the layout code can reference the new kinds.

- [ ] **Step 1: Widen the `GraphLane.kind` union**

In `src/design/git-components.tsx`, find the `GraphLane` interface (around line 839) and change it to:

```ts
export interface GraphLane {
  col: number;
  color: string;
  kind: "line" | "diag" | "half-top" | "half-bot" | "fork-bot" | "merge-top";
  to?: number;
}
```

- [ ] **Step 2: Add SVG paths for the two new kinds**

In the same file, find the `PGGraphRow` renderer's `lanes.map` switch (starts around line 870). After the existing `half-bot` case and before the final `return null`, insert:

```tsx
if (ln.kind === "fork-bot") {
  const x2 = 12 + (ln.to ?? ln.col + 1) * 16;
  return (
    <path
      key={i}
      d={`M ${x} ${height / 2} C ${x} ${height * 0.75}, ${x2} ${height * 0.75}, ${x2} ${height}`}
      stroke={ln.color}
      strokeWidth="1.5"
      fill="none"
    />
  );
}
if (ln.kind === "merge-top") {
  const x2 = 12 + (ln.to ?? ln.col + 1) * 16;
  return (
    <path
      key={i}
      d={`M ${x} 0 C ${x} ${height * 0.25}, ${x2} ${height * 0.25}, ${x2} ${height / 2}`}
      stroke={ln.color}
      strokeWidth="1.5"
      fill="none"
    />
  );
}
```

Note: for `fork-bot`, `col` is the **node's** column (curve origin) and `to` is the **destination** column at bottom. For `merge-top`, `col` is the **source** column at top and `to` is the **node's** column (curve destination). This matches the semantics used by the layout algorithm in later tasks.

- [ ] **Step 3: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors. (`HistoryScreen`'s existing `buildLanes` only emits the old kinds, which are still valid in the widened union.)

- [ ] **Step 4: Commit**

```bash
git add src/design/git-components.tsx
git commit -m "feat(design): add fork-bot and merge-top graph lane kinds"
```

---

## Task 3: Scaffold graphLayout module with linear-history support

**Files:**
- Create: `src/features/commits/graphLayout.ts`
- Modify: `src/features/commits/graphLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the smoke test in `src/features/commits/graphLayout.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import type { CommitInfo } from "@/lib/types";
import { layoutGraph } from "./graphLayout";

/**
 * Build a fake CommitInfo with only the fields layoutGraph uses.
 * `oid` and `parents` are the only semantically-meaningful fields here.
 */
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

describe("layoutGraph", () => {
  it("linear history: single lane, straight line", () => {
    // A → B → C (newest first, as git log returns)
    const rows = layoutGraph([c("A", ["B"]), c("B", ["C"]), c("C", [])]);

    expect(rows).toHaveLength(3);

    // All three commits sit on col 0
    expect(rows[0]!.node.col).toBe(0);
    expect(rows[1]!.node.col).toBe(0);
    expect(rows[2]!.node.col).toBe(0);

    // Initial commit (C, no parents) is solid and not merge
    expect(rows[2]!.node.solid).toBe(true);
    expect(rows[2]!.node.merge).toBe(false);

    // First row: lane opens here (half-bot continuation only)
    expect(rows[0]!.lanes.map((l) => l.kind)).toEqual(["half-bot"]);

    // Middle row: full line through the node (half-top + half-bot on same col)
    expect(rows[1]!.lanes.map((l) => l.kind).sort()).toEqual(["half-bot", "half-top"]);

    // Last row: lane terminates (half-top only; initial commit frees slot)
    expect(rows[2]!.lanes.map((l) => l.kind)).toEqual(["half-top"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: FAIL — `Cannot find module './graphLayout'` (or similar).

- [ ] **Step 3: Implement layoutGraph for linear history**

Create `src/features/commits/graphLayout.ts`:

```ts
import type { CommitInfo } from "@/lib/types";
import type { GraphLane, GraphNode } from "@/design";

export interface GraphRow {
  lanes: GraphLane[];
  node: GraphNode;
}

interface ActiveLane {
  awaitingOid: string;
  color: string;
}

const PALETTE = [
  "var(--graph-1)",
  "var(--graph-2)",
  "var(--graph-3)",
  "var(--graph-4)",
  "var(--graph-5)",
  "var(--graph-6)",
  "var(--graph-7)",
];

export function layoutGraph(commits: CommitInfo[]): GraphRow[] {
  const active: Array<ActiveLane | null> = [];
  const rows: GraphRow[] = [];
  let laneBirthCounter = 0;

  const allocSlot = (): number => {
    const free = active.indexOf(null);
    if (free !== -1) return free;
    active.push(null);
    return active.length - 1;
  };

  const nextColor = (): string => {
    const color = PALETTE[laneBirthCounter % PALETTE.length]!;
    laneBirthCounter++;
    return color;
  };

  for (const commit of commits) {
    // 1. Find lanes awaiting this commit (collapse targets)
    const awaiting: number[] = [];
    for (let i = 0; i < active.length; i++) {
      if (active[i]?.awaitingOid === commit.oid) awaiting.push(i);
    }

    let nodeCol: number;
    let nodeColor: string;

    if (awaiting.length === 0) {
      // New root or branch tip visible at top of view
      nodeCol = allocSlot();
      nodeColor = nextColor();
    } else {
      // Leftmost wins; other awaiting lanes collapse into it
      nodeCol = awaiting[0]!;
      nodeColor = active[nodeCol]!.color;
    }

    // Record which top-of-row lanes existed before we mutate `active`
    const lanesAtTop: Array<{ col: number; color: string } | null> = active.map(
      (a, i) => (a ? { col: i, color: a.color } : null),
    );
    // Lanes that end at this row's node (collapsed secondary matches)
    const collapsingCols = awaiting.slice(1);

    // 2. First parent continues in node's lane
    if (commit.parents.length >= 1) {
      active[nodeCol] = { awaitingOid: commit.parents[0]!, color: nodeColor };
    } else {
      active[nodeCol] = null; // initial commit
    }

    // Free collapsed slots
    for (const col of collapsingCols) active[col] = null;

    // 3. Place additional parents
    const forkTargets: Array<{ toCol: number; color: string }> = [];
    for (let p = 1; p < commit.parents.length; p++) {
      const parent = commit.parents[p]!;
      const existing = active.findIndex((a) => a?.awaitingOid === parent);
      if (existing !== -1) {
        forkTargets.push({ toCol: existing, color: active[existing]!.color });
      } else {
        const slot = allocSlot();
        const color = nextColor();
        active[slot] = { awaitingOid: parent, color };
        forkTargets.push({ toCol: slot, color });
      }
    }

    // 4. Emit lanes for this row
    const lanes: GraphLane[] = [];
    const width = Math.max(active.length, lanesAtTop.length);

    for (let col = 0; col < width; col++) {
      const top = lanesAtTop[col] ?? null;
      const bot = active[col] ?? null;

      if (col === nodeCol) {
        if (top) lanes.push({ col, color: top.color, kind: "half-top" });
        if (bot) lanes.push({ col, color: bot.color, kind: "half-bot" });
        continue;
      }

      if (collapsingCols.includes(col) && top) {
        lanes.push({ col, color: top.color, kind: "merge-top", to: nodeCol });
        continue;
      }

      if (top && bot) {
        // Pass-through
        lanes.push({ col, color: top.color, kind: "line" });
        continue;
      }

      // Born at bottom-only (a fork target) — rendered as fork-bot from node
      // We'll emit fork-bot entries below, keyed off the node column so
      // they render once per additional parent regardless of this column.
    }

    // Fork-bot curves from node → each additional-parent column
    for (const f of forkTargets) {
      if (f.toCol === nodeCol) continue; // guard (shouldn't happen)
      lanes.push({
        col: nodeCol,
        color: f.color,
        kind: "fork-bot",
        to: f.toCol,
      });
    }

    const node: GraphNode = {
      col: nodeCol,
      color: nodeColor,
      solid: commit.parents.length <= 1,
      merge: commit.parents.length >= 2,
    };

    rows.push({ lanes, node });
  }

  return rows;
}
```

- [ ] **Step 4: Run the test**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/features/commits/graphLayout.ts src/features/commits/graphLayout.test.ts
git commit -m "feat(graph): lane-tracking layout for linear history"
```

---

## Task 4: Test two-parent merge (feature branch rejoins main)

**Files:**
- Modify: `src/features/commits/graphLayout.test.ts`

No implementation change is expected — Task 3 already covers the algorithm. This task verifies the merge case works and locks it in with a test.

- [ ] **Step 1: Append the merge test**

Add this `it(...)` block inside the existing `describe("layoutGraph", …)`:

```ts
it("merge: feature branch rejoins main", () => {
  // newest first:
  //   M (merge of main + feature)
  //   F (feature commit, child of R)
  //   T (main commit between branch-point and merge, child of R)
  //   R (branch point, parent of both T and F)
  //   I (initial, parent of R)
  const rows = layoutGraph([
    c("M", ["T", "F"]),
    c("F", ["R"]),
    c("T", ["R"]),
    c("R", ["I"]),
    c("I", []),
  ]);

  // M is a merge on col 0
  expect(rows[0]!.node).toMatchObject({ col: 0, merge: true, solid: false });
  // M forks a lane out to col 1 for the second parent F
  const mForks = rows[0]!.lanes.filter((l) => l.kind === "fork-bot");
  expect(mForks).toHaveLength(1);
  expect(mForks[0]!.col).toBe(0);
  expect(mForks[0]!.to).toBe(1);

  // F is the next commit, sits on col 1 (the forked lane)
  expect(rows[1]!.node.col).toBe(1);
  // T is on col 0 (main lane continues)
  expect(rows[2]!.node.col).toBe(0);

  // R is the branch point: col 1 collapses into col 0
  expect(rows[3]!.node.col).toBe(0);
  const rMergeTops = rows[3]!.lanes.filter((l) => l.kind === "merge-top");
  expect(rMergeTops).toHaveLength(1);
  expect(rMergeTops[0]!.col).toBe(1);
  expect(rMergeTops[0]!.to).toBe(0);

  // After R, only col 0 is alive
  expect(rows[4]!.node.col).toBe(0);
  expect(rows[4]!.lanes.every((l) => l.col === 0)).toBe(true);
});
```

- [ ] **Step 2: Run tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: both tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/commits/graphLayout.test.ts
git commit -m "test(graph): cover two-parent merge layout"
```

---

## Task 5: Test octopus merge (3-parent)

**Files:**
- Modify: `src/features/commits/graphLayout.test.ts`

- [ ] **Step 1: Append the octopus test**

```ts
it("octopus merge: three parents each open their own lane", () => {
  //   O (octopus: parents P1, P2, P3)
  //   P3
  //   P2
  //   P1
  //   G (grandparent, common ancestor — parent of P1/P2/P3)
  const rows = layoutGraph([
    c("O", ["P1", "P2", "P3"]),
    c("P3", ["G"]),
    c("P2", ["G"]),
    c("P1", ["G"]),
    c("G", []),
  ]);

  // O forks out two lanes (for P2 and P3) — P1 continues on node col
  const oForks = rows[0]!.lanes.filter((l) => l.kind === "fork-bot");
  expect(oForks).toHaveLength(2);
  expect(rows[0]!.node.merge).toBe(true);

  // Three lanes are alive between P3 and G
  // (P1 on col 0, P2 on col 1, P3 on col 2 — some ordering)
  const cols = new Set(rows[1]!.lanes.map((l) => l.col));
  expect(cols.size).toBeGreaterThanOrEqual(3);

  // G is the common ancestor — two lanes collapse into it
  const gMergeTops = rows[4]!.lanes.filter((l) => l.kind === "merge-top");
  expect(gMergeTops).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/commits/graphLayout.test.ts
git commit -m "test(graph): cover octopus merge (3 parents)"
```

---

## Task 6: Test slot reuse across unmerged parallel branches

**Files:**
- Modify: `src/features/commits/graphLayout.test.ts`

- [ ] **Step 1: Append the reuse test**

```ts
it("slot reuse: freed column is reused by a later branch tip", () => {
  // Two totally independent histories visible in the same window:
  //   B2 → B1 (branch B, initial)
  //   A2 → A1 (branch A, initial)
  // layoutGraph sees: B2, B1, A2, A1 (newest first)
  const rows = layoutGraph([
    c("B2", ["B1"]),
    c("B1", []),
    c("A2", ["A1"]),
    c("A1", []),
  ]);

  // B1 is initial → frees col 0
  expect(rows[1]!.node.col).toBe(0);
  expect(rows[1]!.node.solid).toBe(true);

  // A2 is a new branch tip — reuses col 0 (the freed slot)
  expect(rows[2]!.node.col).toBe(0);

  // A1 is initial on col 0
  expect(rows[3]!.node.col).toBe(0);
  expect(rows[3]!.node.solid).toBe(true);
});
```

- [ ] **Step 2: Run tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/commits/graphLayout.test.ts
git commit -m "test(graph): cover slot reuse across unmerged branches"
```

---

## Task 7: Test branch point with multiple visible children

**Files:**
- Modify: `src/features/commits/graphLayout.test.ts`

Validates the collapse path when two child commits on different lanes both await the same parent.

- [ ] **Step 1: Append the multi-children test**

```ts
it("branch point: multiple children of same commit collapse into one lane", () => {
  //   D (on feature branch, child of P)
  //   C (on main, child of P)
  //   P (branch point — parent of both C and D, but NOT a merge commit itself)
  //   R (root)
  //
  // Since P has a single parent, P is not a merge. But P is the parent of
  // two separate lanes (D's lane and C's lane), so both lanes must collapse
  // into P's row. The first time layoutGraph sees P's oid it will be
  // "awaited" by two active lanes, which exercises the collapse code path.
  //
  // To set this up we need D and C to both be on separate lanes by the time
  // we reach P. That requires an earlier merge commit introducing the two
  // lanes — so we'll synthesise one:
  //
  //   M (merge of C and D)
  //   D (child of P)
  //   C (child of P)
  //   P (child of R)
  //   R ()
  const rows = layoutGraph([
    c("M", ["C", "D"]),
    c("D", ["P"]),
    c("C", ["P"]),
    c("P", ["R"]),
    c("R", []),
  ]);

  // By the time we reach P (row index 3), two lanes await P — collapse
  expect(rows[3]!.node.merge).toBe(false); // P itself has a single parent
  expect(rows[3]!.node.solid).toBe(true);
  const pMergeTops = rows[3]!.lanes.filter((l) => l.kind === "merge-top");
  expect(pMergeTops).toHaveLength(1);
  // The collapsing lane points to P's node column
  expect(pMergeTops[0]!.to).toBe(rows[3]!.node.col);
});
```

- [ ] **Step 2: Run tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/commits/graphLayout.test.ts
git commit -m "test(graph): cover multi-child branch point collapse"
```

---

## Task 8: Wire layoutGraph into HistoryScreen

**Files:**
- Modify: `src/screens/History.tsx`

- [ ] **Step 1: Edit HistoryScreen to call layoutGraph**

In `src/screens/History.tsx`:

1. Add the import near the other `@/` imports:

```ts
import { layoutGraph } from "@/features/commits/graphLayout";
```

2. Delete the entire `buildLanes` function (the `const buildLanes = (c, i, arr) => { … }` block, currently at lines ~58–90 per the design doc).

3. Also remove `type GraphLane, type GraphNode` from the `@/design` import list if they're no longer referenced in this file (they won't be after the deletion).

4. Add a memoised layout above the `if (!commits.length)` check:

```ts
const rows = React.useMemo(() => layoutGraph(visible), [visible]);
```

5. Replace the existing map callback:

```tsx
{visible.map((c, i) => {
  const g = buildLanes(c, i, visible);
  return (
    <PGCommitRow
      key={c.oid}
      lanes={g.lanes}
      node={g.node}
      ...
    />
  );
})}
```

with:

```tsx
{visible.map((c, i) => {
  const g = rows[i];
  return (
    <PGCommitRow
      key={c.oid}
      lanes={g?.lanes}
      node={g?.node}
      sha={c.shortOid}
      message={c.summary}
      author={c.author || "unknown"}
      date={relativeTime(c.timestamp)}
      refs={mapCommitRefs(c.refs, headName)}
      selected={selected === i}
      onClick={() => setSelected(i)}
      onContextMenu={(e) =>
        onCommitContext(e, { sha: c.shortOid, subject: c.summary })
      }
    />
  );
})}
```

(The prop list is unchanged from before — only `lanes` and `node` come from the precomputed `rows` array now.)

- [ ] **Step 2: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: all tests PASS (no new tests added this task, but verifying nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add src/screens/History.tsx
git commit -m "feat(history): render commit graph with multi-lane layout"
```

---

## Task 9: Verify end-to-end in the live app

**Files:** none

- [ ] **Step 1: Launch the app**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tauri dev
```

First build takes ~2 minutes; subsequent launches ~10s.

- [ ] **Step 2: Open a repo with branching history**

A good candidate: the user's `platypusgit` repo itself if it has any branches, OR any repo with at least one merge commit. Navigate to the History screen.

- [ ] **Step 3: Visually verify**

Check that:
- Linear stretches show a single coloured lane.
- Merge commits visibly fork out into a second lane to the right.
- That second lane runs down through intermediate commits and rejoins (or runs off the bottom if unmerged).
- Colours are stable per branch (don't change row-to-row on the same lane).
- The width of the graph column doesn't grow pathologically (slot reuse is working).

If anything looks wrong, capture the commit topology and open a new task to debug — don't patch layout inline in this task.

- [ ] **Step 4: Full verification pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all three exit 0. (Rust check is belt-and-braces — no Rust changes in this plan.)

- [ ] **Step 5: Final commit (if any stray touch-ups)**

Most likely nothing to commit at this point. If there are tweaks, commit them separately with a descriptive message.

---

## Self-Review Checklist

Against the spec at `docs/superpowers/specs/2026-04-23-commit-graph-layout-design.md`:

- ✅ Pure TS layout function — Task 3
- ✅ Linear, merge, octopus, parallel-unmerged, multiple-children, initial-commit topologies — Tasks 3–7
- ✅ Stable per-lane colors from `--graph-1…N` palette — Task 3 (`PALETTE` + `nextColor`)
- ✅ New `fork-bot` / `merge-top` lane kinds — Task 2
- ✅ Slot reuse — Task 3 (`allocSlot` prefers leftmost `null`), verified by Task 6
- ✅ Unit tests per topology class — Tasks 3–7
- ✅ Memoised `layoutGraph(visible)` in `HistoryScreen`, `buildLanes` deleted — Task 8
- ✅ End-to-end verification — Task 9
- No topological reordering — respected (consume order as given)
- No filter-aware ghosting — respected (filtered rows simply disappear)
- No Rust changes — respected
