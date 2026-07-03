# End-to-End Testing (Phase 3: remotes, palette, settings) — Design

Status: approved 2026-07-03

## Problem

Phases 1 (#26) and 2 (#28) cover the local read path, write path, and danger
ops. Three surfaces remain without webview-level coverage:

- **Remote operations** — fetch/pull/push and remote management. The sync
  buttons live in the titlebar and Remote screen; regressions here brick the
  most-used daily flows.
- **Command palette** — its own state machine (step stack, chips, frecency)
  with ~30 commands; nothing exercises the machinery end to end.
- **Settings** — persisted to `localStorage["pg-settings-v2"]` and consumed
  across the app; no test proves persistence or behavioral effect.

Investigation surfaced two app defects (both approved for fixing here,
mirroring Phase 2's approach B):

1. `remoteMenuItems` in `src/design/context-menu.tsx` (Fetch / Prune / Set
   URL / Rename / Remove) has **zero call sites** — remote management beyond
   add-remote is unreachable in the UI even though the store and backend
   support it.
2. `confirmForcePush` setting is **inert**: the palette command
   `action:force-push-current` calls `push(..., "WithLease")` with no
   confirm gate, despite Settings rendering a "Confirm force-push" toggle
   that defaults on.

Several more settings are dead (`autoStashBeforePull`, `pruneOnFetch`,
`signCommits`, `showWhitespaceInDiff`, `diffContextLines`, `uiDensity`) —
out of scope; a GitHub issue records them for a wire-or-remove decision.

## Goals

- Cover remote ops end to end against a **local bare repository** as
  `origin` — no network, no credentials (backend shells to the system git
  CLI, which handles path remotes natively).
- Cover the palette **machinery** — each interaction kind once via a
  representative command — not the full catalog.
- Cover settings persistence plus every setting with an observable effect
  (`defaultPullMode`, `addSignoff`, and the newly-gated force-push confirm).
- Land the two app fixes with the tests that prove them.

## Non-goals

- Auth-requiring remotes (HTTP/SSH). `run_git` sets no
  `GIT_TERMINAL_PROMPT=0`, so such remotes could hang on a credential
  prompt — noted in the dead-settings issue as a hardening candidate, not
  fixed here.
- `autoFetchEnabled`/`autoFetchMinutes` behavior (interval ≥60s; needs clock
  mocking).
- Theme editor modal coverage; theme assertion beyond persistence.
- Exhaustive palette catalog (~30 commands); Phases 1/2 already prove the
  underlying store actions for most.
- Wiring the remaining dead settings.

## App changes

1. **Wire remote context menu (behavior):** `PGRemoteRow`
   (`src/design/git-components.tsx`) gains an `onContextMenu` prop;
   `RemoteScreen` attaches the existing `remoteMenuItems` builder. Handlers
   call the existing store actions: `fetch`, `pruneRemote`, `setRemoteUrl`
   (prompt prefilled semantics: single prompt for new URL), `renameRemote`
   (prompt for new name), `removeRemote` (confirm).
2. **Force-push confirm gate (behavior):** in
   `src/features/palette/commands.ts`, `action:force-push-current` reads
   `useSettingsStore`'s `confirmForcePush`; when true, `window.confirm(...)`
   must return true before `push(..., "WithLease")` runs. When false,
   current no-confirm behavior is preserved.
3. **Test attributes (inert):** `data-remote={name}` on the Remote-screen
   remote row (explicit prop threading through `PGRemoteRow`).
4. **Fix (behavior, discovered-by-test, scope addition per Phase 2
   precedent):** in `src/features/palette/usePaletteStore.ts`, `pushStep`
   now sets `open: true`. The pick-item builders in `commands.ts`
   (commitItems/branchItems/tagItems/stashItems) close the palette before
   running `onPick`; for chained flows (reset → pick commit → pick mode,
   rename-branch, push-tag, stash-branch) `onPick` pushed the follow-up
   step onto a closed palette, so the step never rendered and the flow
   silently dead-ended. Found by the two-step reset e2e (test 16); store
   regression test added in `usePaletteStore.test.ts`.
5. **Issue filed:** dead settings list (`autoStashBeforePull`,
   `pruneOnFetch`, `signCommits`, `showWhitespaceInDiff`,
   `diffContextLines`, `uiDensity`) + the `GIT_TERMINAL_PROMPT` hardening
   note.

## Harness additions

- **`remoteRepo()` fixture** (`e2e/support/tempRepo.ts`): work repo plus a
  bare sibling (`git init --bare`) added as `origin` with `main` pushed and
  upstream set (`push -u origin main`). Returns handles to both paths; bare
  truth asserted via `git -C <bare> rev-parse` etc. State variants built by
  the caller with existing helpers:
  - *ahead*: commit locally after the initial push.
  - *behind*: commit → push → `git reset --hard HEAD~1` locally.
  - *diverged*: behind + a fresh local commit.
- **`stubNativeDialogs` prompt queue:** `promptQueue?: string[]` — each
  `window.prompt` call shifts the next value (falls back to `promptText`).
  Needed because Add remote fires two sequential prompts (name, then URL);
  the current single-string stub would set name === URL.
- **`openPalette()` helper** (`e2e/support/app.ts`): dispatches a
  `KeyboardEvent` (`key: "p"`, `metaKey: true`) on `window` via
  `browser.execute` — the AppShell handler is a JS keydown listener, so an
  in-page dispatch is deterministic and avoids embedded-driver Meta-key
  synthesis risk. Waits for `[role="dialog"][aria-label="Command palette"]`.

## Test cases (3 new spec files, ~22 tests)

`remote.e2e.ts` (remoteRepo unless noted):

1. Remote screen lists `origin` with its URL; Ahead/Behind tiles reflect the
   *ahead* variant.
2. Push (*ahead*): titlebar Push → bare repo's `main` advances to local HEAD
   (bare truth); ahead badge clears.
3. Pull (*behind*): titlebar Pull → local HEAD contains the remote commit;
   tree clean.
4. Fetch (*behind*): titlebar Fetch → behind badge appears; worktree HEAD
   unchanged (fetch must not touch the working branch).
5. Add remote: prompt queue `[name, url]` → row appears with both; `git
   remote -v` truth.
6. Remove remote via context menu (confirm stubbed) → row gone; git truth.
7. Rename remote via context menu (prompt) → git truth.
8. Set URL via context menu (prompt) → `git remote get-url` truth.
9. Prune via context menu: stale remote-tracking ref (branch deleted in
   bare after fetch) → ref gone locally.
10. Failed push (*diverged*, non-FF) → `role="alert"` banner with the
    Network error; bare repo unchanged.

`palette.e2e.ts` (basicRepo unless noted):

11. `openPalette()` shows the dialog with Quick actions; Esc on root closes.
12. Nav command: type "reflog" → Enter → Reflog screen active.
13. Direct action (remoteRepo, *behind*): "Fetch all remotes" → behind badge
    appears (observable git effect).
14. Pick step (branchyRepo): "Checkout branch…" → pick → `git symbolic-ref`
    truth + chip text.
15. Input step: "Create branch…" → type name → Enter → branch exists (git
    truth), chip shows it (autoStash checkout).
16. Two-step danger: "Reset current branch to…" → pick parent commit → pick
    Hard → HEAD moved (git truth), tree clean.
17. Chips: query with mixed results → click Branches chip → only
    `[data-pal-type="branch"]` rows listed.
18. Frecency: run a direct command, reopen palette → Recent section lists
    it; `localStorage["pg-palette-frecency"]` non-empty.

`settings.e2e.ts` (remoteRepo *diverged* for pull/push cases):

19. Persistence: set pull mode FF-only in Settings → reload (`refresh` +
    re-arm) → Settings still shows FF-only; `pg-settings-v2` contains it.
20. Pull mode behavior: FF-only on diverged → titlebar Pull → error banner
    (--ff-only refuses); switch to Merge → Pull → merge commit in log (git
    truth).
21. addSignoff (dirtyRepo): enable → commit staged file → `Signed-off-by`
    trailer in `git log -1` body.
22. confirmForcePush on + confirm=false: force-push palette command → bare
    unchanged. confirm=true → bare `main` equals local HEAD (force-with-
    lease applied). Setting-off path: stub confirm=false anyway and assert
    the push still succeeds — proves the gate is bypassed without risking a
    real native confirm (which would hang the webview).

## Conventions (unchanged)

Repo truth as acceptance, UI as wait condition; `stubNativeDialogs` before
trigger, after last reload; tag-scoped text selectors + `button*=`;
timeout+timeoutMsg everywhere; no `pause()`; spec iterations via
`pnpm test:e2e:run`, any src/ change requires full `pnpm test:e2e`. Read
`.claude/skills/e2e-testing/SKILL.md` before writing specs.

## Workflow

Branch `test/e2e-phase3`; small Conventional Commits; squash to one commit
before merge; PR with CI green.

## Risks

- ⌘P synthesis: mitigated by in-page KeyboardEvent dispatch; if the handler
  ever moves to a native accelerator, helper breaks loudly (dialog wait
  times out).
- Prompt queue is new stub surface — keep single-string fallback so Phase 2
  specs stay untouched.
- Palette rows are portaled; selectors must scope to the dialog to avoid
  matching screen content behind it.
- `pgFlash` toasts (no-upstream paths) are bare divs auto-removed ~1.7s —
  not asserted; tests avoid depending on them.
