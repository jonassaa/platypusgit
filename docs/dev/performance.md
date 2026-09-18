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

The **marketing site** is still waiting. #257 asks for a measured figure there
in place of an adjective and the block to do it is written, but a landing page
sells, and 15.8 seconds as a selling point is a different claim from 15.8
seconds as a disclosed limitation. It ships once the log-walk work in the
findings below lands — at which point the record moves to `site/src/data/`
beside `comparison.json`, which is where this repository keeps published records
the site reads.

Until then nothing under `site/**` is touched by a re-measurement, which also
means `pnpm bench` cannot redeploy the website by accident.

## What the numbers say

The first run of this benchmark found three things. They are recorded here
because the tables above will move and the reasoning will not, and because a
number with no reading beside it is a number nobody acts on.

### 1. We are fine until history gets very deep — and then we are not

The whole first screen — the eleven reads `refreshAll` issues, all at once —
costs **255 ms** on a 50,000-commit repository and **219 ms** on one with 5,001
branches and 2,000 tags. That is the size at which GitKraken's own users report
it falling over, and it is a good answer.

On `torvalds/linux` the same screen costs **15.8 seconds**, and scrolling ten
pages into its history costs **two minutes and thirty-eight seconds**. That is
not a good answer, and publishing it is the point of the exercise: the user who
opens a 1.4-million-commit repository and waits is the user this project was
written for.

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
  `libgit2.rs` sorts, so this floor is very probably the one behind `log_page`'s
  first page too — consistent with the commit-graph measurement below, which is
  the fix git gets for exactly this and we do not, but measured here only for
  `file_history`.
* **No fixture carries a commit-graph file, and it would not help us if it
  did.** A fresh clone has none — `git clone` does not write one, and
  `gc --auto` does not fire on a single packfile — so this is what a user gets
  on day one. It matters enormously to git: writing one for the kernel takes 14
  seconds, and `git log --topo-order -500` then drops from 9.51 s to **21 ms**.
  It does not measurably help us. With the file present, our first page took
  63.4 s for four calls against 64.2 s without it: libgit2's revwalk does not
  read it. That is the most useful single fact this benchmark produced, because
  it rules out the cheap fix and says where the work actually has to go.

## Results

<!-- BEGIN BENCHMARK RESULTS — generated by scripts/bench.sh, do not edit -->

Measured on Apple M4 Pro (14 cores, 48 GB, macos/aarch64) with git version 2.50.1 (Apple Git-155), on 2026-09-17. Up to 10 repeats per operation, time-boxed to 20s each — so a cheap operation gets the full count and an expensive one gets at least three. The published record records how many each row actually took.

The **`git` work** column is that baseline's wall clock with process start-up subtracted (12.4 ms per invocation on this machine, measured), because we pay none of it — the backend is libgit2, in process. That is deliberately the comparison that makes us look worse: against git's wall clock we would get a ten-millisecond head start on every row. **†** marks a baseline where start-up swamped the work, leaving a remainder too small to divide by; those rows print no ratio rather than a flattering one.

### torvalds/linux

A real clone of the Linux kernel: the repository people mean when they say a git client is slow.

*1,482,923 commits · 96,034 tracked files · 946 tags · 13 changed entries*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.26 ms | 0.11 ms | 0.13 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 15.91 s | 15.84 s | 15.86 s | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 15.80 s | 15.82 s | 15.86 s | — | — |
| Working-tree status | 26 entries | 1.15 s | 989 ms | 1.10 s | 517 ms | 1.9× |
| First page of history | 500 commits | 15.96 s | 15.95 s | 16.49 s | 9.51 s | 1.7× |
| Ten pages into history | 500 commits | 156.38 s | 157.67 s | 159.94 s | 9.68 s | 16× |
| List every branch | 3 branches | 1.65 ms | 0.87 ms | 0.89 ms | † | — |
| List every tag | 946 tags | 27.1 ms | 19.7 ms | 20.2 ms | 23.7 ms | 0.83× |
| Diff the selected commit | 3 files | 142 ms | 139 ms | 140 ms | 11.5 ms | 12× |
| Diff one modified file | 2 hunks | 68.2 ms | 2.14 ms | 2.22 ms | — | — |
| History of one file | 500 commits | 15.91 s | 15.42 s | 16.06 s | 5.65 s | 2.7× |
| Browse the whole tree | 96,034 files | 782 ms | 515 ms | 642 ms | 218 ms | 2.4× |

