// Initialising a repository on a Windows drive under WSL trips the same
// ownership check as opening one, because libgit2 opens what it just created.
// Without the same remedy here the Init dialog is a dead end for exactly the
// users issue #83 is about.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCreateStore } from "@/features/create/useCreateStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const confirmTrust = vi.hoisted(() => vi.fn());
vi.mock("@/features/repo/ownership", () => ({ confirmTrust }));

const REFUSED = {
  kind: "DubiousOwnership",
  message: "repository is owned by another user: /mnt/c/dev/fresh",
};
const HANDLE = { id: "repo-1", path: "/mnt/c/dev/fresh", head: "main" };

/** `init_repo` refuses `failures` times, then succeeds. */
function armInit(failures: number) {
  let seen = 0;
  mockInvoke("init_repo", () => {
    if (seen++ < failures) throw REFUSED;
    return HANDLE;
  });
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);
const ARGS = { parentDir: "/mnt/c/dev", name: "fresh", branch: "main" };

describe("useCreateStore.runInit — dubious ownership", () => {
  beforeEach(() => {
    useCreateStore.setState({ open: "init", busy: false, progress: null, error: null });
    // The follow-up open is the tab store's business, not this test's.
    useTabsStore.setState({ openRepo: async () => {} });
    confirmTrust.mockReset();
    mockInvoke("trust_repo_path", () => null);
  });

  it("trusts the path and retries when the user accepts", async () => {
    armInit(1);
    confirmTrust.mockResolvedValue(true);

    await useCreateStore.getState().runInit(ARGS);

    expect(confirmTrust).toHaveBeenCalledWith("/mnt/c/dev/fresh");
    expect(calls("trust_repo_path")).toHaveLength(1);
    expect(calls("init_repo")).toHaveLength(2);
    expect(useCreateStore.getState().error).toBeNull();
    expect(useCreateStore.getState().open).toBe("none");
    expect(useCreateStore.getState().busy).toBe(false);
  });

  it("keeps the dialog open with the error when the user declines", async () => {
    armInit(1);
    confirmTrust.mockResolvedValue(false);

    await useCreateStore.getState().runInit(ARGS);

    expect(calls("trust_repo_path")).toHaveLength(0);
    expect(useCreateStore.getState().open).toBe("init");
    expect(useCreateStore.getState().error).toContain("owned by another user");
    expect(useCreateStore.getState().busy).toBe(false);
  });

  it("does not loop when trusting fails to help", async () => {
    armInit(99);
    confirmTrust.mockResolvedValue(true);

    await useCreateStore.getState().runInit(ARGS);

    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(calls("init_repo")).toHaveLength(2);
    expect(useCreateStore.getState().busy).toBe(false);
    expect(useCreateStore.getState().error).toContain("owned by another user");
  });

  it("leaves other init failures untouched", async () => {
    mockInvoke("init_repo", () => {
      throw { kind: "InvalidPath", message: "/mnt/c/dev/fresh is already a git repository" };
    });

    await useCreateStore.getState().runInit(ARGS);

    expect(confirmTrust).not.toHaveBeenCalled();
    expect(useCreateStore.getState().error).toContain("already a git repository");
  });
});
