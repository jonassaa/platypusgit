# Commit graph v2 — design

**Status:** approved
**Date:** 2026-08-11
**Owner:** jonas
**Related:** issue #68 (source). Overlaps cross-referenced, not restated: #61 B4
(`applyTheme` token remap) ⊃ G5, #61 A8 (list virtualization) ⊃ G10. Builds on
#70/PR #71 (`fd0c687`), which landed the density groundwork this spec depends on.

## Why

The commit graph in History is a competent hand-rolled lane engine — correct on
linear history, merges, octopus merges, and slot reuse. What it lacks is any
concept of its own *boundaries*:

- It clips silently past lane 8. An SVG element is a viewport, so a repo with
  9+ concurrent branches renders a graph quietly missing lanes, and a commit
  whose node sits in a clipped column shows **no dot at all**.
- It has no concept of a commit whose parent isn't in the visible set. Search
  for two commits on the same branch and they don't share a lane; instead each
  hit trails a phantom lane to the bottom of the log — an edge to a commit that
  will never appear.

Both are wrong-pixels bugs. Beyond them: lane colors collide and drift as
filters change, light themes render the graph in dark-mode oklch values,
crossings are untraceable, nothing is memoized or virtualized, and history past
500 commits is unreachable.

## Decisions (user-confirmed)

1. **Full scope.** All 11 items (G1–G11), delivered as five sequenced PRs.
2. **G2 is frontend-only.** Parent rewriting happens in `layoutGraph` against
   the already-loaded commit window, not via a backend `graphParents` wire
   change. Rationale in "Corrections to #68" below.
3. **G7 ships the HEAD marker; search-dimming is dropped.** Search remains a
   filter, and G2's dashed elision is the search story.

## Corrections to #68

The issue is the source of truth for *what* is broken. Three of its *how*s are
wrong, verified against `1dddff3`/`fd0c687`.

### G2 does not belong in the backend

#68 routes G2 through a parent-rewrite in `get_log_filtered`. That is both
incomplete and unnecessary.

**Incomplete.** Only text/author/path/date/sha filtering is backend-side.
`mine`, `branch`, and `hideMerges` are *client-side* refinements applied to
`baseCommits` (`History.tsx:157-167`). A backend rewrite leaves all three still
emitting phantom lanes.

**Unnecessary.** The ancestry needed to join two same-branch hits is already on
the client. `useRepoStore` holds the unfiltered log in `commits` (500, scoped by
`logRef`) *alongside* `searchResults`, and History picks between them:

```ts
const baseCommits = searchActive ? (searchResults ?? []) : commits;  // History.tsx:101
```

So a rewrite in `layoutGraph` against `commits ∪ searchResults` fixes **every**
filter path at once — backend search and the three client-side refinements —
with no Rust change, no `CommitInfo` churn, and no `types.rs` ⇄ `lib/types.ts`
sync. Effort drops from L to M.

**And the backend cost was understated.** #68 claims "one `HashMap` entry per
commit walked, O(N) total". The walk is `Sort::TIME | Sort::TOPOLOGICAL` and
`break`s at `limit` (`libgit2.rs:1052-1055`), so parents are reached *after*
their children. Resolving rewrites bottom-up therefore requires a pass over the
whole reachable history, not the 500-commit window — a full-history walk per
keystroke on a large repo.

**Degradation.** When a filtered hit's elided span reaches outside the loaded
window, no visible ancestor is found and the lane terminates as `truncated`.
That is correct, cheap, and shrinks as G11's pagination extends the window.

### G7's dimming contradicts G2

G7 asks to dim non-matching rows during search. Non-matching rows are not
rendered — `visible` *is* the match set (`History.tsx:157`). G2's entire
dashed-elision design exists *because* search removes rows. Search cannot
simultaneously filter (G2) and display dimmed non-matches (G7).

Resolved per decision 3: HEAD marker ships, dimming is dropped and recorded as
a deliberate descope. It becomes meaningful only if search later becomes
highlight-in-place, which is a separate UX change.

### G10's row-height dependency is already satisfied

#68 says "fixed 26px row height makes this straightforward". It wasn't fixed —
`applyDensity` moved rows while `PGCommitRow` hardcoded `height: 26`. #70/PR #71
(`fd0c687`) fixed exactly this and exported the pieces virtualization needs:

