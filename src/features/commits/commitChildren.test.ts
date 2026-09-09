import { describe, expect, it } from "vitest";

import { commitChildren } from "./commitChildren";
import type { CommitInfo } from "@/lib/types";

const mk = (oid: string, parents: string[]): CommitInfo => ({
  oid,
  shortOid: oid.slice(0, 7),
  summary: `commit ${oid}`,
  body: null,
  author: "Dev",
  email: "dev@example.com",
  timestamp: 0,
  parents,
  refs: [],
});

describe("commitChildren", () => {
  it("finds the one commit whose parent it is", () => {
    const log = [mk("c", ["b"]), mk("b", ["a"]), mk("a", [])];
    expect(commitChildren(log, "b").map((c) => c.oid)).toEqual(["c"]);
  });

  it("finds several children at a branch point, newest first", () => {
    // Both `c` and `side` were committed on top of `b`.
    const log = [mk("c", ["b"]), mk("side", ["b"]), mk("b", ["a"]), mk("a", [])];
    expect(commitChildren(log, "b").map((c) => c.oid)).toEqual(["c", "side"]);
  });

  it("counts a merge that lists the commit as its SECOND parent", () => {
    // A merge is a child of both its parents; searching only `parents[0]` would
    // make the side branch look like it had no children at all.
    const log = [mk("m", ["c", "side"]), mk("c", ["b"]), mk("side", ["b"])];
    expect(commitChildren(log, "side").map((c) => c.oid)).toEqual(["m"]);
  });

  it("is empty for the newest loaded commit", () => {
    const log = [mk("c", ["b"]), mk("b", ["a"])];
    expect(commitChildren(log, "c")).toEqual([]);
  });

  it("is empty for an oid the log does not hold", () => {
    expect(commitChildren([mk("c", ["b"])], "zzz")).toEqual([]);
  });

  it("is empty for an empty oid rather than matching a parentless commit", () => {
    expect(commitChildren([mk("a", [])], "")).toEqual([]);
  });
});
