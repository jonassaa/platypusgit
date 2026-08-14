# Whole-file diff, stronger word highlight, and off-main-thread tokenization

Date: 2026-08-14

## Context

The user asked for four things:

1. Inline (unified) diff as the **default** view, green backgrounds for added
   lines and red for removed.
2. Word-level diff keeping those line colours, but with a **stronger** highlight
   on the changed words themselves.
3. **Whole file** shown by default instead of just the changed chunks, with
   chunked context available as a setting.
4. Selecting a file and immediately moving to another must **not freeze** the
   app while the first file's syntax highlighting is computed — plus make
   highlighting faster generally, possibly by preloading when a commit opens.

Much of the surrounding machinery already landed in #104, after this request was
made. What exists today:

- `src/lib/syntax/` — Shiki (`engine-javascript`, no WASM asset) tokenizer with a
  24-entry LRU cache keyed `lang:hash:len`, and guards at 1 MB /
  20 000 lines (`MAX_HIGHLIGHT_BYTES`, `MAX_HIGHLIGHT_LINES`).
- `useSyntax(path, text)` — resolves tokens, renders plain text meanwhile.
- `useDiffSyntax({repoId, path, old, new})` — reads **both sides' whole-file
  text** over IPC and tokenizes each. Already used by all four diff surfaces.
- `src/lib/diffRows.ts` — `flattenDiffRows(hunks, {headerH, rowH, collapsed,
  syntax})` produces a flat `DiffRow[]`; `windowVariable` gives an exact
  variable-height window over known row heights.
- `src/design/PGWindowedDiff.tsx` — the one renderer for that row list, with
  per-hunk stage/discard, line selection, `data-hunk-index` for F7 and e2e.
- Line backgrounds, gutter stripes, word spans and syntax layering all render
  through `PGDiffRow` / `buildLineSpans`.

So items 1 and 2 are largely satisfied already, and the shared renderer this
work would otherwise have had to build is in place. What remains is narrower
than it first appeared, and this spec covers only that remainder.

### What is actually still missing

| Ask | State | Work |
| --- | --- | --- |
| Inline default | `DiffViewer` defaults to `unified` but in **ephemeral local state** (`useState`), so it is not a preference and does not persist | Persist as a setting |
| Green/red lines | Done | — |
| Stronger word highlight | Changed-word tint is a weak `0.28` alpha over an already-tinted line | New tokens, stronger value |
| Whole file by default | **Not done.** Every surface renders only the hunks returned at `diffContextLines` (3) | Gap-fill rows + setting |
| No freeze on file switch | **Not fixed.** `useSyntax` discards stale *results*, but `tokenizeFile` → `hl.codeToTokens` is synchronous CPU work on the main thread, so the cost is still paid and the UI still janks | Move tokenization to a Worker |
| Faster / preload | Cache exists; nothing preloads | Packed transfer + bounded idle prefetch |

## Goals

- Whole file is the default diff view on every diff surface, including the
  staging surface, **without changing what "stage hunk" stages**.
- Chunked context remains available as an explicit setting.
- Inline vs split is a persisted preference, defaulting to inline.
- Changed words read clearly stronger than the surrounding changed line.
- Switching files never blocks the main thread on tokenization.

## Non-goals

- No change to the split (side-by-side) renderer beyond it honouring the
  persisted mode.
- No change to the Rust backend. No new `GitBackend` method, no new command.
  The existing `get_diff` / `read_file_content*` plumbing is sufficient.
- The Conflict and Merge-window panes keep their current rendering.
- No lazy per-row token materialization (see Future work).

## Design

### 1. Whole file as gap-filled rows

