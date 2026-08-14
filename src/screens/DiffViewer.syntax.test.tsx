// Syntax highlighting in the DiffViewer (PR1 of the code-viewer work).
//
// A fake tokenizer keeps this about WIRING — that both sides' text is read and
// that rows resolve tokens from the right side — not about grammar fidelity,
// which src/lib/syntax/tokenize.integration.test.ts covers against real Shiki.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { DiffViewerScreen } from "./DiffViewer";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

// Mock the module useSyntax itself imports, NOT the @/lib/syntax barrel:
// mocking the barrel leaves the hook's own `./tokenize` import untouched, so the
// real grammar would run and the fake would silently do nothing.
vi.mock("@/lib/syntax/tokenize", async (orig) => {
  const actual = await orig<typeof import("@/lib/syntax/tokenize")>();
  return {
    ...actual,
    // "old" text scopes as a comment, "new" text as a keyword, so which side a
    // row read is visible in the DOM.
    tokenizeFile: async (_path: string, text: string) =>
      text.split("\n").map(() => [
        {
          start: 0,
          end: 3,
          cls: text.includes("OLD") ? "syn-comment" : "syn-keyword",
        },
      ]),
  };
});

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 1,
  deletions: 1,
  embedded: false,
});

const diff = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 1,
  hunks: [
    {
      header: "@@ -1,1 +1,1 @@",
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
});

function setup() {
  resetInvokeMock();
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [unstaged("a.ts")],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_status", () => [unstaged("a.ts")]);
  mockInvoke("get_diff", (args) => diff(args.path as string));
  mockInvoke("read_file_content", () => ({
    path: "a.ts",
    binary: false,
    text: "let a = 2",
    fromHead: false,
    size: 9,
  }));
  mockInvoke("read_file_content_at_rev", () => ({
    path: "a.ts",
    binary: false,
    text: "let a = 1 OLD",
    fromHead: true,
    size: 13,
  }));
  render(
    <WithDialogs>
      <DiffViewerScreen />
    </WithDialogs>,
  );
}

describe("DiffViewer syntax highlighting", () => {
  beforeEach(setup);

  it("highlights diff rows", async () => {
    await waitFor(() =>
      expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0),
    );
  });

  it("reads the old side at HEAD and the new side from the worktree", async () => {
    await waitFor(() =>
      expect(document.querySelectorAll(".syn-keyword").length).toBeGreaterThan(0),
    );
    const atRev = getInvokeCalls().find((c) => c.cmd === "read_file_content_at_rev");
    expect(atRev?.args).toMatchObject({ revspec: "HEAD", path: "a.ts" });
    expect(getInvokeCalls().some((c) => c.cmd === "read_file_content")).toBe(true);
  });

  it("resolves a rem row from the old side and an add row from the new side", async () => {
    // The fake tags old-side tokens syn-comment and new-side syn-keyword.
    await waitFor(() => expect(document.querySelector(".syn-comment")).not.toBeNull());
    expect(document.querySelector(".syn-comment")).toHaveTextContent("let");
    expect(document.querySelector(".syn-keyword")).toHaveTextContent("let");
  });

  it("reads a renamed file's old side at its OLD path", async () => {
    // HEAD has no blob at the new path, so using it would leave every removed
    // line unhighlighted.
    resetInvokeMock();
    mockInvoke("get_status", () => [unstaged("new.ts")]);
    mockInvoke("get_diff", () => ({ ...diff("new.ts"), oldPath: "old.ts" }));
    mockInvoke("read_file_content", () => ({
      path: "new.ts", binary: false, text: "let a = 2", fromHead: false, size: 9,
    }));
    mockInvoke("read_file_content_at_rev", () => ({
      path: "old.ts", binary: false, text: "let a = 1 OLD", fromHead: true, size: 13,
    }));
    useRepoStore.setState({ status: [unstaged("new.ts")] } as never);
    render(
      <WithDialogs>
        <DiffViewerScreen />
      </WithDialogs>,
    );
    // The effect runs once before the diff resolves (oldPath unknown, so the new
    // path) and again once it has it, so assert that SOME read used the old path
    // rather than pinning the first one.
    await waitFor(() => {
      const atOldPath = getInvokeCalls().filter(
        (c) => c.cmd === "read_file_content_at_rev" && c.args.path === "old.ts",
      );
      expect(atOldPath.length).toBeGreaterThan(0);
      expect(atOldPath[0].args).toMatchObject({ revspec: "HEAD" });
    });
  });

  it("keeps word-diff marks alongside syntax spans", async () => {
    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid="word-change"]').length).toBeGreaterThan(0),
    );
  });
});
