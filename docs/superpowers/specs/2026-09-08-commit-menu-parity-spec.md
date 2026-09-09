# Commit context-menu parity with Rider

Status: approved for implementation.
Issue: none — raised in session from a screenshot of Rider's commit context menu.

## Goal

Bring the History commit context menu up to what Rider's offers. The user
supplied Rider's menu; this spec covers the entries we do not have.

The app already defaults to `RIDER_PRESET` for keybindings
(`src/features/keymap/presets.ts:265`), so matching Rider's *menu* is a
continuation of a choice this codebase already made, not a new direction.

## What already works, verified in the tree

Read, not assumed. `commitMenuItems` (`src/design/context-menu.tsx:476`) already
covers 11 of Rider's 20 entries:

| Rider | ours |
| --- | --- |
| Copy Revision Number | `Copy SHA` (plus `Copy subject line`) |
| Cherry-Pick | `Cherry-pick onto current` |
| Checkout Revision | `Check out this commit`, plus a `Check out branch` submenu Rider lacks |
| Compare with Local | `Compare with HEAD` |
| Reset Current Branch to Here… | `Reset current branch to here` → Soft/Mixed/Hard |
| Revert Commit | `Revert commit` |
| Fixup… | `Fixup this commit into its parent` |
| Squash Into… | `Squash this commit into its parent` |
| Interactively Rebase from Here… | `Interactive rebase from here` |
| New Branch… | `Create branch from here…` |
| New Tag… | `Create tag here…` |

We also carry entries Rider does not: `Rebase current branch onto this`, the
bisect submenu, `View diff`, user-defined custom actions, and a multi-select
menu with combined diff + squash-range.

Machinery the new entries reuse rather than re-invent:

- **`buildRebasePlan`** (`src/features/commits/buildRebasePlan.ts`) already has
  `edit-from` / `fixup` / `squash` / `squash-range` modes, and
  **`runRebasePlanNow`** (`runRebasePlan.ts`) already runs a plan straight from
  the menu without a detour through the Rebase screen. Squash and Fixup are
  built exactly this way today, so Reword and Drop are new *modes*, not new
  plumbing.
- **`RebaseAction::Reword` already exists end to end** — the TS union
  (`src/lib/types.ts:502`), the Rust enum (`git/types.rs:762`), and a working
  backend arm (`git/libgit2.rs:971`). Nothing in the backend needs teaching what
  a reword is; only the menu cannot reach it.
- **`RepoBrowser` already browses at a revision** — `listFilesAtRev`,
  `readFileContentAtRev`, a "Browsing {rev}" header and an `@ {rev}` badge
  (`src/screens/RepoBrowser.tsx:202,262,963,1161`). `rev` is set from exactly one
  place today, the toolbar (line 1022). It has no entry point from a commit.
- **`ahead_behind`** (`commands/commits.rs:128`) returns `{ahead, behind,
  mergeBase}`, so "is this commit already published" is one IPC call:
  `behind === 0` against the branch's upstream means the commit is contained in
  it.
- **`forge/remote.rs`** already parses a remote into host / owner / repo / kind,
  and `forge/mod.rs:12` documents `github.rs` / `gitlab.rs` as "per-forge URL
  builders and response parsers. Pure." A commit URL is a new builder beside the
  ones already there.
- **`open_url`** is the one validated opener path — https-only via
  `opener::safe_url`, already used by `useForgeStore.openInBrowser`.
- **`dialog:allow-open` is already granted** in
  `src-tauri/capabilities/default.json:25`, and `open({directory: true})` is the
  same call Clone / Init / Worktree dialogs already make. Create Patch needs **no
  new Tauri permission** — `format-patch` names its own files, so no
  `dialog:allow-save`.
- **`pgChoose` / `pgPrompt` / `pgConfirm`** (`src/design/dialog.tsx`) cover every
  dialog below. Squash already composes its message in `pgPrompt({multiline: 8})`,
  so a reword prompt is a use of an established surface, not a second
  commit-message composer beside `features/commits/message/`.

### Four findings that shape the design

1. **The rebase engine refuses a dirty worktree.** `rebase_start_with_progress`
   (`git/libgit2.rs:6190`) checks `repo.statuses` and bails on any wt/index
   modification (`libgit2.rs:6242`). Rewording HEAD — the most common reword —
   would therefore fail whenever anything is uncommitted. This is why HEAD gets
   its own path instead of a one-step rebase plan.

