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
- **"Binary" is a LIE about a file we simply declined to read (#385).** The
  backend now caps EVERY diff path at `MAX_WORKDIR_BLOB` (it used to cap exactly
  one, and `diff`/`diff_commit`/`diff_commits` — the commit panel's own
  workhorses — inherited libgit2's 512 MB default). libgit2's answer to
  `max_size` is to flag the delta BINARY, so without a second signal a
  checked-in `bundle.min.js` reaches the surfaces indistinguishable from a PNG
  and reads as "Binary file — no textual diff.": untrue about a text file, and
  it hides the one fact that explains the pane. So the delta carries
  `oversized: { size, limit }` and `oversizedDiffNotice` (`lib/derive.ts`) turns
  it into the shared sentence — "File too large to diff" / "40 MB — over the
  5.0 MB limit, so it was not read."
  * **The LIMIT comes off the wire.** A frontend constant would be a second copy
    of a policy that lives in `libgit2.rs`, free to drift from the one that was
    actually applied. `test/diffOversized.test.ts` greps the four surfaces for
    the helper AND for a hardcoded ceiling, and counts the backend's `max_size`
    call sites — the bug was a policy split, not a rendering one.
  * **`isTextualDiff` excludes it too**, belt and braces: the backend only ever
    sets `oversized` on a delta libgit2 already called binary, so that arm
    cannot fire alone today. It is there so "we did not read this blob" can
    never come to mean "render its hunks".
- **The notice grows an ACTION, and no surface owns it (#396).** #385 left the
  sentence naming a limit with nothing to do about it, which is the shape that
  invites the question. `OversizedDiffAction`
  (`features/diff/OversizedDiffNotice.tsx`) is the one button, rendered by all
  four surfaces — through `PGEmpty`'s `action` slot for the three that use
  `ImageDiffOrEmpty`, and inside `CommitDiffPanel`'s `fallback` for the fourth.
  A pane that grew its own is how a file comes to behave differently depending
  on where you opened it, which is the rule `isTextualDiff`'s doc comment
  already states.
  * **The click records a WAIVER; the surface's ordinary fetch carries it.**
    `useDiffAnyway(resetKey)` (`features/diff/`) is just that state, and every
    diff fetch passes `raiseFor` — the backend answers with the whole diff and
    those paths read at the raised ceiling, so there is no second fetch shape
    and nothing to splice.
  * **A hook that fetched the waived path ITSELF does not work**, and this is
    the trap worth remembering. Every one of these surfaces re-runs its diff
    fetch on a status refresh — `CommitPanel`'s dependency list says so on
    purpose, `status` identity included — so a waived read that lived outside
    that fetch was replaced by the refusal seconds after it landed, with the
    user watching. `raiseFor` therefore belongs in the fetch effect's deps, and
    `e2e/specs/diff-oversized.e2e.ts` waits on the refusal STAYING gone.
  * **Per file, per view, never a setting.** The waivers are component state
    (store state for Compare, because the store owns `diffs`), dropped whenever
    `resetKey` changes — the selected path (plus side, in the commit panel: two
    sides of one file are two diffs), or the commit/target being shown. A
    remembered "always diff huge files" is a considered refusal turned into a
    footgun the user forgot they armed, and here it costs megabytes.
  * **A blob over even the RAISED ceiling stops offering the button** —
    `diffAnywayExhausted`, off the delta's own `oversized.raised`. Not off the
    waived-path list: a fresh fetch's refusal is the DEFAULT ceiling's while the
    path is still in that list, and keying on the list hid the button for the
    rest of the session.
  * **`CommitDiffPanel` is presentational, so its CALLER answers the click.**
    `onDiffAnyway` omitted means the notice renders with nothing under it, which
    is the right thing for a surface with nowhere to send the re-read — and
    `test/diffOversized.test.ts` checks that all three owners (CommitDiff,
    History, Compare) wire it, because a panel silently offering no button is
    the pre-#396 dead end again.
  * **A waived read can come back SHORTENED**, and `TruncatedDiffNotice` says
    so above the rows. Raising the ceiling gets the blob read; it does not make
    a million rows something a diff pane can lay out, so the backend caps the
    lines (`FileDiff.truncated { shown, total }`, counts off the wire like the
    limit). An unmentioned cap reads as a diff that simply ends — the silent
    wrong answer this whole area exists to avoid.
  * **Still worth doing when the cap starts to bite:** `windowVariable` walks
    `heights` from index 0 and reduces over it twice on every scroll event, so a
    capped 100k-row diff costs ~O(n) per event. A prefix sum over `heights`
    would make it O(log n) and would help every large diff, not just a waived
    one. Not done here: the cap already bounds a waived diff to what the app
    renders happily today, so this is a scroll-smoothness improvement rather
    than a precondition.
- **The complement of `isTextualDiff` is not automatically a dead end** (#224).
  When the binary is an IMAGE, all five diff surfaces render the shared
  `ImageDiffView` (`features/diff/`) — old beside new, each with pixel
  dimensions and byte size, plus the delta of both; an added or deleted file
  shows the one side that exists; the merge resolver's binary chooser gets the
  same pair above its two buttons, which is where it is worth the most.
  * **One component, and it owns the empty state too.** `fallback` is a PROP,
    because "is there anything to preview" is the question the component
    answers. A PDF, a font, an archive — every binary #224 left out of scope —
    keeps the exact sentence its surface printed before. A too-large blob, an
    unfetched LFS object and an SVG say something more specific instead: a
    silent nothing reads as a bug.
  * **Sides come from `diffImageSides`**, built from the same `SideSource` pair
    the surface already computes for `useDiffSyntax`, so the preview and the
    coloured text can never disagree about which revision they show. A fifth
    surface gets previews by passing the sides it already had. The merge chooser
    is the exception and names index STAGES 2/3 — neither side is in any tree
    while the merge is unresolved.
  * **Nothing is fetched speculatively.** `useImagePreviews` is inert without a
    path, and every surface mounts it only for the selected file. That is what
    lets the backend's ceiling be as generous as it is.
  * **Bytes arrive as base64 and go straight into a `data:` URL** — no decode on
    this side, and a preview makes no request of any kind (#226). Dimensions
    come from the `<img>`'s `naturalWidth/Height` on load, not from a decoder:
    the webview already knows, and until it fires there simply are no
    dimensions (never `0 × 0`). The backdrop is a checkerboard built from
    `--bg-1`/`--bg-2` so transparency reads in both themes (#236).
- **A textual diff with ZERO hunks is ordinary, and every surface says so.**
  Two everyday changes produce a `FileDiff` whose `hunks` is empty: an EMPTY
  ADDED file (a `.gitkeep` — git writes `new file mode` and no `@@` range), and
  a MODE-ONLY change (`chmod +x` — `old mode`/`new mode`, no range either).
  `diff_to_file_diffs` pushes one `FileDiff` per delta in the file callback, and
  a hunk is only ever opened from the line callback, so the entry arrives with
  `0 / 0` and nothing to lay out. Before this, `CommitDiffPanel` and the
  DiffViewer had no branch for it and rendered a blank pane — and
  `CommitDiffPanel` is what History, CommitDiff and Compare mount, i.e. the
  screen the app launches on. All four surfaces now print
  `PGEmpty icon="file" title="No diff"` / "File is tracked but no hunks were
  produced." for exactly this condition (RepoBrowser keeps its own "No diff
  available" — its gate is the wider "no diff AND no file content", not this
  one). The wording is shared on purpose: `isTextualDiff`'s doc comment is the
  rule, and a file that reads differently depending on which pane you opened it
  in is the bug.
  - **The same emptiness reaches the copy menu**, and `diffCopyMenuItems` gates
    "Copy file diff as text" on `hasCopyableDiffText(diff)` — the rule its own
    docstring already stated for the other two entries. Unguarded it put `""` on
    the clipboard and flashed "copied diff", which reads as a working feature.
    A binary diff has no file-content lines either, so one gate covers both.
    * **The gate is cheap and the TEXT is lazy**, and that split is the point.
      `fileDiffToText` walks every line of every hunk and allocates a string per
      line; the commit-diff paths set no `max_size`, so a checked-in minified
      blob arrives whole. Building the text to decide whether to SHOW an entry
      would hitch every right-click on exactly the diffs that are already the
      weak point — so `hasCopyableDiffText` (`lib/diffCopy.ts`, beside the
      builder so the two cannot drift) short-circuits at the first content line,
      and `fileDiffToText` runs in `onClick`.
    * **Not `hunks.length > 0`.** A hunk is created by the line callback that
      carries its `@@` header, and that header is itself a `HunkHeader` LINE
      which `isFileContent` drops — so a hunk holding nothing but its own header
      passes that test and would offer an entry copying a bare `@@` range with
      no code. The row model already filters the same way
      (`h.lines.filter(isFileContent)`), so a header-only hunk renders zero rows
      too: "has file content" is the predicate both sides mean.
  - **Follow-up: a mode-only change is legible as "no diff", not as what it is.**
    Saying "mode changed 100644 → 100755" needs `old_mode`/`new_mode` on
    `FileDiff` (`git/types.rs`), filled at BOTH construction sites
    (`libgit2.rs::diff_to_file_diffs` and `diff()`) off
    `delta.old_file().mode()`/`new_file().mode()`, then a TS field and a line in
    the shared empty state. Deliberately out of scope of the empty-state fix: it
    is a backend type change threaded through two diff builders, not a rendering
    branch, and the blank pane was the user-visible half.
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
- **Find in diff searches the ROW MODEL** (#241) — `lib/diffFind.ts` (pure) +
  `features/diff/useDiffFind.ts` (state, chords, scrolling) +
  `features/diff/DiffFindBar.tsx` (the bar). All four surfaces mount it;
  `test/diffFindSurfaces.test.ts` fails the build for a fifth that forgets to,
  exactly as `diffCopyMenu.test.ts` does for the copy menu. Same reason
  `diffCopy.ts` exists: the surfaces are windowed, so the webview's own find
  would search the mounted screenful and answer "no results" for a match two
  thousand lines down — a wrong answer, not a degraded one. Six rules:
  - **`Mod+F` is `diff.find`, pane-scoped and `suppressInInput`.** That flag IS
    the answer to "the find key must not be stolen from an input that wants it":
    the dispatcher never resolves a suppressed action inside a text field, so the
    commit-message box, the file filter and the bar's OWN input keep it. Escape
    is `diff.closeFind` — pane-scoped, `allowInInput` (the bar autofocuses its
    input), bound BEFORE the global `app.closeOverlay` in `presets.ts` and
    DECLINING when the bar is shut. Same ordering asymmetry as
    `diff.viewCombined` vs `nav.diff`, pinned in `presets.test.ts`. Enter /
    ⇧Enter are handled on the input itself: the caret is in it, bare-key chords
    are suppressed there anyway, and "Enter submits the box you are typing in" is
    the one chord a form owns rather than the app.
  - **Jumping to a match is `scrollTopForRow`** written through
    `useVariableWindow.scrollTo` — never `scrollIntoView` (the row is unmounted;
    #68 G10) and never `scrollTopForHunk`'s CENTRING, which would yank the pane
    on every Enter. Reveal semantics, the line cursor's, for the same reason.
  - **Highlighting is a THIRD range set in `buildLineSpans`**, not markup wrapped
    around matched text afterwards. The tiling keeps syntax classes and word-diff
    spans intact through a match, and the code cell's `.pg-selectable` split is
    untouched because the marks are spans INSIDE that cell — pinned by
    `src/design/diffFindHighlight.test.tsx`, which re-runs the selection walk.
    Paint derives from `--accent` rather than a new semantic token (those are
    duplicated per theme mode in `SEMANTIC_TOKENS` and drift); the CURRENT match
    flips the foreground to `--accent-ink`, the only thing that stays legible on
    an already-tinted add/rem line.
  - **A row with no match gets `undefined`, not `[]`** — `findMarksByRow` returns
    a Map for exactly that. `PGDiffRow` is memoized and the whole window
    re-renders per keystroke in the find box, so a fresh empty array per row
    would defeat the memo for the entire slice.
  - **Gated on `isTextualDiff`**, and additionally OFF in split mode (a different
    renderer, `PGSideBySideDiff`) and in the DiffViewer's WRAP mode — heights
    describe nothing there, and a wrap caller drops windowing, the minimap and
    offset scrolling together, so an offset-scrolling consumer drops with them
    (turning Wrap on closes an open bar rather than leaving one that scrolls
    wrong). The merge window is out of scope on purpose: CodeMirror, no `DiffRow`.
  - The match count is capped at `MAX_FIND_MATCHES` and reported as a floor
    ("5000+"). Scanning a whole-file diff per keystroke is cheap; allocating
    half a million match objects is not.
- **The DiffViewer's old "Find in diff" was a line FILTER**, not a find: it
  rewrote the hunks down to matching lines, which forced whole-file mode off,
  made "copy the file" mean "copy the matches", and could not say WHERE in the
  file a match was. #241 replaced it with the shared bar above. Don't bring it
  back as a second control on that screen.
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
- **Two cursors, ONE position (#297).** They are separate index spaces, not
  separate places the reader is. Every landing `useHunkNav` makes is reported
  through `onLand`, and the surface answers it with
  `lineFocus.focusRow(extents[h].first)` — the anchor row, which always carries a
  `changedIndex`, so `Space` is live on arrival. `follows` closes the loop the
  other way, so F7 means "the next change after where I am" rather than "after
  where I last pressed F7". Three rules hold this together and each one was a bug
  first:
  - `follows` is an **edge, not a level** — it reacts to the caret MOVING. Read
    as a level, any render where the caret has not caught up undoes the jump (F7
    sets 3, the effect sees a caret still on 2), and where the caret cannot move
    at all — ignore-whitespace leaves no targets — it pins F7 to one hunk forever.
  - `onLand` fires **after** the reveal. F7 CENTRES and the caret REVEALS, and a
    reveal is the intended no-op only once the centring has put the row on screen.
  - A clamped press reports **nothing**. Landing on a cursor that did not move
    would drag the caret back to the anchor of the hunk the reader is inside.
  - All four surfaces mount the caret and both couplings; `test/diffCaretSurfaces.test.ts`
    fails the build for a fifth that does not. Read-only surfaces (`DiffViewer`,
    `CommitDiffPanel`, `RepoBrowser`) pass no `onToggle`, so `Space` stays
    unclaimed there.
- **Code is selectable wherever it is SHOWN, not just in a diff.** The app is
  `user-select: none` (`index.css`) and each code cell opts back in with
  `.pg-selectable` — the code, never the gutters. Blame rendered its source bare
  and so could not be selected or copied at all, invisibly, because the three
  rendering guards enumerate diff surfaces only. `test/codeSelectable.test.ts` is
  the list that includes it.
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
  - **The hint appears at the caret, and dies with the crossing (#297).**
    `pgFlash` takes an optional anchor; `useHunkNav` passes the caret's row
    (`[data-focused]`, then `[data-hunk-active]`, then null → the centred toast,
    because a hint is worth more mispositioned than missing). The press that
    crosses calls `pgFlashClear()`: the hint is a question, and left up it spends
    its remaining 1.4s under the file it moved TO, announcing "no more changes"
    from on top of that file's first one. It is deliberately NOT dismissed on
    scroll — the arming expires on a timer, so an early dismissal would leave a
    live arming with nothing on screen to explain it.
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
- **The way OUT of our diff is one helper** (#235):
  `design/context-menu.tsx::externalDiffItem(target, paths)`, in `fileMenuItems`
  (Commit panel, repo browser) and on `CommitDiffPanel`'s file rows (commit
  diff, History inline, Compare, both stash diffs). One definition because the
  entry has to say the same thing everywhere — a user who finds it on a
  working-tree row and not on a commit's file has found a bug, not a
  distinction. Three things about it:
  - **`CommitDiffPanel` takes an explicit `difftoolTarget`, never one derived
    from `syntaxSides`.** The two describe the same comparison, but `syntaxSides`
    is allowed to be approximate — History passes `{ rev: "<oid>^" }`, which
    fails harmlessly on a root commit — and `<oid>^` handed to `git difftool`
    either errors or, in its `^!` spelling, diffs against the WORKING TREE. A
    surface showing one commit passes `{ kind: "commit" }` and the backend
    resolves the parent.
  - **A rename passes BOTH paths.** `[oldPath, newPath]`, so git pairs them
    instead of reporting the file as wholly added.
  - **Not in the multi-file menu**, and **disabled on a purely untracked row.**
    Forty files is forty windows; and an untracked path is in neither side of
    any diff git computes, so the click would do nothing at all. Staging it makes
    it work via the `staged` target — hence `untracked && !staged`.
  The store action (`useRepoStore.openInDifftool`) holds a `difftool`
  `RepoActivity` entry for the whole time the tool is open — it resolves when the
  TOOL exits, which is minutes — and `refreshAll()`s afterwards, because a
  working-tree side is handed to the tool as the REAL file, not a copy.

## The committer identity (#212)

`src/features/commits/identity/` is **THE** identity surface: `IdentityForm`
(the fields plus the save) and `NoSignaturePrompt` (the same form, framed as an
answer to a refused commit). `screens/Settings.tsx`'s `IdentitySection` and
`screens/CommitPanel.tsx` both render it; a third place to type a name and an
email joins this one rather than growing beside it.

- **`NoSignature` is a form, not a banner.** It lands in `useRepoStore`'s
  per-repo `noSignature` field, exactly the split `hookRejection` makes, and for
  the same reason: an error is something you acknowledge, and this is something
  you answer. Saving RETRIES the commit — the user already typed a message and
  pressed Commit, and making them press it again is a second failure with extra
  steps.
- **It is the first thing a brand-new user hits**, because git refuses to record
  a commit until `user.name` and `user.email` are set — and before #212 that
  refusal reached them as a banner reading the literal string `NoSignature`,
  with nowhere in the app to set an identity. `test/appErrors.test.ts` now fails
  the build for any unit variant that could do the same thing again.
- **The write is GLOBAL, and the form says so on screen** (`identity-target`
  names the file). `set_identity` is the only place the app writes the user's own
  git config, so it is deliberately explicit rather than something a commit does
  for you. Per-repository identities and multiple accounts are #233 — that lands
  as a scope control on this form, not a second one.
- **A repo-local override is called out** (`identity-scope-note`). Saving writes
  the global config, so a repository that sets its own `user.email` would
  otherwise leave the user watching a successful save change nothing.
- **The fields seed from `get_identity` ONCE per mount.** Re-seeding on every
  read would wipe what is being typed the moment anything refreshed.
- **Blankness is checked in the UI; every other rule is the backend's.**
  `validate_identity` (Rust) is the single authority on what git accepts, and its
  refusal names the offending character — so the button gates on "both fields
  non-empty" and nothing more.

## Named identities (#233)

`features/commits/identity/identityList.ts` + `SavedIdentities.tsx`: a small set
of saved `{label, name, email}` entries, and a one-click "Use here" that applies
one to the open repository.

**There is deliberately no `repoId → identityId` map.** git already stores which
identity a repository uses — `user.name`/`user.email` in that repository's own
config, where the CLI, every hook and every other git tool read it. A second
store of the same fact drifts the moment anyone runs `git config` in a terminal,
and then the app confidently names an identity the next commit will not use.

So the saved list is a **palette, not an assignment**. Applying an entry writes
the repository's local config (through the same scoped `setIdentity` from #233's
first half), and "which one is active here" is answered by reading git config
back and matching on the name/email pair — never on the label, so a repository
configured by hand still lights up the entry it corresponds to. The email
compares case-insensitively, because addresses are.

The consequence worth knowing, and the UI says it: **editing or removing an entry
does not change any repository already using it.** Deleting a bookmark does not
move the page.

Applying always writes the REPOSITORY scope, never global — that is the feature
(work address on work repositories), and it is the safe direction: a mis-click
changes one repository rather than every repository on the machine. The global
identity stays `IdentityForm`'s job, where the scope control makes it explicit.

`identities` is in `NON_PORTABLE_KEYS`. A settings export is a file people share,
and every other key in the bag describes how the app should behave; this one is a
list of someone's email addresses, and it is useless on the receiving machine
anyway.

**Signing keys are not attached yet.** #233 lists one as optional and it is the
right shape, but `signCommits` is a global tri-state (#61 D6) and the signing
chain resolves its key from git config — a field nothing reads would be dead
weight that later needs migrating.

## Forge accounts are host → MANY (#233)

The identity half above is about git's `user.name`/`user.email`. The forge side
had its own one-account-per-host constraint: `pg-forge-hosts` persisted
`logins: Record<string, string>`, host → login, **singular**, so two GitHub
accounts were not expressible at all.

`features/forge/forgeAccounts.ts` is the pure module that replaced it:
`accounts: Record<string, ForgeAccount[]>` with `ForgeAccount = {id, login,
active}`.

- **`id` is a credential-SLOT name, not the login.** It is what the backend
  appends to `username=` (`platypusgit-forge:<id>`), which is what lets one host
  hold two tokens. A login is the wrong key: a forge login can be renamed while
  the token stays valid, and the entry would then be orphaned.
- **`id: null` is the pre-#233 slot**, the bare `platypusgit-forge` username a
  released build already wrote real tokens under. `parseHosts` migrates the old
  `logins` map onto `id: null` and nothing else — any other id points at a slot
  that has never held anything, and a user who never signed out would come back
  signed out. Nothing ever mints `null`; it only arrives from migration.
  `activeAccountId` also answers `null` for a host with NO accounts, which is
  the same slot: cleared localStorage with the keychain intact still finds its
  token.
- **The active account is a flag on the row, not a `host → id` pointer.** A
  pointer can dangle (naming a removed account) and is ambiguous (`null` meaning
  both "the legacy slot" and "nothing recorded"). `parseHosts` normalises "none
  flagged" and "two flagged" to exactly one, so every host with accounts has an
  active one by construction.
- **Every token-using call names the slot** — `forgeTokenStatus`,
  `forgeValidateToken`, `forgeListPullRequests`, `forgePullRequestChecks`,
  `forgeCreatePullRequest`, `forgeSignIn`, `forgeSignOut`. Signing out, and an
  empty-slot `refreshTokenStatus`, remove ONE account and promote a survivor;
  they must never evict the other account on the same host.
- `signIn` always mints a fresh slot, because the login is the forge's answer
  and is not known before validating. If the login turns out to already have a
  row (re-authenticating an expired token), `upsertAccount` collapses onto it
  and the displaced slot's dead token is erased best-effort.

`ForgeSettings` renders one row per account plus one add row — the token field
hides behind an explicit "Add account" once a host has one, because a password
box sitting permanently open under every signed-in host is noise.

**A saved identity does not reference a forge account yet.** It is the natural
follow-on the issue names, and the map had to become host → many first.

## The commit-message composer (#252)

`src/features/commits/message/` is **THE** commit-message composition surface —
one hook plus one bar, used by `screens/CommitPanel.tsx`:

```
const composer = useCommitComposer({ repoId, branch, ticketPattern, message, setMessage, amend });
<CommitMessageBar composer={composer} extra={…} />
```

- **A new way to compose commit-message text joins this surface** — a field on
  `CommitComposer` and an affordance in the bar's `extra` slot — rather than
  becoming a fifth widget in `CommitPanel.tsx` or a parallel surface beside it.
  #250 (assisted drafts) is the one queued behind #252, and the two must not
  grow side by side.
- **The textarea is the single source of truth.** The type picker PARSES the
  subject on every render and rewrites it on change; nothing keeps a structured
  draft on the side. Typing `feat: x` by hand selects `feat` in the picker,
  clearing the picker hands the typed text back. Free typing has to keep
  working — the issue is explicit that a mandatory form would be worse than
  nothing, so there is deliberately no subject/body split, no `BREAKING CHANGE`
  toggle and no modal.
- **Nothing overwrites text the user typed.** `commit.template` pre-fills only
  an EMPTY box, and never while amending (amend's prefill from HEAD wins). The
  template goes back in after a commit, because `git commit` re-applies it every
  time — `reseed()`, which the screen calls having just cleared the box.
- **`cleanupCommitMessage` is git's `strbuf_stripspace` — in the mode git would
  use** (`cleanup.ts`). git's `default` cleanup is context-sensitive: `strip` if
  the message is to be EDITED, `whitespace` otherwise. `git commit -m "#123 fix
  the thing"` commits `#123 fix the thing`, and **so must we** — that is an
  ordinary subject and a forge renders it as an issue link.
  - **`fromTemplate` is the stand-in for "is the message to be edited".** It is
    true only once `commit.template` has seeded the box, which is the one way
    `#` lines arrive without the user typing them. It drives both halves of
    git's context-sensitivity: what `default` means, and whether `scissors`
    cuts (verified: `--cleanup=scissors -m …` does not cut).
  - The **whitespace half is unconditional** (every mode but `verbatim`):
    trailing whitespace, blank-run collapsing, leading/trailing blanks.
  - An explicit **`commit.cleanup`** (`verbatim`/`whitespace`/`strip`/
    `scissors`/`default`) overrides the context in both directions. Unknown
    values degrade to `default`.
  - A comment is a line whose FIRST character begins the prefix — `  # indented`
    is committed, and so is `refs #12`. The prefix comes from the backend
    (`core.commentChar`, `auto` resolved), never assumed to be `#`.
  - It decides what is sent AND whether Commit is enabled: a **template** whose
    comment lines are all that survive is an EMPTY commit message. A hand-typed
    `#123 fix` is not, and stays committable.
  - The one deviation from git: no trailing newline, in any mode, because the
    backend stores the message verbatim and `buildMessage` trims the end
    regardless.
  - **The gate asks the SEND path's question, not a similar one.** `canCommit`
    keys on `buildMessage(composer.cleaned, trailers)` — one memo, the same
    value that is sent — because "cleaned is non-empty" and "what we send is
    non-empty" are not the same question: under `commit.cleanup=verbatim`
    nothing is stripped, so a box of spaces survived cleanup and then trimmed to
    `""` on the way out, and Commit lit up for a message the backend received as
    empty (#387). The fix is deliberately NOT a `trim()` in `canCommit` — that
    is a second cleanup policy, and the two would drift. `buildMessage` returns
    `""` rather than a lone trailer block for the same reason: a co-author is an
    addition to a message, never a substitute for one. The backend refuses an
    empty message too (`docs/dev/backend.md`, the hook chain) — this gate is the
    convenience, not the guarantee.
  - Pinned by 134 differential cases against real `git commit` (all five modes,
    `-m` and a scripted editor) — re-run that comparison before changing
    anything here rather than reasoning from the docs.
- **The length readout is advisory and stays advisory** — amber past 50, red
  past 72, `canCommit` untouched.
- Composes with what was already there: sign-off, co-author / author-override
  and recent-message recall all still read and write the same box.

## The filesystem watcher's refresh policy (#239)

The backend decides WHETHER an event is interesting (`watcher.rs`, and the
architecture doc's entry for it); the frontend decides **how much to refresh**,
in `features/repo/fsWatchPlan.ts`. It is pure and separate from the
subscription because the four ways it can be wrong are all real bugs:

- **Another repository's event.** `useRepoStore` holds exactly ONE repository's
  state — the active tab's — so applying another tab's event writes its status
  over the open one. The backend watches only the active repo, but an event can
  already be in flight when the tab switches, which is exactly why the payload
  carries `repoId`. Both halves of the guard are needed; they fail differently.
- **An operation in flight.** A rebase or a merge writes to `.git/` in a storm,
  and a refresh landing mid-transition can read a half-applied state. The plan
  returns `none` whenever `RepoActivity` is non-empty. Skipping loses nothing:
  every operation refreshes on completion anyway, so only the flicker of
  intermediate states is dropped.
- **A file save repainting history.** `refsMoved` is the whole reason the
  backend classifies instead of just saying "something changed": a status
  refresh is cheap and a log refresh is not.
- **An event after the setting is off.** Otherwise "off" is off with
  exceptions.

`useFsWatch` mounts two effects with deliberately different lifetimes: the
`fs://changed` **subscription** is app-global and mounted once (like
`net://progress` — re-subscribing per repository opens a window on every tab
switch where events are silently dropped), while the **watch** follows the
active repository and the setting. `watch_repo` is a swap on the backend, so a
tab switch needs no matching stop, and `watch_stop` is idempotent so the caller
never has to track whether one was running.

Refreshes coalesce rather than queue: a burst produces at most one more refresh
after the current one, and `mergeRefresh` keeps a queued `status` from
downgrading a pending `all`.

A background refresh passes **`preserveError`**, and that is load-bearing. A
failed `--ff-only` pull sets `error` — but the *fetch* half of that same pull
already moved `refs/remotes/…`, so the watcher's debounced event lands a few
hundred milliseconds later, **after** the operation cleared `activity` and
therefore past the busy guard. `refreshAll` opens with `set({ error: null })`,
so without `preserveError` it wipes the banner and the user sees a pull that
silently did nothing — the worst possible reading of a failure. `settings.e2e.ts`
caught this on CI. A refresh nobody asked for must not clear a message nobody
has read.

The watcher's refresh deliberately does **not** join `RepoActivity`. That is
for operations the user started and can cancel; this is background upkeep, and
a status line that flickered on every keystroke in someone's editor would be
noise. It *reads* `RepoActivity` instead, to know when to stay out of the way.

## Undo the last operation (#242)

`features/repo/undoStack.ts` is the whole model, and it is deliberately small:
an entry is a **before/after pair of HEAD snapshots** plus what produced them.
Undo moves HEAD from `after` back to `before`; redo moves it forward. It does
not replay operations backwards, it moves a ref — git keeps the old commits
reachable through the reflog, so undoing a commit costs and loses nothing.

`undoStack` + `undoCursor` live in `RepoSlice`, so the stack is per repository
and a tab switch cannot carry it. Session-scoped rather than persisted on
purpose: an entry is only meaningful while the recorded HEAD is still where the
operation left it, so a stack restored from disk would mostly be entries that
refuse. The reflog is the durable answer, and the refusals say so.

**What pushes an entry:** the operations that move HEAD — commit (including
amend), checkout, merge, cherry-pick, revert, reset. `noteUndo` is called after
the op's own `refreshAll()`, and is guarded on the repository the way
`setErrorFor` is, so an op resolving after a tab switch writes nothing.
`pushUndo` drops an entry whose before and after are identical, so a checkout
of the branch you are already on records nothing rather than an entry ⌘Z would
appear to apply and then not.

**What does not, and why the absence is the safe failure:** a push (the remote
has it, and rewriting someone else's history is not an undo), a dropped stash,
branch create/delete/rename (they move a ref that is not HEAD and need their own
inverse), and rebase (its own engine, its own retained summary; folding it in
without thinking through an interrupted plan would be an undo that lies).
Anything absent simply records nothing, so ⌘Z undoes the last thing that *is*
undoable.

**Preconditions are re-read from the backend at undo time**, never from cached
state: `head_info` plus a fresh status. The paged log can never answer "is HEAD
still where I left it". On a mismatch it refuses and changes nothing, with a
message that names the operation and points at the reflog.

A refusal is **not** an `AppError`. Nothing was attempted, the TS union stays
1:1 with the Rust enum, and there is no variant for a frontend-only condition —
so it is a `pgFlash`, the way `ops.ts` already refuses "no upstream".

**The confirmation lives in `ops.ts`, not the store**, matching
`deleteUntracked`: the store is also the layer a keyboard shortcut reaches, so
it performs and does not ask. The store then re-checks preconditions *after*
the dialog is answered, because the world can move while it is open.

`undoOp`/`redoOp` answer **synchronously** and return `false` when the stack is
empty — that is what keeps `Mod+Z` from being stolen from every text field in
the app; the chord falls through and still undoes typing.

## Markdown in commit bodies (#253)

`features/commits/body/` renders the commit **body** — never the subject, which
is one line and is not markdown — as a restrained subset, with a raw/rendered
toggle (`commitBodyMarkdown`, a persisted preference).

**Why a parser of our own rather than a dependency.** The issue's two hard
constraints are *no remote content of any kind* and *a raw toggle*, and it asks
for a bundle-size and sanitisation review of any markdown dependency. That
review does not end well for the general-purpose libraries: they exist to render
arbitrary documents, which means HTML passthrough, images, and a sanitiser you
must keep configured correctly forever. `markdown.ts` parses the subset into a
**typed AST**, and `CommitBody.tsx` turns AST nodes into React elements — so
there is no HTML string anywhere in the path, and the whole
`dangerouslySetInnerHTML` class of bug is gone by construction rather than by
vigilance.

**Deliberately not in the subset:**

- **Headings.** `#` at the start of a line in a commit body is far more likely
  to be an issue reference than an ATX heading.
- **Images.** Nothing may fetch. `![alt](url)` parses to a LINK labelled with
  its alt text — the useful non-fetching reading — and there is no image node in
  the AST for a renderer to grow one from.
- **Raw HTML**, tables, footnotes.

**Links** are restricted to `http`, `https` and `mailto` by an allow-list
(`isSafeHref`); anything else keeps its words and loses its destination. They
open through `openUrl`, never by navigating — a plain navigation in a webview
replaces the app.

**`#123` is a styled token, not a link.** Linking it means guessing which forge
and which repository the number belongs to, and there is no helper in the tree
that resolves a remote to a web URL. A link to the wrong issue is worse than no
link; building that resolver is the follow-up that unlocks it.

Paragraphs are **joined across hard-wrapped lines** (commit bodies wrap at 72
columns, and one visual line per physical line is the "reads badly" the issue is
about), with markdown's two-trailing-spaces hard break honoured. The raw view is
the original text, not a re-serialisation of the parse — that is the one
guarantee it exists to give.

`PGCommitDetail` stays presentational: it gained a `bodyContent` slot rather than
importing the renderer, because the renderer reads a setting and opens URLs and
therefore belongs in `features/`, not `design/`.

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

## How a commit date is written (#354)

- **`lib/commitDate.ts` is the ONE place a timestamp becomes text.** History
  rows and detail, Reflog, Compare and the repository browser all read from it,
  so the same instant cannot be described three ways. `relativeTime` in
  `lib/derive.ts` stays where it is — it is one of the forms composed here, not
  a surface of its own. A new date surface calls `commitDateText` +
  `commitDateTitle`; it does not grow its own template. The one deliberate
  exception is History's "copy visible commits" export, which writes
  `toISOString()` on purpose — that text is machine-readable output, not a
  reading surface, and must not follow a UI preference.
- **The `dateFormat` preference picks the text AND the column width.** The Date
  column is fixed-width monospace, and `2026-08-14 13:42` does not fit the 90px
  `3w ago` needs, so `DATE_COL_W` (in `design/graph-geometry.ts`) sizes the
  column per format. `PGCommitRow` and History's column header both read it
  through `useDateColumnWidth()` and hand the SAME number to `commitRowGrid` —
  reading it in one and threading a prop through the other is what would let the
  header drift off the rows under it. `relative` is 90px, the pre-#354 width, so
  a default install is pixel-identical to what it was.
- **The hover title is mode-independent, and it is on the CELL.** Every mode
  hangs the full stamp (`fullTimestamp` — seconds and the zone offset) off the
  date cell, so the exact time is always one hover away and picking "Relative"
  never means the exact time is unreachable. A row-wide `title` would follow the
  pointer across the message and sha columns and shadow the titles those use for
  their own truncated text.
- **Commit details shows a stamp unconditionally** — not the column format. It
  has the room, and "see the date on a commit" was half of what #354 asked for;
  gating it behind a non-default preference would answer only half. Inline it is
  `preciseTime` (seconds, no zone) beside the relative form; the zone is what
  the hover adds, so the title is never a copy of the line under it.
- **Local time, and it says so.** `CommitInfo` carries unix seconds only — the
  author's own UTC offset is not on the wire — so every stamp renders in the
  reader's zone and `fullTimestamp` names that zone, which is what makes a
  timestamp copied out of a tooltip comparable with one from a terminal.
  Matching `git log`'s author-timezone display needs a backend change first
  (`CommitInfo` in Rust and TS, plus `libgit2.rs`).
- An unknown persisted format normalizes to `relative` in the store's `load()`,
  for the density reason one column over: `undefined` reaching the grid resolves
  every `Npx` template to `auto` and collapses the column on every row at once.

## `git notes` in the commit detail panel (#253)

- **Notes hang off the SELECTED commit, never the log page.** `CommitNotes`
  lives inside the message scroll region (a long note scrolls with the body
  rather than pushing the action row out of the panel) and reads debounced, like
  `SignatureBadge` — the log walk is the hot path, and rows arrowed past cost
  nothing.
- **No note renders `null`, and so does a failed read.** Most commits in most
  repositories have no notes, so an "empty" affordance would be permanent
  furniture; a banner beside a perfectly viewable commit is noise.
- Each note is badged with its ref, because a note on `refs/notes/review` and
  one on `refs/notes/commits` are different claims about the commit.

## Blame and `blame.ignoreRevsFile` (#253)

- **The ignore-revs toggle exists only where an ignore-revs file does.**
  `BlameResult.ignoreRevsFile === null` means the repository configured none, so
  there is no control to show — the backend's answer, not a guess from the
  frontend. `PGToggle`, not a native control.
- **The toggle is NOT persisted, deliberately.** git's own behaviour (honour the
  config) is the right default every time a file is opened; a remembered "off"
  would silently contradict the repository's `.git-blame-ignore-revs` in some
  later session with nothing on screen explaining why the formatter owns every
  line. It is view state in the screen, so it also stays out of
  `PersistedState` and out of the settings export key set.
- **git's `?` / `*` marks are rendered only when the repo asked for them**
  (`blame.markIgnoredLines` / `blame.markUnblamableLines`). git only marks when
  asked; a mark nobody configured reads as a defect in the line.
- An unusable ignore-revs file is a WARNING strip above a working blame, never
  an error screen — the backend already degraded to a plain blame.

## Saying a clone is only partly here (#255)

A shallow clone does not fail. History has fewer rows, Blame attributes
everything older than the boundary to the boundary commit, File history ends
early, and Compare's ahead/behind is arithmetic over a graph missing its merge
base. Each of those reads as a repository with a strange past rather than one
that is only partly here — which is the whole reason the notice exists.

- **One component, four surfaces, one strip each.** `ShallowNotice`
  (`features/repo/`) is the shape Blame's ignore-revs warning already
  established: a strip UNDER the screen's header that says something about the
  data below it without replacing it. Never a modal, never an empty state — the
  screen still works. History, FileHistory, Blame and Compare mount it;
  `test/shallowSurfaces.test.ts` fails the build for a fifth that forgets, the
  same guard shape `diffFindSurfaces.test.ts` uses.
- **The sentence is per surface, from a pure `shallowNoticeText`.** "This is a
  shallow clone" on a blame screen does not tell the reader what is wrong with
  the blame in front of them. The `surface` prop is therefore as load-bearing as
  the mount, and the guard test checks both.
- **At the TOP of the screen, not at the end of the list** — even on History,
  where the truncation literally is the end of the list. A reader with five
  hundred commits loaded never scrolls there, and the fact belongs to the
  repository rather than to the scroll position.
- **Shallow outranks single-branch when a clone is both.** Two stacked strips is
  how a warning stops being read; the truncated history is the bigger distortion
  and the one with a button. A single-branch clone that is otherwise complete
  gets the sentence and **no** Unshallow button: `--unshallow` fetches history,
  not branches, and a button that runs and changes nothing the reader complained
  about is worse than none.
- **`shallowInfo` is a `RepoSlice` field read by `refreshAll`**, the eleventh
  `trackLoad`ed read. Per-repo, or a shallow clone in one tab would put a
  truncation strip on another tab's blame. Re-read every refresh rather than
  once on open, because the notice has to come **down** when the history
  arrives — after an unshallow here, a fetch, or a `git fetch --unshallow` in a
  terminal. It degrades to `DEFAULT_SHALLOW_INFO` on a failed read, like its
  neighbours: a repository whose depth cannot be read must still show its log.
- **`unshallow` files itself under the `fetch` activity key**, because it is a
  fetch — which is also how it inherits the status line, the progress bar and
  the Cancel button (`isCancellable` already lists that key), and how the strip
  knows to disable its own button while one is running.
- **The Clone dialog's Advanced section is disclosure only.** The values under
  it are live whether it is open or shut, so collapsing it never silently
  changes what Clone would do. `shallow` and `depth` are two pieces of state on
  purpose: the checkbox is the decision and the number is a detail of it, so
  unticking must not lose a typed number and a number left in the box must not
  truncate the clone. A depth that is not a positive whole number disables
  Clone rather than being rounded into one. Everything, the disclosure
  included, resets on a closed→open transition — a `--depth 1` chosen for one
  enormous repository must not quietly truncate the next.

## Branch pins (#238)

- **A pin is a TIER in `orderBranches`, and it outranks the default branch.**
  #135's default-branch pin is the app guessing what belongs on top; a user pin
  is an instruction, and an instruction that loses to a guess is not a pin. With
  no pins the order is exactly #135's, which is why its tests are untouched.
- **Pins are HOISTED OUT of the folder tree, not sorted to the front of it.**
  Grouping runs after ordering and only moves rows into folders, so a pinned
  `feat/foo` would otherwise be the first row INSIDE `feat` — invisible whenever
  that folder is collapsed, which is the case pinning exists for. Hoisted rows
  render at depth 0 under their FULL names and are removed from the tree rather
  than duplicated into it. This is also why the tier has to outrank the default:
  otherwise the comparator and this screen would disagree about one list.
- **The pin set is a STORE, not the folds' React hook** (`useBranchPins`,
  `pg-branch-pins-v1`, keyed by repository path, entry pruned when empty). Two
  of the four surfaces that order branches are not components —
  `design/context-menu.tsx` and `features/palette/commands.ts` reach state
  through `getState()` — and a hook cannot serve them. `usePinSet` is the React
  side; it subscribes to the stored ARRAY so the memoized `Set` is rebuilt only
  when a pin actually changes.
- **A pin matches the branch name exactly.** Pinning `feat/foo` does not pin
  `origin/feat/foo`: two rows, two sections, and the user pinned one of them.

## Branch folders (#244)

- **Filter, then order, then group — in that order.** `orderBranches` (#135) is
  still THE branch ordering; `features/branches/branchTree.ts` only moves the
  ordered rows into folders, so the pinned default branch stays the first row on
  the screen and the newest-first order holds inside every folder. A folder
  ranks where its first (freshest) branch was. Grouping never sorts. Since #238
  the hoisted pins sit above that whole tree, and are the one thing removed from
  it before grouping runs.
- **A prefix that groups nothing is not a folder.** Single-child chains compress
  (`feat/foo/bar` alone is ONE row reading `feat/foo/bar`, not three), the same
  rule `lib/tree.ts::compactNode` applies to file paths. So a folder row always
  holds at least two things, and `branchFolderPaths` names the compressed paths
  — the ones "collapse all" must write, not one per segment.
- **The output is FLAT: rows carrying their own `depth`.** The Branches screen
  keeps its grid, its `usePaneList` index and its selection model unchanged; a
  nested render would have needed all three rewritten. Indentation lives in the
  NAME cell only, so TIP / UPSTREAM / STATUS stay on the grid at any depth.
- **A leaf row's `path` is always the branch's full name** — selection, context
  menus and the inspector key off it. That is why a name with an empty segment
  (`a//b`, which git rejects anyway) is left whole rather than split.
- **A filter flattens the tree to its matches, showing full names.** Hiding a
  hit behind a folded folder is the one thing a search box must never do, and a
  bare `bar` with no `feat/foo` above it names nothing.
- **Fold state is the EXCEPTIONS, per repository, outside the store.**
  `useBranchFolders` persists the set of COLLAPSED paths in localStorage keyed by
  repository path (`pg-branch-folders-v1`), pruning a repository's entry once it
  is empty. Not in `useRepoStore`: that holds one repository's live git state and
  every field must join `RepoSlice`, whereas this has to outlive the tab. It is
  re-read on every repository change, or one tab's folds would be written back
  under another tab's path.
- **Folding the folder the selection sits in moves the selection onto it.**
  Otherwise `flatIndex` goes to -1 and the next ArrowDown restarts at the top.
  ← on a folder folds it and on anything else climbs to `parentFolderPath`.
- **"Delete merged branches in this folder" means `git branch --merged`** —
  contained in HEAD — and the confirm says so. Never a remote (that would be a
  push), never HEAD, never the default branch even when it lives in a folder.
  The merge check is one `ahead_behind` per candidate, run on demand and
  sequentially (the backend serializes per-repository work), never per render; a
  branch it cannot ask about is reported unmerged, the safe direction. The
  confirm names every branch in a scrolling list — "8 branches" is not something
  anyone can check before clicking Delete.
- **Drag and drop is deliberately NOT wired to folder rows yet.** When it is, a
  branch dragged onto or out of a folder resolves through `resolveDrop.ts` like
  every other drop, with a keyboard equivalent — see the drag-and-drop rules
  below.

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

## Settings is a registry, not a screen

Ten pages under `features/settings/pages/` (`layout/`, `nav/` and `theme/`
hold the machinery around them — see architecture.md's `features/` tree).
Each page module exports a pure `meta: SettingsPageMeta` — title, group,
icon, and `cards[].rows[]` — beside its component. `nav/match.ts::buildIndex`
flattens every page's `meta` into a searchable index over plain data; **a
search box that has to render a page to know whether it matches has already
lost** — matching runs over the registry, and only a HIT renders anything
(`SettingsResults` mounts the real page component under a filter context, so
a result is the actual control, never a copy of it that could drift — see
`screens/settings.search.test.tsx`).

- **The guard test is the anti-drift mechanism.** `meta` and the component it
  sits beside are two independent things a person can edit without touching
  the other, so `screens/settings.index.test.tsx` mounts every page and
  diffs `data-setting-id` in the DOM against the declared row ids **both
  directions**: a row that renders but isn't declared is invisible to
  search, and a row declared but never rendered is a dead search result that
  looks live. Some pages render a mutually-exclusive subset of their rows
  depending on other state (Appearance: the light/dark pair while following
  the OS, one theme picker while fixed) — no single render contains every
  declared row, so the check runs **across named render states**
  (`PAGE_RENDER_STATES`) and compares the union to `declared`, not one flat
  render. The same test also asserts **label equality**: the text a row
  actually shows must equal `meta`'s declared label exactly, because search
  matches on `label` and a drifted label would surface a result showing the
  user text they never see on screen. **Cards are guarded the same way** —
  `data-settings-card` ids per page both directions, ids unique app-wide, and
  title equality — because `registerCardRows` keys a module-global map by card
  id and `cardHasVisibleRow` answers `false` for a card nobody registered: a
  rendered card id that drifts from its declared one takes every matching row
  on that card out of the results pane, silently, and a colliding id
  cross-wires two pages' row visibility (the map is last-write-wins).
- **The `keywords` convention exists because hints are not indexed.** A row's
  `hint` is `ReactNode` — often JSX with `<code>` tags — and cannot be
  flattened to text reliably, so `buildIndex`'s haystack folds in only
  `label`, `keywords`, and the card/page titles. A word that a user would
  reasonably search for but that lives only in prose inside a hint (GPG,
  say, for the "Sign commits" row) has to be duplicated into that row's
  `keywords` string, or it is simply unfindable. `git.integrations`'s
  `dynamic` card carries this furthest: its rows are synthetic (a host list
  is data, not fixed rows), so `keywords` is the ONLY thing search has to go
  on — see its `integrations.token` row.
- **The index is Store-gated, like every other update surface — and it treats
  "not known yet" as gated.** `useSettingsIndex` reads `useUpdateStore`'s
  `capability` and excludes `when: "updatable"` rows via the same
  `updatesManagedExternally` predicate `UpdatesPage` itself renders behind, so
  a Store install's search cannot surface "Check for updates" or the channel
  picker either. It composes
  `capability !== null && !updatesManagedExternally(capability)`: the
  predicate answers `false` for `null` so the update PANEL does not hide for a
  frame on an ordinary install, and the index deliberately calls that window
  the other way. `loadCapability()` is async, so the capability is null for a
  moment after Settings opens and permanently if the probe fails — for a
  search, briefly missing a row is recoverable, briefly NAMING a check is the
  v0.4.0 certification failure. `SettingsScreen` primes `loadCapability()` on
  mount to keep the window short (the flat screen it replaced primed it by
  always mounting `UpdatesSection`; per-page mounting is what made priming
  conditional on visiting the Updates page). Folding a new gated surface into
  the index without reusing that predicate would reopen the exact violation
  `docs/dev/distribution.md`'s Store rule exists to prevent, just reachable by
  typing instead of clicking.
- **A gate exists for any row the page renders conditionally, not just the
  Store one.** Appearance's light/dark pair and its single theme picker are
  mutually exclusive (`themeFollowsSystem` / `themeFixed`), and while they were
  declared ungated a search reported a hit and rendered an empty card — the
  card renders when a DECLARED row matches, so "light theme" on a fresh
  install (mode `"fixed"`) drew a header with nothing under it. `buildIndex`
  takes `gates: Record<SettingRowGate, boolean>` for this reason: widening
  `SettingRowGate` is a compile error until `useSettingsIndex` answers the new
  member, where a per-gate equality test would have made it silently "always".
- **`data-setting-id` is selected exactly, never with `*=`, in both specs and
  e2e.** These are dotted, two-part ids (`card.row`), and one is a genuine
  substring of another today — `commit.sign` is a literal prefix of
  `commit.signoff`. A `*=` (partial-text) selector on either compiles to an
  XPath `contains()` test, which does not care about word boundaries: it can
  silently resolve to the wrong row, or to neither, exactly the failure mode
  `test/e2eSelectors.test.ts` documents for `data-testid`.
  `e2e/specs/settings.e2e.ts`'s `clickSettingsToggleRow` selects by the full,
  exact id for this reason.

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
  unattributable live resolver counts as a match on purpose. Since #256 the
  resolver also announces the repository it is on (`merge://holding`), because
  it may have been opened by a *different* repository window: each window opens
  its own `RepoId`, so closing a tab in the window that did not open the
  resolver cannot break it, and without the announcement that window would
  confirm — and then close a resolver it had no business closing.
- **Danger-op error paths refresh first, set error last** (see `mergeBranch`):
  `refreshAll` starts with `set({ error: null })` and React batches same-tick
  sets, so the opposite order wipes the banner. A failed git op must still
  refresh — the UI reflects disk truth even on error.
- **`fastForwardBranch` routes HEAD to `pull`, and only HEAD** (#246). The
  backend op moves a REF, which is wrong for the branch the working tree is
  standing on — so the store checks `isHead` from `s.branches` and delegates to
  its own `pull` with `useSettingsStore`'s `defaultPullMode`, keeping the
  auto-stash and the user's chosen mode. Never `--ff-only` behind their back.
  The bulk action (`fastForwardAllBranches`) does NOT route: it reports the
  checked-out branch and leaves it, because a "fast-forward all" button must not
  rewrite the working tree. Both return their outcome so the caller can flash a
  summary (`features/branches/fastForward.ts`); the store never imports
  `@/design`.
- **The remote a branch tracks is not `upstream.split("/")[0]`** — a remote name
  may contain a slash. `remoteOfUpstream(upstream, s.remotes)` resolves it
  against the repository's own remote list, longest match first. The older
  `branchMenuItems` Pull/Push entries still use the split; they predate the
  helper and were left alone rather than changed under this feature's tests.

### Multiple windows (#256)

Tabs are for *switching*; windows are for *comparing*. Both exist, and the tab
model is unchanged — every window has a full tab strip. The design doc is
`docs/superpowers/specs/2026-09-04-multiple-windows-spec.md`; these are the rules
a change in this area has to keep.

- **A window's LABEL is its identity.** `main` (from `tauri.conf.json`),
  `pg-1`/`pg-2`/… for siblings, `merge` for the resolver — which is a window but
  never a repository window. `features/windows/windowKind.ts` and
  `src-tauri/src/windows.rs` hold the same rules on their own side of the IPC
  boundary; changing one means changing the other. Labels are deterministic
  rather than opaque ids because they are storage keys, a capability glob
  (`pg-*` in `capabilities/default.json`) has to match them, and an e2e spec has
  to name one to `browser.tauri.switchWindow(…)`.
- **Nothing about the store model changes.** A second webview gets its own copy
  of every Zustand store, so `useRepoStore` still holds exactly one repository's
  state — that window's active tab's.
- **Two windows on one repository get two `RepoId`s**, and that is the decision
  everything else rests on. Closing a tab in one window evicts nothing the other
  is using; terminals and rebase state, both keyed by `RepoId`, stay per-window
  with no refcounting. The price is that same-repository work in two windows does
  not serialize on one inner mutex — already the app's reality, since
  `watcher.rs` opens its own second `git2::Repository` on the same repository and
  a terminal beside the app has always been allowed.
- **Per-window state must be keyed by the window's label**, on both sides. The
  bug this rule exists for was invisible: `WatchState` was one global slot, so
  the second window's `watch_repo` silently evicted the first window's watcher
  and that window went back to being stale — the exact failure #239 removed,
  restored by the second window. Anything else that is "one live X on the ACTIVE
  repository" inherits this.
- **`main` keeps writing the bare `pg-open-repos` key.** Namespacing every
  window would have emptied every existing user's tab strip once, on upgrade.
  Siblings write `pg-open-repos:<label>`; `openReposKey` is the only place that
  mapping exists.
- **A new window is seeded through STORAGE, not the URL or an event.**
  `openAppWindow` writes the seed under the new label's key *before* the window
  exists, so it arrives through the ordinary `restoreSession()` path — nothing to
  replay if the window reloads, and no cross-window IPC to get wrong.
- **Close versus quit** decides whether a window comes back, and the rule needs
  no flag: a window destroyed while another repository window survives is
  forgotten; one destroyed with no survivor is remembered. Rust implements it by
  emitting `window://closed` to a survivor — with no survivor there is nobody to
  tell, which is exactly the quit case. The visible consequence: on macOS ⌘Q with
  three windows restores three, and on Windows/Linux, where quitting *is* closing
  the windows one at a time, the last window standing is what comes back. That is
  what VS Code does, and it beats both alternatives (resurrect windows the user
  deliberately closed; or restore nothing).
- **Only the primary window takes the first-launch CLI intent**, and the
  forwarded `cli-launch` event is routed to ONE window rather than broadcast — see
  `windows.rs::route`. A broadcast would have every window open the repository.
- **Routing an event backend-side is only half of it: the listener has to name
  its window too** (`listenToThisWindow`, `features/windows/windowEvents.ts`).
  A plain JS `listen()` registers `EventTarget::Any`, and Tauri's listener filter
  short-circuits on it — `*target == EventTarget::Any || filter(…)` in
  `event/listener.rs` — so an `Any` listener matches EVERY emit, `emit_to("main", …)`
  included. The backend's routing decision is simply undone in the webview, and
  every window opens the forwarded repository. It costs nothing to get right and
  is invisible until there are two windows, which is why
  `useCliLaunch.test.tsx` asserts a sibling window ignores an emit addressed to
  `main`, and `test/eventMock.ts` reproduces the `Any`-matches-everything rule so
  that assertion cannot pass vacuously. Scoping does NOT cost you broadcasts —
  `app.emit` runs with no filter at all, so `fs://changed` and `net://progress`
  still arrive everywhere.
- **Window chrome needed nothing.** `PGWindowControls`, the title effect,
  `RevealOnFirstPaint` and the appearance watch all already ask `getCurrentWindow()`.
  The one thing a runtime window does not inherit is `tauri.conf.json`'s
  titlebar config, so `openAppWindow` passes it explicitly — **at creation**,
  never stripped afterwards, because `lib.rs` records that stripping the frame
  after the fact was visible on Windows as a title bar that appeared and vanished.

### Progress and loading state (#296)

`RepoActivity` is the app's ONE answer to "is something running, what is it, how
far along, and can I stop it". A long op that keeps its busy state privately gets
none of that surface — which is how LFS fetch and submodule update ended up
cancellable in the backend but unstoppable from the UI for two releases.

- **`withAuthRetry` owns the indicator, not its callers.** It resolves the moment
  it RAISES a credential challenge; it does not await the retry, which runs later
  from the dialog's callback. So a caller that set a label before calling and
  cleared it in a `finally` cleared it while the user was still typing their
  password, and the retried op — the slower attempt, by definition — ran with no
  spinner, no status line and no Cancel. Pass `{ key, label }` and every attempt
  gets its own. Pinned by `useRepoStore.activity.test.ts`; the six sites do not
  stay in step by hand.
- **A new long-running op joins `RepoActivity`.** A private `busy` field is only
  for saying WHICH row is busy (`useLfsStore`, `useSubmodulesStore` and
  `useForgeStore` keep theirs for exactly that, and set an activity entry too).
- **Only ops that go through `run_git_authenticated` get a Cancel button**
  (`isCancellable` in `repoActivity.ts`). It is the registration point for
  `cancel::Scope::Repo`, so it is the precise set `cancel_network_op` can reach.
  A rebase replay cannot be interrupted at all yet — offering a button that does
  nothing is worse than offering none.
- **Cancel is a two-click affordance, and the first click MUST be visible**
  (#263). The backend sends `SIGTERM` on the first cancel of an op and escalates
  to `SIGKILL` only on a second — and only the `SIGTERM` lets git run its own
  lock-file cleanup, so an accidental escalation strands `.git/FETCH_HEAD.lock`
  and breaks the NEXT fetch. That makes the second click load-bearing, which is
  only safe if the first one changed something on screen: `cancelRequested` (in
  `RepoSlice`, and its own field on `useCreateStore`) turns the line into
  "Cancelling…", drops the percentage — a bar still climbing after the click is
  the clearest way to say "nothing happened" — and relabels the button "Force
  stop". Neither surface may become disabled: a git that ignores `SIGTERM` is
  escapable only by clicking again. `cancelRequested` clears when the last
  `activity` entry goes, so the next stalled op starts from the polite signal.
  See `docs/dev/backend.md` for the signal half.
- **Cancel has a keyboard route too** (#263). The status bar's button was the
  only one, which made the thing a user needs most when the app looks hung the
  one thing they cannot reach without a pointer. `action:cancel-network` in the
  palette is gated on the SAME `isCancellable(primaryActivity(...))` the button
  is, carries the same two labels, and names the op it would stop in its
  `detail` — a bare "Cancel" in a palette is a row nobody dares press. Two
  surfaces, one gate: they cannot drift into offering different things.
- **The auto-fetch timer is the ONE thing in the app with a deadline**
  (`features/repo/autoFetch.ts`, #263). #260 rejected a global network timeout
  and was right to: one short enough to rescue a stalled host is short enough to
  kill a legitimately slow clone, and only the person watching can tell those
  apart. That argument covers everything the USER started — and nothing the
  timer did. Nobody is watching those, and the skip-while-running guard (which
  exists so a stalled remote cannot grow a pile of stuck `git fetch` processes)
  means one stalled auto-fetch turns auto-fetch off for the rest of the session.
  So `startAutoFetch` arms a 2-minute deadline, and **only a tick that itself
  started the fetch arms one**: a tick that finds `activity.fetch` already set —
  which is exactly what somebody else's fetch looks like — returns without
  arming anything, and the armed timer is cleared when its own op settles and
  re-checks `startedAt` and the repository before firing. The cancel it fires is
  `Scope::Repo`-wide like every other, so it clears the whole pile.
- **`setActivity` is guarded on the repository, like `setFor`.** `activity` is a
  per-repo slice field and an op outlives a tab switch: a fetch on A finishing
  after the user moved to B used to clear B's entry, taking B's spinner and
  Cancel with it. `frozenSlice` clears `activity` for the matching reason — with
  writes scoped to the current repo, nothing would ever clear a parked tab's
  entry, and returning to it would show a live status line for an op long over.
  (The cost: a background tab's running op has no indicator until you come back
  to it and `refreshAll` re-reads the world. Same trade `loading` already makes.)
- **Ticks are guarded twice** (`applyNetProgress`): the event is app-global, so it
  must name the open repository, AND an entry must already exist. Ticks are still
  in flight when the process exits, and one landing after the op finished would
  light a status line — with a Cancel button — over nothing.
- **A label change keeps `startedAt` but drops `phase`/`percent`.** Pull's
  stash → pull → pop is three labels but one wait, so restarting the elapsed
  clock three times would make it useless; carrying a 90%-complete bar into the
  stash pop would be a lie.
- **Say when you stop doing the thing you said you were doing.** Every network op
  sets `Refreshing…` before its `refreshAll`, which on a large repository is a
  real share of the wall clock spent under a label that says "Fetching".
- **Elapsed time appears only after `ELAPSED_AFTER_MS`.** It exists to answer "is
  this stuck?", and a number that flashes up on every 200 ms fetch is noise. It
  also keeps the 1 Hz re-render off the common case — and that re-render is why
  `ActivityStatus` is a leaf component rather than markup in `AppStatusBar`.

#### `loadingTasks` — the detail behind `loading` (gap 8)

`refreshAll` is TEN backend reads behind one `Promise.all` with one boolean to
describe them. That is fine until a refresh is slow, and then "syncing…" is
exactly no help: a `/mnt/c` repository under WSL (#274) spends its nine seconds
in one or two of the ten and nothing said which.

- **Each read registers a named task while it runs**, via `trackLoad(repoId, id,
  label, promise)`. It returns the promise unchanged, so it drops into the
  existing `Promise.all` — a read added later that skips it is simply missing
  from the popover rather than breaking it. `useRepoStore.loading.test.ts`
  asserts the full set of ten ids, so an unwrapped read shows up as a diff.
- **`trackLoad` is NOT `async`.** Registration has to happen before the first
  suspension point, or ten reads fired together would register one microtask
  apart and "longest-running" would mean "whichever scheduled first".
- **`LoadingTask` is deliberately not `RepoActivity`.** An activity entry is an
  operation the *user* started and earns a Cancel button; a loading task is the
  app reading its own state, cannot be cancelled, and is usually over in under a
  tenth of a second. Merging them would put a Cancel button on `listing tags`.
- **`SHOW_AFTER_MS` is what makes this liveable.** A refresh runs on every tab
  switch, every commit and after every network op. With no delay the corner of
  the screen strobes all day; what survives 400 ms is the refresh worth reading
  about. Same idea as `ELAPSED_AFTER_MS`, different threshold and purpose.
- **The collapsed label names the longest-running read** (`primaryTask`), so as
  the fast ones drop off it settles onto the one holding the refresh up. Reads
  that started in the same millisecond are genuinely tied; the id breaks it so
  the label cannot flap between two of them on every render.
- The popover expands **upward** — the status bar is the last row on screen —
  and sits at `zIndex: 40`: above content (1–5), below pickers and modals (100),
  which must cover it. The shell root's `overflow: hidden` does not clip it,
  because it grows into the content area rather than out of the window.

#### `statusLoaded` — "have we ever read this repo?" (#368)

A third question the same boolean was being asked. `loading` means "a refresh is
in flight"; `statusLoaded` is a per-repo latch set by the first completed status
read (`refreshAll` AND `refreshStatus` — both land a status) and never cleared
except by `emptySlice()`, i.e. by opening a repository. `frozenSlice` keeps it,
unlike the in-flight flags: a parked slice still holds the status that was read.

- **An empty-state that would be a LIE before the first read gates on this, not
  on `!loading`.** The commit panel's `PGEmpty` ("Working tree clean") used to
  ask `!loading`, so a clean repository swapped to the three-pane STAGED/UNSTAGED
  layout with two empty file lists for the whole of every `refreshAll` and
  swapped back — "your changes vanished" for as long as the filesystem is slow,
  twice over after a commit (the watcher's `"all"` plan fires a second refresh),
  and a fresh DOM node each time, which is what turned a WebdriverIO
  handle-caching quirk into a red required gate (#364). A refresh has the
  PREVIOUS status in the store the entire time it runs; there is nothing to
  hide.
- **A spinner-in-place-of-empty is a different, legitimate use of `loading`** and
  was left alone: History (`!commits.length && loading` → skeleton), RepoBrowser
  (`tree.length === 0 && loading` → skeleton), Reflog/Submodules/Worktrees
  (`items.length === 0 && !loading` → `PGEmpty`), Welcome (`disabled={loading}`).
  None of them swap a populated layout for a different one mid-refresh — they
  only choose between "loading" and "empty" when there is genuinely nothing on
  screen.

### Settings: one validator, two untrusted sources (#254)

`useSettingsStore` reads a payload it does not control from two places — the
`pg-settings-v2` localStorage key on startup, and a settings file someone
imports — and both go through ONE function, `coerceSettings(parsed, base)`.
Its rules: a key absent from the payload keeps `base`'s value, a valid one is
applied, an unusable one falls back to the DEFAULT (not to `base`) because the
payload asked for a change and the documented safe value is the honest answer to
garbage. `load()` calls it with `base = DEFAULTS`; `importSettings` calls it with
the current state, so an older export cannot silently reset a preference it
predates — an export written before `updateCheckMode` existed must not switch
update checks back on for someone who turned them off.

- **The export derives its key set from the schema minus a deny-list**
  (`NON_PORTABLE_KEYS`, today just `lastCreateDir`), never a hand-written
  allow-list, so a preference added tomorrow travels by default. #283 added
  `updateCheckMode` days before the export landed and an allow-list would have
  dropped it silently. **Import keeps the opposite asymmetry** — only keys still
  in `DEFAULTS` are accepted, so an old or hostile file cannot poison the store.
  `useSettingsStore.export.test.ts` snapshots the exported key list: adding a
  `PersistedState` field fails that test until someone decides which side it
  belongs on. **The deny-list holds in both directions** — `importSettings`
  strips those keys from the payload and reports them, because "never in an
  export" is only half a promise if a hand-edited file can still set
  `lastCreateDir` on someone else's machine.
- **Nothing secret is in `PersistedState`,** which is what makes the deny-list
  safe: forge tokens and git credentials live in their own `Secret`-typed
  storage and no command returns them. The same test asserts no
  credential-shaped key or token-shaped value appears in a serialised export.
  Any new persisted field has to keep that true.
- **The payload's `version` is not `STORAGE_KEY`'s "-v2".** One versions the
  interchange format, the other the localStorage slot this install reads. A
  file from a newer build is accepted key by key and flagged
  (`report.fromNewerVersion`) rather than rejected — rejecting would strand
  anyone moving a machine back onto an older release, which is a case the export
  exists for.
- **The keymap crosses as a parameter, not an import.** `useKeymapStore`
  persists the active preset under its own key, and `keymap/actions.ts` imports
  the settings store — so the settings store cannot read it back without a
  cycle. `screens/Settings.tsx` owns both stores and bridges them: it hands the
  preset to `exportSettings({ keymapPresetId })` and applies the one
  `importSettings` reports, ignoring an id no `BUILTIN_PRESETS` entry has
  (`presetById` would silently resolve it to the default while the picker showed
  the unknown name).
- **`themePreference` travels; the appearance it resolved against does not.**
  The pairing is a preference like any other, so the export carries it. The
  observed OS appearance is not in `PersistedState` at all, so `snapshot()` and
  `PORTABLE_KEYS` — both derived from `DEFAULTS` — exclude it by construction
  (the call #283 made for `lastCheckedAt`). On import, `coerceSettings` repairs
  a half naming a theme this machine lacks and **re-derives** `activeThemeId`
  from this machine's own appearance: the exported id only records which half
  was on screen where the file was written.
- **One theme format.** `themePayload()` is the per-theme serialiser behind both
  `exportTheme` and the settings bundle; the bundle adds only `id`, because
  `activeThemeId` has to stay resolvable. `normalizeCustomThemes` is lenient in
  the direction `validateTheme` already chose for the logo slots — a missing
  colour is filled from the default theme rather than costing the user the
  theme, one unusable entry costs only itself, every colour goes through
  `sanitizeHex`, and `builtin` is never carried over (a custom theme claiming to
  be built in renders read-only and cannot be deleted).
- **Both file-import paths read `file.text()`,** which jsdom's Blob does not
  implement; `Settings.export.test.tsx` bridges it to `FileReader` at the top of
  the file. The hidden `<input type="file">` is also `display: none`, so
  `userEvent.upload` (which clicks first) does not reach it — dispatch
  `fireEvent.change` with `target: { files: [file] }` instead.

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
- **Following the system appearance is a PAIRING, not a theme** (#236). A
  `ThemeDef` is intrinsically one mode, so "system" cannot be one:
  `themePreference: { mode: "system" | "fixed", lightId, darkId }` says which
  light theme and which dark theme to pair, and `activeThemeId` stays the single
  answer to "what is on screen" — DERIVED from the pairing while following, the
  user's own choice while fixed. Keeping it derived is what makes the feature
  invisible downstream: `getActiveTheme`, the theme editor and `DiffMinimap`'s
  `activeThemeId` repaint subscription all work unchanged, and the minimap
  repaints on an OS switch for free.
  - `features/settings/systemAppearance.ts` reads the OS, from **two** sources
    with different jobs: `prefers-color-scheme` is synchronous (so module load
    can paint the right half with no flash, and it is the only source in a
    browser tab or the unit suite), and `getCurrentWindow().theme()` +
    `tauri://theme-changed` is authoritative and is what actually fires at
    sunset. It asks BOTH media queries, never only the dark one — a webview
    without the feature answers `false` to both, and reading that as "light"
    flips the app on exactly the platforms that cannot correct it. Nothing here
    is persisted or exported: the observed appearance is state about the
    machine, so it lives on `SettingsState` and **not** in `PersistedState`.
  - `main.tsx` calls `startSystemAppearanceWatch()` **before** the
    `window=merge` branch, so the merge resolver — a second Tauri window on the
    same bundle — subscribes for itself. A window still in last night's theme is
    the bug the feature exists to fix. No Rust and no extra capability:
    `core:window:allow-theme` is already inside `core:window:default`.
  - Every path that used to assign `activeThemeId` (pick, fork, duplicate,
    import) goes through `activationPatch`, which in system mode writes the id
    into the half matching the theme's OWN mode. Without it a fork made while
    following the system is thrown away by the next re-resolve. `pairedThemeId`
    re-validates both halves on every read, because the theme editor can flip a
    custom theme dark ↔ light behind the pairing's back — a pairing whose halves
    share a mode never switches, which is the original bug wearing a disguise.
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

### One error banner, and it never spells the enum (#212)

`PGErrorBanner` (`src/design/error-banner.tsx`) is the dismissible red strip an
`AppError` is reported on. AppShell and Reflog render it; a panel that shows a
failure inline (Submodules, Worktrees, LFS) keeps its own layout around
`appErrorMessage` and is fine as it is.

Three rules, each of which shipped broken in the two hand-rolled copies it
replaced:

- **The bold prefix is written prose or nothing** — never `error.kind`. Both
  banners used to lead with the discriminant, so a fresh machine's first commit
  read `NoSignature: git needs a name and an email address…` and a failed push
  read `Network: …` — the exact defect #212 is about, one line downstream of
  `appErrorMessage`, which exists to prevent it. `errorBannerLabel`
  (`src/lib/errors.ts`) is a **`Partial`** map on purpose: a missing entry means
  NO label, so a variant added tomorrow is safe by default. A total `Record`
  would put the same obligation on every future variant and fail the same way
  the day someone forgot. Two entries earn themselves today, both because the
  backend keeps them terse and the sentence is remediation advice
  (`EmbeddedRepo`, `DubiousOwnership`).
- **`white-space: pre-wrap`.** A rejected non-fast-forward push is
  `! [rejected] …` plus git's four-line `hint:` paragraph; `ProgressReader`
  keeps all of it and a collapsed banner ran the fix into the line above it.
  The `max-height: 30vh` + `overflow-y: auto` goes on the TEXT, not the strip —
  a `remote:` banner is unbounded and must not grow until it owns the window,
  but scrolling the strip would carry the dismiss button out of reach on
  exactly the errors that most need dismissing. `align-items: flex-start`, or
  the button floats into the middle of the paragraph.
- **Remediation travels with the text**, in `errorBannerText`, not in the
  component: every surface that renders an `AppError` gets the advice, and the
  advice is testable without a DOM.

Guarded by `src/design/error-banner.test.tsx` (renders the component for every
variant in the real Rust enum) plus two assertions in `test/appErrors.test.ts`
(no label may be a kind's own spelling; no shipped `src/` file may interpolate
a `.kind` into JSX text). End to end, `remote.e2e.ts`'s rejected-push case
pins that git's `hint:` paragraph still arrives as SEPARATE LINES — jsdom can
only see the style property, and only a real webview lays the text out. That
spec previously asserted `toContain("Network")`, so the required CI gate was
holding the defect in place: an e2e assertion on an `AppError`'s kind is
always a bug, and `grep`ping `e2e/` for the variant names in `error.rs` found
exactly one.

Still open, deliberately: the banner reports a rejected push but offers no
"Pull first / Force-push with lease" button — that is a design change, not a
legibility fix.

### A row's trailing action buttons get FIXED slots

`PGWorktreeRow` is the worked example (`git-components.worktreeRow.test.tsx`
pins it). A list row whose trailing buttons are auto-sized has an action column
that moves *down the list*, because one of the labels is state-dependent —
Lock/Unlock differ by 30px, so Open and Remove sat at a different x on exactly
the locked rows. Put the actions in a grid of identical fixed tracks
(`84px 84px 84px`, `flexShrink: 0`), make each button `fullWidth`, and
`justifyContent: "flex-start"` inside the slot — centring re-centres the label
when the state flips and the icon column jitters instead.

The other half of the same fix: **one fact per line, every line clipped.** The
worktree list is a dozen near-identical absolute paths, so name / branch+sha /
path / lock reason each get their own line, each `overflow: hidden` +
`textOverflow: ellipsis` + `whiteSpace: nowrap` + `minWidth: 0`, each with a
`title` so the clipped tail survives on hover. A long value must never reach a
`PGBadge` — the badge is a fixed-height uppercase pill and a 79-character lock
reason wrapped inside it, giving every locked row its own height. Badges stay
one word (`locked`) with the variable text as a sibling span, `flexShrink: 0`
on the badge. Screens that are all-path (`Worktrees`) skip the centred
`maxWidth: 1100` column — the cap ate exactly the width the paths needed.

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

## The built-in terminal (#243)

A real pty, docked in `AppBody`'s screen column below the routed screen, so it
spans the screen's width and not the activity bar's. Height persisted, dragged
with the shared `PGResizeHandle` (`orientation="vertical"`). **Closed by
default** — a terminal nobody asked for should not spawn a shell for every
repository they open, and a `.zshrc` that runs nvm would then be paid for on
every tab, invisibly.

Four rules that are easy to break:

- **Sizing is MEASURED, never observed.** WebKitGTK has no `ResizeObserver`, so
  xterm's `FitAddon` would leave the Linux build rendering 80×24 in a
  200-column pane forever. `TerminalView` uses `lib/useElementSize` (read first,
  observe second) and calls `term.resize` and `term_resize` together, so the
  renderer and the pty can never disagree about the grid. **The addon is
  deliberately not installed** — there is nothing to reach for by accident.
- **Per-repo state is NOT in `RepoSlice`.** `useTerminalStore` holds a session
  epoch for every open repository at once — the shape `useTabsStore` has, not
  the shape `RepoSlice` has. `RepoSlice` is cleared on every tab switch, which
  is right for a diff and would orphan the shells of every inactive tab.
- **The global chord handler stands down inside the terminal.** xterm renders a
  hidden `<textarea>`, so the keymap's `isEditable` already drops bare chords —
  but *not* modifier chords, and those are exactly the set a shell needs
  (`Ctrl+C`, `Ctrl+D`, `Ctrl+R`). `useKeymapStore`'s `inTerminal` guard lets
  only `terminal.toggle` and `app.closeOverlay` through. A terminal that sends
  `Ctrl+C` to the command palette instead of the foreground process is worse
  than no terminal, and `allowInInput` is not a licence to take it.
- **A view is HIDDEN, never unmounted, and that is load-bearing.** Unmounting
  disposes the xterm instance and takes the SCROLLBACK with it. The shell would
  survive — sessions live in the backend, not the view — so the user would
  reopen the panel to a blank pane attached to a live shell, with the build
  output they were reading gone. "Hiding leaves the shell running" would be
  technically kept and practically broken. So every repository with a live
  session keeps its view mounted and only the active one is visible; collapsing
  the panel hides the container rather than dropping its children.
  `TerminalPanel.test.tsx` counts MOUNTS (from an effect, not the component
  body) so a refactor back to unmounting fails there.
- **Ending a session is `useTabsStore`'s `evict()`** — the one place that calls
  `termClose`, covering `close`, `closeOthers`, `closeAll` and the LRU
  displacement path together. `forget()` then drops the view.

Output arrives base64-encoded and is decoded to bytes before `term.write` —
see `terminal.rs` in `architecture.md` for why a string payload would put
U+FFFD inside filenames. Events carry an epoch and the view drops the ones that
are not its own.

**Three ordering rules in `TerminalView`, all three found by the e2e spec and
invisible to every other layer:**

1. **Listen BEFORE `term_open`.** That command spawns the shell *and* its reader
   thread before it returns, so the prompt is on the wire while a listener
   attached afterwards does not exist yet, and Tauri buffers nothing. The
   terminal opened blank and stayed blank. Events that arrive before the epoch
   is known go to a pending buffer, which is flushed — filtered by epoch —
   the moment `term_open` resolves, with no `await` in between.
2. **Keystrokes are chained, one IPC call at a time.** `onData` fires per
   keystroke; firing an un-awaited `term_write` from each lets the invokes race
   and the pty receives them in completion order. Measured: `echo ZZMARKER`
   reached the shell as `ecoZARhR ZMKE`. A paste would hit it every time.
3. **The event payload is the flat struct, not the Rust enum** — see the note on
   `TermEvent`. An externally-tagged enum nests the fields under a variant key,
   the view's `repoId` check then fails for every event, and nothing renders
   with no error anywhere.

**Refresh after a command is not this feature's job.** The filesystem watcher
(#239) defaults on and classifies against `gitdir`/`commondir`, so a `git
commit` typed into the pane moves the graph already. A user who turned the
watcher off gets no automatic refresh from the terminal either — documented,
not worked around: a second mechanism for the same job would also fire on `ls`.

## Dialogs

- **Never `window.confirm`/`window.prompt`** — `pgConfirm`/`pgPrompt` from
  `@/design`, promise-shaped, matching the native contract (dismissal →
  `false`/`null`; Escape + backdrop dismiss; empty prompt string ≠ `null`).
- **`pgChoose` is the third one, for a refusal with two remedies** (#358).
  Resolves the chosen option's `id`; Cancel, Escape, the backdrop and a missing
  host ALL resolve `null`, so dismissal can never be read as an answer. Reach
  for it instead of chaining two `pgConfirm`s — dialogs queue rather than stack,
  so the second would appear after the first was answered rather than over it.
  Mark at most one choice `primary`; Enter is left to the focused button, which
  is why the Enter handler returns early for this kind.
- `PGConfirmOptions` carries `body`, `danger`, `requireText` (type-the-name) —
  use them for destructive ops. `PGPromptOptions.multiline: <rows>` renders a
  textarea (Enter inserts a newline, ⌘/Ctrl+Enter submits; e2e's stub picks the
  value setter off the matching prototype).
- A `<PGDialogHost />` must be mounted per window (AppShell, MergeWindow) —
  with none, calls resolve `false`/`null` rather than hanging. Isolated
  component tests need `WithDialogs` from `@/test/dialog`, or every confirm
  silently reads as "cancelled".

### The credential dialog's SSH half (#248)

- `CredentialDialog` renders `SshKeyPanel` for the two SSH `AuthKind`s and never
  for `Https`. On an `SshKey` challenge — the server REJECTED the public half —
  the passphrase box is folded away behind a disclosure and the panel leads: a
  passphrase unlocks the private key and does nothing about a key the host has
  never seen. On `SshPassphrase` the box keeps the lead and the panel is
  context.
- **`useSshKeyStore` is its own store on purpose.** An SSH key is machine state,
  so a per-repo field would have to join `RepoSlice` and would then be dropped
  and re-fetched on every tab switch for nothing. `useAuthStore` is not it
  either — it holds one challenge and deliberately nothing else.
- **The passphrase for a new key is component state**, handed straight to
  `sshKeyGenerate` and cleared on the way out — the same rule the credential
  secret follows, and pinned by the same shape of test.
- **The add-key URL comes from the backend**, which builds it from the runtime
  host. The panel renders `status.addKeyUrl` and hands it to `openUrl`; it must
  never compose one, or a hostname lands in `src/` and `test/privacy.test.ts`
  has a new allow-list entry to argue about.
- `sshAdvice` is PURE and lives beside the panel: it is a choice of WORDS across
  the (kind × has-a-key) grid, and `null` status means "not looked yet", never
  "no key".
- **An SSH retry may carry NO credential.** `AuthChallengeRequest.retry` takes
  `Credentials | undefined`, because after generating a key and registering it
  with the host there is nothing to type — the prompt-less attempt that just
  failed is the one that now succeeds, and `withAuthRetry`'s `attempt` has
  always accepted an optional credential. HTTPS still requires a secret: a blank
  token burns an authentication attempt on a credential we know is empty. Both
  `rememberCredential` call sites guard on `creds` for the same reason.

### The credential prompt is a NESTED dialog (#212)

It is raised BY another surface — the Clone dialog, a push, an auto-fetch — and
is answered before that surface can go on. Two consequences, and they are the
same rule stated twice:

- **It paints above the other dialogs and it takes Escape first.**
  `PGModal`'s `layer="nested"` (`MODAL_Z` in `design/modal.tsx`: base 100,
  nested 150) and the matching first branch of `app.closeOverlay`. Same
  z-index would have tie-broken on DOM order, and AppShell mounts
  `<CredentialDialog />` BEFORE `<CloneDialog />` — so the prompt sat behind
  the Clone dialog's own backdrop, and the Escape that seemed to dismiss the
  prompt actually closed the Clone dialog under it. That orphaned the clone:
  `runClone` drops `busy` before prompting (so the dialog stays dismissable),
  the retry sets it back without reopening, and `openClone()` refuses to reopen
  while busy — minutes of clone with no progress bar, no percentage and no
  Cancel, and a failure that then reported nowhere at all. Keep the two orders
  in step; a third modal layer belongs in `MODAL_Z`, not in a call site.
- **Dismissal is "no answer", never an answer** — the rule
  `pgConfirm`/`pgPrompt`/`pgChoose` already follow. `useAuthStore` splits the
  two exits: `answer()` clears the prompt because the credential is on its way
  to `retry`, `dismiss()` clears it and fires the challenge's `onDismiss`.
  Without that split a cancelled Sign in was SILENT: `withAuthRetry` had
  swallowed the auth error to raise the prompt and `attempt`'s `finally` had
  already taken the activity label down, so a push that did not happen looked
  exactly like one that did. `onDismiss` reports the failure that raised the
  prompt — the banner via `onError` for `withAuthRetry`'s six call sites, the
  dialog's own `error` for the clone. Raising a prompt is still not a failure
  and still reports nothing; only dismissing one is.

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

### Paths on the clipboard, and the file manager (#245)

- **The label is the contract**: `copyPathItems(paths)` in
  `design/context-menu.tsx` emits the "Copy path" (absolute) / "Copy relative
  path" (workdir-relative) pair, plural above one path, and is the ONLY place a
  file surface should spell either out. Before it, "Copy path" copied a
  *relative* path on the file row, the embedded-repo row, the multi-select and
  the diff pane's ⋯ menu, and an absolute one on the worktree menu and the repo
  tab — one label, two meanings.
- The arithmetic is pure and separate: `lib/paths.ts`
  (`relativeToWorkdir` / `absoluteInWorkdir` / `normalizeSeparators` /
  `isAbsolutePath`). No `node:path` in the webview, so the separator is inferred
  from the value — a Windows or UNC workdir gets its own style back on the way
  out, and comparison is case-insensitive only there. Out-of-workdir answers
  `null`; it never emits `../..`.
- Two surfaces deliberately have NO relative entry: `worktreeMenuItems` and
  `RepoTabs.tsx`'s `tabMenuItems`. Their target is a repository root, whose path
  relative to itself is `""`.
- **"Open containing folder" is the reveal entry** — there is no second menu
  item, on any platform, and this is settled rather than pending. On a FILE row
  `open -R` / `explorer /select,` open the containing folder with the file
  selected, and Linux xdg-opens the parent, so the existing entry already *is*
  "open containing folder" everywhere. The only variant that differs is a folder
  window with NO selection: identical to reveal on Linux, and the same window
  minus the selection on macOS/Windows — strictly less information for a second
  entry that looks like a different action. `context-menu.copyPath.test.tsx` and
  `context-menu.deleteUntracked.test.tsx` each pin the single entry, on the file
  row and the folder row, so the synonym does not get added.
- **Directory rows reveal too, and it took a backend change** (#245).
  `reveal_in_file_manager` used to pass a hard-coded `is_dir: false`, which for a
  folder means "select it in its parent" — so `reveal.rs::reveal_target` now
  reads is-it-a-directory off the FILESYSTEM instead. No parameter: a
  caller-supplied flag is a second source of truth that can disagree (libgit2
  spells an embedded repo with a trailing slash; a folder row has no status entry
  at all), and every existing call site got directory rows right the moment it
  landed. `terminal_target` is the same fix for "Open in terminal", which would
  otherwise open a folder's PARENT.
- **The folder row's menu is `multiFileMenuItems`** — both trees hand a folder
  key straight to `splitFileSelection`, which expands it to the files BENEATH it.
  So the menu never knew which folder it was on; `MultiFileMenuSelection.directoryPath`
  is that missing piece, set only for a single folder row (`sidedFolderPath`
  recovers it from the commit panel's `side:dir:path` key). Entries that address
  ONE location — reveal, terminal — appear only when it is set: for a multi-row
  selection the honest answer would be five windows.
- **Delete an untracked file** (#245) is `deleteUntracked` in `useRepoStore`, over
  `delete_untracked_files` — NOT `discard`. Discard restores a tracked path from
  the index and only deletes an untracked one; an entry labelled "Delete file…"
  that restored a file instead (because the path became tracked between the
  right-click and the confirm) is the worst surprise available on a destructive
  action, so the backend refuses a tracked path outright. Behind `pgConfirm`,
  with the #67 wording ("there is no copy in the index or in history"). In the
  multi-select menu, Delete acts on the untracked subset and **Discard steps
  aside when the whole unstaged selection is untracked** — the same swap
  `fileMenuItems` makes on a single row, because "discard changes" is then a lie
  about what happens. Mixed selections keep both, and they differ there: Discard
  restores the tracked ones, Delete touches only the untracked ones. The delete
  is best-effort once it starts unlinking, so a RESOLVED call can still carry
  `DeleteFailure[]`; the store refreshes the file list before it reports them,
  and `refreshAll()` first / error last in the catch arm.

### Custom actions: where a user command shows up (#225)

- **`surfaces` is the whole answer, and it is a SET** — `"repo" | "file" |
  "commit"` (`features/actions/customActions.ts::ACTION_SURFACES`), in that
  canonical order however the toggles were clicked, so two actions placed the
  same way compare equal and a settings export diffs cleanly. `"repo"` IS the
  command palette: the app's repo-level surface, where every op that is not
  about one file or one commit already lives. Toggles, not a `PGSelect` — the
  useful actions are on two surfaces at once.
- **An absent `surfaces` means the palette, everywhere it is read.** Every
  action persisted by the feature's first half has no such key and was a palette
  action, so that is what it stays. The rule lives in `normalizeSurfaces` /
  `DEFAULT_SURFACES` (so `showsOn`, `actionsFor` and the Settings row all agree
  without asking) *and* in `coerceCustomActions`, which `coerceSettings` calls
  to write the field in on load. Both halves are load-bearing: `customActions`
  is object-valued, so the scalar type-guard in `coerceSettings` never looked at
  the list — it arrives from localStorage exactly as it was written.
- **An action ticked into no surface cannot be saved.** `isSavableAction`
  refuses it, so the cause stays on screen (three empty toggles) rather than the
  app silently putting a surface back. A list that reaches `coerceCustomActions`
  with an empty one came from a hand-edited file, and *that* is repaired to the
  palette — a persisted action nobody can reach is worse than one in the wrong
  place.
- **One menu builder, three call sites**:
  `design/context-menu.tsx::customActionItems(surface, context)`, wired into
  `fileMenuItems` (above the danger block, next to the other "run something
  outside the app" entries), `multiFileMenuItems` (same place) and
  `commitMenuItems` (last). The leading divider is INSIDE the returned block, so
  a surface with no actions contributes nothing — an empty separated block reads
  as a menu that failed to render.
- **The context comes from the three builders, never assembled inline** —
  `repoContext` / `fileContext` / `commitContext` in `customActions.ts`. They
  are what finally fill `$FILE`, `$FILES` and `$SHA`; before them the advertised
  placeholders could never resolve. A multi-select passes EVERY selected path,
  because `$FILES` is the one placeholder that expands to several whole
  arguments. `repo` stays `""` in all three: `run_custom_action` overwrites it
  with the repository it resolves, which is also the child's cwd, so a value
  here could only ever be a second source of truth that disagrees.
- **Deliberately absent from three menus.** `commitMultiMenuItems` — `$SHA` is
  singular and the substitution has no list form, so "the first of five,
  silently" is not an answer. And the menus that REPLACE the file menu
  (conflicted, embedded, submodule rows) get no file-surface action, the same
  call `externalDiffItem` made: they are not the file menu with entries removed.
- **`runAction` reaches `pgAlert` / `pgFlash` by module, not through
  `@/design`.** The barrel re-exports `context-menu.tsx`, which now imports
  `runAction` — the barrel would close that into a cycle. Same reason `pgFlash`
  lives in `ui-helpers.tsx` for `features/keymap`.
- The parser stays in Rust. `customActions.ts` fills a context and filters a
  list; it never turns a command string into argv.

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
  Mod+Shift+↑/↓ and chevrons, repository tabs → Mod+Shift+←/→ and the tab menu's
  Move left/right, graph ops → menus/palette/Branches. A new gesture without one
  is not done. Escape cancels, from one capture-phase listener.
- **`useRowReorder` takes an `axis`** (`"y"` default, `"x"` for the repository
  tab strip, #238). The axis is a table of accessors — `clientX`/`clientY`,
  `left`/`top`, `width`/`height`, `offsetLeft`/`offsetTop`,
  `scrollLeft`/`scrollTop`, `translateX`/`translateY` — resolved once per hook,
  so the gesture (slop, midpoint crossing, edge autoscroll, settle, the
  FLIP hand-off) has exactly one implementation. A horizontal sibling hook would
  be the second, which is what the dnd spec exists to prevent. FLIP still
  measures `offset*` rather than rects: those are immune to both scrolling and
  the transforms the hook itself applies.
