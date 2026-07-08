# History inline commit diff (Fork-style) — design

**Status:** approved
**Date:** 2026-07-08
**Owner:** jonas
**Related:** issue #53 (spun out of #25). Precedes #54 (multi-select commits),
which reuses the inline diff panel introduced here.

## Why

Selecting a commit in History shows only **metadata** (author, subject/body,
parents) — reading the actual changes forces `Enter` → a full-screen jump to
`CommitDiffScreen`. That breaks the "scan the log, read each diff" flow Fork
nails: in Fork clicking a commit reveals its changed-files list + diff in an
attached panel, no navigation.

Worse, the current jump diffs the commit against **HEAD** (`commit-vs-wt`),
not against its own parent — so even after the jump you don't see "what this
commit changed."

## Scope

### In scope

- **New backend op `diff_commit(repo_id, oid, context_lines)`** → `Vec<FileDiff>`:
  the commit's own diff against its **first parent**. Root commit (no parent)
  diffs against the empty tree → all-added. Merge commit diffs against the
  first parent (git-show default). This is the correct "what changed in this
  commit" primitive; `diff_commits(from, to)` cannot express the root case.
  - Factor the existing delta→`FileDiff` conversion out of `diff_commits` into
    a shared `diff_to_file_diffs` helper so both ops share one implementation.
  - `CliBackend` gets the usual `NotImplemented` stub.
- **New nav intent `commit-self { oid }`** — "this commit vs its first parent."
  Distinct from `commit-vs-wt` (compare-to-working-tree, kept for the context
  menu / palette / FileHistory callers that genuinely want it).
- **Shared `CommitDiffPanel`** (`src/features/diff/CommitDiffPanel.tsx`):
  presentational file-list + per-file-hunk renderer, extracted from
  `CommitDiffScreen`'s body. Owns file selection + `useHunkNav` (F7/⇧F7)
  internally, keyed off a caller-supplied `paneIdPrefix` so two mount sites
  never collide in the focus store. Takes already-fetched
  `diffs` / `loading` / `error` — fetching stays in each container.
- **`CommitDiffScreen` refactor** — renders `CommitDiffPanel`; grows a
  `commit-self` target that fetches via `diffCommit`. Keeps `commit-vs-wt`,
  `commit-vs-commit`, `stash-diff` targets. Deep-link / full-screen path stays.
- **History inline diff** — on commit selection, fetch `diffCommit(oid)` and
  render `CommitDiffPanel` inline, alongside the existing metadata + action row.
  - **Layout toggle below / beside**, persisted to
    `localStorage["pg-history-diff-layout"]`. Fork-style **below** is the
    default. Panel is resizable + persisted (`pg-history-diff-h` for below,
    reuse `pg-history-detail-w` for beside).
  - `Enter` (and the list `onActivate`) now fires `commit-self` — the
    full-screen view shows the *same* diff as inline, not `commit-vs-wt`.
- **`PGResizeHandle` gains a vertical orientation** (`orientation:
  "horizontal" | "vertical"`, default horizontal) so the below-layout panel
  resizes by height. `usePaneWidth` is axis-agnostic already (a clamped,
  persisted number) — reused for height.

### Out of scope

- **Multi-select commits / combined range diff** — issue #54. Lands on top of
  this panel.
- Side-by-side (split) diff rendering — the panel keeps today's unified view;
  a split view is a separate cross-cutting change to all diff surfaces.
- Syntax highlighting inside the commit diff (unified view stays plain, same
  as `CommitDiffScreen` today).
- Changing `commit-vs-wt` semantics or the FileHistory / palette / context-menu
  callers that use it.

## Behavior

- Select a commit → metadata (unchanged) + inline diff of `parent..commit`.
- Root commit → every file shown as added. Merge commit → diff vs first parent.
- File list: ↑/↓ move selection, type-to-jump speed-search, click to select.
  F7/⇧F7 walk the selected file's hunks from either the file pane or the diff
  pane — identical to `CommitDiffScreen` because it's the same component.
- Toggle below/beside from a toolbar control; choice persists. Drag to resize;
  size persists per layout.
- `Enter` opens the same diff full-screen (`commitDiff` screen).

## Risks / notes

- Rapid ↑/↓ through the log must not hammer the backend: the inline fetch is
  cancellable (ignore stale responses) and debounced lightly.
- `paneIdPrefix` must be unique per mount site (`commitDiff.*` vs
  `history.diff.*`) — the two screens never mount together, but the focus
  store keys globally on pane id, so distinct prefixes are mandatory.
- Danger-op convention is unaffected (read-only diffing, no `useRepoStore`
  catch-arm changes).