2. **`commit(amend: true)` is not a message-only amend.** It writes the *index*
   tree (`fresh_index(repo)?; index.write_tree()?` at `libgit2.rs:5075`), so it
   would silently fold staged changes into the commit being reworded. A
   message-only amend must pass `tree: None` to `commit.amend`, which reuses the
   original tree — git's `commit --amend --only -m`.

3. **The chord model is single-stroke only.** `chord.ts` normalizes modifiers +
   one base key, plus a synthetic `DoubleShift`. Rider's `Ctrl+R, R` is a
   two-stroke sequence that cannot be expressed today. Combined with the decision
   below, no keybindings are in scope.

4. **History's selection is local component state**, not a store —
   `React.useState<Selection>` at `src/screens/History.tsx:135`. A menu builder
   living in `src/design/` cannot reach it, which is why Go to Parent/Child takes
   a callback.

## The eight entries

### 1. Edit Commit Message…

Two paths, forced by finding 1.

**HEAD** → a new backend op. `commit.amend` with `tree: None` is message-only:
it ignores the index and works with a dirty worktree. The op takes the oid the
menu was built from and **verifies HEAD still equals it inside the same
`with_repo` acquisition as the amend** — the stash-TOCTOU rule; HEAD can move
between opening a menu and clicking it. It routes through the existing
`commit_signed` chain, so a signed commit stays signed.

**An older commit on HEAD's ancestry** → `buildRebasePlan` gains
`{ kind: "reword", targetOid, message }`, run through `runRebasePlanNow`. Base is
the commit's first parent, so the target is inside the plan.

Prompt: `pgPrompt({ multiline: 8, requireValue: true })` prefilled with the full
existing message. `combinedSquashMessage` already renders `summary\n\nbody` for a
list of oids; the single-commit case is extracted as `fullCommitMessage(commit)`
and `combinedSquashMessage` is rewritten to call it, so one function owns "what
is this commit's message as text".

**An unchanged message is a no-op.** Rewriting a SHA because someone opened the
prompt and pressed Save changes every downstream ref for nothing.

Enablement:

- Not on HEAD's ancestry → disabled, label says why (matching how the existing
  rebase entries name their own refusal).
- A merge commit is disabled **on the rebase path only**. `buildRebasePlan`
  always emits `Drop` for a merge, so rewording an older merge would flatten
  history. Amending HEAD's own message keeps its parents, so a merge at HEAD
  stays allowed — the restriction follows the mechanism, not the commit shape.

### 2. The published-commit warning (cross-cutting)

A shared helper: for the commit about to be rewritten, `ahead_behind` against the
current branch's upstream; `behind === 0` means it is already published, and the
confirm dialog gains a line saying the next push will have to be forced.

Wired into **all five** rewrite entries — Edit Commit Message, Drop Commit, Undo
Commit, and **retrofitted onto the existing Squash and Fixup**. Five entries that
rewrite history splitting into two behaviours is the inconsistency this codebase's
conventions exist to prevent.

Cost is one IPC call per *invoked action*, not per right-click: the check runs
inside `onClick`, never while building the menu. Building the menu must stay
synchronous and free — it is rebuilt on every right-click.

No force-push is offered. A network write behind a menu item that does not
mention pushing is a surprise, and force-with-lease is its own design question.

### 3. Drop Commit

`buildRebasePlan` gains `{ kind: "drop", targetOid }`: the target becomes `Drop`,
everything newer stays `Pick`, base is the target's first parent. Danger-styled
`pgConfirm` plus the §2 warning.

Disabled for a merge: `buildRebasePlan` already emits `Drop` for merges to mean
*flatten this branch*, which is not what a reader clicking "drop this commit"
asks for.

### 4. Undo Commit…

HEAD only — Rider greys it elsewhere too. Soft-reset to the parent, leaving the
commit's changes staged, which is what "undo the commit, keep the work" means.

No new backend op: this is a named entry over `reset(parentOid, "Soft")` with a
confirm that states the outcome. It earns its place because discovering it today
means right-clicking a *different* commit (the parent) and reaching into a
submenu — the entry names the intent instead of the mechanism.

### 5. Show Repository at Revision

New `NavIntent { kind: "browse-rev"; rev: string; label: string }`, routed in
`AppShell` — compile-enforced by `assertNever` and pinned by
`AppShell.navroutes.test.tsx` — and consumed by `RepoBrowser`, which already has
everything else it needs.

### 6. Go to Parent / Child Commit

