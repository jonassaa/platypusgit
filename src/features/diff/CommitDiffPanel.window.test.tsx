// Windowed rows in the commit-diff panel.
//
// This panel keeps its own lighter markup — no line-number gutters, tighter rows
// for the History inline panel — so it renders DiffRows itself instead of using
// PGWindowedDiff. It still uses the SHARED flattenDiffRows/windowVariable, so
// there is only one row model in the codebase.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { resetInvokeMock } from "@/test/invokeMock";
import { CommitDiffPanel } from "./CommitDiffPanel";
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

beforeEach(() => {
  resetInvokeMock();
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
});
