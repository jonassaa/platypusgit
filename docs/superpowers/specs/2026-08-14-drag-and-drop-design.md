# Drag-and-drop: one pointer primitive, three surfaces

**Issue:** [#91](https://github.com/jonassaa/platypusgit/issues/91) (spun out of #61 C5)

## Problem

Three gestures every competing client has, and we have one of them:

1. **Rebase plan reorder** — landed in #116 (`features/rebase/useRowReorder.ts`).
   It is a *reorder* gesture: one list, rows swapping places, no payload leaving
   the list. It also has a live defect: the drag is wired unconditionally, so a
   plan in **preserve** mode can be reordered by pointer even though the chevron
   buttons are hidden there on purpose (git documents its own reorder bugs under
   `--rebase-merges`). The invariant is stated in CLAUDE.md and enforced in
   exactly one of the two entry points.
2. **Staging** — checkbox or Space only. Dragging a file from CHANGES to STAGED
   is the gesture Fork/GitKraken/Sourcetree all ship, and the one people try
   first.
3. **Graph** — no drag-a-branch-onto-a-branch. This is the dangerous one: a
   mis-drop that rewrites history is worse than no feature at all.

(2) and (3) are a different gesture from (1): a payload is picked up in one place
and **transferred** to another. One primitive per gesture *class*, not one per
screen — three ad-hoc implementations is how the three drift.

## Decision: pointer events, not HTML5 drag-and-drop

`useDragSource`/`useDropZone` are built on `pointerdown`/`pointermove`/
`pointerup`, not `dragstart`/`dragover`/`drop`. Reasons, in order of weight:

1. **Precedent.** `useRowReorder` is already pointer-based and already solves
   slop, auto-scroll, Escape-cancel and FLIP. A second, HTML5-shaped model
   beside it means two mental models for one interaction.
2. **Testability at both layers.** WebDriver cannot synthesize an HTML5 drag
   session, and jsdom has no `DataTransfer`. Pointer sequences are drivable from
   RTL (`Rebase.reorder.test.tsx` already does it) and from an in-page
   `executeOnce` script in e2e. An untestable gesture on the *graph* surface is
   not acceptable.
3. **No native drag session to leak.** An HTML5 drag inside a webview hands the
   gesture to the platform: OS drag cursors, a browser-rendered drag image we
   cannot theme, and — on WebKit — text/link/image selections that start their
   own drag. We already suppress the native context menu for the same reason.
4. **We own the affordance.** Drop indication, the ghost label, the reject
   reason, and Escape-cancel are ours rather than the platform's.

Cost accepted: no drag *out of* the window (dropping a file onto Finder), and no
drag *into* it. Neither is in scope for #91 — see Out of scope.

## Design

### A. The primitive (`src/features/dnd/`)

```
types.ts          DragPayload union + DropResolution
dragController.ts Gesture state machine, zone registry, ghost, Escape. Module-level.
useDnd.ts         useDragSource / useDropZone — the only two things screens import
resolveDrop.ts    PURE resolution: resolveStagingDrop, resolveGraphDrop
useRowReorder.ts  MOVED here from features/rebase/ — reorder is drag too
```

**Payload** is a discriminated union, so a zone's `accepts` is a type guard:

```ts
type DragPayload =
  | { kind: "files"; side: "staged" | "unstaged"; paths: string[]; label: string }
  | { kind: "ref"; ref: string; isHead: boolean; label: string }
  | { kind: "commit"; oid: string; label: string };
```

`paths` are **already bucketed and already filtered** by the source screen using
its existing `splitFileSelection` source (`lib/selection.ts`) — so multi-selection
bucketing and the embedded-repo exclusion are shared with the checkbox path by
construction, not re-derived. `ref` is the ref exactly as git names it (`main`,
`origin/main`), never the display string `mapCommitRefs` mangles into `HEAD→main`.

**Two zone modes.** A plain zone is one element (`CommitPanel`'s two sections).
A **delegated** zone is one registration covering many rows: it supplies
`resolve(el, payload) → { key, el } | null`, and the controller asks it what the
element under the pointer means.

Delegation is not a convenience — it is the only shape History can use.
`PGCommitRow` is `React.memo`'d and the list is windowed (#68 G9/G10); a
`useDropZone` per row would add two store subscriptions per row and re-render the
visible slice on every pointer move across it. So:

- **Hover indication is written to the DOM, not to React state.** The controller
  sets `data-pg-drop-over=""` on the resolved element and clears it when the
  resolution changes; `index.css` styles that attribute. Zero renders per move.
- The store holds only `payload` (null ⇄ non-null, twice per gesture) and
  `overId` (the *zone* id, so a zone can render a caption). Rows subscribe to
  neither.

**Hit-testing** reads `e.target.closest("[data-pg-drop-id]")`, falling back to
`document.elementFromPoint` when the event carries no useful target. The ghost is
`pointer-events: none`, so it never shadows the target. Both paths matter:
`e.target` is what a synthesized RTL/e2e event gives, `elementFromPoint` is the
coordinate truth.

**Gesture contract**, identical for every surface:

| moment | behaviour |
|---|---|
| `pointerdown` on a source | armed only; nothing visible yet |
| movement < 4px | still a click — the row's own click/select still fires |
| past slop | `payload` set, ghost appears, `user-select: none`, cursor `grabbing` |
| over an accepting zone | `data-pg-drop-over` on the resolved element, ghost reads "valid" |
| over a rejecting resolution | ghost reads the reject reason; drop does nothing |
| `Escape` | cancel — no drop, no state change |
| `pointercancel` | cancel |
| `pointerup` | `onDrop(payload, key)` if a resolution stands, else nothing |

`pointerdown` is ignored when it lands on `button, select, textarea, input, a,
[contenteditable]` — same list `useRowReorder` uses, same reason: those own their
pointer semantics.

`dragstart` on a source is `preventDefault`ed and `-webkit-user-drag: none` is
set on `[data-pg-drag-source]`, so WebKit cannot start a native drag out of a
selection, a link or an icon underneath our gesture.

### B. Rebase reorder (`screens/Rebase.tsx`)

Reorder already routes through `moveRowTo` → `setPlan`, i.e. the same plan model
the chevrons and the backend validator see, and the dragged row is moved by
`splice` so it carries its `action` and typed `message` untouched. That stays.
Three changes:

1. **Preserve mode disables the drag**, matching the chevrons. `onPointerDown` is
   not wired, the row cursor is `default`, and each row carries
   `data-pg-reorderable="false"`.
2. **It says so.** A line above the rows in preserve mode: *"Reordering is
   disabled while preserving merges — git's own `--rebase-merges` reorder is
   unreliable."* The existing merge-count banner already says it, but only when
   the range contains a merge; a merge-free range in preserve mode said nothing.
3. **Keyboard parity.** The chevrons are mouse-only today. Two new pane-scoped
   actions, `rebase.moveStepUp` / `rebase.moveStepDown` on **Mod+Shift+↑/↓**
   (Rider's Move-Statement chord), plus a row cursor via `usePaneList` so ↑/↓
   move it. Both actions decline in preserve mode, so the chord falls through
   rather than silently doing nothing.

### C. Staging (`screens/CommitPanel.tsx`, `screens/RepoBrowser.tsx`)

**CommitPanel.** The two section wrappers become one drag source and one drop
zone each.

- Source: a single `onPointerDown` on the section wrapper, resolving the row
  from `e.target.closest("[data-path]")` — an attribute both `PGChangeRow` and
  `PGFileTreeRow` already carry. So **no prop is threaded into either row
  component** and the tree⇄flat toggle needs no per-mode branch: in flat mode
  `data-path` is the file path, in tree mode it is the tree key minus its leading
  slash, and the screen's existing `navKeyFor` turns either into the same
  `side:path` keys. Dragging a **directory** row therefore expands to every file
  beneath it — the directory-level stage action, unchanged.
- The payload's paths come from `splitFileSelection(keys, selectionSource)`
  (`lib/selection.ts`, shared with the repo browser since #47/#121), where `keys`
  is the multi-selection when the grabbed row is inside it and the single row
  otherwise — the exact rule `togglePaths` uses for the checkbox. Folder
  expansion and the embedded-repo bucketing live in that splitter, so the drag
  cannot drift from the checkbox.
- Drop: `stage(paths)` / `unstage(paths)`, i.e. `useRepoStore`'s existing actions,
  which already `refreshStatus()` and not `refreshAll()`.
- A zone rejects its own side (`side === targetSide` → no-op), so dropping
  CHANGES onto CHANGES does nothing.

**RepoBrowser** has one tree and no staged/unstaged sections, so there is nothing
in the layout to drop onto. It grows a **drop bar** that exists only while a
files drag is in flight: two zones, *Stage* and *Unstage*, pinned to the bottom
of the tree pane. The tree is the source (same `data-path` delegation), the bar
reuses `onStageToggle`'s splitter so folder rows behave exactly as their
checkbox does. Keyboard equivalent already exists: Space (`list.toggle`).

**Drag never reaches the diff pane, so it cannot fight the line cursor.** #122
gave `commit.diff` a per-line keyboard cursor plus `diff.toggleLine` on Space,
and Space is also `list.toggle` in the file lists. There is nothing to arbitrate
between them: both drag sources are attached inside `<PGPane id="commit.files">`
(the STAGED section wrapper and the CHANGES section wrapper), while the diff rows
render inside `<PGPane id="commit.diff">` — different subtrees, so a `pointerdown`
on a diff line never reaches the source's delegated handler and a focused line can
never be dragged out from under itself. On the chord side the two coexist by pane
scope, which is the dispatcher's documented behaviour for two PANE-scoped actions
sharing one chord; the rebase plan's `usePaneList` passes no `onToggle`, so its
`list.toggle` handler declines and Space falls through rather than being swallowed.
Both halves are asserted in `CommitPanel.dnd.test.tsx` against the merged tree,
not inferred.

The bar is an explicit **command** surface, so it deliberately does NOT go
through `resolveStagingDrop`. That function's same-side no-op rule belongs to the
Commit screen's two *lists*, where dropping a row back where it came from is
meaningless. This screen has one whole-file key space, and
`splitFileSelection`'s `treeSelectionSource` sets no `side` on a row — so a
partially-staged file (worktree *and* index dirty) lands in **both** buckets and
both directions stay live. Routing the bar through the same-side rule made one
zone a permanent silent no-op; which paths are actionable in a given direction is
decided on drop, by the shared splitter, against live status.

### D. Graph (`screens/History.tsx`)

One delegated zone over the commit list. Sources: a ref pill and a commit row.
Targets: a ref pill and a commit row. The resolution is a pure function over
`(source, target, { headBranch, headOid })` and it maps **only onto ops that
already exist** — `mergeBranch`, `rebaseOnto`, `cherryPick`:

| drag | onto | means |
|---|---|---|
| the HEAD ref | another ref | rebase the current branch onto that ref |
| the HEAD ref | any commit | rebase the current branch onto that commit |
| a non-HEAD ref | the HEAD ref / the HEAD commit | merge that ref into the current branch |
| a commit | the HEAD ref / the HEAD commit | cherry-pick it onto the current branch |
| anything | itself | nothing |
| a non-HEAD ref | a non-HEAD target | **rejected**: "Check out X first" |
| a commit | a non-HEAD target | **rejected**: same |

The asymmetry is deliberate and is the whole safety story: the backend can only
merge *into* HEAD and rebase *HEAD* onto something, so every legal drop has the
current branch at one end. There is no gesture that rewrites a branch you are not
on, and none that checks out a branch as a side effect. A rejected resolution is
shown on the ghost while dragging and, on release, flashed — never guessed at.

The zone `accepts` only while `repoState === "Clean"`: no starting a merge on top
of an open merge.

**Every graph drop confirms** via `pgConfirm` with a body, and the two
history-rewriting ones (rebase, cherry-pick) pass `danger: true`:

- merge — "Merge `X` into `main`?" / "A merge commit is created unless the merge fast-forwards."
- rebase — "Rebase `main` onto `X`?" / "`main`'s commits are replayed on top of `X` — their SHAs change." `danger`
- cherry-pick — "Cherry-pick `abc1234` onto `main`?" / "The commit is copied onto `main` as a new commit." `danger`

Keyboard parity: all three already exist — the branch context menu
(`branchMenuItems`: Merge into current / Rebase current onto this), the commit
context menu (`commitMenuItems`: Cherry-pick), the palette's merge/rebase steps
and the Branches screen. The drag reaches the same store actions through the same
confirms, so nothing is keyboard-unreachable.

### E. Affordance and accessibility

- The ghost carries the payload label and the current verdict, and is
  `aria-hidden` — it is decoration over a gesture a screen reader cannot perform.
- Every drop target is *visibly* indicated: `[data-pg-drop-over]` draws an accent
  2px inset ring plus an accent wash, from `var(--accent)` (no hardcoded hue).
- Escape cancels, in every surface, from one listener in the controller.
- Nothing is drag-only. Staging has Space and the checkbox; reorder has
  Mod+Shift+↑/↓ and the chevrons; the graph gestures have their context menus,
  the palette and the Branches screen.

## Testing

- **Pure:** `resolveDrop.test.ts` — the whole staging and graph table above,
  including every rejection and every no-op.
- **Primitive:** `dnd.test.tsx` — slop, Escape-cancel, `pointercancel`, the
  `button/select/input` opt-out, delegated resolution, and that a rejecting
  resolution does not fire `onDrop`.
- **Component:** `CommitPanel.dnd.test.tsx` (flat + tree, single + multi-select,
  a directory row, and that a same-side drop no-ops), `History.dnd.test.tsx`
  (merge, rebase, cherry-pick each reaching the right store action after a
  confirm, plus a rejected drop calling nothing — `WithDialogs`),
  `Rebase.reorder.test.tsx` extended with the preserve-mode gate and the two
  keyboard actions.
- **E2E:** `drag-and-drop.e2e.ts` — a real pointer drag from CHANGES to STAGED in
  the real webview, asserted against `git diff --cached` repo truth. The graph
  drop is deliberately NOT e2e'd: it needs a diverged fixture plus a confirm
  round-trip, and its logic is a pure function under unit test.

## Out of scope

- Dragging files out of the window (to Finder/Explorer) or into it. That needs a
  native drag session — see the pointer-events decision.
- Reordering under preserve mode. Disabled on purpose, both entry points.
- Drag on the Branches screen list, the stash list, or the reflog.
- Multi-touch / trackpad inertia. One pointer, one payload.
