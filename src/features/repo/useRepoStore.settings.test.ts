// Store-logic tests for the settings consumed by useRepoStore:
// - autoStashBeforePull gates the stash → pull → pop flow
// - pruneOnFetch is threaded into the fetch/fetch_all IPC
// - diffContextLines is threaded into hunk-staging IPC
import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { useRepoStore } from "./useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

function mockRefreshAll() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log", () => []);
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
}

function calls(cmd: string) {
  return getInvokeCalls().filter((c) => c.cmd === cmd);
}

/** Index of the first call of `cmd` in the invoke log (-1 if absent). */
function callIndex(cmd: string) {
  return getInvokeCalls().findIndex((c) => c.cmd === cmd);
}

beforeEach(() => {
  useSettingsStore.getState().reset(); // defaults: autoStash on, prune on, ctx 3
  useRepoStore.setState({
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
    error: null,
  });
  mockRefreshAll();
});

describe("pull auto-stash", () => {
  it("stashes before pull and pops after when the tree is dirty", async () => {
    mockInvoke("stash_save", () => "stash-oid");
    mockInvoke("pull", () => null);
    mockInvoke("stash_pop", () => null);

    await useRepoStore.getState().pull("origin", "main", "Merge");

    expect(calls("stash_save")).toHaveLength(1);
    expect(calls("pull")).toHaveLength(1);
    expect(calls("stash_pop")).toHaveLength(1);
    // Order: stash → pull → pop.
    expect(callIndex("stash_save")).toBeLessThan(callIndex("pull"));
    expect(callIndex("pull")).toBeLessThan(callIndex("stash_pop"));
    // Untracked files ride along, mirroring checkoutBranch's auto-stash.
    expect(calls("stash_save")[0].args.opts.includeUntracked).toBe(true);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("skips the pop when there was nothing to stash", async () => {
    mockInvoke("stash_save", () => null); // clean tree
    mockInvoke("pull", () => null);
    mockInvoke("stash_pop", () => {
      throw new Error("must not pop when nothing was stashed");
    });

    await useRepoStore.getState().pull("origin", "main", "Merge");

    expect(calls("stash_save")).toHaveLength(1);
    expect(calls("pull")).toHaveLength(1);
    expect(calls("stash_pop")).toHaveLength(0);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("does not stash at all when autoStashBeforePull is off", async () => {
    useSettingsStore.getState().set("autoStashBeforePull", false);
    mockInvoke("pull", () => null);

    await useRepoStore.getState().pull("origin", "main", "Merge");

    expect(calls("stash_save")).toHaveLength(0);
    expect(calls("pull")).toHaveLength(1);
  });

  it("keeps the stash (no pop) and surfaces the error when the pull fails", async () => {
    mockInvoke("stash_save", () => "stash-oid");
    mockInvoke("pull", () => {
      throw { kind: "Network", message: "diverged" };
    });
    mockInvoke("stash_pop", () => {
      throw new Error("must not pop onto a failed pull");
    });

    await useRepoStore.getState().pull("origin", "main", "FastForward");

    expect(calls("stash_pop")).toHaveLength(0);
    expect(useRepoStore.getState().error).toEqual({
      kind: "Network",
      message: "diverged",
    });
  });
});

describe("pruneOnFetch threading", () => {
  it("fetch passes prune=true by default", async () => {
    mockInvoke("fetch", () => null);
    await useRepoStore.getState().fetch("origin");
    expect(calls("fetch")[0].args.prune).toBe(true);
  });

  it("fetch and fetchAll pass prune=false when the setting is off", async () => {
    useSettingsStore.getState().set("pruneOnFetch", false);
    mockInvoke("fetch", () => null);
    mockInvoke("fetch_all", () => null);

    await useRepoStore.getState().fetch("origin");
    await useRepoStore.getState().fetchAll();

    expect(calls("fetch")[0].args.prune).toBe(false);
    expect(calls("fetch_all")[0].args.prune).toBe(false);
  });
});

describe("diffContextLines threading", () => {
  it("hunk ops pass the configured context width", async () => {
    useSettingsStore.getState().set("diffContextLines", 8);
    mockInvoke("stage_hunk", () => null);
    mockInvoke("unstage_hunk", () => null);
    mockInvoke("discard_hunk", () => null);

    await useRepoStore.getState().stageHunk("a.txt", 0);
    await useRepoStore.getState().unstageHunk("a.txt", 1);
    await useRepoStore.getState().discardHunk("a.txt", 2);

    expect(calls("stage_hunk")[0].args.contextLines).toBe(8);
    expect(calls("unstage_hunk")[0].args.contextLines).toBe(8);
    expect(calls("discard_hunk")[0].args.contextLines).toBe(8);
  });
});
