# Frontend deep dives

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`) — deep-dive notes split out of CLAUDE.md, which keeps only the
operational rules and points here. A section referenced but not found in this
file lives in a sibling. `test/docs.test.ts` reads this set together with
CLAUDE.md, so the tree listings and command lists here are build-checked.

## Diff rendering

- **One row model; TWO renderers, not one.** `flattenDiffRows` (`lib/diffRows.ts`)
  turns a `FileDiff` into a flat `DiffRow[]`, and all four diff surfaces go
  through it — that is what keeps word spans, syntax, hunk indices and the
  `changedIndex` contract from drifting. But only THREE of them render it with
  `PGWindowedDiff` (Diff screen, commit panel, repo browser); `CommitDiffPanel`
  has its own lighter markup, tuned for the narrow History inline panel (no
  line-number gutters, tighter rows) and read-only, so it needs none of the
  staging machinery. This bullet claimed all four went through both renderer and
  model until #157; it was false when written, and anything shared between the
  surfaces has to be verified in `CommitDiffPanel.tsx` separately — the row model
  is the only thing you get for free. Unifying the two is a wanted follow-up.
- **A code line must NOT wrap in a unified diff row, and `white-space: pre` is what
  enforces it.** The row's height IS the window's pitch (`DiffRow.h`, prefix-summed
  by `rowOffset` / `scrollTopForRow` / `hunkAnchorRows`' consumers / the minimap),
  so a wrapped line is not a taller row — it is a row whose text draws over the
  rows below it. `PGDiffRow` shipped with `pre-wrap` under a fixed `height` and did
  exactly that: two source lines composited on top of each other, worst in the repo
  browser, whose diff pane is squeezed between the tree and the file-info sidebar.
  Long lines overflow to the RIGHT instead and the pane scrolls (`FocusableScroll`
  is `overflow: auto`), which is what every other diff viewer does; the row also
  carries `min-width: max-content` so the add/rem background and the gutter stripe
  cover the whole line rather than stopping at the pane's edge. `CommitDiffPanel`
  was already `pre`, and the SPLIT view's `PGSideBySideDiff` may keep `pre-wrap`
  because its rows are `minHeight` and unwindowed — nothing reads their heights.
- **Wrapping is opt-in, and it comes with the whole heights contract switched
  off.** `PGWindowedDiff`'s `wrap` prop makes rows elastic (`minHeight`, not
  `height`), so a caller passing it must also drop `window`, the minimap AND the
  offset-based `scrollToHunk` — the DiffViewer's Wrap toggle is the one caller, and
  it drops all three (`useHunkNav` then takes its documented DOM fallback, which is
  correct precisely because nothing is unmounted). One heights array stays the
  single source of truth for everything still reading it. Before this the toggle
  changed only the window and the minimap while `pre-wrap` was unconditional, so
  it wrapped in every mode and overlapped in every mode.
- **Whole file is the default view** (`diffContextMode: "wholeFile"`), and it is
  composed on the FRONTEND: the canonical diff is left exactly as fetched and the
  unchanged remainder is filled in around it as `fill` rows, from text
  `useDiffSyntax` already read. **Never get whole-file by passing a large
  `contextLines`** — libgit2 would return one hunk covering the file, so
  `stage_hunk` would stage everything and `changedIndex` would shift. `fill` is a
  distinct row kind with no `hunkIndex` precisely so it cannot reach a staging
  path. Any inconsistent gap arithmetic degrades rather than rendering wrong line
  numbers; git's `+N,0` convention (the line BEFORE) is normalized in `effStart`,
  or every filler number after such a hunk shifts by one.
- **There is NO `@@` hunk banner, and no `header` row kind** (#157). Whole-file
  mode leaves no gap for one to label — every line between two hunks is already on
  screen — so the four things the banner used to carry were rehomed:
  - Stage / Discard → `PGHunkActions`, a gutter cluster pinned to the hunk's
    ANCHOR row, plus the `diff.stageHunk` / `diff.discardHunk` chords
    (`Mod+Shift+H` / `Mod+Shift+Backspace`). The banner's buttons were
    mouse-only — `Tab` is `pane.focusNext`, so DOM focus never enters a pane's
    buttons — and the chords are what fixed that, not what preserved it.
  - Per-hunk collapse → **gone**, deliberately. It hid a change while its context
    stayed, its chevron had no host left, and a collapsed hunk would have no
    anchor row for F7 or the actions to hang off.
  - `data-hunk-index` / `data-hunk-active` → the anchor row (see the two-cursors
    bullet below). **`useHunkNav` is now wired into all four surfaces** — it was
    only in the Diff screen and the commit-diff panel, so F7 did nothing at all in
    the commit panel or the repo browser, for as long as both have existed. The
    hunk cursor is what the two chords aim at, which is how that was found.
  - The `@@` range itself → nothing in whole-file mode; a `PGFoldSeparator` in
    chunked mode, which names the run of unchanged lines it hides and offers to
    expand it in place. `fold` carries no `hunkIndex`, for the same reason `fill`
    does not.
- **The BACKEND still sends a `@@` line, and `flattenDiffRows` drops it** (#161).
  A hunk header travels TWICE and #157 only cut one of the two paths. The second is
  `DiffLineKind::HunkHeader`, an ordinary entry inside the hunk's own `lines[]`:
  `diff_to_file_diffs` prints with `DiffFormat::Patch`, so libgit2's `'H'` line is
  pushed in with the rest, and `toUiLine` maps every non-add/rem kind to `ctx` — so
  it rendered as a context row whose text is `@@ -1,3 +1,3 @@`. The two backend
  builders **disagree on purpose and must not be "unified" carelessly**: the
  working-tree `diff` drops `'H'` itself, while `diff_to_file_diffs` (commit diffs,
  `diff_commit`/`diff_commits`/`diff_ref_to_workdir`/`stash_diff`) keeps it, which
  is why the bug was visible in `CommitDiffPanel` and invisible in the commit panel.
  The KIND stays on the wire — `git/lfs.rs` reads `HunkHeader` to reconstruct one
  side of a diff and to size a candidate pointer — so the drop is frontend-side,
  and it is in `flattenDiffRows` because there are TWO renderers and a filter in
  one would leave the other broken. `changedIndex` is unaffected by construction
  (`withChangedIndices` counts `+`/`-` only), and `diffRows.test.ts` asserts the
  filtered rows are deep-equal to the same hunk with no header line rather than
  trusting that. `rowIndex` does shift — every surface derives its heights array
  from `rows`, so it shifts with it.
- **One `@@` still reaches a reader, and it is the SPLIT view's, not the row
  model's** (#161). `diffToSplit` (`DiffViewer.tsx`, `CommitPanel.tsx` — four sites,
  two per file) pushes `{ kind: "info", text: hunk.header }` into both columns as
  its own separator, and `PGSideBySideDiff` renders it verbatim. Note it arrives as
  DATA, off `DiffHunk.header`, so `grep '@@' src/` does not find it — every literal
  `@@` left in non-test source is a comment. Split mode does not fill gaps, so the
  discontinuity there is real and the row must stay — but its TEXT is the very
  string #157 set out to remove, and giving it the `PGFoldSeparator` treatment needs
  the gap counts `diffToSplit` does not compute. That is a follow-up, not a
  drive-by. `PGDiffLine`'s `"hunk"` kind, which rendered a literal `@@` with no
  producer anywhere, is gone.
- **`flattenDiffRows` has one gap walk and a two-tier degradation ladder.**
  `gaps: "fill" | "fold"` chooses filler rows or separators; `text` is handed over
  in BOTH modes (chunked needs it to expand a gap and to know the trailing
  remainder's length). A STRUCTURAL failure — a gap whose two sides disagree on
  length — falls all the way to bare concatenated hunks, because no gap count is
  then trustworthy; a TEXT-dependent failure (no text yet, text past
  `MAX_WHOLE_FILE_LINES`, text too short) falls only to `"fold"`, so the reader
  still sees a labelled discontinuity rather than a silently joined file. Fold
  mode never fails at the trailing gap, which is what keeps the re-entry bounded.
- **`diff_ref_to_workdir` is a shared primitive, not compare's helper** (#131).
  Arbitrary revspec vs the working tree, with the same `context_lines` /
  `ignore_whitespace` knobs the other diff ops take, plus an explicit
  `include_untracked`. It uses `diff_tree_to_workdir_with_index`, NOT the plain
  tree-to-workdir: without the index a file staged and then reverted in the
  worktree reads as unchanged. The compare view passes `include_untracked: true`
  — this backend's own worktree diff kinds already include untracked content, so
  hiding a file you just wrote would make ref↔worktree the one worktree diff in
  the app that lies by omission; `.gitignore`d files stay out either way.
- **But its untracked SCOPE is nothing like `diff`'s, and that is why it is
  bounded.** `diff` calls `opts.pathspec(path)` BEFORE turning untracked content
  on, so it only ever reads one untracked file; `diff_ref_to_workdir` walks the
  whole tree, and an untracked `dist/`, `.venv/` or downloaded dataset that
  nobody `.gitignore`d would otherwise land in one IPC payload and one `DiffRow`
  model per file. So it returns `WorkdirDiff { files, untracked_omitted }`, not a
  bare `Vec<FileDiff>`: over `MAX_UNTRACKED_FILES` the untracked side is dropped
  WHOLE and the count is reported (the compare screen renders it), and
  `MAX_WORKDIR_BLOB` caps per-blob size so one enormous file reads as binary.
  Truncating silently would be worse than the overflow — do not "simplify" the
  return type back.
- **Gate text rendering on `isTextualDiff(diff)`, not `!diff.binary`** (#93). A
  git-LFS pointer IS text, so `binary` is honestly false — rendering its hunks
  claims "2 lines changed" for a multi-megabyte asset. All four diff surfaces use
  the shared gate and render the shared `LfsDiffNotice` instead; `binary` is
  deliberately not overloaded, because other code trusts what it means.
- **Tokenization runs in a module worker.** Shiki's `codeToTokens` is synchronous
  CPU work, so awaiting it on the main thread still janked. Tokens come back
  packed into transferable `Int32Array`s rather than one object per token.
  `vite.config.ts` sets **`worker: { format: "es" }`** — Shiki's grammars are
  dynamic imports, so the worker bundle is code-split and Vite's default `iife`
  worker format fails the production build outright. A failed worker degrades to
  main-thread tokenizing, which is also the path jsdom component tests take.
- **Do not measure a scroll viewport behind a `typeof ResizeObserver` guard.**
  WebKitGTK 605 (the Linux webview, and the e2e target) has none; guarding before
  the initial measurement leaves the height 0, `windowVariable` falls back to a
  400px viewport, and the bottom of a taller pane renders blank. Use
  `lib/useViewportH.ts` — or `lib/useElementSize.ts` when the answer is a
  container's width, or both axes (#162). Any new measurement obeys the same
  order: read first, observe second.
- **And "read first" has a second half: the container usually mounts AFTER the
  hook** (issue 188). Every diff surface renders its scroll container only once
  the diff has arrived (`isTextualDiff(diff) && …`), so `useViewportH`'s
  mount-time `measure()` read `ref.current === null`, its effect never ran again
  (deps unchanged), and there was no element to observe even where
  `ResizeObserver` exists. The height therefore stayed 0 until the reader
  scrolled — `remeasure()` in the scroll handler is what quietly rescued it —
  which meant that on the Linux webview the pane windowed against the 400px
  fallback on first paint, and every consumer that treats 0 as "unmeasured"
  (`scrollTopForRow`, `diffOpenReady`) was simply switched off. `useViewportH`
  now carries a node-attach effect with no dep array: it compares `ref.current`
  to the node it last saw and measures on a change, plus `useElementSize`'s
  bounded rAF poll for a read that lands before layout. **A `RefObject`-taking
  measurement hook cannot know when its element appears; it has to look.** This
  is why the auto-open needed a Docker e2e run to be believed — it worked on
  macOS/WKWebView (which has `ResizeObserver`, though even there the observer was
  never attached) and did nothing at all on WebKitGTK.
- **A container that goes AWAY reports 0 too, and that is load-bearing.** Every
  diff surface unmounts its scroll container while `diffLoading`, and the diff and
  the file text can both land before that flag clears — so there is a render where
  every other readiness term is satisfied and `scrollRef.current` is `null`. With
  `useViewportH` keeping its last known height, the issue-188 auto-open fired into
  a pane that was not on screen: the scroll silently did nothing (there was no
  element), the once-per-file budget was spent, and the file stayed at line 1. 0 is
  the honest answer for "not any more" as well as "not yet", and it is the one term
  that comes BACK when the container does, which is what makes the open happen at
  the right moment instead of never. Note the failure was invisible to every other
  consumer — `windowVariable` falls back to 400px and nothing renders anyway — so
  it took a probe on the real webview to find, printing the readiness terms as a
  `data-` attribute. (`PGPane` does not spread `...rest`, so such a probe has to go
  on a plain element.)
- **Two cursors, two index spaces, and they must not be confused.** `useHunkNav`
  keeps a HUNK cursor (F7/⇧F7, rendered as `data-hunk-active` on the hunk's
  ANCHOR row — its first changed line, marked `hunkAnchor` by `flattenDiffRows`;
  exactly one per hunk, falling back to the hunk's first row when it has no
  changed one, so every hunk index stays addressable);
  `useDiffLineFocus` keeps a per-LINE cursor (list-nav chords + Space, rendered
  as `data-focused`). A `DiffLineTarget` carries BOTH numbers because they are
  different things: `rowIndex` addresses the flat `DiffRow[]` (what the focus ring
  and `scrollTopForRow` use) and `changedIndex` addresses the hunk's changed
  (`+`/`-`) lines (the ONLY value `stage_lines`/`unstage_lines`/`discard_lines`
  accept). The line cursor deliberately walks changed lines only — context and
  `fill` rows are unstageable, and skipping them is what keeps one mapping instead
  of two. Never derive a backend index from a row index or vice versa; read
  `changedIndex` off the row, where `flattenDiffRows` put it.
- **F7's own scroll goes by offset too, now that its anchor is a line row.**
  `useHunkNav` takes a `scrollToHunk` built from `hunkAnchorRows` +
  `scrollTopForRow`, and every diff surface supplies one; the hook's
  `querySelector` + `scrollIntoView` survives only as the fallback for an
  unwindowed caller and its unit test. A line row is unmounted far more often
  than a header row was.
- **A diff OPENS at its first change, and F7 carries into the next file** (issue
  188). Both live in `useHunkNav`, not in the four screens that call it — the rule
  F7 itself records: implemented per screen, two of the four silently went without
  it for as long as they existed (#157). Five parts, each of which cost something:
  - **The auto-open waits for `diffOpenReady`** (`features/diff/useDiffGaps.ts`),
    which is where all four surfaces answer "may I scroll yet?" identically: the
    row model belongs to the file now SHOWING (`diffFor === showing` — a switch
    renders once with the outgoing diff still in state, because the fetch is
    async, and auto-opening there spends the once-per-file budget on a row model
    about to be replaced; measured on WebKitGTK as "the second file opens at line
    1 every time"), rows exist, the viewport is MEASURED (0 is unmeasured, never
    "no space"), and in whole-file mode the file TEXT has landed. The commit
    panel's identity carries the SIDE as well as the path, because the two sides
    of one file are two different diffs. Do NOT solve the staleness by keying the
    hook's `resetKey` to the diff instead: a diff is refetched whenever the status
    changes, so staging a hunk would then yank the reader back to the first
    change. That last term is the non-obvious
    one — until the text arrives `flattenDiffRows` degrades to fold separators, so
    every anchor row sits near the top and is about to move tens of screens down;
    scrolling before that puts the reader back at line 1, which is the bug being
    fixed. A fill-mode diff whose two sides BOTH read as null text never settles
    and keeps the old no-scroll behaviour: "not loaded yet" and "there is no text"
    are the same value, and guessing wrong is worse than not moving.
  - **The cursor starts at 0 only when the auto-open actually ran**, so
    `data-hunk-active` and the scroll position can never disagree. Everything else
    keeps -1 — and the backward edge test is `cursor === 0`, not `cursor <= 0`, or
    a ⇧F7 on a file that never auto-opened would announce the previous file
    instead of landing on hunk 0 the way it always has.
  - **The reader wins, and a MISS costs nothing.** Two separate flags, and the
    distinction is the whole robustness argument. `readerActed` is set by any
    F7/⇧F7 press and locks the file for the rest of its life, so nothing that
    settles later can yank someone who has already moved. `opened` is spent only
    by a reveal that CONFIRMED it landed — every surface's `scrollToHunk` now
    returns a boolean, checking `el.scrollTop` against what it asked for, because
    a container mid-refetch clamps the write and a missing one swallows it
    entirely. A miss therefore leaves the budget alone and the next qualifying
    render tries again; and `ready` going false RETURNS the budget outright, since
    a scroll container that unmounts and comes back has lost its position and the
    first change is the right place to be again. Spending the budget on a miss is
    exactly how the second file came to open at line 1 with its cursor claiming
    hunk 0 — visible only on the e2e webview, and only under load, which is why
    the probe was needed. `scrollToHunk`'s reveal-only guard stays, so a first
    change already on screen does not jump.
  - **Crossing files is the `files` prop, and the HOOK owns the arithmetic**:
    `{ count, index, select }` per surface, and the hook decides legality
    (`index ± 1` inside the list), so "stop at the ends, never cycle" has one
    implementation. `select` must move the FILE-LIST selection, not just the diff
    pane, or the two panes disagree about which file is open. Omitting `files`
    keeps the old clamp — which is `RepoBrowser`, deliberately: its pane lists
    every tracked file, not a changed set, so "the next file" would mean a
    DIFFERENT list from the one on screen (and it can be showing a revision, where
    the pane is a preview). `CommitPanel` DOES cross the staged/unstaged boundary,
    because `usePaneList` already treats the two sections as one list in that
    order, and two orderings for two keyboards is the drift a shared list prevents.
  - **The hint names its own chord, and the arming expires with it.**
    `chordFor("diff.nextChange")`, never the literal "F7" — bindings are
    rebindable and there are two presets. The armed state lives exactly
    `PG_FLASH_MS`, so an F7 pressed minutes later cannot teleport the reader out
    of the file. `pgFlash` is SINGLE-INSTANCE for the same feature: it appended a
    fresh node per call with no dedup, and a "press it again" hint is the one
    message guaranteed to be raised twice in a row onto one fixed position.
- **Scroll a diff row into view BY OFFSET** (`scrollTopForRow`), never by
  `querySelector` + `scrollIntoView`: the row is usually unmounted under
  windowing, so the DOM route silently does nothing (the #68 G10 trap). It
  no-ops for an out-of-range index or an unmeasured viewport rather than jumping
  to the top.
- **A programmatic `scrollTop` write is not a scroll event, and the windowed range
  does not update by itself** (issue 188). MEASURED on WebKitGTK 605 under xvfb: an
  `el.scrollTop = 1881` assignment made inside an effect left the DOM scrolled while
  `win` still described the TOP of the file — `start: 0`, one spacer — for SECONDS,
  until an unrelated re-render recomputed it. The row being scrolled to is unmounted
  for that whole time, so F7's `data-hunk-active`, the line cursor's focus ring and
  the auto-open at the first change each appear to do nothing at all, on the engine
  CI runs. It looks fine most of the time because the syntax tokens usually land
  right after and rebuild `heights`, which recomputes the window from the ref during
  render — but a token-cache hit removes even that, which is exactly what a second
  file with identical text produced. So every programmatic diff scroll goes through
  `useVariableWindow`'s `scrollTo`, which assigns AND publishes the new window in one
  call; a real user scroll still arrives through `onScroll`. Two sites still write
  `scrollTop` directly and inherit the hazard — `FocusableScroll`'s Home/End and
  `DiffMinimap`'s scrub — and are named in that hook's own comment as follow-ups
  rather than drive-bys.
- **The minimap gutter derives from the ROW MODEL, never the DOM** (#161). Rows are
  windowed, so most of the file is unmounted; the gutter is painted from
  `DiffRow[]` + `heights` alone (`lib/diffMinimap.ts`, pure and tested in node) and
  sits OUTSIDE the scroll container, beside it in a flex wrapper. Three rules that
  each cost a bug to learn:
  - **Measure the WRAPPER, not the scroll area.** The hide threshold
    (`MINIMAP_MIN_CONTAINER_W`, 530px — derived from `PGDiffRow`'s 112px of fixed
    chrome plus 48 mono columns plus the 64px gutter) is read off the box that
    contains both, so showing the gutter cannot change the number that decides
    whether to show it. Measuring the scroller would close that loop and flicker
    while a resize handle crossed the threshold. Width 0 means UNMEASURED and must
    not hide it (the `useElementSize` contract).
  - **A canvas cannot be handed a CSS variable, and `--git-*` are `oklch()`.**
    `getComputedStyle(root).getPropertyValue("--git-added")` returns the literal
    `oklch(…)` token stream on every engine, and `ctx.fillStyle = "oklch(…)"` on an
    engine that cannot parse it is a SILENT no-op that keeps the previous fill — so
    it would paint black on WebKitGTK while looking right on macOS. `lib/cssColor.ts`
    converts to `rgb()`/`rgba()` in TypeScript, which also makes the render
    byte-identical across engines. Repaint is a `useSettingsStore` subscription on
    `activeThemeId` AND `customThemes` (editing the live theme keeps its id).
  - **Light mode needs its own ALPHAS, not its own colours.** The tokens are
    already mode-calibrated (#61 B4) and inherited; how much of them to lay down is
    not — a third of `--fg-3` reads on near-black and vanishes on near-white. Hence
    the `ALPHA` table keyed on `data-theme-mode`. Verified by rendering both.
- **A pointer-events-only gesture is not enough on the e2e/CI webview** (#161).
  MEASURED on WebKitGTK 605.1.15 under xvfb: a real WebDriver pointer action
  delivers `mousedown` and NO `pointerdown`, although `window.PointerEvent` is a
  function. `features/dnd` gets away with it because every drag it owns has a
  keyboard equivalent by rule; the minimap scrub IS the feature, so it carries a
  `mousedown` fallback gated on a `sawPointer` flag — a compliant browser fires
  `pointerdown` first, so the flag is set before `mousedown` arrives and the
  fallback declines. Any future control whose only affordance is a pointer gesture
  needs the same pair, and must not assume a green dnd spec proves pointer events
  are delivered (those specs synthesize `MouseEvent`s NAMED `pointerdown`).
- **Line ops inherit the ignore-whitespace gate.** That flag rewrites hunk
  boundaries, so both the click path and the keyboard cursor are switched off by
  `useHunkActionsDisabledReason` — the keyboard must never reach what the mouse
  cannot (#61 D2).

## The log is paged (#68 G11)

- **`s.commits` is a PREFIX of history, not history.** History loads one page at
  a time (`PAGE_SIZE = 500`) and appends; `hasMoreLog` is "the cursor is not
  null". So any logic that answers a question about the repository from
  `s.commits` is answering it about however much has been walked so far. That is
  fine for what is on screen and wrong for "does this commit exist" or "is X an
  ancestor of Y" — ask the backend.
- **The cursor is a FRONTIER — a set of oids, not one.** At a page boundary
  several lanes are alive, each awaiting a different parent, so resuming from
  the last emitted commit alone would silently drop every other branch.
  `LogPage { commits, nextCursor }`; `nextCursor: null` means the walk reached
  the true end of history.
- **Passing a cursor makes `refspec` a no-op**, deliberately: the frontier
  already encodes the walk it continues. Changing scope means starting a new
  walk with no cursor, not handing the old cursor a new refspec.
- **Two cursors, because a search must not destroy the unfiltered resume
  point.** `commitCursor` belongs to `commits`, `searchCursor` to
  `searchResults`, and `loadMoreCommits` extends whichever list is active
  (`getLogPage` vs `getLogFilteredPage`). Both are `RepoSlice` fields — a tab
  switch restores the cursor with its list, so a background tab does not silently
  resume another repository's walk.
- **Filtering happens on both sides and they are not the same filter.** The
  backend `LogFilter` decides which commits count toward `limit`;
  History then filters the loaded page again client-side (hide-merges, the text
  box). A client filter can therefore hold the visible list shorter than the
  window no matter how many pages arrive, which is why History's auto-paging
  effect counts *barren* pages and stops after `MAX_BARREN_PAGES` — without that
  bound it walks the whole repository a page at a time. Any new client-side log
  filter inherits that trap.

## Navigation model

- Activity bar = primary screen switcher, History first. **Launch always lands
  on History** — there is no screen restore (the old `localStorage["pg-screen"]`
  read AND write are gone; nothing else uses the key). A tab restored from
  `pg-open-repos` is created on History too, so the open set persisting does not
  resurrect screen restore.
- **Repositories are tabs (#90).** The strip is its own row below the titlebar
  (`PGTabStrip`, wired by `features/repo/RepoTabs`), rendered only when a
  repository is open. Opening a repository ANYWHERE — ⌘O, a recents row, a clone,
  an init, a forwarded `pgit …` — goes through `useTabsStore.openRepo`, which
  focuses the existing tab for that path or adds one. `useRepoStore.openRepo` no
  longer exists; the low-level half is `openRepoAt`.
- **Each tab remembers its own screen, within the session only.** `enterScreen`
  writes it (`useTabsStore.rememberScreen`); an effect on `activePath` restores
  it, skipping first mount. Selections and scroll are NOT preserved: the screen
  container is keyed by the active repository, so a switch remounts it. That is
  deliberate — a retained selected-oid or selected-path from another repository
  would render the wrong thing, or diff it.
- **Tab chords** (`features/keymap`): `tab.next`/`tab.prev` (`Ctrl+Tab` /
  `Mod+Tab`, both spellings so one table works on every platform),
  `tab.close` (`Ctrl+W` / `Mod+W`), `tab.select` (`Alt+1`…`Alt+9` — one action
  bound to nine chords, reading its digit from the chord the dispatcher passes to
  `run`), `tab.switch` (`Mod+E`, the palette's repository switcher). The strip is
  chrome, not a `PGPane` — it stays out of the `Alt+Arrow` spatial graph, like the
  titlebar and status bar.
- **`tab.select` carries `suppressInInput`, and must keep it.** `hasRealModifier`
  makes every `Alt+…` chord dispatch while typing, but ⌥+digit IS a character on
  macOS — and on Nordic layouts one people type — so claiming it would silently
  eat keystrokes in the commit box. Same opt-out `pane.focus*` uses for ⌥←/⌥→.
  Any future bare-`Alt`+printable binding needs the same flag.
- **Screen entry focuses the screen's primary pane.** One `<PGPane primary>` per
  screen (History's commit list, Files' tree, …) declares it; `useFocusStore`
  holds it as `primaryId`, and it outranks both mount order and geometry for two
  moments: entering a screen, and Alt+Right off the activity bar (from a
  full-height bar the geometrically nearest pane to the right is often a bottom
  detail panel — never what "go into this screen" means). Ordinary Alt+Arrow
  moves stay geometric. Screen entry is counted by `entryTick` so re-picking the
  CURRENT screen re-enters it: an activity-bar click moves DOM focus to that
  button, and with a `[screen]`-only effect focus stayed stranded on the bar and
  every list chord went nowhere.
- Keyboard: everything routes through `features/keymap` (action catalog +
  preset bindings; rider preset default). Modifier chords work while typing;
  bare keys don't. `?` opens the cheat-sheet. `view.zoom*` (Mod+= / Mod+- /
  Mod+0) scales the UI through the WEBVIEW's own zoom (`applyZoom`, persisted as
  `uiZoom`), not a CSS transform — needs `core:webview:allow-set-webview-zoom`.
- **Two PANE-scoped actions may share one chord; two global ones may not.** The
  dispatcher's reverse map is `chord → ActionId[]` and it tries each id in turn,
  so a declined action falls through to the next — `Space` is `list.toggle` in a
  list pane and `diff.toggleLine` in the diff pane, resolved purely by which pane
  holds focus. `presets.test.ts` enforces exactly that asymmetry, so prefer a
  second catalog entry over hanging a second meaning off one action id: the cheat
  sheet and palette then name each behavior in its own category, and the two can
  be rebound apart. Register the pane handler as declining (`() => false`) when it
  has nothing to act on, or it swallows the chord from the other action.
- **A pane action may also share a chord with a GLOBAL one — but then the BINDING
  ORDER is load-bearing** (#158). `Mod+D` is `diff.viewCombined` in
  `history.list` and `nav.diff` everywhere else. A global action with a default
  runner never declines, so tried first it shadows the pane action permanently and
  silently; the pane entry must come earlier in the preset table (`COMMON` is
  spread before the per-preset `nav.*`, which is why it lands there), and
  `presets.test.ts` pins the resulting `rev.get("Mod+D")` order. The pane
  handler's decline is then what keeps the global chord working — in History that
  means an EMPTY selection, i.e. an empty log and nothing else (#164). It shipped
  with a floor of *two* to keep `Mod+D` → Diff viewer on the launch screen; one
  commit now routes to its own diff, because #158 asked for "a commit or commits"
  and Rider's ⌘D on a selected commit shows that commit's diff.
- `useNavStore.intent` drives deep-view switches (e.g. "show this commit's diff" → sets screen to `commitDiff`). Consumers write an intent; `AppShell` effect routes the screen.
- **A new `NavIntent` kind must be routed in AppShell, and both halves of that
  are now enforced.** The routing switch ends in `default: assertNever(intent)`,
  so an unrouted kind is a **compile** error — `stash-vs-wt` shipped declared in
  the union, emitted by the stash menu and fully handled by `CommitDiff` with no
  `case` in the switch, which made the menu item do nothing at all and passed
  review, `tsc`, unit, component and e2e tests alike (#133). The compile check
  cannot tell a real destination from `case "x": break;`, so
  `AppShell.navroutes.test.tsx` drives every kind through the real shell and
  asserts the screen changed; its `EXPECTED` table is a mapped type over
  `NavIntent["kind"]` (a union has no runtime form — the type system does the
  enumerating), and a kind that must deliberately NOT navigate needs an entry
  there carrying a written reason. The test reads `data-pg-screen` off AppBody,
  which is the routed screen with no screen-internal selectors involved.
- **Compare is a deep view, not an activity-bar screen** (#131). `ref-compare`
  routes to `compare`; the intent carries the two sides for readability but the
  SCREEN reads them from `useCompareStore`, because they stay mutable once you
  are there — which is also why it is not a fifth `Target` in `CommitDiff.tsx`
  (that union is oid-shaped and immutable once routed, and "working tree" has no
  oid). A working-tree side is right-hand ONLY: it is not a commit, so
  `left..workdir` is neither countable nor walkable, and the ahead/behind summary
  and both commit lists are ABSENT rather than zeroed.
- **A stash comparison is two `CommitDiff` targets, not a `compare` side**
  (#133). `stash-diff` is the entry against its own FIRST PARENT ("what it
  changed"), `stash-vs-wt` is it against the working tree through the shared
  `diff_ref_to_workdir`. Both stay in `CommitDiff` because a stash commit's
  parents are three different commits, so `compare`'s rev↔rev half would walk
  the index and untracked commits as history and announce a stash as "3 commits
  ahead". `CommitDiff`'s oid-shaped `Target` is not violated: the STASH is the
  oid, and the target is still immutable once routed.
- Settings is a screen too, reached via titlebar gear or activity-bar settings slot.
- Conflicts are NOT a destination: `OperationBar` (driven by `repoState`), the
  status-bar conflict count, `⌘5`/`conflict.openResolver` and a conflicted row's
  context menu all open the merge resolver window instead (#108).
- **Bisect is not a destination either** (#93). It is a `repoState`, so
  `OperationBar` owns it: its own `OpKind` with Good/Bad/Skip/**Reset**, and git's
  own progress numbers. Reset REPLACES the generic Abort for this state —
  `abort_operation` hard-resets to HEAD, and mid-bisect HEAD is the detached
  commit being tested, so the bar's one previous button was actively harmful.
  Entry points: the History commit menu's Bisect submenu, a two-commit selection,
  and the palette. **No keyboard chords for bisect on purpose:** every catalog
  action must be bound in both presets, the ⌘1–9 row is full, and a bare-chord
  misfire mid-bisect corrupts the search with no undo short of a reset.
- `submodules` (⌘⇧8) and `worktrees` (⌘⇧7) are activity-bar screens, same chord in
  both presets. They are empty for most repositories and that is deliberate: a
  conditional entry would move the bar's geometry under the user between repos.
  **LFS is a panel on the Remote screen, not a screen** — `git lfs fetch/pull`
  are remote-object transfers whose endpoint comes from the remote URL.


## State management
- **Zustand per-feature**, not one big global store. `useRepoStore` lives in `features/repo/` because that's who owns the state.
- **`useRepoStore` holds exactly ONE repository's live state: the active tab's**
  (#90). `useTabsStore` owns the open set and freezes each inactive tab's slice;
  switching is snapshot → hydrate → `refreshAll`. Screens keep reading
  `s.status` / `s.commits` / `s.branches` and calling the same actions — they
  never learn there is more than one repository open. Consequence: a background
  tab's data is frozen at the moment you left it (no N-way log walks); its badge
  is re-read on window focus by `refreshBadges`.
- **Hydration is a TOTAL write, and `REPO_SLICE_KEYS` is what makes it one.**
  `features/repo/repoSlice.ts` declares every non-function field of the store;
  `repoSlice.test.ts` derives the live keys at runtime and fails if they diverge.
  **A new per-repo store field must be added to `RepoSlice`/`emptySlice`** or
  hydration silently degrades to a patch and the previous repository's value
  survives into the next tab. `emptySlice()` is also the store's initial state and
  what `closeRepo()` resets to — one definition, not three.
- **Every fetch/error write in `useRepoStore` goes through `setFor(repoId, …)` /
  `setErrorFor(repoId, …)`.** A switch is atomic but the requests in flight are
  not: an unguarded `refreshAll` for repo A can resolve after the user moved to B
  and write A's status, log and branches into B's slice. Same idea as the existing
  `logRef`/`commitFilter` staleness guards, on repo identity. `useTabsStore`
  carries the matching `activationSeq` guard for its own awaits.
- **The dependency runs one way: `useTabsStore` → `useRepoStore`.** Don't import
  the tab store from the repo store; the pure halves (`tabs.ts`, `repoSlice.ts`)
  exist so neither needs to.
- **Closing a tab evicts the repository backend-side** (`close_repo`). `open`
  mints a fresh `RepoId` per call and nothing else removes an entry, so without
  it every open leaks a `git2::Repository` and its file handles for the process
  lifetime. Closing an unknown or already-closed id is a silent success by
  contract; `close` deliberately leaves the `rebases` map alone (rehydratable
  from `.git/platypusgit-rebase.json`).
- **One path is one `RepoId`, and the dedupe happens BEFORE `open_repo`** (issue
  177). Two producers spell a workdir differently — libgit2's `workdir()` carries
  a trailing separator, `open` answers without one — and `path` is a tab's
  identity, so compared raw `/repo/` and `/repo` are two repositories. A launch
  with a path already in the restored open set therefore opened it twice: the
  session restore and `useCliLaunch` are two independent openers, and the loser's
  `RepoId` was left in `useRepoStore.current` after the tab layer evicted it, so
  every later call answered `UnknownRepo` with no banner (the diff pane silently
  dead for the session, because `useLazyVerification` swallows its half).
  Normalize through `git::repo_path_key` (Rust — `open` and
  `cli::resolve_repo_root` both go through it) and `tabs.ts`'s `repoPathKey`
  (every path entering the tab layer, `pg-open-repos` included). Note
  `PathBuf`'s own `==` is component-based and reports the two spellings EQUAL, so
  a Rust test that compares paths cannot see this — assert on the string form.
- **`openRepoAt` adopts a handle only if it is still wanted, and closes it
  otherwise.** It takes a `stillWanted` predicate — REQUIRED, not defaulted —
  re-asked after `open_repo` resolves and before the first write; `hydrateTab`
  passes its `stillCurrent(seq)`. A switch to an ALREADY-OPEN tab supersedes an
  in-flight open without starting one, so the repo store cannot see that for
  itself, and adopting first and cleaning up afterwards is what made the orphan
  reachable. A default plus a monotonic `openSeq` counter in the store was tried
  and REJECTED: it is a second, weaker answer to the question `stillWanted`
  already answers, no test could tell it apart, and it gets the answer wrong when
  one activation opens twice — the ownership-trust retry bumps the counter past a
  concurrent, still-current activation's in-flight open, which is then discarded
  and its tab marked failed. One authoritative guard, enforced by the signature.
  `openRepoAt` returns the handle IT opened, never `get().current`: handing back
  the winner's handle would have the caller evict the live repository as the
  abandoned one.
- **Two moments can strand a handle, and each has its own eviction.** Superseded
  BEFORE adoption is `openRepoAt`'s (above). Superseded DURING the `refreshAll`
  that follows adoption is `hydrateTab`'s `!stillCurrent(seq)` arm — the store has
  already answered `stillWanted` by then, and `hydrateTab` returns before
  recording the `repoId` on the tab, so nothing else could ever reach that handle.
  A third case is a re-key: only the BACKEND can resolve a symlinked spelling
  (`/var/x` → `/private/var/x`), so two tabs can still exist for one repository
  and the surviving one may already hold a live `RepoId` — `hydrateTab` evicts the
  displaced tab rather than overwriting its id. Every one of the three has a test
  whose failing path was verified by mutation; an eviction leaks silently, so an
  untested guard here is indistinguishable from no guard.
- **`init_repo` answers with a REGISTERED `RepoId`, so `useCreateStore` evicts
  it.** `Libgit2Backend::init` finishes by calling `self.open` (a handle that is
  not in the map 404s on the next call), and `runInit` then hands the path to
  `useTabsStore.openRepo`, which mints a second id for it — every "New
  repository…" leaked one `git2::Repository` for the process lifetime. Nothing
  reads that handle past its `path`, so it is closed BEFORE delegating. `clone_repo`
  is unaffected: it answers with the destination PATH, not a handle. A future
  command that returns a `RepoHandle` the frontend does not itself adopt inherits
  this obligation.
- **Compare paths on the TAB's own key, never the caller's spelling.**
  `findTab`/`indexOfTab`/`removeTab` normalize, so a caller holding `/repo/` finds
  the tab and then used to slip past every raw `===` after it: `activate`'s
  `activating` guard (the one that keeps the launch race down to one open),
  `close`'s `wasActive` (the tab left the strip while `activePath` went on naming
  it, so the store sat on a repository it had just evicted) and `closeOthers`'s
  filter (which matched nothing and closed the repository it was told to keep).
  `openRepo` forwards its RAW argument to `close` on a failed open, so this is
  reachable, not hypothetical.
- **Closing a tab the merge resolver is using confirms first, then closes the
  resolver, then evicts.** The resolver is a separate window driving IPC with that
  `RepoId`, so evicting underneath it would fail its next call with `UnknownRepo`
  mid-resolution. `mergeWindowHoldsRepo` / `closeMergeWindow`
  (`features/merge/openMergeWindow.ts`) own that handshake — the latter waits for
  the window label to disappear, because `close()` resolves when the request is
  delivered, not when the window is gone. A live resolver this page instance
  cannot attribute (main reloaded under it) counts as a match on purpose.
- **Danger-op error paths refresh first, set error last.** In `useRepoStore` catch arms (see `mergeBranch`), call `refreshAll()` BEFORE `set({ error })`: `refreshAll` starts with `set({ error: null })`, and React 18 batches same-tick sets, so the opposite order silently wipes the banner. `refreshAll` never rethrows, so the error always wins when set last. A failed git op must still refresh — the UI reflects disk truth even on error.
- `useNavStore` handles cross-screen navigation intents — add new `NavIntent` kinds there, route in `AppShell`.
- Cross-feature state is rare; compose in `src/store.ts` if needed — don't hoist prematurely.


## Styling
- Tailwind v4 (CSS-first config). Theme tokens are declared on plain `:root` in `src/index.css` (there is no `@theme {}` block). Use CSS vars (`var(--accent)`, `var(--bg-0)`, `var(--fg-0)`, `var(--git-*)`) or Tailwind arbitrary-value syntax.
- **The shell is a fixed frame: `html, body, #root` are `overflow: hidden` +
  `overscroll-behavior: none`.** Panes own their scrolling (`FocusableScroll`).
  Without it a too-wide row or an off-viewport portal made the whole window
  scroll sideways, titlebar and activity bar sliding along. A new surface that
  can overflow needs its own scroll container — the document will not provide one.
