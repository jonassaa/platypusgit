// Cancelling a stalled fetch, pull or push (#234).
//
// Before this, a network op that hung had no way out but force-quitting the app.
// These pin the two halves of the fix that live in the store: the cancel reaches
// the backend addressed at THIS repository, and a cancelled op unwinds without
// raising an error banner — a red "early EOF" in answer to the user's own Cancel
// click is the failure mode worth a test of its own.

import { beforeEach, describe, expect, it } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useRepoStore } from "./useRepoStore";

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
/** #299 made every activity entry an object; these tests only care about the label. */
const act = (label: string) => ({ label, startedAt: Date.now() });
const cancelled = () => {
  throw { kind: "Cancelled" };
};

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
    error: null,
    activity: {},
    cancelRequested: false,
  });
  mockRefreshAll();
  // `pull` auto-stashes first when the setting is on (it is, by default). null
  // is "the tree was clean", which is the no-op this test wants — the subject
  // here is the pull's own cancellation, not the stash around it.
  mockInvoke("stash_save", () => null);
});

describe("cancelNetworkOps", () => {
  it("addresses the cancel at the open repository", async () => {
    mockInvoke("cancel_network_op", () => 1);

    await useRepoStore.getState().cancelNetworkOps();

    expect(calls("cancel_network_op")).toHaveLength(1);
    // A null repoId means "the clone" on the backend, so sending one here would
    // cancel the Clone dialog's clone instead of this repository's fetch.
    expect(calls("cancel_network_op")[0].args).toMatchObject({ repoId: "repo-1" });
  });

  it("does nothing at all when no repository is open", async () => {
    useRepoStore.setState({ current: null });
    mockInvoke("cancel_network_op", () => 1);

    await useRepoStore.getState().cancelNetworkOps();

    expect(calls("cancel_network_op")).toHaveLength(0);
  });

  it("reports a cancel that could not be signalled", async () => {
    // Silence here would read as "cancelled" while the user stayed stuck, which
    // is the whole bug — so this one failure IS worth a banner.
    mockInvoke("cancel_network_op", () => {
      throw { kind: "Internal", message: "no such repository" };
    });

    await useRepoStore.getState().cancelNetworkOps();

    expect(useRepoStore.getState().error).toMatchObject({ kind: "Internal" });
  });
});

describe.each([
  ["fetch", "fetch", () => useRepoStore.getState().fetch("origin")],
  ["fetchAll", "fetch_all", () => useRepoStore.getState().fetchAll()],
  ["pull", "pull", () => useRepoStore.getState().pull("origin", "main")],
  ["push", "push", () => useRepoStore.getState().push("origin", "main")],
] as const)("a cancelled %s", (_name, cmd, run) => {
  it("raises no error banner", async () => {
    mockInvoke(cmd, cancelled);

    await run();

    expect(useRepoStore.getState().error).toBeNull();
  });

  it("clears its activity label, so the status line does not stay stuck", async () => {
    mockInvoke(cmd, cancelled);

    await run();

    expect(useRepoStore.getState().activity).toEqual({});
  });
});

it("still reports a genuine network failure", async () => {
  // The guard above is `kind`-specific, not a blanket "network errors are
  // quiet": a real failure must still reach the banner.
  mockInvoke("fetch", () => {
    throw { kind: "Network", message: "could not resolve host" };
  });

  await useRepoStore.getState().fetch("origin");

  expect(useRepoStore.getState().error).toMatchObject({ kind: "Network" });
});

// The escalation is a two-click affordance on the backend (#263): the first
// cancel SIGTERMs, so git can remove its own lock files; a second SIGKILLs, so
// it cannot. The store has to carry that state, because a Cancel button that
// looks identical after the first click is one an impatient user double-clicks
// straight past the polite signal — re-creating the stranded `FETCH_HEAD.lock`
// the SIGTERM was added to prevent.
describe("the cancel is visible after the first click", () => {
  it("marks the repository as cancelling", async () => {
    mockInvoke("cancel_network_op", () => 1);
    useRepoStore.setState({ activity: { fetch: act("Fetching origin…") } });

    await useRepoStore.getState().cancelNetworkOps();

    expect(useRepoStore.getState().cancelRequested).toBe(true);
  });

  it("marks it even when the signal reached nothing", async () => {
    // 0 means the op finished between the user reading the status line and
    // clicking. The label still has to move: the click DID happen, and any
    // op still in flight under this scope was still marked on the backend.
    mockInvoke("cancel_network_op", () => 0);
    useRepoStore.setState({ activity: { fetch: act("Fetching origin…") } });

    await useRepoStore.getState().cancelNetworkOps();

    expect(useRepoStore.getState().cancelRequested).toBe(true);
  });

  it("clears once the last op has unwound, so the next click starts over", async () => {
    mockInvoke("cancel_network_op", () => 1);
    mockInvoke("fetch", cancelled);

    await useRepoStore.getState().cancelNetworkOps();
    expect(useRepoStore.getState().cancelRequested).toBe(true);

    await useRepoStore.getState().fetch("origin");

    // Activity is empty again, so the escalation state must be too — otherwise
    // the FIRST click of the next stalled fetch would read "Force stop" and
    // send SIGKILL to a git that had never been asked politely.
    expect(useRepoStore.getState().activity).toEqual({});
    expect(useRepoStore.getState().cancelRequested).toBe(false);
  });

  it("stays set while another op in the same scope is still running", async () => {
    mockInvoke("cancel_network_op", () => 1);
    useRepoStore.setState({
      activity: {
        fetch: act("Fetching origin…"),
        push: act("Pushing origin/main…"),
      },
    });

    await useRepoStore.getState().cancelNetworkOps();
    // One of the two unwinds; the other is the one still stuck.
    useRepoStore.setState({ activity: { push: act("Pushing origin/main…") } });

    expect(useRepoStore.getState().cancelRequested).toBe(true);
  });

  it("does nothing when there is no repository to cancel for", async () => {
    useRepoStore.setState({ current: null });
    mockInvoke("cancel_network_op", () => 1);

    await useRepoStore.getState().cancelNetworkOps();

    expect(useRepoStore.getState().cancelRequested).toBe(false);
  });
});
