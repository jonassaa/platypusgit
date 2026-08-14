// Windowed diff rows in the DiffViewer.
//
// jsdom lays nothing out, so the viewport measures 0 and windowVariable falls
// back to a screenful — enough to prove that a 400-line diff does NOT mount all
// 400 rows, and that turning wrap on mounts every one of them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiffViewerScreen } from "./DiffViewer";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

vi.mock("@/lib/syntax/tokenize", async (orig) => ({
  ...(await orig<typeof import("@/lib/syntax/tokenize")>()),
  tokenizeFile: async () => null, // plain rows; this suite is about windowing
}));

const LINES = 400;

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
});

const diff = (path: string) => ({
  path,
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
});

beforeEach(() => {
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
    path: "a.ts", binary: false, text: "x", fromHead: false, size: 1,
  }));
  mockInvoke("read_file_content_at_rev", () => ({
    path: "a.ts", binary: false, text: "x", fromHead: true, size: 1,
  }));
  render(
    <WithDialogs>
      <DiffViewerScreen />
    </WithDialogs>,
  );
});

describe("DiffViewer windowing", () => {
  it("mounts far fewer rows than the diff has", async () => {
    await waitFor(() => expect(screen.getByText("line 0")).toBeInTheDocument());
    expect(screen.queryByText(`line ${LINES - 1}`)).not.toBeInTheDocument();
    const mounted = document.querySelectorAll("[data-pg-spacer]").length;
    expect(mounted).toBeGreaterThan(0); // a spacer stands in for the rest
  });

  it("renders every row once wrap is on, since row height stops being known", async () => {
    await waitFor(() => expect(screen.getByText("line 0")).toBeInTheDocument());
    await userEvent.click(screen.getByTestId("diff-wrap-toggle"));
    await waitFor(() =>
      expect(screen.getByText(`line ${LINES - 1}`)).toBeInTheDocument(),
    );
    expect(document.querySelector("[data-pg-spacer]")).toBeNull();
  });
});
