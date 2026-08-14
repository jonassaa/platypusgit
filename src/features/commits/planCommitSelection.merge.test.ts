import { describe, it, expect } from "vitest";
import { planCommitSelection } from "./planCommitSelection";
import type { CommitInfo } from "@/lib/types";

/**
 * Newest-first log of
 *
 *   root ── A ──── C ── M   (main)
 *            \        /
 *             ─── F ──      (feature)
 *
 * The row after `C` is `F` — a side-branch commit, not C's parent. That is the
 * shape the positional `commits[max + 1]` base guess got wrong.
 */
function graphLog(): CommitInfo[] {
  const mk = (oid: string, summary: string, parents: string[]): CommitInfo => ({
    oid,
    shortOid: oid.slice(0, 7),
    summary,
    body: null,
    author: "Test",
    email: "t@e.com",
    timestamp: 0,
    parents,
    refs: [],
  });
  return [
    mk("m".repeat(40), "Merge branch 'feature'", ["c".repeat(40), "f".repeat(40)]),
    mk("c".repeat(40), "C on main", ["a".repeat(40)]),
    mk("f".repeat(40), "F on feature", ["a".repeat(40)]),
    mk("a".repeat(40), "A on main", ["r".repeat(40)]),
    mk("r".repeat(40), "root", []),
  ];
}

describe("planCommitSelection on non-linear history", () => {
  it("takes the base from the commit's first parent, not the next log row", () => {
    const plan = planCommitSelection(graphLog(), ["c".repeat(40)]);
    expect(plan?.baseOid).toBe("a".repeat(40));
  });

  it("reports a merge commit's base as its mainline parent", () => {
    const plan = planCommitSelection(graphLog(), ["m".repeat(40)]);
    expect(plan?.baseOid).toBe("c".repeat(40));
    expect(plan?.hasMerge).toBe(true);
  });

  it("null base for a root commit", () => {
    const plan = planCommitSelection(graphLog(), ["r".repeat(40)]);
    expect(plan?.baseOid).toBeNull();
  });

  it("adjacent log rows on different branches are not contiguous", () => {
    // C and F sit next to each other in the log but neither is the other's
    // parent, so they do not form a squashable run.
    const plan = planCommitSelection(graphLog(), ["c".repeat(40), "f".repeat(40)]);
    expect(plan?.contiguous).toBe(false);
  });

  it("a real first-parent chain is contiguous", () => {
    const plan = planCommitSelection(graphLog(), ["c".repeat(40), "a".repeat(40)]);
    expect(plan?.contiguous).toBe(true);
  });
});