`commitMenuItems(commit, opts?)` gains an optional `onGoTo?: (oid: string) =>
void`. History supplies it; the callback owns selection and scroll. This is the
same callback-parameter shape `PGErrorBanner`'s `onReport` uses, and for the same
architectural reason: `src/design/` cannot reach the state it needs.

- **Parent**: `parents[0]` as an inline entry; a merge offers a submenu of all
  parents, each labelled `<short> — <subject>`.
- **Child**: a reverse-parent scan of the loaded log. **The log is paged** —
  `s.commits` is a prefix of history, never the answer to a containment
  question — so a child that is not loaded gives a *disabled entry naming why*,
  never a wrong jump. Zero children → disabled; one → inline; several → submenu.
- When `onGoTo` is absent (the menu used outside History) both entries are
  **omitted entirely** rather than rendered dead.

Scrolling goes by offset, not `scrollIntoView`: History's list is windowed and
the target row is usually unmounted.

### 7. View in browser

A pure `commit_web_url` builder per forge beside the existing ones — GitHub
`https://<host>/<owner>/<repo>/commit/<sha>`, GitLab
`https://<host>/<owner>/<repo>/-/commit/<sha>` — behind a command returning
`Option<String>`. `None` (no remote, or a remote that is neither forge) disables
the entry.

Opened through `open_url`. **Privacy gates stay green by construction**: the host
comes from the user's own remote, so no hostname is hard-coded and
`test/privacy.test.ts`'s allow-list is untouched; and nothing is sent — the app
hands a URL to the user's browser, exactly as the issue reporter does.

### 8. Create Patch…

libgit2 has no `format-patch`, so this shells out — via `proc::git`, never
`Command::new` (a guard test fails the build otherwise). Per commit, in ancestry
order:

```
git format-patch -1 <sha> -o <dir> --start-number <n>
```

One invocation per commit with an explicit `--start-number` is what makes a
multi-select come out correctly numbered; separate invocations would each restart
at `0001`.

Format is the **mailbox** form, not a plain unified diff: it preserves author,
date and full message, so `git am` reconstructs the commit exactly. Rider's own
Create Patch emits a plain diff, and this is a deliberate divergence — a
git-native tool should hand you the artifact a maintainer expects to receive. A
plain diff is already partly served by `diff.copy` / `fileDiffToText`.

Directory chosen with `open({ directory: true })`. Disabled for a merge, which
`format-patch` skips by default. Joins the multi-select menu beside
`Squash N into one…`.

### 9. Push All up to Here…

Pushes `<oid>:refs/heads/<branch>` through
`commands::net::run_git_authenticated` — the one credential path. Secrets in env,
never argv; `--` before user-supplied values.

Target is the current branch's upstream; disabled without one, and disabled for a
commit not on the current branch. **Fast-forward only — no force in this batch.**
A non-fast-forward is refused by the remote and the refusal surfaces in
`PGErrorBanner` like any other network error.

The confirm names the real effect — "Push 3 of your 7 commits to origin/main?" —
using `ahead_behind` for both counts. Being a long-running op that can raise a
credential challenge, it joins `RepoActivity` with `withAuthRetry` owning the
label via `{ key, label }`, never a `finally` at the call site.

## Menu order

Grouped to follow Rider's own grouping, since the keymap already defaults to
Rider's:

```
commit <short>
  Check out branch ▸ / Check out this commit
  Show repository at this revision      ← new
  Compare with HEAD
  ─
  Cherry-pick onto current
  Create patch…                         ← new
  ─
  Reset current branch to here ▸
  Revert commit
  Undo this commit…                     ← new
  ─
  Edit commit message…                  ← new
  Fixup this commit into its parent
  Squash this commit into its parent
  Drop this commit                      ← new
  Interactive rebase from here
  Rebase current branch onto this…
  Push all up to here…                  ← new
  ─
  Create branch from here…
  Create tag here…
  ─
  Go to parent commit / ▸               ← new
  Go to child commit / ▸                ← new
  ─
  Bisect ▸
  ─
  View diff
  Copy SHA / Copy subject line
  View in browser                       ← new
  ─
  <custom actions>
```

## The file this lands in

`src/design/context-menu.tsx` is 2522 lines and `commitMenuItems` is ~250 of
them, so eight more entries with their flows inline makes a bad file worse.

**Splitting that file was considered and rejected.** Moving `commitMenuItems`
out requires also extracting the `ContextMenuItem` type (declared there,
consumed by ~15 builders), `customActionItems` and `headBranch`, all three
shared with the file and file-multi builders — otherwise the new module and
`context-menu.tsx` import each other. That is three new modules and a
restructure of the type every menu builder depends on, for a file the work only
passes through. It also invites exactly the conflict class recorded in
`docs/dev/` about large `main` refactors: several sessions work this repo at
once, and a moved 2500-line file makes every other branch that touched it look
partly unlanded.