### deep

50,000 commits over a small tree — the size past which GitKraken's own users report native clients beating it.

*50,000 commits · 16 tracked files*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.14 ms | 0.11 ms | 0.12 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 252 ms | 253 ms | 256 ms | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 252 ms | 253 ms | 254 ms | — | — |
| Working-tree status | 0 entries | 0.69 ms | 0.53 ms | 0.55 ms | † | — |
| First page of history | 500 commits | 261 ms | 249 ms | 251 ms | 193 ms | 1.3× |
| Ten pages into history | 500 commits | 2.39 s | 2.39 s | 2.40 s | 192 ms | 12× |
| List every branch | 1 branch | 0.42 ms | 0.28 ms | 0.29 ms | † | — |
| List every tag | 0 tags | 0.17 ms | 0.15 ms | 0.15 ms | † | — |
| Diff the selected commit | 1 file | 0.48 ms | 0.34 ms | 0.35 ms | † | — |
| History of one file | 500 commits | 293 ms | 65.0 ms | 65.7 ms | 319 ms | 0.20× |
| Browse the whole tree | 16 files | 0.50 ms | 0.13 ms | 0.13 ms | † | — |

**Soak.** 2,344 first-screen fan-outs over 10 minutes. Resident memory 67 MB → 69 MB (peak 69 MB). Median fan-out 252 ms in the first half, 252 ms in the second — -0.2%.

### wide

50,000 tracked files with every one of them modified, plus 5,000 untracked — a monorepo just after a codemod.

*1 commits · 50,000 tracked files · 55,000 changed entries*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.25 ms | 0.11 ms | 0.13 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 5.42 s | 5.42 s | 5.62 s | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 5.60 s | 5.43 s | 5.60 s | — | — |
| Working-tree status | 55,000 entries | 5.38 s | 5.42 s | 5.48 s | 2.98 s | 1.8× |
| First page of history | 1 commit | 0.35 ms | 0.25 ms | 0.26 ms | † | — |
| Ten pages into history | 1 commit | 0.31 ms | 0.25 ms | 0.26 ms | † | — |
| List every branch | 1 branch | 0.35 ms | 0.28 ms | 0.32 ms | † | — |
| List every tag | 0 tags | 0.17 ms | 0.14 ms | 0.15 ms | † | — |
| Diff the selected commit | 50,000 files | 1.53 s | 1.51 s | 1.67 s | 510 ms | 3.0× |
| Diff one modified file | 1 hunk | 17.2 ms | 0.63 ms | 0.64 ms | — | — |
| History of one file | 1 commit | 0.28 ms | 0.10 ms | 0.10 ms | † | — |
| Browse the whole tree | 55,000 files | 196 ms | 181 ms | 241 ms | 42.4 ms | 4.3× |

### refs

5,000 branches and 2,000 tags over a short history — a long-lived repository nobody prunes.

*2,000 commits · 32 tracked files · 5,001 branches · 2,000 tags*

| Operation | Result size | First call | Repeat | p95 | `git` work | vs `git` |
| --- | --- | --- | --- | --- | --- | --- |
| Open the repository | a fresh handle | 0.15 ms | 0.14 ms | 0.14 ms | † | — |
| Everything the first screen needs, at once | 11 concurrent reads | 221 ms | 219 ms | 221 ms | — | — |
| …including encoding it all for the webview | 11 concurrent reads | 221 ms | 220 ms | 224 ms | — | — |
| Working-tree status | 0 entries | 0.72 ms | 0.55 ms | 0.56 ms | † | — |
| First page of history | 500 commits | 787 ms | 135 ms | 138 ms | 8.48 ms | 16× |
| Ten pages into history | 500 commits | 526 ms | 525 ms | 551 ms | 7.25 ms | 72× |
| List every branch | 5,001 branches | 184 ms | 180 ms | 182 ms | 183 ms | 0.98× |
| List every tag | 2,000 tags | 148 ms | 148 ms | 151 ms | 43.3 ms | 3.4× |
| Diff the selected commit | 1 file | 0.40 ms | 0.28 ms | 0.29 ms | † | — |
| History of one file | 63 commits | 20.7 ms | 9.37 ms | 9.88 ms | 11.9 ms | 0.79× |
| Browse the whole tree | 32 files | 0.47 ms | 0.16 ms | 0.16 ms | † | — |

<!-- END BENCHMARK RESULTS -->
