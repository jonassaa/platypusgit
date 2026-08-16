# Multi-repo tabs: one window, N open repositories

**Issue:** [#90](https://github.com/jonassaa/platypusgit/issues/90) (spun out of [#61](https://github.com/jonassaa/platypusgit/issues/61) C4)

## Problem

`useRepoStore.current` is a single `RepoHandle`. Opening a repository *replaces*
it — the recents row, `⌘O`, a clone, an init, and a forwarded `pgit …` launch all
do the same destructive thing. Anyone working across two repos (app + library,
service + infra, a review in one while committing in the other) pays a full
reopen — backend `open`, `get_status`, `list_branches/tags/stashes/remotes`, a
500-commit log walk, `repo_state`, `rebase_status` — every time they look at the
other one. GitKraken, Fork and Sublime Merge all keep several repositories open
in tabs.

Three facts shape the change:

1. **The backend is already multi-repo.** `Libgit2Backend` holds
   `repos: Mutex<HashMap<RepoId, Mutex<Repository>>>` and every command takes a
   `repo_id`. Nothing backend-side assumes one repository.
2. **The backend also never closes one.** `open` mints `RepoId(Uuid::new_v4())`
   and inserts; there is no `remove`, no `close_repo` command, no eviction.
   Today that leaks one `git2::Repository` (and its open file handles / odb
   caches) per *open*, re-opens of the same path included. With tabs the user is
   invited to open more repositories, so the leak stops being theoretical.
3. **`useRepoStore` is the biggest store in the app** (1428 lines, 21 state
   fields, ~90 actions) and it is read by 34 non-test files at 199 `getState()`
   sites plus three no-selector `useRepoStore()` subscriptions, and *seeded by 49
   test files* via `setState`. Any change to its state shape is a change to all
   of that.

## Design

### A. Store architecture: one live slice, frozen slices per tab

The store keeps **exactly one repository's live state — the active tab's**. Its
state shape, its selector API and every action signature are unchanged. What is
new is a sibling store that owns *which* repositories are open and holds a frozen
copy of each inactive tab's slice.

```
useTabsStore                     useRepoStore                 backend
  tabs: RepoTab[]                  current, status, …           repos: HashMap<RepoId, …>
  activePath                       (THE ACTIVE TAB ONLY)
  tab.slice: RepoSlice | null  ──hydrate/snapshot──►
```

Switching tabs is: **snapshot** the live slice into the outgoing tab →
**hydrate** the incoming tab's frozen slice into the store → `refreshAll()` so
what you see is disk truth, not a cached view.

Why this and not the two obvious alternatives:

- **Not `repos: Record<RepoId, RepoSlice>` inside `useRepoStore`** (the issue's
  own sketch). Screens read `s.status`, `s.commits`, `s.branches` directly at
  hundreds of sites; keying the slices means either rewriting every one of them
  or mirroring the active slice back onto the top level — two copies of the same
  data, which is the drift bug this codebase already learned about with
  `BranchInfo.tip`. It also doubles the store's state shape and makes it the god
  store #90 explicitly warns against.
- **Not a store factory per repo** (`createRepoStore(handle)` + an active-store
  indirection). `useRepoStore` is used as a hook *and* as `useRepoStore.getState()`
  *and* as `useRepoStore.setState()` (49 test files). Proxying all three onto a
  swappable inner store is a shim in front of every read in the app, and the
  tests that call `setState` before any repo exists would have nothing to target.

The chosen shape costs one thing: **a background tab's data is frozen at the
moment you left it.** That is a feature, not a regression — N repos each running
a 500-commit log walk on every fetch is exactly the cost tabs must not add. The
badge freshness problem is solved narrowly in §D.

#### The anti-leak contract

`features/repo/repoSlice.ts` (pure, no store import) declares
`REPO_SLICE_KEYS` — the complete list of the store's **non-function** fields —
plus `EMPTY_SLICE` and `sliceOf(state)`. `hydrate` writes *all* of them, always;
it never patches. So the previous repo's `status` / `commits` / `branches` /
`error` cannot survive into the next tab: there is no field a hydrate skips.

A unit test derives the store's non-function keys at runtime and asserts they
equal `REPO_SLICE_KEYS`. Adding a 22nd per-repo field without adding it to the
slice fails that test rather than leaking silently. It also removes the three
hand-maintained copies of the reset list that exist today (the `create()`
initializer, `applyOpenedRepo`, `closeRepo`).

#### In-flight responses (the other leak)

A snapshot/hydrate switch is atomic, but the *fetches already in flight* are not.
`refreshAll()` for repo A can resolve after the user switched to B and write A's
`status` into B's slice. The store already guards staleness on `logRef` and
`commitFilter`; it gains the same guard on repo identity:

- `setFor(repoId, patch)` — applies only while `get().current?.id === repoId`.
- `setErrorFor(repoId, e)` — the same guard for the error banner, so a failed op
  in a repo you have left cannot raise a banner over the repo you are in.

Every fetch path (`refreshAll`, `refreshStatus`, `refreshAllFiles`,
`searchCommits`, `loadMoreCommits`, `setLogRef`, the three `rebase*` status
writes) and every action catch arm routes through them. The
"refresh-first-error-last" convention is unaffected — `setErrorFor` is still just
a guarded `set({ error })`.

`useTabsStore` carries the matching guard for its own async work: an
`activationSeq` counter bumped on every activate/open, checked after each await,
so two overlapping activations (session restore racing a forwarded CLI launch)
cannot both commit.

### B. Tabs

```ts
interface RepoTab {
  /** Identity. Two tabs never share a path — a second open focuses the first. */
  path: string;
  /** Backend RepoId; null until the tab has actually been opened. */
  repoId: string | null;
  status: "pending" | "open" | "failed";
  /** Screen this tab was last on. Session-only, never persisted. */
  screen: string;
  /** Frozen slice. Meaningful only for an inactive tab. */
  slice: RepoSlice | null;
  /** Badge counts, from the slice at snapshot time. */
  dirty: number;
  conflicts: number;
}
```

**Path is the tab identity.** Opening a path that is already open focuses its tab
instead of adding a second one — which is also what makes persistence trivial and
kills a whole class of duplicate-tab bugs. `open` returns the *canonicalised
workdir*, which may differ from what the user picked, so the dedupe runs twice:
once on the requested path (fast path, no IPC) and once on the resolved path
after a successful open (drop the newcomer, focus the incumbent).

**A tab is created only after a successful open.** A failed open therefore needs
no rollback: the store's failure path only sets `loading`/`error`, the live slice
is untouched, and the tab you were on is still there with its data. "A failed
open does not close the tab you were on" is a test, not a hope.

**`useRepoStore.openRepo` moves to `useTabsStore.openRepo`.** It is deleted from
the repo store, so `tsc` — not vigilance — finds every caller (`ops.openRepoDialog`,
`useCliLaunch`, `useCreateStore` ×2, `Welcome`, two tests). What stays on the repo
store is the low-level half it always had internally:
`openRepoAt(path): Promise<RepoHandle | null>` (open + reset the slice + refresh +
the dubious-ownership trust retry) and `closeRepo()` (clear the slice). The
dependency runs one way — `useTabsStore` → `useRepoStore` — with no cycle.

**Closing a tab evicts the repository backend-side** (§E). Nothing is confirmed:
closing a tab closes a *view*, and no uncommitted work is lost by it — a confirm
there would be a lie about the stakes. The bulk operations do confirm, because
"Close other tabs" with six open is a click you cannot undo.

**Closing the last tab** returns the window to Welcome, exactly as "Close repo"
does today.

### C. What is per-tab and what is global

| Per tab | Global |
| --- | --- |
| The repository (`current`, `status`, `branches`, `tags`, `stashes`, `remotes`, `commits`, search + cursors, `logRef`, `repoState`, `rebaseStatus`, `activity`, `error`) | Theme + palette, UI density, zoom (`useSettingsStore`) |
| Which screen the tab is on | Keymap preset (`useKeymapStore`) |
| — | Pane widths / split sizes (`localStorage` per surface) |
| — | Tree ⇄ flat view mode per surface |
| — | Recents, update state, palette frecency |

**Per-tab screen** is session-only. CLAUDE.md's rule that launch always lands on
History and that screen restore was deliberately removed still holds: restored
tabs are created with `screen: "history"`, `pg-screen` stays dead, and nothing
writes it. Remembering the screen *within a session* is the thing tabs make
necessary — leaving one tab on History and coming back to find it on Settings is
the annoyance the removal of screen restore was about in the first place.

**Per-tab selections and scroll are deliberately NOT preserved.** The screen
subtree is keyed by the active tab path, so it remounts on every switch. That is
what makes History's selected commit, RepoBrowser's selected file, DiffViewer's
open diff and every windowed list's scroll offset *reset* instead of leaking the
other repository's oids into the new tab (a selected-oid leak would render a
"commit not found" panel at best and diff the wrong repo at worst). Switching
A→B→A therefore loses A's selection. Recorded as a known limit, not a bug.

