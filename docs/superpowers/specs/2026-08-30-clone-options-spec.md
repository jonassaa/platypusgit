# Clone options, and staying honest about shallow (issue 255)

Status: approved for implementation.
Issue: [255](https://github.com/jonassaa/platypusgit/issues/255).

## Goal

Cloning is all-or-nothing today: full history, every branch. On a large
repository that is the difference between a usable first five minutes and a
coffee break. Give the Clone dialog the four options that answer it — `--depth`,
`--filter=blob:none`, `--single-branch`, `--recurse-submodules` — behind a
collapsed **Advanced** section so the default stays URL + folder + Clone.

And then the part that actually matters: **a repository cloned that way has to
stay honest afterwards.** A shallow clone's history genuinely stops. Blame
attributes everything older than the boundary to the boundary commit. A merge
base older than the boundary is simply not there, so Compare's ahead/behind is
arithmetic over a truncated graph. None of that looks like an error — it looks
like a repository with a short history and a strange blame, which is worse.

## What is true in the tree, verified by reading it

- `grep -ni "depth\|shallow\|--filter" src-tauri/src/commands/create.rs` returns
  nothing. `clone_args(url, name, recurse_submodules)` builds
  `-c protocol.ext.allow=never clone --progress [--recurse-submodules] -- <url>
  <name>`, and `--recurse-submodules` is the ONE option that already exists (it
  is the dialog's "Initialize submodules" checkbox).
- `run_clone` already owns everything hard about a clone: the destination
  validation, the streamed `--progress` stderr, the cancel registration
  (`cancel::Scope::Clone`), the partial-destination cleanup, and the credential
  env via `commands::net::apply_auth_env` + `map_git_failure`. Options are flags
  on THAT — there is no second clone implementation to write, and there must not
  be one.
- `git2 0.20.4` binds `Repository::is_shallow()`
  (`git_repository_is_shallow`), which stats `<commondir>/shallow` on every
  call — no caching, so a cached `git2::Repository` (which is what
  `Libgit2Backend` holds) reports the truth again the moment `--unshallow`
  removes the file. It does **not** bind `git_repository_shallow_roots`, so a
  count of boundary commits has to come from reading that file.
- `commands::net::run_git_authenticated_with_progress` is the one runner for a
  credentialed, cancellable, progress-reporting network op. `fetch`, `fetch_all`,
  `pull` and `push` go through it; `--unshallow` is a fetch, so it joins them
  rather than growing a path of its own.
- `RepoActivity` already has a `fetch` key, and `isCancellable` already includes
  it — an unshallow labelled under that key gets the status line, the progress
  bar and the Cancel button for free.
- History renders "Loading older commits…" at the bottom of the walk and
  otherwise just stops. Blame already has the shape this feature needs: a strip
  under the header (`blame-ignore-revs-warning`) that says something about the
  data below it without replacing it.

## The decisions

### 1. The flags are exactly what the checkbox says, including `--no-single-branch`

`git clone --depth N` **implies `--single-branch`** unless `--no-single-branch`
is given. So a dialog with a "Single branch" checkbox and a depth field would
lie in one direction: unticking "Single branch" while setting a depth would still
produce a single-branch clone.

`clone_args` therefore emits `--no-single-branch` when a depth is set and the box
is unticked. The checkbox means what it says on every combination; nothing is
implied behind the user's back.

### 2. Depth is a `u32`, and `0` is refused

`--depth 0` is `fatal: depth 0 is not a positive number`. That is a form
validation, not a git error to relay, so `clone_repo` raises
`AppError::InvalidArgument` before spawning. The type being unsigned already
rules out the injection shape; the value is formatted by us, never user text.

### 3. Shallow state is READ, never remembered

There is no `.git/platypusgit-shallow.json` and there must not be, for the same
reason `git/bisect.rs` has no state file: git owns `.git/shallow`, and a second
record could only disagree. `unshallow` in another window, a `git fetch
--unshallow` in a terminal, a fresh clone into the same tab — all of them are
picked up by the next `refreshAll`, because the answer is a `stat`.

`ShallowInfo` carries three facts:

- `shallow` — libgit2's `is_shallow()`.
- `boundaryCount` — how many commits the history stops at, read from
  `<commondir>/shallow`. Best-effort: an unreadable file leaves the count 0 and
  `shallow` true, because the boolean is the load-bearing half.
- `singleBranch` — every remote's fetch refspecs name one branch each (no `*` on
  the source side). This is `--single-branch`'s durable trace: it rewrites
  `remote.origin.fetch`, and the visible symptom — "where are my other
  branches?" — is the same class of silent wrongness as a truncated history.

### 4. Unshallow is `git fetch --unshallow`, with no user value in argv

One button, on the one op that actually undoes the truncation. It passes no
remote name: git resolves the default itself, which keeps the argument list free
of user-supplied text entirely, so there is no `--upload-pack=<program>` shape to
guard against. It runs through `run_git_authenticated_with_progress` like every
other network op — one credential path, cancellable, and it reports progress,
which matters because unshallowing `torvalds/linux` is the longest wait in the
app.

`unshallow` on a complete repository is `fatal: --unshallow on a complete
repository does not make sense`. The command checks `is_shallow()` first and
answers `Ok(false)` instead: the outcome the caller asked for already holds, and
a race against another window must not produce a red banner. `Ok(true)` means a
fetch actually ran.

### 5. **Deepen by N is deliberately absent.** One honest button beats two

`--deepen=N` would need a number field, a "how deep am I now?" readout the
`.git/shallow` boundary cannot honestly give (depth is per-branch, not a repo
property), and it leaves the repository shallow — so every truncation notice
would still be up afterwards. The user's actual question is "why does history
stop", and the answer with a button on it is "get the rest".

### 6. Widening a `--single-branch` clone is deliberately absent too

The remedy is rewriting `remote.<name>.fetch` in the user's config and then
fetching. That is a config mutation on the user's behalf, with a per-remote
choice to make, and it deserves its own change. This one says the fact out loud
instead of leaving the Branches screen quietly short.

### 7. Four surfaces, one component, one strip each

`ShallowNotice` is a strip under the screen's header — the shape Blame already
uses for its ignore-revs warning — on **History**, **File history**, **Blame**
and **Compare**. Each gets its own sentence, from a pure `shallowNoticeText`,
because the consequence differs per surface and a generic "this repo is shallow"
does not tell a reader of a blame what is wrong with the blame in front of them.

At the TOP of the screen, not at the end of the list. The end of the log is where
the truncation literally is, but a user who has 500 commits loaded never scrolls
there — and the fact is a property of the repository, not of the current scroll
position.

`test/shallowSurfaces.test.ts` fails the build for a fifth surface that forgets,
the same guard shape `diffFindSurfaces.test.ts` and `diffCopyMenu.test.ts` use.

### 8. `shallowInfo` is a per-repo slice field, read by `refreshAll`

It is the eleventh `trackLoad`ed read. Cheap (one `stat`, one in-memory config
walk), and it must be re-read after a fetch, an unshallow, or a tab switch —
which is exactly what `refreshAll` already means. Per-repo, so it joins
`RepoSlice`/`emptySlice`: a shallow clone in one tab must not put a truncation
notice on another tab's blame.

## Not in scope

- Deepen-by-N (§5) and widening a single-branch clone (§6).
- `--filter=tree:0`, `--sparse`, `--mirror`, `--bare`, reference clones. The two
  filters that matter for "a big repo you intend to work in" are depth and
  `blob:none`; the rest are their own feature with their own UI questions.
- `--shallow-submodules`. `--recurse-submodules` with a depth clones submodules
  at full depth, which is git's own default and the safer one.
- Teaching `fetch`/`pull` to pass `--depth`/`--deepen` on a shallow repo. Modern
  git fetches into a shallow repository without being told to, keeping it
  shallow; the honest UI answer is the truncation notice, not a hidden deepen the
  user did not ask for.
