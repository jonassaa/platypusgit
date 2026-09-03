# Testing — four layers, Docker e2e, CI

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`). `test/docs.test.ts` reads this set together with CLAUDE.md.

## The four layers

- **Rust backend integration** — `cargo test --manifest-path src-tauri/Cargo.toml`.
  Every `GitBackend` op against real temp repos (`TempRepo` fixture,
  `src-tauri/tests/support/`). No webview, no network.
- **Frontend pure logic** — `pnpm test` picks up `*.test.ts` (graphLayout,
  buildRebasePlan, …).
- **Frontend component tests** — `*.test.tsx` under `src/`, jsdom + React
  Testing Library. Tauri `invoke` and `plugin-dialog.open` are mocked via
  `src/test/setup.ts`; register per-command responses with
  `mockInvoke(cmd, handler)`. These two layers are the vitest `unit` project;
  the `docs` project (node env, no setup file) is the doc/tree invariant suite.
  Run one with `pnpm vitest run --project unit`.
- **E2E** — WebdriverIO specs in `e2e/specs/` (one file per feature area)
  driving the real debug binary via the embedded `@wdio/tauri-service`
  provider; temp repos from `e2e/support/tempRepo.ts`.

## E2E rules

- **Always through Docker (`pnpm test:e2e:docker …`), never natively.** macOS
  has no headless webview: a native run pops a real WKWebView window, needs
  foreground focus, is flaky on multi-window specs (`merge-window.e2e.ts`:
  `switchWindow` → "No window could be found") and slow (27 min seen vs ~1 min
  healthy), and a green native run does not predict the CI gate. Only
  exception: a genuinely WKWebView-specific question the user explicitly asks
  for — say so in the report.
- Run e2e only when DONE developing, and only the relevant spec file(s) — CI
  runs the full suite. After a `src/` or `src-tauri/` change:
  `pnpm test:e2e:docker build`, then
  `pnpm test:e2e:docker run --spec e2e/specs/<file>.e2e.ts` (repeat `--spec`
  for more); `full` does both. A spec-only change skips the rebuild. Never
  trust a stale snapshot — `run` silently tests the old binary.
- **Read the `e2e-testing` project skill before writing or debugging any spec**
  (`.claude/skills/e2e-testing/SKILL.md`).
- `test:e2e` / `test:e2e:build` / `test:e2e:run` are in-container primitives —
  never run them on the host. The build snapshots the binary to gitignored
  `e2e/.bin/` with `--features tauri/custom-protocol,e2e --config
  src-tauri/tauri.e2e.conf.json`.
- Files: `Dockerfile.e2e` (mirrors e2e.yml deps), `docker-compose.e2e.yml`,
  `e2e/docker-entrypoint.sh`, `e2e/e2e-docker.sh` (per-worktree compose
  project name). First run is slow (image + cargo from scratch); reruns reuse
  caches.
- **Memory:** compose caps `CARGO_BUILD_JOBS=2` + `CARGO_PROFILE_DEV_DEBUG=0` —
  GTK/WebKit crates cost 2–4GB each to compile and the default ~8GB Docker VM
  OOM-kills rustc otherwise. Bump only with more VM RAM.
- **Parallel worktrees are safe by construction:** per-worktree volumes for
  node_modules/target/.bin, shared caches for the pnpm store + cargo registry
  (the "volume already exists for another project" warning is expected). The
  WebDriver port is container-internal. Different worktrees run concurrently;
  same worktree one at a time. **But only ONE cold container build at a time
  across ALL worktrees** — two concurrent GTK compiles exceed the VM even at 2
  jobs each; `compose run --build` is invisible to `docker ps` during the image
  build, so check `docker compose ls` too.
- Spec gotchas: open a second repo via `seedOpenRepos()` (never the `+` button
  or ⌘O — real OS picker); `repoTab(path)` keys on the path TAIL (macOS tmpdir
  canonicalises to `/private/var/…`); `reopenRepo()` reloads WITHOUT clearing
  localStorage and handles both restore outcomes; `stubNativeDialogs()` answers
  in-page `[data-pg-dialog]` modals via an observer (`confirmCallCount()`
  counts confirms); `pnpm.overrides["@wdio/native-utils"] = "2.5.0"` pins a
  broken dep in `@wdio/tauri-service` — don't remove; only `e2e`-feature builds
  serve WebDriver (port 4445) — don't leave a prior e2e binary running;
  `e2e/wdio.conf.ts` sets `PLATYPUSGIT_NO_SINGLE_INSTANCE=1` or a test launch
  gets forwarded into a running instance.

## What CI runs

Two workflows, both on PRs to `main`, pushes to `main`, and `workflow_dispatch`:

- `.github/workflows/tests.yml` — `unit` job (`pnpm tsc --noEmit`, `pnpm test`,
  and `pnpm exec tsc -p e2e/tsconfig.json --noEmit` — the ONLY e2e typecheck,
  since the root tsconfig excludes `e2e/`) + `rust` job (`cargo test`; installs
  the Tauri `-dev` packages to link, no xvfb).
- `.github/workflows/e2e.yml` — the webview suite (see sharding below).

Rules that keep the gates honest:

- **A path filter must list the suite's INPUTS, not just its sources.**
  `tests.yml`'s `js` filter also matches `test/`, `CLAUDE.md`, `docs/dev/`,
  `README.md`, `site/src/data/comparison.json` and `e2e.yml` because the `docs`
  project reads them — each was once skippable by exactly the change it
  polices. The comparison table (#210) proved it again: the guard shipped
  without its inputs in the filter, and the next README-only PR ran no suite
  at all. Any new assertion about a file outside `src/`
  must add that file to the filter, or the guard is decorative.
- Each workflow front-loads a `changes` job and reports through an
  always-running gate job (`unit-tests`, `rust-tests`, `e2e-linux`). **Branch
  rulesets must require the gate, never the worker job** — a skipped required
  check blocks the PR forever. The gate fails on a skip it cannot explain. On
  push/dispatch every filter output falls back to `true`.
- **The push-to-`main` e2e run is a deliberate duplicate** (issue 189):
  required checks are non-strict and merges are squashes, so the tree landing
  on `main` can differ from what the PR tested — the push run is the only
  thing that ever tests `main` itself. `concurrency: cancel-in-progress`
  collapses merge bursts. Revisit only if runner minutes become the constraint.

## The e2e gate is sharded (issue 189)

- **`build`** compiles the debug binary once and uploads `e2e/.bin/platypusgit`
  as an artifact (shards `chmod +x` it — artifacts drop the exec bit). Shards
  need no Rust toolchain.
- **`e2e`** is a matrix of four runners. `maxInstances` stays **1** (an
  `e2e`-feature binary serves WebDriver on a fixed port — parallelism lives
  across runners). The matrix array in the workflow is the ONLY place the shard
  count is written; the run step reads `strategy.job-total` →
  `E2E_SHARD`/`E2E_SHARDS`. `fail-fast: false`.
- **Two apt lists:** `TAURI_APT_BUILD_DEPS` (the `-dev` set + patchelf, build
  job only) vs `TAURI_APT_RUN_DEPS` (the runtime closure incl. xvfb). `build`
  resolves the runtime set with `apt-get --download-only` BEFORE its own `-dev`
  install and ships the `.deb`s as an artifact each shard installs offline —
  the Azure apt mirror throttles per runner unpredictably (13 s to 10 min 24 s
  for the same 61.5 MB in one run) and a matrix waits for the slowest draw.
  `ldd` on the binary catches a runtime list that stops covering the link.
- **`e2e-linux`** keeps its name — still the only required check.
  `needs.<matrix job>.result` is the aggregate, so one comparison means "every
  shard passed".
- **The split is derived, never listed** (`e2e/shardSpecs.ts`, invariants in
  `test/shardSpecs.test.ts`): it walks `e2e/specs/` (new specs picked up with
  no edit) and packs by MEASURED duration (LPT, deterministic ties). wdio's own
  `--shard` slices alphabetically and produced a 256 s vs 43 s split. `WEIGHTS`
  is a hint with provenance — unlisted specs get `DEFAULT_WEIGHT`, stale
  entries are dead weight, nothing can drop a spec; re-measure on visible
  drift.
- **LPT's bound is `max ≤ ideal + heaviest`**, so the heaviest spec is the
  gate's floor: `keymap.e2e.ts` at ~140 s (28 `openRepo`s at ~5 s each under
  xvfb) — a fifth shard buys nothing; splitting that file is the next lever.
- **Every spec file LEAVES a cleared `localStorage`** (the conf's `after`
  hook), which is what makes any grouping safe — `pg-open-repos` otherwise
  survives into the next spec's launch and breaks the Welcome-screen wait. It
  clears at the END with no refresh on purpose: clearing in `before` needs a
  `browser.refresh()`, which MEASURED at 528 s → 1064 s for the suite, back when
  every refresh re-rolled the reload race below.
- **The ~30 s stalls WERE the suite's real cost, and are fixed (#194).** An
  `execute()` landing mid-document-swap loses its completion handler and waits
  out the whole W3C script timeout, so the cost per loss is the TIMEOUT, not the
  work: 13–23 stalls per `main` run, ~30 s each, 70–80 % of e2e wall time, with
  which specs paid moving run to run. Every refresh site fired
  `armDriverBridge()` — an `execute()` — as its first post-refresh command, so
  the roll happened once per refresh, and `openRepo` refreshes once per `it()`.
  Three changes, in order of what does the work:
  - **`refreshAndSettle` (`e2e/support/app.ts`) owns every refresh.** Refresh →
    a matched WebDriver find → *then* arm. A find issued mid-swap either matches
    (the driver's own proof navigation settled) or misses and is re-polled for
    pennies; the pre-find arm it replaces could only ever land on the dying
    document, which is why each call site already armed again afterwards.
  - **The script timeout is now capped on Linux too** (8 s; macOS keeps 2.5 s;
    `E2E_SCRIPT_TIMEOUT_MS` overrides). The old refusal — retried
    timed-out-but-completed scripts double-run side-effectful helpers — was
    closed by `executeOnce`, which makes a retry a no-op returning the first
    run's value, and is self-tested in `harness.e2e.ts`. 8 s is measured, not
    guessed: with the mid-swap executes gone, the slowest single in-page script
    anywhere in the suite is 12 ms in local Docker and 190 ms on a real CI
    runner (`E2E_SCRIPT_TIMING=1` prints the spread per spec, and the timing
    line prints the max unconditionally). Resolve it through
    `resolveScriptTimeoutMs` — compose forwards an
    unset `E2E_SCRIPT_TIMEOUT_MS` as `""`, and `Number("")` is a ZERO timeout
    that fails every `element`/`elements`/click instantly.
  - **Stalls are counted and printed per spec file** (`e2e/support/scriptTiming.ts`),
    so a regression is attributable instead of "e2e is slow again".
  Measured in Docker (the stack CI runs), whole suite, same machine:
  **6 m 18 s with 9 stalls → 1 m 55 s with 0**. 9 × 30 s is 71 % of the
  baseline, so the arithmetic closes: what is left is the work.
  `test/e2eRefreshGate.test.ts` is what keeps it fixed — see below.
- Reproduce a shard locally: `E2E_SHARD=2 E2E_SHARDS=4 pnpm test:e2e:docker
  run`. With neither set, `specs` keeps its plain glob — byte-for-byte the old
  behaviour.

## A red `e2e-linux` that is not a regression (#364)

The required gate went red on trees that were provably fine, often enough that
"look for the same failure on a recent `main` run, re-run CI, watch it go green"
became routine — which is exactly how a real regression gets waved through.
Measured over 40 `push: main` e2e runs at the time: 28 success, 3 failure, 9
cancelled (the cancellations are `concurrency` collapsing a merge burst, not a
signal). Specs across every shard were involved: `commit.e2e` (three different
sub-tests on the clean-state wait), `settings.e2e` after a reload, `remote.e2e`'s
renamed-remote row, `history-ops`'s ref selector.

**It was one mechanism, not one bug per spec.** `waitForDisplayed` is
`waitUntil(() => isDisplayed())` over an element HANDLE, and `isDisplayed`
resolves its selector exactly once — the first poll caches `elementId`, and no
later poll re-runs the selector (`hasElementId`, webdriverio 9.31.5). If a
re-render detaches that node between the find and the visibility check (two
separate round trips), every remaining poll interrogates a node that is no
longer in the document: `checkVisibility()` answers `false`, the
`getComputedStyle` probe returns an empty declaration instead of throwing, so no
`stale element reference` is ever raised and WebdriverIO's error handler never
refetches. The wait then burns its whole budget on a dead node with the element
it wanted on screen the entire time — and a bigger timeout cannot help.
`waitForExist` never had the bug: `isExisting` re-runs the selector every poll.

Losing that race needs a re-render inside two round trips, so a starved CI
runner loses it and a quiet laptop does not. **The tell is a wait that gives up
while the screen is right, on a sub-test that wanders between runs** — a real
logic regression fails the same assertion every time.

What is in the tree now:

- **`installStaleProofWaits()`** (`e2e/support/app.ts`, installed by the conf's
  `before` hook) overwrites `waitForDisplayed` so each poll re-resolves the
  selector with a fresh WebDriver find. Session-wide on purpose: there are 227
  call sites and a helper only fixes the ones that adopt it. Re-resolution is a
  find and NOT an in-page `querySelector` poll, or it would reinstate the #194
  mid-document-swap stall in all 227 at once. `reverse` waits, non-string
  selectors and `$$`-indexed handles stay on the original implementation — see
  the helper's doc for why each would break.
- **`test/e2eWaitGate.test.ts`** pins the install, the single override, and the
  find-not-script rule as static facts; **`e2e/specs/harness.e2e.ts`** pins the
  behaviour, including a *control* test proving a raw handle still goes dead. If
  that control ever fails, a webdriverio release has started refetching and the
  override can be deleted rather than carried.
- **Waits are on state, not rendered prose.** Six waits matched
  `div*=Working tree clean` — a `PGEmpty` title, so a copy edit could redden the
  required gate, and a `div*=` XPath resolves to whichever innermost div
  contains the phrase. They use `WORKING_TREE_CLEAN`
  (`[data-testid="working-tree-clean"]`) now.
- **`jsPickOption` retries both of its steps.** It waits for an option to
  EXIST and then clicks it in a second round trip; a React commit in between
  unmounts the listbox portal (`option "…" vanished before the click`, four
  sightings) or replaces the trigger before the portal mounts (`… never
  appeared`, two). The miss is side-effect-free — the script dispatches nothing
  when the selector does not match — which is what makes the retry safe.
- **`specFileRetries: 1` + `specFileRetriesDeferred: true`** is a floor, not a
  fix. It covers what no wait can: a starved runner losing the app itself
  (`app never rendered Welcome screen`, seen in workers that then passed) used
  to fail the whole required check. Safe because every spec file builds its own
  fixtures in `before*` and disposes them in `after*` — not the #35 hazard,
  which was a *script* retry re-running effects inside one attempt. **Never
  silent:** `onWorkerEnd` prints the requeue, emits a `::warning` annotation and
  writes a line to the job summary, so a spec that needed a retry on your PR is
  still a signal on a green gate. Read those lines.

**Diagnosing the next one — two API calls, before anything else:**

```bash
gh run list --workflow e2e.yml --branch main --limit 12 \
  --json databaseId,conclusion,createdAt
