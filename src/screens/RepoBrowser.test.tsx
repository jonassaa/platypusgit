import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { RepoBrowserScreen } from "./RepoBrowser";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";
import type { FileStatus, RepoHandle } from "@/lib/types";

const repo: RepoHandle = {
  id: "repo-1",
  path: "/tmp/fake-repo",
  head: "refs/heads/main",
};

function modified(path: string): FileStatus {
  return { path, worktree: { kind: "Modified" }, index: { kind: "Unmodified" } };
}

function unmodified(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Unmodified" },
  };
}

const status = [modified("a.txt")];
const allFiles = [modified("a.txt"), unmodified("u1.txt"), unmodified("u2.txt")];

function resetStore() {
  useRepoStore.setState({
    current: repo,
    status,
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
  });
}

function wireMocks() {
  mockInvoke("list_all_files", () => allFiles);
  mockInvoke("get_diff", (args) => ({
    path: args.path,
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("read_file_content", (args) => ({
    path: args.path,
    text: "content",
    binary: false,
    fromHead: false,
  }));
}

function treeRow(path: string): HTMLElement {
  const row = document.querySelector(`[data-pg-row][data-path="${path}"]`);
  if (!row) throw new Error(`no tree row for ${path}`);
  return row as HTMLElement;
}

describe("RepoBrowser multi-file selection (all-files mode)", () => {
  beforeEach(() => {
    resetStore();
    wireMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("multi-select of unmodified files shows the real count, not 0", async () => {
    render(<RepoBrowserScreen />);

    fireEvent.click(screen.getByText("All"));
    await waitFor(() => treeRow("u1.txt"));

    fireEvent.click(treeRow("u1.txt"));
    fireEvent.click(treeRow("u2.txt"), { ctrlKey: true });
    fireEvent.contextMenu(treeRow("u2.txt"));

    expect(await screen.findByText("2 files selected")).toBeInTheDocument();
    expect(screen.queryByText("0 files selected")).toBeNull();
  });

  it("mixed selection keeps stage actions for the changed subset and counts every file", async () => {
    render(<RepoBrowserScreen />);

    fireEvent.click(screen.getByText("All"));
    await waitFor(() => treeRow("u1.txt"));

    fireEvent.click(treeRow("a.txt"));
    fireEvent.click(treeRow("u1.txt"), { ctrlKey: true });
    fireEvent.contextMenu(treeRow("u1.txt"));

    expect(await screen.findByText("2 files selected")).toBeInTheDocument();
    expect(screen.getByText("Stage 1 file")).toBeInTheDocument();
  });
});
