// Store-level tests: the generic conflict continue/abort must route to the
// rebase-specific ops while an interactive rebase is in progress. Otherwise a
// resolved rebase conflict would be committed as a standalone commit that
// leaves the rebase half-done, and a later abort would reset to orig_head and
// discard it (data loss).
import { beforeEach, describe, expect, it } from "vitest";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import type { RebaseStatus } from "@/lib/types";

const REBASING: RebaseStatus = {
  inProgress: true,
  nextIndex: 1,
  total: 2,
  pauseReason: "conflict",
};
const DONE: RebaseStatus = {
  inProgress: false,
  nextIndex: 2,
  total: 2,
  pauseReason: null,
};

const initial = useRepoStore.getState();

function armStore(rebaseStatus: RebaseStatus) {
  useRepoStore.setState(initial, true);
  useRepoStore.setState({
    current: { id: "repo-1", path: "/tmp/repo", head: "main" },
    rebaseStatus,
    // Isolate routing from the full refresh fan-out.
    refreshAll: async () => {},
  });
}

const called = (cmd: string) => getInvokeCalls().some((c) => c.cmd === cmd);

describe("useRepoStore conflict continue/abort routing", () => {
  beforeEach(() => {
    mockInvoke("rebase_continue", () => DONE);
    mockInvoke("rebase_abort", () => null);
    mockInvoke("continue_operation", () => "standalone-oid");
    mockInvoke("abort_operation", () => null);
  });

  it("continueOperation resumes the rebase when one is in progress", async () => {
    armStore(REBASING);
    await useRepoStore.getState().continueOperation();
    expect(called("rebase_continue")).toBe(true);
    expect(called("continue_operation")).toBe(false);
  });

  it("abortOperation aborts the rebase when one is in progress", async () => {
    armStore(REBASING);
    await useRepoStore.getState().abortOperation();
    expect(called("rebase_abort")).toBe(true);
    expect(called("abort_operation")).toBe(false);
  });

  it("continueOperation uses the generic op when no rebase is in progress", async () => {
    armStore(DONE); // inProgress: false
    await useRepoStore.getState().continueOperation();
    expect(called("continue_operation")).toBe(true);
    expect(called("rebase_continue")).toBe(false);
  });

  it("abortOperation uses the generic op when no rebase is in progress", async () => {
    armStore(DONE);
    await useRepoStore.getState().abortOperation();
    expect(called("abort_operation")).toBe(true);
    expect(called("rebase_abort")).toBe(false);
  });
});
