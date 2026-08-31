// `deleteBranches` — the store half of "delete merged branches in this
// folder" (#244).
//
// A destructive bulk op, so the same two contracts as `deleteUntracked` apply:
// the branch list is refreshed BEFORE anything is reported (a banner must not
// point at a list that still shows deleted refs), and the delete is
// best-effort — two refs that refuse do not decide the fate of the other six.
//
// It also refreshes ONCE. Looping `deleteBranch` would have run a full
// refreshAll — status, branches, tags, stashes, remotes, log — per branch.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useRepoStore } from "./useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

/** The order in which the store touched refresh vs. the error banner. */
const trace: string[] = [];

function armRepo() {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    branches: [],
    error: null,
    refreshAll: async () => {
      trace.push("refreshAll");
    },
  } as never);
}

const deleteCalls = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "delete_branch")
    .map((c) => c.args.name);

beforeEach(() => {
  trace.length = 0;
  armRepo();
});

afterEach(() => vi.restoreAllMocks());

describe("deleteBranches", () => {
  it("deletes each branch and refreshes exactly once", async () => {
    mockInvoke("delete_branch", () => null);

    const report = await useRepoStore
      .getState()
      .deleteBranches(["feat/a", "feat/b"]);

    expect(deleteCalls()).toEqual(["feat/a", "feat/b"]);
    expect(report).toEqual({ deleted: ["feat/a", "feat/b"], failed: [] });
    expect(trace).toEqual(["refreshAll"]);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("keeps going past a ref that refuses, and reports both halves", async () => {
    mockInvoke("delete_branch", ({ name }) => {
      if (name === "feat/b") throw { kind: "Git", message: "cannot lock ref" };
      return null;
    });

    const report = await useRepoStore
      .getState()
      .deleteBranches(["feat/a", "feat/b", "feat/c"]);

    expect(deleteCalls()).toEqual(["feat/a", "feat/b", "feat/c"]);
    expect(report).toEqual({ deleted: ["feat/a", "feat/c"], failed: ["feat/b"] });
  });

  it("refreshes before it reports the failure", async () => {
    mockInvoke("delete_branch", () => {
      throw { kind: "Git", message: "nope" };
    });
    const unsubscribe = useRepoStore.subscribe((s) => {
      if (s.error) trace.push("error");
    });

    await useRepoStore.getState().deleteBranches(["feat/a"]);
    unsubscribe();

    expect(trace).toEqual(["refreshAll", "error"]);
    expect(useRepoStore.getState().error).not.toBeNull();
  });

  it("does nothing at all with no repository open", async () => {
    useRepoStore.setState({ current: null } as never);
    mockInvoke("delete_branch", () => null);

    const report = await useRepoStore.getState().deleteBranches(["feat/a"]);

    expect(report).toEqual({ deleted: [], failed: [] });
    expect(deleteCalls()).toEqual([]);
    expect(trace).toEqual([]);
  });

  it("still refreshes when handed an empty list", async () => {
    const report = await useRepoStore.getState().deleteBranches([]);

    expect(report).toEqual({ deleted: [], failed: [] });
    expect(deleteCalls()).toEqual([]);
    expect(trace).toEqual(["refreshAll"]);
  });
});
