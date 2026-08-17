// Whole-file mode in the commit diff: the unchanged remainder of the file is
// filled in around the hunk, from the text the syntax hook already read.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { CommitDiffPanel } from "./CommitDiffPanel";
import type { FileDiff } from "@/lib/types";

// Same reasoning as CommitDiffPanel.syntax.test.tsx: mock the module useSyntax
// imports so no real grammar loads.
vi.mock("@/lib/syntax/tokenize", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax/tokenize")>()),
  tokenizeFile: async () => null,
}));

const FILE = "one\ntwo\nCHANGED\nfour\nfive";

// A 5-line file whose 3rd line changed, fetched with 0 context lines.
const diffs: FileDiff[] = [
  {
    path: "a.ts",
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 1,
    hunks: [
      {
        header: "@@ -3,1 +3,1 @@",
        oldStart: 3,
        oldLines: 1,
        newStart: 3,
        newLines: 1,
        lines: [
          { kind: { kind: "Deletion" }, oldLineno: 3, newLineno: null, content: "ORIGINAL" },
          { kind: { kind: "Addition" }, oldLineno: null, newLineno: 3, content: "CHANGED" },
        ],
      },
    ],
  },
];

const sides = {
  repoId: "repo-1",
  old: { kind: "rev" as const, rev: "abc123^" },
  new: { kind: "rev" as const, rev: "abc123" },
};

beforeEach(() => {
  resetInvokeMock();
  useSettingsStore.getState().set("diffContextMode", "wholeFile");
  mockInvoke("read_file_content_at_rev", (args) => ({
    path: args.path as string,
    binary: false,
    text: (args.revspec as string).endsWith("^")
      ? FILE.replace("CHANGED", "ORIGINAL")
      : FILE,
    fromHead: false,
    size: FILE.length,
  }));
});

describe("CommitDiffPanel whole-file mode", () => {
  it("shows unchanged lines from outside the hunk", async () => {
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w1"
        syntaxSides={sides}
      />,
    );
    // "five" is past the end of the hunk, so it can only appear via a filler row.
    await waitFor(() => expect(document.body.textContent).toContain("five"));
    expect(document.body.textContent).toContain("one");
    expect(document.body.textContent).toContain("CHANGED");
  });

  it("shows only the hunk when the setting says chunks", async () => {
    useSettingsStore.getState().set("diffContextMode", "chunks");
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w2"
        syntaxSides={sides}
      />,
    );
    await waitFor(() => expect(document.body.textContent).toContain("CHANGED"));
    expect(document.body.textContent).not.toContain("five");
  });

  // The realistic absence since #151: the command RESOLVES with null instead of
  // rejecting, so the `catch` the throw-mock below exercises is never entered.
  // Nothing covered that path, which is the one every added or deleted file takes.
  it("still renders the hunk when the read resolves absent", async () => {
    resetInvokeMock();
    mockInvoke("read_file_content_at_rev", () => null);
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w4"
        syntaxSides={sides}
      />,
    );
    await waitFor(() => expect(document.body.textContent).toContain("CHANGED"));
    // No text on either side means no filler — not a whole file filled from "".
    expect(document.body.textContent).not.toContain("five");
  });

  it("still renders the hunk when the read rejects", async () => {
    resetInvokeMock();
    mockInvoke("read_file_content_at_rev", () => {
      throw new Error("no blob");
    });
    render(
      <CommitDiffPanel
        diffs={diffs}
        loading={false}
        error={null}
        header="x → y"
        paneIdPrefix="w3"
        syntaxSides={sides}
      />,
    );
    await waitFor(() => expect(document.body.textContent).toContain("CHANGED"));
    expect(document.body.textContent).not.toContain("five");
  });
});