Instead, **each entry's flow lives in its own `features/commits/` module** and
the menu entry is a few lines that call it. That is already this codebase's
shape — `buildRebasePlan`, `runRebasePlan`, `squashMessage` and `stackedRefs`
all live there and are all called from `commitMenuItems` today. The menu file
grows by tens of lines rather than hundreds, and every flow becomes unit
testable without rendering a menu:

| module | owns |
| --- | --- |
| `features/commits/commitMessageText.ts` | `fullCommitMessage(commit)` — a commit's message as text; `combinedSquashMessage` is rewritten to call it |
| `features/commits/rewriteWarning.ts` | the §2 published-commit check and the confirm line it adds |
| `features/commits/rewordCommit.ts` | prompt → HEAD amend or reword plan |
| `features/commits/dropCommit.ts` | confirm → drop plan |
| `features/commits/undoCommit.ts` | confirm → soft reset to parent |

## Decisions taken, with reasons

1. **Hooks on a message-only amend: run `prepare-commit-msg` and `commit-msg`,
   skip `pre-commit`.** Git runs all three, so this is a documented deviation. A
   hook that validates message format is exactly what should fire on a reword; a
   hook that runs tests has nothing to check when the tree is unchanged by
   construction. `no_verify` skips all of them, as everywhere else.
2. **The HEAD path preserves signatures; the rebase path does not.** The engine's
   `Reword` arm uses bare `head.amend` (`libgit2.rs:971`) and drops the
   signature. That is a pre-existing gap in the rebase engine, recorded here and
   **not fixed in this batch** — it affects every existing rebase reword, so it
   is its own change with its own tests.
3. **No force-push anywhere.** Not offered after a rewrite, not available on Push
   all up to here.
4. **Undo Commit is HEAD-only.**
5. **Squash stays parent-only.** Rider's "Squash Into…" picks an arbitrary
   target; our multi-select squash-range covers the common case and widening it
   is not part of this work.
6. **No keybindings and no keymap actions.** Finding 3 rules out Rider's
   `Ctrl+R, R` without a new sequence layer in the chord core, and that layer is
   a separate feature from these menu entries. The new entries are menu-only,
   consistent with how Squash, Fixup and Reset ship today.

## Out of scope

- A prefix-key / two-stroke chord layer (finding 3).
- Signing on the rebase engine's reword path (decision 2).
- Force-push, with or without lease (decision 3).
- Plain-unified-diff patch export (§8).
- Squash into an arbitrary target (decision 5).
- Rider's `Show Repository at Revision` opening a *second window* — ours reuses
  the RepoBrowser screen in place.

## Testing

Per layer, following `docs/dev/testing.md`:

- **Rust integration** (`cargo test`, real temp repos): the message-only amend
  keeps the tree and the author while changing the message and the oid; it
  refuses when HEAD has moved off `expected_oid`; it preserves a signature; it
  works with a dirty worktree and a dirty index, and leaves both untouched.
  `format-patch` numbering across a multi-commit export. The push refspec builds
  what is expected.
- **Frontend logic** (`pnpm test`): `buildRebasePlan`'s new `reword` and `drop`
  modes; `fullCommitMessage`; the published-commit predicate; child lookup
  returning zero / one / several and the not-loaded case; the per-forge URL
  builders.
- **Component**: each new entry's enabled/disabled state and the reason in its
  label; the no-op guard on an unchanged message; `onGoTo` absent → entries
  omitted.
- **Doc invariants** (`pnpm test`, `docs` project): every new command is added to
  `docs/dev/architecture.md` in the same commit, or `test/docs.test.ts` fails the
  build.
- **E2E**: the reword flow and the browse-at-revision flow, in the existing
  history-ops spec. Read the `e2e-testing` skill before writing them; run only
  the touched specs, in Docker, after rebuilding the snapshot.

## Delivery

Five PRs, grouped by shared machinery rather than by menu entry, each merged
before the next branches off `main`:

| PR | Entries | New backend op |
| --- | --- | --- |
| 1 | §2 warning, Edit Commit Message, Drop, Undo Commit | message-only amend |
| 2 | Show Repository at Revision, Go to Parent / Child | — |
| 3 | View in browser | commit web URL |
| 4 | Create Patch… | format-patch |
| 5 | Push All up to Here… | push refspec |
