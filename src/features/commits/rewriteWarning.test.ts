// The published-commit warning shared by every history-rewriting menu entry.
//
// `isPublished`'s argument order is the part worth pinning: getting it backwards
// inverts the warning silently, so it would fire on exactly the commits that are
// safe to rewrite and stay quiet on the ones that are not.

import { describe, it, expect, beforeEach } from "vitest";

import { isPublished, rewriteWarning } from "./rewriteWarning";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

describe("rewriteWarning", () => {
  it("names the upstream and the force-push when the commit is published", () => {
    expect(rewriteWarning("origin/main", true)).toBe(
      "This commit is already on origin/main. Rewriting it means your next push has to be forced.",
    );
  });

  it("is silent for an unpublished commit", () => {
    expect(rewriteWarning("origin/main", false)).toBeNull();
  });

  it("is silent when the branch tracks nothing — there is nothing to force", () => {
    expect(rewriteWarning(null, true)).toBeNull();
  });
});

describe("isPublished", () => {
  const aheadBehindCall = () => getInvokeCalls().find((c) => c.cmd === "ahead_behind");

  beforeEach(() => {
    // `behind` is "on a, not on b" (pinned by ref_compare.rs), so a commit is
    // published exactly when nothing on it is missing from the upstream.
    mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 0, mergeBase: null }));
  });

  it("asks about the commit against the upstream, in that order", async () => {
    await isPublished("r1", "abc1234", "origin/main");
    expect(aheadBehindCall()?.args).toMatchObject({
      repoId: "r1",
      a: "abc1234",
      b: "origin/main",
    });
  });

  it("is true when the commit is contained in the upstream", async () => {
    mockInvoke("ahead_behind", () => ({ ahead: 3, behind: 0, mergeBase: "abc" }));
    expect(await isPublished("r1", "abc1234", "origin/main")).toBe(true);
  });

  it("is false when the commit is not in the upstream yet", async () => {
    mockInvoke("ahead_behind", () => ({ ahead: 0, behind: 2, mergeBase: "abc" }));
    expect(await isPublished("r1", "abc1234", "origin/main")).toBe(false);
  });

  it("does not ask at all when the branch tracks nothing", async () => {
    expect(await isPublished("r1", "abc1234", null)).toBe(false);
    expect(aheadBehindCall()).toBeUndefined();
  });

  it("is false, not a throw, when the upstream cannot be resolved", async () => {
    // A deleted remote branch or a stale config. A warning is a courtesy, and
    // failing to compute one must never block the operation the user asked for.
    mockInvoke("ahead_behind", () => {
      throw { kind: "InvalidRef", message: "no such ref" };
    });
    expect(await isPublished("r1", "abc1234", "origin/gone")).toBe(false);
  });
});
