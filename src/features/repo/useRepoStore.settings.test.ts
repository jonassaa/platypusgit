// Store-logic tests for the settings consumed by useRepoStore:
// - autoStashBeforePull gates the stash → pull → pop flow
// - pruneOnFetch is threaded into the fetch/fetch_all IPC
// - diffContextLines is threaded into hunk-staging IPC
import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { useRepoStore } from "./useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useAuthStore } from "@/features/auth/useAuthStore";

function mockRefreshAll() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
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

  // The stash must survive an auth challenge. The first attempt stashes and then
  // fails on credentials; the retry used to re-enter the closure with a fresh
  // `stashed = null`, find the tree clean (the work being in the stash), pull
  // successfully and never pop — silently leaving the user's uncommitted work in
  // a stash they were never told about.
  it("pops the first attempt's stash after an auth retry succeeds", async () => {
    let pullAttempts = 0;
    let stashes = 0;
    // Realistic: the first save stashes the dirty tree, and any later save finds
    // a clean tree (the work is already stashed) and so returns null.
    mockInvoke("stash_save", () => {
      stashes += 1;
      return stashes === 1 ? "stash-oid" : null;
    });
    mockInvoke("pull", () => {
      pullAttempts += 1;
      if (pullAttempts === 1) {
        throw { kind: "Auth", message: { host: "github.com", kind: "Https" } };
      }
      return null;
    });
    mockInvoke("stash_pop", () => null);
    mockInvoke("remember_credential", () => null);

    await useRepoStore.getState().pull("origin", "main", "Merge");

    // The challenge is raised rather than surfaced as an error.
    const challenge = useAuthStore.getState().challenge;
    expect(challenge).not.toBeNull();
    expect(calls("stash_pop")).toHaveLength(0);

    await challenge!.retry({ username: "ada", secret: "token" }, false);

    expect(pullAttempts).toBe(2);
    // Exactly one stash across both attempts, and it is popped.
    expect(calls("stash_save")).toHaveLength(1);
    expect(calls("stash_pop")).toHaveLength(1);
    expect(useRepoStore.getState().error).toBeNull();
  });

  // `git credential approve` stores an HTTP(S) password. Remembering an SSH key
  // passphrase there files the wrong secret under protocol=https for the host,
  // and it would then be offered at the next HTTPS prompt.
  it("never remembers an SSH passphrase with git's credential helper", async () => {
    let attempts = 0;
    mockInvoke("stash_save", () => null);
    mockInvoke("pull", () => {
      attempts += 1;
      if (attempts === 1) {
        throw {
          kind: "Auth",
          message: { host: "github.com", kind: "SshPassphrase" },
        };
      }
      return null;
    });
    mockInvoke("remember_credential", () => null);

    await useRepoStore.getState().pull("origin", "main", "Merge");
    const challenge = useAuthStore.getState().challenge;
    expect(challenge?.kind).toBe("SshPassphrase");

    // Even with remember explicitly requested.
    await challenge!.retry({ secret: "key-passphrase" }, true);

    expect(attempts).toBe(2);
    expect(calls("remember_credential")).toHaveLength(0);
    expect(useRepoStore.getState().error).toBeNull();
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
