# Frontend deep dives

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`). `test/docs.test.ts` reads this set together with CLAUDE.md.

## Diff rendering

- **One row model, TWO renderers.** `flattenDiffRows` (`lib/diffRows.ts`) turns
  a `FileDiff` into a flat `DiffRow[]`; all four diff surfaces use it. Three
  render via `PGWindowedDiff`; `CommitDiffPanel` has its own lighter read-only
  markup — anything "shared" must be verified there separately. Unifying them
  is a wanted follow-up.
- **A code line must not wrap in a unified diff row** — `white-space: pre`
  enforces it. The row's height IS the window's pitch (`DiffRow.h`,
  prefix-summed by `rowOffset`/`scrollTopForRow`/the minimap), so a wrapped
  line draws over the rows below it. Long lines overflow right and the pane
  scrolls; rows carry `min-width: max-content`. The `wrap` prop (the
  DiffViewer's Wrap toggle, its one caller) makes rows elastic and must drop
  windowing, the minimap AND offset scrolling together.
- **Whole file is the default view** (`diffContextMode: "wholeFile"`), composed
  on the FRONTEND: unchanged remainder filled in as `fill` rows from text
  `useDiffSyntax` already read. **Never fake it with a large `contextLines`** —
  one giant hunk breaks `stage_hunk` and shifts `changedIndex`. `fill` has no
  `hunkIndex`, so it cannot reach a staging path. git's `+N,0` convention is
  normalized in `effStart`.
- **No `@@` hunk banner, no `header` row kind** (#157). Stage/Discard live in
  `PGHunkActions` (gutter cluster on the hunk's anchor row) + the
  `diff.stageHunk`/`diff.discardHunk` chords (Mod+Shift+H /
  Mod+Shift+Backspace). Per-hunk collapse is gone deliberately. The range shows
  as nothing (whole-file) or a `PGFoldSeparator` (chunked); `fold` carries no
  `hunkIndex` either.
- **The backend still sends a `@@` line** (`DiffLineKind::HunkHeader`) and
  `flattenDiffRows` drops it (#161). The two backend builders disagree on
  purpose: the working-tree `diff` drops `'H'` itself, `diff_to_file_diffs`
  (commit diffs) keeps it — `git/lfs.rs` reads `HunkHeader`, so the kind stays
  on the wire and the drop is frontend-side (two renderers; a filter in one
  leaves the other broken). `changedIndex` is unaffected by construction;
  `rowIndex` shifts with `rows`.
- **One `@@` still reaches a reader: the SPLIT view's** — `diffToSplit`
  (DiffViewer.tsx, CommitPanel.tsx) pushes `{kind: "info", text: hunk.header}`
  as data off `DiffHunk.header` (grep for `@@` won't find it). Giving it the
  fold-separator treatment needs gap counts `diffToSplit` doesn't compute —
  follow-up, not drive-by.
- **Degradation ladder** in `flattenDiffRows`: a STRUCTURAL failure (gap sides
  disagree on length) falls to bare concatenated hunks; a TEXT failure (not
  loaded / too long / too short) falls only to `"fold"` — a labelled
  discontinuity, never a silently joined file.
- **`diff_ref_to_workdir` is a shared primitive** (#131): revspec vs working
  tree via `diff_tree_to_workdir_with_index` (the plain tree-to-workdir misses
  a staged-then-reverted file), explicit `include_untracked` (compare passes
  true). It returns `WorkdirDiff { files, untracked_omitted }`: over
  `MAX_UNTRACKED_FILES` the untracked side is dropped WHOLE and the count
  reported; `MAX_WORKDIR_BLOB` caps per-blob size. Don't "simplify" the return
  type back — silent truncation is worse than the overflow.
- **Gate text rendering on `isTextualDiff(diff)`, not `!diff.binary`** (#93) —
  an LFS pointer is honestly text; the surfaces render `LfsDiffNotice` instead.
- **Diff CODE is selectable; diff CHROME is not.** `body` is `user-select: none`
  (native desktop feel), so each row's code cell opts back in with
  `.pg-selectable` (`index.css`) while the line-number cells and the `+`/`−`
  marker keep `user-select: none`. That split is the whole feature: a selection
  that swept up the gutters would paste as text you have to clean by hand. Every
  new diff row markup has to make the same split — `CommitDiffPanel`'s marker was
  a loose text node and had to be wrapped in a span to get it.
  - **A mouse selection cannot leave the rendered window.** The surfaces are
    windowed, so rows outside the viewport are not in the document and a drag
    stops at its edge (overscan 8). This is why `diff.copy` (`Mod+C`) and
    `diffCopyMenuItems` (right-click, wired into all four surfaces) build their
    text from the ROW MODEL instead — `lib/diffCopy.ts`, reusing `isFileContent`
    so `changedIndex` cannot drift from what the renderer numbered. Copying a
    long range has no other path; a surface that forgets the menu is a surface
    where it silently cannot be done, which `test/diffCopyMenu.test.ts` fails the
    build over.
  - **`Mod+C` must keep meaning "copy".** `diff.copy` DECLINES (returns `false`)
    whenever a text selection exists and whenever nothing is selected, so the
    chord goes unhandled, the dispatcher skips `preventDefault`, and the
    webview's native copy runs. It is pane-scoped and `suppressInInput`, so it
    never reaches the commit-message textarea or another screen.
  - **A drag-select ends in a `click`**, on the row the pointer came up over — so
    `PGDiffRow`'s handler bails on a non-collapsed selection, or copying a line
    would stage it. No false positives: `mousedown` collapses any earlier
    selection before `click` runs, so a genuine click always sees a collapsed one.
  - **Opting text back in defeats a body-level `user-select: none`**, because a
    class beats an inherited value. `dragController` relied on exactly that body
    style to stop a row drag from selecting as it moved (it cannot
    `preventDefault` a pointerdown that may still end up a click), so it now also
    sets `data-pg-dragging` on `body`, which `index.css` uses to suppress
    `.pg-selectable` for the duration. `PGResizeHandle` needs none of this — it
    `preventDefault`s its mousedown, so no selection ever starts. Any future
    "nothing is selectable right now" state has to reach the opted-in cells the
    same way.
  - Pinned by `src/design/diffSelection.test.tsx` (+ `src/test/selectionText.ts`,
    which walks the tree the way an engine serialises a copy) and, because the
    granting rule lives in a stylesheet and gutter exclusion is an engine
    behaviour, by `e2e/specs/diff-selection.e2e.ts` in the real webview.
- **Tokenization runs in a module worker** (Shiki's `codeToTokens` is sync CPU);
  tokens return as transferable `Int32Array`s. `vite.config.ts` sets
  `worker: { format: "es" }` — the grammars are dynamic imports and the default
  iife worker format fails the production build. A failed worker degrades to
  main-thread tokenizing (also jsdom's path).
- **Measure scroll viewports read-first, observe-second** — WebKitGTK 605 (the
  e2e target) has no `ResizeObserver`; a `typeof` guard before the initial
  measurement leaves the height 0 and the pane windowing against a 400px
  fallback. Use `lib/useViewportH.ts` / `lib/useElementSize.ts`. Two corollaries
  (issue 188): the container usually mounts AFTER the hook (surfaces render the
  scroller only once the diff arrives), so `useViewportH` re-measures on node
  attach + a bounded rAF poll — a RefObject-taking hook cannot know when its
  element appears, it has to look. And a container that unmounts reports 0
  again — load-bearing: 0 honestly means "not yet / not any more", and its
  return is what times the auto-open right instead of never.
- **Two cursors, two index spaces.** `useHunkNav` keeps the HUNK cursor (F7/⇧F7,
  `data-hunk-active` on the hunk's ANCHOR row — its first changed line, exactly
  one per hunk). `useDiffLineFocus` keeps the per-LINE cursor (`data-focused`,
  changed lines only — context and `fill` are unstageable). A `DiffLineTarget`
  carries BOTH `rowIndex` (flat-row space: focus ring, `scrollTopForRow`) and
  `changedIndex` (the ONLY value `stage/unstage/discard_lines` accept). Never
  derive one from the other; read `changedIndex` off the row.
- **Scroll diff rows BY OFFSET** (`scrollTopForRow`), never
  `querySelector` + `scrollIntoView` — the row is usually unmounted under
  windowing and the DOM route silently does nothing (the #68 G10 trap). F7
  scrolls by offset too (`hunkAnchorRows`); the DOM fallback survives only for
  unwindowed callers.
- **Three scroll semantics, and they are not interchangeable.**
  `scrollTopForRow` REVEALS (smallest move that shows the row, no-op when it is
  already visible) — the LINE cursor's, because a cursor stepping one row should
  scroll one row. `scrubScrollTop` (`lib/diffMinimap.ts`) POSITIONS a viewport
  around a row. `scrollTopForHunk` CENTRES: the midpoint of the hunk's changed
  extent lands on the midpoint of the viewport, ALWAYS — off screen, at an edge,
  or already comfortably visible. That is F7/⇧F7's landing and the auto-open's,
  and the unconditional move is the point: under reveal semantics F7 walking
  forward pinned every change to the BOTTOM edge with no following context, and
  one keypress meant two different things depending on where the last one left
  the pane. The visible consequence is that F7 scrolls even when the next hunk
  was already on screen — accepted, in exchange for every change landing in the
  same place.
- **The extent is `hunkExtentRows`: a hunk's FIRST changed row through its
  LAST**, context between two change runs included (git merges runs less than
  2 × `-U` apart into one hunk, so an extent is not necessarily solid `+`/`-`).
  Not the whole hunk — its leading and trailing context would drag the midpoint
  off the change. `first` is the anchor row, so this subsumed the old
  `hunkAnchorRows`. Both ends are stamped into the DOM (`data-hunk-index`,
  `data-hunk-last-index`); one row wears both markers for a one-line change.
  Five details in `scrollTopForHunk` are load-bearing:
  - A change TALLER than the viewport cannot be centred without hiding its own
    start, so it degrades to parking its top `HUNK_LEAD_ROWS × rowH` px down.
    That is the only surviving use of the constant, and the `extentH >
    viewportH` test is deliberately a hard branch: the tempting branchless form
    `min(centre, top − lead)` starts top-parking at `extentH > viewportH − 2 ×
    lead` and shoves the bottom of a change that still fits off the screen.
  - That lead is PIXELS — the height of the four preceding rows would let one
    tall fold separator eat it — and is capped at `viewportH − rowH`, so a short
    pane degrades to "flush with the top", never to "not on screen".
  - The result snaps to a row boundary (ties DOWN), so neither edge of the
    viewport shows a half-sliced line, as every `rowOffset`-based target always
    did.
  - It is then clamped to `[0, sum(heights) − viewportH]`: overshooting is
    clamped by the DOM, and every `scrollToHunk` reads `scrollTop !== want` as
    "the reveal did not land", costing the file its auto-open.
  - That clamp is also why a hunk within half a viewport of either END of the
    file does not land centred. Nothing is wrong; no scroll position would put
    it there. Buying one with scroll-past-end padding would break
    `contentH === sum(heights)`, which is true by construction only because
    `PGWindowedDiff` renders exactly `topPad + rows + bottomPad`.

  `DiffViewer`'s wrap mode measures the two marked rows' rects instead (heights
  describe nothing there) — same rule, different ruler, minus the row-boundary
  snap, since wrapped rows have no uniform pitch to snap to. The merge window's
  F7 walks conflict regions through CodeMirror and shares none of this.
- **A diff OPENS at its first change, and F7 carries into the next file**
  (issue 188). Both live in `useHunkNav`, not per screen. The parts:
  - The auto-open waits on `diffOpenReady` (`features/diff/useDiffGaps.ts`):
    row model matches the SHOWING file (side included in the commit panel),
    rows exist, viewport measured (0 = unmeasured), and in whole-file mode the
    file TEXT has landed (before it, anchors sit near the top and are about to
    move). Do NOT key the hook's `resetKey` to the diff — a refetch on staging
    would yank the reader back. Null text on both sides never settles: "not
    loaded" and "no text" are the same value, and guessing wrong is worse than
    not moving.
  - The cursor starts at 0 only when the auto-open actually ran; the backward
    edge test is `cursor === 0`, not `<= 0`.
  - **The reader wins, and a MISS costs nothing:** `readerActed` (any F7) locks
    the file for life; `opened` is spent only by a CONFIRMED scroll — every
    surface's `scrollToHunk` returns a boolean checked against `el.scrollTop`
    (a mid-refetch container clamps, a missing one swallows). A miss retries;
    `ready` going false RETURNS the budget.
  - File crossing is the `files` prop (`{count, index, select}`); the hook owns
    the arithmetic (stop at ends, never cycle). `select` must move the
    file-list selection too. `RepoBrowser` deliberately omits `files` (its pane
    lists all tracked files, not the changed set); `CommitPanel` crosses the
    staged/unstaged boundary (matches `usePaneList`'s one-list order).
  - The hint names its chord via `chordFor("diff.nextChange")` (bindings are
    rebindable); the arming expires with `PG_FLASH_MS`; `pgFlash` is
    single-instance.
- **A programmatic `scrollTop` write is not a scroll event** — the windowed
  range does not update by itself (measured: seconds of `start: 0` on WebKitGTK
  while the DOM sat scrolled, masked usually by token arrival — a token-cache
  hit removes even that). Every programmatic diff scroll goes through
  `useVariableWindow`'s `scrollTo` (assigns AND publishes). Known holdouts,
  named in the hook's comment: `FocusableScroll` Home/End, `DiffMinimap` scrub.
- **The minimap derives from the ROW MODEL, never the DOM** (#161) — painted
  from `DiffRow[]` + heights (`lib/diffMinimap.ts`, pure; buckets rows into
  device-pixel bands so cost is bounded and a lone changed line keeps a pixel),
  outside the scroll container. Three rules: measure the WRAPPER for the hide
  threshold (`MINIMAP_MIN_CONTAINER_W` 530px; width 0 = unmeasured, don't
  hide — measuring the scroller closes a feedback loop and flickers); a canvas
  cannot take CSS vars and `--git-*` are `oklch()` — an unparseable `fillStyle`
  is a SILENT no-op (black on WebKitGTK, fine on macOS), so `lib/cssColor.ts`
  converts in TS and repaint subscribes to `activeThemeId` + `customThemes`;
  light mode gets its own ALPHAS (keyed on `data-theme-mode`), not its own
  colours.
- **Pointer events alone are not enough on the CI webview:** a real WebDriver
  pointer action delivers `mousedown` and NO `pointerdown` on WebKitGTK under
  xvfb (though `window.PointerEvent` exists). dnd survives because every drag
  has a keyboard equivalent; the minimap scrub carries a `mousedown` fallback
  gated on a `sawPointer` flag. Any pointer-only control needs the same pair —
  green dnd specs prove nothing (they synthesize events named `pointerdown`).
- **Line ops inherit the ignore-whitespace gate** (that flag rewrites hunk
  boundaries): both click path and keyboard cursor are disabled by
  `useHunkActionsDisabledReason` — the keyboard must never reach what the mouse
  cannot (#61 D2).

## The log is paged (#68 G11)

- **`s.commits` is a PREFIX of history** (`PAGE_SIZE = 500`, appended;
  `hasMoreLog` = cursor non-null). Fine for what is on screen; wrong for "does
  this commit exist" or "is X an ancestor of Y" — ask the backend.
- **The cursor is a FRONTIER** (a set of oids — several lanes are alive at a
  page boundary; one oid would drop branches). `nextCursor: null` = true end.
- Passing a cursor makes `refspec` a no-op; changing scope means a new walk
  with no cursor.
- **Two cursors:** `commitCursor` (commits) and `searchCursor` (searchResults);
  `loadMoreCommits` extends whichever is active. Both are `RepoSlice` fields —
  a tab switch restores the cursor with its list.
- **Filtering happens on both sides:** the backend `LogFilter` counts toward
  `limit`; History filters the loaded page again client-side (hide-merges, the
  text box) — so the auto-pager counts barren pages and stops at
  `MAX_BARREN_PAGES`, or it walks the whole repository. New client-side log
  filters inherit that trap.

## Navigation model

- Activity bar = primary switcher, History first. **Launch always lands on
  History** — no screen restore (`pg-screen` is gone); restored tabs start on
  History too.
- **Repositories are tabs (#90).** Opening a repository ANYWHERE goes through
  `useTabsStore.openRepo` (focus-existing-or-add). `useRepoStore.openRepo` no
  longer exists; the low-level half is `openRepoAt`.
- Each tab remembers its screen for the session (`rememberScreen`; an effect on
  `activePath` restores, skipping first mount). Selections/scroll are NOT
  preserved — the screen container is keyed by the active repository, so a
  switch remounts (a retained selection from another repo would render or diff
  the wrong thing).
- Tab chords: `tab.next`/`tab.prev` (Ctrl+Tab / Mod+Tab), `tab.close` (Ctrl+W /
  Mod+W), `tab.select` (Alt+1…9 — one action, digit read off the chord),
  `tab.switch` (Mod+E). The strip is chrome, not a PGPane. **`tab.select`
  keeps `suppressInInput`** — ⌥+digit is a typed character on macOS/Nordic
  layouts; any bare-Alt+printable binding needs the same flag.
- **Screen entry focuses the screen's primary pane** — one `<PGPane primary>`
  per screen, held as `primaryId`; outranks geometry for screen entry and
  Alt+Right off the activity bar. Entry is counted by `entryTick` so re-picking
  the current screen re-enters it (else focus strands on the bar button).
- Keyboard routes through `features/keymap` (catalog + presets, rider default).
  Modifier chords work while typing; bare keys don't. `?` opens the cheat
  sheet. `view.zoom*` scales via the webview's own zoom (`applyZoom`, persisted
  `uiZoom`; needs `core:webview:allow-set-webview-zoom`).
- **Two PANE-scoped actions may share one chord; two global ones may not.** The
  dispatcher's reverse map is `chord → ActionId[]` tried in turn; declined
  actions fall through (Space = `list.toggle` in a list pane, `diff.toggleLine`
  in the diff pane). Register pane handlers as declining (`() => false`) when
  idle, or they swallow the chord. Prefer a second catalog entry over
  overloading one id (`presets.test.ts` enforces the asymmetry).
- **A pane action sharing a chord with a GLOBAL one makes BINDING ORDER
  load-bearing** (#158): a global with a default runner never declines, so the
  pane entry must come first in the preset table (`COMMON` is spread before the
  per-preset `nav.*`; `presets.test.ts` pins the order). `Mod+D` is
  `diff.viewCombined` in `history.list` — declining only on an EMPTY selection
  (#164) — and `nav.diff` everywhere else.
- `useNavStore.intent` drives deep views; AppShell routes. **A new `NavIntent`
  kind must be routed in AppShell, enforced twice:** the switch ends in
  `default: assertNever(intent)` (unrouted kind = compile error) and
  `AppShell.navroutes.test.tsx` drives every kind through the real shell (its
  `EXPECTED` table is a mapped type over `NavIntent["kind"]`; a deliberately
  non-navigating kind needs an entry with a written reason). `stash-vs-wt` once
  shipped fully wired but unrouted and did nothing (#133).
- **Compare is a deep view, not a screen** (#131): `ref-compare` routes to
  `compare`, but the SCREEN reads its sides from `useCompareStore` — they stay
  mutable there (also why it is not a fifth `CommitDiff` target: that union is
  oid-shaped and immutable). A working-tree side is right-hand only; the
  ahead/behind summary and commit lists are ABSENT, not zeroed.
- **A stash comparison is two `CommitDiff` targets, not a compare side** (#133):
  `stash-diff` (entry vs its first parent) and `stash-vs-wt` (vs working tree
  via `diff_ref_to_workdir`). Compare's rev↔rev half would walk the index and
  untracked commits as history ("3 commits ahead").
- Conflicts are NOT a destination (#108): `OperationBar` (repoState-driven),
  the status-bar conflict count, ⌘5/`conflict.openResolver`, and conflicted-row
  menus all open the merge resolver window. **Bisect is not a destination
  either** (#93): its own `OpKind` on the bar with Good/Bad/Skip/**Reset**
  (Reset replaces Abort — mid-bisect HEAD is detached; a hard reset to it is
  harmful). No bisect chords on purpose: both presets are full and a misfire
  corrupts the search.
- `submodules` (⌘⇧8) and `worktrees` (⌘⇧7) are always-present screens —
  conditional entries would move the bar's geometry between repos. LFS is a
  panel on the Remote screen (its transfers are remote-object ops).

## State management

- **Zustand per feature**, colocated with its owner. Cross-feature state
  composes in `src/store.ts` if ever needed — don't hoist prematurely.
- **`useRepoStore` holds exactly ONE repository's live state — the active
  tab's** (#90). `useTabsStore` owns the open set and freezes inactive slices;
  switching is snapshot → hydrate → `refreshAll`. Background tabs are frozen;
  badges re-read on window focus (`refreshBadges`).
- **Hydration is a TOTAL write:** `RepoSlice` declares every non-function field
  (`repoSlice.test.ts` derives the live keys). A new per-repo field must join
  `RepoSlice`/`emptySlice`, or hydration degrades to a patch and the previous
  repository's value leaks into the next tab. `emptySlice()` is also the
  initial state and the `closeRepo()` reset — one definition.
- **Every fetch/error write goes through `setFor(repoId, …)` /
  `setErrorFor(repoId, …)`** — an in-flight `refreshAll` for repo A must not
  land in repo B's slice. `useTabsStore` carries the matching `activationSeq`
  guard for its own awaits.
- The dependency runs one way: `useTabsStore` → `useRepoStore` (the pure halves
  `tabs.ts`/`repoSlice.ts` keep it so).
- **Closing a tab evicts backend-side** (`close_repo`) — `open` mints a fresh
  `RepoId` per call, so without eviction every open leaks a `git2::Repository`.
  Closing an unknown id is silent success; `close` leaves the `rebases` map
  alone (rehydratable from disk).
- **One path is one `RepoId`, deduped BEFORE `open_repo`** (issue 177):
  normalize through `git::repo_path_key` (Rust) and `tabs.ts`'s `repoPathKey`
  (every path entering the tab layer, `pg-open-repos` included) — producers
  disagree on trailing separators, and a double-open leaves a dead `RepoId` in
  `current` (every later call `UnknownRepo`, silently). `PathBuf`'s `==` is
  component-based and hides this — assert on the string form in tests.
- **`openRepoAt` takes a REQUIRED `stillWanted` predicate**, re-asked after
  `open_repo` resolves, and closes the handle if superseded; it returns the
  handle IT opened. Three orphan windows, each with its own eviction and a
  mutation-verified test: superseded before adoption (`openRepoAt`), superseded
  during the post-adoption `refreshAll` (`hydrateTab`'s `!stillCurrent` arm),
  and a backend re-key of a symlinked spelling (evict the displaced tab, never
  overwrite its id). A monotonic-counter default was tried and rejected — it
  answers the same question worse.
- **`init_repo` answers with a REGISTERED `RepoId`** — `useCreateStore` closes
  it before delegating to `useTabsStore.openRepo` (which mints its own), or
  every init leaks a handle. `clone_repo` answers with a path, unaffected. Any
  command returning a `RepoHandle` the frontend does not adopt inherits this.
- **Compare paths on the tab's own key, never the caller's spelling** —
  `findTab`/`indexOfTab`/`removeTab` normalize, and raw `===` after them burned
  `activate`, `close` (`wasActive`) and `closeOthers` in turn.
- **Closing a tab the merge resolver is using:** confirm → close the resolver →
  evict (`mergeWindowHoldsRepo`/`closeMergeWindow`, which waits for the window
  label to disappear — `close()` resolves on delivery, not on gone). An
  unattributable live resolver counts as a match on purpose.
- **Danger-op error paths refresh first, set error last** (see `mergeBranch`):
  `refreshAll` starts with `set({ error: null })` and React batches same-tick
  sets, so the opposite order wipes the banner. A failed git op must still
  refresh — the UI reflects disk truth even on error.
- **Cancel is a two-click affordance, and the first click MUST be visible**
  (#263). The backend sends `SIGTERM` on the first cancel of an op and
  escalates to `SIGKILL` only on a second one — and only the `SIGTERM` lets git
  run its own lock-file cleanup, so an accidental escalation strands
  `.git/FETCH_HEAD.lock` and breaks the NEXT fetch. That makes the second click
  load-bearing, which is only safe if the first one changed something on
  screen: `cancelRequested` (in `RepoSlice`, and its own field on
  `useCreateStore`) flips the status line to "Cancelling…" and the button to
  "Force stop". Neither surface may become disabled — a git that ignores
  `SIGTERM` is escapable only by clicking again. `cancelRequested` clears when
  the last `activity` label goes, so the next stalled op starts from the polite
  signal. See `docs/dev/backend.md` for the signal half.

## Styling

- Tailwind v4, CSS-first (no `tailwind.config.js`, no `@theme` block). Tokens
  on plain `:root` in `src/index.css`; use CSS vars or arbitrary-value syntax.
- **The shell is a fixed frame:** `html, body, #root` are `overflow: hidden` +
  `overscroll-behavior: none`. Panes own scrolling (`FocusableScroll`); a new
  overflowing surface needs its own scroll container.
