// The auto-fetch timer, and the deadline that belongs to it alone (#263 item 5).
//
// #260 rejected a global network timeout, and that reasoning holds for anything
// the USER started: a timeout short enough to rescue a stalled host is short
// enough to kill a legitimately slow clone, and only the user can tell those
// apart. It does not cover the ops the TIMER started — nobody is watching those,
// and the skip-while-running guard means one stalled fetch blocks auto-fetch
// FOREVER rather than piling up.
//
// So these tests pin both halves: the deadline reaches a fetch the timer started
// and stalled, and it can never reach a fetch anyone else started.

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { AUTO_FETCH_DEADLINE_MS, startAutoFetch } from "./autoFetch";
import { useRepoStore } from "./useRepoStore";
import { emptySlice } from "./repoSlice";

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
/** A fetch that never answers — the stalled remote, with no network involved. */
const stalls = () => new Promise<void>(() => {});

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  resetInvokeMock();
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
  });
  mockRefreshAll();
  mockInvoke("cancel_network_op", () => 1);
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("the timer", () => {
  it("fetches on every tick", async () => {
    mockInvoke("fetch_all", () => null);
    stop = startAutoFetch(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls("fetch_all")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls("fetch_all")).toHaveLength(2);
  });

  it("skips a tick while a fetch is already running", async () => {
    mockInvoke("fetch_all", stalls);
    stop = startAutoFetch(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    // One stalled fetch, not a growing pile of them (#234).
    expect(calls("fetch_all")).toHaveLength(1);
  });

  it("stops ticking once disposed", async () => {
    mockInvoke("fetch_all", () => null);
    stop = startAutoFetch(1);
    stop();
    stop = null;

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls("fetch_all")).toHaveLength(0);
  });
});

describe("the deadline", () => {
  it("cancels a timer-started fetch that is still running when it expires", async () => {
    mockInvoke("fetch_all", stalls);
    stop = startAutoFetch(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls("cancel_network_op")).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(AUTO_FETCH_DEADLINE_MS);

    // Addressed at the repository, which is what makes it a scope cancel rather
    // than the Clone dialog's clone.
    expect(calls("cancel_network_op")).toHaveLength(1);
    expect(calls("cancel_network_op")[0].args).toMatchObject({ repoId: "repo-1" });
  });

  it("leaves a fetch that finished in time alone", async () => {
    mockInvoke("fetch_all", () => null);
    stop = startAutoFetch(1);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(AUTO_FETCH_DEADLINE_MS);

    expect(calls("cancel_network_op")).toHaveLength(0);
  });

  it("never reaches a fetch the user started", async () => {
    mockInvoke("fetch_all", stalls);
    stop = startAutoFetch(1);

    // The user's own fetch, stalled, with no tick having started anything: the
    // timer then SKIPS (a fetch is running), so there is nothing to arm a
    // deadline. This is the case #260 rejected a timeout for — a slow op the
    // user is watching and can cancel themselves.
    void useRepoStore.getState().fetchAll();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls("fetch_all")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(AUTO_FETCH_DEADLINE_MS * 2);
    expect(calls("cancel_network_op")).toHaveLength(0);
  });

  it("is disarmed when the timer is", async () => {
    mockInvoke("fetch_all", stalls);
    stop = startAutoFetch(1);

    await vi.advanceTimersByTimeAsync(60_000);
    stop();
    stop = null;

    await vi.advanceTimersByTimeAsync(AUTO_FETCH_DEADLINE_MS);
    expect(calls("cancel_network_op")).toHaveLength(0);
  });

  it("does not fire into a repository the user has switched to", async () => {
    mockInvoke("fetch_all", stalls);
    stop = startAutoFetch(1);
    await vi.advanceTimersByTimeAsync(60_000);
    const startedAt = useRepoStore.getState().activity.fetch!.startedAt;

    // repo-2, with a fetch of its own carrying the SAME `startedAt` —
    // millisecond wall-clock is not an identity, and `cancelNetworkOps`
    // addresses whichever repository is open now. Without the repository guard
    // this deadline would cancel repo-2's fetch, which nobody put a clock on.
    useRepoStore.setState({
      ...emptySlice(),
      current: { id: "repo-2", path: "/tmp/repo-2", head: "main" },
      activity: { fetch: { label: "Fetching all remotes…", startedAt } },
    });

    await vi.advanceTimersByTimeAsync(AUTO_FETCH_DEADLINE_MS);
    expect(calls("cancel_network_op")).toHaveLength(0);
  });
});
