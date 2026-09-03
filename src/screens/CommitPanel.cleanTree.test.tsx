// A refresh is not a fresh repository (#368).
//
// `refreshAll` sets `loading: true` for the whole duration of its ten backend
// reads, and the clean-tree empty state used to be gated on `!loading`. So a
// clean repository swapped to the three-pane STAGED/UNSTAGED layout with two
// empty file lists on every full refresh and swapped back when it finished —
// which reads as "your changes vanished", not "still loading", and churns the
// DOM node the e2e waits bind to (#364). The filesystem watcher asks for a
// full refresh whenever refs move, so a commit produces two of these in a row.
//
// The honest half of the old guard is kept, as `statusLoaded`: before the FIRST
// status read, empty lists do not mean a clean tree and the panel must not
// claim one.

import { describe, it, expect, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

import { CommitPanelScreen } from "./CommitPanel";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { emptySlice } from "@/features/repo/repoSlice";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";

/** A promise plus the handle to settle it, so a test can hold a read open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const repo = { id: "repo-1", path: "/tmp/repo-1", head: "refs/heads/main" };

/** Every read `refreshAll` fires, answering for a repository with a clean tree. */
function mockCleanRepo() {
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
  mockInvoke("bisect_status", () => null);
  mockInvoke("head_info", () => null);
  mockInvoke("shallow_info", () => ({
    shallow: false,
    boundaryCount: 0,
    singleBranch: false,
  }));
  mockInvoke("get_identity", () => ({
    name: { value: "Ada", scope: "global" },
    email: { value: "ada@example.com", scope: "global" },
    globalConfigPath: "/home/ada/.gitconfig",
    localConfigPath: null,
  }));
}

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({ ...emptySlice(), current: repo });
  mockCleanRepo();
});

describe("the clean-tree panel across a refresh (#368)", () => {
  it("does not claim a clean tree before the first status read", async () => {
    // Nothing has been read yet: empty lists mean "we don't know", and saying
    // "Working tree clean" here would be a lie. This is the reason the guard
    // exists at all, and it has to survive the fix.
    render(<CommitPanelScreen />);

    expect(screen.queryByTestId("working-tree-clean")).toBeNull();
  });

  it("keeps the empty state mounted while a full refresh runs", async () => {
    await act(async () => {
      await useRepoStore.getState().refreshAll();
    });
    render(<CommitPanelScreen />);
    const node = screen.getByTestId("working-tree-clean");

    // A second refresh, held open on one of its reads — exactly what the
    // watcher's `"all"` plan does behind a commit, and what a repo on WSL's
    // /mnt/c stretches into tens of seconds.
    const held = deferred<unknown[]>();
    mockInvoke("list_remotes", () => held.promise);
    let refreshing!: Promise<void>;
    act(() => {
      refreshing = useRepoStore.getState().refreshAll();
    });

    expect(useRepoStore.getState().loading).toBe(true);
    // The same node, not merely a node: a remount is what turned a WebdriverIO
    // handle-caching quirk into a red required gate.
    expect(screen.getByTestId("working-tree-clean")).toBe(node);
    expect(screen.queryByTestId("changes-list")).toBeNull();

    await act(async () => {
      held.resolve([]);
      await refreshing;
    });

    expect(screen.getByTestId("working-tree-clean")).toBe(node);
  });
});
