import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

// Mock the module useSyntax imports, NOT the @/lib/syntax barrel — the barrel
// leaves the hook's own ./tokenize import untouched and the real grammar runs.
vi.mock("@/lib/syntax/tokenize", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax/tokenize")>()),
  tokenizeFile: async (_p: string, text: string) =>
    text.split("\n").map(() => [
      { start: 0, end: 3, cls: text.includes("OLD") ? "syn-comment" : "syn-keyword" },
    ]),
}));

const diffs: FileDiff[] = [
  {
    path: "a.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -1 +1 @@",
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [
          { kind: { kind: "Deletion" }, oldLineno: 1, newLineno: null, content: "let a = 1" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 1, content: "let a = 2" },
        ],
      },
    ],
  },
];

beforeEach(() => {
  resetInvokeMock();
  mockInvoke("read_file_content_at_rev", (args) => ({
    path: args.path as string,
    binary: false,
    text: (args.revspec as string).endsWith("^") ? "let a = 1 OLD" : "let a = 2",
    fromHead: false,
    size: 13,
  }));
});

describe("CommitDiffPanel syntax and word diff", () => {
  it("highlights rows and marks intra-line changes when given revs", async () => {
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="t1"
        syntaxSides={{
          repoId: "repo-1",
          old: { kind: "rev", rev: "abc123^" },
          new: { kind: "rev", rev: "abc123" },
        }}
      />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll(".syn-comment").length).toBeGreaterThan(0),
    );
    expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-testid="word-change"]').length).toBeGreaterThan(0);
  });

  it("renders plain and reads nothing without revs", async () => {
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x"
        paneIdPrefix="t2"
      />,
    );
    await waitFor(() =>
      expect(document.querySelectorAll("[data-hunk-index]").length).toBe(1),
    );
    expect(getInvokeCalls().some((c) => c.cmd === "read_file_content_at_rev")).toBe(false);
    expect(document.querySelectorAll(".syn-keyword").length).toBe(0);
    // Still shows the code, just unhighlighted.
    expect(document.body.textContent).toContain("let a = 1");
  });

  it("reads a renamed file's old side at its old path", async () => {
    render(
      <CommitDiffPanel
        diffs={[{ ...diffs[0], oldPath: "old.ts" }]}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="t3"
        syntaxSides={{
          repoId: "repo-1",
          old: { kind: "rev", rev: "abc123^" },
          new: { kind: "rev", rev: "abc123" },
        }}
      />,
    );
    await waitFor(() => {
      const atOld = getInvokeCalls().filter(
        (c) => c.cmd === "read_file_content_at_rev" && c.args.path === "old.ts",
      );
      expect(atOld.length).toBeGreaterThan(0);
    });
  });
});
