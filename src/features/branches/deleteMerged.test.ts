// "Delete merged branches in this folder" (#244) — the operation the flat list
// made tedious, and the one destructive thing a folder row can do.

import { describe, it, expect } from "vitest";
import { mockInvoke, getInvokeCalls } from "@/test/invokeMock";
import {
  deleteMergedCandidates,
  findMergedBranches,
  summarizeDeleteMerged,
} from "./deleteMerged";
import type { BranchInfo } from "@/lib/types";

const b = (over: Partial<BranchInfo> & { name: string }): BranchInfo => ({
  isHead: false,
  isRemote: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "a".repeat(40),
  tipTime: 0,
  isDefault: false,
  ...over,
});

const names = (rows: readonly BranchInfo[]) => rows.map((r) => r.name);

describe("deleteMergedCandidates", () => {
  it("takes the local branches inside the folder", () => {
    const rows = deleteMergedCandidates(
      [b({ name: "feat/a" }), b({ name: "feat/deep/c" }), b({ name: "main" })],
      "feat",
    );

    expect(names(rows)).toEqual(["feat/a", "feat/deep/c"]);
  });

  // Deleting a remote branch is a push, not a local ref delete — a bulk action
  // must not reach across the network on one menu click.
  it("never offers a remote branch", () => {
    const rows = deleteMergedCandidates(
      [b({ name: "origin/feat/a", isRemote: true }), b({ name: "feat/a" })],
      "feat",
    );

    expect(names(rows)).toEqual(["feat/a"]);
  });

  it("never offers the branch you are standing on", () => {
    const rows = deleteMergedCandidates(
      [b({ name: "feat/a", isHead: true }), b({ name: "feat/b" })],
      "feat",
    );

    expect(names(rows)).toEqual(["feat/b"]);
  });

  // A repository whose default branch lives in a folder (`trunk/main`) must not
  // lose it to a bulk delete — it is merged into HEAD by definition half the time.
  it("never offers the default branch", () => {
    const rows = deleteMergedCandidates(
      [b({ name: "trunk/main", isDefault: true }), b({ name: "trunk/old" })],
      "trunk",
    );

    expect(names(rows)).toEqual(["trunk/old"]);
  });

  it("skips a branch whose tip could not be resolved", () => {
    const rows = deleteMergedCandidates(
      [b({ name: "feat/broken", tip: null }), b({ name: "feat/ok" })],
      "feat",
    );

    expect(names(rows)).toEqual(["feat/ok"]);
  });

  it("matches the folder on a segment boundary", () => {
    const rows = deleteMergedCandidates(
      [b({ name: "feature/x" }), b({ name: "feat/y" })],
      "feat",
    );

    expect(names(rows)).toEqual(["feat/y"]);
  });
});

describe("findMergedBranches", () => {
  it("keeps only branches with nothing the base does not have", async () => {
    mockInvoke("ahead_behind", ({ b: branch }) => ({
      ahead: branch === "feat/done" ? 0 : 3,
      behind: 0,
      mergeBase: "c".repeat(40),
    }));

    const merged = await findMergedBranches("repo-1", "HEAD", [
      b({ name: "feat/done" }),
      b({ name: "feat/wip" }),
    ]);

    expect(names(merged)).toEqual(["feat/done"]);
  });

  it("asks about each branch against the base, in order", async () => {
    mockInvoke("ahead_behind", () => ({
      ahead: 0,
      behind: 0,
      mergeBase: null,
    }));

    await findMergedBranches("repo-1", "HEAD", [
      b({ name: "feat/one" }),
      b({ name: "feat/two" }),
    ]);

    expect(
      getInvokeCalls()
        .filter((c) => c.cmd === "ahead_behind")
        .map((c) => [c.args.a, c.args.b]),
    ).toEqual([
      ["HEAD", "feat/one"],
      ["HEAD", "feat/two"],
    ]);
  });

  // The safe direction: a branch we could not ask about is NOT offered for
  // deletion, and one unreadable ref does not abandon the whole operation.
  it("treats a branch it cannot ask about as unmerged", async () => {
    mockInvoke("ahead_behind", ({ b: branch }) => {
      if (branch === "feat/broken") throw new Error("InvalidRef");
      return { ahead: 0, behind: 0, mergeBase: null };
    });

    const merged = await findMergedBranches("repo-1", "HEAD", [
      b({ name: "feat/broken" }),
      b({ name: "feat/fine" }),
    ]);

    expect(names(merged)).toEqual(["feat/fine"]);
  });

  it("asks nothing when there are no candidates", async () => {
    const merged = await findMergedBranches("repo-1", "HEAD", []);

    expect(merged).toEqual([]);
    expect(getInvokeCalls()).toEqual([]);
  });
});

describe("summarizeDeleteMerged", () => {
  it("names the one branch it deleted", () => {
    expect(summarizeDeleteMerged(["feat/a"], [])).toBe("Deleted feat/a");
  });

  it("counts several", () => {
    expect(summarizeDeleteMerged(["feat/a", "feat/b"], [])).toBe(
      "Deleted 2 branches",
    );
  });

  // A partial delete is the interesting outcome and must never read as success.
  it("reports what it could not delete alongside what it did", () => {
    expect(summarizeDeleteMerged(["feat/a"], ["feat/b"])).toBe(
      "Deleted feat/a · feat/b could not be deleted",
    );
  });

  it("counts several failures", () => {
    expect(summarizeDeleteMerged([], ["feat/a", "feat/b"])).toBe(
      "2 branches could not be deleted",
    );
  });

  it("says so when nothing happened", () => {
    expect(summarizeDeleteMerged([], [])).toBe("No branches were deleted");
  });
});
