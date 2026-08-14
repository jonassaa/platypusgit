# Whole-file Diff and Async Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the inline diff show the whole file by default with a stronger changed-word highlight, and move Shiki tokenization off the main thread so switching files never janks.

**Architecture:** Whole-file view is composed on the frontend by inserting a new `fill` row kind between the hunks the backend already returns — the canonical diff, its hunk indices and its `changedIndex` numbering are left completely untouched, so staging keeps addressing exactly what git would apply. Tokenization moves into a module Worker that returns tokens packed into transferable `Int32Array`s, with a mandatory main-thread fallback.

**Tech Stack:** React 19 + TypeScript, Zustand, Vite module workers, Shiki (`engine-javascript`), Vitest + React Testing Library, WebdriverIO (e2e in Docker).

**Spec:** `docs/superpowers/specs/2026-08-14-whole-file-diff-and-async-highlight-design.md`

## Global Constraints

- Toolchain: Node 22 + **pnpm** (at `~/Library/pnpm`), Rust stable at `~/.cargo/bin`. Bash tool does not inherit the interactive shell rc — prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` for every `pnpm`/`cargo` command.
- **No Rust changes in this plan.** No new `GitBackend` method, no new Tauri command. Existing `get_diff` / `read_file_content*` are sufficient.
- **Never derive whole-file from a large `context_lines`.** It collapses the file into hunk 0 and breaks `stage_hunk` indices and `changedIndex`. Data-loss class bug.
- `changedIndex` must be numbered over a whole hunk before anything slices or interleaves rows (#61 D7 wire contract, mirrors the backend's `Patch::line_in_hunk`).
- Theme tokens must be added to **both** `src/index.css` `:root` and `SEMANTIC_TOKENS` in `src/features/settings/useSettingsStore.ts`, with `light` calibrated separately. The `dark` column is kept byte-identical to `index.css`.
- Never hardcode a hue — use `oklch(from var(--…) l c h / <alpha>)`.
- Commit style: Conventional Commits, imperative subject under 72 chars, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer.
- E2E runs **only** via `pnpm test:e2e:docker`, never natively, and only once development is finished, only for affected specs.

---

### Task 1: Stronger changed-word highlight tokens

**Files:**
- Modify: `src/index.css:117-123` (add two tokens after the existing `--git-*-gutter` lines)
- Modify: `src/features/settings/useSettingsStore.ts:328-370` (`SEMANTIC_TOKENS`, both modes)
- Modify: `src/design/git-components.tsx:678-681` (`DiffText` tint)
- Test: `src/design/wordDiffRender.test.tsx` (existing file, add one case)

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--git-added-word` and `--git-removed-word`.

- [ ] **Step 1: Write the failing test**

Append to `src/design/wordDiffRender.test.tsx`:

```tsx
it("tints changed words with the dedicated word token, not an inline alpha", () => {
  const rows = flattenDiffRows(
    [
      {
        header: "@@ -1,1 +1,1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "const a = 1;" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "const a = 2;" },
        ],
      },
    ],
    { headerH: 26, rowH: 19 },
  );
  render(<PGWindowedDiff rows={rows} />);
  const marks = screen.getAllByTestId("word-change");
  expect(marks.length).toBeGreaterThan(0);
  for (const m of marks) {
    expect(m.style.background).toContain("--git-added-word");
  }
});
```

Note: that assertion holds for the added row; scope it to the add row by
querying within it if the removed row's marks are also returned — read the
existing cases in the file and follow whichever query style they already use.

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/design/wordDiffRender.test.tsx
```

Expected: FAIL — background contains `oklch(from var(--git-added) l c h / 0.28)`, not the token.

- [ ] **Step 3: Add the tokens to `src/index.css`**

After line 123 (`--git-removed-gutter: …;`) add:

```css
  /* Changed-word emphasis inside an already-tinted add/rem line. Stronger than
     the line background on purpose: the line says "this changed", the word says
     "this is what changed". */
  --git-added-word: oklch(0.55 0.13 155 / 0.55);
  --git-removed-word: oklch(0.52 0.16 25 / 0.55);
```

- [ ] **Step 4: Add the same tokens to `SEMANTIC_TOKENS`**

In `src/features/settings/useSettingsStore.ts`, in the `dark` object next to
`--git-removed-gutter`, add the two lines **byte-identical** to the CSS above:

```ts
    "--git-added-word": "oklch(0.55 0.13 155 / 0.55)",
    "--git-removed-word": "oklch(0.52 0.16 25 / 0.55)",
```

In the `light` object add the light calibration — a light canvas needs a
darker, more saturated word tint to separate from the pale line background:

```ts
    "--git-added-word": "oklch(0.78 0.16 155 / 0.85)",
    "--git-removed-word": "oklch(0.78 0.17 25 / 0.85)",
```

- [ ] **Step 5: Use the tokens in `DiffText`**

Replace the `tint` computation in `src/design/git-components.tsx`:

```tsx
  const tint =
    kind === "add" ? "var(--git-added-word)" : "var(--git-removed-word)";
```

- [ ] **Step 6: Run the diff render tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/design/wordDiffRender.test.tsx src/design/syntaxRender.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/features/settings/useSettingsStore.ts src/design/git-components.tsx src/design/wordDiffRender.test.tsx
git commit -m "feat(diff): stronger changed-word highlight via its own token"
```

---

