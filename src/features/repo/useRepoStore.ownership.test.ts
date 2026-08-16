// Opening a repository libgit2 says is owned by someone else (the WSL
// /mnt/c case) must offer the safe.directory remedy and retry. It lives in
// the store rather than a screen so every entry point — Welcome, recents, the
// pgit CLI launch, the palette — gets it without repeating itself.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

const confirmTrust = vi.hoisted(() => vi.fn());
vi.mock("@/features/repo/ownership", () => ({ confirmTrust }));

const REFUSED = {
  kind: "DubiousOwnership",
  message: "repository is owned by another user: /mnt/c/dev/reponame",
};
const HANDLE = { id: "repo-1", path: "/mnt/c/dev/reponame", head: "main" };

const initial = useRepoStore.getState();

/** `open_repo` refuses `failures` times, then succeeds. */
function armOpen(failures: number) {
  let seen = 0;
  mockInvoke("open_repo", () => {
    if (seen++ < failures) throw REFUSED;
    return HANDLE;
  });
}

const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);

describe("useRepoStore.openRepo — dubious ownership", () => {
  beforeEach(() => {
    useRepoStore.setState(initial, true);
    // Isolate the trust flow from the full post-open refresh fan-out.
    useRepoStore.setState({ refreshAll: async () => {} });
    confirmTrust.mockReset();
    mockInvoke("trust_repo_path", () => null);
  });

  it("trusts the path and retries when the user accepts", async () => {
    armOpen(1);
    confirmTrust.mockResolvedValue(true);

    await useRepoStore.getState().openRepoAt("/mnt/c/dev/reponame");

    expect(confirmTrust).toHaveBeenCalledWith("/mnt/c/dev/reponame");
    expect(calls("trust_repo_path")).toHaveLength(1);
    expect(useRepoStore.getState().current).toEqual(HANDLE);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("trusts the path the backend named, not the one that was asked for", async () => {
    // The backend canonicalises; safe.directory matching is exact, so the
    // canonical path is the only one worth writing.
    let seen = 0;
    mockInvoke("open_repo", () => {
      if (seen++ === 0) {
        throw {
          kind: "DubiousOwnership",
          message: "repository is owned by another user: /mnt/c/dev/reponame",
        };
      }
      return HANDLE;
    });
    confirmTrust.mockResolvedValue(true);

    await useRepoStore.getState().openRepoAt("/mnt/c/dev/reponame/");

    expect(confirmTrust).toHaveBeenCalledWith("/mnt/c/dev/reponame");
    expect(calls("trust_repo_path")[0]?.args).toMatchObject({
      path: "/mnt/c/dev/reponame",
    });
  });

  it("shows the error and writes nothing when the user declines", async () => {
    armOpen(1);
    confirmTrust.mockResolvedValue(false);

    await useRepoStore.getState().openRepoAt("/mnt/c/dev/reponame");

    expect(calls("trust_repo_path")).toHaveLength(0);
    expect(useRepoStore.getState().error?.kind).toBe("DubiousOwnership");
    expect(useRepoStore.getState().current).toBeNull();
    expect(useRepoStore.getState().loading).toBe(false);
  });

  it("does not loop when trusting fails to help", async () => {
    armOpen(99);
    confirmTrust.mockResolvedValue(true);

    await useRepoStore.getState().openRepoAt("/mnt/c/dev/reponame");

    // One prompt, one retry — never a second round.
    expect(confirmTrust).toHaveBeenCalledTimes(1);
    expect(calls("open_repo")).toHaveLength(2);
    expect(useRepoStore.getState().error?.kind).toBe("DubiousOwnership");
    expect(useRepoStore.getState().loading).toBe(false);
  });

  it("surfaces a failure to write the exception", async () => {
    armOpen(99);
    confirmTrust.mockResolvedValue(true);
    mockInvoke("trust_repo_path", () => {
      throw { kind: "Io", message: "permission denied" };
    });

    await useRepoStore.getState().openRepoAt("/mnt/c/dev/reponame");

    expect(useRepoStore.getState().error?.kind).toBe("Io");
    expect(useRepoStore.getState().loading).toBe(false);
  });

  it("leaves other open failures untouched", async () => {
    mockInvoke("open_repo", () => {
      throw { kind: "NotARepo", message: "path is not a git repository: /tmp/x" };
    });

    await useRepoStore.getState().openRepoAt("/tmp/x");

    expect(confirmTrust).not.toHaveBeenCalled();
    expect(useRepoStore.getState().error?.kind).toBe("NotARepo");
  });
});
