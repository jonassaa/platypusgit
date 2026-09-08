// amendMessage — reword HEAD in place, message only.
//
// The three failure shapes matter as much as the success one: a hook refusal
// and a missing identity are questions the commit panel can answer in place,
// so they land in their own per-repo fields rather than the error banner.

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
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => ({
    inProgress: false,
    nextIndex: 0,
    total: 0,
    pauseReason: null,
  }));
}

const amendCall = () => getInvokeCalls().find((c) => c.cmd === "amend_head_message");

describe("amendMessage", () => {
  beforeEach(() => {
    useRepoStore.setState({
      current: { id: "r1", path: "/repo", head: "main" },
      error: null,
      hookRejection: null,
      noSignature: false,
    } as never);
    mockRefresh();
  });

  it("sends the expected oid, so a moved HEAD is refused by the backend", async () => {
    mockInvoke("amend_head_message", () => ({ oid: "new1234", message: "reworded" }));
    await useRepoStore.getState().amendMessage("old1234", "reworded");
    expect(amendCall()?.args).toMatchObject({
      repoId: "r1",
      expectedOid: "old1234",
      message: "reworded",
    });
  });

  it("resolves true and refreshes, so the log repaints with the new oid", async () => {
    mockInvoke("amend_head_message", () => ({ oid: "new1234", message: "reworded" }));
    const ok = await useRepoStore.getState().amendMessage("old1234", "reworded");
    expect(ok).toBe(true);
    expect(getInvokeCalls().some((c) => c.cmd === "get_status")).toBe(true);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("routes a hook refusal to hookRejection, not the error banner", async () => {
    mockInvoke("amend_head_message", () => {
      throw { kind: "HookRejected", message: { hook: "commit-msg", output: "nope" } };
    });
    const ok = await useRepoStore.getState().amendMessage("old1234", "bad");
    expect(ok).toBe(false);
    expect(useRepoStore.getState().hookRejection).toMatchObject({ hook: "commit-msg" });
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("puts a missing identity in noSignature, not the error banner", async () => {
    mockInvoke("amend_head_message", () => {
      throw { kind: "NoSignature" };
    });
    const ok = await useRepoStore.getState().amendMessage("old1234", "x");
    expect(ok).toBe(false);
    expect(useRepoStore.getState().noSignature).toBe(true);
    expect(useRepoStore.getState().error).toBeNull();
  });

  it("reports any other failure in the banner", async () => {
    mockInvoke("amend_head_message", () => {
      throw { kind: "InvalidArgument", message: "HEAD has moved" };
    });
    const ok = await useRepoStore.getState().amendMessage("old1234", "x");
    expect(ok).toBe(false);
    expect(useRepoStore.getState().error?.kind).toBe("InvalidArgument");
  });

  it("clears a previous refusal before trying again", async () => {
    useRepoStore.setState({
      hookRejection: { hook: "commit-msg", output: "old" },
    } as never);
    mockInvoke("amend_head_message", () => ({ oid: "new1234", message: "ok" }));
    await useRepoStore.getState().amendMessage("old1234", "ok");
    expect(useRepoStore.getState().hookRejection).toBeNull();
  });

  it("does nothing without an open repository", async () => {
    useRepoStore.setState({ current: null } as never);
    const ok = await useRepoStore.getState().amendMessage("old1234", "x");
    expect(ok).toBe(false);
    expect(amendCall()).toBeUndefined();
  });
});
