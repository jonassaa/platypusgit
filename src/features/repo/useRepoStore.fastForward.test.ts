// Fast-forwarding a branch that is not checked out (#246).
//
// The routing is the part worth pinning: the op moves a REF, so the branch that
// is HEAD must go to `pull` with the user's own mode instead — a user who set
// Rebase gets Rebase, never a silent --ff-only, and never a ref moved out from
// under their working tree.

import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import type { BranchInfo } from "@/lib/types";
import { useRepoStore } from "./useRepoStore";

const branch = (b: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: `origin/${b.name}`,
  ahead: 0,
  behind: 1,
  tip: "a".repeat(40),
  tipTime: 0,
  isDefault: false,
  ...b,
});

const ff = (b: string) => ({
  branch: b,
  upstream: `origin/${b}`,
  from: "a".repeat(40),
  to: "b".repeat(40),
  moved: true,
});

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

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

beforeEach(() => {
  resetInvokeMock();
  useAuthStore.setState({ challenge: null });
  useSettingsStore.getState().reset();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/tmp/repo-1", head: "feat/x" },
    branches: [
      branch({ name: "main" }),
      branch({ name: "feat/x", isHead: true, upstream: null, behind: 0 }),
    ],
    remotes: [{ name: "origin", url: "git@example.com:me/repo.git" }],
    error: null,
  });
  mockRefreshAll();
});

describe("fastForwardBranch", () => {
  it("advances a branch that is not checked out", async () => {
    mockInvoke("fast_forward_branch", () => ff("main"));

    const out = await useRepoStore.getState().fastForwardBranch("main");

    expect(calls("fast_forward_branch")).toHaveLength(1);
    expect(calls("fast_forward_branch")[0].args.branch).toBe("main");
    expect(out?.moved).toBe(true);
    expect(useRepoStore.getState().error).toBeNull();
    // Refs and log both change when a ref moves.
    expect(calls("list_branches").length).toBeGreaterThan(0);
  });

  it("passes the prune setting through to the fetch it does first", async () => {
    useSettingsStore.getState().set("pruneOnFetch", false);
    mockInvoke("fast_forward_branch", () => ff("main"));

    await useRepoStore.getState().fastForwardBranch("main");

    expect(calls("fast_forward_branch")[0].args.prune).toBe(false);
  });

  it("routes the checked-out branch to pull with the user's own mode", async () => {
    // The whole point of the routing: --ff-only would quietly override a user
    // who chose Rebase, and moving HEAD's ref would strand the working tree.
    useSettingsStore.getState().set("defaultPullMode", "Rebase");
    useRepoStore.setState({
      current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
      branches: [branch({ name: "main", isHead: true })],
    });
    mockInvoke("pull", () => null);
    mockInvoke("stash_save", () => null);

    await useRepoStore.getState().fastForwardBranch("main");

    expect(calls("fast_forward_branch")).toHaveLength(0);
    expect(calls("pull")).toHaveLength(1);
    expect(calls("pull")[0].args).toMatchObject({
      remote: "origin",
      branch: "main",
      mode: "Rebase",
    });
  });

  it("keeps a slash-bearing remote name whole when it routes to pull", async () => {
    useRepoStore.setState({
      current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
      branches: [
        branch({ name: "main", isHead: true, upstream: "team/fork/main" }),
      ],
      remotes: [{ name: "team/fork", url: "git@example.com:team/fork.git" }],
    });
    mockInvoke("pull", () => null);
    mockInvoke("stash_save", () => null);

    await useRepoStore.getState().fastForwardBranch("main");

    expect(calls("pull")[0].args.remote).toBe("team/fork");
  });

  it("raises a credential challenge and retries the same op", async () => {
    let attempts = 0;
    mockInvoke("fast_forward_branch", () => {
      attempts += 1;
      if (attempts === 1)
        throw { kind: "Auth", message: { host: "github.com", kind: "Https" } };
      return ff("main");
    });

    await useRepoStore.getState().fastForwardBranch("main");
    expect(useRepoStore.getState().error).toBeNull();
    await useAuthStore
      .getState()
      .challenge!.retry({ username: "ada", secret: "t" }, false);

    expect(attempts).toBe(2);
    expect(calls("fast_forward_branch")[1].args.credentials).toEqual({
      username: "ada",
      secret: "t",
    });
  });

  it("refreshes before it reports a refusal, so the banner survives", async () => {
    mockInvoke("fast_forward_branch", () => {
      throw { kind: "NotFastForward", message: "main has diverged" };
    });

    await useRepoStore.getState().fastForwardBranch("main");

    // refreshAll clears `error` as its first act, so the order matters.
    expect(useRepoStore.getState().error).toEqual({
      kind: "NotFastForward",
      message: "main has diverged",
    });
    expect(calls("list_branches").length).toBeGreaterThan(0);
  });

  it("does nothing for a branch it has never heard of", async () => {
    await useRepoStore.getState().fastForwardBranch("ghost");
    // Not routed to pull, and not sent to the backend as a guess.
    expect(calls("pull")).toHaveLength(0);
    expect(calls("fast_forward_branch")).toHaveLength(1);
  });
});

describe("fastForwardAllBranches", () => {
  it("asks the backend once and hands back the report", async () => {
    const report = {
      advanced: [ff("main")],
      diverged: ["feat/y"],
      checkedOut: [],
    };
    mockInvoke("fast_forward_all_branches", () => report);

    const out = await useRepoStore.getState().fastForwardAllBranches();

    expect(calls("fast_forward_all_branches")).toHaveLength(1);
    expect(out).toEqual(report);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("reports a failure through the banner, after refreshing", async () => {
    mockInvoke("fast_forward_all_branches", () => {
      throw { kind: "Network", message: "no route to host" };
    });

    const out = await useRepoStore.getState().fastForwardAllBranches();

    expect(out).toBeNull();
    expect(useRepoStore.getState().error).toEqual({
      kind: "Network",
      message: "no route to host",
    });
  });
});
