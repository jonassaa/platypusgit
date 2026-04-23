import { describe, expect, it } from "vitest";
import type { CommitInfo } from "@/lib/types";
import { layoutGraph } from "./graphLayout";

/**
 * Build a fake CommitInfo with only the fields layoutGraph uses.
 * `oid` and `parents` are the only semantically-meaningful fields here.
 */
function c(oid: string, parents: string[] = []): CommitInfo {
  return {
    oid,
    shortOid: oid.slice(0, 7),
    summary: oid,
    body: null,
    author: "t",
    email: "t@t",
    timestamp: 0,
    parents,
    refs: [],
  };
}

describe("layoutGraph", () => {
  it("linear history: single lane, straight line", () => {
    // A → B → C (newest first, as git log returns)
    const rows = layoutGraph([c("A", ["B"]), c("B", ["C"]), c("C", [])]);

    expect(rows).toHaveLength(3);

    // All three commits sit on col 0
    expect(rows[0]!.node.col).toBe(0);
    expect(rows[1]!.node.col).toBe(0);
    expect(rows[2]!.node.col).toBe(0);

    // Initial commit (C, no parents) is solid and not merge
    expect(rows[2]!.node.solid).toBe(true);
    expect(rows[2]!.node.merge).toBe(false);

    // First row: lane opens here (half-bot continuation only)
    expect(rows[0]!.lanes.map((l) => l.kind)).toEqual(["half-bot"]);

    // Middle row: full line through the node (half-top + half-bot on same col)
    expect(rows[1]!.lanes.map((l) => l.kind).sort()).toEqual([
      "half-bot",
      "half-top",
    ]);

    // Last row: lane terminates (half-top only; initial commit frees slot)
    expect(rows[2]!.lanes.map((l) => l.kind)).toEqual(["half-top"]);
  });
});
