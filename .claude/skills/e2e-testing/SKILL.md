---
name: e2e-testing
description: Use when writing, debugging, or reviewing WebdriverIO e2e specs in e2e/ — adding tests, selector failures, flaky or suddenly-slow suites (5s per command, multi-minute runs), native dialog/context-menu interaction, temp-repo fixtures, or CI e2e failures.
---

# E2E Testing Playbook (platypusgit)

Hard-won rules from building the suite. Every trap below bit a real implementation attempt; the fix is stated as the rule.

## Commands

**E2E always runs in Docker — never natively, never in a UI window.** The
`test:e2e*` scripts below are the in-container primitives; drive them through
the `test:e2e:docker` wrapper, never directly on the host.

```bash
pnpm test:e2e:docker full --spec e2e/specs/<file>  # build + run — REQUIRED after ANY src/ or src-tauri/ change
pnpm test:e2e:docker run  --spec e2e/specs/<file>  # reuses this worktree's e2e/.bin snapshot — spec-only iterations
pnpm test:e2e:docker                               # build + whole suite
E2E_SHARD=2 E2E_SHARDS=4 pnpm test:e2e:docker run  # replay ONE CI shard (issue 189)
pnpm exec tsc -p e2e/tsconfig.json --noEmit        # e2e typecheck gate (root tsc EXCLUDES e2e/)
```

**CI runs the suite in four shards, one build.** `e2e/shardSpecs.ts` derives the
slice from the files on disk and packs by measured duration, so a spec you ADD
needs no edit there — it is picked up and weighted at the suite mean. Two things
follow for debugging: a shard's log opens with the exact spec list it ran (replay
it with `--spec`, or with the `E2E_SHARD` pair above), and `strategy` in
`.github/workflows/e2e.yml` is where the shard count lives — `test/shardSpecs.test.ts`
fails if the matrix and the splitter ever disagree about what runs. Unsharded
(every local run) the conf keeps its plain glob.

**Stale-binary trap:** the `run` phase tests whatever binary is in `e2e/.bin/`. A green run after touching `src/` proves nothing unless a `build`/`full` ran after the change. Plain `cargo build` silently rewrites `target/debug/platypusgit` WITHOUT `custom-protocol` (blank window) — that's why the snapshot exists. Close any running dev app first: debug builds all serve WebDriver on port 4445 and the runner may attach to the dev instance and clear its localStorage.

**Wrong-binary trap — NATIVE runs collide across worktrees.** Port 4445 is a
HOST port for native runs, so if any other worktree has an e2e binary running,
your runner attaches to **that** binary — a different checkout of the code. The
failure is maximally confusing: the app responds, IPC works, fixtures load, and
unrelated specs *pass*, because they pass against someone else's build. Only an
assertion touching your actual change fails.

Diagnose it in one shot — dump the served bundle and compare to your `dist/`:

```ts
await browser.execute(() =>
  [...document.querySelectorAll("script[src]")].map((s) => (s as HTMLScriptElement).src));
// tauri://localhost/assets/index-<hash>.js  ← must match your dist/assets/
```

A hash that isn't in your own `dist/assets/` means you are driving another
worktree's app. Confirm with `ps aux | grep platypusgit` (the path names the
worktree). **Do not kill it** — with several agents active it is another
session's run. Use `pnpm test:e2e:docker` instead: compose derives a
per-worktree project name and keeps 4445 inside the container, so concurrent
worktrees never collide. This is the operational reason the Docker path exists,
beyond headlessness.

## Suite-speed guards (wdio.conf.ts `before` hook — don't remove)

Two conf-level guards eliminate the historical "suite suddenly takes minutes"
flakes, and a third removes the dead-handle wait class (#364 — see
`installStaleProofWaits`, and note it must be installed before the first `$()`).
All three live in the `before` hook; removing any brings its failure class back:

