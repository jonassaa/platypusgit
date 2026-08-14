# Syntax Highlighting PR2: remaining surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring highlighting and word diff to the surfaces PR1 did not reach — split view (with the pairing fix that makes its columns line up), `CommitDiffPanel`, and both merge-window panes — extracting the two helpers that four call sites now need.

**Architecture:** The rem↔add pairing rule moves out of `PGHunk` into `pairChangedLines`, so split view, the commit-diff panel and the hunk renderer share one definition. A `useDiffSyntax` hook replaces the two ad-hoc fetch effects PR1 left behind. The merge result pane cannot re-tokenize synchronously per keystroke, so it gets a CodeMirror `StateField` of syntax decorations refreshed on a 120 ms debounce — the same `--syn-*` classes as everywhere else.

**Tech Stack:** TypeScript, React 19, CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Vitest + React Testing Library, `shiki`.

**Spec:** `docs/superpowers/specs/2026-08-14-syntax-highlighting-diff-virtualization-design.md`

**Depends on:** PR1 (`src/lib/syntax/`, `buildLineSpans`, `--syn-*`, the `DiffText` rewrite) — shipped in #106.

**Carried over from executing PR1** (apply these here, they are not hypothetical):

- Mock `@/lib/syntax/tokenize`, never the `@/lib/syntax` barrel — see the note in Task 4.
- A `vi.mock` factory is hoisted above the module body, so a `const` it dereferences
  must come from `vi.hoisted(...)` or it is still uninitialised when the factory runs.
- `useDiffSyntax`'s old-side read takes the **old** path for a rename
  (`diff?.oldPath ?? path`); HEAD has no blob at the new one. PR1 does this in both
  screens already, so the extraction must preserve it.
- `CommitPanel` and the two diff screens approximate the index with HEAD + worktree,
  because there is no `read_file_content_at_index`. Keep that comment when the
  fetching moves into `useDiffSyntax`.

## Global Constraints

- Node 22 + pnpm. Prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to any `pnpm`/`cargo` command.
- Import UI primitives from `@/design`; path alias `@/` → `src/`.
- Debounce for the merge result pane: `120` ms, verbatim.
- Guards already shipped in `wordDiff.ts` and not to be re-implemented: `MAX_LINE_CHARS = 1000`, `MAX_TOKENS = 200`, `MIN_SIMILARITY = 0.3`.
- `--lh-code` owns code-row geometry; density (`--row-step`) does not apply to code rows.
- A `<PGDialogHost />` must be mounted per window; component tests that render a screen need `WithDialogs` from `@/test/dialog`.
- The merge window must not gain privileged permissions. Nothing in this PR touches `src-tauri/capabilities/`.
- Do not run e2e natively. Only `pnpm test:e2e:docker`.
- Commit style: Conventional Commits, imperative subject under 72 chars.

---

## File Structure

**Created:**
- `src/lib/pairChangedLines.ts` — the rem↔add pairing rule, extracted.
- `src/lib/pairChangedLines.test.ts`
- `src/lib/syntax/useDiffSyntax.ts` — fetch both sides' text and tokenize both.
- `src/features/merge/syntaxDecorations.ts` — CodeMirror syntax decoration field.
- `src/features/merge/syntaxDecorations.test.ts`
- `src/screens/DiffViewer.split.test.tsx`

**Modified:**
- `src/design/git-components.tsx` — `PGHunk` uses `pairChangedLines`; `SideLine` gains `spans`/`syntax`; `PGSideBySideDiff` renders spans.
- `src/screens/DiffViewer.tsx` — `diffToSplit` pairs rem/add; split branch gets syntax.
- `src/screens/CommitPanel.tsx` — adopt `useDiffSyntax`.
- `src/features/diff/CommitDiffPanel.tsx` — new `syntaxRevs` prop, spans, word diff.
- `src/screens/CommitDiff.tsx`, `src/screens/History.tsx` — pass `syntaxRevs`.
- `src/features/merge/SidePane.tsx` — render spans.
- `src/features/merge/MergeWindow.tsx`, `MergeBody.tsx` — thread `path` and tokens.
- `src/features/merge/resultEditor.ts` — register the syntax field.

---

### Task 1: Extract `pairChangedLines`

**Files:**
- Create: `src/lib/pairChangedLines.ts`
- Test: `src/lib/pairChangedLines.test.ts`
- Modify: `src/design/git-components.tsx` — `withWordSpans` at `:673`

