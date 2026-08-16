# Multi-repo tabs — implementation plan

**Goal:** N repositories open at once in one window. `useRepoStore` keeps holding
exactly one repository's live state — the active tab's — and a new
`useTabsStore` owns the open set plus a frozen slice per inactive tab. Switching
snapshots the outgoing slice, hydrates the incoming one, and refreshes. Every
screen keeps reading the active repo through the API it already uses.

**Architecture:** Mostly frontend. One new backend trait method + command
(`close_repo`) so a closed tab stops leaking a `git2::Repository` — `open` mints
a fresh UUID and never evicts today. Two new pure modules carry the risky logic
(`repoSlice.ts` = the anti-leak contract, `tabs.ts` = list reducers +
persistence), so the store code stays thin and the invariants are unit-testable.

**Tech Stack:** React 18 + Zustand, Tauri 2 multi-window, vitest/RTL,
WebdriverIO e2e in Docker.

**Design doc:** `docs/superpowers/specs/2026-08-14-multi-repo-tabs-design.md`
**Issue:** [#90](https://github.com/jonassaa/platypusgit/issues/90)

## Global Constraints

- Zustand **per feature**. `useTabsStore` lives in `features/repo/` next to the
  store it drives; it must not absorb `useRepoStore`'s fields.
- Dependency direction is **one way**: `useTabsStore` → `useRepoStore`. No cycle.
  `useRepoStore` imports nothing from the tabs store.
- Frontend never calls `invoke()` directly — typed wrapper in `src/lib/tauri.ts`.
- Never `window.confirm`/`window.prompt` — `pgConfirm`/`pgPrompt` from `@/design`.
  Component tests rendering a confirm need `WithDialogs` from `@/test/dialog`.
- UI primitives from `@/design`, re-exported via `design/index.ts`. The tab strip
  is **chrome**: fixed height, no `var(--row-step)`.
- The fixed frame holds: the strip is `flexShrink: 0` and owns its own
  `overflow-x: auto`. Nothing may make the document scroll.
- Never hardcode the accent hue — `var(--accent)` / `oklch(from var(--accent) …)`.
- Danger-op error paths refresh **before** setting `error`; the new
  `setErrorFor` keeps that ordering.
- `pg-screen` stays dead. Per-tab screen is session-only.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Do not run `pnpm test:e2e:docker`** in this pass (concurrent agents, 8GB VM).
  CI's `e2e-linux` is the gate; specs must typecheck and their selectors must be
  checked by reading.

## File Structure

**Create:**
- `src/features/repo/repoSlice.ts` — `RepoSlice`, `REPO_SLICE_KEYS`,
  `EMPTY_SLICE`, `sliceOf`.
- `src/features/repo/repoSlice.test.ts`
- `src/features/repo/tabs.ts` — `RepoTab`, list reducers, `labelTabs`,
  `loadOpenRepos`/`saveOpenRepos`.
- `src/features/repo/tabs.test.ts`
- `src/features/repo/useTabsStore.ts` — the store.
- `src/features/repo/useTabsStore.test.ts`
- `src/features/repo/RepoTabs.tsx` — the strip's feature wiring + context menu.
- `src/features/repo/RepoTabs.test.tsx`
- `e2e/specs/repo-tabs.e2e.ts`

**Modify:**
- `src-tauri/src/git/mod.rs` — `GitBackend::close`.
- `src-tauri/src/git/libgit2.rs` — implement it.
- `src-tauri/src/git/cli.rs` — `NotImplemented` stub.
- `src-tauri/src/commands/repo.rs` — `close_repo`.
- `src-tauri/src/lib.rs` — register it.
- `src-tauri/tests/repo.rs` (or the closest existing suite) — close/multi-open.
- `src/lib/tauri.ts` — `closeRepo(repoId)` wrapper.
- `src/features/repo/useRepoStore.ts` — slice-driven init/reset, `openRepoAt`,
  `hydrate`, `snapshot`, `setFor`/`setErrorFor` guards; `openRepo` removed.
- `src/design/chrome.tsx` — `PGTabStrip`, `PGTab`.
- `src/AppShell.tsx` — render the strip, per-tab screen, keyed screen subtree,
  restore session, "Close repo" → close tab.
- `src/screens/Welcome.tsx`, `src/features/repo/ops.ts`,
  `src/features/cli/useCliLaunch.ts`, `src/features/create/useCreateStore.ts` —
  `openRepo` call sites move to the tabs store.
- `src/features/merge/openMergeWindow.ts` — repo-guarded on-destroy refresh.
- `src/features/keymap/actions.ts` — five `tab.*` actions; `run(chord)`.
- `src/features/keymap/useKeymapStore.ts` — pass the chord to `run`.
- `src/features/keymap/CheatSheet.tsx` — collapse >3 chords to `first–last`.
- `src/features/keymap/presets.ts` — bind the five in `COMMON`.
- `src/features/palette/commands.ts` — switch/close/close-others.
- `src/features/cli/useCliLaunch.test.tsx`,
  `src/features/create/useCreateStore.ownership.test.ts` — stub the new owner.
- `e2e/support/app.ts` — `reopenRepo` tolerates a restored session; add
  `seedOpenRepos`.
- `CLAUDE.md` — architecture, navigation model, state conventions.

---

### Task 1: `close_repo` (backend)

- [ ] `src-tauri/tests/` — a test that opens two repos and reads both
      independently; a test that `close` removes the entry (next op →
      `UnknownRepo`); a test that closing an unknown id is `Ok`.
- [ ] `GitBackend::close(&self, repo_id: &RepoId) -> AppResult<()>`; libgit2 impl
      `repos.remove(repo_id)` (leave `rebases` alone — see design §E); `CliBackend`
      stub.
- [ ] `commands::repo::close_repo`, registered in `lib.rs`, `spawn_blocking`.
- [ ] `closeRepo(repoId)` in `src/lib/tauri.ts`.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`.

### Task 2: `repoSlice.ts` — the anti-leak contract

- [ ] `repoSlice.test.ts` first: `REPO_SLICE_KEYS` equals the store's live
      non-function keys; `sliceOf(EMPTY_SLICE-seeded store)` round-trips;
      `EMPTY_SLICE` has an entry for every key.
- [ ] `repoSlice.ts`: `RepoSlice` (the 21 per-repo fields), `REPO_SLICE_KEYS`,
      `EMPTY_SLICE`, `sliceOf(state)`.
- [ ] `useRepoStore.ts`: initial state and `closeRepo()` both built from
      `EMPTY_SLICE`; `applyOpenedRepo`'s reset list replaced by it. Three
      hand-maintained copies become one.

### Task 3: `useRepoStore` becomes switch-safe

- [ ] `setFor(repoId, patch)` / `setErrorFor(repoId, e)` helpers; route every
      fetch path and every action catch arm through them. Ordering convention
      unchanged.
- [ ] `openRepoAt(path): Promise<RepoHandle | null>` — today's `openRepo` body
      (open, `addRecent`, reset via `EMPTY_SLICE`, `refreshAll`, dubious-ownership
      trust retry) returning the handle instead of `void`, `null` on failure.
- [ ] `hydrate(slice)` (total write) and `snapshot(): RepoSlice`.
- [ ] Remove `openRepo` from the state interface. `pnpm tsc --noEmit` now lists
      every caller — that is the point.
- [ ] Existing store tests must pass untouched (`useRepoStore.*.test.ts`,
      `ops.test.ts`, `cherryPickMany.test.ts`): the state shape did not change.

### Task 4: `tabs.ts` — pure list logic + persistence

- [ ] `tabs.test.ts` first: add dedupes by path; add-after-resolved-path merges;
      `closeAt` picks the right neighbour (right, else left, else none); `cycle`
      wraps both ways; `labelTabs` prefixes the parent dir only for colliding
      names; `loadOpenRepos` tolerates garbage/missing/oversized;
      `saveOpenRepos` caps at 20.
- [ ] `tabs.ts`: `RepoTab`, `upsertTab`, `removeTab`, `closeNeighbour`, `cycle`,
      `repoDisplayName`, `labelTabs`, `loadOpenRepos`, `saveOpenRepos`
      (`pg-open-repos`).

### Task 5: `useTabsStore`

- [ ] `useTabsStore.test.ts` first, with `mockInvoke`:
      - `openRepo` twice on the same path → one tab, focused.
      - switching hydrates the incoming slice and leaves **no** field of the
        outgoing repo behind (assert against `REPO_SLICE_KEYS`).
      - a late `refreshAll` resolution from the previous repo does not write into
        the new tab.
      - a failed open leaves the previous tab active with its data.
      - closing the active tab activates the neighbour and calls `close_repo`.
      - closing the last tab clears the slice (Welcome) .
      - `restoreSession` creates pending tabs and opens only the active one.
      - `rememberScreen` survives a round trip.
- [ ] `useTabsStore.ts`: `tabs`, `activePath`, `activationSeq`; actions
      `openRepo`, `activate`, `close`, `closeOthers`, `closeAll`, `next`, `prev`,
      `selectIndex`, `rememberScreen`, `refreshBadges`, `restoreSession`.
      Persist on every mutation.

### Task 6: The strip

- [ ] `PGTabStrip` / `PGTab` in `design/chrome.tsx` — fixed 30px, own
      `overflow-x: auto`, `data-testid="repo-tab-strip"`, rows
      `data-testid="repo-tab"` + `data-path` + `data-active`, close
      `data-testid="repo-tab-close"`, new `data-testid="repo-tab-new"`. Active tab
      scrolled into view on change.
- [ ] `RepoTabs.test.tsx` first: one row per tab, active marked, click switches,
      close closes, "Close others" confirms (`WithDialogs`), dirty + conflict
      badges render, `labelTabs` disambiguation shows through.
- [ ] `RepoTabs.tsx`: wires `useTabsStore`, context menu (Close / Close others /
      Close all / Copy path), `+` → `openRepoDialog`, `window` focus →
      `refreshBadges()`.

### Task 7: AppShell

- [ ] Render `<RepoTabs />` between the titlebar and `OperationBar`, only with
      tabs open.
- [ ] Per-tab screen: `enterScreen` also `rememberScreen`s; an effect on
      `activePath` (skipping first mount) restores the tab's screen and bumps
      `entryTick`.
- [ ] Key the screen container by `activePath` so per-screen local state resets
      instead of leaking oids across repos.
- [ ] `restoreSession()` on mount, before the CLI intent lands.
- [ ] Titlebar "Close repo" → `useTabsStore.close(activePath)` (label kept: no
      e2e references it, and it still closes the repo you are looking at).
- [ ] `AppShell.screens.test.tsx` / `AppShell.screenentry.test.tsx` stay green.

### Task 8: `openRepo` call-site migration

- [ ] `ops.openRepoDialog`, `useCliLaunch.handleIntent`, `useCreateStore` (clone
      + init), `Welcome.tsx` → `useTabsStore.getState().openRepo(path)`.
- [ ] `useCliLaunch.test.tsx` and `useCreateStore.ownership.test.ts` stub
      `useTabsStore` instead.
- [ ] `openMergeWindow` on-destroy refresh guarded by the captured `repoId`.
- [ ] `pnpm tsc --noEmit` clean.

### Task 9: Keymap + palette

- [ ] `ActionDef.run?: (chord: string) => boolean | void`; dispatcher passes the
      resolved chord. Existing runners unchanged (they ignore it).
- [ ] `tab.next` / `tab.prev` / `tab.close` / `tab.select` / `tab.switch` in
      `actions.ts`, category `Repository`. `tab.select` parses its digit from the
      chord.
- [ ] `presets.ts`: bind all five in `COMMON` (both presets — the preset test
      requires it). Chords per design §F.
- [ ] `CheatSheet`: >3 chords render `first–last`.
- [ ] `presets.test.ts` must stay green (no `Mod+Alt+<letter>`, no duplicate
      global chord).
- [ ] `commands.ts`: **Switch repository…** (open tabs + unopened recents),
      **Close repository tab**, **Close other repository tabs** (confirm).

### Task 10: E2E + docs + verification

- [ ] `e2e/support/app.ts`: `seedOpenRepos(paths, active)`; `reopenRepo` skips the
      recent-row click when the restored session already opened the repo
      (otherwise every persistence spec hangs).
- [ ] `e2e/specs/repo-tabs.e2e.ts`: two seeded tabs restore; switching changes the
      titlebar name and the History content; `Ctrl+Tab` cycles; palette
      **Switch repository…** lists both; closing a tab keeps the other; closing
      the last returns to Welcome.
- [ ] Read `open-persisted-screen.e2e.ts`, `settings.e2e.ts` and every
      `openRepo`/`waitRepoLoaded` caller: confirm no selector moved.
- [ ] `CLAUDE.md`: frontend tree (`useTabsStore`, `tabs.ts`, `repoSlice.ts`,
      `RepoTabs`), backend (`close_repo`), navigation model (tabs, per-tab
      screen, keyed remount), state-management conventions (the one-live-slice
      rule, the `setFor` guard, the `REPO_SLICE_KEYS` contract), the new
      localStorage key.
- [ ] `pnpm tsc --noEmit`, `pnpm exec tsc -p e2e/tsconfig.json --noEmit`,
      `pnpm test`, `cargo test --manifest-path src-tauri/Cargo.toml`,
      `pnpm vite build`.
- [ ] Squash to one Conventional Commit, push, open the PR against #90.
