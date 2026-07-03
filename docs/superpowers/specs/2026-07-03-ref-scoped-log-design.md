# Ref-scoped history log — design

**Status:** approved
**Date:** 2026-07-03
**Owner:** jonas
**Related:** issue #27, `docs/superpowers/plans/2026-07-02-e2e-phase2.md`
(cherry-pick e2e test skipped pending this)

## Why

Both `log()` and `log_filtered()` (`src-tauri/src/git/libgit2.rs`) revwalk
with `push_head()` only. Every commit surface in the app — the History list
under all client-side filters, the commit context menu, the palette commit
pickers — reads the same HEAD-only `useRepoStore.commits` array. Consequences:

1. Commits reachable only from an unmerged branch can never be displayed.
2. There is no in-app way to cherry-pick a commit from another branch —
   the single most common reason to look at another branch's log.

Found while writing e2e phase 2: the cherry-pick test in
`e2e/specs/history-ops.e2e.ts` is `it.skip`'d with empirical evidence that no
UI path can surface the fixture's `feature`-only commit.

## Scope

### In scope

- `GitBackend::log` and `GitBackend::log_filtered` gain an optional
  `refspec: Option<&str>` start point. `None` keeps today's behavior (HEAD);
  `Some(spec)` walks from any revspec (branch, tag, oid). Unresolvable spec →
  `AppError::InvalidRef` (existing variant, same as `commits_since`).
- `get_log` / `get_log_filtered` commands accept an optional `refspec` param
  (same command names — no new registration needed, existing callers unaffected).
- `useRepoStore` gains `logRef: string | null` + `setLogRef(refspec)`.
  `refreshAll` and `searchCommits` thread `logRef` through, so backend search
  stays scoped to the browsed ref and post-op refreshes keep the scope.
  `openRepo`/`closeRepo` reset it.
- History screen: a ref selector (`PGSelect`) in the toolbar listing HEAD +
  local branches. Selecting a branch reloads the log scoped to it. The
  existing commit detail pane + action row (cherry-pick, revert, branch, tag)
  work unchanged on the scoped list — that is the cherry-pick-from-branch UX.
- `PGSelect` learns a `data-testid` prop threaded to the native `<select>`
  (needed by e2e; PGSelect does not spread rest today).
- Unskip + rewrite the cherry-pick e2e test to use the ref selector.

### Out of scope

- `--all` / multi-tip walks (graph layout is single-tip today; a follow-up).
- Remote branches / tags in the selector (revspec plumbing supports them;
  UI keeps the list short — local branches cover the cherry-pick use case).
- Persisting the selected ref across sessions.
- Branch-picker "browse this branch's log" entry point (selector suffices;
  can be added later as a nav intent).

## Design

### Backend

Single shared helper in `libgit2.rs`:

```rust
/// Push the walk start. None → HEAD (Ok(false) when unborn: caller returns
/// empty). Some(spec) → any revspec, peeled to a commit; InvalidRef if it
/// doesn't resolve.
fn push_log_start(repo: &Repository, walk: &mut Revwalk, refspec: Option<&str>) -> AppResult<bool>
```

`log` and `log_filtered` both call it; `log_filtered`'s unborn-HEAD precheck
folds into the helper. Ref decoration (`collect_ref_map`) is unchanged — it
already collects all refs, so browsed-branch tips render their badges.

### Frontend

- Store keeps ONE commit list (`commits`) — the scoped log replaces it rather
  than living beside it. Rationale: every consumer (History, palette pickers,
  context menus) reading one array is exactly the property that made the bug
  total; keeping a single array means they all gain ref-scoping for free, and
  "the list you see is the list you act on" holds everywhere.
- `setLogRef` refetches only the log (not full `refreshAll`), guards against
  stale responses (same pattern as `searchCommits`), and re-runs an active
  search under the new scope.
- History "This branch" / "Mine" toggles remain client-side refinements on the
  scoped list, as today.

## Acceptance

- A commit reachable only from an unmerged local branch can be viewed and
  cherry-picked onto the current branch from the UI.
- The cherry-pick e2e test in `history-ops.e2e.ts` is unskipped and passes.
- HEAD-scoped behavior (default) is byte-identical to before.
