// cherryPickMany — loops the single cherry_pick op oldest→newest, refreshes
// once, and stops (surfacing the error) on the first conflicting pick.

import { describe, it, expect, beforeEach } from "vitest";
import { useRepoStore } from "./useRepoStore";
import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";

/** Everything refreshAll() fans out to — return empties so it resolves. */
function mockRefresh() {
  mockInvoke("get_status", () => []);
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

const pickedOids = () =>
  getInvokeCalls()
    .filter((c) => c.cmd === "cherry_pick")
    .map((c) => c.args.oid as string);

describe("cherryPickMany", () => {
  beforeEach(() => {
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      error: null,
    } as never);
    mockRefresh();
  });

  it("cherry-picks every oid in the given (oldest→newest) order", async () => {
    mockInvoke("cherry_pick", () => undefined);
    await useRepoStore.getState().cherryPickMany(["old", "mid", "new"]);
    expect(pickedOids()).toEqual(["old", "mid", "new"]);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("stops at the first conflicting pick and surfaces the error", async () => {
    mockInvoke("cherry_pick", (args) => {
      if (args.oid === "mid") {
        throw { kind: "ConflictsDetected", message: "cherry-pick produced conflicts" };
      }
      return undefined;
    });
    await useRepoStore.getState().cherryPickMany(["old", "mid", "new"]);
    // "new" is never attempted.
    expect(pickedOids()).toEqual(["old", "mid"]);
    expect(useRepoStore.getState().error?.kind).toBe("ConflictsDetected");
  });
});
