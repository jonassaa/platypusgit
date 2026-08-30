// The one indicator every long operation reports through (#296).
//
// The bug that motivated most of this: `withAuthRetry` resolves as soon as it
// RAISES a credential challenge — it does not await the retry, which runs later
// from the dialog's callback. `fetch` and `push` set their label before calling
// it and cleared it in a `finally`, so the label vanished the moment the
// password prompt appeared and the retried op — the slower attempt, by
// definition — ran with no spinner, no status line, and no Cancel button (the
// status bar gates Cancel on an activity entry existing).
//
// These tests pin the fix and the rest of the activity contract:
//
// - every attempt, first or retried, carries its own indicator;
// - the ops that had NO indicator at all now have one (tag push, branch delete,
//   rebase, LFS, submodule update, forge checkout);
// - a `net://progress` tick reaches only the repository it names, and only while
//   an op is actually live;
// - a label change within one operation does not restart its clock.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { getInvokeCalls, mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  applyNetProgress,
  applyRebaseProgress,
  setActivity,
  useRepoStore,
} from "./useRepoStore";
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

const httpsChallenge = () => {
  throw { kind: "Auth", message: { host: "github.com", kind: "Https" } };
};

const activity = () => useRepoStore.getState().activity;

beforeEach(() => {
  resetInvokeMock();
  useAuthStore.setState({ challenge: null });
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "repo-1", path: "/tmp/repo-1", head: "main" },
  });
  mockRefreshAll();
  mockInvoke("remember_credential", () => null);
});

describe("the credential retry keeps its indicator", () => {
  it("holds the entry open while the challenge is unanswered", async () => {
    // This is the regression. `fetch` resolves as soon as the dialog is raised;
    // if it cleared the entry on the way out, the user would be typing a
    // password with nothing on screen saying a fetch is waiting on them.
    mockInvoke("fetch", httpsChallenge);

    await useRepoStore.getState().fetch("origin");

    expect(useAuthStore.getState().challenge).not.toBeNull();
    // The first attempt is over, so its entry is gone — but the moment the retry
    // runs, one comes back. That is what the next test pins.
    expect(activity().fetch).toBeUndefined();
  });

  it("re-opens the entry for the retried attempt, and clears it when that ends", async () => {
    let seenDuringRetry: string | undefined;
    let attempts = 0;
    mockInvoke("fetch", () => {
      attempts += 1;
      if (attempts === 1) httpsChallenge();
      // Sampled INSIDE the retried op: this is precisely the window that used to
      // have no spinner and no Cancel.
      seenDuringRetry = activity().fetch?.label;
      return null;
    });

    await useRepoStore.getState().fetch("origin");
    const challenge = useAuthStore.getState().challenge!;
    await challenge.retry({ username: "u", secret: "s" }, false);

    expect(attempts).toBe(2);
    expect(seenDuringRetry).toBe("Fetching origin…");
    expect(activity().fetch).toBeUndefined();
  });

  it("clears the entry even when the retry fails again", async () => {
    mockInvoke("push", httpsChallenge);

    await useRepoStore.getState().push("origin", "main");
    const challenge = useAuthStore.getState().challenge!;
    await challenge.retry({ username: "u", secret: "s" }, false);

    // A second failure must not park a spinner and a Cancel button forever.
    expect(activity().push).toBeUndefined();
  });
});

describe("every network op reports itself", () => {
  it.each([
    ["fetch", "fetch", () => useRepoStore.getState().fetch("origin"), "Fetching origin…"],
    ["fetch", "fetch_all", () => useRepoStore.getState().fetchAll(), "Fetching all remotes…"],
    [
      "push",
      "push",
      () => useRepoStore.getState().push("origin", "main"),
      "Pushing origin/main…",
    ],
    // These two had no indicator at all before #296: silent, and therefore
    // un-cancellable, because the Cancel button is gated on one existing.
    [
      "push",
      "push_tag",
      () => useRepoStore.getState().pushTag("origin", "v1.2.0"),
      "Pushing tag v1.2.0…",
    ],
    [
      "push",
      "push_delete_branch",
      () => useRepoStore.getState().pushDeleteBranch("origin", "feature/x"),
      "Deleting origin/feature/x…",
    ],
    // Fast-forward landed with the same hand-rolled label-plus-`finally` shape
    // that broke fetch and push on the retry path.
    [
      "fetch",
      "fast_forward_all_branches",
      () => useRepoStore.getState().fastForwardAllBranches(),
      "Fast-forwarding branches…",
    ],
  ])("%s: %s", async (key, cmd, run, label) => {
    let seen: string | undefined;
    mockInvoke(cmd, () => {
      seen = activity()[key as "fetch" | "push"]?.label;
      return null;
    });

    await run();

    expect(seen).toBe(label);
    expect(activity()[key as "fetch" | "push"]).toBeUndefined();
  });

  it("says it is refreshing once the transfer is done", async () => {
    // The fetch finishes long before `refreshAll`'s ten queries do; holding
    // "Fetching origin…" over them is the label lying about what it is doing.
    const labels: string[] = [];
    mockInvoke("fetch", () => null);
    mockInvoke("get_status", () => {
      const l = activity().fetch?.label;
      if (l) labels.push(l);
      return [];
    });

    await useRepoStore.getState().fetch("origin");

    expect(labels).toEqual(["Refreshing…"]);
  });
});