gh run view <red-id> --log-failed | grep -E "✖|Error: "
```

A byte-identical failure sitting on a recent red `main` run is proof it is not
your diff, with no scratch branch to push and nothing to clean up. `main` goes
red intermittently, so one is often already there. Also speed-independent, and
better than eyeballing wall clock on a noisy runner: the per-spec
`[e2e] <spec>: N driver scripts, M stalled` line is a diff of app *behaviour*
between two runs — identical counts on the specs you did not touch is strong
evidence of no behavioural change. Audit your own diff regardless; the audit
has found real (unrelated) problems every time it was run.

## Dependency advisories in the dev toolchain (#346)

Every Dependabot alert this repo has open against the root `pnpm` project is
`development` scope and **transitive-only** — the vulnerable package is never a
direct dependency of ours. That combination is why they pile up: the security
updater can only bump a manifest entry, and it does not write `pnpm.overrides`.
Security updates ARE enabled, so a missing PR is not a sign the alert is in
hand; it means nothing can fix it automatically. Nothing outside the GitHub
security tab reports on this either — no workflow runs `pnpm audit`.

The remedy is the `pnpm.overrides` block in `package.json`, which carries two
kinds of entry:

- `@wdio/native-utils` pins a **broken** dep in `@wdio/tauri-service` (above).
- everything else force-bumps a **vulnerable** transitive dep past its advisory.

Where two majors of one package coexist in the tree, the override MUST use the
`pkg@major` selector form (`undici@6` / `undici@7`, `brace-expansion@1` /
`brace-expansion@2`). A bare `"undici": "^7"` would drag `webdriver`, which
wants 6.x, across a major and break the runner.

Two entries have a story worth recording so they are not re-litigated:

- **`esbuild` was fixed by `vite`, not by an override.** `vite` resolves it as
  a tightly-coupled peer, so forcing it across a minor was likelier to break
  the bundle than to buy anything — the standing decision was to wait for the
  next `vite` bump to carry it, and that is what happened. `vite` 7.3.6 widened
  its range to `^0.27.0 || ^0.28.0`; the patch bump dedupes the tree onto the
  `esbuild` 0.28.1 that `tsx` and `@wdio/native-utils` already pulled, and the
  whole 0.27.7 subtree — plus its 26 `@esbuild/*` platform packages — drops
  out of the lockfile. Because that fix is *incidental*, living in `vite`'s
  version range rather than in our overrides block, `esbuild` carries a
  **floor entry with no
  matching override key** in `test/depOverrides.test.ts`, so a `vite` pin or
  downgrade that re-introduces 0.27.x fails the build instead of silently
  re-opening GHSA-g7r4-m6w7-qqqr.
- **`extract-zip` has no patched version at all**, and is dismissed as
  tolerable risk. It arrives via `@puppeteer/browsers` ← `@wdio/utils` — a
  Chrome/Edge downloader this repo never invokes, because `e2e/wdio.conf.ts`
  sets `browserName: "tauri"`. Pruning that subtree would take `ip-address`
  with it; worth measuring, not yet done.

**The trap:** a Dependabot npm PR regenerates the lockfile and drops the whole
`pnpm.overrides` block. Restore it before merging any such PR, or the merge
silently un-fixes every advisory the block covers. That standing cost is the
main reason to keep the block minimal rather than adding every override that
would turn something green.

One measurement worth keeping: changing the block re-resolves the whole graph,
so read the lockfile diff before trusting it. Every version that moves should
trace back to an override or to one of its own dependencies — anything else is
opportunistic drift that does not belong in a security commit.

And because these packages ARE the e2e runner (`ws`, `undici`,
`serialize-javascript`, `js-yaml`, `fast-xml-parser`), a change here is not
proven by `pnpm test`. It needs a real Docker e2e run.

## `test/` at the repo root — doc invariants (#147, #150)

- **`test/docs.test.ts`** fails the build when the doc set (CLAUDE.md +
  docs/dev/) falls behind the tree: every `invoke_handler!` id, every
  `src-tauri/src/**/*.rs` module and every `src/features/*/` directory must be
  named somewhere in the set. It expands the compressed group notation
  (`stage/unstage/discard_paths`) — keep writing groups; spell out irregular
  ones. It checks that a name is *mentioned*, not that the prose is good.
  Deliberately not extended to `src/screens/` or bare feature names (ordinary
  English words — the check could never fail). Further doc invariants belong in
  `test/docs.test.ts`; add cases, not counts.
- **`test/shardSpecs.test.ts`** guards a SILENT failure: a spec in no CI shard
  never runs and the gate goes green. It reads the real `e2e/specs/` and the
  real `shard: [...]` matrix out of `e2e.yml` (keep the matrix array on one
  line) and asserts a stable partition with unmeasured specs still placed.
- **`test/e2eRefreshGate.test.ts`** pins the fix for #194 as a static fact, at
  `pnpm test` speed rather than after a 10-minute CI run: `browser.refresh()`
  may be called from exactly ONE place (`refreshAndSettle`), and every gate
  handed to it must START with a WebDriver query, never an in-page script
  (`browser.execute`, `executeOnce`, `waitForSelector`). Both halves matter — a
  rule kept by comments is what decayed the first time, with every refresh site
  independently arming before its find. A gate that polls in page obeys the
  first rule and reinstates the stall anyway, hence the second.
- **`test/nativeSelect.test.ts`** is a SOURCE invariant: no `<select>`/`<option>`
  in shipped `src/` (issue 146) — the failure is invisible on macOS/Windows.
  Comments stripped first; test files out of scope.
- **`test/depOverrides.test.ts`** guards the `pnpm.overrides` security block
  (#346) against the one thing that routinely kills it: a Dependabot npm PR
  regenerates the lockfile, drops the whole block, and 20 advisories come back
  with nothing in the diff that looks like a security change. It asserts both
  halves, because the block surviving is not the fix surviving — every security
  override key is still in `package.json`, AND no version resolved in
  `pnpm-lock.yaml` sits below its advisory floor, which is what catches a block
  that was kept while the lockfile was never regenerated. It asserts a FLOOR,
  never a ceiling, so ordinary bumps stay green; an unguarded new major is
  allowed through on purpose (the advisory ranges are major-scoped, so
  `undici` 8.x is a new question, not a regression of this one). Two traps if
  you edit it: the lockfile records our own `undici@6` selector keys at the
  same indentation as real packages, so the version pattern must demand a full
  `major.minor.patch` or it reads a selector as a version; and `it.each`'s
  `$major` renders as `undefined`, which is why the floor cases are a plain
  loop.
- **`test/privacy.test.ts`** pins the promise the README advertises (#226): no
  analytics package in `package.json` or anywhere in `pnpm-lock.yaml`
  (transitive is the arrival nobody reviews), no network call or analytics
  global in shipped `src/`, and no hostname baked in that is not on a short
  allow-list with a written reason. Its comment strip differs from
  `nativeSelect.test.ts`'s on purpose: the naive one eats the rest of any line
  containing a URL — `//` — which would hide every literal a hostname guard
  exists to find. Bare `fetch(` is deliberately NOT forbidden: `store.fetch(remote)`
  is git fetch, spelled identically, and a guard that cries wolf gets its
  exceptions added without thought. The backend half is
  `src-tauri/tests/no_telemetry.rs` (outbound call sites, updater endpoint,
  `Cargo.lock`, capabilities); the split follows the two CI filters, because
  `js` does not match `src-tauri/` and `rust` does not match `README.md`.
  Both files self-test their matchers — a guard that cannot fail reads like
  coverage.
- **`test/appErrors.test.ts`** makes the error enum's two written promises
  mechanical (#212). It parses `pub enum AppError` out of
  `src-tauri/src/error.rs` and asserts (a) every variant has a `kind: "Name"`
  case in `src/lib/errors.ts` — the 1:1 rule CLAUDE.md states as prose and
  nothing checked — and (b) no UNIT variant renders as its own enum spelling
  through `appErrorMessage`. (b) is the one that had already been broken: a unit
  variant carries no payload, so it fell through the `|| e.kind` fallback, and
  `NoSignature` — the ONE error every brand-new user hits, because git will not
  record a commit without `user.name`/`user.email` — put the literal string
  "NoSignature" on screen in the commit panel, and in merge, cherry-pick,
  revert, rebase, tag and stash besides. `NEVER_RENDERED` is the escape hatch:
  an allow-list of unit variants no user can see, each with a written reason, in
  the shape `privacy.test.ts` uses for hostnames — so adding one is a decision
  somebody made rather than an assertion quietly weakened. Node env, because it
  reads `src-tauri/`.
- **`test/comparison.test.ts`** keeps the competitor comparison (#210) from
  existing twice. `site/src/data/comparison.json` is the source of truth; the
  site renders it through `comparison.ts`, and the test parses the README's
  "How it compares" table and compares it cell by cell, plus the checked-on
  date, the runtime note, and every vendor source URL. It strips markdown
  emphasis and links and collapses whitespace, so the README stays free to bold
  a cell and wrap its prose. It reads the JSON with `node:fs` rather than
  importing `comparison.ts` — that module sits under `site/`, whose tsconfig
  extends Astro's, and the root package has no astro to resolve it with. What it
  cannot check is whether the claims are still TRUE: that is what the date is
  for, so re-read the vendors' pages before moving `checkedOn`. Its inputs
  (`README.md`, `site/src/data/comparison.json`) are in `tests.yml`'s `js`
  filter — without them the guard never runs on the PRs that edit the table.
- **`test/contributing.test.ts`** keeps `CONTRIBUTING.md` — the only path a
  newcomer has from `git clone` to a running window (#211) — from going stale
  in the ways that already happened: it promised "Three independent layers" of
  tests when there are four, never mentioned e2e at all (so a contributor tried
  a native run), and pointed humans at `CLAUDE.md` instead of `docs/dev/`. The
  test resolves every repo-relative link, checks every `pnpm <name>` in a fenced
  block against `package.json` (plus a small builtin list — `install`, `exec`,
  `tsc`, `vitest`, `tauri`), requires the four layer commands and all five
  `docs/dev/` files by name, and asserts the build section still says
  `--no-sign` for as long as `tauri.conf.json` actually makes a bare
  `pnpm tauri build` a hard error — read from the config, so the doc and the
  build fail together rather than drifting apart. It cannot check that the prose
  WORKS; the acceptance for that is still a human who has never built a Tauri
  app reaching a window without asking a question. `CONTRIBUTING.md` is in
  `tests.yml`'s `js` filter, or a CONTRIBUTING-only PR would run no suite at all.
- **`test/e2eSelectors.test.ts`** guards the `[data-testid="X"]*=text` trap:
  WebdriverIO compiles it to a SUBSTRING attribute test plus an innermost-match
  condition, so any other testid containing `X` makes the outer element match
  nothing, silently. Narrow on purpose: only ids actually driven with `*=`.
- Root `test/` and `src/test/` are unrelated despite the name. `pnpm test` runs
  two vitest projects (`vite.config.ts`): `unit` (jsdom + mocks) and `docs`
  (node, no setup file) — the split is load-bearing (the jsdom harness dies on
  a missing `Range` outside jsdom; a doc test has no use for Tauri mocks).
  `tsconfig.json` includes `["src", "test"]` — a new top-level test directory
  must join both that and `test.include`, or it runs untypechecked.
