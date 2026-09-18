# Fast history on a million-commit repository (#483)

> Issue: #483 · umbrella #476 · predecessor #473 (whose two defects #479 fixed)

Opening `torvalds/linux` costs **15.7 seconds** before anything is painted, and
every one of those seconds is a single libgit2 call. #479 already fixed the two
defects that made *paging* expensive; what is left is the first walk, and it is
now the whole of the large-repo problem.

This spec covers two changes that are independent and separately shippable:
stop making the user wait for work that is already finished, and stop doing the
expensive walk at all.

All figures below were measured on 2026-09-18 against `main` at `4c6b5ed`, on an
Apple M4 Pro (14 cores, 48 GB) with git 2.50.1, on an otherwise idle machine.
Method: `docs/dev/performance.md`.

## Where we actually are

`pnpm bench --fixture linux`, current `main`:

| operation | first call | repeat | `git` work |
| --- | --- | --- | --- |
| Everything the first screen needs, at once | **15,743 ms** | 15,715 ms | — |
| First page of history | 18,112 ms | 13.5 ms | 9,665 ms |
| Page ten of history | 15,842 ms | 112 ms | 9,726 ms |
| Working-tree status | 1,029 ms | 1,011 ms | 538 ms |
| History of one file | 15,938 ms | 15,799 ms | 5,352 ms |

Two readings, and the second is the point of the table.

**#479 worked.** Page ten was 157.67 s when #473 was filed and is **112 ms**
now — the prepared order is reused instead of rebuilt, exactly as designed. The
published record in `README.md` and `docs/dev/performance.md` still says
157.67 s, because #479 deliberately published no after-numbers while two
sessions shared `$PGBENCH_HOME`. Re-publishing is part of this work.

**The first call is untouched, and it is everything.** `open_screen` is 15.7 s
and the first page of history is 15.9 s of it; the other ten reads on that fan-
out are milliseconds. A repeat costs 13.5 ms because it is a cache hit, but a
user opening a repository always pays the first call, which is why
`open_screen` — which builds a fresh backend per sample — is the honest number.

## Root cause, at source level

`build_walk_order` (`git/libgit2.rs`) sorts with
`Sort::TIME | Sort::TOPOLOGICAL`, because a commit graph's lane assignment needs
every parent to come after its children. In libgit2 1.9.7 — what `git2 0.21`
vendors — that sort is not incremental in any sense:

* `git_revwalk_sorting` ends with
  `if (walk->sorting != GIT_SORT_NONE) walk->limited = 1;`
* so `prepare_walk` runs `limit_list` over the **whole reachable graph**,
* then `sort_in_topological_order` materialises the **complete ordered list**,
* all before the first oid is yielded.

`limit_list`'s only early exit is a `SLOP` heuristic on *uninteresting* commits.
A plain `push_head` walk marks none, so it never fires.

Measured with a throwaway probe against the kernel — getting one oid and getting
two thousand cost the same thing, which is the signature of a walk that has
already finished by the time it yields:

| libgit2 walk | first oid | 2,000 oids |
| --- | --- | --- |
| `TIME \| TOPOLOGICAL` | 16,568.3 ms | 16,568.5 ms |
| `TOPOLOGICAL` | 14,731.3 ms | 14,731.5 ms |
| `TIME` | 14,786.6 ms | 14,791.6 ms |

**The commit-graph is git's answer to exactly this, and libgit2 throws it
away.** `commit_list.c` reads the file — `git_commit_list_parse` takes parents,
commit time and `generation` from it. `revwalk.c` contains **zero** references
to the commit-graph or to generation numbers, and across all of libgit2's `src/`
`->generation` is read in exactly two places: `graph.c` and `merge.c`. The
numbers are populated and then ignored by the one code path that would benefit.

So no amount of work inside libgit2's revwalk API makes this faster. The walk
has to come from somewhere else.

## The ordering, which is not what #473 and #476 assumed

Both issues propose shelling out to `git log --topo-order`, and the benchmark's
own baseline is `--topo-order`. **That is the wrong ordering**, and adopting it
would silently change which commits the first page contains.

Measured on the kernel, first 2,000 oids, libgit2's output compared byte for
byte against `git rev-list`:

| libgit2 sorting | vs `--date-order` | vs `--topo-order` |
| --- | --- | --- |
| `TIME \| TOPOLOGICAL` (what `log_page` uses) | **IDENTICAL** | differ at line 6; 1,627/2,000 shared members |
| `TOPOLOGICAL` | differ at line 6 | **IDENTICAL** |