- `COMMIT_ROW_BASE_H = 26` (`git-components.tsx:1049`)
- `useDensityStep(): number` (`useSettingsStore.ts:754`)
- `PGGraphRow.height` is now **required**, with a comment explaining that lane
  geometry is in SVG user units and cannot read `--row-step`.

So row pitch is `COMMIT_ROW_BASE_H + useDensityStep()`. No new mechanism needed;
G10 must not reintroduce a hardcoded 26.

### G10 breaks six e2e spec files

Not mentioned in #68. Six spec files select commit rows by visible text
(`[data-testid="commit-row"]*=feat: add b.txt`): `history-diff`, `reflog`,
`keymap`, `palette`, `rebase`, `history-ops`. Windowing unmounts off-screen
rows, so every one of those selectors fails for a row below the fold.

`history-diff.e2e.ts:25` additionally asserts an **exact** count, which
virtualization breaks unconditionally:

```ts
async () => (await $$('[data-testid="commit-row"]').length) === expected
```

The e2e migration is **inside** G10's PR, not a follow-up.

## Architecture

Five phases, ordered by real dependency rather than #68's tiers. G2 comes first
because freeing stuck lanes shrinks lane count and relieves G1's clipping.

---

## Phase 1 — correctness (G2, G1, G3)

### Layout API change

`layoutGraph` gains options and returns a record instead of a bare array. One
production call site (`History.tsx:169`) plus the test file.

```ts
export interface LayoutOptions {
  /**
   * Ancestry pool for parent rewriting: every commit the store knows for this
   * log scope — `commits ∪ searchResults`. Union, not just `commits`: search
   * hits carry their own true `parents` and extend the map's reach past the
   * unfiltered window.
   */
  ancestry?: readonly CommitInfo[];
  /** HEAD's oid, when visible — marks the primary lane (G6, phase 3). */
  headOid?: string;
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Highest lane/node column used by any row. 0 for a single-lane log. */
  maxCol: number;
}

export function layoutGraph(
  commits: readonly CommitInfo[],
  opts?: LayoutOptions,
): GraphLayout;
```

### G2 — parent rewriting

Two memos, both keyed by oid:

```ts
const visible = new Set(commits.map((c) => c.oid));
const parentsOf = new Map<string, string[]>();
for (const c of opts?.ancestry ?? commits) parentsOf.set(c.oid, c.parents);
for (const c of commits) if (!parentsOf.has(c.oid)) parentsOf.set(c.oid, c.parents);

interface ResolvedParent { oid: string; elided: boolean }

// memo A: nearest visible ancestor of an arbitrary oid
// memo B: resolved parent list of a visible commit
```

`nearestVisible(start)`:

- `start` visible → `{ oid: start, elided: false }`.
- Otherwise BFS over `parentsOf`, pushing parents in order so the first-parent
  mainline is explored before side branches at the same depth. First visible hit
  → `{ oid: hit, elided: true }`.
- An oid absent from `parentsOf` is a dead end (outside the loaded window).
- Exhausted → `null`. Visited set guards cycles.
- **Memoize by `start`.** This is the load-bearing memo: a wide filter leaves
  many visible commits pointing at the *same* filtered-out parent, and without it
  each repeats the same BFS. A single BFS cannot blanket-memoize the nodes it
  visits, because an intermediate node's own nearest visible ancestor need not be
  the one the outer query found — so the worst case stays "one bounded BFS per
  distinct missing parent". That bound is fine: the ancestry pool is at most the
  two loaded windows (~1000 commits), not the repository.

`resolveParents(commit)`: map each true parent through `nearestVisible`, drop
nulls, and **dedupe by target oid** — a merge whose two parents rewrite to the
same visible ancestor yields one link.

Because BFS only ever walks parents, every result is a true ancestor. Nothing
can resolve to a newer commit.

### G2 — node classification

Lane bookkeeping uses `resolved`; **node shape uses the true parents**. A merge
commit is still a merge even when both its parents rewrote to one ancestor:

```ts
const trueParents = parentsOf.get(commit.oid) ?? commit.parents;
const isRoot    = trueParents.length === 0;
const truncated = !isRoot && resolved.length === 0;

node.solid = trueParents.length <= 1;   // unchanged semantics
node.merge = trueParents.length >= 2;   // unchanged semantics
node.truncated = truncated;             // new
```

