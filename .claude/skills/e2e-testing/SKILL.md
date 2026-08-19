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
pnpm exec tsc -p e2e/tsconfig.json --noEmit        # e2e typecheck gate (root tsc EXCLUDES e2e/)
```

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

Two conf-level guards eliminate the historical "suite suddenly takes minutes" flakes. Both live in the `before` hook; removing either brings a stall class back:

1. **`browser.tauri.switchWindow("main")`** — sets the service's session-wide "user switched windows" flag, which makes its per-command focus check (`ensureActiveWindowFocus`) skip forever. Unskipped, that check runs a direct-eval script before EVERY find/click that polls 5s for `window.__wdio_original_core__` whenever the page is unarmed. Single-window app: focus management has nothing to manage.
2. **`browser.setTimeout({ script: 2500 })` — macOS ONLY.** The driver's default W3C script timeout is 30s. An `execute()` that lands while a `browser.refresh()` navigation is mid-document-swap gets its WKWebView completion handler silently dropped; the driver waits the FULL script timeout, then the caller retries. Uncapped, this produced random ~30s stalls per spec (moving between specs run to run). Locally all in-page scripts finish in ms, so 2.5s only bounds the hang. **Never apply the cap on Linux CI:** under xvfb legitimate executes can exceed 2.5s, and a script that times out but still ran gets retried — double-running side-effectful helpers (bit us: merge-conflict flow desync, `mark-resolved` never found). The `executeOnce` guard (see context-menu section) makes such retries no-ops.

`armDriverBridge()` (`e2e/support/app.ts`) hands `window.__TAURI__.core` (e2e builds only, via `src-tauri/tauri.e2e.conf.json`) to the driver's direct-eval channel. With guard 1 active it's belt-and-braces (only `browser.tauri.*` calls need it), but keep the pattern: it doubles as the post-refresh settle gate.

**Reload race:** after `browser.refresh()`, an immediate arm can land on the OUTGOING document (it also has `__TAURI__`), leaving the new page unarmed. The only trustworthy "navigation settled" signal is a matched WebDriver find. **Rule: any new `browser.refresh()` call site must wait for a real element, then call `armDriverBridge()` again** — see `resetApp`/`openRepo`/`waitRepoLoaded` for the pattern.

**Flake bands:** healthy full suite ≈ 30s–1.5min. Sustained runs >2.5min, or single commands taking 5–30s, mean a guard above was lost or a new refresh site skipped the settle-gate pattern — check conf + the newest refresh site, not the specs.

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
  CI) — a trap that no longer has a subject.
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

## Before committing

- src/ touched → `pnpm test:e2e:docker full` green (paste output, not counts). Docker, never a native run.
- `pnpm exec tsc -p e2e/tsconfig.json --noEmit` + `pnpm tsc --noEmit` + `pnpm test`.
- New refresh site → re-arm rule applied. New helper → lives in `e2e/support/`.
