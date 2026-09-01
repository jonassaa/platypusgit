// A background refresh must not clear an error the user has not read (#239).
//
// `useFsWatch.test.tsx` asserts the watcher PASSES `preserveError`. This file
// asserts the store HONOURS it — the two together are the fix, and either alone
// would pass while the bug remained.

import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";

import { useRepoStore } from "./useRepoStore";

function mockReads() {
  for (const cmd of [
    "get_status",
    "list_branches",
    "list_tags",
    "list_stashes",
    "list_remotes",
  ]) {
    mockInvoke(cmd, () => []);
  }
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("head_info", () => ({ branch: "refs/heads/main", headOid: "a1" }));
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
  mockInvoke("shallow_info", () => ({
    shallow: false,
    boundaryCount: 0,
    singleBranch: false,
  }));
  mockInvoke("bisect_status", () => ({
    inProgress: false,
    startRef: null,
    badTerm: "bad",
    goodTerm: "good",
    currentOid: null,
    remaining: null,
    steps: null,
    firstBadOid: null,
    goodCount: 0,
    badCount: 0,
    skippedCount: 0,
  }));
}

const BANNER = { kind: "Git", message: "not possible to fast-forward" } as const;

beforeEach(() => {
  resetInvokeMock();
  mockReads();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    error: null,
  } as never);
});

describe("refreshAll", () => {
  it("clears the error by default — a refresh the user asked for", async () => {
    useRepoStore.setState({ error: BANNER } as never);
    await useRepoStore.getState().refreshAll();
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("keeps the error with preserveError", async () => {
    // The failed `--ff-only` pull's banner, and the watcher event that used to
    // wipe it a few hundred milliseconds later.
    useRepoStore.setState({ error: BANNER } as never);
    await useRepoStore.getState().refreshAll({ preserveError: true });
    expect(useRepoStore.getState().error).toEqual(BANNER);
  });

  it("still refreshes when preserving — it is not a no-op", async () => {
    useRepoStore.setState({ error: BANNER, headInfo: null } as never);
    await useRepoStore.getState().refreshAll({ preserveError: true });
    expect(useRepoStore.getState().headInfo).toEqual({
      branch: "refs/heads/main",
      headOid: "a1",
    });
    expect(useRepoStore.getState().error).toEqual(BANNER);
  });
});

describe("refreshStatus", () => {
  it("clears the error by default", async () => {
    useRepoStore.setState({ error: BANNER } as never);
    await useRepoStore.getState().refreshStatus();
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("keeps the error with preserveError", async () => {
    useRepoStore.setState({ error: BANNER } as never);
    await useRepoStore.getState().refreshStatus({ preserveError: true });
    expect(useRepoStore.getState().error).toEqual(BANNER);
  });
});