- `isRoot` → today's behaviour: lane ends, solid dot.
- `truncated` → lane **ends** and frees its slot; renderer draws a short dashed
  stub below the dot. This is what kills the phantom lanes.

### G2 — dashed lanes

`dashed` is a flag on the existing kinds, not a new kind: an elided link passes
through intervening rows and so must render as `line`, `half-top`, `half-bot`,
`fork-bot`, and `merge-top` alike.

Dashedness is a property of the *link*, and a lane spans many rows, so it lives
on the active-lane record and is inherited by every row the lane crosses. It
resets per link — when the lane reaches its rewritten parent, that commit's own
resolution decides the next segment.

```ts
interface ActiveLane {
  awaitingOid: string;
  color: string;
  dashed: boolean;
  /** Oid awaited at birth — stable colour key for G4. */
  colorKey: string;
  primary: boolean;   // G6, phase 3
}
```

The `lanesAtTop` snapshot carries `dashed` too, so `half-top` / `merge-top` /
pass-through `line` read it from the top-of-row state while `half-bot` reads the
post-mutation state. `fork-bot` takes its dashedness from that fork target's
`elided`.

`GraphLane` gains `dashed?: boolean`; `PGGraphRow` applies `strokeDasharray`.

### G1 — size the column to the actual lane count

Geometry constants move out of the path math and into named exports, so the
three places that currently hardcode `140` cannot drift:

```ts
export const GRAPH_PAD   = 12;
export const LANE_W      = 16;
export const GRAPH_MAX_W = 240;

export const graphWidth = (maxCol: number) =>
  Math.min(GRAPH_MAX_W, GRAPH_PAD * 2 + maxCol * LANE_W);

export const commitRowGrid = (graphW: number) =>
  graphW > 0
    ? `${graphW}px 70px 1fr 150px 90px`
    : `70px 1fr 150px 90px`;
```

Arithmetic check — node radius is 4:

| maxCol | width | node x | node right edge | fits |
|---|---|---|---|---|
| 0 | 24 | 12 | 16 | ✓ |
| 8 | 152 | 140 | 144 | ✓ (today: 140 wide, clipped) |
| 13 | 232 | 220 | 224 | ✓ — last unclamped width |
| 14 | 240 (clamp) | 236 | 240 | ✗ → affordance |

`maxCol` is the max over all rows of every lane `col` **and** the node `col`.

`PGGraphRow.width` becomes **required**, matching the `height` precedent #71 set
— a default is what let this bug hide. `PGCommitRow` gains a required `graphW:
number` prop, which it feeds to both `commitRowGrid(graphW)` and its
`PGGraphRow`. History computes `graphWidth(maxCol)` once and passes it to the
header grid and to every row, so all three former `140`s derive from one number.

**`graphW = 0` and `graphWidth(0) = 24` mean different things** — worth stating,
because conflating them is the easy implementation bug. `graphWidth(0)` is a log
with exactly one lane, which still needs 24px for the dot. A literal `graphW: 0`
means *no graph column at all*, and only Reflog passes it.

**Past the clamp** (maxCol ≥ 14): a right-edge gradient fade inside the SVG, and
the count of hidden lanes appended to the `GRAPH` column header. The header
carries the number because the SVG is `aria-hidden` after G8 — decorative fade
in the graphic, the fact in text.

### G1 — Reflog consequence (flagged)

`Reflog.tsx:238` renders `PGCommitRow` with **no `lanes` and no `node`** — a
140px empty gutter used purely as spacing. Making the width explicit forces a
choice; this spec takes the honest one: Reflog passes `graphW = 0`,
`commitRowGrid(0)` omits the column entirely, and the reclaimed 140px goes to
the message. This is a deliberate visual change to Reflog, outside #68's stated
scope, made because the refactor forces the decision rather than as gratuitous
cleanup. `reflog.e2e.ts` selects rows by text and is unaffected.

### G3 — delete the `diag` kind

`GraphLane["kind"]` includes `"diag"` and `PGGraphRow` renders a cubic path for
it (`git-components.tsx:871,914-925`); `layoutGraph` has never emitted it.
Delete from the union and the renderer. G2 deliberately does not revive it —
elision is a `dashed` flag on existing kinds, because an elided link must render
as a straight run, a half-lane, *and* a curve depending on the row.

