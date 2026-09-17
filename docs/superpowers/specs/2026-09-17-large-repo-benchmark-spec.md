# Large-repo benchmark (#257)

"Slow on big repositories" is the most consistent structural complaint about
every established GUI client, and being fast is one of this project's two
strongest claims. There are no numbers, so right now it is only a claim.

This builds a benchmark anybody can run, publishes what it measures, and puts a
measured figure where an adjective used to be.

## What "fast" has to mean before it can be measured

The complaint is never about a microbenchmark. It is about four moments:

1. **Opening a repository.** From double-click to a screen with history on it.
2. **Status on a dirty tree.** The auto-fetch and the file watcher both call
   this, so on a big working tree it is not one cost but a recurring one.
3. **Scrolling history**, including past the first page.
4. **Jank after a while** — the Sourcetree complaint, the one nobody answers.

Everything below is arranged around those four, and an operation that does not
serve one of them is not measured. A benchmark that reports thirty numbers is a
benchmark whose regressions nobody notices.

## Three decisions that shape the rest

### It measures the backend, and says so

The harness drives `Libgit2Backend` through the real `GitBackend` trait. There
is no webview in it, so no number here includes React.

That is a real limitation and the published document states it in those words.
It is nonetheless the right layer:

* it is where a big repository is expensive — a 500-commit page and a 55,000-
  entry status are git work, not render work;
* it is where a regression lands, and it is diffable;
* the render on top is bounded by the *window*, not by the repository (the log
  is paged at 500, diff rows are windowed, long lists are virtualised), so it
  does not grow with the fixture.

Two measurements narrow the gap on purpose rather than pretending it is not
there. `open_screen` issues the **eleven reads `refreshAll` issues**,
simultaneously, from separate threads — which is the only shape that can catch
"a slow status blocks everything else on that repo", the trap
`git/repo_locks.rs` exists to avoid and the one an op-at-a-time benchmark is
structurally blind to. `open_screen_ipc` adds `serde_json` encoding of every
payload, because that encoding is real work on a 500-commit page and it happens
before the frontend sees a byte.

An end-to-end number through the webview is a separate piece of work. It needs
the e2e harness, a Linux container and a multi-gigabyte fixture inside it, and it
would still be a worse regression detector than this because a wall-clock number
that includes WebDriver is dominated by WebDriver.

### Four fixtures, three of them generated

Breadth hurts differently from depth, so one "big repo" fixture would produce a
number that cannot say which dimension moved when it regresses. Each generated
fixture isolates exactly one:

| fixture | shape | isolates |
| --- | --- | --- |
| `deep` | 50,000 commits, 16 files | the log walk |
| `wide` | 50,000 files, all modified, 5,000 untracked | `status` |
| `refs` | 5,000 branches, 2,000 tags, 2,000 commits | ref enumeration |
| `linux` | a real clone of `torvalds/linux` | all of it, for real |

`deep` is 50,000 because that is the threshold GitKraken's own users name.
`wide` is a monorepo just after a codemod. `refs` is a long-lived repository
nobody prunes, which is most of them.

The three generated ones are **deterministic**: fixed seed, fixed timestamps,
fixed author, so the same parameters produce the same object ids on every
machine. They build in seconds from `git fast-import`, which is what makes
"a script anyone can run" true rather than aspirational — nobody re-runs a
benchmark that starts with a six-gigabyte download.

`linux` is not generated, because a synthetic repository cannot stand in for 1.4
million real commits, 90,000 real paths and a real pack layout, and that is the
repository people mean. It is opt-in (`--linux`).

Fixtures live under `$PGBENCH_HOME` (default `~/.cache/platypusgit-bench`),
never in the tree.

### "First" and "repeat", not "cold" and "warm"

`first` is one call on a freshly constructed backend and a freshly opened
repository — what happens when you open a repository in the app, with libgit2's
object database, ref database and pack indices all unbuilt. `repeat` is the
median of many calls on that handle.

Neither purges the operating system's file cache. The words "cold" and "warm"
are avoided precisely because they would imply it did; a first-boot number is
larger than anything published here by an amount that depends on the disk rather
than on this code. Saying so is cheaper than being caught not having said so.

## The `git` baseline

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
less work than it does, and flattering ourselves in public is the one thing a
benchmark must not do.