- **`:root` is only the pre-hydration default.** `applyTheme()`
  (useSettingsStore) is the source of truth: the editable palette plus
  `SEMANTIC_TOKENS` (`--git-*`, `--graph-*`, `--accent-2..5`, `--shadow-*`) per
  theme MODE and `SELECTION_TOKENS` derived from `--accent`. Light themes need
  their own calibration (#61 B4). The dark column stays byte-identical to
  `index.css` — edit both or they drift.
- Never hardcode the accent hue: `var(--accent)` or
  `oklch(from var(--accent) l c h / <alpha>)`.
- Fonts are vendored (`@fontsource-variable/*`). Inline `style={{…}}` with CSS
  vars is fine and used widely in chrome.
- **`BranchInfo.tip` is a FULL oid.** It was once truncated to 7 chars and every
  comparison against `CommitInfo.oid` failed silently (HEAD indicator, graph
  ring, `headAncestryOf` degraded to "the whole log"). `shortSha` at display
  sites only.
- **Text is unselectable app-wide.** `body` sets `user-select: none` (it makes
  the shell feel native); only inputs, `contenteditable`, and `.pg-selectable`
  opt back in. So any string a user may need to lift out by hand — a command,
  a path, an error — needs `className="pg-selectable"`, and ideally a copy
  button beside it too (`PGIconButton icon="copy"` + `pgFlash`), because a
  string inside a click-outside-to-close popover is gone by the second drag.
  The update panel's package-manager command shipped as a bare `<code>`: the
  notify path's only actionable content, unselectable and uncopyable.
- **New list-row surfaces must opt into UI density** (issue #70):
  `height: "calc(<base>px + var(--row-step))"` (or `/ 2` for padding-sized
  rows); `--row-h` for plain 24px rows. `--row-step` is 0 in compact, so each
  surface keeps its base. Chrome and code-line geometry (`--lh-code`) stay
  fixed. `grep -rn 'var(--row-step)' src/` lists participants. `PGGraphRow`
  draws in SVG units — `PGCommitRow` feeds it `useDensityStep()`.

## Design system

- Import primitives from `@/design` (the barrel). New shared primitive → the
  right file in `src/design/` + re-export. Do NOT add `src/components/ui/`.
- `PGButton`/`PGInput` spread `...rest` onto their DOM node; `PGIconButton`
  does NOT (forwards `title` only). Row components need explicit prop threading
  for new attributes.

## No native `<select>` (issue 146)

- **`PGSelect`** renders a `role="combobox"` trigger + a portalled
  `role="listbox"`; no `<select>`/`<option>` anywhere in shipped `src/`
  (`test/nativeSelect.test.ts` guards it — the failure is invisible on
  macOS/Windows). Why: WebKitGTK maps a native `<select>` as a GDK popup and
  GDK/Wayland refuses non-topmost popups (gtk#5639; Firefox has the matching
  Weston report). A MITIGATION, not a verified fix — issue 146 stays open.
- **The focus host is an `<input readonly>`, and that is load-bearing:** the
  keymap dispatcher (capture phase on `window`) treats only
  INPUT/TEXTAREA/contentEditable as editable — a `<button>` or ARIA combobox
  div would let ArrowDown also move list selections and letters feed
  speed-search.
- Escape goes through the keymap's `app.closeOverlay` (registered unscoped
  while open, declining while closed — the UpdatePanel pattern), or a PGSelect
  inside a PGModal closes the dialog from under the dropdown. Dialogs rely on
  the catalog's DEFAULT runner (reached only when every registered handler
  declined; `useAction` is an effect, children register first and sit OUTER).
  Local `onKeyDown` handlers start with `if (e.defaultPrevented) return`.