describe("the rebase indicator", () => {
  it("is live for the whole replay and gone afterwards", async () => {
    let seen: string | undefined;
    mockInvoke("rebase_start", () => {
      seen = activity().rebase?.label;
      return { inProgress: false, nextIndex: 2, total: 2, pauseReason: null };
    });

    await useRepoStore.getState().rebaseStart([
      { oid: "a".repeat(40), action: "Pick", message: null, onto: null, mergeParents: [] },
      { oid: "b".repeat(40), action: "Pick", message: null, onto: null, mergeParents: [] },
    ]);

    expect(seen).toBe("Rebasing 2 commits…");
    expect(activity().rebase).toBeUndefined();
  });

  it("clears after a failure, so the Start button comes back", async () => {
    mockInvoke("rebase_start", () => {
      throw { kind: "DirtyWorktree", message: "commit or stash first" };
    });

    await useRepoStore.getState().rebaseStart([
      { oid: "a".repeat(40), action: "Pick", message: null, onto: null, mergeParents: [] },
    ]);

    expect(activity().rebase).toBeUndefined();
    expect(useRepoStore.getState().error).not.toBeNull();
  });
});

describe("progress ticks", () => {
  it("fill in the phase and percent of the live op", () => {
    setActivity("repo-1", "fetch", "Fetching origin…");
    applyNetProgress({
      repoId: "repo-1",
      op: "Fetch",
      phase: "Receiving objects",
      percent: 62,
    });

    expect(activity().fetch).toMatchObject({
      label: "Fetching origin…",
      phase: "Receiving objects",
      percent: 62,
    });
  });

  it("are dropped when they name a different repository", () => {
    // The event is app-global. A background tab's fetch must not drive the
    // active tab's bar.
    setActivity("repo-1", "fetch", "Fetching origin…");
    applyNetProgress({ repoId: "repo-2", op: "Fetch", phase: "Receiving objects", percent: 62 });

    expect(activity().fetch?.percent).toBeUndefined();
  });

  it("are dropped when no such op is running", () => {
    // Ticks are still in flight when the process exits. One that landed after
    // the entry was cleared would resurrect a status line — and a Cancel button
    // — over an operation that is already over.
    applyNetProgress({ repoId: "repo-1", op: "Push", phase: "Writing objects", percent: 10 });

    expect(activity().push).toBeUndefined();
  });

  it("relabel a rebase with the step it is on", () => {
    setActivity("repo-1", "rebase", "Rebasing 200 commits…");
    applyRebaseProgress({
      repoId: "repo-1",
      nextIndex: 11,
      total: 200,
      action: "Pick",
      shortOid: "a1b2c3d",
      subject: "fix(diff): stop scrolling on selection",
    });

    // `nextIndex` counts steps DONE, so the one being applied is the 12th.
    expect(activity().rebase?.label).toBe(
      "Rebasing 12 of 200: fix(diff): stop scrolling on selection",
    );
    expect(activity().rebase?.percent).toBe(6);
  });

  it("fall back to the oid when a subject could not be read", () => {
    setActivity("repo-1", "rebase", "Rebasing…");
    applyRebaseProgress({
      repoId: "repo-1",
      nextIndex: 0,
      total: 1,
      action: "Pick",
      shortOid: "a1b2c3d",
      subject: "",
    });

    expect(activity().rebase?.label).toBe("Rebasing 1 of 1: a1b2c3d");
  });
});

describe("setActivity", () => {
  it("keeps the clock running across a label change", () => {
    // Pull is stash → pull → pop: three labels, one wait. Restarting the elapsed
    // clock at each would make it useless exactly when the user is watching it.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_000));
      setActivity("repo-1", "pull", "Stashing changes…");
      const started = activity().pull!.startedAt;

      vi.setSystemTime(new Date(1_050_000));
      setActivity("repo-1", "pull", "Pulling origin/main…");

      expect(activity().pull!.startedAt).toBe(started);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a stale bar when the phase changes", () => {
    setActivity("repo-1", "pull", "Pulling origin/main…");
    applyNetProgress({ repoId: "repo-1", op: "Pull", phase: "Receiving objects", percent: 90 });
    setActivity("repo-1", "pull", "Restoring stashed changes…");

    // 90% of the fetch says nothing about the stash pop that follows it.
    expect(activity().pull?.percent).toBeUndefined();
    expect(activity().pull?.phase).toBeUndefined();
  });

  it("removes the entry on null", () => {
    setActivity("repo-1", "lfs", "Fetching LFS objects…");
    expect(activity().lfs).toBeDefined();
    setActivity("repo-1", "lfs", null);
    expect("lfs" in activity()).toBe(false);
  });

  it("does not write into another repository's slice", () => {
    // An op outlives a tab switch. A fetch on A finishing after the user moved
    // to B used to clear B's entry — taking B's own spinner and Cancel with it.
    setActivity("repo-1", "fetch", "Fetching origin…");
    useRepoStore.setState({
      current: { id: "repo-2", path: "/tmp/repo-2", head: "main" },
      activity: { fetch: { label: "Fetching upstream…", startedAt: 1 } },
    });

    setActivity("repo-1", "fetch", null);

    expect(activity().fetch?.label).toBe("Fetching upstream…");
  });
});

describe("parking a tab", () => {
  it("clears the activity so a finished op cannot leave a spinner behind", async () => {
    // The other half of the guard above: with writes scoped to the current
    // repository, nothing will ever clear a parked tab's entry. Returning to it
    // would show a live-looking status line, and a Cancel button, for an
    // operation that ended minutes ago.
    const { frozenSlice } = await import("./repoSlice");
    const parked = frozenSlice({
      ...emptySlice(),
      activity: { fetch: { label: "Fetching origin…", startedAt: 1, percent: 40 } },
    });
    expect(parked.activity).toEqual({});
  });
});

describe("cancel reaches the ops that go through the shared runner", () => {
  it("cancels by repository, not by op", async () => {
    mockInvoke("cancel_network_op", () => 1);
    await useRepoStore.getState().cancelNetworkOps();
    expect(getInvokeCalls().filter((c) => c.cmd === "cancel_network_op")).toHaveLength(1);
  });
});
