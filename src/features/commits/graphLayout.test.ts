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

  it("merge: feature branch rejoins main", () => {
    // newest first:
    //   M (merge of main + feature)
    //   F (feature commit, child of R)
    //   T (main commit between branch-point and merge, child of R)
    //   R (branch point, parent of both T and F)
    //   I (initial, parent of R)
    const rows = layoutGraph([
      c("M", ["T", "F"]),
      c("F", ["R"]),
      c("T", ["R"]),
      c("R", ["I"]),
      c("I", []),
    ]);

    // M is a merge on col 0
    expect(rows[0]!.node).toMatchObject({ col: 0, merge: true, solid: false });
    // M forks a lane out to col 1 for the second parent F
    const mForks = rows[0]!.lanes.filter((l) => l.kind === "fork-bot");
    expect(mForks).toHaveLength(1);
    expect(mForks[0]!.col).toBe(0);
    expect(mForks[0]!.to).toBe(1);

    // F is the next commit, sits on col 1 (the forked lane)
    expect(rows[1]!.node.col).toBe(1);
    // T is on col 0 (main lane continues)
    expect(rows[2]!.node.col).toBe(0);

    // R is the branch point: col 1 collapses into col 0
    expect(rows[3]!.node.col).toBe(0);
    const rMergeTops = rows[3]!.lanes.filter((l) => l.kind === "merge-top");
    expect(rMergeTops).toHaveLength(1);
    expect(rMergeTops[0]!.col).toBe(1);
    expect(rMergeTops[0]!.to).toBe(0);

    // After R, only col 0 is alive
    expect(rows[4]!.node.col).toBe(0);
    expect(rows[4]!.lanes.every((l) => l.col === 0)).toBe(true);
  });

  it("octopus merge: three parents each open their own lane", () => {
    //   O (octopus: parents P1, P2, P3)
    //   P3
    //   P2
    //   P1
    //   G (grandparent, common ancestor — parent of P1/P2/P3)
    const rows = layoutGraph([
      c("O", ["P1", "P2", "P3"]),
      c("P3", ["G"]),
      c("P2", ["G"]),
      c("P1", ["G"]),
      c("G", []),
    ]);

    // O forks out two lanes (for P2 and P3) — P1 continues on node col
    const oForks = rows[0]!.lanes.filter((l) => l.kind === "fork-bot");
    expect(oForks).toHaveLength(2);
    expect(rows[0]!.node.merge).toBe(true);

    // Three lanes alive in the rows between O and G
    const cols = new Set(rows[1]!.lanes.map((l) => l.col));
    expect(cols.size).toBeGreaterThanOrEqual(3);

    // G is the common ancestor — two lanes collapse into it
    const gMergeTops = rows[4]!.lanes.filter((l) => l.kind === "merge-top");
    expect(gMergeTops).toHaveLength(2);
  });

  it("slot reuse: freed column is reused by a later branch tip", () => {
    // Two totally independent histories visible in the same window:
    //   B2 → B1 (branch B, initial)
    //   A2 → A1 (branch A, initial)
    const rows = layoutGraph([
      c("B2", ["B1"]),
      c("B1", []),
      c("A2", ["A1"]),
      c("A1", []),
    ]);

    // B1 is initial → frees col 0
    expect(rows[1]!.node.col).toBe(0);
    expect(rows[1]!.node.solid).toBe(true);

    // A2 is a new branch tip — reuses col 0 (the freed slot)
    expect(rows[2]!.node.col).toBe(0);

    // A1 is initial on col 0
    expect(rows[3]!.node.col).toBe(0);
    expect(rows[3]!.node.solid).toBe(true);
  });

  it("branch point: multiple children of same commit collapse into one lane", () => {
    //   M (merge of C and D)
    //   D (child of P)
    //   C (child of P)
    //   P (child of R) — parent of both C and D, NOT itself a merge
    //   R ()
    const rows = layoutGraph([
      c("M", ["C", "D"]),
      c("D", ["P"]),
      c("C", ["P"]),
      c("P", ["R"]),
      c("R", []),
    ]);

    // By the time we reach P (row index 3), two lanes await P — collapse
    expect(rows[3]!.node.merge).toBe(false); // P itself has a single parent
    expect(rows[3]!.node.solid).toBe(true);
    const pMergeTops = rows[3]!.lanes.filter((l) => l.kind === "merge-top");
    expect(pMergeTops).toHaveLength(1);
    // The collapsing lane points to P's node column
    expect(pMergeTops[0]!.to).toBe(rows[3]!.node.col);
  });
});
