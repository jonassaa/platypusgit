# Interactive rebase onto any commit (issue 186)

Status: approved for implementation.
Issue: [186](https://github.com/jonassaa/platypusgit/issues/186).

## Goal

Pick a new base **anywhere** — a diverged branch, a commit on another line of
history, a bare hash — and replay this branch's commits onto it with the
pick/squash/reword/drop plan on screen first. `git rebase -i <newbase>`, which is
the half of interactive rebase TortoiseGit has and this app does not.

Today the only way to move a branch onto a diverged base is `rebaseOnto(name)`,
which shells out to real `git rebase` and offers no plan at all. The interactive
path refuses any base that is not already an ancestor of HEAD.

## What already works, verified in the tree

The issue's central claim holds. Confirmed by reading the code, not by trusting
the issue:

- `rebase_start` (`src-tauri/src/git/libgit2.rs`) takes the run's base from
  **`first_step.onto`**, falling back to the first non-Drop step's first parent
  only when `onto` is `None`. It then `set_head_detached(base)` + hard-reset and
  replays there, moving the branch ref exactly once on completion.
- `rebase_plan::validate` accepts an `onto` that is "either an earlier step or a
  commit that already exists" — `revparse_single(onto).peel_to_commit().is_ok()`.
  **No ancestry check exists anywhere in the validator.**
- So a plan whose first non-Drop step carries `onto: <newBase>` already *is*
  `git rebase --onto`. Abort, continue, the on-disk mirror and the completion
  summary are all indifferent to where the base sits.
- **One correction to the issue, found by mutation while writing the Rust test:**
  `onto` reaches the run through **two** sites, not one. Besides
  `rebase_start`'s initial detach, `advance_rebase` calls `move_to_base` for any
  step that names an `onto`. Either one alone places the first step — disabling
  each in turn left the new tests green, and only disabling both replayed the
  branch on its own root. Recorded in the test file and in CLAUDE.md, because a
  future change to where a run starts has to find both.

Two consequences worth stating up front, because they shape the design:

1. **The backend needs no change for the feature itself.** Everything below is
   the range computation, the plan's base, and the entry points.
2. `onto` is resolved with `revparse_single`, so it accepts **any revspec** — a
   full oid, a 4–40 char prefix, a branch name. That is what makes the picker's
   free-form hex row and the branch menus work with no new command.

## What is missing

- **The range.** The Rebase screen resolves its base through `commitsSince`,
  which refuses a non-ancestor (`"<base> is not an ancestor of HEAD"`).
- **The base on the plan.** Nothing ever sets `onto` on the first step, so the
  engine always falls back to the first non-Drop step's parent.
- **Entry points.** History's commit menu disables `Interactive rebase from here`
  for any commit off HEAD's ancestry; the branch menus offer only the
  non-interactive `Rebase current onto this`.

## The decisions

### 1. Range: `commitsBetween` for a diverged base, `commitsSince` kept for an ancestor — chosen by a count, not by a failed call

`commitsBetween(base, HEAD)` is `base..tip` with **no ancestry requirement**
(#131), which is exactly what git replays: HEAD's commits not reachable from the
new base. `commitsSince` is **not loosened** — its ancestor requirement is a real
invariant for the on-branch flow and the issue says so.

The screen already has to call `aheadBehind(base, "HEAD")` for the header (below),
and that answer decides the primitive with no wasted round trip:

- `ahead === 0` → nothing to replay. Notice, no plan. (Covers `base === HEAD` and
  a base that is a *descendant* of HEAD.)
- `behind === 0` → `base` is an ancestor of HEAD, by `graph_ahead_behind`'s own
  definition: nothing reachable from `base` is missing from HEAD. Use
  `commitsSince` — the existing path, byte-identical to today.
- `behind > 0` → diverged (or unrelated). Use `commitsBetween`.

Two primitives rather than one is deliberate. Collapsing to `commitsBetween`
everywhere would work — the walks are identical for an ancestor base — but it
would change the common case for no gain, and it would leave `commits_since` with
**no caller anywhere in the app**, forcing either dead code or an unrelated
deletion of a registered command, its trait method, its integration test and its
CLAUDE.md entry. Keeping the strict primitive on the flow whose invariant it
encodes is the smaller and more honest change.

### 2. Truncation is made impossible, because a truncated rebase plan destroys commits

`commits_between`'s Tauri handler defaults `limit` to **200** (`commands/commits.rs`)
and the walk simply `break`s at the cap. A silently truncated plan is the worst
failure this feature could have: the missing commits are not replayed, and the
branch ref moves anyway.

So the limit is derived from the exact count and the result is verified:

```
limit = stats.ahead + 1        // +1 so an over-long answer is detectable too
refuse unless range.length === stats.ahead
```

A mismatch cannot happen unless the repository changed between the two calls, and
the answer to that is a notice — never a plan. There is deliberately **no
arbitrary cap** on the plan's length: `commitsSince` never had one, so capping
would newly refuse on-branch rebases that work today, and the header's count
(below) is what makes a 3000-row plan visible before Start rather than surprising.

### 3. The base rides on the plan's first non-Drop step, and it is attached at SUBMIT

A new pure function, `withPlanBase(steps, baseOid)` (`src/features/commits/`),
sets `onto: baseOid` on the first step whose action is not `Drop` and leaves every
other step alone. `baseOid: null` is the identity.

**At submit, not at build,** because flatten mode lets the user reorder the plan.
Baked into the rows at build time, the base would stay pinned to whichever row was
first when the plan was made; dragged to second place, the run would detach
somewhere else entirely. `rebase_start` reads the first non-Drop step of the plan
it is handed, so the base has to be attached to whatever that turns out to be.

This closes a **pre-existing bug that has nothing to do with a diverged base.**
Today every flatten row carries `onto: null`, so moving the newest commit to the
top of the plan makes `rebase_start` detach at *its* parent — the second-newest
commit — and replay the whole range onto the middle of itself. So the base is
tracked for **every** plan this screen can submit, including one seeded by
`Interactive rebase from here`: that path already computes the base (the oldest
step's first parent) to render the `base:` label, and now stores it as well.
Where it cannot be determined — a root commit, or an oldest step outside the
loaded log — `baseOid` stays null and today's parent fallback applies unchanged.

`buildPreservePlan` keeps assigning intermediate `onto` values from inside the
range; only its first step is affected, and its `i > 0` guard already leaves that
one `null`. One helper serves both modes, so flatten and preserve cannot drift on
where a run starts.

### 4. A second `NavIntent` kind: `rebase-onto`, carrying a revspec

```ts
| { kind: "rebase-onto"; base: string; label: string }
```

Routed to the `rebase` screen in AppShell, with a row in
`AppShell.navroutes.test.tsx`'s `EXPECTED` table (a new kind fails to compile
without one — twice over).

**Not** an extension of `rebase-plan` with an added base, because the menus
cannot build the plan:

- The range is `base..HEAD`, computed by the backend. **The log is paged** —
  `s.commits` is a prefix of history — so a frontend that assembled the range from
  the store would silently produce a short plan for exactly the diverged bases
  this feature exists for.
- A branch context menu has a name, not a commit list.

The intent therefore names the base and nothing else; the screen resolves it
through the one `resolveBase` path the picker uses, so the header's numbers and
the plan can never describe different ranges.

**This is a second action, not a re-enable of the first.** `Interactive rebase
from here` makes the clicked commit the *oldest replayed commit* (base = its
parent, commit included). `rebase-onto` makes it the *new base*, which is **not in
the plan**. Merging them into one item would make the same click mean two things.

### 5. Entry points

- **History commit menu**, immediately after `Interactive rebase from here`:
  `Rebase current branch onto this…`, **disabled when the commit is on the
  current branch's ancestry** — labelled `— already on this branch`, mirroring
  `branchMenuItems`' `disabled: isCurrent`. For an on-branch ancestor the replay
  is a no-op, and the item directly above is what that flow wants; the two are
  therefore never both enabled for one commit, so there is no ambiguity about
  which one a click hit.
- **Local branch menu**, after the existing non-interactive `Rebase current onto
  this`: `Rebase current onto this — interactive…`, `disabled: isCurrent`.
- **Remote branch menu**: the same item, never disabled (a remote branch is never
  current).
- **No confirmation dialog** on any of the three, unlike the non-interactive
  sibling: this rewrites nothing — it opens a plan, and `Start rebase` is the
  destructive step, already behind its own button.
- Both branch items pass the branch's **`tip`** (a FULL oid, read off
  `useRepoStore.branches` — `BranchInfo.tip` is documented as full and must not be
  shortened) and fall back to the branch NAME as a revspec when the tip is
  unknown. A fixed oid means the plan, its counts and the run all describe one
  commit even if a concurrent fetch moves the ref; the name is kept as the label.
- **No palette entry and no keyboard chord.** The Rebase screen's own base picker
  is the keyboard route and after this change it accepts any base, so nothing is
  reachable by mouse only. A palette step would need its own commit picker, which
  is a separate feature.

### 6. `RebaseBasePicker.invalidOids` is deleted

Nothing has ever passed it. Worse, what it encoded — "not on the current branch's
history" — is now the **primary** use case, so a live version would grey out
precisely the rows this feature exists to enable. And there is no longer any
statically invalid base: every row either produces a plan or produces a backend
answer with a real reason (`ahead === 0`, an unresolvable revspec), delivered
through the notice that is already wired. The prop, its `ineligible` opacity and
its tooltip go.

### 7. The header states what will be replayed

Once the base can be diverged, "everything newer than the base" stops being
obvious, so `aheadBehind(base, HEAD)` (#131) is rendered as its own thin strip
under the toolbar (`data-testid="rebase-base-summary"`), not squeezed into the
already-crowded toolbar row:

- always: `N commits will be replayed onto <base>.`
- when `behind > 0`: `<base> has M commits this branch does not.`
- when `behind > 0` and `mergeBase` is set: `Merge base <short>.` — omitted for
  an ancestor base, where the merge base *is* the base and saying so is noise.
- when `mergeBase` is null: `No common ancestor — the whole branch will be
  replayed.` Unrelated histories are a state, not an error (git allows the
  rebase); the strip is what makes the consequence visible before Start.

The strip appears only for a resolved base, so an `Interactive rebase from here`
plan (which has counts nobody asked the backend for) shows no strip.

### 8. A base-resolution notice must be visible outside the picker

`pickerNotice` renders only inside the picker popover, which needs an open state
and an anchor. An intent from a context menu has neither, so a failed resolution
would have been **completely silent** — the menu item would do nothing at all,
which is the `stash-vs-wt` failure mode `AppShell.navroutes.test.tsx` exists to
prevent, one layer lower.

One state (renamed `baseNotice`, since it is the screen's now and not the
picker's), rendered in two places that cannot both be visible: passed to the
picker while it is open — it stays open on failure, so a bad hash can be retried
on the spot — and rendered as a strip when it is closed.

## Out of scope

- **Auto-stash.** `rebase_start` already refuses a dirty worktree
  (`DirtyWorktree`, "commit or stash before rebasing"); the issue puts auto-stash
  outside this change.
- **Loosening `commitsSince`.** See decision 1.
- **Merges inside the replayed range.** Unchanged: flatten drops them (git's own
  default), preserve recreates them. The mode toggle stays visible in this flow
  precisely because a diverged base makes it likelier to matter.
- **Rewriting the split view's `@@` separator, the palette's rebase steps, or
  anything else the base picker touches.**

## Testing

- **Pure (`vitest`)** — `withPlanBase`: sets `onto` on the first non-Drop step;
  skips leading Drops; leaves other steps' `onto` untouched (the preserve case);
  identity for a null base and for an all-Drop plan; does not mutate its input.
- **Component (`jsdom`)** — the Rebase screen driven by a `rebase-onto` intent:
  the plan is built from `commits_between` with an `ahead`-derived limit; the
  summary strip's three sentences; `ahead === 0` yields a visible notice and no
  plan; a length mismatch refuses rather than planning a partial rebase; and
  after a reorder the submitted plan carries `onto` on the **new** first row.
- **Rust integration** — a genuinely diverged base: two branches off a common
  root, `commits_between` as the range, `rebase_start` with `onto` on the first
  step. Asserts the resulting history, that the branch ref moved and HEAD is
  attached to it, that `ORIG_HEAD` is the pre-rebase tip, and that the side
  branch's files survive. Plus the free-form path: a 7-char prefix and a branch
  name are accepted as `onto` and land on the same commit as the full oid — that
  is the "check the free-form path resolves through the backend" item, and it is
  the *common* path now that a diverged base is usually outside the loaded log.
- **E2E** — `e2e/specs/rebase.e2e.ts` covers this screen and is run for the
  change. A new case drives the History menu's new item on a diverged commit if
  the fixture is cheap; the routing itself is already proven by
  `AppShell.navroutes.test.tsx`, which drives the real shell.
