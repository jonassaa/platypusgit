// Two silent-wrongness bugs the first cut of the compare store had (#131 review).
//
// Both are "the UI shows one thing and the data underneath is another", which no
// error path catches — so they get their own file rather than a case tacked onto
// the screen test.

import { describe, it, expect, beforeEach } from "vitest";

import { markedRefFor, useCompareStore } from "./useCompareStore";
import { WORKDIR } from "./compareSides";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { mockInvoke } from "@/test/invokeMock";
import type { AheadBehind, CommitInfo, FileDiff } from "@/lib/types";

const repoA = { id: "repo-a", path: "/a", head: "refs/heads/main" };
const repoB = { id: "repo-b", path: "/b", head: "refs/heads/main" };

const SUMMARY = (ahead: number): AheadBehind => ({
  ahead,
  behind: 0,
  mergeBase: "c".repeat(40),
});

const fileNamed = (path: string): FileDiff =>
  ({
    path,
    oldPath: null,
    binary: false,
    additions: 1,
    deletions: 0,
    hunks: [],
  }) as unknown as FileDiff;

/** A deferred promise, so a test decides the resolution ORDER. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useRepoStore.setState({ current: repoA } as never);
  useCompareStore.setState({
    repoId: repoA.id,
    left: { kind: "rev", rev: "main" },
    right: WORKDIR,
    diffs: [],
    summary: null,
    aheadCommits: [],
    behindCommits: [],
    loading: false,
    error: null,
    marked: null,
  });
});

describe("a superseded request never paints", () => {
  it("drops an earlier pair's response that lands after a newer pair's", async () => {
    // The repro from review: compare `main → feature` in a large repo, then pick
    // `v0.1` on the left. `v0.1` answers first; `main`'s four responses land
    // after — and with a repo-identity-only guard they overwrote the store while
    // the bar read `v0.1 → feature`.
    const slow = deferred<FileDiff[]>();
    const fast = deferred<FileDiff[]>();

    mockInvoke("ahead_behind", () => SUMMARY(1));
    mockInvoke("commits_between", () => [] as CommitInfo[]);
    mockInvoke("diff_commits", (args) =>
      args.fromOid === "main" ? slow.promise : fast.promise,
    );

    const store = useCompareStore.getState();
    store.open({ kind: "rev", rev: "main" }, { kind: "rev", rev: "feature" });
    const first = store.refresh(3, false);

    // The user picks another base while the first request is still in flight.
    useCompareStore.getState().setLeft({ kind: "rev", rev: "v0.1" });
    const second = useCompareStore.getState().refresh(3, false);

    fast.resolve([fileNamed("from-v0.1.ts")]);
    await second;
    slow.resolve([fileNamed("from-main.ts")]);
    await first;

    expect(useCompareStore.getState().left).toEqual({ kind: "rev", rev: "v0.1" });
    expect(useCompareStore.getState().diffs.map((d) => d.path)).toEqual([
      "from-v0.1.ts",
    ]);
  });

  it("drops a response whose repository is no longer the active one", async () => {
    const pending = deferred<FileDiff[]>();
    mockInvoke("diff_ref_to_workdir", () =>
      pending.promise.then((files) => ({ files, untrackedOmitted: 0 })),
    );

    const run = useCompareStore.getState().refresh(3, false);
    // A tab switch leaves the compare store untouched, so the token alone would
    // not see this — the repo check is what catches it.
    useRepoStore.setState({ current: repoB } as never);

    pending.resolve([fileNamed("from-repo-a.ts")]);
    await run;

    expect(useCompareStore.getState().diffs).toEqual([]);
  });

  it("drops a stale FAILURE too, so an old error cannot replace fresh results", async () => {
    const failing = deferred<FileDiff[]>();
    mockInvoke("ahead_behind", () => SUMMARY(1));
    mockInvoke("commits_between", () => [] as CommitInfo[]);
    mockInvoke("diff_commits", (args) =>
      args.fromOid === "main"
        ? failing.promise
        : Promise.resolve([fileNamed("good.ts")]),
    );

    const store = useCompareStore.getState();
    store.open({ kind: "rev", rev: "main" }, { kind: "rev", rev: "feature" });
    const first = store.refresh(3, false);

    useCompareStore.getState().setLeft({ kind: "rev", rev: "v0.1" });
    await useCompareStore.getState().refresh(3, false);

    failing.reject({ kind: "InvalidRef", message: "main" });
    await first;

    expect(useCompareStore.getState().error).toBeNull();
    expect(useCompareStore.getState().diffs.map((d) => d.path)).toEqual(["good.ts"]);
  });
});

describe("the compare mark is scoped to the repository it was taken in", () => {
  it("is not offered in another repository", () => {
    useCompareStore.getState().mark("feature/pricing");
    expect(markedRefFor(repoA.id)).toBe("feature/pricing");

    // ⌘E to another tab.
    useRepoStore.setState({ current: repoB } as never);
    expect(markedRefFor(repoB.id)).toBeNull();

    // ...and coming back does not lose it.
    useRepoStore.setState({ current: repoA } as never);
    expect(markedRefFor(repoA.id)).toBe("feature/pricing");
  });

  it("ignores a mark taken with no repository open", () => {
    useRepoStore.setState({ current: null } as never);
    useCompareStore.getState().mark("feature/pricing");
    expect(useCompareStore.getState().marked).toBeNull();
    expect(markedRefFor(null)).toBeNull();
  });
});