**The rule cuts both ways, and it caught a false result here before publication.**
The first draft of the log baseline was a plain `git log --max-count=500`, which
made the first page of history look fourteen times slower than git on the `deep`
fixture. It is not. `log_page` walks with `Sort::TIME | Sort::TOPOLOGICAL`
because the commit graph's lane assignment depends on topological order, and a
default `git log` does not sort that way. Measured on `deep`:

| | |
| --- | --- |
| `git log --max-count=500` | 41 ms |
| `git log --topo-order --max-count=500` | 284 ms |
| `log_page(None, None, 500)` | 275 ms |

The first page is at **parity**. The wrong baseline would have published a
regression that does not exist, in the very document written to stop people
publishing numbers they had not checked — so the baselines are `--topo-order`,
and the reason is written beside them in the source.

What survives the correction is sharper and still worth acting on: git pays for
that sort **once** and then skips, while `log_page` pays it per page. Page ten
is 2.61 s against `git log --topo-order --skip=4500 --max-count=500` at 219 ms.

## Repeats are time-boxed, not counted

A fixed repeat count is wrong at both ends. Ten repeats of a 0.15 ms operation
buys a rounding error's worth of extra confidence; ten repeats of an
eight-second log page on a kernel clone is thirteen minutes for one row of one
table, and a benchmark nobody has time to finish produces no numbers at all.

So the count is derived: `budget / first_call`, clamped between three and the
requested maximum. Three is the floor because a median of two is the mean of
two. Every row records how many samples it actually took, so the published
table never implies a confidence it does not have — and the budget is soft by
construction, because the floor wins when one call already exceeds it.

## The soak

"Jank after a while" gets its own mode rather than being left out: `--soak N`
repeats the whole first-screen fan-out for N minutes and reports resident memory
at the start, at the end and at its peak, plus the median fan-out time in the
first half of the run against the second.

Two halves rather than a fitted slope, because a slope invites reading a trend
into noise. It covers the backend only — a leak in React would not show here —
and the document says that.

## Where the output goes

Three artifacts, of which two are committed:

* `$PGBENCH_HOME/results/<fixture>.json` — raw, every sample, **not** committed.
  It is what makes a result checkable, and it is also forty floating-point
  numbers per run that nobody reads the diff of.
* `docs/dev/performance.md` — the developer-facing record: method, fixtures,
  what the numbers mean, and a generated table block per fixture.
* `docs/dev/benchmark.json` — the published record, beside the document.

Both committed artifacts are **generated and not hand-editable**, and
`test/benchmark.test.ts` re-renders the markdown from the JSON and fails when
they disagree. That guard is the point of the exercise: the way a measured
number turns back into an adjective is somebody nudging it in a hurry.

Both live under `docs/dev/`, which is already in the `js` path filter in
`.github/workflows/tests.yml`. That is why the record lives there rather than
somewhere needing a filter entry of its own: a guard skippable by exactly the
change it polices is the failure mode #210 already shipped once.

## What the site says — deferred, on purpose

The plan was a "measured, not claimed" block on `/features`, printing real
figures from the JSON with the machine named beside them, under two rules taken
from the comparison table's house style: every figure comes from the JSON, and
it prints what was measured *including* where we are slow.

**It is not shipping with the first run.** The measurement changed the decision:
the honest headline today is that opening `torvalds/linux` takes 15.8 seconds,
and a marketing page is not the right place to learn that. The block is written
and the rules above still hold; it ships once the log-walk finding is fixed, and
the record moves under `site/` at the same time.

Holding it has a second benefit worth keeping either way: with no benchmark data
under `site/**`, a re-measurement cannot trigger the site deployment (`site.yml`
fires on any push to `main` touching that path), so `pnpm bench` can never
redeploy the website as a side effect.

## Non-goals

* **Comparing against other clients.** We cannot run GitKraken in a harness and
  publish the result, and citing a forum post as a number would be the thing
  this issue exists to stop doing.
* **A CI gate.** The numbers are wall clock on a shared runner, which is a
  flake generator, and the fixtures take minutes to build. This is a thing you
  run deliberately, and the published document is the record that makes a
  regression visible.
* **Fixing what it finds.** A benchmark's job is to produce the number. Acting
  on a bad one is the next piece of work, and it gets its own issue with the
  measurement attached.