`Sort::TIME | Sort::TOPOLOGICAL` is Kahn's algorithm over a time-priority queue,
which is precisely git's `--date-order` ("no parent before its children,
otherwise commit-timestamp order"). `--topo-order` additionally avoids
interleaving independent lines of history, which is a *different question* — it
does not merely reorder the same 2,000 commits, it returns a different 2,000.

**The drop-in replacement is `git rev-list --date-order`.** The benchmark's
`--topo-order` baselines are the right cost class and the wrong ordering; they
are corrected as part of this work.

## What the replacement costs

`git rev-list` against the same kernel clone. `MAX_ORDER` is 100,000, so the
100,000 row is the one this design actually runs:

| command | no commit-graph | with commit-graph |
| --- | --- | --- |
| `rev-list --date-order -500` | 10,085 ms | **47 ms** |
| `rev-list --date-order -100000` | 10,123 ms | **188 ms** |
| `rev-list --topo-order -100000` | 10,123 ms | 183 ms |
| `rev-list --date-order`, all 1,482,923 | — | 1,578 ms |

Without a commit-graph, git is no better than we are — 10 s against our 15.7 s,
same failure for the same reason. **The commit-graph is not an optimisation on
top of this design; it is the design.** With it, the walk we run today for
15,743 ms costs 188 ms — 84×.

## Design

### Stage 1 — paint the repository before history arrives

`useRepoStore.refreshAll` is one `Promise.all` over eleven reads with a single
`set()` after all of them resolve. On the kernel, status (1.0 s), branches
(0.9 ms), tags (19 ms) and HEAD are all finished within a second and then wait
fourteen more for the log.

