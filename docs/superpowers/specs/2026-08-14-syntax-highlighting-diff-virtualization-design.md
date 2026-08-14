# Syntax highlighting, word diff everywhere, windowed diff rows — design

Status: approved 2026-08-14.

## Problem

Eight render paths in the app show code, and exactly one of them highlights it:

| Surface | Renderer | Syntax | Word diff | Windowed |
| --- | --- | --- | --- | --- |
| DiffViewer, unified | `PGHunk` | no | yes (#61 D8) | no |
| DiffViewer, split | `PGSideBySideDiff` | no | no | no |
| CommitPanel hunks | `PGHunk` | no | yes | no |
| CommitDiffPanel | own rows | no | no | no |
| Blame | own rows | no | n/a | no |
| RepoBrowser preview | own rows | highlight.js | n/a | no |
| Merge `SidePane` | own rows | no | no | n/a (fixed) |
| Merge result pane | CodeMirror 6 | no (no grammars) | n/a | n/a (CM6) |

The result reads cheap: a diff is undifferentiated monospace text with whole
lines tinted red or green. Highlighting exists in exactly one place, via
`lib/highlight.ts` and highlight.js's `common` bundle, and it gets there by
emitting an HTML string that a hand-rolled `splitHighlightedLines` re-splits per
line, reopening spans across newlines. That approach cannot compose with word
diff or windowing, so it has stayed where it is.

Two supporting gaps compound it. `diffToSplit` in `DiffViewer.tsx` pads the left
and right columns independently, so side-by-side pairs drift apart on any hunk
that mixes additions and removals. And no diff surface is windowed, though
`useWindowedList` has existed since #61 A8 and drives both History and the file
tree — a large diff mounts every row.

## Scope

In scope:

- A Shiki-based tokenizer and a `--syn-*` palette contract owned by `applyTheme()`.
- Syntax highlighting on all eight rows of the table above, including both merge
  window panes.
- Extending the existing `wordDiff` to split view, `CommitDiffPanel`, and merge
  `SidePane`.
- Windowing diff rows in DiffViewer (unified and split), CommitPanel, and
  `CommitDiffPanel`.
- Retiring highlight.js.

Out of scope:

- Any change to how diffs are computed. Hunks keep coming from libgit2 with the
  existing `diffContextLines` and ignore-whitespace semantics.
- Monaco. Rejected: it is an editor, not a renderer. Its `DiffEditor` computes
  diffs from two texts, which would diverge from the libgit2 hunks that
  line-level staging addresses; it owns its own virtual scroller, which would
  cost the per-row staging gutter, `--row-step` density, `data-pg-row` selectors
  and keymap pane scoping; and it wants web workers, which is friction under the
  Tauri custom protocol.
- A user-facing syntax theme picker. Syntax colors follow the app's theme mode.
- New backend git ops. Everything needed already exists.
- Windowing Blame and the RepoBrowser preview. Both render whole files today and
  keep doing so. The preview already emits per-line spans through highlight.js,
  so this slice does not change its DOM weight in kind, only its engine; Blame
  does gain spans it did not have. If either measures slow on a large file, they
  window next, through the same `WindowRange` convention — deliberately deferred
  rather than forgotten.

## Decisions

**Shiki, with `engine-javascript`.** Real TextMate grammars, ~200 languages,
lazily registered per language. The JavaScript regex engine avoids shipping a
WASM asset through the Tauri protocol.

**Tokens are classes, never inline colors.** Shiki's own HTML output bakes hex
colors into the markup, which would force a re-tokenize on every theme-mode
switch. Mapping scopes to `--syn-*` classes keeps mode switching CSS-only.

**Tokens are ranges, not substrings.** `{ start, end, cls }` composes with
`WordSpan`, which is also range-shaped, without either side re-slicing text.

**Whole-file tokenization, not hunk-local.** A hunk is a window into a file; a
block comment or template string that opens above the hunk mis-colors everything
below it if tokenized in isolation. Both sides are already reachable: worktree
text via `readFileContent`, the old side via `readFileContentAtRev`. Hunk-local
tokenization remains the documented fallback when a read fails or a size guard
trips.

**One palette, two engines.** Shiki tokenizes the read-only surfaces. The
editable merge result pane is a CodeMirror 6 document that changes on every
keystroke, so it gets its tokens through a debounced decoration layer rather
than a full re-tokenize per edit. The unifying contract is the `--syn-*`
palette, not the engine, so all three merge panes agree on color and language
coverage.

## Architecture

### `src/lib/syntax/`

```
shiki.ts      Singleton highlighter, engine-javascript, lazy grammar registration
tokenize.ts   tokenizeFile(path, text) => Promise<SyntaxLine[] | null>
scopes.ts     TextMate scope => --syn-* class (pure, tested)
cache.ts      LRU keyed by path + content hash (djb2; no crypto needed)
useSyntax.ts  React hook: SyntaxLine[] | null, cancels on path change
```

```ts
export interface SyntaxToken { start: number; end: number; cls: string }
export type SyntaxLine = SyntaxToken[];
```

`tokenizeFile` returns `null` rather than throwing when a guard trips —
`MAX_HIGHLIGHT_BYTES` (1 MB) or `MAX_HIGHLIGHT_LINES` (20 000) — or when the
path maps to no known grammar. Callers treat `null` as "render plain".

`useSyntax` never blocks first paint: a surface renders plain text immediately
and re-renders with spans when tokenization resolves. No spinner, no layout
shift, because span-ification does not change row geometry.

### Palette

Roughly twelve tokens: `--syn-keyword`, `--syn-string`, `--syn-number`,
`--syn-comment`, `--syn-func`, `--syn-type`, `--syn-var`, `--syn-punct`,
`--syn-tag`, `--syn-attr`, `--syn-regexp`, `--syn-meta`.

They are written by `applyTheme()` alongside `SEMANTIC_TOKENS`, keyed by theme
**mode**, with light calibrated separately rather than inherited — the same rule
that already governs `--git-*` and `--graph-*` (#61 B4). The `dark` column stays
byte-identical to the `:root` defaults in `index.css`.

This removes the hand-maintained `.hljs-*` block at `index.css:272+`, the
`highlight.js` dependency, and `src/lib/highlight.ts`.

### Which side a diff row reads

A diff row is a line of one of two files, so a diff surface holds two token
arrays and each row picks one. The rule, and it is not negotiable per-surface:

| Row kind | Token source | Index |
| --- | --- | --- |
| `rem` | old-side tokens | `oldLineno` |
| `add` | new-side tokens | `newLineno` |
| `ctx` | new-side tokens | `newLineno` |

Context rows read the new side because that is the text the row displays; for
unchanged lines the two agree anyway, and falling back to the old side when
`newLineno` is absent covers the deleted-file case. A row whose line number is
missing, or whose index is past the token array, renders plain — never throws,
never guesses.

Each surface supplies the two texts from what it already knows:

| Surface | Old side | New side |
| --- | --- | --- |
| DiffViewer, CommitPanel | `readFileContentAtRev(HEAD, path)` | `readFileContent(path)` |
| CommitDiffPanel, CommitDiff | `readFileContentAtRev(parentSha, path)` | `readFileContentAtRev(sha, path)` |
| Blame, RepoBrowser preview | n/a | text already in hand |
| Merge `SidePane` | `conflict_sides` text already in hand | same |

Added and deleted files have only one side; the missing side yields no tokens
and those rows render plain. Renames read the old side at its old path.

### Span composition — `src/lib/lineSpans.ts`

The keystone unit. Syntax tokens and word-diff spans are two independent range
sets over one line, and exactly one place should reconcile them:

```ts
export interface RenderSpan { start: number; end: number; cls?: string; changed: boolean }

export function buildLineSpans(
  text: string,
  syntax: SyntaxToken[] | null,
  words: WordSpan[] | undefined,
): RenderSpan[];
```

Output tiles the line: every character is covered exactly once, in order, with
boundaries drawn from the union of both input range sets. Renderers become a
flat `spans.map(...)` with no gap handling — the same property `toSpans` in
`wordDiff.ts` already establishes for word spans alone.

`DiffText` in `git-components.tsx` is rewritten on top of this. It keeps
`data-testid="word-change"` on changed spans and the existing relative tint
derived from `--git-added` / `--git-removed`, so `wordDiffRender.test.tsx` stays
green unchanged.

### Word diff extension

The algorithm is done (#61 D8) and is not touched. What spreads is the pairing
pass that feeds it. `PGHunk`'s private `withWordSpans` encodes the rule —
adjacent rem/add chunks pair positionally for `min(rem, add)` lines, and
`wordDiff` itself declines pairs too dissimilar to be one edited line. That rule
moves to `src/lib/pairChangedLines.ts` (pure, tested) so three call sites share
one definition instead of growing three.

- **Split view.** `SideLine` gains `spans?: WordSpan[]`, and `diffToSplit` gains
  rem↔add pairing so a removal and its matching addition occupy the same row.
  This is the fix for the existing column drift, and it is a precondition for
  word diff in split mode rather than a separate improvement.
- **`CommitDiffPanel`** and **merge `SidePane`** consume the same helper.

### Windowing

`PGFileTree` already set the convention: the design-system component accepts an
optional `window?: WindowRange` and the screen owns the `useWindowedList` hook,
so indices mean the same thing on both sides. `PGHunk` and `PGSideBySideDiff`
follow it.

Three constraints:

1. **`changedIndex` is numbered before windowing, over the full hunk.** It is
   the wire contract shared with the backend's `Patch::line_in_hunk` for
   line-level staging (#61 D7). Numbering a windowed slice would silently stage
   the wrong line. This is the highest-severity risk in the slice.
2. **Uniform row pitch.** `useWindowedList` is fixed-pitch by design. Today's
   hunk-header row is taller than a code row (2px padding plus two borders), so
   header rows adopt code-row height and lose that padding. The pitch constant
   is exported from `git-components.tsx` and consumed by both the component and
   the screen, so the two cannot desync — the #70 lesson, and the reason
   `PGGraphRow` takes its step as a number today.
3. **Wrap disables windowing.** With `wrap` on, `whiteSpace: pre-wrap` makes row
   height variable, which fixed pitch cannot express. The screen simply passes
   no `window`, and every row renders. A very large diff with wrap on stays
   slow; that combination is rare and this keeps the toggle.

In split mode a single scroller drives both columns from one shared
`WindowRange`. F7 hunk navigation keeps using `scrollToIndex`, never a
`querySelector` — under windowing the target row is usually not mounted, a trap
the hook's own doc comment already calls out.

Diff/code row geometry stays governed by `--lh-code`. Density (`--row-step`)
does not apply to these rows and must not be introduced here.

### Merge window

`SidePane` rows are already fixed-height and non-wrapping, deliberately, so the
middle pane can sync scroll by line index. Tokens therefore map to rows by index
directly, and spans flow through `buildLineSpans` like everywhere else.

The result pane gets a `syntaxDecorations` CodeMirror extension: on a 120 ms
debounce after a document change it tokenizes the current text and maps tokens
to `Decoration.mark` with the same `--syn-*` classes. If that proves janky on a
large conflicted file, the documented fallback is `@codemirror/lang-*` plus a
`HighlightStyle` mapped to the same variables — incremental, but with narrower
language coverage than the side panes, which is why it is the fallback and not
the first choice.

## Testing

Pure logic, vitest:

- `scopes.ts` — scope-to-token mapping, including unknown-scope fallthrough.
- `buildLineSpans` — tiling, overlapping ranges, syntax-only, words-only,
  neither, boundaries at line start and end.
- `pairChangedLines` — unequal run lengths, dissimilar pairs declined, context
  rows untouched.
- `tokenizeFile` guards — oversized input and unknown extension both return
  `null`.

Component, vitest + RTL:

- Spans render with the expected classes, and `data-testid="word-change"`
  survives the `DiffText` rewrite.
- A windowed `PGHunk` mounts only its slice while `changedIndex` and
  `data-testid="hunk-stage"` still address the correct absolute line.
- `wrap` on renders every row.

Shiki is mocked in component tests with a deterministic fake tokenizer. Real
grammar loading is slow and asynchronous in jsdom, and these tests are about
composition, not grammar fidelity.

E2E, Docker only (`pnpm test:e2e:docker`), after `pnpm test:e2e:docker build`:
`history-diff`, `keymap`, and `keyboard-shortcuts` are the specs that touch diff
rows, and windowing is exactly the change that can put an asserted row off-DOM.

## Risks

- **`changedIndex` desync under windowing** stages the wrong line. Guarded by
  numbering before slicing, and by a component test that asserts absolute
  indices from a windowed render.
- **Main-thread tokenization jank** on large files. Guarded by size caps; a
  Worker is deliberately deferred until measurement shows it is needed.
- **Windowed rows off-DOM** break e2e assertions that scroll implicitly. Covered
  by running the three affected specs.
- **Hunk-header rows change height slightly** as the price of uniform pitch.
  Intentional and visible; called out here so it is not read as a regression.
- **Merge result pane re-tokenizes on edit.** Debounced, with a documented
  CodeMirror-native fallback.

## Success criteria

1. All eight code surfaces highlight, with colors that follow the app's theme
   mode and any custom accent.
2. highlight.js, `lib/highlight.ts`, and the `.hljs-*` CSS block are gone.
3. Word diff appears in split view, `CommitDiffPanel`, and merge `SidePane`, from
   one shared pairing helper.
4. Split view columns stay aligned across mixed add/remove hunks.
5. Diff rows are windowed with `wrap` off; line-level staging still targets the
   correct line in a windowed hunk.
6. `pnpm tsc --noEmit`, `pnpm test`, and the three affected e2e specs pass.
