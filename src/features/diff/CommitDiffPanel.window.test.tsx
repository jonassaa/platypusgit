// Windowed rows in the commit-diff panel.
//
// This panel keeps its own lighter markup — no line-number gutters, tighter rows
// for the History inline panel — so it renders DiffRows itself instead of using
// PGWindowedDiff. It still uses the SHARED flattenDiffRows/windowVariable, so
// there is only one row model in the codebase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { resetInvokeMock } from "@/test/invokeMock";
import { CommitDiffPanel } from "./CommitDiffPanel";
import { useFocusStore } from "@/features/keymap/useFocusStore";
import { useKeymapStore } from "@/features/keymap/useKeymapStore";

import { DIFF_ROW_H_FALLBACK } from "@/lib/useDiffRowHeight";
import type { FileDiff } from "@/lib/types";

vi.mock("@/lib/syntax/tokenize", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax/tokenize")>()),
  tokenizeFile: async () => null,
}));

const LINES = 400;

const diffs: FileDiff[] = [
  {
    path: "a.ts",
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [
      {
        header: `@@ -1,${LINES} +1,${LINES} @@`,
        oldStart: 1,
        oldLines: LINES,
        newStart: 1,
        newLines: LINES,
        lines: Array.from({ length: LINES }, (_, i) => ({
          kind: { kind: "Context" as const },
          oldLineno: i + 1,
          newLineno: i + 1,
          content: `line ${i}`,
        })),
      },
    ],
  },
];

/**
 * A commit diff exactly as `diff_to_file_diffs` builds it: the hunk's `lines[]`
 * opens with libgit2's `'H'` line, kind `HunkHeader`, content `@@ …\n` (#161).
 * This panel is where that was visible — the working-tree builder drops `'H'`, the
 * commit builder keeps it, and this panel is the one that renders commit diffs.
 */
const withHeaderLine: FileDiff[] = [
  {
    path: "b.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: "@@ -1,2 +1,3 @@",
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [
          {
            kind: { kind: "HunkHeader" as const },
            oldLineno: null,
            newLineno: null,
            content: "@@ -1,2 +1,3 @@\n",
          },
          { kind: { kind: "Context" as const }, oldLineno: 1, newLineno: 1, content: "keep" },
          { kind: { kind: "Addition" as const }, oldLineno: null, newLineno: 2, content: "added" },
          { kind: { kind: "Context" as const }, oldLineno: 2, newLineno: 3, content: "tail" },
        ],
      },
    ],
  },
];

/**
 * One hunk starting at line 1, so the row model is exactly its lines and the
 * anchor's row index is known: 40 context rows, then the change.
 */
const ANCHOR_ROW = 40;
const deepChange: FileDiff[] = [
  {
    path: "c.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        header: "@@ -1,80 +1,81 @@",
        oldStart: 1,
        oldLines: 80,
        newStart: 1,
        newLines: 81,
        lines: [
          ...Array.from({ length: ANCHOR_ROW }, (_, i) => ({
            kind: { kind: "Context" as const },
            oldLineno: i + 1,
            newLineno: i + 1,
            content: `before ${i}`,
          })),
          {
            kind: { kind: "Addition" as const },
            oldLineno: null,
            newLineno: ANCHOR_ROW + 1,
            content: "the change",
          },
          ...Array.from({ length: ANCHOR_ROW }, (_, i) => ({
            kind: { kind: "Context" as const },
            oldLineno: ANCHOR_ROW + i + 1,
            newLineno: ANCHOR_ROW + i + 2,
            content: `after ${i}`,
          })),
        ],
      },
    ],
  },
];

/** jsdom lays nothing out: give the scroll container a real geometry. */
function stubScroll(el: Element, o: { viewportH: number; contentH: number }) {
  let top = 0;
  Object.defineProperty(el, "clientHeight", { configurable: true, value: o.viewportH });
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: o.contentH });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (v: number) => {
      top = v;
    },
  });
}

beforeEach(() => {
  resetInvokeMock();
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
});

describe("CommitDiffPanel windowing", () => {
  it("mounts only a slice of a long diff", async () => {
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w1"
      />,
    );
    await waitFor(() => expect(screen.getByText(/line 0/)).toBeInTheDocument());
    expect(screen.queryByText(new RegExp(`line ${LINES - 1}\\b`))).not.toBeInTheDocument();
    expect(document.querySelector("[data-pg-spacer]")).not.toBeNull();
  });

  it("still marks hunks for F7 navigation", async () => {
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w2"
      />,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-hunk-index="0"]')).not.toBeNull(),
    );
  });

  it("renders no `@@` for a commit diff whose lines carry the header (#161)", async () => {
    const { container } = render(
      <CommitDiffPanel
        diffs={withHeaderLine}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w3"
      />,
    );
    await waitFor(() => expect(screen.getByText(/added/)).toBeInTheDocument());
    expect(container.textContent).not.toContain("@@");
    // The anchor is the added line — the row F7 lands on and the row index the
    // header line used to occupy.
    expect(document.querySelector('[data-hunk-index="0"]')?.textContent).toContain("added");
  });

  it("CENTRES an F7 target in the viewport, not at either edge", async () => {
    render(
      <CommitDiffPanel
        diffs={deepChange}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w4"
      />,
    );
    // The anchor row is 40 rows down and windowed OUT — which is exactly the
    // case that made offset arithmetic mandatory here (#68 G10). Wait for the
    // rows that ARE mounted instead.
    await waitFor(() => expect(screen.getByText(/before 0/)).toBeInTheDocument());
    const el = document.querySelector('[aria-label="Diff"]')!;
    const rowH = DIFF_ROW_H_FALLBACK;
    stubScroll(el, { viewportH: 10 * rowH, contentH: 81 * rowH });

    useFocusStore.setState({ focused: "w4.view" });
    act(() => {
      useKeymapStore.getState().dispatch({
        key: "F7",
        code: "",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        target: document.body,
      } as unknown as KeyboardEvent);
    });

    // The change is one row at index 40, in a ten-row viewport. Reveal semantics
    // would have stopped at the smallest scroll that shows it — the row pinned to
    // the BOTTOM edge, at 41 * rowH - viewportH. Centring puts it five rows down
    // instead, every time and whichever direction F7 arrived from. (The exact
    // centre is 35.5 rows; ties snap DOWN to a row boundary, so no line renders
    // half-sliced.)
    expect(el.scrollTop).toBe((ANCHOR_ROW - 5) * rowH);
  });
});