Split the commit page out of the `Promise.all` so it lands in its own `set()`.
The other ten keep their joint write — they are collectively fast, and the
`loadingTasks` machinery (#296) already names whichever read is still running,
so the status bar can say "loading history" against a painted screen instead of
an empty one.

This is independent of everything below. It helps every slow repository — a
`/mnt/c` checkout under WSL, a 55,000-entry `status` — and it helps on a machine
with no git installed at all, where Stage 2 cannot.

**Not in this stage:** streaming a partial page. Emitting commits as they are
walked is worthless here, because libgit2 yields *nothing* until the walk is
complete; there are no early rows to stream. Stage 2 removes the wait rather
than decorating it, and a streaming protocol added first would be built against
a cost that Stage 2 deletes.

### Stage 2 — take the order from git, keep a commit-graph warm

**The seam is `build_walk_order`.** It is one function,
`(&Repository, &[Oid]) -> AppResult<WalkOrder>`, and `WalkOrder` is
`{ starts, order: Vec<Oid>, complete: bool }`. Everything downstream — the walk
cache, `FrontierBuilder`, cursors, ref decorations, `commit_to_info` — consumes
that struct and does not care how the oids were produced.

So only the *order* crosses over from git. Commit metadata still comes from
libgit2 via `repo.find_commit`, which means no commit parsing, no format string
to keep in sync, no encoding questions, and no change to `CommitInfo`.

```
build_walk_order(repo, starts) -> WalkOrder
  ├─ git path:  git rev-list --date-order --max-count=<MAX_ORDER> <starts...> --
  │             parse 40-char oid lines; `complete` = (lines < MAX_ORDER)
  └─ fallback:  today's libgit2 revwalk, unchanged
```

Argv safety follows the house rule: start oids are hex the backend resolved
itself, never user text, and option parsing still ends with `--`. The subprocess
goes through `proc::git`, never `Command::new`.

**When the fallback is taken:** git missing or not executable, a non-zero exit,
output that does not parse as oids, or the repository being one git cannot walk.
A fallback is a slow page, never a failed one — the same degrade-don't-fail
policy `bisect_status` and the shallow read already follow in `refreshAll`.

**The commit-graph.** `--date-order` is only fast with one, and a fresh clone
has none: `git clone` does not write one and `gc --auto` does not fire on a
single packfile. So the app maintains it, in the user's repository, which is
what `git maintenance` and `git gc` already do there and what makes the user's
own `git log --date-order` fast too.

Three measured constraints shape how:

| | cost on the kernel |
| --- | --- |
| `commit-graph write --reachable`, cold | 14,509 ms |
| `commit-graph write --reachable`, **already fresh** | 14,305 ms |
| `commit-graph write --reachable --split`, cold | 14,531 ms (97 MB) |
| `commit-graph write --reachable --split`, no new commits | **59.9 ms** |

1. **`--split` is mandatory.** Plain `--reachable` rewrites the whole file every
   time — it re-pays 14.3 s on a repository where nothing changed. `--split`
   costs 60 ms in that case.
2. **The first write is 14.5 s**, so it runs in the background, after the first
   screen is painted, and never blocks a page. The first open of a giant
   repository is served by the libgit2 fallback and is exactly as slow as today;
   the second is fast. This is stated plainly rather than hidden — a one-time
   cost the user does not wait for.
3. **It is a write into the user's repository**, so it obeys them: skip entirely
   when `core.commitGraph` is false, and never write into a repository that is
   not writable.

**On the Settings switch.** An earlier draft of this spec promised one. It is
NOT implemented, deliberately: settings in this app are `localStorage` on the
frontend, and the commit-graph write is a backend decision, so a switch would
need a new Tauri command to write git config — a new user-facing surface, in a
change that already touches the hottest read in the app. The opt-out that
matters exists and is tested: `core.commitGraph`, which is git's own knob,
which a user may already have set, and which we would have to honour anyway.
A Settings row that presents it belongs in its own change.

The write is scheduled once per repository per session, on open, behind the
same cancellation the other long reads use.

### What this does not change

* No `GitBackend` trait change, no new Tauri command, no new `AppError`
  variant, no IPC type change. `LogPage` is what it was.
* `log_cache.rs` is untouched. Its invalidation story — first page keyed by
  start oids, continuation keyed by nothing because commits are immutable,
  decorations by a ref fingerprint — is unaffected by where the order came from.
* `file_history` is **not** fixed here. It is 15.9 s on the kernel and it is the
  same root cause in a different walk, but it has its own cap, its own
  cancellation and its own cursor semantics (#474, #478). It gets its own issue
  once this lands and the shape of the git-backed walk is proven.

## Testing

* **The ordering is pinned by a characterization test**, not by this document.
  A Rust integration test builds a repository with merges committed out of
  date order, walks it both ways, and asserts the two sequences are equal.
  That test is what makes "`--date-order` is the drop-in" a fact the build
  checks rather than a claim in a spec. It is written first, and it must fail
  against `--topo-order`.
* **The fallback is exercised deliberately** — a test that points the backend at
  an unusable git and asserts the page is still correct, because a silent
  permanent fallback would look exactly like success while costing 15 s.
* `log_walk_cache.rs` already drains the same history cold and warm and compares
  the sequences; it keeps doing so and now covers both producers.
* **E2E:** `history.e2e.ts` (or the closest existing spec) for the split
  fan-out, because "the repository paints before history" is a rendering claim
  and the unit layer cannot see it.
* **`pnpm bench --linux` on a quiet machine**, published in the same commit —
  `test/benchmark.test.ts` re-renders `README.md` and both `docs/dev/` artifacts
  from one record and fails if they disagree.

## Risks

| risk | how it is handled |
| --- | --- |
| The order changes silently and lanes re-draw | The characterization test above. This is the risk that made `--topo-order` look acceptable in two issues. |
| git absent → every page pays 15 s and nothing says so | The fallback is a measured, logged event, and the diagnostics line already spells `git=UNAVAILABLE` as a fault. |
| A 97 MB file appears in the user's repository | It is what `git gc` writes there anyway, it is derived, `core.commitGraph=false` opts out, and Settings names it. |
| Subprocess cost per page | 12.4 ms spawn floor on this machine, measured by the benchmark, against 188 ms of work and 15,743 ms saved. |
| `--split` leaves many graph layers over time | git's own `--split` heuristics collapse layers; the benchmark's repeat rows would show the drift. |

## Acceptance criteria

Closable on evidence, from `pnpm bench --linux`:

* **First screen on `torvalds/linux` under 1.5 seconds** on a repository whose
  commit-graph is current (today: 15,743 ms), **and bounded by `status` rather
  than by the log**. The second clause is the real criterion: `status` alone is
  1,029 ms on that tree, so a screen that is merely "under a second" is not
  reachable and a screen still gated on history would pass a wall-clock target
  by accident. Once this lands, `status` is the next problem, and it is a
  different one — it is already only 1.9× git's own work.
* **First page of history under 500 ms**, first call, same condition
  (today: 18,112 ms).
* On a repository with **no** commit-graph and no git binary, no regression:
  the libgit2 path is what it is today.
* No regression on the generated fixtures — `deep` stays ≈253 ms, `refs`
  ≈219 ms, `wide` ≈5.42 s.
* The published record in `README.md` and `docs/dev/performance.md` matches a
  run made after the change, on a quiet machine.