The naive approach — ask libgit2 for a huge `context_lines` — is **wrong and
must not be used**. Hunk indices are the wire contract with the backend
(`stage_hunk(path, hunkIndex, contextLines)`), and `changedIndex` is the
per-hunk changed-line index that line staging addresses (#61 D7). With
whole-file context libgit2 returns a single hunk covering the file, so
"stage hunk" would stage everything and line indices would shift. That is a
data-loss-class bug in a git client.

Instead, keep the canonical diff exactly as fetched and **compose the whole-file
view around it**. The unchanged regions between hunks are, by definition,
byte-identical on both sides, so they can be filled in from file text the app
already has.

`DiffRow` gains a third variant:

```ts
export type DiffRow =
  | { kind: "header"; hunkIndex: number; header: string; h: number }
  | { kind: "line"; hunkIndex: number; line: DiffLineData; h: number }
  | { kind: "fill"; line: DiffLineData; h: number };
```

`fill` is a separate kind rather than a `line` row with a sentinel `hunkIndex`
on purpose: `PGWindowedDiff` looks up `hunkActions(row.hunkIndex)` and wires
`onLineClick(row.hunkIndex, …)`. A filler row carries no hunk, and a sentinel
number would be one forgotten guard away from staging the wrong hunk. A
distinct kind cannot be mistaken for a stageable row — the type checker
enforces it at every consumer.

`flattenDiffRows` takes one new option:

```ts
wholeFile?: { newText: string | null; oldText: string | null };
```

When present, it inserts `fill` rows before the first hunk, between consecutive
hunks, and after the last hunk. For a gap following a hunk `h` and preceding
hunk `next`:

- new-side range: `[h.newStart + h.newLines, next.newStart - 1]`
- old-side range: `[h.oldStart + h.oldLines, next.oldStart - 1]`
- both ranges have the same length, because the region is unchanged
- text comes from `newText`, split on `\n`, 0-indexed at `newStart - 1`
- each filler row is `{ kind: "ctx", lnL, lnR, text }`, so it renders exactly
  like a context line and picks up syntax through the existing `withSyntax`

**Hunk headers stay.** They are the per-change-block affordance carrying
Stage / Discard, the collapse chevron, `data-hunk-index` for F7 navigation, and
the selectors the e2e specs address. Keeping them is what makes this "the Rider
stage view, but showing the whole file": the file reads continuously, and each
change block still has its own stage control. Nothing about staging changes —
same hunks, same indices, same `changedIndex` numbering — because
`withChangedIndices` still runs over the hunk's own lines before any filler is
interleaved.

**Correctness guard.** `composeFillRows` returns `null` if the arithmetic does
not check out: a negative or descending range, a gap length that disagrees
between the two sides, or a required text line beyond the end of the text. The
caller then renders that file chunked. A whole-file view with wrong line numbers
is worse than no whole-file view, so an inconsistency degrades visibly to the
known-good mode rather than rendering something plausible and wrong.

**Where the text comes from — no extra IPC.** `useDiffSyntax` already reads both
sides' whole-file text to tokenize them; it just does not expose the text. It
gains `oldText` / `newText` on its return value. Every one of the four surfaces
already calls it, so whole-file mode costs no additional round trip. Surfaces
that cannot get text (binary, and reads that fail) fall back to chunked.

### 2. Settings

Two new persisted keys, plus a relabel:

- `diffViewMode: "inline" | "split"`, default `"inline"`. `DiffViewer`'s toolbar
  toggle reads and writes this instead of local `useState`, so the choice
  survives navigation and restart.
- `diffContextMode: "wholeFile" | "chunks"`, default `"wholeFile"`.
- `diffContextLines` (existing, default 3) stays and keeps its current meaning
  for the fetch. It governs chunk size in chunked mode, and it continues to be
  the value passed to every hunk-staging call in **both** modes — so its
  Settings label must say it still applies, not imply it is chunks-only.

`Settings.tsx` gets the two controls next to the existing context-lines field.

### 3. Stronger word highlight

Add `--git-added-word` / `--git-removed-word` to `:root` in `index.css` **and**
to `SEMANTIC_TOKENS` for both `dark` and `light` in `useSettingsStore.ts` — the
two must be edited together or they drift, and light needs its own calibration
rather than inheriting a dark-calibrated value (#61 B4). `DiffText` uses the
token instead of its inline `oklch(from … / 0.28)`.

Values: roughly `0.55` alpha equivalent in dark and a correspondingly deeper
tint in light, chosen so the changed word separates clearly from its line
background while the line's own green/red stays readable. Derived from
`--git-added` / `--git-removed` with `oklch(from …)` so custom accent themes
carry through, per the styling convention.

### 4. Off-main-thread tokenization

**Root cause of the freeze.** `useSyntax` cancels stale *results*, but
`tokenizeFile` awaits nothing before `hl.codeToTokens(text, …)`, which is
synchronous CPU work. Selecting file A then B still runs A's tokenization to
completion on the main thread; the `cancelled` flag only throws the answer away
afterwards. Nothing is saved, and the jank is unchanged.

**Fix: a module Worker.** Shiki is configured with `engine-javascript`, so it is
pure JS with no WASM asset and is safe to run in a worker.

- `src/lib/syntax/tokenize.worker.ts` — owns the Shiki instance, the grammar
  loading, and `codeToTokens`. Receives `{id, path, text}`, replies
  `{id, packed}`.
- `src/lib/syntax/tokenizeClient.ts` — constructs the worker lazily on first
  use, keeps the LRU cache **on the main thread** (so a hit never crosses the
  boundary), tracks the newest request id per caller, and drops replies for
  superseded ids. Posts `cancel` so the worker skips queued-but-superseded jobs.
- `tokenizeFile` keeps its exact signature and null contract, so `useSyntax`,
  `useDiffSyntax` and every existing test are unchanged.

**Fallback is mandatory.** If `new Worker(...)` throws or the worker fails to
initialize, `tokenizeClient` transparently falls back to tokenizing on the main
thread — today's behaviour. This covers jsdom (component tests have no real
Worker) and any webview where module workers misbehave, and means the feature
can only improve responsiveness, never break highlighting.

**Packed transfer.** Returning `SyntaxLine[]` directly would structured-clone
hundreds of thousands of small objects for a large file, moving cost to the main
thread instead of removing it. The worker instead returns

```ts
{ classes: string[]; lineStarts: Int32Array; data: Int32Array }
```

where `data` is a flat `[start, end, classId, …]` triple stream and
`lineStarts` indexes into it per line. Both arrays are **transferred**
(zero-copy). The main thread materializes `SyntaxLine[]` in one tight pass with
no per-object clone. This is also the "make it faster" part of the ask: it is
strictly less main-thread work than today, on top of no longer tokenizing there.

**Preload on commit open.** After the selected file's tokens resolve,
`CommitDiffPanel` idle-queues tokenization for its neighbours in the file list
(the likely next selection) via `requestIdleCallback`, capped at 4 files and
cancelled when the commit or selection changes. Each queued file needs its text,
so this is also where the IPC read happens; the cap keeps a 200-file commit from
issuing 200 reads. With the worker in place this is a nicety rather than the
fix — switching files is already non-blocking — so it stays deliberately small.

## Edge cases

- **Binary file** — no text, no tokens; chunked rows as today.
- **New file** — one hunk covering the file, so no gaps; whole-file view is
  identical to chunked. No special case needed.
- **Deleted file** — likewise one hunk; filler would come from `oldText` if a
  gap ever arose. Guarded by the arithmetic check rather than special-cased.
- **Renames** — `useDiffSyntax`'s `rev` source already carries its own `path` so
  the old side reads the pre-rename blob; gap filling uses the new side.
- **Whitespace-ignore** — already disables hunk staging (#61 D2). The whole-file
  view still renders; the block affordance shows the existing disabled reason.
  Filler rows are unaffected, since ignore-whitespace changes hunk content but
  the ranges still describe real file lines.
- **Oversized file** — highlighting already bails past 1 MB / 20 000 lines.
  Whole-file **rendering** reuses that line ceiling: past
  `MAX_HIGHLIGHT_LINES` the view stays chunked, since inserting 200 000 filler
  rows would fight the performance goal this same change is trying to meet.
  Surface it as a one-line note with a button to show the whole file anyway,
  rather than silently ignoring the setting.
- **Find-in-diff filter** (`DiffViewer`) filters hunk lines. Filler rows are not
  matches and are suppressed while a query is active, so the result list stays a
  list of matches.

## Testing

- `diffRows.test.ts` — extended: filler rows land in the right places; line
  numbers continue correctly across gaps on both sides; `hunkIndex` and
  `changedIndex` on real hunk rows are **byte-identical with and without**
  whole-file mode (the staging-safety invariant); each inconsistency case
  returns null.
- `tokenizeClient.test.ts` — superseded ids are dropped; the main-thread
  fallback produces the same tokens as the worker path; packed round-trip
  reproduces the `SyntaxLine[]` the direct path yields.
- Component: `CommitPanel` stages the **correct hunk index** from a block in
  whole-file mode; whole-file rows appear in `CommitDiffPanel`; rapid file
  switching ends on the second file's content.
- `useSettingsStore.test.ts` — round-trip of the two new keys and their
  defaults.
- E2E: only the diff/staging specs, in Docker, once at the end
  (`pnpm test:e2e:docker build` then `run --spec …`), per CLAUDE.md.

## Risks

- **Wrong hunk staged.** The one serious risk. Mitigated by making filler a
  distinct row kind the type system keeps out of staging paths, by leaving
  `withChangedIndices` untouched, and by the with/without-fill parity test.
- **Module workers in WebKitGTK / WKWebView.** Mitigated by the mandatory
  main-thread fallback — worst case is today's behaviour.
- **Whole-file default makes big diffs heavier.** Mitigated by the existing
  exact variable-height window (only visible rows render) plus the line ceiling.

## Found during implementation

Two things this design did not anticipate, both fixed in the same branch:

1. **`vite.config.ts` needs `worker: { format: "es" }`.** Shiki loads each grammar
   as a dynamic import, so the worker bundle is code-split, and Vite's default
   `iife` worker format makes rollup fail the production build outright. Caught by
   running `pnpm vite build`, not by any test — the dev server and vitest are both
   happy without it.

2. **A latent windowing bug, exposed by whole-file mode.** All four diff surfaces
   measured their scroll viewport as

   ```ts
   if (!el || typeof ResizeObserver === "undefined") return;
   setViewportH(el.clientHeight);
   ```

   The guard runs first, so on a webview with no `ResizeObserver` the initial
   measurement never happened and the height stayed 0. `windowVariable` then fell
   back to a 400px viewport, so rows past 400px were never mounted and the bottom
   of a taller diff pane rendered blank. WebKitGTK 605 — the Linux webview and the
   e2e target — is exactly such a webview. Chunked diffs are short enough to fit
   inside the fallback, which is why it went unnoticed; whole-file diffs made the
   row list long enough to hit it. Now `lib/useViewportH.ts`, measured
   unconditionally, with the observer as an enhancement.

   Found by the `keymap` F7 e2e spec, whose second hunk stopped rendering. That
   spec also assumed both hunks were on screen simultaneously — true of a chunked
   60-line fixture, not of a whole-file one — so its precondition now asserts hunk
   0 and lets the F7 sequence prove hunk 1, which additionally exercises F7's
   scroll-into-view for the first time.

Also worth recording: the Shiki call was split into `tokenizeShiki.ts` so the main
thread imports it only dynamically, as a fallback. That drops the main bundle from
1046 kB to 881 kB (gzip 324 → 269 kB), since Shiki now ships only in the worker
chunk on the normal path.

## Known characteristics

The worker handles requests in order, and a single `codeToTokens` call cannot be
interrupted once started. Clicking through several files quickly therefore queues
their tokenizations: the UI never blocks and each file's text renders immediately,
but a later file's *colours* can wait behind an earlier large file's. Deliberately
not solved with a main-thread queue that drops superseded jobs — resolving a
dropped request means "this file renders plain", and getting that wrong leaves a
file permanently uncoloured, which is worse than the latency. The bounded prefetch
makes the common case a cache hit instead.

## Future work

Lazy per-row token materialization: with a windowed renderer only ~50 lines are
on screen, so `SyntaxLine[]` could be built per visible row from the packed
arrays instead of eagerly for the whole file. Not done here — the packed
transfer already removes the dominant cost, and `withSyntax` currently wants an
indexable array.
