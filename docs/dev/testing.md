# Testing — four layers, Docker e2e, CI

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`) — deep-dive notes split out of CLAUDE.md, which keeps only the
operational rules and points here. A section referenced but not found in this
file lives in a sibling. `test/docs.test.ts` reads this set together with
CLAUDE.md, so the tree listings and command lists here are build-checked.

## Testing

Four layers, each run independently:

- **Rust backend integration** — `cargo test --manifest-path src-tauri/Cargo.toml`.
  Covers every `GitBackend` op against real temp repos via the `TempRepo` fixture
  in `src-tauri/tests/support/`. End-to-end for git logic, no webview needed.
- **Frontend pure logic** — `pnpm test` picks up `*.test.ts` (e.g. `graphLayout`,
  `buildRebasePlan`). Node-grade pure functions.
- **Frontend component tests** — `pnpm test` also picks up `*.test.tsx` under
  `src/`. Runs in jsdom with React Testing Library. The Tauri `invoke` and
  `plugin-dialog.open` calls are mocked via `src/test/setup.ts`; tests register
  per-command responses with `mockInvoke(cmd, handler)`.
  - Those two layers are one vitest **project**, `unit`. `pnpm test` also runs a
    second project, `docs` (`test/**/*.test.ts`, node env, no setup file) — the
    coverage gate on the doc set (CLAUDE.md + docs/dev/). See "`test/` at the repo root" below. Run one
    with `pnpm vitest run --project unit`.
- **E2E (webview-level)** — WebdriverIO specs in `e2e/specs/`, one file per
  feature area, driving the real debug binary: real webview →
  real Tauri IPC → real libgit2 → temp repos built by `e2e/support/tempRepo.ts`.
  (`ls e2e/specs/` for the current set. A file count used to live here and went
  stale three times; a number nobody can keep true is worse than no number.)
  Uses the embedded WebDriver provider (`@wdio/tauri-service`) — no external
  driver or paid service — so it runs on Linux CI (WebKitGTK) and, in the same
  container image, locally.
  - **ALWAYS run e2e through Docker (`pnpm test:e2e:docker …`), never
    natively.** No host runs, no UI window. `test:e2e` /
    `test:e2e:build` / `test:e2e:run` are the primitives the container runs:
    `test:e2e:build` is a tauri debug build with `--features
    tauri/custom-protocol --config src-tauri/tauri.e2e.conf.json` snapshotting
    the binary to gitignored `e2e/.bin/`, `test:e2e:run` is wdio against that
    snapshot. Invoke them via the Docker wrapper, not directly.
  - **When to run e2e:** only once you're DONE developing a change — not on
    every edit during active development. And run ONLY the spec file(s)
    relevant to what you touched, not the whole suite. CI runs the full suite
    on the PR.
  - **How to run the relevant spec(s):** after a src/ or src-tauri/ change,
    rebuild this worktree's snapshot once with `pnpm test:e2e:docker build`,
    then run just the affected spec(s): `pnpm test:e2e:docker run --spec
    e2e/specs/<file>.e2e.ts` (repeat `--spec` for more). A spec-only change
    skips the rebuild — run `pnpm test:e2e:docker run --spec …` directly.
    `pnpm test:e2e:docker full --spec …` does build + run in one shot. Never
    rely on a stale snapshot: the `run` phase silently tests the old binary if
    you skipped the rebuild.
  - **Before writing or debugging any e2e spec, read the `e2e-testing`
    project skill** (`.claude/skills/e2e-testing/SKILL.md`) — selector
    conventions and traps, driver-bridge/5s-penalty rules, native-dialog
    stubbing, fixture geometry gotchas, rebuild discipline, debugging flow.
  - Opening a SECOND repository in e2e goes through `seedOpenRepos()`
    (`pg-open-repos` + a reload), never the `+` button or ⌘O: those raise the
    real OS folder picker, which WebDriver cannot drive. Match a tab with
    `repoTab(path)`, which keys on the path's TAIL — `open_repo` returns the
    canonicalised workdir, and on macOS `tmpdir()`'s `/var/folders/…` comes back
    as `/private/var/folders/…`.
  - `reopenRepo()` reloads WITHOUT clearing localStorage, so the session restore
    may already have the repository open; it waits for the branch chip OR the
    recent-repo row and only clicks the row when there is one.
  - `stubNativeDialogs()` keeps its name and options but no longer stubs
    natives: since #61 C3 confirms/prompts are real in-page modals
    (`[data-pg-dialog]`, `data-pg-dialog-kind`), so it installs an observer
    that answers each one as it appears. Call sites are unchanged;
    `confirmCallCount()` still counts confirm dialogs only.
  - CI: `.github/workflows/e2e.yml` (ubuntu-latest + xvfb, PRs to `main` +
    push to `main`) — **one build, four sharded runners**; see "The e2e gate is
    sharded" below. Local runs use `pnpm test:e2e:docker` (same WebKitGTK +
    xvfb stack) — see the "Headless e2e in Docker" section below.
  - `pnpm.overrides["@wdio/native-utils"] = "2.5.0"` pins around a broken
    dep pin in `@wdio/tauri-service@1.2.0` — don't remove.
  - Only `e2e`-feature builds serve WebDriver on port 4445 (the plugin is now
    gated behind the `e2e` cargo feature, so a plain `pnpm tauri dev` no longer
    opens it). Still: don't leave a prior e2e binary running when starting a new
    e2e run, or the runner may attach to it and clear its `localStorage`.
  - `e2e/wdio.conf.ts` sets `PLATYPUSGIT_NO_SINGLE_INSTANCE=1` before the app
    launches — without it, `tauri-plugin-single-instance` would forward a
    test binary's launch into any already-running platypusgit instance
    instead of serving WebDriver.
  - Multi-window specs (`merge-window.e2e.ts` drives the `merge` resolver
    window) are one concrete reason for the Docker-only rule: reliable on
    Linux/WebKitGTK, broken on a macOS-native run, where WKWebView's
    foreground-focus self-heal can't hold a consistent active window across the
    second window's open/transition/close (`switchWindow` → "No window could be
    found").


## Headless e2e in Docker (`pnpm test:e2e:docker`) — the only supported way

macOS has no headless webview — a native `pnpm test:e2e` run pops a real
WKWebView window and needs foreground focus (`ensureMacAppFocus`). So e2e runs
headless in a container driving the CI stack (WebKitGTK + xvfb). Same webview
target CI uses, so a green Docker run matches the PR gate.

**Never run e2e natively / in a UI window** — not to "check it quickly", not for
a single spec, not because Docker is cold. It steals foreground focus from
whoever is at the machine, is flaky on multi-window specs, and its result
doesn't predict CI. The one exception is a genuinely WKWebView-specific
question, and that needs the user to ask for it explicitly; say so in the report
when it happens.

Files: `Dockerfile.e2e` (mirrors `.github/workflows/e2e.yml` deps),
`docker-compose.e2e.yml`, `e2e/docker-entrypoint.sh` (phase dispatch),
`e2e/e2e-docker.sh` (wrapper — sets a per-worktree compose project name).

```bash
pnpm test:e2e:docker                                  # full: build binary + whole suite, headless
pnpm test:e2e:docker full --spec e2e/specs/X.e2e.ts   # full build + one spec
pnpm test:e2e:docker run  --spec e2e/specs/X.e2e.ts   # reuse THIS worktree's snapshot, one spec
pnpm test:e2e:docker build                            # rebuild this worktree's snapshot only
```

First run is slow (image build + cargo compile from scratch). Reruns reuse
cached layers + shared package caches; only changed code recompiles.

**Memory:** the compose service caps `CARGO_BUILD_JOBS=2` +
`CARGO_PROFILE_DEV_DEBUG=0` because the default ~8GB Docker VM OOM-kills rustc
(SIGKILL) when cargo fans out one job per CPU — the GTK/WebKit crates each cost
2–4GB to compile, so even a few overlapping blow the limit. Bump
`CARGO_BUILD_JOBS` in `docker-compose.e2e.yml` if you give the VM more RAM
(Docker Desktop → Settings → Resources); 2 is safe at 8GB but leaves most of
the 14 CPUs idle during the compile.

**Parallel agents / worktrees:** safe by construction. `e2e/e2e-docker.sh`
derives `COMPOSE_PROJECT_NAME=pgit-e2e-<worktree-dir-slug>`, so each worktree
gets its own `node_modules` / `target` / `.bin` volumes (the cargo target dir
is NOT safe for concurrent builds → must be per-worktree). Package caches
(pnpm store, cargo registry/git) have fixed volume names shared across all
worktrees — concurrency-safe, so crates download once, not per-worktree. The
WebDriver port (4445) is internal to each container, never published, so no
host-port collisions. Different worktrees → run concurrently, no coordination.
Same worktree → run one at a time (they'd share the target volume). Each agent
just runs `pnpm test:e2e:docker …` from its own worktree.

Expect this on a new worktree's first run, and ignore it — it is the shared
caches working as designed, not a misconfiguration:

```
warning: volume "pgit-e2e-pnpm-store" already exists but was created for
project "pgit-e2e-<some-other-worktree>" (expected "pgit-e2e-<yours>").
Use `external: true` to use an existing volume
```

**One cold container build at a time across ALL worktrees, though.** The
concurrency note above is about correctness (separate volumes), not memory: two
worktrees compiling GTK/WebKit at once exceeds the ~8GB VM even at
`CARGO_BUILD_JOBS=2` each, and rustc is SIGKILLed in *both* runs. Also note
`compose run --build` creates no container until the image build finishes, so a
build already in flight is invisible to `docker ps` — check `docker compose ls`
too before assuming the slot is free.


## What CI runs

Two workflows cover the four layers, both on PRs to `main`, pushes to `main`,
and `workflow_dispatch`:

- `.github/workflows/tests.yml` — the `unit` job (`pnpm tsc --noEmit`,
  `pnpm test`, and `pnpm exec tsc -p e2e/tsconfig.json --noEmit`, which is the
  ONLY place the e2e specs are typechecked since the root tsconfig excludes
  `e2e/`) and the `rust` job (`cargo test`). The Rust job installs e2e.yml's
  Tauri `-dev` packages because linking the crate needs them, but no xvfb: the
  integration tests drive libgit2 against temp repos, with no window and no
  network.
- `.github/workflows/e2e.yml` — the webview suite.

**A path filter must list the suite's INPUTS, not just its sources.** `tests.yml`'s
`js` filter also matches `test/`, `CLAUDE.md`, `docs/dev/` and `.github/workflows/e2e.yml`,
because the `docs` vitest project reads them all — and each was skippable by
exactly the change it polices: a CLAUDE.md-only edit skipped `docs.test.ts`
(whose whole job is "CLAUDE.md matches the tree"), and an e2e-matrix-only edit
skipped `shardSpecs.test.ts` (whose whole job is "the matrix covers every
spec"). Both reported green. Any new assertion about a file outside `src/` has
to put that file in the filter, or the guard is decorative.

Each workflow front-loads a `changes` job that diffs against the PR base and
skips suites the change cannot affect, then reports through an always-running
gate job (`unit-tests`, `rust-tests`, `e2e-linux`). **The gate is what a branch
ruleset should require, never the worker job** — a required check that gets
skipped never reports and blocks the PR forever. The gate also fails on a skip
it cannot explain, so a green tick means the suite ran or was provably
irrelevant. On `push`/`workflow_dispatch` there is no reliable diff base, so
every filter output falls back to `true` and `main` is never left untested.

**The push-to-`main` e2e run is a deliberate duplicate, not an oversight**
(issue 189, option D). The same suite runs on the PR and again on the squash
merge. It is not waste: required checks are non-strict and the merge is a
squash, so the tree that lands on `main` can differ from the tree the PR tested
— the push run is the only thing that ever tests `main` itself. It blocks
nobody, `concurrency: cancel-in-progress` already collapses a burst of merges
into one run, and sharding roughly halved what it costs. Moving it to nightly
would trade "green main, known within minutes" for "broken main, found up to a
day later, then bisect the merges" — the same failure mode the issue rejects for
release-only e2e, at a smaller scale. Revisit only if runner minutes actually
become the constraint.

## The e2e gate is sharded (issue 189)

`e2e.yml` is three jobs, and the shape is load-bearing:

- **`build`** compiles the debug binary once and uploads `e2e/.bin/platypusgit`
  as an artifact. The binary is identical for every shard, so building per shard
  would spend the ~50 s cargo link N times over. The shard jobs then need no
  Rust toolchain and no `rust-cache` at all — they only run what this produced.
  The artifact format drops the exec bit, so each shard `chmod +x`es it.
- **`e2e`** is a matrix of four runners. `maxInstances` must stay **1** — an
  `e2e`-feature binary serves WebDriver on a fixed port, so two app instances in
  one container collide — which is exactly why parallelism lives across
  *runners*, one wdio process each. The matrix array in the workflow is the ONLY
  place the shard count is written down; the run step reads the total from
  `strategy.job-total` and passes `E2E_SHARD` / `E2E_SHARDS`. `fail-fast: false`,
  so one broken spec does not hide the other three shards' state.
**The two apt lists are what makes four runners cheaper than one**, and a single
list was the first sharded run's whole regression. `TAURI_APT_BUILD_DEPS` is the
`-dev` set plus `patchelf`, installed only by `build`, which links the crate.
`TAURI_APT_RUN_DEPS` is the RUNTIME closure — `libwebkit2gtk-4.1-0`,
`libgtk-3-0t64` (Ubuntu 24.04's 64-bit time_t rename), `libayatana-appindicator3-1`,
`librsvg2-2`, `xvfb` — and no shard fetches it from a mirror: `build` resolves it
with `apt-get --download-only` BEFORE its own `-dev` install (after, those
packages are installed and apt would fetch nothing), into the same archive
directory the `-dev` install then reuses, and ships the `.deb`s as a second
artifact each shard installs offline with `apt-get install ./*.deb`. Reason:
`azure.archive.ubuntu.com` throttles per runner, unpredictably — the SAME 61.5 MB
of `-dev` packages took 13 s, 2 min 14 s, 8 min 14 s and **10 min 24 s** across
one run's four shards — and a matrix job waits for the slowest draw. So it is one
mirror draw per run instead of five, and no `apt-get update` in a shard at all.
`ldd` on the downloaded binary is the second net: a runtime list that stops
covering what the build linked fails ONE named step instead of four shards
reporting "app never rendered the Welcome screen".

- **`e2e-linux`** is unchanged in NAME and still the only required check on
  `main`'s ruleset — sharding needed no ruleset edit, only a longer `needs:`. It
  fails on a skip it cannot explain: a `changes` job that did not succeed, a
  build that did not succeed, or a shard aggregate that is anything but
  `success`. `needs.<matrix job>.result` is the AGGREGATE, so one comparison
  already means "every shard passed".

**The split is derived, never listed** (`e2e/shardSpecs.ts`, invariants in
`test/shardSpecs.test.ts`). `listSpecFiles` walks `e2e/specs/`, so a spec added
or renamed by another change is picked up with no edit; `shardSpecs` then packs
by MEASURED per-spec duration (longest-processing-time-first, deterministic ties
on the path). wdio's own `--shard x/y` was rejected because it slices the
*alphabetical* list by count, and measured against this suite that put `keymap`,
`palette` and `history-ops` in one slice — 256 s against 43 s for the lightest.
`WEIGHTS` is a HINT with provenance in its comment, not a manifest: an unlisted
spec gets `DEFAULT_WEIGHT` and still runs, a stale entry is dead weight, and
neither can drop a spec. Re-measure when the distribution has visibly drifted.

**LPT's bound is `max ≤ ideal + heaviest`, so the heaviest single spec is the
gate's floor.** `keymap.e2e.ts` is 140 s of the suite's ~530 s, so four shards
already sit at that floor and a fifth runner buys nothing — the next lever is
splitting that file, not adding shards. And the reason it costs 140 s is
structural, not a lost selector: it calls `openRepo()` once per `it()` (28
times), and one `openRepo` is a refresh + re-arm + a repo open + the syncing
settle, ~5 s under xvfb. The same shape holds for `repo-tabs` (10 `resetApp`s)
and `palette` (8 `openRepo`s).

**Every spec file LEAVES a cleared `localStorage`, and that is what makes any
grouping safe.** A spec file gets a fresh app PROCESS but not a fresh app data
dir, so `pg-open-repos` survives into the next spec and makes its launch restore
a repository instead of rendering Welcome — the screen the conf `before` hook and
every `openRepo` wait for. Before sharding that never bit only because the two
specs that leave the key behind (`repo-tabs`, `open-persisted-screen`) also
dispose their temp repos, so the restore fails and Welcome renders anyway — a
property of two *other* files. The conf's `after` hook now clears the key, so the
guarantee is structural.

**It clears at the END, with no refresh, and that placement is the whole point.**
Doing the same clear in `before` — where it reads more naturally — needs a
`browser.refresh()` to un-restore the repository, and that MEASURED at 528 s →
**1064 s** for the suite (run `32246987758`): one extra refresh per spec file
re-rolls the reload race, and every loss is a full **30 s** stall because the W3C
script timeout is uncapped on Linux. Clearing after the last test needs no
navigation at all. Any future "just reset the app between specs" idea inherits
this: on this suite a refresh costs ~30 s times the probability of losing that
race, not the ~1 s a page reload looks like.

**Those 30 s stalls are the suite's real cost, and they are not selector
failures.** Serial baseline (run `32242497631`): 528 s of spec time, of which
roughly **eight** ~30 s stalls — every spec over 30 s is `n × 30` plus small
change, and which specs pay moves run to run. The mechanism is already documented
in `wdio.conf.ts` guard 2: an `execute()` landing mid-document-swap has its
completion handler dropped, the driver waits the FULL script timeout, and the
caller retries. macOS caps that at 2.5 s; **Linux does not cap it at all**, which
is why a stall there is 30 s rather than invisible. Capping it on Linux is the
biggest single lever left on the gate and is deliberately NOT done here: the
comment's objection (a truncated-but-completed script gets retried, double-running
side effects) is what `executeOnce` exists to neutralise, so the change is
plausible — but it re-opens a documented CI flake class and needs its own
verification runs, not a drive-by.

Reproduce one CI shard locally: `E2E_SHARD=2 E2E_SHARDS=4 pnpm test:e2e:docker
run` (`docker-compose.e2e.yml` threads both through). With neither set — every
ordinary local and Docker run — `specs` keeps its plain glob and the run is
byte-for-byte what it was.


## `test/` at the repo root — doc invariants (#147, #150)

**`test/docs.test.ts` fails the build when the doc set (CLAUDE.md + docs/dev/) falls behind the tree.**
It asserts that every id in `invoke_handler!`, every `src-tauri/src/**/*.rs`
module and every `src/features/*/` directory is named somewhere in the set.

- It understands the compressed group notation the command lists use
  (`stage/unstage/discard_paths`, `worktree_add/remove/lock/unlock/prune`) by
  expanding it, so keep writing groups that way — but an irregular group it
  cannot read will fail, and the fix is to spell that id out rather than to
  contort the group.
- It checks that a name is *mentioned*, not that the description is any good.
  The prose is still on you.
- Deliberately NOT extended to `src/screens/` or bare feature names — History,
  Remote, diff, merge and update are ordinary words that occur all over this
  file, so those assertions would pass for the wrong reason and could never
  fail. Further doc invariants belong in `test/docs.test.ts`; add cases, not counts.
- **`test/shardSpecs.test.ts` is the second tree invariant here** (issue 189),
  and it guards a SILENT failure: a spec that lands in no CI shard simply never
  runs and the gate goes green. It reads the real `e2e/specs/` directory and the
  real `shard: [...]` matrix out of `.github/workflows/e2e.yml`, then asserts the
  split is a partition — every spec in exactly one shard, no shard empty, stable
  run to run, and an unmeasured (newly added) spec still placed. That is why the
  matrix array must stay on one line. Same reason it lives in `test/` rather than
  beside the module: it asserts a fact about the tree and about `.github/`, and
  it needs node, not the jsdom harness.
- **`test/` is the repo root, not `src/test/`** — the two are unrelated despite
  the name. This suite reads `src-tauri/`, `CLAUDE.md`, `docs/dev/` and `e2e/`, so it is not
  a frontend test. `pnpm test` runs both suites as two vitest **projects**
  (`vite.config.ts`): `unit` is jsdom + the `src/test/setup.ts` mocks, `docs` is
  node with no setup file. That split is load-bearing — the jsdom harness (`src/test/setup.ts`) dies
  on a missing `Range` outside jsdom, and a doc test has no use for Tauri mocks.
- **`test/nativeSelect.test.ts` is a SOURCE invariant, not a doc one**, and it
  lives here because it reads the tree's text rather than rendering anything: no
  `<select>` or `<option>` element anywhere in shipped `src/` (issue 146 — see
  "No native `<select>`"). Comments are stripped first, and test files are out of
  scope, so the prose explaining the rule cannot trip it. Same shape and same
  justification as `src-tauri/tests/spawn_no_window.rs`: the failure it guards
  against is invisible on the platforms anyone develops on.
- **`test/e2eSelectors.test.ts` guards the `[data-testid="X"]*=text` substring
  trap.** WebdriverIO's partial-text form compiles to an xpath whose attribute
  test is `contains(@data-testid, "X")` plus `not(.//*[<same conditions>])`, so
  ANY other testid containing `X` as a substring makes the outer element match
  nothing — silently, reported as the spec's own `timeoutMsg`, and invisible to
  `pnpm test` because jsdom's `getByTestId` is an exact match. Narrow on purpose:
  only ids a spec actually drives with `*=` are constrained, so it cannot fire
  for unrelated naming.
- `tsconfig.json` has `include: ["src", "test"]` for the same reason. Without
  the second entry the file still RUNS but stops being typechecked, which is a
  silent hole rather than a visible one — a new top-level test directory needs
  adding there as well as to `test.include`.

