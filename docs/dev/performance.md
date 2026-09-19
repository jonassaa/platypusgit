# Performance — the large-repo benchmark

"Slow on big repositories" is the most consistent structural complaint about
every established GUI client, and being fast is one of the two strongest claims
this project makes. This file is what turns that claim into a number somebody
else can check, and what makes a regression in it visible before a stranger
finds it (#257).

Read the spec for the reasoning behind every choice below:
`docs/superpowers/specs/2026-09-17-large-repo-benchmark-spec.md`.

## Running it

```bash
pnpm bench                   # the three generated fixtures, ~1 minute to build
pnpm bench --linux           # …plus a real clone of torvalds/linux (multi-GB)
pnpm bench --fixture deep    # one fixture
pnpm bench --soak 60         # add a 60-minute soak per fixture
pnpm bench --no-publish      # measure and print; write nothing
```

Three pieces, each runnable on its own:

| piece | what it does |
| --- | --- |
| `scripts/bench-fixtures.mjs` | materialises the repositories under `$PGBENCH_HOME` (default `~/.cache/platypusgit-bench`) |
| `src-tauri/benches/repo_bench.rs` | measures one repository, writes a JSON document of raw samples |
| `scripts/bench-report.mjs` | renders those into `benchmark.json` beside this file, and the table block below |

**Run it on a quiet machine.** Every number is wall clock, so a compile in
another window is recorded as this program being slow — and these are the
figures a stranger will check.

The harness is behind `--features bench` and `required-features` in
`src-tauri/Cargo.toml`, so `cargo check` and `cargo test` — the whole Rust CI
gate — never build or link it.

## The fixtures

Breadth hurts differently from depth, so one "big repo" fixture would give a
number that cannot say which dimension moved when it regresses. Three generated
fixtures isolate one dimension each; the fourth is the real thing.

| fixture | shape | isolates |
| --- | --- | --- |
| `deep` | 50,000 commits, 16 files | the log walk |
| `wide` | 50,000 files, all modified, 5,000 untracked | `status` |
| `refs` | 5,000 branches, 2,000 tags, 2,000 commits | ref enumeration |
| `linux` | a real clone of `torvalds/linux` | all of it, for real |

The generated three are **deterministic** — fixed seed, fixed timestamps, fixed
author — so the same parameters produce the same object ids on every machine,
and they build in seconds from `git fast-import`. That is what makes "a script
anyone can run" true rather than aspirational: nobody re-runs a benchmark that
starts with a six-gigabyte download. `linux` is opt-in for exactly that reason,
and it is not generated because a synthetic repository cannot stand in for 1.4
million real commits, 90,000 real paths and a real pack layout.

Fixtures are build artifacts. They live under `$PGBENCH_HOME`, never in the
tree, and a fixture whose recorded shape no longer matches
`scripts/bench-fixtures.mjs` is regenerated rather than reused — comparing
today's numbers against a differently-shaped repository is worse than having no
previous numbers at all.

## What is measured, and what is therefore not

The harness drives `Libgit2Backend` through the real `GitBackend` trait. **No
number here includes React**, because there is no webview in it. That is a real
limitation, stated plainly, and it is still the right layer: it is where a big
repository is actually expensive, it is where a regression lands, and the render
on top is bounded by the *window* rather than by the repository — the log is
paged at 500, diff rows are windowed, long lists are virtualised — so it does
not grow with the fixture.

Two measurements narrow the gap on purpose rather than pretending it is not
there:

* **`open_screen`** issues the eleven reads `useRepoStore.refreshAll` issues,
  simultaneously, from separate threads. A composite is the only measurement
  that can catch "a slow status blocks everything else on that repo" — the trap
  `git/repo_locks.rs` exists to avoid, and the one an op-at-a-time benchmark is
  structurally blind to.
* **`open_screen_ipc`** is the same fan-out plus `serde_json` encoding of every
  payload, because that encoding is real work on a 500-commit page and it
  happens before the frontend sees a byte.

### "First" and "repeat", not "cold" and "warm"

**First** is one call on a freshly constructed backend and a freshly opened
repository — what happens when you open a repository in the app, with libgit2's
object database, ref database and pack indices all unbuilt. **Repeat** is the
median over many calls on that handle; the p95 beside it is nearest-rank.

Neither purges the operating system's file cache. The words "cold" and "warm"
are avoided precisely because they would imply it did. A first-boot number is
larger than anything below, by an amount that depends on the disk rather than on
this code.

### The `git` baseline

Every operation a single `git` invocation can answer is measured as that
invocation too, and the table prints the ratio.

The point is not to win. `git` is the floor, and a ratio near it is the good
outcome. The point is that **a ratio survives leaving this machine**: a
millisecond figure from somebody else's laptop tells a reader nothing they can
check, and a ratio that doubles is a regression even on hardware that got
faster.

The baselines ask the *same* question, not the cheapest one sharing a name.
`status` is the clearest case: `GitBackend::status` returns per-file added and
removed counts, so its baseline is `git status --porcelain` **plus** both
`--numstat` diffs. Comparing it to a bare `git status` would be comparing it to
less work than it does. Every baseline command is recorded in
`docs/dev/benchmark.json` under `gitCommand`, so the comparison can be
disputed with evidence rather than in the abstract.

## Where the results go

| artifact | committed | what it is |
| --- | --- | --- |
| `$PGBENCH_HOME/results/<fixture>.json` | no | raw, every sample — what makes a result checkable |
| `docs/dev/benchmark.json` | yes | the published record, summary statistics only |
| the table block below | yes | the same numbers, as a document |
| `README.md`'s Performance section | yes | the same run, one row per fixture, for a reader who will never open this file |

All three committed artifacts are **generated and not hand-editable**.
`test/benchmark.test.ts` re-renders both markdown blocks from the JSON and fails
when any of them disagree. That guard is the point of the whole exercise: the
way a measured number turns back into an adjective is somebody nudging it in a
hurry.

The README block is the same `renderReadme` output the guard re-renders, so
`pnpm bench` rewrites three files and they are committed together. It prints
three operations rather than twelve, and those three are `REQUIRED_OPS` minus
`open` — the ops every fixture is already forced to publish. Widening it to an
op a fixture may legitimately lack is how the front page starts printing a blank
cell for the thing that regressed; `test/benchmark.test.ts` asserts every timing
cell there carries a digit.

The record sits beside this file rather than under `site/`, and both are covered
by the `docs/dev/` entry already in the `js` path filter in
`.github/workflows/tests.yml`. Without that coverage the guard would be
skippable by exactly the change it polices — the failure mode #210 already
shipped once.

### The README publishes them; the marketing site still does not

The two are not the same audience and the numbers read differently to each.

The **README** prints them, and leads with the bad case. That file already
carries a "Where we are behind" paragraph and a "Status" section of known gaps,
so a table whose worst row is `torvalds/linux` at 15.8 seconds is in keeping
with it rather than at odds with it — and the sentence under the table says so
in as many words. It is also where the word "fast" appears in the first line,
which makes it the single most valuable place for the adjective to be replaced
by something a reader can check. The block is generated and guarded exactly like
the one below; the prose around it is hand-written, and
`test/benchmark.test.ts` fails if a figure is copied into it, because a
hand-typed number stops moving on the next run.

The **marketing site** is still waiting, and the reason it was waiting has now
gone. #257 asks for a measured figure there in place of an adjective, and the
block to do it is written, but a landing page sells, and 15.8 seconds as a
selling point is a different claim from 15.8 seconds as a disclosed limitation.
The condition that gated it was the log walk, and #483 landed it: the kernel's
first screen is **999 ms**. Shipping the site figure is now a matter of moving
the record to `site/src/data/` beside `comparison.json` — where this repository
keeps published records the site reads — and it belongs to #257 rather than to
this file. One caveat for whoever does it: the honest headline is the first
screen, not "history in 8.7 ms", and the slowest operation on that fixture is
still `file_history` at 16.9 s.

Until then nothing under `site/**` is touched by a re-measurement, which also
means `pnpm bench` cannot redeploy the website by accident.

## What the numbers say

The first run of this benchmark found three things. They are recorded here
because the tables above will move and the reasoning will not, and because a
number with no reading beside it is a number nobody acts on.

### 1. History was the whole large-repo problem, and it is no longer the bound

The first run of this benchmark found the first screen costing **15.8 seconds**
on `torvalds/linux`, with ten pages into its history costing **two minutes and
thirty-eight seconds**. Three changes closed that, and it is worth keeping which
did what, because two of them are frequently assumed to be one:

| | first screen, kernel | page ten |
| --- | --- | --- |
| as first measured | 15.8 s | 157.67 s |
| after #479 — one prepared walk, cached ref map | 15.7 s | 112 ms |
| after #483 — the order comes from git | **999 ms** | **116 ms** |

**#479 fixed paging; it could not fix the first walk**, because nothing inside
libgit2's revwalk API can. **#483 fixed the first walk** by not using that API.
Neither is a substitute for the other, and the table above is the argument.

What this means for the shape of the problem: on the kernel the first screen is
now bounded by `status` (1.03 s) rather than by history (8.7 ms), which is the
criterion #483 was accepted on. `status` is a different problem and a smaller
one — it is 1.9× git's own work on a 96,034-file tree, so it needs a cheaper
question (untracked cache, fsmonitor) rather than a faster answer.

The generated fixtures improved too, and by more than "no regression": `deep`
went from 255 ms to **59 ms**. `wide` is unmoved at 5.41 s because it has one
commit and its cost is `status`; `refs` is unmoved at 224 ms because its cost is
enumerating 7,001 refs.

### 2. The log walk is not slow — the topological SORT is, and it was re-paid per page

The obvious reading of "our 500-commit page takes 252 ms and `git log -500`
takes 41 ms" is that the walk is six times too slow. It is wrong, and it nearly
reached this document.

`log_page` walks with `Sort::TIME | Sort::TOPOLOGICAL`, because the commit
graph's lane assignment depends on topological order. A default `git log` does
not sort that way. Asked the same question, `git log --topo-order -500` costs
284 ms on the `deep` fixture against our 275 ms — **parity**. The baselines in
this benchmark are `--topo-order` for exactly that reason, and the near miss is
written up in the spec.

What survived was sharper. git pays for that sort **once and then skips**; we
paid it again on every page:

| | `deep` (50k commits) | `torvalds/linux` (1.5M commits) |
| --- | --- | --- |
| our first page | 252 ms | 15.95 s |
| our tenth page | 2.40 s | 157.67 s |
| `git log --topo-order --skip=4500 -500` | 193 ms | 9.68 s |

The per-page cost was flat in depth — ten pages cost ten times one page — which
is the signature of restarting the walk rather than continuing one.

#### The measurement the fix rests on

Fixed in #473 by preparing the walk once and paging out of what it produced.
The reason that is affordable is one measurement, and it is worth recording
because it is the opposite of what "just cache it" usually costs. Draining a
revwalk that has **already been prepared** is very nearly free, because libgit2
does the ordering during preparation and then hands commits out of a list it
already has:

| | prepare + take(500) | drain the whole rest of the order |
| --- | --- | --- |
| `deep` (50,000 commits) | 560.2 ms | **1.9 ms** (49,500 more) |
| `torvalds/linux` (1,482,923 commits) | 31.8 s | **63.4 ms** (1,482,423 more) |

0.2% more buys the entire order, which is why the cache holds a `Vec<Oid>`
rather than the prepared `Revwalk` — holding the walk would mean holding a
`git2::Repository` alive between IPC calls, outliving the lock acquisition
`git/repo_locks.rs` orders every access by, to save that 0.2%. The source-level
reason it comes out this way is in `src-tauri/src/git/log_cache.rs`:
`git_revwalk_sorting` sets `walk->limited`, so `prepare_walk` runs `limit_list`
over the whole reachable graph and `sort_in_topological_order` materialises the
complete ordered list before the first oid is yielded.

**The tables below have not been re-measured for that change**, and the numbers
in this section are the "before" they always were. Two sessions were benchmarking
this repository at once, and `$PGBENCH_HOME` is one shared directory: control
rows moved 25–30% on operations neither change touches (`wide` status 5.38 s →
3.92 s, `diff_commit` 1.53 s → 1.12 s), which is not a result, it is two
programs sharing a machine. Re-measure on a quiet machine, with one session
running, before publishing an after.

And re-measure **all four fixtures**, or knowingly keep the rest. The renderer
publishes every result it finds in `$PGBENCH_HOME/results`, which is deliberate
— it is what stops `pnpm bench --fixture deep` from silently deleting
`torvalds/linux` from the record — but it also means a one-fixture run
publishes fresh numbers for that fixture and whatever happens to be sitting
beside it. `test/benchmark.test.ts` cannot catch that: it checks the markdown
against the JSON, and both would be wrong together.

### 3. The ref map was rebuilt on every page, too

`log_page` called `collect_ref_map(repo)` per call, enumerating and peeling every
ref so the page could decorate its 500 commits. Two fixtures isolate it, and the
variable between them is refs rather than history:

| fixture | history | refs | ours | `git` work | ratio |
| --- | --- | --- | --- | --- | --- |
| `deep` | 50,000 commits | 1 | 252 ms | 194 ms | 1.3× |
| `refs` | 2,000 commits | 7,001 | 135 ms | 8.5 ms | **16×** |

Twenty-five times *less* history, and still most of the cost.

Fixed in #473 alongside the walk, and two things found on the way are worth
keeping, because both are counter-intuitive:

* **The peeling is not the expense.** This issue was written as "enumerating and
  peeling every ref"; measured on `refs`, one enumeration costs 113 ms and the
  peel inside it costs 10 ms. So the map is validated on a FIRST page and reused
  by the continuations behind it — revalidating per scroll cost 113 ms of a
  117 ms page, for a question that cannot have changed.
* **Do not compute a fingerprint before building the map on a cold cache.** It
  enumerates every ref twice for an answer that cannot match anything, and it
  made a cold eleven-read fan-out on `refs` *slower* than the code it replaced
  (219 ms → 364 ms). It hides, too: `open_screen` builds a fresh backend per
  sample, so that path is always the cold one. `collect_ref_map` returns the
  fingerprint from its own pass for this reason.

The same two defects were in `log_filtered_page`, which is commit search — the
surface where they hurt most, because a search that matches nothing recent walks
a long way before it fills a page, and the next page threw that walk away. It
reads the same prepared order now. One limit is deliberate and written down in
`cached_filtered_plan`: a search visits far more commits than it returns, so
only an order that is ALL of history can serve one, and a repository past
`MAX_ORDER` falls back to the walk-per-page it always had rather than to a short
page that would look like "no more matches exist".

### What is already good, and worth not breaking

* **Opening a repository is free** — 0.11 ms on the kernel, a fresh libgit2
  handle and nothing else. Every "first call" number is measured against one.
* **The concurrent fan-out really is concurrent.** On `wide`, `open_screen`
  costs 5.42 s and `status` alone costs 5.42 s: eleven reads cost what the
  slowest one costs, not the sum. That is `git/repo_locks.rs` doing its job, and
  it is the single thing most worth not regressing.
* **IPC encoding is not a cost worth optimising.** `open_screen_ipc` is within
  noise of `open_screen` on every fixture, including a 500-commit page.
* **`status` tracks git.** 5.42 s against 2.98 s of git's work on 55,000
  changed entries — 1.8×, on an operation where git itself takes three seconds.
  It is slow because the question is expensive, not because of how we ask it.

### Known characteristics that are not on the tables

* **File history was unbounded on a cold path, and is capped since #474.**
  `file_history` stops at `limit` matches, so on a file with fewer changes than
  that it had nothing to stop on and walked to the root of history with a tree
  comparison per commit. Measured on the `linux` fixture, warm, for
  `arch/powerpc/kernel/iommu.c`:

  | walk | cost |
  | --- | --- |
  | uncapped — 1,482,923 commits, every one compared | **135.6 s** |
  | capped at 50,000 visits (the default since #474) | **18.3 s** |
  | the revwalk's own preparation, before any tree work | 14.5 s |
  | 50,000 commits of tree comparison | 4.1 s |

  So the cap removes ~117 s of the 135 s, and what is left is dominated by a
  fixed cost the cap cannot touch (next bullet). The benchmark measures the
  *most frequently changed* path precisely so the uncapped walk terminated at
  all; see `hottest_path` in the harness. #474 also moved it to
  `with_repo_read`, so it no longer blocks every other read on the repository
  while it runs, and made it cancellable — 18 s is still a wait worth being
  able to stop.

* **A sorted libgit2 revwalk pre-walks the whole graph before it yields
  anything, and the sort order is not why.** Getting the FIRST oid out of a
  `push_head` walk on the kernel costs 14.2 s; walking 50,000 costs 14.2 s; and
  walking all 1,482,923 costs 14.7 s — the same number three times, because the
  traversal has already happened by the time the first one comes back.
  `Sort::TIME` and `Sort::TIME | Sort::TOPOLOGICAL` were measured within 1% of
  each other, so dropping `TOPOLOGICAL` buys nothing and the obvious
  optimisation is a dead end. `Sort::NONE` IS incremental and is unusable for a
  capped walk: it yields commits in the order the traversal reaches them, so the
  first 50,000 are not the newest 50,000 and a capped file history could miss
  last week's change while reporting one from 2011. Every walk in
  `libgit2.rs` sorts, so this floor was the one behind `log_page`'s first page
  too — confirmed by #483, where replacing exactly that call took the kernel's
  first screen from 15.7 s to 999 ms. **`file_history` still pays it**: it has
  its own walk with its own cap and cursor semantics, it is the slowest
  operation on the kernel fixture at 16.9 s, and it is the obvious next one to
  move. `log_filtered_page` (commit search) keeps a libgit2 walk on its
  cache-miss path for the same reason.
* **The commit-graph is the fix, and libgit2 could never have delivered it.**
  A fresh clone has none — `git clone` does not write one, and `gc --auto` does
  not fire on a single packfile — so this was what a user got on day one. It
  matters enormously to git: writing one for the kernel takes 14 seconds, and a
  sorted `git log -500` then drops from 9.51 s to **21 ms**.

  It did nothing for us, and that was the most useful single fact this benchmark
  produced. With the file present, our first page took 63.4 s for four calls
  against 64.2 s without it, because **libgit2's revwalk does not read it**:
  `commit_list.c` fills `commit->generation` from the graph, `revwalk.c`
  contains zero references to either, and across all of libgit2's `src/`
  `->generation` is read only in `graph.c` and `merge.c`. So the numbers are
  populated and then ignored by the one code path that would benefit.

  That ruled out the cheap fix ("write a commit-graph in the background") on its
  own and said where the work had to go: out of libgit2. #483 takes the order
  from `git rev-list --date-order` and keeps a `--split` commit-graph warm, and
  the fixtures now carry one because `scripts/bench-fixtures.mjs` writes it —
  a fixture without one measures a state the app does not leave a repository in.
  **The `git` baselines get the same file**, which makes several ratios look
  worse than they did when we withheld it; that is the correct comparison and
  the point of having a floor at all.

* **`--date-order` is the drop-in, and `--topo-order` is not.** They are
  different questions rather than two spellings of one:
  `Sort::TIME | Sort::TOPOLOGICAL` is Kahn's algorithm over a time-priority
  queue, which is `--date-order`; `--topo-order` additionally refuses to
  intermix independent lines of history. Measured byte-for-byte on the kernel's
  first 2,000 oids, libgit2's walk is IDENTICAL to `--date-order` and shares
  only **1,627 of 2,000** with `--topo-order` — it does not reorder the same
  commits, it returns different ones. Both #473 and #476 proposed `--topo-order`,
  and the baselines in this file quoted it until #483 had to settle the
  question. `tests/log_walk_ordering.rs` pins it in both directions.

## Results

<!-- BEGIN BENCHMARK RESULTS — generated by scripts/bench.sh, do not edit -->

Measured on Apple M4 Pro (14 cores, 48 GB, macos/aarch64) with git version 2.50.1 (Apple Git-155), on 2026-09-18. Up to 10 repeats per operation, time-boxed to 20s each — so a cheap operation gets the full count and an expensive one gets at least three. The published record records how many each row actually took.

The **`git` work** column is that baseline's wall clock with process start-up subtracted (12.4 ms per invocation on this machine, measured), because we pay none of it — the backend is libgit2, in process. That is deliberately the comparison that makes us look worse: against git's wall clock we would get a ten-millisecond head start on every row. **†** marks a baseline where start-up swamped the work, leaving a remainder too small to divide by; those rows print no ratio rather than a flattering one.

### torvalds/linux

A real clone of the Linux kernel: the repository people mean when they say a git client is slow.

*1,482,923 commits · 96,034 tracked files · 946 tags · 13 changed entries*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.27 ms | 0.11 ms | 0.13 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 1000 ms | 999 ms | 1.02 s | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 1.01 s | 1.00 s | 1.02 s | — | — |
| Working-tree status | 26 entries | 1.06 s | 1.03 s | 1.04 s | 505 ms | 2.0× |
| First page of history | 500 commits | 222 ms | 8.70 ms | 8.93 ms | 29.1 ms | 0.30× |
| Ten pages into history | 500 commits | 337 ms | 116 ms | 118 ms | 46.4 ms | 2.5× |
| List every branch | 3 branches | 1.25 ms | 0.89 ms | 0.98 ms | † | — |
| List every tag | 946 tags | 27.4 ms | 20.3 ms | 21.8 ms | 32.3 ms | 0.63× |
| Diff the selected commit | 3 files | 151 ms | 142 ms | 142 ms | 20.5 ms | 6.9× |
| Diff one modified file | 2 hunks | 61.4 ms | 2.15 ms | 2.34 ms | — | — |
| History of one file | 500 commits | 16.97 s | 16.88 s | 16.96 s | 130 ms | 130× |
| Browse the whole tree | 96,034 files | 679 ms | 507 ms | 710 ms | 217 ms | 2.3× |

### deep

50,000 commits over a small tree — the size past which GitKraken's own users report native clients beating it.

*50,000 commits · 16 tracked files*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.14 ms | 0.12 ms | 0.12 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 60.3 ms | 59.0 ms | 60.1 ms | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 60.9 ms | 59.2 ms | 62.5 ms | — | — |
| Working-tree status | 0 entries | 0.67 ms | 0.54 ms | 0.55 ms | † | — |
| First page of history | 500 commits | 57.9 ms | 3.21 ms | 3.27 ms | † | — |
| Ten pages into history | 500 commits | 89.7 ms | 31.5 ms | 32.2 ms | 5.58 ms | 5.7× |
| List every branch | 1 branch | 0.45 ms | 0.28 ms | 0.34 ms | † | — |
| List every tag | 0 tags | 0.17 ms | 0.14 ms | 0.15 ms | † | — |
| Diff the selected commit | 1 file | 0.50 ms | 0.34 ms | 0.40 ms | † | — |
| History of one file | 500 commits | 319 ms | 307 ms | 310 ms | 29.5 ms | 10× |
| Browse the whole tree | 16 files | 0.48 ms | 0.13 ms | 0.13 ms | † | — |

### wide

50,000 tracked files with every one of them modified, plus 5,000 untracked — a monorepo just after a codemod.

*1 commits · 50,000 tracked files · 55,000 changed entries*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.26 ms | 0.11 ms | 0.13 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 5.41 s | 5.41 s | 5.43 s | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 5.41 s | 5.38 s | 5.41 s | — | — |
| Working-tree status | 55,000 entries | 5.37 s | 5.38 s | 5.40 s | 2.95 s | 1.8× |
| First page of history | 1 commit | 15.4 ms | 0.25 ms | 0.27 ms | † | — |
| Ten pages into history | 1 commit | 14.9 ms | 0.25 ms | 0.27 ms | † | — |
| List every branch | 1 branch | 0.38 ms | 0.28 ms | 0.29 ms | † | — |
| List every tag | 0 tags | 0.17 ms | 0.14 ms | 0.14 ms | † | — |
| Diff the selected commit | 50,000 files | 1.53 s | 1.51 s | 1.52 s | 515 ms | 2.9× |
| Diff one modified file | 1 hunk | 18.6 ms | 0.64 ms | 0.64 ms | — | — |
| History of one file | 1 commit | 0.37 ms | 0.26 ms | 0.28 ms | † | — |
| Browse the whole tree | 55,000 files | 202 ms | 185 ms | 188 ms | 42.3 ms | 4.4× |

### refs

5,000 branches and 2,000 tags over a short history — a long-lived repository nobody prunes.

*2,000 commits · 32 tracked files · 5,001 branches · 2,000 tags*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.14 ms | 0.12 ms | 0.12 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 225 ms | 224 ms | 225 ms | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 224 ms | 224 ms | 225 ms | — | — |
| Working-tree status | 0 entries | 0.74 ms | 0.56 ms | 0.57 ms | † | — |
| First page of history | 500 commits | 188 ms | 121 ms | 123 ms | 4.25 ms | 28× |
| Ten pages into history | 500 commits | 159 ms | 129 ms | 130 ms | † | — |
| List every branch | 5,001 branches | 188 ms | 184 ms | 186 ms | 184 ms | 1.0× |
| List every tag | 2,000 tags | 151 ms | 150 ms | 153 ms | 45.7 ms | 3.3× |
| Diff the selected commit | 1 file | 0.42 ms | 0.28 ms | 0.30 ms | † | — |
| History of one file | 63 commits | 21.9 ms | 20.6 ms | 20.8 ms | 7.13 ms | 2.9× |
| Browse the whole tree | 32 files | 0.46 ms | 0.16 ms | 0.17 ms | † | — |

<!-- END BENCHMARK RESULTS -->
