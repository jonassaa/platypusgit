// The bar is the app's only standing signal that a merge/rebase/cherry-pick is
// open (#108). It replaces the deleted Conflicts screen's header, so its copy
// and its three verbs — resolve, finish, abort — are what these tests pin.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OperationBar } from "./OperationBar";
import { useRepoStore } from "./useRepoStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import type { FileStatus, RepoState } from "@/lib/types";

vi.mock("@/features/merge/openMergeWindow", () => ({
  openMergeWindow: vi.fn().mockResolvedValue(undefined),
}));
import { openMergeWindow } from "@/features/merge/openMergeWindow";

const conflicted = (path: string): FileStatus =>
  ({
    path,
    index: { kind: "Conflicted" },
    worktree: { kind: "Conflicted" },
  }) as never;

const clean = (path: string): FileStatus =>
  ({
    path,
    index: { kind: "Modified" },
    worktree: { kind: "Unmodified" },
  }) as never;

function wire() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("continue_operation", () => "abc1234");
  mockInvoke("abort_operation", () => undefined);
}

function setup(
  repoState: RepoState,
  status: FileStatus[],
  rebaseStatus?: Partial<{
    inProgress: boolean;
    nextIndex: number;
    total: number;
    pauseReason: string | null;
  }>,
) {
  useRepoStore.setState({
    current: { id: "repo-1", path: "/repo", head: "refs/heads/main" },
    status,
    branches: [
      {
        name: "main",
        isHead: true,
        isRemote: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        tip: "abc1234",
      },
    ],
    repoState,
    rebaseStatus: {
      inProgress: false,
      nextIndex: 0,
      total: 0,
      pauseReason: null,
      ...rebaseStatus,
    },
  } as never);
  render(
    <WithDialogs>
      <OperationBar />
    </WithDialogs>,
  );
}

const called = (cmd: string) => getInvokeCalls().some((c) => c.cmd === cmd);

describe("OperationBar", () => {
  beforeEach(() => {
    resetInvokeMock();
    resetDialogs();
    vi.mocked(openMergeWindow).mockClear();
    wire();
  });

  it("renders nothing when no operation is in progress", () => {
    setup("Clean", [clean("a.txt")]);
    expect(screen.queryByTestId("operation-bar")).toBeNull();
  });

  it("names the operation and counts the conflicts left", () => {
    setup("Merge", [conflicted("a.txt"), conflicted("b.txt"), clean("c.txt")]);
    expect(screen.getByTestId("operation-title").textContent).toContain(
      "Merge in progress",
    );
    expect(screen.getByTestId("operation-title").textContent).toContain("main");
    expect(screen.getByTestId("operation-detail").textContent).toBe(
      "2 conflicts to resolve",
    );
  });

  it("offers the resolver — not a finish button — while conflicts remain", async () => {
    setup("Merge", [conflicted("a.txt")]);
    expect(screen.queryByTestId("operation-continue")).toBeNull();
    fireEvent.click(screen.getByTestId("operation-resolve"));
    // No path: the resolver opens on its file list and picks the first one.
    expect(openMergeWindow).toHaveBeenCalledWith("repo-1");
  });

  it("finalizes a merge once nothing is conflicted", async () => {
    setup("Merge", [clean("a.txt")]);
    expect(screen.queryByTestId("operation-resolve")).toBeNull();
    const finish = screen.getByTestId("operation-continue");
    expect(finish.textContent).toContain("Finalize");
    fireEvent.click(finish);
    await vi.waitFor(() => expect(called("continue_operation")).toBe(true));
  });

  it("says Continue for a rebase — there are steps after this one", () => {
    setup("RebaseMerge", [clean("a.txt")]);
    expect(screen.getByTestId("operation-continue").textContent).toContain(
      "Continue",
    );
  });

  it("shows the step counter only when an interactive session is tracked", () => {
    setup("RebaseInteractive", [conflicted("a.txt")], {
      inProgress: true,
      nextIndex: 1,
      total: 7,
    });
    expect(screen.getByTestId("operation-detail").textContent).toContain(
      "step 2 of 7",
    );
  });

  it("confirms before aborting", async () => {
    setup("Merge", [conflicted("a.txt")]);
    fireEvent.click(screen.getByTestId("operation-abort"));
    expect(called("abort_operation")).toBe(false);
    await acceptDialog();
    await vi.waitFor(() => expect(called("abort_operation")).toBe(true));
  });

  it("offers only abort for a state that cannot be committed forward", () => {
    // A mailbox application: in progress, not finishable by committing the index,
    // and with nothing better than abort to offer. Bisect USED to land here too;
    // since #93 it has its own bar (below), because the generic abort was
    // actively wrong for it.
    setup("ApplyMailbox", []);
    expect(screen.getByTestId("operation-title").textContent).toContain(
      "Patch application",
    );
    expect(screen.queryByTestId("operation-continue")).toBeNull();
    expect(screen.queryByTestId("operation-resolve")).toBeNull();
    expect(screen.getByTestId("operation-abort")).toBeTruthy();
  });
});