### Task 2: Persist the diff view mode and add the context mode setting

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts` (`PersistedState`, `DEFAULTS`, `snapshot`)
- Modify: `src/screens/DiffViewer.tsx:41` (replace local `useState`), `:294-299` (toggle wiring)
- Modify: `src/screens/Settings.tsx:210-225` (controls + relabel)
- Test: `src/features/settings/useSettingsStore.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PersistedState.diffViewMode: "inline" | "split"` (default `"inline"`) and `PersistedState.diffContextMode: "wholeFile" | "chunks"` (default `"wholeFile"`), both readable via `useSettingsStore((s) => s.diffViewMode)` and writable via `s.set("diffViewMode", v)`. Tasks 4 and 5 consume `diffContextMode`.

- [ ] **Step 1: Write the failing test**

Append to `src/features/settings/useSettingsStore.test.ts`:

```ts
it("defaults to an inline, whole-file diff and round-trips both", () => {
  const s = useSettingsStore.getState();
  expect(s.diffViewMode).toBe("inline");
  expect(s.diffContextMode).toBe("wholeFile");

  s.set("diffViewMode", "split");
  s.set("diffContextMode", "chunks");
  const raw = JSON.parse(localStorage.getItem("pg-settings") as string);
  expect(raw.diffViewMode).toBe("split");
  expect(raw.diffContextMode).toBe("chunks");
});
```

Read the top of the existing test file first and reuse its localStorage key
constant and reset helper rather than hardcoding `"pg-settings"` if it exposes
one.

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/features/settings/useSettingsStore.test.ts
```

Expected: FAIL — `undefined` is not `"inline"`.

- [ ] **Step 3: Add the keys to the store**

In `PersistedState` (next to `diffContextLines`):

```ts
  /** Inline (unified) or side-by-side. Persisted so it is a preference, not a per-visit choice. */
  diffViewMode: "inline" | "split";
  /**
   * Whole file or just the changed chunks. `diffContextLines` still governs the
   * FETCH in both modes — it is what hunk-staging indices are computed against —
   * so this only selects whether the unchanged remainder is filled in for display.
   */
  diffContextMode: "wholeFile" | "chunks";
```

In `DEFAULTS`:

```ts
  diffViewMode: "inline",
  diffContextMode: "wholeFile",
```

In `snapshot`, add both fields alongside `diffContextLines` (the function lists
every key explicitly; a missing key silently stops persisting).

Then add validation in `load()`, next to the `headIndicator` clamp — an unknown
value must not reach the renderer:

```ts
  if (!["inline", "split"].includes(out.diffViewMode as string)) {
    out.diffViewMode = DEFAULTS.diffViewMode;
  }
  if (!["wholeFile", "chunks"].includes(out.diffContextMode as string)) {
    out.diffContextMode = DEFAULTS.diffContextMode;
  }
```

- [ ] **Step 4: Run the test**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/features/settings/useSettingsStore.test.ts
```

Expected: PASS.

- [ ] **Step 5: Point `DiffViewer` at the setting**

In `src/screens/DiffViewer.tsx`, delete the local mode state at line 41 and read
the setting instead. The rest of the file compares against `"unified"`, so map
the persisted name at the boundary rather than renaming 6 call sites:

```tsx
  const diffViewMode = useSettingsStore((s) => s.diffViewMode);
  const setSetting = useSettingsStore((s) => s.set);
  const mode = diffViewMode === "split" ? "split" : "unified";
  const setMode = (v: string) =>
    setSetting("diffViewMode", v === "split" ? "split" : "inline");
```

The existing `PGButtonGroup` at line 294 already calls `setMode(v)`, so its
`onChange={(v) => setMode(v as typeof mode)}` becomes `onChange={setMode}`.
Check line 218's `React.useEffect(..., [mode])` still type-checks.

- [ ] **Step 6: Add the Settings controls**

In `src/screens/Settings.tsx`, near the existing `diffContextLines` field, add a
mode selector for each new key following the file's existing control pattern
(read the surrounding rows and match them — the file uses its own row helpers).
Relabel the context-lines field so it does not read as chunks-only:

> Context lines — used for chunked view, and always for hunk staging

- [ ] **Step 7: Type-check and run the settings tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test -- src/features/settings src/screens/Settings.cli.test.tsx
```

Expected: no type errors, tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/settings/useSettingsStore.ts src/features/settings/useSettingsStore.test.ts src/screens/DiffViewer.tsx src/screens/Settings.tsx
git commit -m "feat(diff): persist inline/split mode, add whole-file context setting"
```

---

### Task 3: Whole-file `fill` rows in the flat row model

This is the correctness-critical task. The invariant under test is that adding
whole-file filler changes **nothing** about hunk rows.

**Files:**
- Modify: `src/lib/diffRows.ts` (add `fill` variant, `wholeFile` option, gap arithmetic)
- Modify: `src/design/PGWindowedDiff.tsx` (render the new row kind)
- Test: `src/lib/diffRows.test.ts`

**Interfaces:**
- Consumes: `DiffRow`, `flattenDiffRows` from Task 0 state (unchanged upstream).
- Produces:
  - `DiffRow` gains `| { kind: "fill"; line: DiffLineData; h: number }`
  - `flattenDiffRows(hunks, o)` where `o` gains
    `wholeFile?: { newText: string | null; oldText: string | null }`
  - Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/diffRows.test.ts`. The existing file has a `hunk(n)` helper —
read it first; these tests need explicit hunk geometry, so define a local
builder:

