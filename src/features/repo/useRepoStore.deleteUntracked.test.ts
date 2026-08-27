// `deleteUntracked` — the store half of #245.
//
// A destructive op, so the ordering is the contract (CLAUDE.md): the file list
// is refreshed BEFORE anything is reported, on both paths. A partially completed
// multi-file delete otherwise leaves the UI listing files that are already gone,
// under a banner explaining the ones that are not.
//
// The delete is also best-effort by design — the backend validates the whole
// batch before unlinking anything, then reports per-path I/O failures — so a
// RESOLVED call can still carry bad news, and the store has to surface it rather
// than treating "no exception" as "all done".

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { useRepoStore } from "./useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

/** The order in which the store touched refresh vs. the error banner. */
const trace: string[] = [];

function armRepo() {
  useRepoStore.setState({
    current: { id: "r1", path: "/repo", head: "main" },
    status: [],
    error: null,
    refreshStatus: async () => {
      trace.push("refreshStatus");
    },
    refreshAll: async () => {
      trace.push("refreshAll");
    },
  } as never);
}

beforeEach(() => {
  trace.length = 0;
  armRepo();
});

afterEach(() => vi.restoreAllMocks());

describe("deleteUntracked", () => {
  it("sends the selection and refreshes the file list on success", async () => {
    mockInvoke("delete_untracked_files", () => []);

    await useRepoStore.getState().deleteUntracked(["a.tmp", "b.tmp"]);

    expect(getInvokeCalls().filter((c) => c.cmd === "delete_untracked_files")).toEqual([
      {
        cmd: "delete_untracked_files",
        args: { repoId: "r1", paths: ["a.tmp", "b.tmp"] },
      },
    ]);
    expect(trace).toEqual(["refreshStatus"]);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("does nothing at all with no repository open", async () => {
    useRepoStore.setState({ current: null } as never);
    mockInvoke("delete_untracked_files", () => []);

    await useRepoStore.getState().deleteUntracked(["a.tmp"]);

    expect(getInvokeCalls()).toEqual([]);
  });

  it("does not dispatch an empty selection", async () => {
    mockInvoke("delete_untracked_files", () => []);

    await useRepoStore.getState().deleteUntracked([]);

    expect(getInvokeCalls()).toEqual([]);
    expect(trace).toEqual([]);
  });

  it("reports the paths the OS refused, naming each and its reason", async () => {
    mockInvoke("delete_untracked_files", () => [
      { path: "locked/a.tmp", reason: "Permission denied (os error 13)" },
      { path: "gone.tmp", reason: "No such file or directory (os error 2)" },
    ]);

    await useRepoStore
      .getState()
      .deleteUntracked(["locked/a.tmp", "gone.tmp", "fine.tmp"]);

    const error = useRepoStore.getState().error;
    expect(error?.kind).toBe("Io");
    expect(String(error?.message)).toContain("could not delete 2 files");
    expect(String(error?.message)).toContain("locked/a.tmp");
    expect(String(error?.message)).toContain("Permission denied");
    expect(String(error?.message)).toContain("gone.tmp");
  });

  it("refreshes BEFORE reporting a partial failure", async () => {
    // The files that DID go are gone; the list must say so before the banner
    // starts talking about the ones that did not.
    mockInvoke("delete_untracked_files", () => [
      { path: "gone.tmp", reason: "No such file or directory" },
    ]);
    useRepoStore.setState({
      refreshStatus: async () => {
        trace.push("refreshStatus");
        // The banner is still clear at refresh time.
        trace.push(`error=${String(useRepoStore.getState().error)}`);
      },
    } as never);

    await useRepoStore.getState().deleteUntracked(["gone.tmp"]);

    expect(trace).toEqual(["refreshStatus", "error=null"]);
    expect(useRepoStore.getState().error).not.toBeNull();
  });

  it("uses the singular for one failure", async () => {
    mockInvoke("delete_untracked_files", () => [
      { path: "gone.tmp", reason: "No such file or directory" },
    ]);

    await useRepoStore.getState().deleteUntracked(["gone.tmp"]);

    expect(String(useRepoStore.getState().error?.message)).toContain(
      "could not delete 1 file:",
    );
  });

  it("refreshes everything FIRST and sets the error LAST when the call rejects", async () => {
    mockInvoke("delete_untracked_files", () => {
      throw { kind: "InvalidPath", message: "loose.txt is tracked by git" };
    });

    await useRepoStore.getState().deleteUntracked(["loose.txt"]);

    // The CLAUDE.md rule for a danger op's catch arm, in order.
    expect(trace).toEqual(["refreshAll"]);
    expect(useRepoStore.getState().error).toEqual({
      kind: "InvalidPath",
      message: "loose.txt is tracked by git",
    });
  });

  it("never raises a banner for a repository the user has left", async () => {
    mockInvoke("delete_untracked_files", () => {
      // Tab switch lands while the delete is in flight.
      useRepoStore.setState({ current: { id: "r2", path: "/other", head: "main" } } as never);
      throw { kind: "Io", message: "boom" };
    });

    await useRepoStore.getState().deleteUntracked(["loose.txt"]);

    expect(useRepoStore.getState().error).toBeNull();
  });
});
