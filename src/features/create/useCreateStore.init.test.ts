// `init_repo` opens what it just created, so it answers with a REGISTERED
// RepoId — and the store then hands the path to the tab layer, whose own open
// mints a SECOND one, because `open` never reuses an entry (only `close_repo`
// removes one). Unless the handle init answered with is evicted it is a
// git2::Repository, and its file handles, held for the life of the process:
// the same leak issue 177 reports, reached through the New-repository door
// rather than the launch one.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useTabsStore } from "@/features/repo/useTabsStore";
import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";

import { useCreateStore } from "./useCreateStore";

const HANDLE = { id: "repo-init-1", path: "/dev/fresh", head: "main" };
const calls = (cmd: string) => getInvokeCalls().filter((c) => c.cmd === cmd);
const openRepo = vi.fn(async () => {});

beforeEach(() => {
  resetInvokeMock();
  openRepo.mockClear();
  useCreateStore.setState({ open: "init", busy: false, progress: null, error: null });
  // The tab layer's own open is its business (and covered by its own tests);
  // what this file asserts is that the store does not leave the handle it was
  // handed behind when it delegates.
  useTabsStore.setState({ openRepo });
  mockInvoke("init_repo", () => HANDLE);
  mockInvoke("close_repo", () => undefined);
});

describe("useCreateStore.runInit — one RepoId per repository", () => {
  it("evicts the handle init answered with before delegating to the tab layer", async () => {
    await useCreateStore.getState().runInit({
      parentDir: "/dev",
      name: "fresh",
      branch: "main",
    });

    expect(openRepo).toHaveBeenCalledWith("/dev/fresh");
    expect(calls("close_repo").map((c) => c.args.repoId)).toEqual(["repo-init-1"]);
    expect(useCreateStore.getState().error).toBeNull();
    expect(useCreateStore.getState().open).toBe("none");
  });
});