**Pane widths stay global.** They are furniture, and per-tab furniture that
jumps as you switch would read as a rendering bug.

### D. The tab strip

A dedicated row **below** the titlebar and above `OperationBar`, not inside the
titlebar. The titlebar is already carrying the logo, repo name, branch chip,
dirty badge, the drag region, the update chip, four network buttons and the gear;
adding a scrolling strip to it would either shrink the drag region to nothing or
push the buttons off a narrow window. A separate 30px row keeps
`data-tauri-drag-region` intact and keeps the titlebar's existing e2e selectors
(`branch-chip`, `button*=Push`, …) exactly where they are.

- `PGTabStrip` + `PGTab` in `design/chrome.tsx` (chrome, so **fixed height** —
  no `var(--row-step)`, per the density rule's chrome exemption).
- The strip is `flexShrink: 0` with its own `overflow-x: auto`; tabs are
  `flexShrink: 0` with a `maxWidth`. The fixed frame is preserved — the strip
  scrolls inside itself and never widens the window. The active tab is scrolled
  into view (`inline: "nearest"`) when it changes.
- Rendered only when at least one tab exists, so the Welcome screen is untouched.
- Each tab: repo name, a dirty dot with count, a conflict marker, and a close
  affordance. Right-click gives Close / Close others / Close all / Copy path.
- A trailing `+` opens the native folder picker (`openRepoDialog`), the same op
  `⌘O` runs.
- Names collide often (`api`, `web`, `docs`). `labelTabs` disambiguates by
  prefixing the parent directory only for the names that actually collide — pure
  function, unit-tested.
- **Badges of inactive tabs refresh on window focus.** One `get_status` per open
  inactive tab, on the `window` focus event only — cheap, and it covers the real
  case (you committed in an editor, alt-tabbed back, and the other tab's dot
  should be honest). No polling, no background log walks.

The strip is chrome, not a `PGPane`: it stays out of the spatial `Alt+Arrow`
graph, like the titlebar and the status bar. It is driven by chords and the
palette instead.

### E. Backend: `close_repo`

New trait method `GitBackend::close(&self, repo_id: &RepoId) -> AppResult<()>`,
implemented in `Libgit2Backend` as a `repos.remove(repo_id)` (dropping the
`Repository`), stubbed `NotImplemented` in `CliBackend`, exposed as the
`close_repo` command, called by `closeTab` best-effort (a failure is logged, not
surfaced — the tab is going away either way).

Closing is **idempotent** and closing an unknown id is **not an error**: the
frontend may close a tab whose open failed, and turning that into an error banner
would be noise. `with_repo` keeps returning `UnknownRepo` for *use* of a closed
id, which is the honest answer.

`close` deliberately leaves the `rebases` map alone. Its entries are keyed by a
`RepoId` that will never be used again (a re-open mints a fresh UUID), they are
bytes rather than file handles, and the on-disk mirror
(`.git/platypusgit-rebase.json`) is what a re-opened repo rehydrates from — the
path CLAUDE.md already documents and `a_restarted_app_can_still_abort` already
pins.

### F. Keyboard

New actions in `features/keymap/actions.ts`, bound in **both** presets (the
preset test requires every catalog action to have a binding in every preset):

| Action | Chords | Why |
| --- | --- | --- |
| `tab.next` | `Ctrl+Tab`, `Mod+Tab` | The universal next-tab chord. Cross-platform by construction: on macOS `Mod+Tab` is ⌘Tab, which the OS takes and the webview never sees; on Windows/Linux physical Ctrl+Tab normalizes to `Mod+Tab` and `Ctrl+Tab` is never produced. Same trick as the existing `Ctrl+V` palette nod. |
| `tab.prev` | `Ctrl+Shift+Tab`, `Mod+Shift+Tab` | ditto. Distinct chords from bare `Tab`/`Shift+Tab` (pane cycling), so the dispatcher cannot confuse them. |
| `tab.close` | `Ctrl+W`, `Mod+W` | ditto. On macOS ⌘W may be claimed by Tauri's default window menu; ⌃W is the one that always reaches us. |
| `tab.select` | `Alt+1` … `Alt+9`, **`suppressInInput`** | `Mod+1..9` is taken by screen navigation and `Mod+Alt+<digit>` is AltGr on Windows (the rule `presets.test.ts` enforces for letters applies to digits: AltGr+2/+4 type characters on Nordic layouts). Plain `Alt+<digit>` is free in both presets, and `Alt` is already this keymap's second modifier — but ⌥+digit *is a character* on macOS, and on Nordic layouts one people type, so the action carries `suppressInInput` exactly as `pane.focus*` (Alt+Arrow) does. |
| `tab.switch` | `Mod+E` | Rider's "Recent files" chord, for the palette's repository switcher. |

`tab.select` is **one** action bound to nine chords, not nine actions. That needs
`ActionDef.run` to know *which* chord fired, so the runner signature widens to
`run?: (chord: string) => boolean | void` and the dispatcher passes the resolved
chord. It is additive — every existing runner ignores the argument — and it keeps
the cheat sheet from growing nine near-identical rows. The cheat sheet also
collapses any run of more than three chords to `first–last`, so the row reads
`⌥1–⌥9`.

`repo.open` (`⌘O`) is unchanged in name and chord but now means **open in a new
tab**, because that is what `openRepo` now does everywhere. That is the "open
repo in new tab" action; inventing a second one for the same behavior would be
two rows in the cheat sheet for one key.

**`tab.select` is suppressed inside text.** `hasRealModifier` treats any `Alt+…`
chord as dispatchable while typing, which for ⌥+digit means eating a character the
user asked for — `¡` on a US layout, and on Nordic layouts the ⌥-digit row carries
characters people type routinely. So the action sets `suppressInInput`, the same
opt-out `pane.focus*` uses for the macOS ⌥←/⌥→ caret jumps, and the dispatcher's
`isEditable` covers input, textarea and contentEditable — the resolver's CodeMirror
pane included. The cost is that repository switching by number does not work while
a field has focus; `tab.next`/`tab.prev`/`tab.close` stay live there because their
chords type nothing.

### G. Palette

- **Switch repository…** (`actionId: "tab.switch"`) — a pick step listing every
  open tab (active one marked) *followed by* recents that are not open, which
  open in a new tab when picked. This is also the only keyboard-reachable way to
  open a second repository without the native folder dialog, which matters for
  e2e: the dialog is a real OS picker there and cannot be driven.
- **Close repository tab** (`actionId: "tab.close"`), listed only with a tab open.
- **Close other repository tabs**, listed only with two or more, `pgConfirm`-gated.

### H. Session persistence

`localStorage["pg-open-repos"]` — a new key (no collision with the 20 existing
ones), shape `{ paths: string[]; active: string | null }`, written on every tabs
mutation, capped at 20 paths. Recents keep their own key and their own meaning:
recents are *where you have been*, the open set is *where you are*. `openRepo`
still calls `addRecent`, so the two stay consistent without one becoming the
other.

**Restore is lazy.** `restoreSession()` creates every persisted path as a
`pending` tab and activates only the persisted active one; the rest open on first
activation. Five persisted repos therefore cost one `open` + one refresh at
launch, not five. A path that has since been deleted or moved fails its open when
activated and its tab is marked `failed` — visible, dismissible, and not a
startup crash.

Restore runs from `AppShell` mount, before the CLI intent is handled. A forwarded
`pgit /path` then finds the existing `pending` tab for that path and activates it
rather than adding a duplicate.

### I. CLI launch and the merge window

- **A forwarded launch opens a tab.** `useCliLaunch.handleIntent` calls
  `useTabsStore.openRepo(path)`, which focuses an existing tab or adds a new one
  — a `pgit ~/other-repo` from a second terminal no longer evicts what you were
  looking at. `intent.screen` still routes through `useNavStore`, and now lands
  on the newly-focused tab because the screen switch happens after the activate.
- **The merge window is untouched.** It is a second Tauri window with its own
  store instance that never opens a repository; it works from `?repoId=` and
  direct IPC wrappers, so it has no tabs, no tab strip, and no `useTabsStore`.
  Its `merge://resolved` → `refreshAll()` path in `AppShell` still refreshes the
  active repo, which is the repo the resolver was opened for in every reachable
  flow. `openMergeWindow`'s on-destroy refresh gains the same repo guard as
  everything else: it captures the `repoId` it was opened for and refreshes only
  while that repo is still active, so closing a resolver after a tab switch no
  longer refreshes the wrong repository.
- **Closing a tab whose repository the resolver is using is guarded.** Since
  `closeTab` now evicts backend-side, an unguarded close would leave the resolver
  window issuing IPC against a dead `RepoId` mid-resolution — the one failure mode
  this must never have. So `close` asks first, **in the main window**
  ("Close this repository and its merge resolver?", danger, naming what is lost),
  and on confirm calls `closeMergeWindow()`, which closes the window and **waits
  for the label to actually disappear** before the eviction runs (`close()`
  resolves when the request is delivered, not when the window is destroyed).
  Declining leaves both the tab and the resolver alone.

  Attribution — which repository a live resolver is on — is module state in
  `openMergeWindow.ts`, set when the window is opened or retargeted and cleared on
  `tauri://destroyed`. A live window this page instance cannot attribute (main
  reloaded while the resolver stayed up) counts as a match, so the worst case is
  one extra confirmation rather than a broken resolution.

  The main-window confirm deliberately bypasses the resolver's own
  unapplied-progress guard: the user has already been told, in the window they are
  looking at, that unapplied picks and edits are lost.

## Testing

- **Rust:** `close` removes the entry and a subsequent op on the id answers
  `UnknownRepo`; closing an unknown id succeeds; two repositories are open
  simultaneously and read independently (the property tabs rely on, never before
  asserted).
- **Unit:** `repoSlice` — `REPO_SLICE_KEYS` equals the store's live non-function
  keys (the anti-leak guard), `sliceOf`/`EMPTY_SLICE` round-trip. `tabs.ts` —
  add/dedupe/close-neighbour-selection/cycle, `labelTabs` collision
  disambiguation, `pg-open-repos` encode/decode incl. garbage tolerance.
  `useTabsStore` — switching hydrates the incoming slice and leaves nothing of
  the outgoing one; a failed open keeps the previous tab; a late `refreshAll`
  from the previous repo does not write into the new tab (the `setFor` guard);
  closing the active tab activates a neighbour; closing the last returns to
  Welcome and calls `close_repo`.
- **Component:** `RepoTabs.test.tsx` — strip renders one row per tab, marks the
  active one, click switches, close button closes, "Close others" confirms
  (`WithDialogs`), dirty/conflict badges render. `AppShell` — the per-tab screen
  is restored on switch and the screen subtree remounts.
- **E2E:** `repo-tabs.e2e.ts` — two seeded tabs restore from
  `pg-open-repos`, switching changes the titlebar repo name and History content,
  `Ctrl+Tab` cycles, closing a tab leaves the other active, closing the last
  returns to Welcome. `reopenRepo` in `e2e/support/app.ts` learns that a restored
  session may already have the repo open (it reloads *without* clearing
  localStorage, which now restores tabs), otherwise every persistence spec would
  hang waiting for a Welcome row that no longer renders.

## Out of scope

Drag-to-reorder tabs (#61 C5 territory). Splitting a repository into a second
*window*. Cross-repo operations (compare, cherry-pick across repos). Background
fetch for inactive tabs. Per-tab pane geometry. Restoring per-tab selections
across a switch. A workspace/project concept above the tab set (named groups,
`.pgit-workspace` files) — the open set is a flat list, deliberately.