---

## Phase 2 — colour and theme (G4, G5)

### G4 — stable, collision-aware lane colours

Today: `PALETTE[laneBirthCounter++ % 7]`. Two failures — the 8th concurrent lane
silently reuses `--graph-1` with no adjacency check, and colour is a function of
birth order *within the laid-out list*, so any filter change repaints the graph.

Hash first, LRU as collision-breaker:

```ts
preferred = PALETTE[fnv1a(lane.colorKey) % PALETTE.length]
if (!activeColors.has(preferred)) choose preferred
else choose the palette entry ∉ activeColors with the smallest lastUsed tick
     (all 7 active → smallest lastUsed overall; an unavoidable repeat)
lastUsed.set(chosen, tick++)
```

`colorKey` is the oid the lane awaits **at birth** — the branch-tip-ward
identity, uniform across both the node-lane and fork-target cases, and more
stable under filtering than the birth commit's own oid.

**Honest limitation, to be stated in the spec's own tests:** a lane's colour is a
pure function of its `colorKey` *when that palette entry isn't already taken*.
Under ≤7 concurrent lanes with distinct hashes, colour is stable across filter
changes. #68's stronger claim ("colour unchanged when the same history is laid
out as any subset") does not hold in general, because a subset can change which
colours are concurrently active and therefore which collisions break. The
regression test uses a collision-free fixture and asserts that.

### G5 — light themes (⊂ #61 B4)

`--graph-1..7` are defined once in the dark `@theme` block
(`index.css:110-117`); `applyTheme` sets bg/fg/border/accent/logo/ring and never
touches them (`useSettingsStore.ts`). Every non-default theme therefore renders
lanes in dark-mode oklch values.

- `ThemeDef.colors` gains `graph?: [string × 7]`.
- `applyTheme` writes `--graph-1..7`, falling back to the dark defaults when the
  slot is absent — the same pattern already used for `logo`/`logo2`, which keeps
  themes persisted before this change working.
- A light lane set at lower lightness / higher chroma on the same hues (around
  `oklch(0.55 0.19 H)`), verified against `--bg-0` **and** `--bg-2` — the
  selected-row case, where a lane crosses a lighter surface.
- Fold in one adjacent hardcode found while reading: `PGCommitRow`'s
  `borderBottom: "1px solid oklch(0.22 0.008 260 / 0.5)"` (`:1067`), a dark
  literal in the row this phase is already editing.

The rest of #61 B4 (`--git-*`, `--shadow-*`, `--bg-selection*`) is **not**
claimed here. B4 is unowned; this lands the graph slice and the mechanism B4
then reuses.

---

## Phase 3 — rendering quality (G6, G7-partial, G8)

### G6 — crossings and current-branch emphasis

Every lane is the same 1.5px stroke and a curve crossing a vertical just
overlaps it, so a busy merge region is untraceable.

Per-row draw order: **verticals and half-lanes first, then for each curve a
`var(--bg-0)` casing stroke (width + 2.5) followed by its coloured stroke.** The
casing produces the bridge/gap effect for free wherever a curve crosses a
straight lane, and requires only that lane emission be ordered, not that
geometry change.

`GraphLane.primary?: boolean` → 2px. Set inside `layoutGraph` from
`opts.headOid`: when a node's oid matches, its lane is marked primary, and
because the first parent always continues in the node's lane the flag propagates
down the first-parent chain automatically. Computing it in the layout is cleaner
than post-processing in History, which is why `headOid` is a layout option
rather than a row prop.

### G7 (partial) — HEAD marker

`GraphNode.head?: boolean`, set when the node's oid is `opts.headOid`. Rendered
as a double ring: outer circle r=6 at 1px, plus the existing dot. Shape
vocabulary stays small — hollow / solid / merge / HEAD. Tags stay in the subject
column where a pill already does the job better.

Dimming is dropped (decision 3).

### G8 — crisp strokes and a11y

- `shape-rendering="crispEdges"` on `<line>` elements only; curves keep
  antialiasing.
- **No coordinate offset.** #68 suggests offsetting lane centers by 0.5px, but
  node `cx` is computed from the same lane x, so offsetting lanes alone would
  desync dot and lane centers, and offsetting both reintroduces fractional
  positions. `crispEdges` snaps without touching the shared geometry.