- No `tailwind.config.js` — v4 doesn't need one.
- **`:root` is only the pre-hydration default for the themeable tokens.**
  `applyTheme()` (`features/settings/useSettingsStore.ts`) is the source of
  truth: besides the editable palette it writes `SEMANTIC_TOKENS`
  (`--git-*`, `--graph-*`, `--accent-2..5`, `--shadow-*`) per theme **mode**,
  and `SELECTION_TOKENS` (`--bg-selection*`) derived from `--accent`. Light
  themes need their own calibration or diff colors, graph lanes and shadows
  stay dark-calibrated over a light canvas (#61 B4). The `dark` column is kept
  byte-identical to `index.css`; edit both or they drift.
- Never hardcode the accent hue. Use `var(--accent)` or relative-color
  `oklch(from var(--accent) l c h / <alpha>)` so custom themes carry through.
- Fonts are vendored (`@fontsource-variable/*`), not assumed present.
- Inline `style={{…}}` with CSS vars is fine and used widely in chrome components.
- `BranchInfo.tip` is a **full** oid. It was once truncated to 7 chars, and every
  comparison against `CommitInfo.oid` then failed silently — History's HEAD
  indicator (`headIndicator`: bar / row tint / both / graph-marker-only) never
  drew, the graph's HEAD ring never drew, and `headAncestryOf` degraded to "the
  whole log". Shorten with `shortSha` at display sites, never at the source.
- **Any new list-row surface must opt into UI density**, or the Settings toggle
  silently skips it (that's how it rotted the first time — issue #70). Write
  `height: "calc(<base>px + var(--row-step))"`, or
  `padding: "calc(<base>px + var(--row-step) / 2) …"` for padding-sized rows;
  `--row-h` is the shared token for plain 24px rows. `--row-step` is 0 in
  compact, so keep each surface's existing base and the default layout is
  unchanged. `grep -rn 'var(--row-step)' src/` lists what participates.
  Chrome (titlebar, status bar, toolbars, panel headers) stays fixed, as does
  diff/code line geometry (`--lh-code` owns that). The one surface that can't
  use the token is `PGGraphRow` — it draws in SVG user units, so `PGCommitRow`
  feeds it the number from `useDensityStep()`; those two must stay in sync or
  the History graph desyncs from its rows.

## Design system
- Import UI primitives from `@/design` (not per-file). `design/index.ts` barrel re-exports everything.
- New shared primitive → add to appropriate file in `src/design/` and re-export via `index.ts`.
- `PGButton`/`PGInput` spread `...rest` onto their DOM node (so `data-testid` etc. pass through); `PGIconButton` does NOT (forwards `title` only). Row components (`PGChangeRow`, `PGCommitRow`, `PGFileTreeRow`, …) need explicit prop threading for new attributes.
- Do NOT add `src/components/ui/`. The design system lives in `src/design/`.

## No native `<select>` — every dropdown is an in-page listbox (issue 146)

- **`PGSelect` renders a `role="combobox"` trigger plus a portalled
  `role="listbox"`, and there is no `<select>` or `<option>` left in `src/`.**
  WebKitGTK maps a native `<select>` as a **GDK popup surface**, and GDK's
  Wayland backend refuses to map a popup that would not be the topmost one
  (`Tried to map a popup with a non-top most parent`, gtk#5639 — the X11 backend
  never emits it). Two of these were mounted at all times on History, the launch
  screen, and Rebase mounts one per plan row, so the app asked for that surface
  constantly. Firefox has the matching report under Weston specifically: native
  `<select>` drop-downs unusable, drop-downs built out of buttons unaffected
  (Mozilla 1600584). `test/nativeSelect.test.ts` is the guard, because
  reintroducing one is invisible on macOS and Windows.
  **This is a MITIGATION, not a verified fix** — the reported freeze was never
  reproduced (our only Linux lane is xvfb/X11, which cannot emit a Wayland-only
  warning), so issue 146 stays open. It removes the documented trigger shape, and
  it is independently justified: every other picker in the app was already an
  in-page portal, and a native `<select>` cannot be themed to match them.
- **THE FOCUS HOST IS AN `<input readonly>`, AND THAT IS LOAD-BEARING.** The
  keymap dispatcher listens in the CAPTURE phase on `window`
  (`AppShell`), so it sees every key before the control does and
  `stopPropagation` cannot preempt it. Its text-input policy is the only thing
  that keeps bare-key chords out of the app's list navigation, and `isEditable`
  recognises INPUT / TEXTAREA / contentEditable — **nothing else**. A
  `<button>` or the ARIA-canonical `<div role="combobox" tabindex=0>` would let
  ArrowDown ALSO move History's commit selection and a letter feed the focused
  pane's speed-search. (A native `<select>` is not "editable" by that test
  either, so this control never had the protection — an existing bug the swap
  happens to fix.) Modifier chords still dispatch, as from any other input.
- **Escape goes through the keymap's `app.closeOverlay`**, registered unscoped
  while open and declining while closed — the `UpdatePanel` pattern. Not a
  nicety: a PGSelect open inside a `PGModal` has to eat Escape, or the dialog
  closes out from under an open dropdown. What guarantees it is the dispatcher's
  own precedence, and note WHICH half — no dialog in the app *registers*
  `app.closeOverlay`; they all rely on the catalog's DEFAULT RUNNER, which the
  dispatcher reaches only when every registered handler declined. (Registration
  order would not have helped: `useAction` is a `useEffect`, and effects run
  child-first, so a child's handler is registered BEFORE its parent's and is
  therefore the OUTER one. `usePaneList` is the only registrant, and it declines
  unless its own pane has a live speed-search query.) The component's local
  `onKeyDown` starts with `if (e.defaultPrevented) return;` for the same reason
  every local key handler does.
- **The hidden sizer span is the native intrinsic width.** A `<select>` is as
  wide as its widest option; an `<input>` sizes to its `size` attribute. So the
  trigger sits in a one-cell grid beside a `visibility: hidden` span holding the
  longest label, and carries `size={1}` so it contributes no width of its own.
  Most call sites pass no width and depended on that behaviour.
- **Keyboard is re-provided deliberately, not partially**: arrows / Home / End /
  PageUp / PageDown, Enter and Space to commit, Tab to commit and move on, Escape
  to cancel, Alt+↓/↑ per the ARIA pattern, and type-to-jump with a 700ms buffer
  where a single character CYCLES the matches and a longer one narrows by prefix
  (a native `<select>`'s own rule). Mid-typeahead Space extends the query instead
  of committing.
- **Focus never leaves the trigger**, which is what makes "return focus to it"
  free: the listbox has no focusable children and each option `preventDefault`s
  its `mousedown` so the click cannot steal focus. Outside-click, a scroll and a
  resize all CLOSE rather than chase — a `position: fixed` popup cannot follow a
  moving anchor.
- **Placement is `selectPos.ts`, and the FINAL clamp is not belt-and-braces.**
  Below the trigger, else flipped above — and then clamped into the viewport on
  both axes and **both ends**, because an anchor that is itself off the viewport
  (a control below the fold of a scrolled pane, opened programmatically) puts
  "above" off-screen too. That was found by looking at a WebKitGTK screenshot,
  not by a test: Settings' keymap picker rendered at y≈1130 in an 800px window,
  and since the shell is a fixed frame nothing could scroll it into view. Take
  the screenshot.
- **A capture-phase `scroll` listener sees the LIST's own scroll.** The
  active-into-view effect scrolls it on every open, so an unguarded close-on-
  scroll shuts a long option list the instant it appears; the listener skips
  events originating inside the control. Pinned in both directions.
- **Option rows are a list-row surface**, so they carry
  `calc(24px + var(--row-step))` — see the UI-density rule.
- **Driving it in tests**: `pgPickOption` / `pgSelectValues` / `pgSelectTrigger`
  from `@/test/select` (component), `jsPickOption` (e2e). Both select on the same
  attributes — `[data-pg-select-trigger]`, `[data-pg-listbox]`,
  `[data-pg-option][data-value]` — so a change to one has to move the other.
  `userEvent.selectOptions`, `fireEvent.change` and WebDriver's
  `selectByAttribute` are all inapplicable: there is no `<option>` and no
  `change` event.
- **Still open from the same audit, deliberately NOT done here**: the 156 `title`
  attributes (GTK draws each as its own popup surface), `<input type="date">` ×2
  on History, `<input type="color">` per palette swatch in Settings, and
  `tauri-plugin-dialog`'s in-process GTK3 folder picker. Each is its own change
  with its own trade-off; see issue 146's audit comment.

## Resizable panes (#162)

- **A pane has no fixed maximum. It has a sibling with a floor.** Every
  `usePaneSize` call site declares `min` for itself and `siblingMin` for what is
  left over, and the cap is derived: `container - siblingMin - reserve - handle`
  (`design/paneSize.ts`, pure + tested). The old hard-coded maxima (520…800px)
  were arbitrary on a large display and still did not prevent the failure they
  existed for — `PGResizeHandle` sits BETWEEN the panes and every flexible
  sibling is `flex: 1; minWidth: 0`, so a sibling squeezed to zero puts the handle
  at the container edge and the drag cannot be reversed. Raising a constant moves
  that cliff; a sibling floor removes it.
- **The hook names its AXIS, because it sizes heights too** (History's bottom
  detail panel, Compare's commit lists). It reads `container[axis]` from a
  `useElementSize` result, so one measured container can serve two panes on two
  axes — which is why it is `usePaneSize`, not `usePaneWidth`, and why a call site
  that reads `.width` for a height is now impossible rather than merely ugly.
- **Preference and effective size are two values, and that is the whole safety
  argument.** The persisted number is the user's PREFERENCE; the rendered size is
  that preference clamped, derived during render. So a container that changed is
  honoured on the next paint with no effect and no second pass (two panes in a
  three-pane layout cannot oscillate against each other's clamp), and opening a
  720px panel on a 1280px laptop narrows it WITHOUT overwriting what the external
  monitor earned. Nothing derived from a measurement is ever stored.
- **An unmeasured container (0) means "no constraint known", never "no space".**
  `container - siblingMin` is negative there, so clamping against it drives every
  pane to its minimum — and the persist path would then destroy the stored size.
  `paneMaxSize` returns `Infinity` until a real measurement lands; only the floor
  applies in the meantime. This is the trap the change lives or dies on, pinned in
  `paneSize.test.ts` and `resizable.test.tsx` (jsdom has no layout, so the default
  test environment IS the unmeasured case — see `src/test/elementSize.ts`).
- **A three-pane container is asymmetric on purpose.** The pane declared first
  reserves the other fixed pane's MINIMUM; the second reserves the first's ACTUAL
  size. Both reserving actual sizes would be circular; both reserving minimums
  would let the two of them squeeze the flexible middle below its floor. The
  arithmetic that the middle still keeps exactly its floor is a test, not a
  comment (`paneSize.test.ts`'s three-pane invariant).
- **Double-clicking a handle resets that pane to its `initial`** — the standard
  editor gesture, and the recovery net for a persisted size that outlived its
  layout. Wire `onReset={pane.reset}` on every handle.
- E2E covers what jsdom cannot: that the measurement ARRIVES on a webview with no
  `ResizeObserver` (`e2e/specs/resizable-panes.e2e.ts`). The pane drag has its own
  helper, `jsDragHandle` — this is the one drag in the app that is mouse events on
  `document`, not the `features/dnd` pointer primitive, and the grab has to be its
  own driver round trip because the document listeners are registered by an effect
  the mousedown schedules.

## Dialogs
- **Never call `window.confirm` / `window.prompt`.** Use `pgConfirm` /
  `pgPrompt` from `@/design` (`design/dialog.tsx`) — promise-shaped, so
  `if (await pgConfirm(…))` replaces the native line directly. They match the
  native contract: dismissal → `false`/`null`, Escape and backdrop dismiss, and
  an empty prompt string stays distinct from `null`.
- `PGConfirmOptions` carries `body`, `danger`, and `requireText` (type-the-name
  gate) — use them for destructive ops instead of cramming everything into one
  sentence.
- `PGPromptOptions.multiline: <rows>` renders a textarea instead of an input
  (the squash message prompt); Enter then inserts a newline and ⌘/Ctrl+Enter
  submits. e2e's `stubNativeDialogs` fills it by picking the value setter off the
  matching prototype — HTMLInputElement's does nothing to a textarea.
- A `<PGDialogHost />` must be mounted in each window (`AppShell`, `MergeWindow`);
  with none mounted the calls resolve `false`/`null` rather than hanging.
- Component tests that render a screen in isolation need `WithDialogs` from
  `@/test/dialog`, or every confirmation silently reads as "cancelled".

## File lists
- Row glyph + tint come from `lib/fileIcon.ts` (`fileIconSpec(path)`) — one
  category glyph per file type, per-extension tint from the `--graph-*` tokens.
  Add a language by adding a map entry, not a new SVG.
- `buildStatusTree` and `buildStatusList` (`lib/tree.ts`) emit the **same row
  keys** (`"/" + full path`). That is what lets the tree⇄flat toggle
  (`lib/useTreeViewMode.ts`) work without per-mode branches in selection,
  staging, or context menus — keep it true.
- Tree keyboard behavior belongs to the owning screen via `usePaneList`, not to
  `PGFileTree`: a local `onKeyDown` plus the global dispatcher both answer
  ArrowDown and the selection moves twice.
- **`FileStatus.submodule` is the exact complement of `embedded`** (#93), and they
  are mutually exclusive by construction: `is_embedded_repo` already excludes a
  `.gitmodules`-declared submodule. A submodule leaf renders with the `submodule`
  glyph and gets `submoduleMenuItems`, because the ordinary file menu is a list of
  dead ends on a gitlink (no diff, no blame, no history) — but staging it stays
  legal, since an updated pointer is an ordinary commit.

## Drag and drop
- **Pointer events, never HTML5 drag-and-drop.** `features/dnd/dragController.ts`
  owns the gesture; there is no `dragstart`/`dataTransfer` path and sources
  actively `preventDefault` the native one. Reasons: WebDriver cannot synthesize
  an HTML5 drag session and jsdom has no `DataTransfer` (so an HTML5 gesture is
  untestable at both layers), an HTML5 drag hands the platform an unthemable drag
  image plus OS cursors, and `useRowReorder` was already pointer-based. Cost
  accepted: no dragging files out of / into the window.
- **A drag source is a CONTAINER, not a row.** Screens call `useDragSource` on the
  list wrapper and resolve the grabbed row from `data-path` / `data-sha` /
  `data-pg-ref` — attributes the rows already carry. So `PGChangeRow`,
  `PGFileTreeRow` and `PGCommitRow` take no drag props and gain no per-row
  closure. Do not "simplify" this into per-row hooks: `PGCommitRow` is memoized
  and History's list is windowed (#68 G9/G10), and per-row subscriptions
  re-render the visible slice on every pointer move.
- **A source's reach is its pane's subtree, and that is load-bearing.** The commit
  screen's two sources live inside `<PGPane id="commit.files">`, so a pointerdown
  on a diff row in `commit.diff` never starts a drag and cannot disturb
  `useDiffLineFocus`'s line cursor. Attaching a source higher up (the screen root,
  say) would silently put the diff pane in drag range.
- **Drop indication is a DOM attribute, not React state.** The controller writes
  `data-pg-drop-over` on the resolved element (`index.css` styles it) and keeps
  only `payload` + `overId` (the ZONE id) in the store. A zone that spans many
  rows uses `resolve(el, payload)` — the delegated mode — rather than one zone
  per row.
- **The drop TABLE is pure and tested** (`features/dnd/resolveDrop.ts`).
  `resolveStagingDrop` and `resolveGraphDrop` decide legality; screens only do
  DOM work and call existing `useRepoStore` actions. The graph table is
  deliberately asymmetric — merge only *into* HEAD, rebase only *HEAD* onto
  something, cherry-pick only onto HEAD — because those are the only ops the
  backend has, so no gesture can rewrite a branch you are not on or check one out
  as a side effect. A refused drop returns `rejected` with a reason (shown on the
  ghost, flashed on release), never silence.
- **Every drag has a keyboard equivalent.** Staging → Space (`list.toggle`) and
  the checkbox; rebase reorder → `rebase.moveStepUp/Down` (Mod+Shift+↑/↓) and the
  chevrons; graph merge/rebase/cherry-pick → the branch/commit context menus, the
  palette, and the Branches screen. A new gesture without one is not done.
- Escape cancels any drag, from one capture-phase listener in the controller.

