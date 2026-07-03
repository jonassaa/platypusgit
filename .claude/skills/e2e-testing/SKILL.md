---
name: e2e-testing
description: Use when writing, debugging, or reviewing WebdriverIO e2e specs in e2e/ — adding tests, selector failures, flaky or suddenly-slow suites (5s per command, multi-minute runs), native dialog/context-menu interaction, temp-repo fixtures, or CI e2e failures.
---

# E2E Testing Playbook (platypusgit)

Hard-won rules from building the suite. Every trap below bit a real implementation attempt; the fix is stated as the rule.

## Commands

```bash
pnpm test:e2e        # test:e2e:build + test:e2e:run — REQUIRED after ANY src/ or src-tauri/ change
pnpm test:e2e:run    # reuses e2e/.bin snapshot — spec-only iterations
pnpm test:e2e:run --spec e2e/specs/<file>   # single spec
pnpm exec tsc -p e2e/tsconfig.json --noEmit # e2e typecheck gate (root tsc EXCLUDES e2e/)
```

**Stale-binary trap:** `test:e2e:run` tests whatever binary is in `e2e/.bin/`. A green run after touching `src/` proves nothing unless a full `test:e2e` ran after the change. Plain `cargo build` silently rewrites `target/debug/platypusgit` WITHOUT `custom-protocol` (blank window) — that's why the snapshot exists. Close any running dev app first: debug builds all serve WebDriver on port 4445 and the runner may attach to the dev instance and clear its localStorage.

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
- History shows HEAD-reachable commits only (issue #27) — unmerged-ref commits appear nowhere.
- Root commit's "Interactive rebase from here" silently no-ops.
- `remoteRepo()` pairs a work repo with a local bare `origin`. `makeBehind`
  rewinds `refs/remotes/origin/main` so fetch has something to discover —
  but that same rewind makes `--force-with-lease` fail ("stale info").
  Force-push tests use `makeDiverged` (accurate remote-tracking) instead.
- Titlebar Fetch/Pull/Push are unambiguous `button*=` targets only while a
  non-Remote screen is active — the Remote screen adds two more sets.

**Assertion contract:** repo truth (`repo.git(...)`, `repo.read(...)`) is the acceptance, as plain `expect`s AFTER a UI wait; UI text is the wait condition. `waitUntil` on repo truth only when no UI signal exists — say so in a comment. Every wait: `timeout` + `timeoutMsg`. Never `pause()`.

## Debugging

1. Reproduce on one spec: `pnpm test:e2e:run --spec e2e/specs/<file>`.
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

- src/ touched → full `pnpm test:e2e` green (paste output, not counts).
- `pnpm exec tsc -p e2e/tsconfig.json --noEmit` + `pnpm tsc --noEmit` + `pnpm test`.
- New refresh site → re-arm rule applied. New helper → lives in `e2e/support/`.
