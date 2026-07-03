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

## Driver bridge (the 5-seconds-per-command failure)

The embedded driver's focus-check polls 5s for `window.__wdio_original_core__` on EVERY find/click when unarmed. `armDriverBridge()` (`e2e/support/app.ts`) hands it `window.__TAURI__.core` (exists only in e2e builds via `src-tauri/tauri.e2e.conf.json`).

**Reload race:** after `browser.refresh()`, an immediate arm can land on the OUTGOING document (it also has `__TAURI__`), leaving the new page unarmed. The only trustworthy "navigation settled" signal is a matched WebDriver find. **Rule: any new `browser.refresh()` call site must wait for a real element, then call `armDriverBridge()` again** — see `resetApp`/`openRepo`/`waitRepoLoaded` for the pattern.

**Flake bands:** healthy full suite ≈ 20s–2.5min. A run >5min, or single commands taking 5–30s, means the bridge is unarmed somewhere — check the newest refresh site, not the specs.

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

## Fixtures & assertions

Fixtures live in `e2e/support/tempRepo.ts` (`basicRepo`, `dirtyRepo`, `branchyRepo`, `conflictRepo`, `cherryRepo`, `rebaseConflictRepo`). Geometry gotchas that produced unsatisfiable assertions:

- Branch-from-tip merges **fast-forward** — no merge commit exists to assert. Diverge both branches if the test needs one.
- Interactive-rebase conflicts: `rebase_start` resets to the first surviving pick's parent, so a **leading** drop can never conflict — drop a **middle** commit.
- The store reads status at `openRepo`; **dirty files must exist on disk BEFORE openRepo** or the UI won't know.
- History shows HEAD-reachable commits only (issue #27) — unmerged-ref commits appear nowhere.
- Root commit's "Interactive rebase from here" silently no-ops.

**Assertion contract:** repo truth (`repo.git(...)`, `repo.read(...)`) is the acceptance, as plain `expect`s AFTER a UI wait; UI text is the wait condition. `waitUntil` on repo truth only when no UI signal exists — say so in a comment. Every wait: `timeout` + `timeoutMsg`. Never `pause()`.

## Debugging

1. Reproduce on one spec: `pnpm test:e2e:run --spec e2e/specs/<file>`.
2. Inspect real DOM, don't guess: `await browser.execute(() => document.querySelector('[role="dialog"]')?.outerHTML)`.
3. Suite slow? → flake bands above (bridge), not the spec.
4. Selector fights >20min → capture outerHTML evidence, then fix or escalate; never fake a flow by shelling `git` for the action under test.

## Before committing

- src/ touched → full `pnpm test:e2e` green (paste output, not counts).
- `pnpm exec tsc -p e2e/tsconfig.json --noEmit` + `pnpm tsc --noEmit` + `pnpm test`.
- New refresh site → re-arm rule applied. New helper → lives in `e2e/support/`.
