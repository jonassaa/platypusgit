# Syntax Highlighting PR3: windowed diff rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop mounting every row of a diff. Flatten a file's hunks into one row array whose heights are known, window it with exact prefix sums, and keep line-level staging, hunk navigation and collapse working — with `wrap` on falling back to rendering everything.

**Architecture:** A diff is not a fixed-pitch list: a hunk header is `calc(26px + var(--row-step))` of density-aware chrome, a code row is `--fs-12 × --lh-code`. Nothing needs measuring though, because both heights are known — so `flattenDiffRows` emits rows tagged with their height and `windowVariable` slices them by prefix sum, returning the same `WindowRange` shape `useWindowedList` already produces. `PGHunk`'s internals split into a header component and a row component, which a new `PGWindowedDiff` reuses so there is no second copy of the row markup.

**Tech Stack:** TypeScript, React 19, Vitest + React Testing Library, WebdriverIO (Docker only).

**Spec:** `docs/superpowers/specs/2026-08-14-syntax-highlighting-diff-virtualization-design.md`

**Depends on:** PR1 and PR2.

## Global Constraints

- Node 22 + pnpm. Prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to any `pnpm`/`cargo` command.
- **`changedIndex` is numbered over the whole hunk, before any windowing.** It is the wire contract shared with the backend's `Patch::line_in_hunk` (#61 D7). Numbering a slice stages the wrong line. Highest-severity constraint in the slice.
- `--lh-code` owns code-row geometry. Density (`--row-step`) applies to the hunk header, never to code rows.
- Never hardcode a row height in TypeScript. `--diff-row-h` is declared in CSS and read at runtime — 1.55 × 12px is 18.6px, so any literal is already wrong (#70).
- Scroll to a row **by index**, never via `querySelector`: under windowing the target row is usually not mounted.
- Existing test files listed as guards must pass **unedited**. Editing one to fit means the refactor changed behavior.
- Do not run e2e natively. Only `pnpm test:e2e:docker`.
- Commit style: Conventional Commits, imperative subject under 72 chars.

---

## File Structure

**Created:**
- `src/lib/diffRows.ts` — `flattenDiffRows`, `windowVariable`, and `withChangedIndices` moved here so one definition serves both the flat model and `PGHunk`.
- `src/lib/diffRows.test.ts`
- `src/lib/useDiffRowHeight.ts` — reads `--diff-row-h`.
- `src/design/PGWindowedDiff.tsx` — flat row renderer taking an optional window.
- `src/design/PGWindowedDiff.test.tsx`

**Modified:**
- `src/index.css` — declare `--diff-row-h`.
- `src/design/git-components.tsx` — split `PGHunk` into `PGHunkHeader` + `PGDiffRow`; import `withChangedIndices`.
- `src/design/index.ts` — export `PGWindowedDiff`.
- `src/screens/DiffViewer.tsx` — own the window; render through `PGWindowedDiff`.
- `src/screens/CommitPanel.tsx` — same.
- `src/features/diff/CommitDiffPanel.tsx` — same.

---

### Task 1: `windowVariable` and `flattenDiffRows`

**Files:**
- Create: `src/lib/diffRows.ts`
- Test: `src/lib/diffRows.test.ts`
- Modify: `src/design/git-components.tsx` — move `withChangedIndices` (`:655-662`) out and import it back

**Interfaces:**
- Consumes: `DiffLineData` from `@/design`, `WindowRange` from `@/lib/useWindowedList`, `FileDiff` from `@/lib/types`.
- Produces:
  - `type DiffRow = { kind: "header"; hunkIndex: number; header: string; h: number } | { kind: "line"; hunkIndex: number; line: DiffLineData; h: number }`
  - `withChangedIndices(lines: DiffLineData[]): DiffLineData[]` (moved, unchanged)
  - `flattenDiffRows(hunks: FileDiff["hunks"], o: { headerH: number; rowH: number; collapsed?: ReadonlySet<number> }): DiffRow[]`
  - `windowVariable(heights: number[], o: { scrollTop: number; viewportH: number; overscan: number }): WindowRange`
  - `rowOffset(heights: number[], index: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/diffRows.test.ts
import { describe, expect, it } from "vitest";
import { flattenDiffRows, rowOffset, windowVariable } from "./diffRows";
import type { FileDiff } from "@/lib/types";

const hunk = (n: number): FileDiff["hunks"][number] => ({
  header: `@@ -${n} +${n} @@`,
  lines: [
    { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "ctx" },
    { kind: { kind: "Deletion" }, oldLineno: 2, newLineno: null, content: "old" },
    { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "new" },
  ],
});

describe("flattenDiffRows", () => {
  it("emits a header row then one row per line, per hunk", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { headerH: 26, rowH: 19 });
    expect(rows).toHaveLength(8); // 2 headers + 6 lines
    expect(rows[0]).toMatchObject({ kind: "header", hunkIndex: 0, h: 26 });
    expect(rows[1]).toMatchObject({ kind: "line", hunkIndex: 0, h: 19 });
    expect(rows[4]).toMatchObject({ kind: "header", hunkIndex: 1 });
  });

  it("numbers changedIndex over the WHOLE hunk, skipping context", () => {
    const rows = flattenDiffRows([hunk(1)], { headerH: 26, rowH: 19 });
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines[0].kind === "line" && lines[0].line.changedIndex).toBeUndefined(); // ctx
    expect(lines[1].kind === "line" && lines[1].line.changedIndex).toBe(0); // rem
    expect(lines[2].kind === "line" && lines[2].line.changedIndex).toBe(1); // add
  });

  it("restarts changedIndex per hunk, because the backend counts per hunk", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], { headerH: 26, rowH: 19 });
    const second = rows.filter((r) => r.kind === "line" && r.hunkIndex === 1);
    const indices = second.map((r) => (r.kind === "line" ? r.line.changedIndex : null));
    expect(indices).toEqual([undefined, 0, 1]);
  });

  it("omits the line rows of a collapsed hunk but keeps its header", () => {
    const rows = flattenDiffRows([hunk(1), hunk(2)], {
      headerH: 26,
      rowH: 19,
      collapsed: new Set([0]),
    });
    expect(rows.filter((r) => r.hunkIndex === 0)).toHaveLength(1);
    expect(rows.filter((r) => r.hunkIndex === 1)).toHaveLength(4);
  });

  it("attaches word spans to paired rem/add rows", () => {
    const rows = flattenDiffRows(
      [
        {
          header: "@@ -1 +1 @@",
          lines: [
            { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "let a = 1" },
            { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "let a = 2" },
          ],
        },
      ],
      { headerH: 26, rowH: 19 },
    );
    const lines = rows.filter((r) => r.kind === "line");
    expect(lines[0].kind === "line" && lines[0].line.spans?.some((s) => s.changed)).toBe(true);
  });
});

describe("windowVariable", () => {
  const heights = [26, 19, 19, 19, 26, 19, 19]; // 147px total

  it("renders everything that fits plus overscan", () => {
    const w = windowVariable(heights, { scrollTop: 0, viewportH: 1000, overscan: 0 });
    expect(w.start).toBe(0);
    expect(w.end).toBe(heights.length);
    expect(w.topPad).toBe(0);
    expect(w.bottomPad).toBe(0);
  });

  it("skips rows scrolled past and pads for them exactly", () => {
    // scrollTop 45 is past rows 0 (26) and 1 (19).
    const w = windowVariable(heights, { scrollTop: 45, viewportH: 38, overscan: 0 });
    expect(w.start).toBe(2);
    expect(w.topPad).toBe(45);
  });

  it("keeps topPad + rendered + bottomPad equal to the total height", () => {
    const w = windowVariable(heights, { scrollTop: 45, viewportH: 38, overscan: 1 });
    const rendered = heights.slice(w.start, w.end).reduce((a, b) => a + b, 0);
    const total = heights.reduce((a, b) => a + b, 0);
    expect(w.topPad + rendered + w.bottomPad).toBe(total);
  });

  it("handles an empty list", () => {
    expect(windowVariable([], { scrollTop: 0, viewportH: 100, overscan: 4 })).toEqual({
      start: 0, end: 0, topPad: 0, bottomPad: 0,
    });
  });

  it("renders a screenful before first layout, when the viewport measures 0", () => {
    const w = windowVariable(heights, { scrollTop: 0, viewportH: 0, overscan: 0 });
    expect(w.end).toBeGreaterThan(0);
  });
});

describe("rowOffset", () => {
  it("sums the heights before an index", () => {
    expect(rowOffset([26, 19, 19], 0)).toBe(0);
    expect(rowOffset([26, 19, 19], 2)).toBe(45);
    expect(rowOffset([26, 19, 19], 99)).toBe(64);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$PATH"; pnpm vitest run src/lib/diffRows.test.ts`
Expected: FAIL — cannot resolve `./diffRows`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/diffRows.ts
//
// Flat row model for a file diff, plus an exact variable-height window.
//
// A diff mixes two row heights — a hunk header is density-aware chrome, a code
// row is --fs-12 * --lh-code — so the fixed-pitch useWindowedList does not fit.
// Nothing needs measuring though: both heights are KNOWN, so prefix sums give an
// exact window with no DOM reads and no estimation.
// `DiffLineData` is imported TYPE-ONLY on purpose. src/design/PGWindowedDiff.tsx
// imports DiffRow from this module, so a value import of the design barrel here
// would close a runtime require cycle; `import type` is erased and cannot.
import type { DiffLineData } from "@/design";
import type { WindowRange } from "./useWindowedList";
import type { FileDiff } from "./types";
import { pairChangedLines } from "./pairChangedLines";

export type DiffRow =
  | { kind: "header"; hunkIndex: number; header: string; h: number }
  | { kind: "line"; hunkIndex: number; line: DiffLineData; h: number };

/**
 * Number the changed (+/-) lines of a hunk from 0, leaving context unnumbered.
 *
 * Moved here from git-components so the flat model and PGHunk share ONE
 * definition. It must count exactly the add/rem rows: it is the wire contract
 * shared with the backend's Patch::line_in_hunk, which counts +/- origins the
 * same way, and it is numbered over the WHOLE hunk — numbering a windowed slice
 * would address the wrong line when staging (#61 D7).
 */
export function withChangedIndices(lines: DiffLineData[]): DiffLineData[] {
  let n = 0;
  return lines.map((l) =>
    l.kind === "add" || l.kind === "rem" ? { ...l, changedIndex: n++ } : l,
  );
}

function toUiLine(l: FileDiff["hunks"][number]["lines"][number]): DiffLineData {
  const k = l.kind.kind;
  if (k === "Addition") return { kind: "add", lnR: l.newLineno ?? undefined, text: l.content };
  if (k === "Deletion") return { kind: "rem", lnL: l.oldLineno ?? undefined, text: l.content };
  return {
    kind: "ctx",
    lnL: l.oldLineno ?? undefined,
    lnR: l.newLineno ?? undefined,
    text: l.content,
  };
}

/** Attach intra-line spans to adjacent rem/add runs, using the shared rule. */
function attachWordSpans(lines: DiffLineData[]): DiffLineData[] {
  const out = lines.map((l) => ({ ...l }));
  let i = 0;
  while (i < out.length) {
    if (out[i].kind !== "rem") {
      i++;
      continue;
    }
    let r = i;
    while (r < out.length && out[r].kind === "rem") r++;
    let a = r;
    while (a < out.length && out[a].kind === "add") a++;
    const rem = out.slice(i, r);
    const add = out.slice(r, a);
    if (add.length > 0) {
      const paired = pairChangedLines(
        rem.map((l) => l.text ?? ""),
        add.map((l) => l.text ?? ""),
      );
      paired.forEach((p, k) => {
        if (!p) return;
        out[i + k].spans = p.old;
        out[r + k].spans = p.new;
      });
    }
    i = a > i ? a : i + 1;
  }
  return out;
}

export function flattenDiffRows(
  hunks: FileDiff["hunks"],
  o: { headerH: number; rowH: number; collapsed?: ReadonlySet<number> },
): DiffRow[] {
  const { headerH, rowH, collapsed } = o;
  const rows: DiffRow[] = [];
  hunks.forEach((h, hunkIndex) => {
    rows.push({ kind: "header", hunkIndex, header: h.header, h: headerH });
    if (collapsed?.has(hunkIndex)) return;
    // changedIndex FIRST, over the whole hunk, before anything slices rows.
    const lines = attachWordSpans(withChangedIndices(h.lines.map(toUiLine)));
    for (const line of lines) rows.push({ kind: "line", hunkIndex, line, h: rowH });
  });
  return rows;
}

export function rowOffset(heights: number[], index: number): number {
  let sum = 0;
  for (let i = 0; i < index && i < heights.length; i++) sum += heights[i];
  return sum;
}

/**
 * Window a list of known-height rows. Returns the same shape useWindowedList
 * produces, so consumers and the `window?: WindowRange` prop are unchanged.
 */
export function windowVariable(
  heights: number[],
  o: { scrollTop: number; viewportH: number; overscan: number },
): WindowRange {
  const { scrollTop, overscan } = o;
  if (heights.length === 0) return { start: 0, end: 0, topPad: 0, bottomPad: 0 };
  // Before first layout the viewport measures 0. Render a screenful anyway so
  // the list is never blank on first paint and e2e can find a row immediately.
  const viewportH = o.viewportH || 400;

  let first = 0;
  let acc = 0;
  while (first < heights.length && acc + heights[first] <= scrollTop) {
    acc += heights[first];
    first++;
  }
  let topSum = acc;
  let start = first;
  for (let k = 0; k < overscan && start > 0; k++) {
    start--;
    topSum -= heights[start];
  }

  let end = first;
  let filled = acc - scrollTop; // partial height of the first visible row
  while (end < heights.length && filled < viewportH) {
    filled += heights[end];
    end++;
  }
  for (let k = 0; k < overscan && end < heights.length; k++) end++;

  const total = heights.reduce((a, b) => a + b, 0);
  const rendered = heights.slice(start, end).reduce((a, b) => a + b, 0);
  return { start, end, topPad: topSum, bottomPad: Math.max(0, total - topSum - rendered) };
}
```

In `git-components.tsx`, delete the local `withChangedIndices` and import it from `@/lib/diffRows` so there is exactly one copy.

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run src/lib/diffRows.test.ts src/design/wordDiffRender.test.tsx`
Expected: `diffRows` PASSES (10 tests); `wordDiffRender` PASSES unedited.

- [ ] **Step 5: Commit**

```bash
git add src/lib/diffRows.ts src/lib/diffRows.test.ts src/design/git-components.tsx
git commit -m "feat(diff): flat row model and exact variable-height window"
```

---

### Task 2: `--diff-row-h` and `useDiffRowHeight`

**Files:**
- Modify: `src/index.css`
- Create: `src/lib/useDiffRowHeight.ts`
- Test: `src/lib/useDiffRowHeight.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useDiffRowHeight(): number`, `DIFF_ROW_H_FALLBACK = 19`.

- [ ] **Step 1: Declare the variable in CSS**

Beside the other geometry tokens in `:root`:

```css
  /* Code-row pitch. Derived so --lh-code stays the single owner of code
     geometry; read at runtime by useDiffRowHeight for the diff window's
     arithmetic. Never restate this as a number in TS — 1.55 * 12px is 18.6px,
     so any literal is already wrong (#70). */
  --diff-row-h: calc(var(--fs-12) * var(--lh-code));
```

Apply it as the code row's `height` in `PGDiffRow` (Task 3), replacing `minHeight: 18`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/useDiffRowHeight.test.ts
import { describe, expect, it } from "vitest";
import { readDiffRowHeight, DIFF_ROW_H_FALLBACK } from "./useDiffRowHeight";

describe("readDiffRowHeight", () => {
  it("parses a px value from the custom property", () => {
    document.documentElement.style.setProperty("--diff-row-h", "18.6px");
    expect(readDiffRowHeight()).toBeCloseTo(18.6);
  });

  it("falls back when the property is missing or not resolvable", () => {
    // jsdom does not evaluate calc(), so an unresolved value must not yield NaN
    // and silently zero every row height.
    document.documentElement.style.setProperty("--diff-row-h", "calc(12px * 1.55)");
    expect(readDiffRowHeight()).toBe(DIFF_ROW_H_FALLBACK);
    document.documentElement.style.removeProperty("--diff-row-h");
    expect(readDiffRowHeight()).toBe(DIFF_ROW_H_FALLBACK);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/useDiffRowHeight.test.ts`
Expected: FAIL — cannot resolve `./useDiffRowHeight`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/useDiffRowHeight.ts
import React from "react";
import { useDensityStep } from "@/features/settings/useSettingsStore";

/**
 * Used when --diff-row-h cannot be resolved to px — notably jsdom, which does
 * not evaluate calc(). A fallback, never the source of truth: CSS owns the real
 * value, and returning NaN here would collapse every windowed row to zero.
 */
export const DIFF_ROW_H_FALLBACK = 19;

export function readDiffRowHeight(): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--diff-row-h")
    .trim();
  const n = Number.parseFloat(raw);
  return raw.endsWith("px") && Number.isFinite(n) && n > 0 ? n : DIFF_ROW_H_FALLBACK;
}

/**
 * Code-row pitch in px. Re-read when density changes, because a density switch
 * is also when the theme layer rewrites geometry-adjacent tokens.
 */
export function useDiffRowHeight(): number {
  const step = useDensityStep();
  const [h, setH] = React.useState(() => readDiffRowHeight());
  React.useEffect(() => {
    setH(readDiffRowHeight());
  }, [step]);
  return h;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/useDiffRowHeight.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/lib/useDiffRowHeight.ts src/lib/useDiffRowHeight.test.ts
git commit -m "feat(diff): derive code-row pitch from CSS instead of a literal"
```

---

### Task 3: Split `PGHunk` into header and row components

**Files:**
- Modify: `src/design/git-components.tsx` — `PGHunk` at `:890`, its header block and row loop
- Test: existing `src/design/wordDiffRender.test.tsx`, `src/design/syntaxRender.test.tsx`, `src/screens/CommitPanel.lineStaging.test.tsx` — all must pass **unedited**

**Interfaces:**
- Consumes: nothing new.
- Produces (module-internal, plus exported for `PGWindowedDiff`):
  - `PGHunkHeader(props: { header: string; staged?: boolean; onStage?: () => void; onDiscard?: () => void; expanded: boolean; onToggle?: () => void; actionsDisabledReason?: string; selCount: number })`
  - `PGDiffRow(props: { line: DiffLineData; selected?: boolean; onLineClick?: (changedIndex: number, range: boolean) => void })`
- `PGHunk`'s public props are unchanged.

- [ ] **Step 1: Confirm the guard tests pass before touching anything**

Run: `pnpm vitest run src/design/wordDiffRender.test.tsx src/design/syntaxRender.test.tsx src/screens/CommitPanel.lineStaging.test.tsx`
Expected: PASS. These are the contract for the refactor; note the count.

- [ ] **Step 2: Extract, without changing markup**

Move the header `<div>` PGHunk renders into `PGHunkHeader`, and the per-row `<div>` into `PGDiffRow`, verbatim — same styles, same `data-testid="hunk-stage"`, same `data-pg-row` and selection attributes. Then `PGHunk` becomes:

```tsx
export function PGHunk({
  header, lines = [], staged, onStage, onDiscard, expanded = true, onToggle,
  actionsDisabledReason, selectedLines, onLineClick, syntax,
}: PGHunkProps) {
  const rows = React.useMemo(
    () => attachSyntax(withChangedIndices(lines), syntax),
    [lines, syntax],
  );
  const withSpans = React.useMemo(() => withWordSpans(chunkDiffLines(rows)), [rows]);
  const lineClick = actionsDisabledReason ? undefined : onLineClick;
  const selected = new Set(selectedLines ?? []);
  return (
    <div style={{ borderBottom: "1px solid var(--border-0)" }}>
      <PGHunkHeader
        header={header}
        staged={staged}
        onStage={onStage}
        onDiscard={onDiscard}
        expanded={expanded}
        onToggle={onToggle}
        actionsDisabledReason={actionsDisabledReason}
        selCount={selectedLines?.length ?? 0}
      />
      {expanded &&
        withSpans.flatMap((c) => c.lines).map((line, i) => (
          <PGDiffRow
            key={i}
            line={line}
            selected={line.changedIndex !== undefined && selected.has(line.changedIndex)}
            onLineClick={lineClick}
          />
        ))}
    </div>
  );
}
```

Set the code row's `height: "var(--diff-row-h)"` in `PGDiffRow`, replacing `minHeight: 18`.

- [ ] **Step 3: Run the guard tests again**

Run: `pnpm vitest run src/design/wordDiffRender.test.tsx src/design/syntaxRender.test.tsx src/screens/CommitPanel.lineStaging.test.tsx`
Expected: PASS, same counts, **no edits to any of the three files**. If one fails, the extraction changed behavior — fix the component, not the test.

- [ ] **Step 4: Commit**

```bash
git add src/design/git-components.tsx
git commit -m "refactor(design): split PGHunk into header and row components"
```

---

### Task 4: `PGWindowedDiff`

**Files:**
- Create: `src/design/PGWindowedDiff.tsx`
- Test: `src/design/PGWindowedDiff.test.tsx`
- Modify: `src/design/index.ts`

**Interfaces:**
- Consumes: `DiffRow` (Task 1), `PGHunkHeader`, `PGDiffRow` (Task 3), `WindowRange`.
- Produces: `PGWindowedDiff(props: { rows: DiffRow[]; window?: WindowRange; activeHunk?: number; collapsed?: ReadonlySet<number>; onToggleHunk?: (i: number) => void; hunkActions?: (i: number) => { staged?: boolean; onStage?: () => void; onDiscard?: () => void; actionsDisabledReason?: string }; selectedLines?: (i: number) => number[]; onLineClick?: (hunkIndex: number, changedIndex: number, range: boolean) => void })`

- [ ] **Step 1: Write the failing test**

```tsx
// src/design/PGWindowedDiff.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGWindowedDiff } from "./PGWindowedDiff";
import { flattenDiffRows } from "@/lib/diffRows";
import type { FileDiff } from "@/lib/types";

const bigHunk: FileDiff["hunks"] = [
  {
    header: "@@ -1,50 +1,50 @@",
    lines: Array.from({ length: 50 }, (_, i) => ({
      kind: { kind: i % 2 === 0 ? "Addition" : ("Context" as const) } as never,
      oldLineno: i % 2 === 0 ? null : i + 1,
      newLineno: i + 1,
      content: `line ${i}`,
    })),
  },
];

const rows = flattenDiffRows(bigHunk, { headerH: 26, rowH: 19 });

describe("PGWindowedDiff", () => {
  it("renders every row when no window is given", () => {
    render(<PGWindowedDiff rows={rows} />);
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.getByText("line 49")).toBeInTheDocument();
  });

  it("renders only the windowed slice, with spacers for the rest", () => {
    render(
      <PGWindowedDiff rows={rows} window={{ start: 0, end: 6, topPad: 0, bottomPad: 855 }} />,
    );
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.queryByText("line 49")).not.toBeInTheDocument();
    const spacer = document.querySelector('[data-pg-spacer="bottom"]') as HTMLElement;
    expect(spacer.style.height).toBe("855px");
  });

  it("keeps changedIndex absolute in a windowed slice", () => {
    // Rows 1.. are lines; a mid-list window must still report the hunk-wide
    // index, or line staging targets the wrong line (#61 D7).
    const clicks: Array<[number, number]> = [];
    render(
      <PGWindowedDiff
        rows={rows}
        window={{ start: 20, end: 26, topPad: 387, bottomPad: 500 }}
        onLineClick={(h, c) => clicks.push([h, c])}
      />,
    );
    const target = rows[20];
    if (target.kind !== "line" || target.line.changedIndex === undefined) {
      throw new Error("fixture must put a changed line at index 20");
    }
    screen.getByText(target.line.text!).click();
    expect(clicks[0][1]).toBe(target.line.changedIndex);
  });

  it("marks the active hunk's header for hunk navigation", () => {
    render(<PGWindowedDiff rows={rows} activeHunk={0} />);
    const header = document.querySelector('[data-hunk-index="0"]');
    expect(header).not.toBeNull();
    expect(header?.getAttribute("data-hunk-active")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/design/PGWindowedDiff.test.tsx`
Expected: FAIL — cannot resolve `./PGWindowedDiff`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/design/PGWindowedDiff.tsx
//
// Flat renderer for a file's diff rows, with an optional window.
//
// Reuses PGHunkHeader and PGDiffRow rather than restating their markup, so the
// windowed and unwindowed paths cannot drift. `window` omitted renders
// everything — that is the wrap-on case, where row heights are unknown.
//
// data-hunk-index stays on header rows: F7 navigation and the e2e specs address
// hunks through it, and it must survive windowing.
import React from "react";
import type { DiffRow } from "@/lib/diffRows";
import type { WindowRange } from "@/lib/useWindowedList";
import { PGDiffRow, PGHunkHeader } from "./git-components";

export interface PGWindowedDiffProps {
  rows: DiffRow[];
  window?: WindowRange;
  activeHunk?: number;
  collapsed?: ReadonlySet<number>;
  onToggleHunk?: (hunkIndex: number) => void;
  hunkActions?: (hunkIndex: number) => {
    staged?: boolean;
    onStage?: () => void;
    onDiscard?: () => void;
    actionsDisabledReason?: string;
  };
  selectedLines?: (hunkIndex: number) => number[];
  onLineClick?: (hunkIndex: number, changedIndex: number, range: boolean) => void;
}

export function PGWindowedDiff({
  rows,
  window: win,
  activeHunk,
  collapsed,
  onToggleHunk,
  hunkActions,
  selectedLines,
  onLineClick,
}: PGWindowedDiffProps) {
  const start = win?.start ?? 0;
  const end = win?.end ?? rows.length;
  const slice = rows.slice(start, end);

  return (
    <div>
      {win && win.topPad > 0 && (
        <div data-pg-spacer="top" style={{ height: `${win.topPad}px` }} />
      )}
      {slice.map((row, i) => {
        if (row.kind === "header") {
          const actions = hunkActions?.(row.hunkIndex) ?? {};
          return (
            <div
              key={`h${row.hunkIndex}`}
              data-hunk-index={row.hunkIndex}
              data-hunk-active={activeHunk === row.hunkIndex ? "" : undefined}
            >
              <PGHunkHeader
                header={row.header}
                expanded={!collapsed?.has(row.hunkIndex)}
                onToggle={onToggleHunk ? () => onToggleHunk(row.hunkIndex) : undefined}
                selCount={selectedLines?.(row.hunkIndex).length ?? 0}
                {...actions}
              />
            </div>
          );
        }
        const sel = selectedLines?.(row.hunkIndex) ?? [];
        return (
          <PGDiffRow
            key={`l${start + i}`}
            line={row.line}
            selected={row.line.changedIndex !== undefined && sel.includes(row.line.changedIndex)}
            onLineClick={
              onLineClick
                ? (changedIndex, range) => onLineClick(row.hunkIndex, changedIndex, range)
                : undefined
            }
          />
        );
      })}
      {win && win.bottomPad > 0 && (
        <div data-pg-spacer="bottom" style={{ height: `${win.bottomPad}px` }} />
      )}
    </div>
  );
}
```

Export it from `src/design/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/design/PGWindowedDiff.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/design/PGWindowedDiff.tsx src/design/PGWindowedDiff.test.tsx src/design/index.ts
git commit -m "feat(design): PGWindowedDiff renders a windowed slice of diff rows"
```

---

### Task 5: Adopt it in the three screens

**Files:**
- Modify: `src/screens/DiffViewer.tsx` (unified branch at `:350-369`), `src/screens/CommitPanel.tsx`, `src/features/diff/CommitDiffPanel.tsx`
- Test: `src/screens/DiffViewer.window.test.tsx`

**Interfaces:**
- Consumes: `flattenDiffRows`, `windowVariable`, `rowOffset` (Task 1), `useDiffRowHeight` (Task 2), `PGWindowedDiff` (Task 4), `useDensityStep`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/DiffViewer.window.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockInvoke } from "@/test/invokeMock";
import { DiffViewerScreen } from "./DiffViewer";

const lines = Array.from({ length: 400 }, (_, i) => ({
  kind: { kind: "Context" as const },
  oldLineno: i + 1,
  newLineno: i + 1,
  content: `line ${i}`,
}));

function seed() {
  mockInvoke("get_status", () => [
    { path: "a.ts", index: { kind: "Unmodified" }, worktree: { kind: "Modified" } },
  ]);
  mockInvoke("get_diff", () => ({
    path: "a.ts", binary: false, additions: 0, deletions: 0,
    hunks: [{ header: "@@ -1,400 +1,400 @@", lines }],
  }));
  mockInvoke("read_file_content", () => ({
    path: "a.ts", binary: false, text: "x", fromHead: false, size: 1,
  }));
  mockInvoke("read_file_content_at_rev", () => ({
    path: "a.ts", binary: false, text: "x", fromHead: true, size: 1,
  }));
}

describe("DiffViewer windowing", () => {
  it("mounts far fewer rows than the diff has", async () => {
    seed();
    render(<DiffViewerScreen />);
    await waitFor(() => expect(screen.getByText("line 0")).toBeInTheDocument());
    expect(screen.queryByText("line 399")).not.toBeInTheDocument();
  });

  it("renders every row once wrap is on", async () => {
    seed();
    render(<DiffViewerScreen />);
    await waitFor(() => expect(screen.getByText("line 0")).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText(/wrap/i));
    await waitFor(() => expect(screen.getByText("line 399")).toBeInTheDocument());
  });
});
```

Match the wrap toggle's accessible name to whatever `PGToggle` renders; if it exposes no label, add a `data-testid` to the toggle and query that instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/screens/DiffViewer.window.test.tsx`
Expected: FAIL — `line 399` is in the DOM, because nothing windows yet.

- [ ] **Step 3: Implement in DiffViewer**

```tsx
  const rowH = useDiffRowHeight();
  const densityStep = useDensityStep();
  const headerH = 26 + densityStep;
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<number>>(new Set());

  const rows = React.useMemo(
    () => flattenDiffRows(findFiltered?.hunks ?? [], { headerH, rowH, collapsed }),
    [findFiltered, headerH, rowH, collapsed],
  );
  const heights = React.useMemo(() => rows.map((r) => r.h), [rows]);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportH, setViewportH] = React.useState(0);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setViewportH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wrap makes row heights genuinely unknown, so windowing is off and every row
  // renders — the documented trade-off that keeps the toggle.
  const win = React.useMemo(
    () => (wrap ? undefined : windowVariable(heights, { scrollTop, viewportH, overscan: 8 })),
    [wrap, heights, scrollTop, viewportH],
  );
```

Render the unified branch as:

```tsx
<FocusableScroll
  style={{ flex: 1 }}
  ariaLabel="Diff"
  ref={scrollRef}
  onScroll={() => setScrollTop(scrollRef.current?.scrollTop ?? 0)}
>
  <PGWindowedDiff rows={rows} window={win} activeHunk={hunkCursor} collapsed={collapsed}
    onToggleHunk={(i) => setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    })} />
</FocusableScroll>
```

If `FocusableScroll` does not forward a ref or `onScroll`, wrap it in a plain `div` that owns both rather than changing the keymap primitive.

- [ ] **Step 4: Make F7 hunk navigation scroll by index**

`useHunkNav` moves `hunkCursor`; scroll to the hunk's header row by offset, never by `querySelector` — under windowing that row is usually not mounted:

```tsx
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || hunkCursor == null) return;
    const rowIndex = rows.findIndex((r) => r.kind === "header" && r.hunkIndex === hunkCursor);
    if (rowIndex < 0) return;
    const top = rowOffset(heights, rowIndex);
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - headerH) {
      el.scrollTop = top;
    }
  }, [hunkCursor, rows, heights, headerH]);
```

- [ ] **Step 5: Repeat for CommitPanel and CommitDiffPanel**

Same four pieces — `rowH`/`headerH`, `rows`, the scroll/window state, and `PGWindowedDiff`. CommitPanel additionally passes `hunkActions` (its stage/discard handlers, keyed by hunk index) and `selectedLines`/`onLineClick` for line staging; those handlers already exist on the screen and change only in that they now take `hunkIndex` as their first argument. `CommitDiffPanel` passes neither — it is read-only.

- [ ] **Step 6: Run the full front-end gate**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm tsc --noEmit
pnpm test
```
Expected: all PASS, including `CommitPanel.lineStaging.test.tsx` unedited — that suite is the guard that staging still addresses the right line.

- [ ] **Step 7: Commit**

```bash
git add src/screens/DiffViewer.tsx src/screens/CommitPanel.tsx src/features/diff/CommitDiffPanel.tsx src/screens/DiffViewer.window.test.tsx
git commit -m "perf(diff): window diff rows in the three diff surfaces

Why: a large diff mounted every row, and syntax spans multiply the node count
per row. Heights are known, so the window is exact arithmetic with no DOM
measurement. Wrap makes heights unknown and falls back to rendering all rows."
```

---

### Task 6: E2E

**Files:**
- Modify (only if a spec proves to need it): `e2e/specs/history-diff.e2e.ts`, `e2e/specs/keymap.e2e.ts`, `e2e/specs/keyboard-shortcuts.e2e.ts`

- [ ] **Step 1: Read the e2e skill first**

Read `.claude/skills/e2e-testing/SKILL.md` before touching a spec — selector conventions, the 5s-per-command penalty, and rebuild discipline.

- [ ] **Step 2: Rebuild this worktree's snapshot**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm test:e2e:docker build
```
Never rely on a stale snapshot: the `run` phase silently tests the old binary.

- [ ] **Step 3: Run the three specs that touch diff rows**

```bash
pnpm test:e2e:docker run --spec e2e/specs/history-diff.e2e.ts --spec e2e/specs/keymap.e2e.ts --spec e2e/specs/keyboard-shortcuts.e2e.ts
```
Expected: PASS.

- [ ] **Step 4: Fix any failure at its real cause**

Windowing puts rows off-DOM, so a spec that asserted on a row far down the list now needs to scroll first, or to assert against `[data-hunk-index]` which survives windowing. Prefer changing how the spec reaches the row over weakening the assertion. If a diff row genuinely cannot be reached, that is a product bug in the windowing, not a test problem.

- [ ] **Step 5: Typecheck the e2e project if any spec changed**

```bash
pnpm exec tsc -p e2e/tsconfig.json --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add e2e/
git commit -m "test(e2e): reach diff rows through the window"
```

---

## Self-Review

**Spec coverage.** `flattenDiffRows` and `windowVariable` (Task 1), `--diff-row-h` read rather than hardcoded (Task 2), the `PGHunk` split the spec calls for (Task 3), `PGWindowedDiff` with the `window?: WindowRange` convention (Task 4), screen adoption plus wrap fallback and index-based hunk scrolling (Task 5), the three e2e specs (Task 6). `changedIndex` before windowing is enforced in Task 1's implementation, asserted in Task 1's third test and Task 4's third test, and guarded end to end by `CommitPanel.lineStaging.test.tsx` in Task 5.

**Placeholders.** Three steps say "if the existing primitive does not support X, do Y instead" (Task 5's `FocusableScroll` ref, Task 5's wrap-toggle label, Task 6's spec fixes). Each names the file and gives the fallback, so neither branch is undefined work.

**Type consistency.** `DiffRow` from Task 1 is what `PGWindowedDiff.rows` takes in Task 4 and what Task 5's `flattenDiffRows` call produces. `windowVariable` returns `WindowRange` — the same type `useWindowedList` produces and `PGWindowedDiff.window` accepts. `PGHunkHeader` and `PGDiffRow`, extracted in Task 3, are consumed with exactly those prop names in Task 4. `withChangedIndices` lives only in `@/lib/diffRows` after Task 1, imported by `git-components.tsx`.