```ts
function h(o: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<["ctx" | "add" | "rem", number | null, number | null, string]>;
}) {
  const kindOf = { ctx: "Context", add: "Addition", rem: "Deletion" } as const;
  return {
    header: `@@ -${o.oldStart},${o.oldLines} +${o.newStart},${o.newLines} @@`,
    oldStart: o.oldStart,
    oldLines: o.oldLines,
    newStart: o.newStart,
    newLines: o.newLines,
    lines: o.lines.map(([k, ol, nl, content]) => ({
      kind: { kind: kindOf[k] },
      oldLineno: ol,
      newLineno: nl,
      content,
    })),
  };
}

// A 6-line file where only line 4 changed, fetched with 0 context lines.
const oneChange = [
  h({
    oldStart: 4,
    oldLines: 1,
    newStart: 4,
    newLines: 1,
    lines: [
      ["rem", 4, null, "old four"],
      ["add", null, 4, "new four"],
    ],
  }),
];
const NEW_TEXT = "one\ntwo\nthree\nnew four\nfive\nsix";
const OLD_TEXT = "one\ntwo\nthree\nold four\nfive\nsix";

describe("flattenDiffRows whole-file mode", () => {
  it("fills the leading, and trailing, unchanged regions", () => {
    const rows = flattenDiffRows(oneChange, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: NEW_TEXT, oldText: OLD_TEXT },
    });
    const fills = rows.filter((r) => r.kind === "fill");
    expect(fills.map((f) => f.line.text)).toEqual([
      "one",
      "two",
      "three",
      "five",
      "six",
    ]);
  });

  it("numbers filler rows on both sides", () => {
    const rows = flattenDiffRows(oneChange, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: NEW_TEXT, oldText: OLD_TEXT },
    });
    const fills = rows.filter((r) => r.kind === "fill");
    expect(fills.map((f) => [f.line.lnL, f.line.lnR])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [5, 5],
      [6, 6],
    ]);
  });

  it("leaves hunk rows byte-identical to chunked mode", () => {
    const plain = flattenDiffRows(oneChange, { headerH: 26, rowH: 19 });
    const whole = flattenDiffRows(oneChange, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: NEW_TEXT, oldText: OLD_TEXT },
    });
    expect(whole.filter((r) => r.kind !== "fill")).toEqual(plain);
  });

  it("handles a pure-deletion hunk, whose new side is zero-length", () => {
    // Old lines 4-5 deleted from a 6-line file. Git writes +3,0 — the line
    // BEFORE the deletion — so the effective new position is 4, not 3.
    const rows = flattenDiffRows(
      [
        h({
          oldStart: 4,
          oldLines: 2,
          newStart: 3,
          newLines: 0,
          lines: [
            ["rem", 4, null, "four"],
            ["rem", 5, null, "five"],
          ],
        }),
      ],
      {
        headerH: 26,
        rowH: 19,
        wholeFile: { newText: "one\ntwo\nthree\nsix", oldText: "one\ntwo\nthree\nfour\nfive\nsix" },
      },
    );
    const fills = rows.filter((r) => r.kind === "fill");
    expect(fills.map((f) => [f.line.lnL, f.line.lnR, f.line.text])).toEqual([
      [1, 1, "one"],
      [2, 2, "two"],
      [3, 3, "three"],
      [6, 4, "six"],
    ]);
  });

  it("handles a pure-addition hunk, whose old side is zero-length", () => {
    const rows = flattenDiffRows(
      [
        h({
          oldStart: 3,
          oldLines: 0,
          newStart: 4,
          newLines: 1,
          lines: [["add", null, 4, "inserted"]],
        }),
      ],
      {
        headerH: 26,
        rowH: 19,
        wholeFile: { newText: "one\ntwo\nthree\ninserted\nfour", oldText: "one\ntwo\nthree\nfour" },
      },
    );
    const fills = rows.filter((r) => r.kind === "fill");
    expect(fills.map((f) => [f.line.lnL, f.line.lnR, f.line.text])).toEqual([
      [1, 1, "one"],
      [2, 2, "two"],
      [3, 3, "three"],
      [4, 5, "four"],
    ]);
  });

  it("falls back to chunked rows when the text is too short to fill the gap", () => {
    const rows = flattenDiffRows(oneChange, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: "one\ntwo", oldText: "one\ntwo" },
    });
    expect(rows.some((r) => r.kind === "fill")).toBe(false);
    expect(rows).toEqual(flattenDiffRows(oneChange, { headerH: 26, rowH: 19 }));
  });

  it("falls back to chunked rows when the two sides disagree on the gap length", () => {
    const bad = [
      h({
        oldStart: 4,
        oldLines: 1,
        newStart: 9,
        newLines: 1,
        lines: [
          ["rem", 4, null, "old four"],
          ["add", null, 9, "new four"],
        ],
      }),
    ];
    const rows = flattenDiffRows(bad, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: NEW_TEXT, oldText: OLD_TEXT },
    });
    expect(rows.some((r) => r.kind === "fill")).toBe(false);
  });

  it("renders chunked when there is no text at all", () => {
    const rows = flattenDiffRows(oneChange, {
      headerH: 26,
      rowH: 19,
      wholeFile: { newText: null, oldText: null },
    });
    expect(rows).toEqual(flattenDiffRows(oneChange, { headerH: 26, rowH: 19 }));
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/diffRows.test.ts
```

Expected: FAIL — `wholeFile` is not an accepted option, no `fill` rows produced.

- [ ] **Step 3: Add the `fill` variant and the gap arithmetic**

In `src/lib/diffRows.ts`, extend the row union:

```ts
export type DiffRow =
  | { kind: "header"; hunkIndex: number; header: string; h: number }
  | { kind: "line"; hunkIndex: number; line: DiffLineData; h: number }
  /**
   * An unchanged line OUTSIDE every hunk, synthesized in whole-file mode.
   *
   * A distinct kind rather than a `line` row with a sentinel hunkIndex: consumers
   * look up `hunkActions(row.hunkIndex)` and wire `onLineClick(row.hunkIndex, …)`,
   * and a sentinel number would be one missing guard away from staging the wrong
   * hunk. This variant has no hunkIndex to get wrong.
   */
  | { kind: "fill"; line: DiffLineData; h: number };
```

Then add the helpers:

