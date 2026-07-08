import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { FileStatus, RepoHandle } from "@/lib/types";

const repo: RepoHandle = {
  id: "repo-1",
  path: "/tmp/fake-repo",
  head: "refs/heads/main",
};

function modified(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Modified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
  };
}

function stagedFile(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Modified" },
    additions: 0,
    deletions: 0,
  };
}

const initialStatus = [
  stagedFile("s.txt"),
  modified("a.txt"),
  modified("b.txt"),
  modified("c.txt"),
];

function resetStore() {
  useRepoStore.setState({
    current: repo,
    status: initialStatus,
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
  mockInvoke("get_diff", (args) => ({
    path: args.path,
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
  }));
  mockInvoke("stage_paths", () => undefined);
  mockInvoke("unstage_paths", () => undefined);
  mockInvoke("discard_paths", () => undefined);
  // refreshAll() after a mutation:
  mockInvoke("get_status", () => initialStatus);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log", () => []);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
}

function changeRow(path: string): HTMLElement {
  const row = screen
    .getByTestId("changes-list")
    .querySelector(`[data-path="${path}"]`);
  if (!row) throw new Error(`no changes-list row for ${path}`);
  return row as HTMLElement;
}

function selectedPaths(): string[] {
  return Array.from(
    screen
      .getByTestId("changes-list")
      .querySelectorAll('[data-selected="true"]'),
  ).map((el) => el.getAttribute("data-path") ?? "");
}

describe("CommitPanel multi-file selection", () => {
  beforeEach(() => {
    resetStore();
    wireMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ctrl/cmd-click toggles rows in and out of the selection", async () => {
    render(<CommitPanelScreen />);

    fireEvent.click(changeRow("a.txt"));
    expect(selectedPaths()).toEqual(["a.txt"]);

    fireEvent.click(changeRow("c.txt"), { ctrlKey: true });
    expect(selectedPaths()).toEqual(["a.txt", "c.txt"]);

    // metaKey works too, and toggles back out
    fireEvent.click(changeRow("c.txt"), { metaKey: true });
    expect(selectedPaths()).toEqual(["a.txt"]);
  });

  it("shift-click extends a contiguous range from the anchor", async () => {
    render(<CommitPanelScreen />);

    fireEvent.click(changeRow("a.txt"));
    fireEvent.click(changeRow("c.txt"), { shiftKey: true });
    expect(selectedPaths()).toEqual(["a.txt", "b.txt", "c.txt"]);

    // re-extend from the same anchor shrinks the range
    fireEvent.click(changeRow("b.txt"), { shiftKey: true });
    expect(selectedPaths()).toEqual(["a.txt", "b.txt"]);

    // plain click collapses back to a single row
    fireEvent.click(changeRow("b.txt"));
    expect(selectedPaths()).toEqual(["b.txt"]);
  });

  it("stages the full selection via the multi-file context menu", async () => {
    render(<CommitPanelScreen />);

    fireEvent.click(changeRow("a.txt"));
    fireEvent.click(changeRow("b.txt"), { ctrlKey: true });
    fireEvent.contextMenu(changeRow("b.txt"));

    fireEvent.click(await screen.findByText("Stage 2 files"));

    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "stage_paths");
      expect(call).toBeDefined();
      expect(call!.args).toEqual({
        repoId: "repo-1",
        paths: ["a.txt", "b.txt"],
      });
    });
  });

  it("multi-file discard asks for confirmation and aborts when declined", async () => {
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<CommitPanelScreen />);

    fireEvent.click(changeRow("a.txt"));
    fireEvent.click(changeRow("c.txt"), { shiftKey: true });

    // declined → nothing dispatched
    fireEvent.contextMenu(changeRow("b.txt"));
    fireEvent.click(await screen.findByText("Discard changes in 3 files…"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(getInvokeCalls().find((c) => c.cmd === "discard_paths")).toBeUndefined();

    // accepted → full path array
    fireEvent.contextMenu(changeRow("b.txt"));
    fireEvent.click(await screen.findByText("Discard changes in 3 files…"));
    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "discard_paths");
      expect(call).toBeDefined();
      expect(call!.args).toEqual({
        repoId: "repo-1",
        paths: ["a.txt", "b.txt", "c.txt"],
      });
    });
  });

  it("right-click outside the selection collapses to the clicked row's single-file menu", async () => {
    render(<CommitPanelScreen />);

    fireEvent.click(changeRow("a.txt"));
    fireEvent.click(changeRow("b.txt"), { ctrlKey: true });

    fireEvent.contextMenu(changeRow("c.txt"));
    // single-file menu, not the multi menu
    expect(await screen.findByText("Stage")).toBeInTheDocument();
    expect(screen.queryByText(/files selected/)).toBeNull();
    expect(selectedPaths()).toEqual(["c.txt"]);
  });

  it("checkbox on a multi-selected row stages every selected file on that side", async () => {
    render(<CommitPanelScreen />);

    fireEvent.click(changeRow("a.txt"));
    fireEvent.click(changeRow("b.txt"), { ctrlKey: true });

    const toggle = changeRow("b.txt").querySelector(
      '[data-testid="row-toggle"] input',
    );
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle!);

    await waitFor(() => {
      const call = getInvokeCalls().find((c) => c.cmd === "stage_paths");
      expect(call).toBeDefined();
      expect(call!.args).toEqual({
        repoId: "repo-1",
        paths: ["a.txt", "b.txt"],
      });
    });
  });
});
