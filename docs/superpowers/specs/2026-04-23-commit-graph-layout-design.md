# Commit graph layout — design

**Status:** approved
**Date:** 2026-04-23
**Owner:** jonas
**Related:** `docs/superpowers/specs/2026-04-21-platypusgit-scaffold-design.md`

## Why

The History screen currently renders every commit on column 0 with a tiny diagonal hint for merge commits. Because the stub has no cross-row state, the second parent of every merge commit curves off into empty space — it never actually connects down to the branch it came from. Multi-branch histories (parallel work, feature branches, unmerged heads) look identical to linear histories.

The goal is a JetBrains-style commit graph: each live branch occupies a stable vertical lane, parents and children connect visually, merge commits visibly fork out and rejoin. The existing `PGGraphRow` primitive already supports multi-column lanes and merge nodes; the missing piece is a layout pass that computes `GraphLane[]` + `GraphNode` per row with awareness of the full visible commit list.

## Scope

### In scope

- A pure TypeScript layout function that, given the visible commit list, returns per-row lane information.
- Support for the full range of topologies the backend can produce: linear history, standard two-parent merges, octopus merges (3+ parents), multiple unmerged branch tips simultaneously visible, multiple roots, a commit with multiple children (branch-point / re-join).
- Stable per-lane colors drawn from the existing `--graph-1…N` palette.
- Two new lane kinds in `PGGraphRow` to render curves that start or end at node-level: `fork-bot` (from node mid-row to a column at bottom) and `merge-top` (from a column at top to node mid-row).
- Slot reuse: when a lane dies its column is freed and may be occupied by a later-opening lane, so graph width stays bounded.
- Unit tests covering each topology class above.

### Out of scope

- Topological reordering of commits. Layout consumes whatever order `get_log` returns and does not attempt to straighten history.
- Filter-aware ghosting. When the user filters the commit list, filtered-out commits simply disappear from the graph; we do not draw partial ancestry through hidden rows.
- Rendering pass performance optimisation for very large histories (> 50k commits). The algorithm is O(n × active-lanes); if that becomes a bottleneck we migrate the pass to Rust in a later spec.
- Interactions on graph elements (hover tooltips on lanes, click a lane to filter to a branch, etc.). Pure visual fix only.

## Architecture

### Layout algorithm

A single top-to-bottom pass over the visible commit list. State: `activeLanes: Array<{ awaitingOid: string; color: string } | null>`, indexed by column. `null` entries are freed slots available for reuse.

For each commit in order:

1. **Find the target lane.** Scan `activeLanes` for entries whose `awaitingOid` equals this commit's OID.
   - If one or more matches exist, the leftmost match is the **node's lane**. Every other matching lane **collapses** into the node's lane this row (rendered as a `merge-top` curve from that lane's column → node).
   - If no match exists, the commit is a new root / branch tip visible at the top of the view. Allocate a new slot (leftmost `null`, or append if none free), assign a color from the palette by next-available index, and use it as the node's lane.
2. **Continue the first parent.** If the commit has ≥ 1 parent, replace `activeLanes[nodeCol]` with `{ awaitingOid: firstParent, color: sameColor }`. The commit keeps the lane going down. If the commit has zero parents (initial commit), free the slot.
3. **Place additional parents** (for merge commits). For each remaining parent `P`:
   - If some other lane already awaits `P`, re-use it (no new slot): draw a `fork-bot` curve from node → that lane's column.
   - Otherwise allocate a new slot with a fresh color and make it await `P`: draw a `fork-bot` curve from node → the new slot's column.
4. **Emit row lanes.** For every slot that is live either at the top or bottom of this row (or both), emit a `GraphLane` describing how it renders:
   - Pass-through (not involved in this commit): `line` — full-height vertical at its column.
   - Lane that died at the node (top-only, collapsed in): `merge-top` — curve from column at top to node.
   - Lane that started at the node (bottom-only, forked out): `fork-bot` — curve from node to column at bottom. If the "new" lane is actually the node's own column continuing down as first parent, use `half-bot` (straight, not curve).
   - Lane that both enters at top and exits at bottom in the same column as the node: combine `half-top` (top → node) and `half-bot` (node → bottom) — i.e. a straight line passing through the node.

The **row's `GraphNode`** lives at the node's lane column, with the lane's color, `merge: true` iff the commit has ≥ 2 parents, `solid: true` iff it has ≤ 1 parent.

### Colors

The palette is whatever `--graph-1` through `--graph-N` resolve to in `src/index.css`. Lane color index = `(laneBirthCounter) mod N`. `laneBirthCounter` increments every time a new slot is allocated (not reset on slot reuse, so consecutive branches get visually distinct colors even when they land in the same column).

### Primitive extensions

`src/design/git-components.tsx` — `GraphLane.kind` gains two values:

- `fork-bot`: cubic bezier from `(nodeX, height/2)` to `(toX, height)`. Start horizontal-ish, end vertical — mirrors the existing `diag` shape but begins mid-row.
- `merge-top`: cubic bezier from `(fromX, 0)` to `(nodeX, height/2)`. Mirror of `fork-bot`, top half only.

Control points use the same style the existing `diag` uses (quarter-height vertical pull from each endpoint) so curves look consistent across the three variants.

`PGGraphRow` handles the two new kinds in its `lanes.map` switch. No change to `GraphNode`.

### Where the code lives

```
src/features/commits/
  graphLayout.ts        NEW — pure function layoutGraph(commits) → GraphRow[]
  graphLayout.test.ts   NEW — vitest coverage for each topology class

src/design/git-components.tsx  — extend GraphLane kind + PGGraphRow renderer

src/screens/History.tsx        — delete inline buildLanes; call layoutGraph
                                  once via useMemo over visible commits
```

A `GraphRow` is `{ lanes: GraphLane[]; node: GraphNode }` — exactly the shape `PGCommitRow` already consumes.

### Data flow

`useRepoStore.commits` (typed `CommitInfo[]`) → filtered into `visible` in `HistoryScreen` → `layoutGraph(visible)` memoised on `visible` identity → indexed by row in the existing `visible.map` render loop.

No changes to Rust, no changes to `CommitInfo` shape.

## Edge cases and how they are handled

| Topology | What the algorithm does |
|---|---|
| Linear history | Single lane, straight `line` throughout. Node is `solid`. |
| Two-parent merge (feature branch rejoins main) | Merge row: node on main lane, `fork-bot` to a new lane for the second parent, `half-bot` continuing main down. Branch tip row (further down): `merge-top` collapsing the side lane into the branch-point commit's lane. |
| Octopus merge (N ≥ 3 parents) | One `fork-bot` per additional parent, each to its own slot. Node is `merge`. |
| Unmerged parallel branch tips | Each tip opens its own slot at the row it first appears. Slots run down independently until their branch point (where they collapse) or off the bottom of the view. |
| Commit with multiple visible children (branch point) | Multiple lanes all await this OID. All but the leftmost render `merge-top` into the node; leftmost renders `half-top`. First parent continues from the node. |
| Initial commit (zero parents) | Node is `solid`, lane frees its slot afterwards. No `half-bot`. |
| Multiple roots visible | Each initial commit frees its slot; subsequent new branch tips may reuse those slots, so width stays bounded. |
| Filtered list where a parent is hidden | The child's lane simply runs off the bottom (its `awaitingOid` is never reached within the visible window). Rendered as a continuing `line` — visually indistinguishable from "off-screen parent," which is the desired behavior. |

## Testing

`graphLayout.test.ts` uses hand-constructed fake `CommitInfo[]` fixtures, one per topology class in the table above. Each test asserts the full `GraphRow[]` output, so regressions in any lane kind, column assignment, or color shift are caught.

A small helper renders a `GraphRow[]` as ASCII for diff-friendly assertions (e.g. `"*─╮"` for a merge with fork). Optional but cheap to add and makes test failures readable.

No backend tests (pure frontend change).

## Open questions

None at time of writing — both design decisions flagged during brainstorming (TS layout, two new lane kinds) are confirmed.