```ts
/**
 * Effective 1-based file position of a hunk side, normalizing git's zero-length
 * convention.
 *
 * For a pure deletion git writes `+3,0`, meaning "at the line BEFORE which
 * nothing was added" — new content resumes at 4, not 3. Reading `newStart`
 * literally there is an off-by-one that shifts every filler line number after
 * the hunk.
 */
function effStart(start: number, lines: number): number {
  return lines === 0 ? start + 1 : start;
}

/**
 * Context rows covering one unchanged region. Both sides advance together
 * because an unchanged region is identical on both.
 *
 * Returns null when the arithmetic does not check out — a descending range, a
 * gap the two sides disagree about, or a line past the end of the text. A
 * whole-file view with wrong line numbers is worse than no whole-file view, so
 * the caller degrades to chunked instead of rendering something plausible.
 */
function gapRows(o: {
  oldFrom: number;
  newFrom: number;
  count: number;
  lines: string[];
  from: number;
  rowH: number;
}): DiffRow[] | null {
  const { oldFrom, newFrom, count, lines, from, rowH } = o;
  if (count === 0) return [];
  if (count < 0 || oldFrom < 1 || newFrom < 1 || from < 1) return null;
  if (from - 1 + count > lines.length) return null;
  const rows: DiffRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      kind: "fill",
      h: rowH,
      line: {
        kind: "ctx",
        lnL: oldFrom + i,
        lnR: newFrom + i,
        text: lines[from - 1 + i],
      },
    });
  }
  return rows;
}
```

Now rewrite `flattenDiffRows` to build the hunk rows exactly as before, and
interleave filler only when whole-file mode is on **and** every gap validates:

```ts
export function flattenDiffRows(
  hunks: FileDiff["hunks"],
  o: {
    headerH: number;
    rowH: number;
    collapsed?: ReadonlySet<number>;
    syntax?: { old: SyntaxLine[] | null; new: SyntaxLine[] | null };
    /** Whole-file mode. Both texts may be null; filler needs at least one. */
    wholeFile?: { newText: string | null; oldText: string | null };
  },
): DiffRow[] {
  const { headerH, rowH, collapsed, syntax, wholeFile } = o;

  const hunkRows = (h: FileDiff["hunks"][number], hunkIndex: number): DiffRow[] => {
    const rows: DiffRow[] = [
      { kind: "header", hunkIndex, header: h.header, h: headerH },
    ];
    if (collapsed?.has(hunkIndex)) return rows;
    // changedIndex FIRST, over the whole hunk, before anything slices rows.
    const lines = withWordSpans(
      withSyntax(withChangedIndices(h.lines.map(toUiLine)), syntax),
    );
    for (const line of lines) rows.push({ kind: "line", hunkIndex, line, h: rowH });
    return rows;
  };

  const chunked = (): DiffRow[] => hunks.flatMap(hunkRows);

  // Prefer the new side; a deleted file has only the old one. Filler text is an
  // unchanged region, so either side yields the same characters.
  const text = wholeFile?.newText ?? wholeFile?.oldText ?? null;
  if (!wholeFile || text == null) return chunked();
  const useNew = wholeFile.newText != null;
  const textLines = text.split("\n");
  if (textLines.length > MAX_WHOLE_FILE_LINES) return chunked();

  const out: DiffRow[] = [];
  let oldAt = 1;
  let newAt = 1;
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    const oldStart = effStart(h.oldStart, h.oldLines);
    const newStart = effStart(h.newStart, h.newLines);
    const count = newStart - newAt;
    // The same region on both sides must be the same length.
    if (oldStart - oldAt !== count) return chunked();
    const gap = gapRows({
      oldFrom: oldAt,
      newFrom: newAt,
      count,
      lines: textLines,
      from: useNew ? newAt : oldAt,
      rowH,
    });
    if (!gap) return chunked();
    out.push(...gap, ...hunkRows(h, i));
    oldAt = oldStart + h.oldLines;
    newAt = newStart + h.newLines;
  }

  const tailFrom = useNew ? newAt : oldAt;
  const tail = gapRows({
    oldFrom: oldAt,
    newFrom: newAt,
    count: textLines.length - tailFrom + 1,
    lines: textLines,
    from: tailFrom,
    rowH,
  });
  if (!tail) return chunked();
  out.push(...tail);
  return out;
}
```

Add the ceiling constant near the top of the file:

```ts
/**
 * Past this, whole-file mode stays chunked. Inserting a filler row per line of a
 * very large file would fight the performance goal this mode is part of; it also
 * matches the tokenizer's own MAX_HIGHLIGHT_LINES ceiling.
 */
export const MAX_WHOLE_FILE_LINES = 20_000;
```

- [ ] **Step 4: Render the new row kind**

In `src/design/PGWindowedDiff.tsx`, inside the `slice.map` callback, add a
branch **before** the existing header/line handling — a filler row has no hunk,
so it gets no selection and no click wiring:

```tsx
        if (row.kind === "fill") {
          return <PGDiffRow key={`f${start + i}`} line={row.line} />;
        }
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/diffRows.test.ts src/design/PGWindowedDiff.test.tsx
pnpm tsc --noEmit
```

Expected: PASS, no type errors. If `tsc` flags an unhandled `"fill"` case in
another consumer, add the same no-op branch there — that exhaustiveness error is
the type system doing its job.

- [ ] **Step 6: Commit**

```bash
git add src/lib/diffRows.ts src/lib/diffRows.test.ts src/design/PGWindowedDiff.tsx
git commit -m "feat(diff): compose a whole-file view from gap-filled context rows"
```

---

### Task 4: Wire whole-file mode into the four diff surfaces

