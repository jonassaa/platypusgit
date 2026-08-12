# Commit Graph v2 — Phase 2+3 (colour, emphasis, a11y) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make commit-graph lane colours stable and collision-aware (G4), make crossings traceable with casing strokes and a weighted HEAD lane (G6), mark the HEAD commit (G7-partial), and stop the graph SVG from lying to assistive tech (G8).

**Architecture:** Colour selection moves out of `layoutGraph` into a new pure module `src/features/commits/laneColors.ts` (hash-first, LRU as collision-breaker) so it can be tested without building a commit list. `layoutGraph` gains `primary` on lanes and `head` on nodes, both derived from the already-declared `LayoutOptions.headOid`; because a first parent always continues in its node's lane, `primary` propagates down the first-parent chain for free. `PGGraphRow` changes only draw *order* and stroke decoration — no geometry changes, so `graph-geometry.ts` is untouched.

**Tech Stack:** React 18 + TypeScript, Vitest + React Testing Library (jsdom), Tailwind v4 CSS vars, hand-rolled SVG (no chart lib).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-08-11-commit-graph-v2-design.md`, sections "Phase 2" and "Phase 3". Issue #68.
- **Toolchain:** Node 22 + pnpm. The assistant's Bash tool does not inherit the interactive shell rc — prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to every `pnpm`/`cargo` command.
- **No Rust changes this phase.** Nothing crosses IPC, so `src/lib/types.ts` ⇄ `src-tauri/src/git/types.rs` stay untouched.
- **Never hardcode a colour literal.** Use `var(--…)` or relative-colour `oklch(from var(--token) l c h / <alpha>)`. This phase *removes* the last such literal in the graph row.
- **Do not reintroduce a literal `26` row height.** `PGCommitRow` feeds `PGGraphRow` a number derived from `useDensityStep()`; the two must stay in sync or History's graph desyncs from its rows (#70).
- **Do not change lane geometry.** `GRAPH_PAD = 12`, `LANE_W = 16`, `laneX()` and `graphWidth()` in `src/design/graph-geometry.ts` are the single source of truth and stay exactly as they are. In particular: **no 0.5px coordinate offset** — node `cx` is computed from the same lane x, so offsetting lanes alone desyncs dot from lane, and offsetting both reintroduces fractional positions. `shape-rendering` is the whole fix (spec, G8).
- **Verification gate for every task:** `pnpm test` and `pnpm tsc --noEmit` both clean before committing.
- **Commit style:** Conventional Commits, imperative subject under 72 chars, `fix(graph):` / `feat(graph):` scope.

## Out of scope (record, do not implement)

- **G5** is already done — it landed via #61 B4 in #73 (`SEMANTIC_TOKENS` per mode in `useSettingsStore.ts:328-448`). Phase 2 therefore reduces to G4 plus the one adjacent hardcode the spec folded in (Task 7).
- **G7 dimming** is dropped by spec decision 3: non-matching rows are not rendered at all (`visible` *is* the match set), so search cannot both filter and show dimmed non-matches.
- **G9/G10/G11** (memoization, virtualization, pagination) are Phases 4–5.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/features/commits/laneColors.ts` | FNV-1a hash + `createLaneColorer` — pure colour choice, no commit knowledge | **create** |
| `src/features/commits/laneColors.test.ts` | Colour choice in isolation: determinism, collision, LRU | **create** |
| `src/features/commits/graphLayout.ts` | Consume the colorer; derive `primary` / `head` from `headOid` | modify |
| `src/features/commits/graphLayout.test.ts` | Colour stability + primary propagation over real commit lists | modify (append) |
| `src/design/git-components.tsx` | `GraphLane.primary`, `GraphNode.head`; draw order, casing, stroke weight, HEAD ring, `crispEdges`, `aria-hidden`; border token | modify |
| `src/design/git-components.graph.test.tsx` | Render assertions for all of the above | modify (append) |
| `src/screens/History.tsx` | Pass `headOid` into `layoutGraph` | modify |
| `src/screens/History.graph.test.tsx` | Wiring: HEAD's commit renders the marker | modify (append) |

---

### Task 1: Lane colorer module (G4 core)

**Files:**
- Create: `src/features/commits/laneColors.ts`
- Test: `src/features/commits/laneColors.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports from the codebase).
- Produces: `PALETTE: readonly string[]` (7 `var(--graph-N)` entries), `fnv1a(s: string): number`, `createLaneColorer(palette?: readonly string[]): LaneColorer` where `LaneColorer = { pick(colorKey: string, activeColors: ReadonlySet<string>): string }`. Task 2 imports `PALETTE` and `createLaneColorer`.

- [ ] **Step 1: Write the failing test**

Create `src/features/commits/laneColors.test.ts`:

```ts
// Lane colour choice, isolated from commit layout (#68 G4). Two failures being
// fixed: the 8th concurrent lane silently reused --graph-1 with no adjacency
// check, and colour was a function of birth ORDER, so any filter repainted the
// whole graph.
import { describe, expect, it } from "vitest";
import { PALETTE, createLaneColorer, fnv1a } from "./laneColors";