1. **`browser.tauri.switchWindow("main")`** — sets the service's session-wide "user switched windows" flag, which makes its per-command focus check (`ensureActiveWindowFocus`) skip forever. Unskipped, that check runs a direct-eval script before EVERY find/click that polls 5s for `window.__wdio_original_core__` whenever the page is unarmed. Single-window app: focus management has nothing to manage.
2. **`browser.setTimeout({ script: … })` — 2.5s on macOS, 8s on Linux.** The driver's default W3C script timeout is 30s. An `execute()` that lands while a `browser.refresh()` navigation is mid-document-swap gets its completion handler silently dropped; the driver waits the FULL script timeout, then the caller retries — so a loss costs the TIMEOUT, not the work. The cap is only the belt: `refreshAndSettle` (below) removes the roll itself. Linux was uncapped until #194 because a timed-out-but-completed script gets retried and double-ran side-effectful helpers (merge-conflict desync); `executeOnce` closed that, so the cap is now safe there. 8s is measured — with the mid-swap executes gone the slowest in-page script anywhere in the suite is 12ms in local Docker and 190ms on a real CI runner (`E2E_SCRIPT_TIMING=1` prints the per-spec p50/p90/p99/max; `E2E_SCRIPT_TIMEOUT_MS` overrides the cap).

3. **`installStaleProofWaits()`** — overwrites `waitForDisplayed` so each poll re-resolves the selector. `isDisplayed` caches `elementId` and never re-runs the selector, and a detached node answers "not displayed" without raising stale, so a re-render landing between the find and the visibility check leaves the wait polling a dead node for its whole budget with the element on screen. That is the #364 flake class, across every shard, and a bigger timeout cannot fix it. Element overrides attach at element-creation time, so this must run before the first `$()` — `test/e2eWaitGate.test.ts` pins that, `harness.e2e.ts` pins the behaviour.

`armDriverBridge()` (`e2e/support/app.ts`) hands `window.__TAURI__.core` (e2e builds only, via `src-tauri/tauri.e2e.conf.json`) to the driver's direct-eval channel. With guard 1 active it's belt-and-braces (only `browser.tauri.*` calls need it), but keep the pattern: it doubles as the post-refresh settle gate.

