import { describe, it, expect } from "vitest";
import { planCommitSelection } from "./planCommitSelection";
import type { CommitInfo } from "@/lib/types";

const mk = (oid: string, parents: string[] = []): CommitInfo => ({
  oid, shortOid: oid.slice(0, 7), summary: oid, body: null,
  author: "", email: "", timestamp: 0, parents, refs: [],
});

// Newest-first log: d(0) → c(1) → b(2) → a(3, root).
const log = [mk("d", ["c"]), mk("c", ["b"]), mk("b", ["a"]), mk("a", [])];

describe("planCommitSelection", () => {
  it("returns null for an empty selection", () => {
    expect(planCommitSelection(log, [])).toBeNull();
  });

  it("orders oids oldest→newest and finds the base (parent of oldest)", () => {
    const plan = planCommitSelection(log, ["c", "b"])!;
    expect(plan.oids).toEqual(["b", "c"]); // oldest first
    expect(plan.oldestOid).toBe("b");
    expect(plan.newestOid).toBe("c");
    expect(plan.baseOid).toBe("a"); // commits[maxIdx+1]
    expect(plan.contiguous).toBe(true);
    expect(plan.hasMerge).toBe(false);
  });

  it("flags a non-contiguous selection", () => {
    const plan = planCommitSelection(log, ["d", "b"])!; // indices 0 and 2
    expect(plan.contiguous).toBe(false);
    expect(plan.oldestOid).toBe("b");
    expect(plan.newestOid).toBe("d");
  });

  it("base is null when the oldest selected is the root (no loaded parent)", () => {
    const plan = planCommitSelection(log, ["b", "a"])!; // a is root, index 3 (last)
    expect(plan.contiguous).toBe(true);
    expect(plan.oldestOid).toBe("a");
    expect(plan.baseOid).toBeNull();
  });

  it("detects a merge commit in the selection", () => {
    const withMerge = [mk("d"), mk("c", ["b", "x"]), mk("b"), mk("a")];
    const plan = planCommitSelection(withMerge, ["c", "b"])!;
    expect(plan.hasMerge).toBe(true);
  });

  it("ignores oids not present in the log", () => {
    const plan = planCommitSelection(log, ["c", "zzz"])!;
    expect(plan.oids).toEqual(["c"]);
    expect(plan.oldestOid).toBe("c");
    expect(plan.newestOid).toBe("c");
  });

  it("contiguity is computed over the true log, not selection order", () => {
    // Selecting c then b (reverse-clicked) is still contiguous ancestry.
    expect(planCommitSelection(log, ["c", "b"])!.contiguous).toBe(true);
    expect(planCommitSelection(log, ["b", "c"])!.contiguous).toBe(true);
  });
});