**Interfaces:**
- Consumes: `wordDiff`, `WordSpan` from `@/lib/wordDiff`.
- Produces: `pairChangedLines(rem: string[], add: string[]): Array<{ old: WordSpan[]; new: WordSpan[] } | null>` — one entry per paired index, `null` where `wordDiff` declined.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/pairChangedLines.test.ts
import { describe, expect, it } from "vitest";
import { pairChangedLines } from "./pairChangedLines";

describe("pairChangedLines", () => {
  it("pairs the i-th removal with the i-th addition", () => {
    const out = pairChangedLines(["let a = 1"], ["let a = 2"]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBeNull();
    expect(out[0]!.old.some((s) => s.changed)).toBe(true);
    expect(out[0]!.new.some((s) => s.changed)).toBe(true);
  });

  it("pairs only min(rem, add) lines", () => {
    expect(pairChangedLines(["a", "b", "c"], ["a2"])).toHaveLength(1);
    expect(pairChangedLines(["a"], ["a2", "b2", "c2"])).toHaveLength(1);
  });

  it("returns an empty array when either side is empty", () => {
    expect(pairChangedLines([], ["a"])).toEqual([]);
    expect(pairChangedLines(["a"], [])).toEqual([]);
  });

  it("yields null for a pair too dissimilar to be one edited line", () => {
    // wordDiff declines below MIN_SIMILARITY; unrelated rewrites must not be
    // highlighted at random, which reads as noise.
    const out = pairChangedLines(
      ["import { readFile } from 'node:fs/promises'"],
      ["export const TOTALLY_UNRELATED = 42"],
    );
    expect(out[0]).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$PATH"; pnpm vitest run src/lib/pairChangedLines.test.ts`
Expected: FAIL — cannot resolve `./pairChangedLines`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/pairChangedLines.ts
//
// The rem↔add pairing rule for intra-line diff, lifted out of PGHunk so the
// unified hunk renderer, the split view and the commit-diff panel share ONE
// definition instead of three that drift.
//
// The rule: the i-th removed line pairs with the i-th added line, for the first
// min(rem, add) lines. wordDiff itself declines a pair that is too dissimilar to
// be "the same line edited", and those come back null.
import { wordDiff, type WordSpan } from "./wordDiff";

export interface LinePairSpans {
  old: WordSpan[];
  new: WordSpan[];
}

export function pairChangedLines(
  rem: string[],
  add: string[],
): Array<LinePairSpans | null> {
  const n = Math.min(rem.length, add.length);
  const out: Array<LinePairSpans | null> = [];
  for (let i = 0; i < n; i++) {
    const r = wordDiff(rem[i], add[i]);
    out.push(r ? { old: r.old, new: r.new } : null);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/pairChangedLines.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewire `withWordSpans` onto the helper**

Replace the pairing loop in `git-components.tsx:673-688` with a call, keeping the surrounding chunk walk:

```ts
function withWordSpans(chunks: DiffChunk[]): DiffChunk[] {
  const out = chunks.map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l })) }));
  for (let i = 0; i + 1 < out.length; i++) {
    const rem = out[i];
    const add = out[i + 1];
    if (rem.kind !== "rem" || add.kind !== "add") continue;
    const paired = pairChangedLines(
      rem.lines.map((l) => l.text ?? ""),
      add.lines.map((l) => l.text ?? ""),
    );
    paired.forEach((p, k) => {
      if (!p) return;
      rem.lines[k].spans = p.old;
      add.lines[k].spans = p.new;
    });
  }
  return out;
}
```

- [ ] **Step 6: Verify the existing render test still passes untouched**

Run: `pnpm vitest run src/design/wordDiffRender.test.tsx src/design/syntaxRender.test.tsx`
Expected: both PASS with no edits to either file. This is a pure refactor; if a test needs changing, the extraction changed behavior.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pairChangedLines.ts src/lib/pairChangedLines.test.ts src/design/git-components.tsx
git commit -m "refactor(diff): extract pairChangedLines for reuse across surfaces"
```

---

### Task 2: `useDiffSyntax`

**Files:**
- Create: `src/lib/syntax/useDiffSyntax.ts`
- Modify: `src/lib/syntax/index.ts` (export it), `src/screens/DiffViewer.tsx`, `src/screens/CommitPanel.tsx` (replace PR1's inline effects)

**Interfaces:**
- Consumes: `useSyntax` (PR1), `readFileContent`, `readFileContentAtRev` from `@/lib/tauri`.
- Produces: `useDiffSyntax(o: { repoId: string | null; path: string | null; oldRev: string | null; newRev: string | null }): { old: SyntaxLine[] | null; new: SyntaxLine[] | null }`. `newRev: null` means "the worktree copy".

- [ ] **Step 1: Write the implementation**

No dedicated unit test: it is composition over `useSyntax`, which PR1 tested, and Task 3/4's screen tests exercise it end to end. Reviewing it means reading it.

```ts
// src/lib/syntax/useDiffSyntax.ts
import React from "react";
import { readFileContent, readFileContentAtRev } from "@/lib/tauri";
import { useSyntax } from "./useSyntax";
import type { SyntaxLine } from "./tokenize";

/**
 * Tokens for both sides of a file diff.
 *
 * Whole-file text per side, not hunk text: a hunk is a window into a file, and a
 * block comment or template literal opening above it would mis-colour every line
 * below. `oldRev: null` means the side does not exist (an added file);
 * `newRev: null` means the working-tree copy.
 *
 * A failed read yields no tokens for that side, and those rows render plain — a
 * missing blob must never break a diff.
 */
export function useDiffSyntax(o: {
  repoId: string | null;
  path: string | null;
  oldRev: string | null;
  newRev: string | null;
}): { old: SyntaxLine[] | null; new: SyntaxLine[] | null } {
  const { repoId, path, oldRev, newRev } = o;
  const [texts, setTexts] = React.useState<{ old: string | null; new: string | null }>({
    old: null,
    new: null,
  });

  React.useEffect(() => {
    setTexts({ old: null, new: null });
    if (!repoId || !path) return;
    let cancelled = false;
    const read = (rev: string | null) =>
      rev === null
        ? readFileContent(repoId, path).catch(() => null)
        : readFileContentAtRev(repoId, rev, path).catch(() => null);
    Promise.all([oldRev === null ? Promise.resolve(null) : read(oldRev), read(newRev)]).then(
      ([o2, n]) => {
        if (!cancelled) setTexts({ old: o2?.text ?? null, new: n?.text ?? null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [repoId, path, oldRev, newRev]);

  const oldLines = useSyntax(path, texts.old);
  const newLines = useSyntax(path, texts.new);
  return React.useMemo(() => ({ old: oldLines, new: newLines }), [oldLines, newLines]);
}
```

- [ ] **Step 2: Adopt it in DiffViewer and CommitPanel**

Delete the inline `sides` effect and the two `useSyntax` calls PR1 added to each screen, and replace with:

```ts
  const syntax = useDiffSyntax({
    repoId: repo?.id ?? null,
    path: current?.path ?? null,
    oldRev: "HEAD",
    newRev: null, // worktree
  });
```

- [ ] **Step 3: Verify PR1's screen test still passes**

Run: `pnpm vitest run src/screens/DiffViewer.syntax.test.tsx`
Expected: PASS unchanged — same commands, same `HEAD` revspec.

- [ ] **Step 4: Commit**

```bash
git add src/lib/syntax/useDiffSyntax.ts src/lib/syntax/index.ts src/screens/DiffViewer.tsx src/screens/CommitPanel.tsx
git commit -m "refactor(syntax): share both-sides token fetching via useDiffSyntax"
```

---

### Task 3: Split view — pair the columns, then highlight them

**Files:**
- Modify: `src/screens/DiffViewer.tsx` — `diffToSplit` at `:398-439`, split branch at `:370-372`
- Modify: `src/design/git-components.tsx` — `SideLine` at `:830`, `PGSideBySideDiff` at `:836`
- Test: `src/screens/DiffViewer.split.test.tsx`

**Interfaces:**
- Consumes: `pairChangedLines` (Task 1), `useDiffSyntax` (Task 2), `buildLineSpans` (PR1).
- Produces: `SideLine` gains `spans?: WordSpan[]` and `syntax?: SyntaxToken[]`; `PGSideBySideDiff` unchanged in signature.

- [ ] **Step 1: Write the failing test**

```tsx
// src/screens/DiffViewer.split.test.tsx
import { describe, expect, it } from "vitest";
import { diffToSplit } from "./DiffViewer";
import type { FileDiff } from "@/lib/types";

const diff = (lines: FileDiff["hunks"][number]["lines"]): FileDiff => ({
  path: "a.ts",
  binary: false,
  additions: 0,
  deletions: 0,
  hunks: [{ header: "@@ -1 +1 @@", lines }],
});

const rem = (n: number, content: string) => ({
  kind: { kind: "Deletion" as const }, oldLineno: n, newLineno: null, content,
});
const add = (n: number, content: string) => ({
  kind: { kind: "Addition" as const }, oldLineno: null, newLineno: n, content,
});
const ctx = (n: number, content: string) => ({
  kind: { kind: "Context" as const }, oldLineno: n, newLineno: n, content,
});

describe("diffToSplit", () => {
  it("puts a removal and its matching addition on the SAME row", () => {
    const { left, right } = diffToSplit(diff([rem(1, "let a"), add(1, "let b")]));
    // index 0 is the hunk header row on both sides
    expect(left[1]).toMatchObject({ kind: "rem", text: "let a" });
    expect(right[1]).toMatchObject({ kind: "add", text: "let b" });
    expect(left).toHaveLength(right.length);
  });

  it("pads the shorter side when the runs are uneven", () => {
    const { left, right } = diffToSplit(
      diff([rem(1, "a"), rem(2, "b"), add(1, "a2")]),
    );
    expect(left).toHaveLength(right.length);
    expect(right[2]).toMatchObject({ kind: "empty" });
  });

  it("attaches word spans to paired rows", () => {
    const { left, right } = diffToSplit(diff([rem(1, "let a = 1"), add(1, "let a = 2")]));
    expect(left[1].spans?.some((s) => s.changed)).toBe(true);
    expect(right[1].spans?.some((s) => s.changed)).toBe(true);
  });

  it("keeps context rows aligned on both sides", () => {
    const { left, right } = diffToSplit(diff([ctx(1, "same"), rem(2, "x"), add(2, "y")]));
    expect(left[1]).toMatchObject({ kind: "ctx", text: "same" });
    expect(right[1]).toMatchObject({ kind: "ctx", text: "same" });
    expect(left).toHaveLength(right.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/screens/DiffViewer.split.test.tsx`
Expected: FAIL — `diffToSplit` is not exported, and rows are unpaired.

- [ ] **Step 3: Rewrite `diffToSplit`**

Export it, and walk rem/add runs together instead of emitting each line independently:

```ts
/**
 * Flatten hunks into aligned left/right columns.
 *
 * Removals and additions are collected as RUNS and emitted side by side, so the
 * i-th removal shares a row with the i-th addition. Emitting each line as it
 * came let the columns drift apart on any hunk that mixed both, and paired rows
 * are also what intra-line word diff needs.
 */
export function diffToSplit(d: FileDiff | null): { left: SideLine[]; right: SideLine[] } {
  const left: SideLine[] = [];
  const right: SideLine[] = [];
  if (!d) return { left, right };

  for (const h of d.hunks) {
    left.push({ kind: "info", text: h.header });
    right.push({ kind: "info", text: h.header });

    let remRun: typeof h.lines = [];
    let addRun: typeof h.lines = [];

    const flush = () => {
      if (remRun.length === 0 && addRun.length === 0) return;
      const paired = pairChangedLines(
        remRun.map((l) => l.content),
        addRun.map((l) => l.content),
      );
      const rows = Math.max(remRun.length, addRun.length);
      for (let i = 0; i < rows; i++) {
        const r = remRun[i];
        const a = addRun[i];
        const p = paired[i] ?? null;
        left.push(
          r
            ? { kind: "rem", ln: r.oldLineno ?? undefined, text: r.content, spans: p?.old }
            : { kind: "empty", ln: "", text: "" },
        );
        right.push(
          a
            ? { kind: "add", ln: a.newLineno ?? undefined, text: a.content, spans: p?.new }
            : { kind: "empty", ln: "", text: "" },
        );
      }
      remRun = [];
      addRun = [];
    };

    for (const ln of h.lines) {
      const k = ln.kind.kind;
      if (k === "Deletion") remRun.push(ln);
      else if (k === "Addition") addRun.push(ln);
      else {
        flush();
        left.push({ kind: "ctx", ln: ln.oldLineno ?? undefined, text: ln.content });
        right.push({ kind: "ctx", ln: ln.newLineno ?? undefined, text: ln.content });
      }
    }
    flush();
  }
  return { left, right };
}
```

- [ ] **Step 4: Add `spans`/`syntax` to `SideLine` and render them**

In `git-components.tsx`:

```ts
export interface SideLine {
  kind: DiffLineKind;
  ln?: number | string;
  text?: string;
  /** Intra-line word spans, set by the caller's pairing pass. */
  spans?: WordSpan[];
  /** Line-relative syntax tokens for this row's side. */
  syntax?: SyntaxToken[];
}
```

In `PGSideBySideDiff`'s `col` renderer, replace the bare `{text}` with the same `DiffText` the unified renderer uses, so both paths share one span pipeline:

```tsx
<DiffText text={l.text ?? ""} spans={l.spans} syntax={l.syntax} kind={l.kind} />
```

- [ ] **Step 5: Feed syntax into the split branch of DiffViewer**

The split arrays are built without tokens, so attach them where the screen renders, using the same side rule as the unified path — `rem` reads `old`, everything else reads `new`:

```ts
  const splitWithSyntax = React.useMemo(() => {
    const attach = (rows: SideLine[], side: "old" | "new"): SideLine[] =>
      rows.map((r) => {
        const lines = side === "old" ? syntax.old : syntax.new;
        const n = typeof r.ln === "number" ? r.ln : Number(r.ln);
        if (!lines || !Number.isFinite(n) || n < 1) return r;
        return { ...r, syntax: lines[n - 1] };
      });
    return { left: attach(split.left, "old"), right: attach(split.right, "new") };
  }, [split, syntax]);
```

Render `<PGSideBySideDiff left={splitWithSyntax.left} right={splitWithSyntax.right} />`.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run src/screens/DiffViewer.split.test.tsx src/screens/DiffViewer.syntax.test.tsx`
Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add src/screens/DiffViewer.tsx src/design/git-components.tsx src/screens/DiffViewer.split.test.tsx
git commit -m "feat(diff): align split columns and give them word diff and syntax

Why: emitting adds and removes independently let the two columns drift apart on
any mixed hunk. Pairing runs fixes the alignment and is also the precondition
for intra-line diff in split mode."
```

---

### Task 4: `CommitDiffPanel`

**Files:**
- Modify: `src/features/diff/CommitDiffPanel.tsx` — props at `:9-28`, hunk rows at `:236-260`
- Modify: `src/screens/CommitDiff.tsx`, `src/screens/History.tsx` — pass the new prop
- Test: `src/features/diff/CommitDiffPanel.syntax.test.tsx`

**Interfaces:**
- Consumes: `useDiffSyntax` (Task 2), `pairChangedLines` (Task 1), `buildLineSpans` (PR1).
- Produces: `CommitDiffPanelProps.syntaxRevs?: { repoId: string; oldRev: string | null; newRev: string | null }`.

**Why a new prop:** the panel is presentational — the caller fetches the diffs and it never learns the repo or the revisions. Callers that know them (`CommitDiffScreen`, the History inline panel) pass them; a combined multi-select diff, where "the" old side has no meaning, omits the prop and stays plain. Reusing `PGHunk` here was considered and rejected: it carries the stage/discard chrome this read-only panel deliberately lacks.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/diff/CommitDiffPanel.syntax.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { mockInvoke } from "@/test/invokeMock";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

// Mock the module useSyntax itself imports, NOT the @/lib/syntax barrel.
// Mocking the barrel leaves the hook's own `./tokenize` import untouched, so the
// REAL grammar runs and the fake silently does nothing — this cost a debugging
// round during PR1.
vi.mock("@/lib/syntax/tokenize", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax/tokenize")>()),
  tokenizeFile: async (_p: string, text: string) =>
    text.split("\n").map(() => [{ start: 0, end: 3, cls: "syn-keyword" }]),
}));

const diffs: FileDiff[] = [
  {
    path: "a.ts",
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -1 +1 @@",
        lines: [
          { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "let a" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "let b" },
        ],
      },
    ],
  },
];

describe("CommitDiffPanel syntax", () => {
  it("highlights and word-diffs when given revs", async () => {
    mockInvoke("read_file_content_at_rev", () => ({
      path: "a.ts", binary: false, text: "let a", fromHead: false, size: 5,
    }));
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="t"
        syntaxRevs={{ repoId: "r1", oldRev: "p", newRev: "c" }}
      />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0),
    );
    expect(document.querySelectorAll('[data-testid="word-change"]').length).toBeGreaterThan(0);
  });

  it("renders plain, and reads nothing, without revs", async () => {
    const seen = vi.fn();
    mockInvoke("read_file_content_at_rev", () => {
      seen();
      return { path: "a.ts", binary: false, text: "let a", fromHead: false, size: 5 };
    });
    render(
      <CommitDiffPanel diffs={diffs} loading={false} error={null} header="x" paneIdPrefix="t2" />,
    );
    await waitFor(() => expect(document.querySelectorAll("[data-hunk-index]").length).toBe(1));
    expect(seen).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".syn-keyword").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/diff/CommitDiffPanel.syntax.test.tsx`
Expected: FAIL — `syntaxRevs` is not a prop; no spans render.

- [ ] **Step 3: Implement**

Add the prop, call the hook, and compute per-hunk spans for the selected file:

```ts
  const syntax = useDiffSyntax({
    repoId: syntaxRevs?.repoId ?? null,
    path: syntaxRevs ? (current?.path ?? null) : null,
    oldRev: syntaxRevs?.oldRev ?? null,
    newRev: syntaxRevs?.newRev ?? null,
  });

  /** Word spans per hunk, keyed by the line's index within that hunk. */
  const wordSpansByHunk = React.useMemo(() => {
    return (current?.hunks ?? []).map((h) => {
      const spans = new Map<number, WordSpan[]>();
      let remIdx: number[] = [];
      let addIdx: number[] = [];
      const flush = () => {
        if (remIdx.length && addIdx.length) {
          const paired = pairChangedLines(
            remIdx.map((i) => h.lines[i].content),
            addIdx.map((i) => h.lines[i].content),
          );
          paired.forEach((p, k) => {
            if (!p) return;
            spans.set(remIdx[k], p.old);
            spans.set(addIdx[k], p.new);
          });
        }
        remIdx = [];
        addIdx = [];
      };
      h.lines.forEach((ln, i) => {
        const k = ln.kind.kind;
        if (k === "Deletion") remIdx.push(i);
        else if (k === "Addition") addIdx.push(i);
        else flush();
      });
      flush();
      return spans;
    });
  }, [current]);
```

In the row render (`:253`), replace the bare content with spans, using the same side rule:

```tsx
{h.lines.map((ln, j) => {
  const isRem = ln.kind.kind === "Deletion";
  const sideLines = isRem ? syntax.old : syntax.new;
  const lineNo = isRem ? ln.oldLineno : ln.newLineno;
  const tokens = sideLines && lineNo ? sideLines[lineNo - 1] : undefined;
  const spans = buildLineSpans(ln.content, tokens ?? null, wordSpansByHunk[i]?.get(j));
  return (
    <div key={j} /* keep the existing row styles verbatim */>
      {spans.map((s, k) => (
        <span
          key={k}
          className={s.cls}
          data-testid={s.changed ? "word-change" : undefined}
          style={
            s.changed
              ? {
                  background: isRem
                    ? "oklch(from var(--git-removed) l c h / 0.28)"
                    : "oklch(from var(--git-added) l c h / 0.28)",
                  borderRadius: 2,
                }
              : undefined
          }
        >
          {ln.content.slice(s.start, s.end)}
        </span>
      ))}
    </div>
  );
})}
```

- [ ] **Step 4: Pass `syntaxRevs` from the two callers that know the revs**

In `CommitDiff.tsx` and the History inline panel, pass `{ repoId, oldRev: <parent sha>, newRev: <commit sha> }`. Where the screen already resolves a parent for its `diffCommit` call, reuse that value; where it compares against the worktree, pass `newRev: null`. Leave the multi-select combined diff without the prop.

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run src/features/diff/CommitDiffPanel.syntax.test.tsx src/features/diff/CommitDiffPanel.resize.test.tsx src/features/diff/CommitDiffPanel.skeleton.test.tsx`
Expected: all PASS, the two pre-existing suites unedited.

- [ ] **Step 6: Commit**

```bash
git add src/features/diff/CommitDiffPanel.tsx src/features/diff/CommitDiffPanel.syntax.test.tsx src/screens/CommitDiff.tsx src/screens/History.tsx
git commit -m "feat(diff): highlight and word-diff the commit diff panel"
```

---

### Task 5: Merge window — `SidePane`

**Files:**
- Modify: `src/features/merge/SidePane.tsx` (row render around `:151-175`), `src/features/merge/MergeBody.tsx`, `src/features/merge/MergeWindow.tsx` (has `path` at `:43`)
- Test: `src/features/merge/SidePane.syntax.test.tsx`

**Interfaces:**
- Consumes: `useSyntax` (PR1), `buildLineSpans` (PR1).
- Produces: `SidePane` gains `syntax?: SyntaxLine[] | null`; `MergeBody` gains `path: string` and passes tokens to both panes.

- [ ] **Step 1: Write the failing test**

```tsx
// src/features/merge/SidePane.syntax.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { SidePane } from "./SidePane";

describe("SidePane syntax", () => {
  it("wraps scoped ranges in classed spans, indexed by line", () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <SidePane
        side="ours"
        lines={["let a", "let b"]}
        conflicts={[]}
        regionStates={[]}
        currentConflict={null}
        onAccept={() => {}}
        scrollRef={ref}
        onScroll={() => {}}
        syntax={[
          [{ start: 0, end: 3, cls: "syn-keyword" }],
          [{ start: 0, end: 3, cls: "syn-keyword" }],
        ]}
      />,
    );
    expect(document.querySelectorAll(".syn-keyword")).toHaveLength(2);
  });

  it("renders plain text when there are no tokens", () => {
    const ref = React.createRef<HTMLDivElement>();
    const { container } = render(
      <SidePane
        side="theirs"
        lines={["plain"]}
        conflicts={[]}
        regionStates={[]}
        currentConflict={null}
        onAccept={() => {}}
        scrollRef={ref}
        onScroll={() => {}}
      />,
    );
    expect(container.textContent).toContain("plain");
    expect(document.querySelectorAll(".syn-keyword")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/merge/SidePane.syntax.test.tsx`
Expected: FAIL — no `syntax` prop.

- [ ] **Step 3: Implement**

Add `syntax?: SyntaxLine[] | null` to `SidePane`'s props, and replace the line body at `:173` — currently `{lines[i] === "" ? " " : lines[i]}` — with spans, preserving the empty-line space that keeps row height uniform:

```tsx
<span style={{ flex: 1 }}>
  {lines[i] === "" ? (
    " "
  ) : (
    buildLineSpans(lines[i], syntax?.[i] ?? null, undefined).map((s, k) => (
      <span key={k} className={s.cls}>
        {lines[i].slice(s.start, s.end)}
      </span>
    ))
  )}
</span>
```

In `MergeWindow.tsx`, tokenize both sides from the model it already holds and pass them through `MergeBody`:

```ts
  const oursSyntax = useSyntax(path || null, model ? model.oursLines.join("\n") : null);
  const theirsSyntax = useSyntax(path || null, model ? model.theirsLines.join("\n") : null);
```

- [ ] **Step 4: Run the merge suites**

Run: `pnpm vitest run src/features/merge/`
Expected: the new suite PASSES and `MergeBody.test.tsx` / `MergeWindow.test.tsx` pass unedited.

- [ ] **Step 5: Commit**

```bash
git add src/features/merge/
git commit -m "feat(merge): highlight the ours and theirs panes"
```

---

### Task 6: Merge window — the editable result pane

**Files:**
- Create: `src/features/merge/syntaxDecorations.ts`
- Test: `src/features/merge/syntaxDecorations.test.ts`
- Modify: `src/features/merge/resultEditor.ts` (extensions list at `:156-173`, `createResultEditor` opts at `:144`), `src/features/merge/MergeWindow.tsx` (pass `path`)

**Interfaces:**
- Consumes: `tokenizeFile`, `SyntaxLine` (PR1); `@codemirror/state`, `@codemirror/view`.
- Produces: `syntaxField: StateField<DecorationSet>`, `setSyntaxEffect: StateEffect<DecorationSet>`, `buildSyntaxDecorations(state: EditorState, lines: SyntaxLine[]): DecorationSet`, `syntaxHighlighting(path: string): Extension`.

**Why a decoration field rather than `decorations.compute`:** the existing region decorations use `EditorView.decorations.compute`, which must be synchronous. Tokenization is async, so the tokens arrive as a `StateEffect` into a field instead, and the field maps its ranges through intervening document changes so colors do not smear while the debounce is pending.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/merge/syntaxDecorations.test.ts
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { buildSyntaxDecorations } from "./syntaxDecorations";

function count(set: ReturnType<typeof buildSyntaxDecorations>) {
  let n = 0;
  const iter = set.iter();
  while (iter.value) {
    n++;
    iter.next();
  }
  return n;
}

describe("buildSyntaxDecorations", () => {
  it("maps line-relative tokens onto absolute document ranges", () => {
    const state = EditorState.create({ doc: "let a\nlet b" });
    const set = buildSyntaxDecorations(state, [
      [{ start: 0, end: 3, cls: "syn-keyword" }],
      [{ start: 4, end: 5, cls: "syn-var" }],
    ]);
    expect(count(set)).toBe(2);
    const iter = set.iter();
    expect(iter.from).toBe(0);
    expect(iter.to).toBe(3);
    iter.next();
    // Second line starts at offset 6, so 4-5 becomes 10-11.
    expect(iter.from).toBe(10);
    expect(iter.to).toBe(11);
  });

  it("skips tokens past the end of their line instead of throwing", () => {
    const state = EditorState.create({ doc: "ab" });
    const set = buildSyntaxDecorations(state, [[{ start: 0, end: 99, cls: "syn-type" }]]);
    const iter = set.iter();
    expect(iter.to).toBe(2);
  });

  it("ignores token lines beyond the document", () => {
    const state = EditorState.create({ doc: "ab" });
    const set = buildSyntaxDecorations(state, [
      [{ start: 0, end: 1, cls: "syn-var" }],
      [{ start: 0, end: 1, cls: "syn-var" }],
    ]);
    expect(count(set)).toBe(1);
  });

  it("returns an empty set for no tokens", () => {
    const state = EditorState.create({ doc: "ab" });
    expect(count(buildSyntaxDecorations(state, []))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/merge/syntaxDecorations.test.ts`
Expected: FAIL — cannot resolve `./syntaxDecorations`.

- [ ] **Step 3: Write the implementation**

```ts
// src/features/merge/syntaxDecorations.ts
//
// Syntax highlighting for the editable result pane.
//
// The region decorations next door use EditorView.decorations.compute, which is
// synchronous. Tokenizing is not, so tokens arrive as a StateEffect into a field
// that maps its ranges through document changes — colours therefore shift with
// edits rather than smearing while the debounce is pending.
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { tokenizeFile, type SyntaxLine } from "@/lib/syntax";

/** Re-tokenizing on every keystroke is wasted work; one idle beat is enough. */
const DEBOUNCE_MS = 120;

export const setSyntaxEffect = StateEffect.define<DecorationSet>();

export function buildSyntaxDecorations(
  state: EditorState,
  lines: SyntaxLine[],
): DecorationSet {
  const ranges = [];
  const total = state.doc.lines;
  for (let i = 0; i < lines.length && i < total; i++) {
    const line = state.doc.line(i + 1);
    for (const t of lines[i]) {
      const from = line.from + t.start;
      const to = Math.min(line.from + t.end, line.to);
      if (to <= from) continue;
      ranges.push(Decoration.mark({ class: t.cls }).range(from, to));
    }
  }
  return Decoration.set(ranges, true);
}

const syntaxField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = tr.docChanged ? deco.map(tr.changes) : deco;
    for (const e of tr.effects) if (e.is(setSyntaxEffect)) next = e.value;
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Highlight the result document, re-tokenizing on a debounce after each change.
 * A path whose language is unknown simply never produces decorations.
 */
export function syntaxHighlighting(path: string): Extension {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const refresh = (view: EditorView) => {
    const text = view.state.doc.toString();
    void tokenizeFile(path, text).then((lines) => {
      // Bail if the document moved on: the next debounce will cover it.
      if (!lines || view.state.doc.toString() !== text) return;
      view.dispatch({ effects: setSyntaxEffect.of(buildSyntaxDecorations(view.state, lines)) });
    });
  };

  return [
    syntaxField,
    EditorView.updateListener.of((update) => {
      // First mount also needs one pass, hence the viewportChanged arm.
      if (!update.docChanged && !update.viewportChanged) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        refresh(update.view);
      }, DEBOUNCE_MS);
    }),
  ];
}
```

- [ ] **Step 4: Register it**

In `resultEditor.ts`, add `path: string` to `createResultEditor`'s opts and put `syntaxHighlighting(path)` in the extensions array after `theme`. In `MergeWindow.tsx`, pass the `path` it already holds at `:43`.

- [ ] **Step 5: Run the tests and the type gate**

```bash
export PATH="$HOME/Library/pnpm:$PATH"
pnpm vitest run src/features/merge/
pnpm tsc --noEmit
pnpm test
```
Expected: all PASS, including `resultEditor.test.ts` unedited apart from the new required `path` argument.

- [ ] **Step 6: Run the affected e2e specs in Docker**

```bash
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/merge-window.e2e.ts --spec e2e/specs/history-diff.e2e.ts
```
Expected: PASS. If `merge-window` reports "Apply never enabled for the second file", that is the known CI-side flake — reproduce once more before treating it as a regression.

- [ ] **Step 7: Commit**

```bash
git add src/features/merge/
git commit -m "feat(merge): highlight the editable result pane on a debounce

Why: the result document changes on every keystroke, so it cannot use the
synchronous decorations.compute path the region marks use. Tokens arrive as an
effect into a mapped field, sharing the --syn-* palette with both side panes."
```

---

## Self-Review

**Spec coverage.** `pairChangedLines` extracted (Task 1); split view pairing, alignment and word diff (Task 3); `CommitDiffPanel` (Task 4); merge `SidePane` (Task 5); merge result pane decorations at the spec's 120 ms (Task 6). The spec's per-surface text-source table is implemented by `useDiffSyntax` (Task 2) and by the two callers in Task 4. Windowing is PR3 and appears nowhere here.

**Placeholders.** The two "reuse the value the screen already resolves" notes in Task 4 Step 4 point at existing call sites rather than standing in for logic; every other step carries its code.

**Type consistency.** `pairChangedLines` returns `Array<LinePairSpans | null>` and every consumer indexes it positionally against the runs it passed in. `SideLine.spans` is `WordSpan[]` and `SideLine.syntax` is `SyntaxToken[]`, matching `DiffText`'s parameters from PR1. `useDiffSyntax` returns `{ old, new }` of `SyntaxLine[] | null`, which is the same shape `PGHunkProps.syntax` takes. `buildSyntaxDecorations(state, lines)` takes `SyntaxLine[]`, the element type of that same array.