- `aria-hidden="true"` + `focusable="false"` on the `<svg>`: a screen reader
  walking the list currently hits one unlabeled graphic per row, adding nothing
  over the sha/subject/author text already in the row.

---

## Phase 4 — render cost (G9, then G10)

### G9 — memoize the row, stabilize the props

Neither `PGGraphRow` nor `PGCommitRow` is memoized, and `rows` is rebuilt
wholesale on every `visible` change, so at the 500-row cap every keystroke in
search rebuilds 500 SVGs. `React.memo` alone accomplishes nothing here — three
props are fresh references on every render:

- **Callbacks.** `onClick={(e) => onRowClick(c.oid, e)}` and `onContextMenu`
  (`History.tsx:451-452`) are new closures per row per render. Replace with an
  `oid` prop plus `onRowClick?: (oid, e)` / `onRowContext?: (oid, e)`, so
  History passes one `useCallback` pair. **This changes `PGCommitRow`'s public
  props and therefore touches `Reflog.tsx:245` as well.**
- **`refs`.** `mapCommitRefs(c.refs, headName)` (`History.tsx:437`) allocates a
  fresh array per render. Memoize per oid.
- **`lanes`.** Cache lane arrays by oid + a geometry signature so rows whose
  geometry didn't change keep reference identity across re-layout.

G9 lands before G10 and separately: virtualization hides this cost without
removing it, and the fix is small.

### G10 — virtualize the commit list (⊂ #61 A8)

`visible.map(...)` (`History.tsx:435`) mounts a DOM row and an SVG per commit
for the whole list.

- Row pitch is `COMMIT_ROW_BASE_H + useDensityStep()` — already exported by #71.
  Do not reintroduce a literal 26.
- Window inside `FocusableScroll` with top and bottom spacer divs so
  `scrollHeight` stays exact. This matters beyond aesthetics:
  `FocusableScroll.onKeyDown` implements `End` as `scrollTop = scrollHeight`
  (`FocusableScroll.tsx:59`) and PageUp/Dn off `clientHeight`, all of which
  break against a short scroll body.
- Overscan ~8 rows.
- **Scroll-to-index must be store/ref-driven, not DOM-driven.** `usePaneList`
  indexes by position (`History.tsx:222-231`), speed-search jumps to arbitrary
  indices, and multi-select spans ranges — none of which may assume the target
  row is mounted.
- Coordinate the windowing helper with #61 A8 so the file tree and the log share
  one implementation rather than two.

### G10 — e2e migration (same PR)

- Add `data-testid="commit-list"` carrying `data-total={visible.length}`, and
  convert `history-diff.e2e.ts:25`'s exact-count assertion to read it.
- Add an `e2e/support` helper that scrolls the list until a row matching given
  text exists, and route the six text-selecting specs through it.
- **Read `.claude/skills/e2e-testing/SKILL.md` before writing any of this**, per
  CLAUDE.md — selector conventions, the 5s-penalty rules, and rebuild
  discipline all apply.

---

## Phase 5 — scale (G11)

The log is fetched with a hardcoded `limit = 500` at four frontend call sites
(`useRepoStore.ts:322,339,367,373`) and again as the backend default
(`commits.rs:18,34`), with no pagination and no "load more". History past 500
commits is unreachable, and the graph's bottom edge is an artifact of the cap
rather than of history.

### Cursor design

**A single-oid cursor is wrong.** At a page boundary the walk frontier is a
*set* — every lane's awaited parent — so resuming from the last emitted commit's
oid silently drops every other live branch. The cursor is therefore the frontier:

```rust
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    /// Frontier oids to resume from; None = true end of history.
    pub next_cursor: Option<Vec<String>>,
}

fn log_page(
    repo_id: &RepoId,
    refspec: Option<&str>,
    cursor: Option<&[String]>,
    limit: usize,
) -> AppResult<LogPage>;
```

The frontier is computed server-side while emitting: track the emitted set, then
`frontier = { p : p is a parent of some emitted commit, p ∉ emitted }`, O(page).
Continuation pushes every frontier oid (revwalk accepts multiple pushes) and
`Sort::TIME | TOPOLOGICAL` reproduces the continuation exactly. Same treatment
for the filtered walk.

