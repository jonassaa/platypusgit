// RepoBrowser mounts only the visible slice of the file tree (#61 A8).
// "All files" lists every file in the repository, so this is the tree that
// actually gets large — thousands of rows plus their per-type icons.
import { describe, it, expect, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";
import { FILE_TREE_ROW_BASE_H } from "@/design";
import type { FileStatus, RepoHandle } from "@/lib/types";

const repo: RepoHandle = {
  id: "repo-1",
  path: "/tmp/fake-repo",
  head: "refs/heads/main",
};

/** 300 modified files at the tree root, so flat count === file count. */
const MANY: FileStatus[] = Array.from({ length: 300 }, (_, i) => ({
  path: `file${String(i).padStart(3, "0")}.txt`,
  worktree: { kind: "Modified" as const },
  index: { kind: "Unmodified" as const },
  additions: 0,
  deletions: 0,
  embedded: false,
}));

beforeEach(() => {
  mockInvoke("list_all_files", () => MANY);
  mockInvoke("get_diff", (args) => ({
    path: args.path as string,
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("read_file_content", (args) => ({
    path: args.path as string,
    text: "content",
    binary: false,
    fromHead: false,
  }));
  useRepoStore.setState({
    current: repo,
    status: MANY,
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: { inProgress: false, nextIndex: 0, total: 0, pauseReason: null },
    activity: {},
  } as never);
});

const rows = (c: HTMLElement) => [...c.querySelectorAll("[data-pg-row]")];

describe("RepoBrowser tree virtualization", () => {
  it("mounts far fewer rows than the tree contains", async () => {
    const { container } = render(<RepoBrowserScreen />);
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));

    // jsdom reports clientHeight 0, so the window falls back to one screenful.
    // Either way the point holds: nowhere near 300 rows are in the DOM.
    expect(rows(container).length).toBeLessThan(300);
  });

  it("starts the window at the top of the tree", async () => {
    const { container } = render(<RepoBrowserScreen />);
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));

    expect(rows(container)[0]!.getAttribute("data-path")).toBe("file000.txt");
  });

  it("pads the scroll body to the full tree height", async () => {
    // The scrollbar must reflect the whole tree, not the mounted slice.
    const { container } = render(<RepoBrowserScreen />);
    await waitFor(() => expect(rows(container).length).toBeGreaterThan(0));

    const spacers = [...container.querySelectorAll("[data-tree-spacer]")];
    const padPx = spacers.reduce(
      (sum, el) => sum + Number.parseFloat((el as HTMLElement).style.height || "0"),
      0,
    );
    // Compact density → step 0, so the pitch is the base height.
    expect(padPx + rows(container).length * FILE_TREE_ROW_BASE_H).toBe(
      300 * FILE_TREE_ROW_BASE_H,
    );
  });
});