**Files:**
- Modify: `src/lib/syntax/useDiffSyntax.ts` (expose the texts it already reads)
- Modify: `src/features/diff/CommitDiffPanel.tsx:138,157`
- Modify: `src/screens/CommitPanel.tsx:453,481`
- Modify: `src/screens/DiffViewer.tsx:121,198`
- Modify: `src/screens/RepoBrowser.tsx:574,595`
- Test: `src/features/diff/CommitDiffPanel.wholeFile.test.tsx` (create)

**Interfaces:**
- Consumes: `flattenDiffRows`'s `wholeFile` option and `MAX_WHOLE_FILE_LINES` from Task 3; `diffContextMode` from Task 2.
- Produces: `DiffSyntax` gains `oldText: string | null` and `newText: string | null`.

- [ ] **Step 1: Write the failing test**

Create `src/features/diff/CommitDiffPanel.wholeFile.test.tsx`. Read
`CommitDiffPanel.syntax.test.tsx` first and copy its harness — it already mocks
`read_file_content_at_rev` and renders the panel with a diff:

```tsx
it("shows unchanged lines outside the hunk when whole-file mode is on", async () => {
  useSettingsStore.getState().set("diffContextMode", "wholeFile");
  mockInvoke("read_file_content_at_rev", () => ({
    path: "a.ts",
    binary: false,
    text: "one\ntwo\nthree\nnew four\nfive\nsix",
    fromHead: false,
    size: 30,
  }));
  render(<CommitDiffPanel {...props} />);
  // "six" is outside the hunk, so it can only appear via a filler row.
  expect(await screen.findByText("six")).toBeInTheDocument();
});

it("shows only the hunk when the setting says chunks", async () => {
  useSettingsStore.getState().set("diffContextMode", "chunks");
  render(<CommitDiffPanel {...props} />);
  expect(await screen.findByText("new four")).toBeInTheDocument();
  expect(screen.queryByText("six")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/features/diff/CommitDiffPanel.wholeFile.test.tsx
```

Expected: FAIL — "six" is not rendered.

- [ ] **Step 3: Expose the texts from `useDiffSyntax`**

`useDiffSyntax` already reads both sides' whole-file text into its `texts`
state. Widen the returned object so whole-file mode costs no extra IPC:

```ts
export interface DiffSyntax {
  old: SyntaxLine[] | null;
  new: SyntaxLine[] | null;
  /** The text the tokens came from. Exposed so whole-file mode can fill gaps
   *  from it instead of issuing a second read of the same blob. */
  oldText: string | null;
  newText: string | null;
}
```

Update the memo at the end of the hook:

```ts
  return React.useMemo(
    () => ({ old: oldLines, new: newLines, oldText: texts.old, newText: texts.new }),
    [oldLines, newLines, texts.old, texts.new],
  );
```

Update `EMPTY` to `{ old: null, new: null, oldText: null, newText: null }`.

- [ ] **Step 4: Thread it through each surface**

The four surfaces all follow the same shape: they call `useDiffSyntax(...)` and
pass `syntax` into `flattenDiffRows`. In each one, read the setting and pass
`wholeFile`. `CommitDiffPanel.tsx` (around line 157) becomes:

```tsx
  const diffContextMode = useSettingsStore((s) => s.diffContextMode);
  // …
      flattenDiffRows(current && !current.binary ? current.hunks : [], {
        // …existing options…
        wholeFile:
          diffContextMode === "wholeFile"
            ? { newText: syntax.newText, oldText: syntax.oldText }
            : undefined,
      }),
```

Add `diffContextMode` and `syntax.newText` / `syntax.oldText` to that `useMemo`'s
dependency array. Apply the identical change at
`src/screens/CommitPanel.tsx:481`, `src/screens/RepoBrowser.tsx:595`, and
`src/screens/DiffViewer.tsx:198`.

**`DiffViewer` has one extra rule.** Its find-in-diff filter rewrites
`findFiltered.hunks` down to matching lines only, so the result is a match list,
not a file. Filler rows are never matches and must be suppressed while a query
is active:

```tsx
        wholeFile:
          diffContextMode === "wholeFile" && !findQuery.trim()
            ? { newText: syntax.newText, oldText: syntax.oldText }
            : undefined,
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/features/diff src/screens/CommitPanel.lineStaging.test.tsx src/screens/RepoBrowser.staging.test.tsx src/screens/History.diff.test.tsx
pnpm tsc --noEmit
```

Expected: PASS. `CommitPanel.lineStaging.test.tsx` is the one that matters most —
it pins that clicking a line stages the right index, which whole-file mode must
not disturb.

- [ ] **Step 6: Commit**

```bash
git add src/lib/syntax/useDiffSyntax.ts src/features/diff src/screens/CommitPanel.tsx src/screens/DiffViewer.tsx src/screens/RepoBrowser.tsx
git commit -m "feat(diff): show the whole file by default on every diff surface"
```

---

### Task 5: Tokenize in a Worker, with a packed transfer and a main-thread fallback

**Files:**
- Create: `src/lib/syntax/tokenizeCore.ts` (worker-safe: guards, Shiki call, pack/unpack)
- Create: `src/lib/syntax/tokenize.worker.ts`
- Modify: `src/lib/syntax/tokenize.ts` (cache + client + fallback; keeps its signature)
- Test: `src/lib/syntax/tokenizeCore.test.ts` (create)

**Interfaces:**
- Consumes: `SyntaxLine`, `SyntaxToken`.
- Produces:
  - `tokenizeCore.ts`: `PackedSyntax`, `packLines(lines): PackedSyntax`,
    `unpackLines(p): SyntaxLine[]`, `tokenizeToPacked(path, text): Promise<PackedSyntax | null>`,
    plus `MAX_HIGHLIGHT_BYTES` / `MAX_HIGHLIGHT_LINES` / `toLineRelative` moved here.
  - `tokenize.ts`: `tokenizeFile(path, text): Promise<SyntaxLine[] | null>` — signature
    unchanged, so `useSyntax` / `useDiffSyntax` and their tests need no edits. It
    re-exports the moved symbols so existing `from "./tokenize"` imports keep working.