**One walk implementation, not two.** `log` and `log_filtered` become thin
wrappers over the paginated walk with `cursor: None`, so the existing
`get_log` / `get_log_filtered` commands and their four `limit = 500` call sites
keep working unchanged while the cursor path is added. `commits_since` and
`file_history` are separate walks and are untouched.

Reuse existing `AppError` variants for a missing/invalid cursor oid — no new
variant, so no `errors.ts` sync is needed. `CommitInfo.parents` stays untouched
throughout, which keeps `CommitDiff`'s "parent → commit" header
(`History.tsx:462-464`), `buildRebasePlan`, and `planCommitSelection` correct.

### Incremental layout

Re-running `layoutGraph` over the whole accumulated list per page is O(N²) over
a session. `layoutGraph` gains a resumable form: accept the previous run's
terminal state (`active` lanes, palette `lastUsed`, tick) and return its own, so
lane columns and colours stay continuous across page boundaries.

### UI

- "Load more" plus auto-load on approaching the bottom (requires G10).
- `next_cursor: Some` → more history exists; `None` → true end. The last row
  must read as *capped*, not as end-of-history, whenever a cursor remains — the
  no-silent-caps rule.
- G2's `truncated` node flag naturally shrinks as the window grows.
- **Page size stays a constant (500), not a setting.** Pagination plus load-more
  already solves reachability; a knob is extra surface for no gain. Deliberate.

---

## Testing

### `graphLayout.test.ts` (extends the existing five cases, same `c()` fixture style)

- An `elided` link keeps **one** lane and marks the segment `dashed`, rather
  than opening a second lane — the reported bug.
- A `truncated` parent ends the lane, frees the slot, and sets
  `node.truncated`; a true root still ends the lane **without** `truncated`.
- `ancestry` absent → falls back to `parents`, all existing assertions unchanged.
- A merge whose parents both rewrite to the same visible ancestor yields **one**
  deduped link but still reports `node.merge === true`.
- A merge with both parents filtered out lands on its nearest matching ancestor
  **on each side**.
- \>8-way concurrency reports its true `maxCol` (G1's width input).
- No two *active* lanes share a colour below 8-way concurrency (G4).
- Colour is unchanged when a collision-free history is laid out as a subset (G4,
  per the stated limitation).
- Resumable layout: laying out `[page1, page2]` in one pass and as two resumed
  passes yields identical rows (G11).

### Component tests (`*.test.tsx`, jsdom + RTL, per the existing convention)

- `PGGraphRow`: svg width tracks `graphWidth(maxCol)` and a col-9 lane is inside
  the viewport — the G1 regression.
- `PGGraphRow`: a `dashed` lane renders `strokeDasharray`; a `truncated` node
  renders the stub.
- `PGGraphRow`: `aria-hidden` is set (G8).
- `applyTheme` writes `--graph-1..7`, and a theme lacking the `graph` slot falls
  back to the dark defaults (G5).

### Rust (`src-tauri/tests/`, `TempRepo` fixture)

Only G11 touches the backend:

- A two-page walk over a repo with a mid-page branch returns the **same**
  commits as a single walk with `limit = 2 × page` — the frontier-cursor
  correctness guard, and the one that fails for a single-oid cursor.
- `next_cursor` is `None` exactly at the true end of history.
- The filtered walk paginates with the same guarantees.
- An unknown cursor oid surfaces an error rather than an empty page.

### E2E

- `history-diff.e2e.ts` — search for a term matching two non-adjacent commits on
  one branch; assert a single lane spans both rows and that **no lane runs past
  the last matching row** (the visible symptom of G2).
- Count assertions move to `data-total`; text selection goes through the
  scroll-to-row helper (G10).
- Run only the affected specs against a fresh snapshot; the full suite is CI's
  job.

## Out of scope (deliberate)

- **Search-as-highlight** with dimmed non-matches (G7's dimming half) — search
  stays a filter. Recorded on #68.
- **The rest of #61 B4** — `--git-*`, `--shadow-*`, `--bg-selection*` remap.
  This spec takes only the `--graph-*` slice plus the one row border it edits.
- **A log page-size setting** — pagination is the fix; a knob is not.
- **Reviving the `diag` lane kind** — deleted, cheap to re-add with a producer
  and a test if a lane-shift edge is ever wanted.
- **A backend `graphParents` wire field** — superseded by the frontend rewrite.
  Would only add reach beyond the loaded window, which G11 grows anyway.