- The hidden sizer span reproduces native intrinsic width (widest label);
  the trigger carries `size={1}`.
- Keyboard fully re-provided: arrows/Home/End/PageUp/PageDown, Enter/Space
  commit, Tab commits and moves on, Escape cancels, Alt+↓/↑, type-to-jump with
  a 700ms buffer (single char cycles, longer narrows by prefix; mid-typeahead
  Space extends the query).
- Focus never leaves the trigger (options `preventDefault` their mousedown).
  Outside click, scroll, and resize CLOSE rather than chase (a fixed popup
  cannot follow its anchor). The capture-phase scroll listener must skip events
  from inside the control — the active-into-view effect scrolls the list on
  every open.
- Placement is `selectPos.ts`: below the trigger, else above, then clamped into
  the viewport on both axes and BOTH ends — an anchor that is itself
  off-viewport puts "above" off-screen too (found via a WebKitGTK screenshot;
  the shell is a fixed frame, so nothing could scroll it into view).
- Option rows are a list-row surface: `calc(24px + var(--row-step))`.
- Tests: `pgPickOption`/`pgSelectValues`/`pgSelectTrigger` (`@/test/select`) and
  e2e's `jsPickOption` select on the same attributes (`[data-pg-select-trigger]`,
  `[data-pg-listbox]`, `[data-pg-option][data-value]`) — move both together.
  `userEvent.selectOptions`, `fireEvent.change` and `selectByAttribute` don't
  apply (no `<option>`, no `change` event).