- [ ] **Step 1: Write the failing test**

Create `src/lib/syntax/tokenizeCore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { packLines, unpackLines, type PackedSyntax } from "./tokenizeCore";
import type { SyntaxLine } from "./tokenize";

const lines: SyntaxLine[] = [
  [
    { start: 0, end: 5, cls: "pg-kw" },
    { start: 6, end: 7, cls: "pg-id" },
  ],
  [],
  [{ start: 0, end: 3, cls: "pg-kw" }],
];

describe("packed syntax transfer", () => {
  it("round-trips tokens through the flat arrays", () => {
    expect(unpackLines(packLines(lines))).toEqual(lines);
  });

  it("dedupes class names into a table so the payload stays small", () => {
    const p: PackedSyntax = packLines(lines);
    expect(p.classes).toEqual(["pg-kw", "pg-id"]);
    expect(p.data).toBeInstanceOf(Int32Array);
  });

  it("preserves empty lines", () => {
    expect(unpackLines(packLines([[], []]))).toEqual([[], []]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/syntax/tokenizeCore.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/lib/syntax/tokenizeCore.ts`**

Move `toLineRelative`, `MAX_HIGHLIGHT_BYTES` and `MAX_HIGHLIGHT_LINES` out of
`tokenize.ts` into this file verbatim, then add:

```ts
/**
 * Tokens flattened into transferable arrays.
 *
 * Returning SyntaxLine[] across the worker boundary would structured-clone
 * hundreds of thousands of small objects for a large file, moving the cost onto
 * the main thread instead of removing it. These two Int32Arrays are transferred
 * zero-copy and materialized in one tight pass.
 */
export interface PackedSyntax {
  /** Distinct class names; `data` stores indices into this. */
  classes: string[];
  /** length = lineCount + 1; token-triple index where each line starts. */
  lineStarts: Int32Array;
  /** Flat [start, end, classId] triples. */
  data: Int32Array;
}

export function packLines(lines: SyntaxLine[]): PackedSyntax {
  const classes: string[] = [];
  const ids = new Map<string, number>();
  let total = 0;
  for (const l of lines) total += l.length;
  const data = new Int32Array(total * 3);
  const lineStarts = new Int32Array(lines.length + 1);
  let t = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = t;
    for (const tok of lines[i]) {
      let id = ids.get(tok.cls);
      if (id === undefined) {
        id = classes.length;
        classes.push(tok.cls);
        ids.set(tok.cls, id);
      }
      data[t * 3] = tok.start;
      data[t * 3 + 1] = tok.end;
      data[t * 3 + 2] = id;
      t++;
    }
  }
  lineStarts[lines.length] = t;
  return { classes, lineStarts, data };
}

export function unpackLines(p: PackedSyntax): SyntaxLine[] {
  const out: SyntaxLine[] = [];
  for (let i = 0; i + 1 < p.lineStarts.length; i++) {
    const line: SyntaxLine = [];
    for (let t = p.lineStarts[i]; t < p.lineStarts[i + 1]; t++) {
      line.push({
        start: p.data[t * 3],
        end: p.data[t * 3 + 1],
        cls: p.classes[p.data[t * 3 + 2]],
      });
    }
    out.push(line);
  }
  return out;
}

/**
 * The actual tokenization. Runs in the worker normally, and on the main thread
 * when no worker is available. Resolves null whenever highlighting is not
 * available or not worth it — callers render plain text.
 */
export async function tokenizeToPacked(
  path: string,
  text: string,
): Promise<PackedSyntax | null> {
  const lang = langForPath(path);
  if (!lang) return null;
  if (text.length > MAX_HIGHLIGHT_BYTES) return null;
  if (text.split("\n").length > MAX_HIGHLIGHT_LINES) return null;
  if (!(await ensureLanguage(lang))) return null;
  try {
    const hl = await getHighlighter();
    const { tokens } = hl.codeToTokens(text, {
      lang,
      theme: SENTINEL_THEME_NAME,
    }) as { tokens: RawToken[][] };
    return packLines(toLineRelative(tokens));
  } catch {
    return null;
  }
}
```

Import `langForPath`, `ensureLanguage`, `getHighlighter`, `SENTINEL_THEME_NAME`
and `classForColor` here, and move the `RawToken` interface across too. This
file must not import anything DOM-only — it runs in the worker.

- [ ] **Step 4: Create the worker**

`src/lib/syntax/tokenize.worker.ts`:

```ts
/// <reference lib="webworker" />
// Tokenization runs here so a large file never blocks the main thread. Shiki is
// configured with engine-javascript (no WASM asset), so it is worker-safe.
import { tokenizeToPacked, type PackedSyntax } from "./tokenizeCore";

export interface TokenizeRequest {
  id: number;
  path: string;
  text: string;
}
export interface TokenizeReply {
  id: number;
  packed: PackedSyntax | null;
}

self.onmessage = async (e: MessageEvent<TokenizeRequest>) => {
  const { id, path, text } = e.data;
  const packed = await tokenizeToPacked(path, text);
  const reply: TokenizeReply = { id, packed };
  // Transfer the buffers rather than copying them.
  const transfer = packed ? [packed.lineStarts.buffer, packed.data.buffer] : [];
  (self as unknown as Worker).postMessage(reply, transfer as Transferable[]);
};
```

- [ ] **Step 5: Rewrite `tokenize.ts` as cache + client + fallback**

