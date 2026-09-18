// The repository paints before history arrives (#483).
//
// `refreshAll` used to await ELEVEN reads behind one `Promise.all` and write
// once. On `torvalds/linux` ten of them are done inside a second and the log
// page takes fifteen, so the whole screen — status, branches, tags, HEAD —
// waited on the slowest read in the set.
//
// This holds the log page open and asserts the rest has already landed. A
// version that re-joins them fails here, which is the only thing that keeps
// the split from being quietly undone.

import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";

import { useRepoStore } from "./useRepoStore";

/** Resolves the pending `get_log_page`, once the test is ready for it. */
let releaseLog: (page: { commits: unknown[]; nextCursor: string | null }) => void;

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

  // The slow one. It stays pending until the test releases it.
  mockInvoke(
    "get_log_page",
    () =>
      new Promise((resolve) => {
        releaseLog = resolve as typeof releaseLog;
      }),
  );
}

beforeEach(() => {
  resetInvokeMock();
  mockReads();
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    commits: [],
    statusLoaded: false,
    loading: false,
    error: null,
  } as never);
});

describe("refreshAll", () => {
  it("lands status, branches and HEAD while the log page is still pending", async () => {
    const done = useRepoStore.getState().refreshAll();

    // Let the ten fast reads settle. Two macrotask turns is enough for a
    // Promise.all over already-resolved mocks; the log is still open.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(useRepoStore.getState().statusLoaded).toBe(true);
    expect(useRepoStore.getState().headInfo).toEqual({
      branch: "refs/heads/main",
      headOid: "a1",
    });
    expect(useRepoStore.getState().loading).toBe(false);
    // …and history has NOT arrived yet, which is the point.
    expect(useRepoStore.getState().commits).toEqual([]);

    releaseLog({ commits: [{ id: "c1" }], nextCursor: null });
    await done;

    expect(useRepoStore.getState().commits).toHaveLength(1);
  });

  it("still resolves only once history has landed", async () => {
    let settled = false;
    const done = useRepoStore
      .getState()
      .refreshAll()
      .then(() => {
        settled = true;
      });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    // The screen is painted, but the caller's promise must not be done: an op
    // that refreshes and then reads `commits` would race it.
    expect(settled).toBe(false);

    releaseLog({ commits: [], nextCursor: null });
    await done;
    expect(settled).toBe(true);
  });
});