**Reload race — settled by `refreshAndSettle` (#194).** After `browser.refresh()`, an immediate arm can land on the OUTGOING document (it also has `__TAURI__`), leaving the new page unarmed; worse, that arm is an `execute()` fired mid-document-swap, which is the 30s stall above. The only trustworthy "navigation settled" signal is a matched WebDriver find. **Rule, now enforced by `test/e2eRefreshGate.test.ts` rather than by this paragraph: `browser.refresh()` is called in exactly ONE place, `refreshAndSettle(gate)` in `e2e/support/app.ts`** — refresh → matched find → arm. Every reload site (`resetApp`/`openRepo`/`reopenRepo`/`seedOpenRepos`, and the two spec-level ones) goes through it. The `gate` you pass must START with a WebDriver query (`waitForDisplayed`, `waitForExist`, `waitUntil` over `isExisting()`, or `waitRepoLoaded`) — never `browser.execute`/`executeOnce`/`waitForSelector`, which poll in page and put the stall right back. The guard test fails on both mistakes.

**Flake bands:** healthy full suite ≈ 30s–1.5min on macOS/WKWebView. Sustained runs >2.5min, or single commands taking 5–30s, mean a guard above was lost or a new refresh site skipped the settle-gate pattern — check conf + the newest refresh site, not the specs.

**Under xvfb the band is different, and guard 2 does NOT apply there — so a
stall costs the full 30s.** Measured (issue 189, run 32242497631): the whole
suite is ~530s of spec time, and roughly **eight ~30s stalls** are inside that
number. Every spec over 30s comes out as `n × 30` plus small change — `keymap`
140s, `repo-tabs` 96s, `palette` 66s, then four in the 32–37s band — while the 18
files with few refreshes total under 60s. WHICH specs pay moves run to run,
because it is the reload race, not the spec. So:

- **A ~30s multiple in a spec time is the race, not your selector.** Do not go
  hunting a 5s selector penalty for it.
- **Every `browser.refresh()` you add is another roll of that die.** Adding one
  per spec file (a `resetApp()` in the conf `before` hook) took the suite from
  528s to **1064s** — measured, run 32246987758, and reverted. Prefer a
  no-navigation alternative whenever one exists.
- Under the stalls the residual cost is real work: the heavy specs call
  `openRepo()` once per `it()` (`keymap` 28×), and one of those is refresh +
  re-arm + repo open + syncing settle.

A per-shard time near its own `WEIGHTS` entry (`e2e/shardSpecs.ts`) is healthy; a
3× jump on a shard whose specs you did not touch is the bridge or a new refresh
site, and that is when to reread this section.

## Focus self-heal (macOS — `ensureMacAppFocus`, don't remove)

The unbundled debug binary doesn't reliably win foreground focus at launch. An unfocused/occluded WKWebView reports the page hidden (`visibilityState: "hidden"`, `hasFocus() === false`), and `isDisplayed()` then returns false for elements that ARE in the DOM — every `waitForDisplayed` dies with "... never appeared" (issue #32). The service's own self-heal can't fire: it invokes `plugin:wdio|get_window_states`, which `tauri-plugin-wdio-webdriver` 1.2.0 (latest as of 2026-07; pair pinned service+plugin) does not ship — and guard 1 above disables the check anyway.

Fix in tree: `ensureMacAppFocus()` (`e2e/support/app.ts`) — if the page reports hidden/unfocused, calls the window's own `setFocus()` via the global Tauri API (tao: `makeKeyAndOrderFront` + `activateIgnoringOtherApps` — wins focus from any app, no osascript/TCC prompt) and retries until the page reports visible+focused. Runs in wdio.conf `before` (session start) and `beforeTest` (heals mid-suite steals; one cheap execute when already focused). Needs `core:window:allow-set-focus`, granted ONLY by the e2e inline capability in `src-tauri/tauri.e2e.conf.json` — prod capability set untouched. No-op off macOS; Linux CI (xvfb) never loses focus. If a future service+plugin release ships `get_window_states`, the upstream self-heal still stays disabled by guard 1 — keep `ensureMacAppFocus` regardless.

## Selectors

| Need | Use | Never |
|---|---|---|
| Button by label | `button*=Stage all` | `button=…` (PGButton wraps label in `<span>` — exact match can't hit) |
| Text anywhere | tag-scoped: `div*=`, `span*=`, `label*=` | bare `*=text` (partial-LINK-text: anchors only) |
| Row by identity | `[data-testid="…"][data-path="…"]` or attr+text `[data-branch-row]*=main` | index/nth selectors |
| Dialog option | `dialog.$('label*=Option title')` | `div*=` inside dialogs (matches the outer wrapper — XPath `contains(., t)` uses concatenated descendant text) |

**A descendant `data-testid` must not START WITH its container's.** WebdriverIO
compiles `[data-testid="row"]*=text` to
`.//*[contains(@data-testid, "row") and contains(., "text") and not(.//*[contains(@data-testid, "row")])]`
— the attribute test is a **substring** match, and the `not(...)` keeps only the
innermost hit. So a child testid like `row-action` satisfies the container's own
condition, the `not(...)` goes false, and the row matches **nothing**, silently:
`waitForDisplayed` just reports your `timeoutMsg`. Bit issue 146's PR — a
`rebase-row-action` picker added inside `rebase-row` broke "plan row missing"
2 runs out of 2, while the pre-existing `rebase-row-badge` had hidden the same
trap for months because it only renders on a merge row. Name children with a
different stem (`rebase-action`, `rebase-badge`), and note that this is invisible
to `pnpm test` — jsdom's `getByTestId` is an exact-match CSS lookup.

**Substring traps (both happened):** `span*=conflict` matched the filename `conflict.txt`, making a status-badge assertion vacuous — fixed to `span*=1 conflict`. Pick text unique across the whole screen INCLUDING file names the fixture creates. `button*=Go` inside a dialog is fine only because Cancel/Go are the only buttons — verify scope before trusting short substrings.

Adding hooks: `PGButton`/`PGInput` spread `...rest` (pass `data-testid` directly). `PGIconButton` does NOT (title only). Design-system rows need an explicit prop threaded. One screen mounts at a time, so testids may repeat across screens.

## Native dialogs, context menus, hover

WebDriver cannot drive `window.prompt`/`confirm`, right-click, or hover here.

- `stubNativeDialogs({promptText, confirm})` — call AFTER the last page (re)load (reloads wipe stubs) and BEFORE the triggering click.
- `jsContextMenu(selector, {text})` opens the app's portal context menu; `jsClickMenuItem(label)` clicks an item; `jsHoverMenuItem(label)` opens hover submenus (e.g. History → "Reset current branch to here"). All in `e2e/support/app.ts` — extend the helper there, never inline in a spec.
- **Every side-effectful in-page script goes through `executeOnce()`** (`e2e/support/app.ts`), never bare `browser.execute`. A driver script-timeout (routine under xvfb: eval completes later than the timeout) makes WebdriverIO retry the command, re-running a script whose effects already landed — double keydown, toggle flipped back, confirm counter zeroed (issue #35, the Linux roaming flake). `executeOnce` mints a token per logical call and the page skips already-run tokens. Read-only scripts (DOM dumps, localStorage reads) stay on bare `browser.execute`. Guard is self-tested in `e2e/specs/harness.e2e.ts`.
- `stubNativeDialogs({promptQueue: ["a", "b"]})` — multi-prompt flows (Add
  remote asks name THEN url; a single promptText would set name === url).
  Confirm calls are counted: `confirmCallCount()` is the positive signal
  that a confirm gate fired (there is no UI signal when a user "cancels").
- Palette: `openPalette()` (js-dispatched ⌘P — the driver can't synthesize
  Meta chords), `jsKey(paletteInput, "Enter"|"Escape")` for control keys,
  `setValue(paletteInput)` for typing. Scope EVERY palette selector under
  `paletteDialog` — it's portaled to body over the live screen.

## Fixtures & assertions

Fixtures live in `e2e/support/tempRepo.ts` (`basicRepo`, `dirtyRepo`, `branchyRepo`, `conflictRepo`, `cherryRepo`, `rebaseConflictRepo`). Geometry gotchas that produced unsatisfiable assertions:

- Branch-from-tip merges **fast-forward** — no merge commit exists to assert. Diverge both branches if the test needs one.
- Interactive-rebase conflicts: `rebase_start` resets to the first surviving pick's parent, so a **leading** drop can never conflict — drop a **middle** commit.
- The store reads status at `openRepo`; **dirty files must exist on disk BEFORE openRepo** or the UI won't know.
- History defaults to HEAD-reachable commits. Unmerged-ref commits need the
  toolbar ref selector (`[data-testid="history-ref-select"]`) to scope the log
  first — drive it with `jsPickOption`, never a WebDriver select action. There
  is no native `<select>` left in the app (issue 146): every dropdown is a
  `role="combobox"` trigger plus a portalled `[data-pg-listbox]`, so a pick is
  "mousedown the trigger, wait for the option, click it" — which is what
  `jsPickOption` does, in-page, for the same reason `jsContextMenu` is in-page.
  `jsPickOption(sel, value, { within, text })` narrows to one instance when
  several are mounted (the Rebase plan mounts one picker per row). It replaced
  `jsSelectValue`, which existed because WebKitGTK under xvfb accepted the
  `<option>` click WITHOUT firing a React-visible change event (bit PR #40 on
  CI) — a trap that no longer has a subject. **Both of its steps retry now
  (#364)**: a React commit between "the option exists" and "click the option"
  unmounts the portal (`option "…" vanished before the click`, 4 sightings) and
  one between the trigger's mousedown and the portal mounting loses the open
  (`… never appeared`, 2). Retrying is safe only because a miss dispatches
  nothing — keep any new step in that helper side-effect-free on the
  not-found path.
- Root commit's "Interactive rebase from here" silently no-ops.
- `remoteRepo()` pairs a work repo with a local bare `origin`. `makeBehind`
  rewinds `refs/remotes/origin/main` so fetch has something to discover —
  but that same rewind makes `--force-with-lease` fail ("stale info").
  Force-push tests use `makeDiverged` (accurate remote-tracking) instead.
- Titlebar Fetch/Pull/Push are unambiguous `button*=` targets only while a
  non-Remote screen is active — the Remote screen adds two more sets.

**Assertion contract:** repo truth (`repo.git(...)`, `repo.read(...)`) is the acceptance, as plain `expect`s AFTER a UI wait; UI text is the wait condition. `waitUntil` on repo truth only when no UI signal exists — say so in a comment. Every wait: `timeout` + `timeoutMsg`. Never `pause()`.

**Why repo truth is a bad WAIT even though it's the right ASSERTION** — a git
command is not atomic, so one part of repo truth can be observable while the
part you're asserting is not yet. Concretely (#133, caught by CI): `git stash
push` updates `refs/stash` and only THEN restores the working tree, so
`waitUntil(() => git("stash","list").includes(msg))` returns while the stashed
file is *still dirty*, and the very next `expect(repo.read(f)).not.toContain(...)`
loses the race. Same shape for any store-then-mutate op — a stash rename is a
store followed by a drop, so the new message is on the reflog while the old entry
still exists. A UI signal (`changeRow(f).waitForExist({reverse: true})`, a row
repainting) can only appear after the whole backend call returned, which is
strictly after every part of the git op. Prefer it; when you truly must wait on
repo truth, wait on the LAST thing the command does, not the first.

**And you cannot guess which part is last — read the implementation.** The
orderings that bit this suite are all counter-intuitive, and each one made a wait
resume mid-operation:

| Op | Order | What the wrong wait cost |
|---|---|---|
| `git stash push` | `refs/stash` → worktree | entry present, file still dirty (#133) |
| libgit2 hard reset | checkout → **HEAD** → index (`reset.c`) | HEAD moved, index still on the old tree → `git status` reports the file *staged* |
| `rebase_abort` | `set_head(branch)` → hard reset | HEAD back on the branch, conflicted worktree still there (measured: `UU conflict.txt`) |
| `git pull` (fast-forward) | worktree + index → **ref** | pulled file readable, `log -1` still the old commit |

Note the last two point in OPPOSITE directions — a reset publishes its ref
early, a fast-forward publishes it late — so "wait on HEAD" is neither safe nor
unsafe in general. Only the UI signal is safe in general, because it needs the
whole IPC call to have returned. Widen the window to check a suspicion: a
20 000-file fixture turned the rebase-abort race from unobservable into 2 runs
out of 2.

**A wait must not be able to bind to the screen you are LEAVING**, because
`waitForDisplayed` cannot recover from it. `$(sel)` resolved a moment before a
screen switch can match a row on the OUTGOING screen, and once React unmounts
that row the wait is dead — for a reason specific to how `isDisplayed` is built,
so don't assume the usual stale-element recovery covers you:

- WebdriverIO's refetch DOES work for protocol-level element commands. Measured:
  `getText()` on such a handle raises stale, `refetchElement` re-runs the
  selector, `elementId` changes, and it returns the NEW row's text.
- but `isDisplayed` doesn't go through the protocol. It is
  `browser.execute(checkVisibility, elem)` plus a `getComputedStyle` probe, with
  the element passed as an ARGUMENT — and a detached node answers both honestly:
  `checkVisibility()` is `false`, `getComputedStyle()` returns empty rather than
  throwing. No "stale element reference" is ever raised, so
  `elementErrorHandler` has nothing to catch and never refetches.
- so `waitForDisplayed` (which is `waitUntil(() => isDisplayed())`) polls the
  dead node for its entire budget, with the row it wanted on screen the whole
  time.

Load-dependent (a busier machine loses the resolve-vs-swap race more often) and
immune to a bigger timeout — `history-ops`'s `[data-pg-row]*=b.txt`, which also
matched History's commit row for "feat: add b.txt", failed 4 runs in 10 under CPU
contention at 25s, having already been raised from 15s for exactly this symptom.
So, after any action that changes screens: **wait on a signal that exists only on
the destination first** (its `DeepViewHeader` crumb — name the shas it should
carry, so a mis-route fails there saying which pair it got), and make the
follow-up selector unambiguous — pure CSS scoped to the destination's pane
(`[data-pg-pane="commitDiff.files"] [data-pg-row][data-path="b.txt"]`), not
`*=`-text that some other screen also satisfies.

**The dead-handle half of that is now fixed for the whole suite (#364); the
ambiguous-selector half is still yours.** `installStaleProofWaits()`
(`e2e/support/app.ts`, installed by the conf's `before` hook) overwrites
`waitForDisplayed` so every poll re-resolves the selector with a fresh
WebDriver find — session-wide, because there are 227 call sites and a helper
only fixes the ones that adopt it. It cost a whole table of specs before that:
`commit.e2e`'s clean-state wait (its `PGEmpty` is unmounted and remounted by
every refresh, since `CommitPanel` gates it on `!loading`), `remote.e2e`'s
renamed-remote row, `settings.e2e` after a reload — all on a starved CI runner,
never locally. What still needs care:

- **Re-resolution rescues a swapped node, not a wrong selector.** A wait that
  binds to the OUTGOING screen's row will now happily re-resolve to that same
  row for as long as it exists. Scope to the destination anyway.
- Three shapes stay on the original implementation and can still go dead:
  `reverse` waits (a detached node reports what they want — fine), a non-string
  selector, and an element taken out of a `$$` list (identified by INDEX, so
  re-running the selector alone would silently wait on the first match).
- Don't reach for `waitForSelector` just to dodge this — it polls in page,
  which is the #194 stall after a navigation. `waitForDisplayed` is a legal
  settle gate precisely because it is a find.
- `test/e2eWaitGate.test.ts` pins the install; `harness.e2e.ts` pins the
  behaviour, with a *control* test proving a raw handle still goes dead. A
  failing control means webdriverio started refetching and the override can go.

**Wait on state, not on rendered prose.** Six waits matched
`div*=Working tree clean` — a `PGEmpty` title, so a copy edit could redden the
required gate, and `div*=` resolves to whichever innermost div contains the
phrase, which is never the element you meant. Use `WORKING_TREE_CLEAN`
(`[data-testid="working-tree-clean"]`); add a testid rather than a phrase for
the next one.

**A readiness signal that is also true of "not started yet" is not a readiness
signal.** `merge-window` waited for Apply to be *disabled* to mean "the next
file's fresh model is unresolved", but `canApply`'s `allResolved` is
`regionStates.every(...)` — vacuously true while the list is empty — so a
retarget goes disabled (loading) → briefly ENABLED with zero regions → disabled
(one unresolved region). The wait was satisfied by the first, so ⌘1 could land in
the second with no region to accept and be dropped: "Apply never enabled for the
second file", CI-only. Wait for the counter to read `0/N` instead — a state only
the seeded-and-unresolved model produces. Same fix, same reason, as the
`regionStates` guard in `MergeWindow.test.tsx`.

## Debugging

1. Reproduce on one spec: `pnpm test:e2e:docker run --spec e2e/specs/<file>`.
2. Inspect real DOM, don't guess: `await browser.execute(() => document.querySelector('[role="dialog"]')?.outerHTML)`.
3. Suite slow? → flake bands above (bridge), not the spec.
4. Selector fights >20min → capture outerHTML evidence, then fix or escalate; never fake a flow by shelling `git` for the action under test.
5. "X never appeared" while the DOM provably contains X (dump outerHTML to
   check) → focus race: WKWebView reports `visibilityState: "hidden"` and
   `isDisplayed()` lies. `ensureMacAppFocus` (see focus self-heal section)
   should heal this at session start and before each test — if it still
   happens, check that the `before`/`beforeTest` hooks and the `e2e-focus`
   capability (`src-tauri/tauri.e2e.conf.json`) are intact, and that the
   binary was rebuilt after any capability change. CI (xvfb) is immune.

## A red CI gate on a tree that looks fine (#364)

**Two API calls settle "is it me?" before anything else costs you a merge
window:**

```bash
gh run list --workflow e2e.yml --branch main --limit 12 \
  --json databaseId,conclusion,createdAt
gh run view <red-id> --log-failed | grep -E "✖|Error: "
```

A byte-identical failure on a recent red `main` run is proof it is not your
diff — no scratch branch to push, nothing to clean up. `main` goes red
intermittently (measured: 3 failures in 40 `push: main` runs; the `cancelled`
ones are `concurrency` collapsing a merge burst, not a signal), so one is often
already there. Only when main's recent runs are all green, fall back to pushing
your exact tree to a scratch branch and `gh workflow run e2e.yml --ref <it>`.

Then read the shape of the failure:

- **A wait that gives up while the screen is right, on a sub-test that wanders
  between runs**, is the #364 class — a real logic regression fails the same
  assertion every time. That class is fixed at the command level now (see the
  dead-handle section above), so a NEW sighting deserves the diff audit, not a
  re-run.
- `[e2e] <spec>: N driver scripts, M stalled` is a speed-INDEPENDENT diff of app
  behaviour between two runs. Identical counts on the specs you did not touch is
  strong evidence of no behavioural change — far better than comparing wall
  clock on a noisy runner.
- `[e2e] RETRY: <spec> failed on attempt 1` means `specFileRetries: 1` absorbed
  a failure. **A green gate with that line in it is still a signal** — the
  floor exists for a starved runner losing the app itself
  (`app never rendered Welcome screen`), not to paper over your change. It is
  also emitted as a `::warning` and into the job summary, so look there first.
- Audit your own diff regardless of how confident you are it is a flake. Every
  time that audit has been run here it found something real, usually somewhere
  else entirely (a blocking call added to a startup or spawn path is the
  classic). Also: `e2e/wdio.conf.ts` passes no `appArgs`, so the e2e binary gets
  EMPTY argv — any CLI-parsing change is inert in e2e by construction.

## Before committing

- src/ touched → `pnpm test:e2e:docker full` green (paste output, not counts). Docker, never a native run.
- `pnpm exec tsc -p e2e/tsconfig.json --noEmit` + `pnpm tsc --noEmit` + `pnpm test`.
- New refresh site → re-arm rule applied. New helper → lives in `e2e/support/`.