Keep the existing `hash`, `cache`, `CACHE_MAX`, `remember` and
`clearSyntaxCache` exactly as they are. Replace the body of `tokenizeFile` and
add the client:

```ts
// undefined = not tried yet, null = unavailable (fall back to this thread).
let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, (p: PackedSyntax | null) => void>();

function disableWorker() {
  worker?.terminate();
  worker = null;
  // Nobody is coming to answer these. Resolve them so no caller waits forever;
  // they fall back to this thread on the retry below.
  const waiting = [...pending.values()];
  pending.clear();
  for (const resolve of waiting) resolve(null);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL("./tokenize.worker.ts", import.meta.url), {
      type: "module",
    });
    w.onmessage = (e: MessageEvent<TokenizeReply>) => {
      const resolve = pending.get(e.data.id);
      if (resolve) {
        pending.delete(e.data.id);
        resolve(e.data.packed);
      }
    };
    // A failed script load or a worker crash lands here. Degrading to the main
    // thread means the worst case is the behaviour we had before it existed.
    w.onerror = disableWorker;
    w.onmessageerror = disableWorker;
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/**
 * Tokenize a whole file. Resolves null whenever highlighting is not available
 * or not worth it. Callers treat null as "render plain text".
 *
 * The heavy work happens in a Worker, so switching files while a large one is
 * still tokenizing does not block the UI. Results are cached on THIS thread, so
 * a hit never crosses the boundary.
 */
export async function tokenizeFile(
  path: string,
  text: string,
): Promise<SyntaxLine[] | null> {
  const lang = langForPath(path);
  if (!lang) return null;
  if (text.length > MAX_HIGHLIGHT_BYTES) return null;
  if (text.split("\n").length > MAX_HIGHLIGHT_LINES) return null;

  const key = `${lang}:${hash(text)}:${text.length}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const w = getWorker();
  let packed: PackedSyntax | null = null;
  if (w) {
    const id = nextId++;
    packed = await new Promise<PackedSyntax | null>((resolve) => {
      pending.set(id, resolve);
      w.postMessage({ id, path, text } satisfies TokenizeRequest);
    });
  }
  // No worker, or the worker went away mid-request.
  if (!packed && !worker) packed = await tokenizeToPacked(path, text);
  if (!packed) return null;
  return remember(key, unpackLines(packed));
}
```

Re-export the moved symbols at the end of the file so existing imports keep
working:

```ts
export {
  toLineRelative,
  MAX_HIGHLIGHT_BYTES,
  MAX_HIGHLIGHT_LINES,
} from "./tokenizeCore";
```

Note the deliberate asymmetry in the fallback condition: `!worker` is only true
after `disableWorker` ran, so a legitimate `null` result (unknown language,
Shiki failure) is **not** retried on the main thread.

- [ ] **Step 6: Run the syntax tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/syntax
pnpm tsc --noEmit
```

Expected: PASS. jsdom has no `Worker`, so these exercise the main-thread
fallback — which is exactly the path that must keep working.
`tokenize.integration.test.ts` is the one that proves real tokens still come out.

- [ ] **Step 7: Commit**

```bash
git add src/lib/syntax
git commit -m "perf(diff): tokenize syntax in a worker with a packed transfer"
```

---

### Task 6: Preload neighbouring files when a commit opens

**Files:**
- Create: `src/lib/syntax/usePrefetchSyntax.ts`
- Modify: `src/lib/syntax/index.ts` (export it)
- Modify: `src/features/diff/CommitDiffPanel.tsx` (call it)
- Test: `src/lib/syntax/usePrefetchSyntax.test.tsx` (create)

**Interfaces:**
- Consumes: `tokenizeFile` from Task 5, `SideSource` from `useDiffSyntax`.
- Produces: `usePrefetchSyntax({repoId, paths, source, enabled})` — fire-and-forget, returns nothing.

- [ ] **Step 1: Write the failing test**

Create `src/lib/syntax/usePrefetchSyntax.test.tsx`:

```tsx
it("prefetches at most PREFETCH_MAX files and skips the selected one", async () => {
  const reads: string[] = [];
  mockInvoke("read_file_content_at_rev", (args) => {
    reads.push(args.path as string);
    return { path: args.path, binary: false, text: "const a = 1;", fromHead: false, size: 12 };
  });
  renderHook(() =>
    usePrefetchSyntax({
      repoId: "r1",
      paths: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
      source: { kind: "rev", rev: "abc" },
      enabled: true,
    }),
  );
  await waitFor(() => expect(reads.length).toBe(PREFETCH_MAX));
  expect(reads).not.toContain("a.ts");
});
```

Read `src/test/setup.ts` for `mockInvoke`'s exact signature before writing this.

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/syntax/usePrefetchSyntax.test.tsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

