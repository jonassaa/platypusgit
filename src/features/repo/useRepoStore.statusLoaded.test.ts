// "Have we ever read this repository's status?" (#368) — the question the
// CommitPanel's clean-tree empty state actually needs, and which `loading` was
// standing in for.
//
// `loading` answers "is a refresh in flight?", which flips true on every full
// refresh; `statusLoaded` latches once and stays latched, because a refresh has
// the PREVIOUS status in the store the whole time it runs.

import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useRepoStore } from "./useRepoStore";
import { emptySlice, frozenSlice } from "./repoSlice";

/** A promise plus the handle to settle it, so a test can hold a read open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function mockRefreshAll() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("bisect_status", () => null);
  mockInvoke("head_info", () => null);
  mockInvoke("shallow_info", () => ({
    shallow: false,
    boundaryCount: 0,
    singleBranch: false,
  }));
}

const statusLoaded = () => useRepoStore.getState().statusLoaded;

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
  });
  mockRefreshAll();
});

describe("statusLoaded", () => {
  it("starts false — an unread repository is not a clean one", () => {
    expect(emptySlice().statusLoaded).toBe(false);
    expect(statusLoaded()).toBe(false);
  });

  it("is set by a completed refreshAll", async () => {
    await useRepoStore.getState().refreshAll();
    expect(statusLoaded()).toBe(true);
  });

  it("is set by a completed refreshStatus", async () => {
    // The index ops refresh through this one, so a repo whose first status read
    // came from a stage/unstage is just as loaded as one that ran a full
    // refresh.
    mockInvoke("get_status", () => []);
    await useRepoStore.getState().refreshStatus();
    expect(statusLoaded()).toBe(true);
  });

  it("stays true for the whole of a later refresh", async () => {
    await useRepoStore.getState().refreshAll();

    const held = deferred<unknown[]>();
    mockInvoke("list_remotes", () => held.promise);
    const refreshing = useRepoStore.getState().refreshAll();

    // This is the bug in one assertion: `loading` says "busy", but the status
    // in the store is still the status the user is looking at.
    expect(useRepoStore.getState().loading).toBe(true);
    expect(statusLoaded()).toBe(true);

    held.resolve([]);
    await refreshing;
    expect(statusLoaded()).toBe(true);
  });

  it("stays false when the refresh fails", async () => {
    // A refresh that could not read status has not loaded one, so the panel
    // must not start claiming a clean tree off the empty list it degraded to.
    mockInvoke("get_status", () => {
      throw new Error("boom");
    });

    await useRepoStore.getState().refreshAll();

    expect(useRepoStore.getState().error).not.toBeNull();
    expect(statusLoaded()).toBe(false);
  });

  it("survives being parked on an inactive tab", () => {
    // Unlike `loading`, this is not an in-flight marker: the parked slice still
    // holds the status that was read, so it still counts as read.
    const parked = frozenSlice({ ...emptySlice(), loading: true, statusLoaded: true });
    expect(parked.statusLoaded).toBe(true);
  });

  it("is cleared for a freshly opened repository", () => {
    // `applyOpenedRepo` starts from `emptySlice()`, so opening repo B must not
    // inherit repo A's answer.
    useRepoStore.setState({ statusLoaded: true });
    useRepoStore.getState().closeRepo();
    expect(statusLoaded()).toBe(false);
  });
});
