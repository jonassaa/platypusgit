# User-controlled list order: reorder repository tabs, pin branches

**Issue:** [#238](https://github.com/jonassaa/platypusgit/issues/238)

## Problem

Both of the app's long lists are ordered by a rule the user cannot influence.

- **Repository tabs** sit in the order they were opened. `upsertTab`
  (`tabs.ts:100`) documents "existing tabs keep their position", and nothing
  moves them afterwards. Someone who keeps six repositories open cannot put the
  two they alternate between next to each other.
- **Branches** are ordered by #135: default branch first, then tip time
  descending. That is a good default and it is not user control — there is no
  way to say "keep `feat/foo` at the top" in a fifty-branch repository.

Three GitHub Desktop issues ask for exactly this (pin branches, 29 reactions;
reorder repositories, 28; a settable recent limit, 15), and Fork's "customize
branch colour" (19) is the same need answered with colour instead of order.

## Design

The two halves ship as two PRs. They share nothing but the motivation: one is a
drag gesture over an array, the other is a comparator tier plus a persisted set.

### Part 1 — Reorder repository tabs

#### A. `useRowReorder` gains an axis

The reorder primitive (`features/dnd/useRowReorder.ts`) is vertical throughout:
`clientY`, `box.top`/`height`, `translateY`, `offsetTop`, `scrollTop`, and an
autoscroll band measured against `rect.top`/`bottom`. The tab strip is a
horizontal flex scroller (`chrome.tsx`, `overflowX: "auto"`).

It takes an `axis: "x" | "y"` option, defaulting to `"y"`. The dnd design doc's
rule is one primitive per gesture *class* — "three ad-hoc implementations is how
the three drift" — and a horizontal sibling hook would be the second
implementation of one gesture.

The axis is a table of accessors resolved once, not a `cond ? y : x` at each of
the eleven sites that read a coordinate:

```ts
interface AxisOps {
  point(e: { clientX: number; clientY: number }): number;
  start(r: DOMRect): number;      // top   | left
  size(r: DOMRect): number;       // height| width
  offset(el: HTMLElement): number;// offsetTop | offsetLeft — transform-immune
  scroll(el: HTMLElement): number;
  overflows(el: HTMLElement): boolean;
  translate(px: number): string;  // translateY(..) | translateX(..)
}
```

`offsetTop` → `offsetLeft` matters for the same reason the original comment
gives: FLIP must measure true layout, unaffected by the transforms the hook
itself is applying.

Nothing about the gesture's *semantics* changes — slop, midpoint crossing,
edge autoscroll, Escape-cancel, the settle animation and the
`settled`/FLIP hand-off are all axis-agnostic once coordinates are read through
the table. The Rebase call site passes no axis and is untouched.

#### B. The move is a pure splice, and order already persists

`moveTab(tabs, from, to)` joins `upsertTab`/`removeTab`/`cycle` in `tabs.ts` —
splice, not swap, because a drag can travel several tabs. Out-of-range or
`from === to` returns the input array unchanged.

`useTabsStore` gains `reorder(from, to)`, which sets the array and calls the
store-local `persist()`. **No new persistence:** `saveOpenRepos` already writes
`tabs.map(t => t.path)` in array order and `restoreSession` rebuilds tabs in the
order it reads back, so tab order survives a restart the moment the array is
reordered.

One consequence is deliberate and gets a test rather than a guard:
`selectIndex` (`Alt+1…9`) indexes the array, so after a reorder `Alt+1` selects
whatever the user dragged to the front. That is the point of dragging it there.

#### C. The strip

`PGTabStrip` takes the `RowReorder` handle and applies `registerTab` /
`onTabPointerDown` per tab, `touchAction: "none"` and a grab/grabbing cursor.
Its existing horizontal scroller is passed as the autoscroll container.

Two details the strip already gets right and must keep: the close `×` is a
`<button>`, which the hook's control opt-out excludes from starting a drag; and
the `scrollIntoView` effect keys off the *active* and *last* tab ids, neither of
which a reorder changes, so it will not fight a drag.

#### D. Keyboard equivalent

CLAUDE.md: a new gesture without one is not done.

`tab.moveLeft` / `tab.moveRight` on **`Mod+Shift+←/→`** — the horizontal
analogue of `rebase.moveStepUp`/`Down`'s `Mod+Shift+↑/↓`, and free because that
pair is pane-scoped to the rebase plan while these are `scope: "global"`. Global
is right: the tab strip is app chrome, not a `PGPane`, and never holds pane
focus, so a pane cursor has nothing to attach to. Both runners read `activePath`
and return `false` when there is no tab or the move would leave the array, so
the chord falls through rather than silently doing nothing.

The visible mouse equivalent is **Move left / Move right** in the tab context
menu, mirroring the chevrons beside the rebase plan's drag.

### Part 2 — Pin branches

#### A. A per-repository pin set

`pg-branch-pins-v1`, a `Record<repoPath, string[]>` in localStorage, exactly the
shape and the best-effort error handling of `useBranchFolders`
(`pg-branch-folders-v1`) — same feature directory, same "a view preference that
must outlive the tab" argument for staying out of `useRepoStore`, whose
`RepoSlice` key set is guarded by a test.

It is a **zustand store, not a React hook**, which is where it departs from
`useBranchFolders`. Two of the four ordering call sites — `design/context-menu.tsx`
and `features/palette/commands.ts` — are not components and reach state through
`getState()`. A hook cannot serve them.

#### B. One more comparator tier

`compareBranches` reads a pin set, ordering **default branch → pinned → tip time
→ name**. Pins rank below the default rather than above it: #135 argued the
default's pin at length and its tests assert it, pinning the default branch is
then a harmless no-op rather than a contradiction, and the picker's resting
cursor rule is written against a stable row 0.

The pin set arrives as a parameter, so `orderBranches` stays pure and stays a
permutation — the filter-first/order-second invariant three test files assert is
untouched.

#### C. Pins are hoisted out of the folder tree

This is the part that is not a comparator. Grouping (#244, PR #303) runs *after*
ordering and only moves ordered rows into folders, so a pinned `feat/foo` sorts
first **inside the `feat` folder** — invisible when that folder is collapsed,
which is precisely the case pinning exists for. The default branch escapes this
only because `main` has no `/` and is therefore a root-level leaf.

Pinned branches render in a section above the tree, under their full names, and
are removed from the tree rather than duplicated into it. That is what the
issue's own comment asks for: pinned branches sit above the grouped tree rather
than inside it.

#### D. Affordance

A `pin` glyph joins the `IconName` union, which has none today. The toggle is a
context-menu item in `branchMenuItems`, which both the Branches screen and the
picker already share, so one edit reaches both surfaces.

## Testing

**Part 1.** `tabs.test.ts` for `moveTab` (splice over several positions, the
no-op cases, no mutation). `useTabsStore.test.ts` for `reorder`: the array, the
persisted `pg-open-repos` order, and that `selectIndex` follows the new order.
`RepoTabs.reorder.test.tsx` modelled on `Rebase.reorder.test.tsx` — the same
`stubGeometry`/`pointer`/`grabAndDrop` harness with `clientX` in place of
`clientY`, since jsdom has neither layout nor `PointerEvent`. `presets.test.ts`
gains the new chords to its repository-tab block; the cheat sheet is derived and
needs no edit, but its "a row for every catalog action" test fails if the
catalog and the presets disagree. `repo-tabs.e2e.ts` drags one tab with the
existing `jsDrag` helper, which is already axis-agnostic, and asserts the order
survives a reload.

**Part 2.** `orderBranches.test.ts` for the new tier and for pins still being a
permutation. A pin-store test file mirroring `useBranchFolders.test.ts`
(round-trip, repositories kept apart, pruned when empty, corrupt payload
survived). `Branches.folders.test.tsx` for a pinned branch inside a collapsed
folder appearing above the tree exactly once.