```ts
import React from "react";
import { readFileContent, readFileContentAtIndex, readFileContentAtRev } from "@/lib/tauri";
import { tokenizeFile } from "./tokenize";
import type { SideSource } from "./useDiffSyntax";

/**
 * How many neighbours to warm. Each one costs an IPC read, so this stays small:
 * a 200-file commit must not fire 200 reads, and with tokenization already off
 * the main thread this is a nicety rather than the fix for jank.
 */
export const PREFETCH_MAX = 4;

/**
 * Warm the token cache for the files a user is likely to open next.
 *
 * Runs at idle so it never competes with the file the user actually selected,
 * and abandons everything when the commit or selection changes — a superseded
 * prefetch that kept running would fill the LRU with files nobody asked for.
 */
export function usePrefetchSyntax(o: {
  repoId: string | null;
  /** Candidate paths, in list order. The first is assumed already loading. */
  paths: string[];
  source: SideSource;
  enabled: boolean;
}): void {
  const { repoId, enabled } = o;
  const kind = o.source.kind;
  const rev = o.source.kind === "rev" ? o.source.rev : null;
  // Join to a primitive: callers rebuild the array every render, so depending on
  // its identity would restart the prefetch on every render.
  const key = o.paths.join(" ");

  React.useEffect(() => {
    if (!enabled || !repoId || kind === "none") return;
    const targets = key.split(" ").filter(Boolean).slice(1, 1 + PREFETCH_MAX);
    if (targets.length === 0) return;
    let cancelled = false;

    const read = (p: string) => {
      if (kind === "worktree") return readFileContent(repoId, p);
      if (kind === "index") return readFileContentAtIndex(repoId, p);
      return rev ? readFileContentAtRev(repoId, rev, p) : Promise.resolve(null);
    };

    const idle = (fn: () => void) =>
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(fn)
        : setTimeout(fn, 0);

    const handle = idle(() => {
      void (async () => {
        for (const p of targets) {
          if (cancelled) return;
          try {
            const c = await read(p);
            if (cancelled || !c?.text) continue;
            await tokenizeFile(p, c.text);
          } catch {
            // A prefetch failure is not a user-visible error — the real read
            // will surface it if they actually open the file.
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(handle as number);
      else clearTimeout(handle as ReturnType<typeof setTimeout>);
    };
  }, [repoId, kind, rev, key, enabled]);
}
```

Export it from `src/lib/syntax/index.ts`.

- [ ] **Step 4: Call it from `CommitDiffPanel`**

Order the candidate list so the selected file is first (it is already loading,
and the hook skips index 0), then its neighbours:

```tsx
  const prefetchPaths = React.useMemo(() => {
    const others = diffs.map((d) => d.path).filter((p) => p !== current?.path);
    return current ? [current.path, ...others] : others;
  }, [diffs, current?.path]);

  usePrefetchSyntax({
    repoId,
    paths: prefetchPaths,
    source: newSide,
    enabled: !loading && !error,
  });
```

`newSide` is the same `SideSource` the panel already passes to `useDiffSyntax` as
its `new` argument — hoist it to a variable if it is currently written inline.
If `repoId` is not already in scope, read it the same way the existing
`useDiffSyntax` call does.

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- src/lib/syntax src/features/diff
pnpm tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/syntax src/features/diff/CommitDiffPanel.tsx
git commit -m "perf(diff): warm the token cache for a commit's other files"
```

---

### Task 7: Full verification and e2e

**Files:** none modified unless a check fails.

**Interfaces:** none.

- [ ] **Step 1: Full unit + component suite**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test
```

Expected: all PASS. Fix anything red before continuing — do not proceed to e2e
on a red suite.

- [ ] **Step 2: Type-check both projects**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

Expected: clean. The second is a separate gate because the root `tsc` excludes
`e2e/`.

- [ ] **Step 3: Confirm the Rust side is untouched**

```bash
git diff --stat origin/main -- src-tauri
```

Expected: empty. This plan makes no backend change; output here means something
went wrong.

- [ ] **Step 4: Build the e2e snapshot for this worktree**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:docker build
```

Frontend changed, so the snapshot must be rebuilt — the `run` phase silently
tests the old binary otherwise.

- [ ] **Step 5: Run only the affected specs**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:docker run --spec e2e/specs/diff.e2e.ts --spec e2e/specs/staging.e2e.ts
```

List the real filenames from `ls e2e/specs/` first and pick the diff, staging,
commit and settings specs. Never run this natively.

- [ ] **Step 6: Squash and open the PR**

```bash
git reset --soft origin/main
git add -A
git commit -m "feat(diff): whole-file inline diff with off-main-thread highlighting"
git push -u origin feat/inline-whole-file-diff
gh pr create --fill
```

Pin `origin/main`'s SHA before the reset and confirm it has not moved, so the
squash cannot revert a concurrently merged PR.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 Whole file as gap-filled rows | 3 (model), 4 (surfaces) |
| §1 `fill` as a distinct row kind | 3 |
| §1 Correctness guard / degrade to chunked | 3 (four null cases tested) |
| §1 Text from `useDiffSyntax`, no extra IPC | 4 |
| §2 Settings (`diffViewMode`, `diffContextMode`, relabel) | 2 |
| §3 Stronger word tokens, both files, both modes | 1 |
| §4 Worker + fallback | 5 |
| §4 Packed transfer | 5 |
| §4 Preload on commit open | 6 |
| Edge: oversized file ceiling | 3 (`MAX_WHOLE_FILE_LINES`) |
| Edge: find-in-diff suppresses filler | 4 |
| Edge: binary / no text | 3 (null text → chunked), 4 |
| Testing section | 1–6 inline, 7 full gate |

Gap found and closed: the spec's edge case about surfacing a note with a "show
whole file anyway" button for oversized files is **not** implemented — Task 3
silently renders chunked past `MAX_WHOLE_FILE_LINES`. Rather than add UI this
plan does not need, the ceiling is documented in the constant's comment and the
behaviour is a safe degrade. Revisit if it proves confusing in use.

**Placeholder scan:** no TBDs. Three steps deliberately say "read the existing
file and match its pattern" (Task 1 Step 1 query style, Task 2 Step 6 Settings
rows, Task 6 Step 4 `newSide`) because those files own conventions that must be
followed rather than guessed; each names the exact file and what to look for.

**Type consistency:** `PackedSyntax`, `packLines`, `unpackLines`,
`tokenizeToPacked` are named identically in Tasks 5's definition and use.
`wholeFile: { newText, oldText }` matches `DiffSyntax`'s new `newText`/`oldText`
fields in Task 4. `MAX_WHOLE_FILE_LINES` is defined in Task 3 and referenced
only there. `PREFETCH_MAX` is defined and asserted in Task 6.
