# Large-repo benchmark — implementation plan (#257)

Spec: `docs/superpowers/specs/2026-09-17-large-repo-benchmark-spec.md`.

One PR. Nothing here changes app behaviour: every file is a new build artifact,
a new document, or a pointer to one. The two exceptions are the `js` path filter
in `tests.yml` (one path added) and a new section on the site's `/features`
page.

## 1. Fixtures — `scripts/bench-fixtures.mjs`

Generates `deep`, `wide` and `refs` from `git fast-import` streams; clones
`linux` on demand. Everything under `$PGBENCH_HOME`.

* Deterministic: a seeded LCG for content, a fixed epoch for every timestamp, a
  fixed author. Same parameters ⇒ same object ids on any machine.
* `--done` on the import, so a truncated stream is an error rather than a
  quietly partial repository — a fixture that stopped at commit 31,000 would
  publish numbers nobody can reproduce.
* Each fixture's shape is stamped to `<name>.fixture.json` **beside** the
  repository, never inside it: `wide` is measured partly by how many untracked
  files `status` reports, and a stray file in the work tree would be one of them.
* Config left at git's defaults. `core.untrackedCache` and `core.fsmonitor`
  both make `status` dramatically cheaper, and benchmarking with them on would
  publish a number almost nobody's repository produces. `gc.auto=0` is the one
  deviation, because a `gc --auto` firing mid-run is measured as whatever
  operation happened to be in flight.

**Done when** all three build in under a minute and the shapes verify:
50,000 commits / 50,000 files with 55,000 changed entries / 5,001 branches and
2,000 tags of which 500 annotated.

## 2. Harness — `src-tauri/benches/repo_bench.rs`

A `harness = false` bench target behind `required-features = ["bench"]`, so
`cargo check` and `cargo test` — the whole Rust CI gate — never build or link
it.

Measures, per operation: one `first` call on a freshly constructed backend and
a freshly opened repository, then N repeats on one handle (median, min, p95,
max, and every sample kept).

* `open_screen` runs the eleven `refreshAll` reads simultaneously behind a
  `Barrier`. The barrier is load-bearing: spawning eleven threads without one
  lets the first read finish before the last starts, which turns the one
  measurement that exists to find lock contention into a measurement with none
  in it.
* `open_screen_ipc` is the same fan-out plus `serde_json` encoding of every
  payload.
* Every op a single `git` invocation can answer carries that invocation as a
  baseline, chosen to ask the same question — `status`'s baseline is
  `git status --porcelain` plus both `--numstat` diffs, because
  `GitBackend::status` returns per-file line counts.
* `--soak N` repeats the fan-out for N minutes and reports RSS at start, end and
  peak, plus the median fan-out in the first half of the run against the second.
* A `scale` string ("55,000 entries") travels with every timing, because a
  benchmark that silently started measuring an empty result is the classic way
  to publish an excellent number for nothing at all.
* Repeats are **time-boxed** rather than counted: `budget / first_call`, clamped
  between three and `--iterations`. Ten repeats of an eight-second log page is
  thirteen minutes for one table row; three is enough for a median when the
  operation is that slow, and every row publishes its own sample count.
* The subject path for file history is the **most frequently changed path in the
  last 2,000 commits**, not "a path HEAD touched". The obvious choice is
  unusable: `file_history` stops at `limit` matches, so on a rarely-touched file
  it never reaches 500 and walks the whole history with a tree comparison per
  commit — on `torvalds/linux` the benchmark simply does not finish. Measured
  the hard way, by watching it not finish.

Output is hand-rolled JSON so key order is stable — a generated file that
reorders itself makes every diff of it unreadable, and this one is committed.

**Done when** it compiles with `--features bench`, is absent from a plain
`cargo test`, and produces a plausible document for all four fixtures.

## 3. Orchestration — `scripts/bench.sh`, `pnpm bench`

Ensure fixtures → build the harness → run it per fixture → render. Flags:
`--linux`, `--fixture`, `--soak`, `--iterations`, `--force`, `--no-publish`.
Invokes the harness through `cargo bench` rather than a built path, because a
`harness = false` bench has no stable file name and globbing for it picks up
stale binaries.

## 4. Rendering — `scripts/bench-report.mjs`

Raw runs → `docs/dev/benchmark.json` → the markdown table block spliced between
the generated markers in `docs/dev/performance.md`.

The direction matters: **the markdown is rendered from the published JSON**, not
from the raw runs. That is what gives the guard test leverage — it re-renders
from the committed JSON and compares to the committed markdown, so the two can
only agree if both came out of one run. Raw samples stay out of the repository.

## 5. Documents

* `docs/dev/performance.md` — method, fixtures, what is and is not included, the
  baseline argument, the generated results, and what the numbers say.
* `CLAUDE.md` — one pointer in the doc list, one line in the command list.
* The spec, committed beside the other specs.

## 6. Site — written, then held back

A `Benchmark.astro` block on `/features` reading a typed `benchmark.ts`, printing
the machine beside the numbers, keeping the `git` column and printing the rows
where we lose.

**Not shipped in this pass.** The first run's headline is 15.8 seconds to open
`torvalds/linux`, and the right response to that number is to fix it, not to put
it on a marketing page. It follows the log-walk work. Nothing benchmark-related
lives under `site/**` meanwhile, which also stops `pnpm bench` from triggering
the site deployment.

## 7. Guards

`test/benchmark.test.ts`:

1. re-renders the markdown from `benchmark.json` and compares byte for byte;
2. requires a machine, a date and an iteration count;
3. requires `open`, `open_screen`, `status` and `log_first_page` on every
   fixture, a non-empty `scale` and a positive median on every row;
4. rejects an operation key the renderer does not know how to order (it would
   sort silently to the end of the table);
5. requires a recorded `git` command behind every printed ratio;
6. asserts `docs/dev/` is in the `js` path filter in `tests.yml` — a guard
   skippable by the change it polices is the #210 failure mode, and it has
   shipped here once. Both of its inputs live there, so no new filter entry is
   needed.

The hand-typed-figure check goes in with the site block, since it polices the
markup that block adds.

## 8. Run it and publish

A clean run of all four fixtures on a quiet machine, then commit
`benchmark.json` and `performance.md` together.

Read the results before writing the prose. If a number is bad, the document says
so with the measurement attached and a follow-up issue gets filed — a benchmark's
job is to produce the number, and acting on a bad one is the next piece of work,
not this one.

## Verification

* `pnpm test` — the new guard plus the existing `docs`/`unit` projects.
* `pnpm tsc --noEmit`, and a site build for the new component.
* `cargo test` — unchanged, and specifically proving the bench target is not
  built by it.
* `cargo build --features bench --bench repo_bench` — proving it still is when
  asked.
* No e2e: nothing here reaches the app.
