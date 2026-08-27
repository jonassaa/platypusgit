// The diff pane's ⋯ ("File actions") menu offers the same "Copy path" / "Copy
// relative path" pair as the file row (#245).
//
// The pair itself is unit-tested in `src/design/context-menu.copyPath.test.tsx`
// and the arithmetic in `src/lib/paths.test.ts` — what this covers is the
// wiring: the ⋯ menu is built inline in this screen rather than by
// `fileMenuItems`, so it is the one surface that could silently keep copying a
// relative path under the "Copy path" label.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { settleDiff } from "@/test/settle";
import { WithDialogs } from "@/test/dialog";
import type { FileStatus } from "@/lib/types";

const PATH = "src/deep/a.ts";

const unstaged = (path: string): FileStatus => ({
  path,
  worktree: { kind: "Modified" },
  index: { kind: "Unmodified" },
  additions: 1,
  deletions: 0,
  embedded: false,
});

const diff = (path: string) => ({
  path,
  oldPath: null,
  binary: false,
  additions: 1,
  deletions: 0,
  hunks: [
    {
      header: "@@ -1,1 +1,2 @@",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: { kind: "Context" }, oldLineno: 1, newLineno: 1, content: "base\n" },
        { kind: { kind: "Addition" }, oldLineno: null, newLineno: 2, content: "add\n" },
      ],
    },
  ],
});

const copied: string[] = [];

/** Open the ⋯ menu over the selected file and click `label`. */
function clickInMoreMenu(label: string) {
  fireEvent.click(screen.getByTitle("File actions"));
  fireEvent.click(screen.getByText(label));
}

beforeEach(async () => {
  resetInvokeMock();
  copied.length = 0;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn((t: string) => {
        copied.push(t);
        return Promise.resolve();
      }),
    },
  });
  useSettingsStore.setState({ ignoreWhitespaceInDiff: false });
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status: [unstaged(PATH)],
    branches: [],
    remotes: [],
    commits: [],
    loading: false,
  } as never);
  mockInvoke("get_diff", (args) => diff(args.path as string));
  mockInvoke("get_status", () => [unstaged(PATH)]);
  render(
    <WithDialogs>
      <CommitPanelScreen />
    </WithDialogs>,
  );
  await screen.findAllByTestId("diff-line-changed");
  await settleDiff();
});

describe("the diff pane's ⋯ menu", () => {
  it("copies the absolute path for 'Copy path'", () => {
    clickInMoreMenu("Copy path");
    expect(copied).toEqual(["/repo/src/deep/a.ts"]);
  });

  it("copies the workdir-relative path for 'Copy relative path'", () => {
    clickInMoreMenu("Copy relative path");
    expect(copied).toEqual([PATH]);
  });
});
