// Naming the backend reads a refresh is waiting on (#296 gap 8).
//
// `refreshAll` fires ten reads behind one `Promise.all` and had one boolean to
// describe all of them. These tests pin that each read now registers itself
// while it runs, that the registry empties again, and that a read issued
// against a tab the user has left cannot describe the tab they are on.

import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { trackLoad, useRepoStore } from "./useRepoStore";
import { emptySlice, frozenSlice } from "./repoSlice";
import { loadingSummary } from "./loadingTasks";

/** A promise plus the handle to settle it, so a test can hold a read open. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tasks = () => useRepoStore.getState().loadingTasks;
const ids = () => tasks().map((t) => t.id).sort();

function mockRefreshAll() {
  mockInvoke("get_status", () => []);
  mockInvoke("list_branches", () => []);
  mockInvoke("list_tags", () => []);
  mockInvoke("list_stashes", () => []);
  mockInvoke("list_remotes", () => []);
  mockInvoke("get_log_page", () => ({ commits: [], nextCursor: null }));
  mockInvoke("repo_state", () => "Clean");
  mockInvoke("rebase_status", () => null);
  mockInvoke("bisect_status", () => null);
  mockInvoke("head_info", () => null);
}

beforeEach(() => {
  resetInvokeMock();
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
  });
  mockRefreshAll();
});

describe("trackLoad", () => {
  it("registers the read before it can suspend", () => {
    // Synchronous registration is the contract: ten reads started in one
    // `Promise.all` must all be present immediately, or "longest-running" would
    // just report whichever microtask happened to run first.
    const d = deferred<number>();
    void trackLoad("repo-1", "status", "reading status", d.promise);
    expect(ids()).toEqual(["status"]);
    d.resolve(1);
  });

  it("removes the read when it settles, and passes the value through", async () => {
    const out = await trackLoad("repo-1", "status", "reading status", Promise.resolve(7));
    expect(out).toBe(7);
    expect(tasks()).toEqual([]);
  });

  it("removes the read when it rejects, and still rejects", async () => {
    // A failed read that stayed registered would leave the indicator lit
    // forever — and the failure path is exactly when a read is slow.
    await expect(
      trackLoad("repo-1", "status", "reading status", Promise.reject(new Error("nope"))),
    ).rejects.toThrow("nope");
    expect(tasks()).toEqual([]);
  });

  it("does not count the same read twice when refreshes overlap", () => {
    const a = deferred<number>();
    const b = deferred<number>();
    void trackLoad("repo-1", "status", "reading status", a.promise);
    void trackLoad("repo-1", "status", "reading status", b.promise);
    expect(tasks()).toHaveLength(1);
    a.resolve(1);
    b.resolve(2);
  });

  it("ignores a read belonging to another repository", async () => {
    await trackLoad("repo-2", "status", "reading status", Promise.resolve(1));
    expect(tasks()).toEqual([]);
  });

  it("does not remove a row after the user has switched tabs", async () => {
    // The removal is guarded as well as the add: repo A's read settling must
    // not reach into repo B's list, which by then holds B's own reads.
    const d = deferred<number>();
    void trackLoad("repo-1", "status", "reading status", d.promise);
    useRepoStore.setState({
      current: { id: "repo-2", path: "/tmp/repo-2", head: "main" },
      loadingTasks: [{ id: "status", label: "reading status", startedAt: 1 }],
    });

    d.resolve(1);
    await d.promise;

    expect(ids()).toEqual(["status"]);
  });
});

describe("refreshAll", () => {
  it("names every read it is waiting on", async () => {
    // One read held open; the other nine resolve. What is left is what the
    // status bar would be naming.
    const held = deferred<unknown[]>();
    mockInvoke("list_remotes", () => held.promise);

    const refreshing = useRepoStore.getState().refreshAll();
    // All ten, registered synchronously — a read added to `refreshAll` later
    // that skips `trackLoad` shows up here as a missing name.
    expect(ids()).toEqual([
      "bisect",
      "branches",
      "head",
      "log",
      "rebase",
      "remotes",
      "repoState",
      "stashes",
      "status",
      "tags",
    ]);

    held.resolve([]);
    await refreshing;

    expect(tasks()).toEqual([]);
  });

  it("narrows to the slow read once the fast ones finish", async () => {
    // The behaviour worth having: ten reads start together, so at t=0 they are
    // all equally long-running and the named one is an arbitrary (but stable)
    // pick. What makes the indicator useful is what happens next — the nine
    // fast reads drop off and the label is left pointing at the one that is
    // actually holding the refresh up.
    const held = deferred<unknown[]>();
    mockInvoke("list_remotes", () => held.promise);

    const refreshing = useRepoStore.getState().refreshAll();
    expect(loadingSummary(tasks())).toMatch(/\+ 9 others$/);

    // A macrotask, not a few microtasks: the fast reads each settle through
    // their own await chain, and counting ticks would be guesswork.
    await new Promise((r) => setTimeout(r, 0));

    expect(loadingSummary(tasks())).toBe("Loading: fetching remotes");

    held.resolve([]);
    await refreshing;
    expect(tasks()).toEqual([]);
  });

  it("clears the registry even when a read fails the whole refresh", async () => {
    mockInvoke("get_status", () => {
      throw new Error("boom");
    });

    await useRepoStore.getState().refreshAll();

    expect(tasks()).toEqual([]);
    expect(useRepoStore.getState().error).not.toBeNull();
  });
});

describe("parking a tab", () => {
  it("drops the task list, like every other in-flight marker", () => {
    // Writes are scoped to the current repository, so nothing would ever clear
    // a parked tab's rows — returning to it would show reads that finished long
    // ago, with clocks still counting up.
    const parked = frozenSlice({
      ...emptySlice(),
      loadingTasks: [{ id: "status", label: "reading status", startedAt: 1 }],
    });
    expect(parked.loadingTasks).toEqual([]);
  });
});
