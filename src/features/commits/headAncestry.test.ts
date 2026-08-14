// History walks every branch by default, so the loaded log is NOT HEAD's
// ancestry — and rebase plans are defined over ancestry alone. Feeding a
// foreign commit to buildRebasePlan replays it onto the current branch (a
// squash of 2 produced 3 commits; caught by rebase.e2e.ts).
import { describe, expect, it } from "vitest";

import { headAncestryLog, headAncestryOf } from "./headAncestry";
import { buildRebasePlan } from "./buildRebasePlan";
import type { BranchInfo, CommitInfo } from "@/lib/types";

const oid = (label: string) => label.repeat(40).slice(0, 40);

const mk = (label: string, parents: string[] = []): CommitInfo => ({
  oid: oid(label),
  shortOid: oid(label).slice(0, 7),
  summary: `commit ${label}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 1_700_000_000,
  parents: parents.map(oid),
  refs: [],
});

// main:    A → B → C(root)      feature: F → B
// The all-branches log interleaves F between main's commits, exactly as the
// real one does (it sorts by time).
const A = mk("a", ["b"]);
const F = mk("f", ["b"]);
const B = mk("b", ["c"]);
const C = mk("c");
const LOG = [A, F, B, C];

const branches = (tip: string): BranchInfo[] => [
  {
    name: "main",
    isHead: true,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip,
  } as BranchInfo,
];

describe("headAncestryLog", () => {
  it("drops commits HEAD cannot reach, keeping log order", () => {
    expect(headAncestryLog(LOG, A.oid).map((c) => c.summary)).toEqual([
      "commit a",
      "commit b",
      "commit c",
    ]);
  });

  it("keeps both sides of a merge", () => {
    const merge = mk("m", ["a", "f"]);
    const log = [merge, A, F, B, C];
    expect(headAncestryLog(log, merge.oid).map((c) => c.summary)).toEqual([
      "commit m",
      "commit a",
      "commit f",
      "commit b",
      "commit c",
    ]);
  });

  it("returns the log untouched when the tip is unknown or missing", () => {
    expect(headAncestryLog(LOG, null)).toBe(LOG);
    expect(headAncestryLog(LOG, oid("z"))).toBe(LOG);
  });

  it("stops at the edge of the loaded window", () => {
    // B's parent C is not loaded here.
    const log = [A, B];
    expect(headAncestryLog(log, A.oid).map((c) => c.summary)).toEqual([
      "commit a",
      "commit b",
    ]);
  });

  it("resolves the tip from the current branch", () => {
    expect(headAncestryOf(LOG, branches(A.oid)).map((c) => c.summary)).toEqual([
      "commit a",
      "commit b",
      "commit c",
    ]);
  });
});

describe("a rebase plan built from the ancestry", () => {
  it("excludes the foreign branch commit that the raw log would sweep in", () => {
    // Squash A into B: base is B's parent, C.
    const fromRawLog = buildRebasePlan(LOG, C.oid, {
      kind: "squash-range",
      oids: [B.oid, A.oid],
      message: "combined",
    })!;
    // The bug: F rides along as a pick, so replaying adds a commit.
    expect(fromRawLog.map((s) => s.oid)).toContain(F.oid);

    const fromAncestry = buildRebasePlan(headAncestryLog(LOG, A.oid), C.oid, {
      kind: "squash-range",
      oids: [B.oid, A.oid],
      message: "combined",
    })!;
    expect(fromAncestry.map((s) => s.oid)).not.toContain(F.oid);
    expect(fromAncestry).toEqual([
      { oid: B.oid, action: "Pick", message: null },
      { oid: A.oid, action: "Squash", message: "combined" },
    ]);
  });
});