- Still open from the same audit, each its own change: `title` attributes
  (~156, GTK popups), `<input type="date">` ×2 (History),
  `<input type="color">` swatches (Settings), the GTK3 folder picker.

## Resizable panes (#162)

- **A pane has no fixed maximum — it has a sibling with a floor.** Call sites
  declare `min` + `siblingMin`; the cap is derived
  (`container - siblingMin - reserve - handle`, `design/paneSize.ts`, pure).
  Hard-coded maxima let a squeezed sibling put the handle at the container edge
  where the drag cannot be reversed.
- The hook names its AXIS (it sizes heights too: History's detail panel,
  Compare's commit lists) — `usePaneSize`, not `usePaneWidth`.
- **Preference and effective size are two values:** the persisted number is the
  user's preference; the rendered size is that preference clamped during
  render. Nothing derived from a measurement is ever stored (a small screen
  cannot destroy the size a big monitor earned; no oscillation).
- **Unmeasured (0) means "no constraint known", never "no space":**
  `paneMaxSize` returns `Infinity` until a real measurement lands; only the
  floor applies meanwhile. Pinned in `paneSize.test.ts` + `resizable.test.tsx`
  (jsdom has no layout, so the default test environment IS the unmeasured
  case — `src/test/elementSize.ts`).
- Three-pane containers are asymmetric on purpose: the first pane reserves the
  other fixed pane's MINIMUM, the second reserves the first's ACTUAL size
  (both-actual is circular; both-minimum squeezes the middle below its floor).
  The middle-keeps-its-floor arithmetic is a test, not a comment.
- Double-clicking a handle resets to `initial` — wire `onReset={pane.reset}` on
  every handle.
- E2E covers what jsdom cannot: the measurement arriving with no
  `ResizeObserver` (`e2e/specs/resizable-panes.e2e.ts`). Its `jsDragHandle` is
  the one mouse-event drag in the app (document listeners are registered by an
  effect the mousedown schedules, so the grab needs its own driver round trip).

## Dialogs

- **Never `window.confirm`/`window.prompt`** — `pgConfirm`/`pgPrompt` from
  `@/design`, promise-shaped, matching the native contract (dismissal →
  `false`/`null`; Escape + backdrop dismiss; empty prompt string ≠ `null`).
- `PGConfirmOptions` carries `body`, `danger`, `requireText` (type-the-name) —
  use them for destructive ops. `PGPromptOptions.multiline: <rows>` renders a
  textarea (Enter inserts a newline, ⌘/Ctrl+Enter submits; e2e's stub picks the
  value setter off the matching prototype).
- A `<PGDialogHost />` must be mounted per window (AppShell, MergeWindow) —
  with none, calls resolve `false`/`null` rather than hanging. Isolated
  component tests need `WithDialogs` from `@/test/dialog`, or every confirm
  silently reads as "cancelled".

## File lists

- Row glyph + tint from `lib/fileIcon.ts` (`fileIconSpec(path)`); add a
  language as a map entry, not a new SVG.
- `buildStatusTree`/`buildStatusList` emit the SAME row keys (`"/" + path`) —
  what makes the tree⇄flat toggle (`lib/useTreeViewMode.ts`) branch-free in
  selection, staging, and menus. Keep it true.
- Tree keyboard behavior belongs to the owning screen via `usePaneList`, not to
  `PGFileTree` — a local `onKeyDown` plus the dispatcher both answer ArrowDown
  and the selection moves twice.
- `FileStatus.submodule` is the exact complement of `embedded` (mutually
  exclusive by construction). Submodule leaves get the submodule glyph +
  `submoduleMenuItems` (the file menu is dead ends on a gitlink); staging stays
  legal — an updated pointer is an ordinary commit.

## Drag and drop

- **Pointer events, never HTML5 drag-and-drop** — WebDriver can't synthesize an
  HTML5 drag session, jsdom has no `DataTransfer`, and the native drag image is
  unthemable. Sources `preventDefault` the native path. Cost accepted: no file
  drag in/out of the window.
- **A drag source is a CONTAINER, not a row:** `useDragSource` on the list
  wrapper, the grabbed row resolved from `data-path`/`data-sha`/`data-pg-ref`.
  Per-row hooks would re-render the windowed slice on every pointer move
  (PGCommitRow is memoized, History is windowed).
- A source's reach is its pane's subtree — the commit screen's sources live
  inside `commit.files`, so a pointerdown on a diff row never starts a drag.
- Drop indication is a DOM attribute (`data-pg-drop-over`), not React state;
  multi-row zones use the delegated `resolve(el, payload)` mode.
- **The drop table is pure and tested** (`features/dnd/resolveDrop.ts`). The
  graph table is deliberately asymmetric — merge only INTO HEAD, rebase only
  HEAD, cherry-pick only onto HEAD (the only ops the backend has). A refused
  drop returns a reason (shown on the ghost), never silence.
- **Every drag has a keyboard equivalent** — staging → Space/checkbox, reorder →
  Mod+Shift+↑/↓ and chevrons, graph ops → menus/palette/Branches. A new gesture
  without one is not done. Escape cancels, from one capture-phase listener.