describe("fnv1a", () => {
  it("is deterministic for the same input", () => {
    expect(fnv1a("abc")).toBe(fnv1a("abc"));
  });

  it("separates similar keys", () => {
    expect(fnv1a("commit-a")).not.toBe(fnv1a("commit-b"));
  });

  it("stays an unsigned 32-bit integer", () => {
    const h = fnv1a("a".repeat(64));
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("createLaneColorer", () => {
  const none = new Set<string>();

  it("gives the same key the same colour, independent of call order", () => {
    const a = createLaneColorer();
    const b = createLaneColorer();
    // b burns three unrelated picks first: birth ORDER must not matter.
    b.pick("x", none);
    b.pick("y", none);
    b.pick("z", none);
    expect(b.pick("stable-key", none)).toBe(a.pick("stable-key", none));
  });

  it("returns the hashed preference when it is free", () => {
    const c = createLaneColorer();
    const expected = PALETTE[fnv1a("k") % PALETTE.length]!;
    expect(c.pick("k", none)).toBe(expected);
  });

  it("never hands out a colour already active, below full concurrency", () => {
    const c = createLaneColorer();
    const preferred = PALETTE[fnv1a("k") % PALETTE.length]!;
    const got = c.pick("k", new Set([preferred]));
    expect(got).not.toBe(preferred);
    expect(PALETTE).toContain(got);
  });

  it("breaks a collision toward the least-recently-used free entry", () => {
    const c = createLaneColorer();
    // Burn every palette entry so lastUsed is populated and ordered.
    for (const entry of PALETTE) c.pick(`seed:${entry}`, new Set(PALETTE.filter((p) => p !== entry)));
    const preferred = PALETTE[fnv1a("k") % PALETTE.length]!;
    // Only two entries free; the colorer must choose between them by lastUsed,
    // never outside them.
    const free = [PALETTE[0]!, PALETTE[1]!].filter((p) => p !== preferred);
    const active = new Set(PALETTE.filter((p) => !free.includes(p)));
    const got = c.pick("k", active);
    expect(free).toContain(got);
  });

  it("repeats only when every palette entry is genuinely active", () => {
    const c = createLaneColorer();
    const got = c.pick("k", new Set(PALETTE));
    // An unavoidable repeat — but still a defined, palette-member choice.
    expect(PALETTE).toContain(got);
  });

  it("prefers a never-used entry over a previously-used one when breaking ties", () => {
    const c = createLaneColorer();
    const preferred = PALETTE[fnv1a("k") % PALETTE.length]!;
    const used = PALETTE.find((p) => p !== preferred)!;
    c.pick(`force:${used}`, new Set(PALETTE.filter((p) => p !== used)));
    // preferred + used are active; every other entry is untouched, so an
    // untouched one (lastUsed = never) must win.
    const got = c.pick("k", new Set([preferred, used]));
    expect(got).not.toBe(preferred);
    expect(got).not.toBe(used);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/laneColors.test.ts`
Expected: FAIL — `Failed to resolve import "./laneColors"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/features/commits/laneColors.ts`:

```ts
// Lane colour selection for the commit graph (#68 G4).
//
// The old rule was `PALETTE[laneBirthCounter++ % 7]`, which failed twice: the
// 8th concurrent lane silently reused --graph-1 with no adjacency check, and
// colour depended on birth order WITHIN the laid-out list, so toggling a filter
// repainted the whole graph for the same history.
//
// New rule: hash first, LRU only as a collision-breaker.

/** 32-bit FNV-1a. Stable across runs — a lane's colour follows its identity. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const PALETTE: readonly string[] = [
  "var(--graph-1)",
  "var(--graph-2)",
  "var(--graph-3)",
  "var(--graph-4)",
  "var(--graph-5)",
  "var(--graph-6)",
  "var(--graph-7)",
];

export interface LaneColorer {
  /**
   * `colorKey` identifies the lane (see graphLayout: the oid the lane awaits at
   * birth). `activeColors` is what is on screen RIGHT NOW, so a collision is
   * only broken when it would actually be visible.
   */
  pick(colorKey: string, activeColors: ReadonlySet<string>): string;
}

export function createLaneColorer(
  palette: readonly string[] = PALETTE,
): LaneColorer {
  /** colour → tick it was last handed out. Absent = never used. */
  const lastUsed = new Map<string, number>();
  let tick = 0;

  const take = (color: string): string => {
    lastUsed.set(color, tick++);
    return color;
  };

  return {
    pick(colorKey, activeColors) {
      const preferred = palette[fnv1a(colorKey) % palette.length]!;
      if (!activeColors.has(preferred)) return take(preferred);

      // Collision. Prefer an entry nobody is using; among those, the one used
      // longest ago (never-used counts as longest, hence -1). Only when every
      // entry is genuinely active do we accept a repeat.
      const free = palette.filter((c) => !activeColors.has(c));
      const pool = free.length > 0 ? free : palette;
      let best = pool[0]!;
      for (const c of pool) {
        if ((lastUsed.get(c) ?? -1) < (lastUsed.get(best) ?? -1)) best = c;
      }
      return take(best);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/laneColors.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/features/commits/laneColors.ts src/features/commits/laneColors.test.ts
git commit -m "feat(graph): hash-first lane colour picker with LRU collision break"
```

---

### Task 2: Wire the colorer into layoutGraph (G4)

**Files:**
- Modify: `src/features/commits/graphLayout.ts` (delete `PALETTE` at `:21-29` and `nextColor` at `:76-80`; edit birth sites at `:100-101` and `:144-146`)
- Test: `src/features/commits/graphLayout.test.ts` (append)

**Interfaces:**
- Consumes: `PALETTE`, `createLaneColorer` from Task 1.
- Produces: no signature change. `layoutGraph(commits, opts?)` still returns `{ rows, maxCol }`. Lane/node colours are now content-derived.

**Honest limitation to encode in the test (spec, G4):** colour is stable across filter changes only when the hashed preference is not already taken. #68's stronger claim — "colour unchanged when the same history is laid out as *any* subset" — does not hold in general, because a subset can change which colours are concurrently active and therefore which collisions break. The regression test below uses a deliberately collision-free fixture and asserts exactly that scope.

- [ ] **Step 1: Write the failing test**

Append to `src/features/commits/graphLayout.test.ts`:

```ts
describe("lane colours (#68 G4)", () => {
  it("never gives two concurrently-active lanes the same colour below 8-way concurrency", () => {
    // Seven independent roots → seven lanes alive at once, all in row 0's view.
    const commits = ["A", "B", "C", "D", "E", "F", "G"].map((n) =>
      c(n, [`${n}p`]),
    );
    const { rows } = layoutGraph(commits);

    // On the last row every lane that was ever born is either active or done;
    // check the widest row instead, where concurrency peaks.
    const widest = rows.reduce((a, b) => (b.lanes.length > a.lanes.length ? b : a));
    const colors = widest.lanes.map((l) => l.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("keeps a lane's colour when the same history is laid out as a subset", () => {
    // Collision-free by construction: one lane at a time, so the hashed
    // preference is never contended and colour is a pure function of identity.
    const full = [c("A", ["B"]), c("B", ["C"]), c("C", ["D"]), c("D", [])];
    const subset = [c("A", ["B"]), c("D", [])];

    const fullColor = layoutGraph(full).rows[0]!.node.color;
    // `ancestry` supplies the removed links so A still resolves toward D.
    const subsetColor = layoutGraph(subset, { ancestry: full }).rows[0]!.node.color;

    expect(subsetColor).toBe(fullColor);
  });

  it("draws every colour from the palette", () => {
    const { rows } = layoutGraph([c("A", ["B"]), c("B", [])]);
    for (const row of rows) {
      expect(PALETTE).toContain(row.node.color);
      for (const lane of row.lanes) expect(PALETTE).toContain(lane.color);
    }
  });
});
```

Add to that file's imports at the top:

```ts
import { PALETTE } from "./laneColors";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/graphLayout.test.ts`
Expected: FAIL on the subset test — the old counter makes colour depend on birth order, so a subset renumbers.

- [ ] **Step 3: Write minimal implementation**

In `src/features/commits/graphLayout.ts`:

1. Replace the local `PALETTE` const (`:21-29`) with an import at the top of the file:

```ts
import { createLaneColorer } from "./laneColors";
```

2. Replace `laneBirthCounter` (`:61`) and `nextColor` (`:76-80`) with:

```ts
  const colorer = createLaneColorer();

  /** Colours on screen right now — a collision only matters if it is visible. */
  const activeColors = (): Set<string> => {
    const s = new Set<string>();
    for (const a of active) if (a) s.add(a.color);
    return s;
  };
```

(and delete `let laneBirthCounter = 0;`)

3. At birth site 1 (`:100-101`), replace `nodeColor = nextColor();` with:

```ts
      nodeCol = allocSlot();
      // colorKey is the oid this lane awaits AT BIRTH — the branch-tip-ward
      // identity, uniform across the node-lane and fork-target cases, and more
      // stable under filtering than the birth commit's own oid. A root awaits
      // nothing; its own oid is unique and the lane dies on this row anyway.
      nodeColor = colorer.pick(resolved[0]?.oid ?? commit.oid, activeColors());
```

4. At birth site 2 (`:144-146`), replace `const color = nextColor();` with:

```ts
        const slot = allocSlot();
        const color = colorer.pick(link.oid, activeColors());
```

- [ ] **Step 4: Run the full suite to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/ src/design/`
Expected: PASS. Existing `graphLayout.test.ts` cases assert lane *kinds* and columns, not colour identity, so they are unaffected. If any existing case compares a whole lane object with `toEqual`, update that case to the new colour rather than reverting the algorithm.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/features/commits/graphLayout.ts src/features/commits/graphLayout.test.ts
git commit -m "fix(graph): colour lanes by identity, not birth order (#68 G4)"
```

---

### Task 3: Primary lane + HEAD node in the layout (G6/G7, layout half)

**Files:**
- Modify: `src/design/git-components.tsx` (`GraphLane` at `:888-900`, `GraphNode` at `:902-913` — types only in this task)
- Modify: `src/features/commits/graphLayout.ts` (`ActiveLane` at `:10-19`, emission at `:108-210`)
- Test: `src/features/commits/graphLayout.test.ts` (append)

**Interfaces:**
- Consumes: `LayoutOptions.headOid` (already declared at `graphLayout.ts:38-42` — this task is what it was reserved for).
- Produces: `GraphLane.primary?: boolean` and `GraphNode.head?: boolean`, both **omitted when false** so existing lane/node object shapes are unchanged. Task 5 and Task 6 render them.

**Why in the layout and not in History:** the first parent always continues in its node's lane, so marking HEAD's lane at the node and carrying the flag on `ActiveLane` propagates it down the first-parent chain automatically. Post-processing in History would have to re-walk ancestry it does not own.

- [ ] **Step 1: Write the failing test**

Append to `src/features/commits/graphLayout.test.ts`:

```ts
describe("HEAD emphasis (#68 G6/G7)", () => {
  const chain = [c("A", ["B"]), c("B", ["C"]), c("C", [])];

  it("marks the HEAD commit's node", () => {
    const { rows } = layoutGraph(chain, { headOid: "A" });
    expect(rows[0]!.node.head).toBe(true);
    expect(rows[1]!.node.head).toBeFalsy();
  });

  it("propagates primary down the first-parent chain", () => {
    const { rows } = layoutGraph(chain, { headOid: "A" });
    // Every row below HEAD is on its first-parent chain, so every lane there
    // is the primary lane.
    for (const row of rows) {
      expect(row.lanes.every((l) => l.primary)).toBe(true);
    }
  });

  it("leaves a merge's second-parent lane unemphasised", () => {
    // M is HEAD; T is first parent (same lane), F is the merged-in side.
    const { rows } = layoutGraph(
      [c("M", ["T", "F"]), c("T", ["R"]), c("F", ["R"]), c("R", [])],
      { headOid: "M" },
    );
    const forkBot = rows[0]!.lanes.find((l) => l.kind === "fork-bot")!;
    expect(forkBot.primary).toBeFalsy();
    // F's own row sits on the non-primary lane.
    expect(rows[2]!.lanes.some((l) => l.primary)).toBe(false);
  });

  it("marks nothing when headOid is absent (detached HEAD)", () => {
    const { rows } = layoutGraph(chain);
    expect(rows.every((r) => !r.node.head)).toBe(true);
    expect(rows.every((r) => r.lanes.every((l) => !l.primary))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/graphLayout.test.ts`
Expected: FAIL — `node.head` is `undefined` and `lane.primary` does not exist.

- [ ] **Step 3: Write minimal implementation**

**3a.** In `src/design/git-components.tsx`, add to `GraphLane` (after `dashed`, `:899`):

```ts
  /**
   * This segment is on HEAD's first-parent chain. Drawn heavier so the branch
   * you are actually on is followable at a glance (#68 G6).
   */
  primary?: boolean;
```

and to `GraphNode` (after `truncated`, `:912`):

```ts
  /** This commit is HEAD. Drawn as a double ring (#68 G7). */
  head?: boolean;
```

**3b.** In `src/features/commits/graphLayout.ts`, add to `ActiveLane` (after `dashed`, `:18`):

```ts
  /** Lane carries HEAD's first-parent chain. Inherited when a node adopts it. */
  primary: boolean;
```

**3c.** Inside the `for (const commit of commits)` loop, after `const trueParents = …` (`:87`):

```ts
    const isHead = opts?.headOid !== undefined && commit.oid === opts.headOid;
```

**3d.** Compute the node lane's emphasis right after `nodeCol`/`nodeColor` are resolved (after the `if/else` ending at `:106`):

```ts
    // HEAD starts the chain; below it, the flag rides the lane the node adopts.
    const nodePrimary =
      isHead || (awaiting.length > 0 && active[nodeCol]!.primary);
```

**3e.** Carry `primary` through the top-of-row snapshot (`:111-112`):

```ts
    const lanesAtTop: Array<
      { col: number; color: string; dashed: boolean; primary: boolean } | null
    > = active.map((a, i) =>
      a ? { col: i, color: a.color, dashed: a.dashed, primary: a.primary } : null,
    );
```

**3f.** Set it when the node's lane continues (`:118-122`):

```ts
      active[nodeCol] = {
        awaitingOid: resolved[0]!.oid,
        color: nodeColor,
        dashed: resolved[0]!.elided,
        primary: nodePrimary,
      };
```

**3g.** Fork targets are never on the first-parent chain (`:133-148`) — add `primary: false` to the new `ActiveLane` and drop it from the emitted curve:

```ts
        active[slot] = {
          awaitingOid: link.oid,
          color,
          dashed: link.elided,
          primary: false,
        };
```

**3h.** Emit the flag, omitting it when false so lane objects stay minimal. Each of the five `lanes.push({…})` calls gains a spread. For the two half-lanes at `nodeCol` (`:160-163`):

```ts
        if (top)
          lanes.push({
            col,
            color: top.color,
            kind: "half-top",
            dashed: top.dashed,
            ...(top.primary && { primary: true }),
          });
        if (bot)
          lanes.push({
            col,
            color: bot.color,
            kind: "half-bot",
            dashed: bot.dashed,
            ...(bot.primary && { primary: true }),
          });
```

For `merge-top` (`:168-174`) and the pass-through `line` (`:180`), add `...(top.primary && { primary: true })` the same way. The `fork-bot` push (`:190-196`) gets nothing — it is by definition not the first-parent chain.

**3i.** Flag the node (`:204-210`):

```ts
    const node: GraphNode = {
      col: nodeCol,
      color: nodeColor,
      solid: trueParents.length <= 1,
      merge: trueParents.length >= 2,
      truncated: !isRoot && resolved.length === 0,
      ...(isHead && { head: true }),
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/features/commits/`
Expected: PASS.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/design/git-components.tsx src/features/commits/graphLayout.ts src/features/commits/graphLayout.test.ts
git commit -m "feat(graph): mark HEAD's node and first-parent lane (#68 G6/G7)"
```

---

### Task 4: History passes headOid

**Files:**
- Modify: `src/screens/History.tsx:185-188`
- Test: `src/screens/History.graph.test.tsx` (append)

**Interfaces:**
- Consumes: `LayoutOptions.headOid` (Task 3), `currentBranch(branches)` from `@/lib/derive`, `BranchInfo.tip: string | null` from `@/lib/types`.
- Produces: nothing new — this is the wiring that makes Tasks 5/6 visible in the app.

**Note:** `currentBranch` finds the branch with `isHead`. On a **detached HEAD** there is none, so `headOid` is `undefined` and the graph simply renders no emphasis — the Task 3 test "marks nothing when headOid is absent" covers exactly that path.

- [ ] **Step 1: Write the failing test**

Append to `src/screens/History.graph.test.tsx`:

```ts
  it("marks HEAD's commit in the graph gutter", async () => {
    primeStore({
      branches: [
        {
          name: "main",
          isHead: true,
          isRemote: false,
          upstream: null,
          ahead: 0,
          behind: 0,
          tip: oid("a"),
        },
      ],
    });
    const { container } = render(<HistoryScreen />);
    await waitFor(() => {
      expect(container.querySelector('[data-graph-head="true"]')).not.toBeNull();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/screens/History.graph.test.tsx`
Expected: FAIL — History does not pass `headOid`, and Task 6 has not added the marker element yet. Both are required; this test stays red until Task 6.

- [ ] **Step 3: Write minimal implementation**

In `src/screens/History.tsx`, extend the memo at `:185-188` (`head` is already in scope at `:144`):

```tsx
  const { rows, maxCol } = React.useMemo(
    () => layoutGraph(visible, { ancestry, headOid: head?.tip ?? undefined }),
    [visible, ancestry, head?.tip],
  );
```

- [ ] **Step 4: Run test to confirm it still fails for the RIGHT reason**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/screens/History.graph.test.tsx`
Expected: still FAIL on the missing `[data-graph-head="true"]` element only — the other four cases in this file must stay green. Task 6 closes it.

- [ ] **Step 5: Commit the wiring**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/screens/History.tsx src/screens/History.graph.test.tsx
git commit -m "feat(graph): feed HEAD's oid into the History layout (#68 G6/G7)"
```

---

### Task 5: Draw order, casing strokes, primary weight (G6, render half)

**Files:**
- Modify: `src/design/git-components.tsx:943-1027` (the `lanes.map` inside `PGGraphRow`)
- Test: `src/design/git-components.graph.test.tsx` (append)

**Interfaces:**
- Consumes: `GraphLane.primary` (Task 3).
- Produces: rendered DOM contract — casing paths carry `data-lane-casing="true"`, coloured strokes keep `data-lane-kind`. Straight kinds (`line`, `half-top`, `half-bot`) render before curve kinds (`fork-bot`, `merge-top`) in document order.

**Why order matters:** the casing is a wider `var(--bg-0)` stroke drawn *under* each curve's coloured stroke. SVG has no z-index — paint order is document order — so every straight lane must already be on the canvas for a later curve's casing to punch a visible gap through it.

- [ ] **Step 1: Write the failing test**

Append to `src/design/git-components.graph.test.tsx`:

```ts
describe("PGGraphRow crossings and emphasis (#68 G6)", () => {
  it("draws every straight lane before any curve, so casings can bridge them", () => {
    const svg = renderGraph(
      [
        { col: 1, color: "blue", kind: "fork-bot", to: 2 },
        { col: 0, color: "red", kind: "line" },
      ],
      undefined,
      2,
    );
    const kinds = [...svg.querySelectorAll("[data-lane-kind]")].map((el) =>
      el.getAttribute("data-lane-kind"),
    );
    expect(kinds).toEqual(["line", "fork-bot"]);
  });

  it("puts a background casing under each curve", () => {
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "fork-bot", to: 1 }],
      undefined,
      1,
    );
    const casing = svg.querySelector('[data-lane-casing="true"]')!;
    expect(casing).not.toBeNull();
    // Wider than the stroke it protects, and painted in the row background.
    expect(Number(casing.getAttribute("stroke-width"))).toBeGreaterThan(1.5);
    expect(casing.getAttribute("stroke")).toBe("var(--bg-0)");
    // Immediately precedes its coloured stroke in paint order.
    expect(casing.nextElementSibling!.getAttribute("data-lane-kind")).toBe("fork-bot");
  });

  it("does not dash the casing of an elided curve", () => {
    // The casing is a gap, not a line — dashing it would let the lane beneath
    // show through the gaps and defeat the bridge.
    const svg = renderGraph(
      [{ col: 0, color: "red", kind: "fork-bot", to: 1, dashed: true }],
      undefined,
      1,
    );
    const casing = svg.querySelector('[data-lane-casing="true"]')!;
    expect(casing.getAttribute("stroke-dasharray")).toBeNull();
  });

  it("gives no casing to straight lanes", () => {
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    expect(svg.querySelector('[data-lane-casing="true"]')).toBeNull();
  });

  it("weights a primary lane heavier than an ordinary one", () => {
    const plain = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    const head = renderGraph([{ col: 0, color: "red", kind: "line", primary: true }]);
    const w = (svg: SVGElement) =>
      Number(svg.querySelector("[data-lane-kind]")!.getAttribute("stroke-width"));
    expect(w(head)).toBeGreaterThan(w(plain));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.graph.test.tsx`
Expected: FAIL — no `[data-lane-casing]` element exists and lanes render in input order.

- [ ] **Step 3: Write minimal implementation**

In `src/design/git-components.tsx`, replace the whole `{lanes.map(…)}` block (`:949-1027`) with the following. Add the two helpers just above the `PGGraphRow` function, next to `ELIDED_DASH` (`:886`):

```tsx
/** Stroke weight: HEAD's first-parent chain is followable at a glance (#68 G6). */
const strokeW = (ln: GraphLane): number => (ln.primary ? 2 : 1.5);

/** Extra width of the background casing drawn under a curve. */
const CASING_EXTRA = 2.5;

const STRAIGHT_KINDS: ReadonlySet<GraphLane["kind"]> = new Set([
  "line",
  "half-top",
  "half-bot",
]);

/** y-extent of each straight kind, in SVG user units. */
const straightY = (
  kind: GraphLane["kind"],
  height: number,
): [number, number] => {
  if (kind === "half-top") return [0, height / 2];
  if (kind === "half-bot") return [height / 2, height];
  return [0, height];
};

/** Curve path for the two bezier kinds. Shared by the casing and the stroke. */
const curvePath = (ln: GraphLane, height: number): string => {
  const x = laneX(ln.col);
  const x2 = laneX(ln.to ?? ln.col + 1);
  return ln.kind === "fork-bot"
    ? `M ${x} ${height / 2} C ${x} ${height * 0.75}, ${x2} ${height * 0.75}, ${x2} ${height}`
    : `M ${x} 0 C ${x} ${height * 0.25}, ${x2} ${height * 0.25}, ${x2} ${height / 2}`;
};
```

Then the render body:

```tsx
      {/* Straights first: SVG paint order is document order, so every vertical
          must be on the canvas before a curve's casing can bridge across it. */}
      {lanes
        .filter((ln) => STRAIGHT_KINDS.has(ln.kind))
        .map((ln, i) => {
          const x = laneX(ln.col);
          const [y1, y2] = straightY(ln.kind, height);
          return (
            <line
              key={`s${i}`}
              data-lane-kind={ln.kind}
              x1={x}
              x2={x}
              y1={y1}
              y2={y2}
              stroke={ln.color}
              strokeWidth={strokeW(ln)}
              strokeDasharray={ln.dashed ? ELIDED_DASH : undefined}
              shapeRendering="crispEdges"
            />
          );
        })}
      {/* Then each curve as casing + stroke. The casing is a gap punched in
          whatever it crosses, so it is never dashed. */}
      {lanes
        .filter((ln) => !STRAIGHT_KINDS.has(ln.kind))
        .map((ln, i) => {
          const d = curvePath(ln, height);
          return (
            <React.Fragment key={`c${i}`}>
              <path
                data-lane-casing="true"
                d={d}
                stroke="var(--bg-0)"
                strokeWidth={strokeW(ln) + CASING_EXTRA}
                fill="none"
              />
              <path
                data-lane-kind={ln.kind}
                d={d}
                stroke={ln.color}
                strokeWidth={strokeW(ln)}
                strokeDasharray={ln.dashed ? ELIDED_DASH : undefined}
                fill="none"
              />
            </React.Fragment>
          );
        })}
```

`shapeRendering="crispEdges"` on the straights is Task 7's G8 requirement, folded in here because it lands on the same JSX element and splitting it would mean editing the line twice.

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.graph.test.tsx`
Expected: PASS, including the pre-existing G1/G2 cases. The "dashes an elided half-lane and an elided curve alike" case still finds two dashed elements — the casing adds an element but carries no `stroke-dasharray`.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/design/git-components.tsx src/design/git-components.graph.test.tsx
git commit -m "feat(graph): bridge crossings with casing strokes, weight HEAD's lane (#68 G6)"
```

---

### Task 6: HEAD double-ring marker (G7-partial)

**Files:**
- Modify: `src/design/git-components.tsx:1028-1066` (the `{node && …}` block)
- Test: `src/design/git-components.graph.test.tsx` (append)

**Interfaces:**
- Consumes: `GraphNode.head` (Task 3), `headOid` wiring (Task 4).
- Produces: `[data-graph-head="true"]` on the outer ring — the selector Task 4's History test waits for.

**Vocabulary stays small:** hollow / solid / merge / HEAD. Tags and remotes stay in the subject column, where a pill already does the job better than a dot shape could.

- [ ] **Step 1: Write the failing test**

Append to `src/design/git-components.graph.test.tsx`:

```ts
describe("PGGraphRow HEAD marker (#68 G7)", () => {
  const node = (over: Partial<GraphNode> = {}): GraphNode => ({
    col: 0,
    color: "red",
    solid: true,
    ...over,
  });

  it("rings the HEAD commit", () => {
    const svg = renderGraph([], node({ head: true }));
    const ring = svg.querySelector('[data-graph-head="true"]')!;
    expect(ring).not.toBeNull();
    // Outer ring sits outside the r=4 dot.
    expect(Number(ring.getAttribute("r"))).toBeGreaterThan(4);
    expect(ring.getAttribute("fill")).toBe("none");
  });

  it("leaves an ordinary commit unringed", () => {
    const svg = renderGraph([], node());
    expect(svg.querySelector('[data-graph-head="true"]')).toBeNull();
  });

  it("rings a merge commit that is also HEAD", () => {
    const svg = renderGraph([], node({ solid: false, merge: true, head: true }));
    expect(svg.querySelector('[data-graph-head="true"]')).not.toBeNull();
  });

  it("centres the ring on the node's lane", () => {
    const svg = renderGraph([], node({ col: 2, head: true }), 2);
    const ring = svg.querySelector('[data-graph-head="true"]')!;
    expect(Number(ring.getAttribute("cx"))).toBe(laneX(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.graph.test.tsx`
Expected: FAIL — no `[data-graph-head]` element.

- [ ] **Step 3: Write minimal implementation**

In `src/design/git-components.tsx`, inside the `{node && (<>…</>)}` block, add the ring as the **first** child (before the existing `r="4"` circle at `:1030`) so the dot and any merge fill paint over it:

```tsx
          {/* HEAD: a double ring. The outer circle sits outside the dot rather
              than replacing it, so hollow / solid / merge stay readable. */}
          {node.head && (
            <circle
              data-graph-head="true"
              cx={laneX(node.col)}
              cy={height / 2}
              r="6.5"
              fill="none"
              stroke={node.color}
              strokeWidth="1"
            />
          )}
```

- [ ] **Step 4: Run the affected suites to verify they pass**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.graph.test.tsx src/screens/History.graph.test.tsx`
Expected: PASS — including Task 4's "marks HEAD's commit in the graph gutter", which goes green here because the wiring and the marker are now both in place.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/design/git-components.tsx src/design/git-components.graph.test.tsx
git commit -m "feat(graph): ring the HEAD commit's node (#68 G7)"
```

---

### Task 7: SVG a11y + the last colour literal (G8 + G5 leftover)

**Files:**
- Modify: `src/design/git-components.tsx:944-948` (the `<svg>` element), `:1053-1063` (the truncated stub), `:1170` (`PGCommitRow` border)
- Test: `src/design/git-components.graph.test.tsx` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new. Purely attribute-level.

**Two things, one task:** both are one-line attribute edits inside the component this phase is already rewriting, and neither is independently reviewable in a meaningful way. The border literal is the adjacent hardcode the spec explicitly folded into this phase's G5 section — the graph row's last dark-calibrated colour, which would stay wrong on every light theme now that `--graph-*` is remapped per mode.

- [ ] **Step 1: Write the failing test**

Append to `src/design/git-components.graph.test.tsx`:

```ts
describe("PGGraphRow accessibility (#68 G8)", () => {
  it("hides the gutter from assistive tech", () => {
    // A screen reader walking a 500-row log would otherwise hit 500 unlabeled
    // graphics that add nothing over the sha / subject / author already in the row.
    const svg = renderGraph([{ col: 0, color: "red", kind: "line" }]);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("snaps straight lanes to whole pixels but leaves curves antialiased", () => {
    const svg = renderGraph(
      [
        { col: 0, color: "red", kind: "line" },
        { col: 0, color: "red", kind: "fork-bot", to: 1 },
      ],
      undefined,
      1,
    );
    expect(
      svg.querySelector('[data-lane-kind="line"]')!.getAttribute("shape-rendering"),
    ).toBe("crispEdges");
    expect(
      svg.querySelector('[data-lane-kind="fork-bot"]')!.getAttribute("shape-rendering"),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/git-components.graph.test.tsx`
Expected: FAIL on the `aria-hidden` case. The `crispEdges` case already passes — Task 5 added it on the straights.

- [ ] **Step 3: Write minimal implementation**

**3a.** The `<svg>` open tag (`:944-948`):

```tsx
    <svg
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: "block" }}
    >
```

**3b.** The truncated stub is a `<line>` too — give it the same treatment (`:1053-1063`), adding `shapeRendering="crispEdges"` after `strokeDasharray="2 2"`.

**3c.** `PGCommitRow`'s border (`:1170`) — replace the dark literal:

```tsx
        borderBottom: "1px solid oklch(from var(--border-0) l c h / 0.5)",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run src/design/`
Expected: PASS, including `git-components.density.test.tsx`.

- [ ] **Step 5: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
git add src/design/git-components.tsx src/design/git-components.graph.test.tsx
git commit -m "fix(graph): hide the gutter from screen readers, drop a dark literal (#68 G8)"
```

---

### Task 8: Full verification

**Files:** none — this task only runs gates.

- [ ] **Step 1: Full unit suite**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test --run`
Expected: PASS. Baseline before this plan is 517 tests / 63 files; this plan adds 3 files' worth of cases and no removals, so the count must be strictly higher and the failure count zero.

- [ ] **Step 2: Type gates, both projects**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```
Expected: both clean, no output.

- [ ] **Step 3: Rust unchanged**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean. No Rust file is touched by this plan; this is a guard against an accidental edit.

- [ ] **Step 4: E2E, headless in Docker**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test:e2e:docker full --spec e2e/specs/history-diff.e2e.ts`
Expected: 4/4 passing. **Docker, never a native macOS run** — a native run needs foreground window focus and can attach to another worktree's binary on port 4445. `history-diff` is the spec that exercises the graph gutter; it is the one that would catch a broken row grid.

- [ ] **Step 5: Squash and open the PR**

```bash
git fetch origin && git rebase origin/main
git reset --soft origin/main
git commit -m "$(cat <<'EOF'
feat(graph): commit graph v2 phase 2+3 — lane colour, crossings, HEAD, a11y (#68)

G4: lane colour is now a hash of the lane's identity with an LRU collision
break, so a filter change no longer repaints the graph and two visible lanes
cannot share a colour below 8-way concurrency.
G6: curves draw over a background casing stroke, bridging crossings; HEAD's
first-parent chain renders at 2px.
G7 (partial): HEAD's node gets a double ring. Dimming stays dropped per spec.
G8: crispEdges on straight lanes only, and the gutter is aria-hidden.

Also folds in the graph row's last dark-calibrated colour literal, which the
spec attached to G5.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin feat/graph-v2-phase23
gh pr create --draft --title "feat(graph): commit graph v2 phase 2+3 (#68)" --body "…"
```

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Task |
|---|---|
| G4 hash-first + LRU collision break, `colorKey` = oid awaited at birth | 1, 2 |
| G4 honest limitation stated in its own test | 2 (collision-free fixture, asserted scope) |
| G5 per-theme graph tokens | **already landed** (#73) — recorded as out of scope |
| G5 folded-in `PGCommitRow` border literal | 7 |
| G6 draw order: straights, then casing + stroke per curve | 5 |
| G6 `GraphLane.primary` → 2px, set from `headOid` in the layout | 3, 5 |
| G7 `GraphNode.head` → double ring, small vocabulary | 3, 6 |
| G7 dimming dropped | recorded, not implemented |
| G8 `crispEdges` on `<line>` only | 5 (straights), 7 (stub) |
| G8 no 0.5px offset | Global Constraints |
| G8 `aria-hidden` + `focusable="false"` | 7 |

No spec requirement for Phase 2/3 is unassigned.

**2. Placeholder scan.** Every code step carries real code. The one `…` is the `gh pr create --body`, which is written from the actual diff at that point rather than guessed now.

**3. Type consistency.** `GraphLane.primary?: boolean` and `GraphNode.head?: boolean` are declared once (Task 3) and consumed with those exact names in Tasks 5 and 6. `createLaneColorer` / `PALETTE` / `fnv1a` are defined in Task 1 and imported under those names in Task 2. `LaneColorer.pick(colorKey, activeColors)` keeps its two-argument shape at both call sites. `strokeW`, `curvePath`, `straightY`, `STRAIGHT_KINDS`, `CASING_EXTRA` are all introduced in Task 5 and used only there and in Task 7. `data-lane-casing` / `data-graph-head` are the two new DOM selectors, each asserted in the task that creates it — `data-graph-head` is written in Task 6 and depended on by Task 4's test, which is why Task 4's step 4 expects a still-red test.

**Known cross-task dependency:** Task 4's test is deliberately red until Task 6 lands. Executing them out of order will look like a regression. This is flagged in both tasks.
