import { describe, expect, it } from "vitest";

import {
  WORKDIR,
  canSwap,
  commitListHeading,
  compareHeader,
  defaultLeftSide,
  diffBasisHelp,
  diffBasisNote,
  hasCommitLists,
  sideKey,
  sideLabel,
  swapSides,
  type CompareSide,
} from "./compareSides";
import type { BranchInfo } from "@/lib/types";

const rev = (r: string): CompareSide => ({ kind: "rev", rev: r });

const branch = (name: string, isHead = false): BranchInfo => ({
  name,
  isHead,
  isRemote: name.includes("/") && name.startsWith("origin"),
  upstream: null,
  ahead: 0,
  behind: 0,
  tip: "a".repeat(40),
  tipTime: 0,
  isDefault: false,
});

describe("sideLabel / sideKey", () => {
  it("names a rev by its spec, not a resolved oid", () => {
    expect(sideLabel(rev("origin/main"))).toBe("origin/main");
    expect(sideKey(rev("origin/main"))).toBe("rev:origin/main");
  });

  it("names the working tree", () => {
    expect(sideLabel(WORKDIR)).toBe("Working tree");
    expect(sideKey(WORKDIR)).toBe("workdir");
  });

  it("gives two different revs two different keys", () => {
    expect(sideKey(rev("main"))).not.toBe(sideKey(rev("feature")));
  });

  it("abbreviates a bare full oid, which nothing else makes readable", () => {
    const oid = "a".repeat(40);
    expect(sideLabel(rev(oid))).toBe("aaaaaaa");
    // …but the KEY keeps the whole thing: two oids sharing a prefix are two
    // different sides, and the key is what the fetch is fenced on.
    expect(sideKey(rev(oid))).toBe(`rev:${oid}`);
  });

  it("leaves anything that is not a full oid exactly as typed", () => {
    expect(sideLabel(rev("HEAD~2"))).toBe("HEAD~2");
    expect(sideLabel(rev("abc1234"))).toBe("abc1234");
    // 40 chars, but not hex — a branch name, not an oid.
    expect(sideLabel(rev("z".repeat(40)))).toBe("z".repeat(40));
  });
});

describe("compareHeader", () => {
  it("reads left → right", () => {
    expect(compareHeader(rev("main"), rev("feature/x"))).toBe("main → feature/x");
  });

  it("names the working tree on the right", () => {
    expect(compareHeader(rev("main"), WORKDIR)).toBe("main → Working tree");
  });
});

describe("hasCommitLists", () => {
  it("is true only for a rev↔rev pair", () => {
    expect(hasCommitLists(rev("main"), rev("feature"))).toBe(true);
    expect(hasCommitLists(rev("main"), WORKDIR)).toBe(false);
  });
});

describe("swapSides", () => {
  it("flips a rev↔rev pair", () => {
    expect(canSwap(rev("main"), rev("feature"))).toBe(true);
    expect(swapSides(rev("main"), rev("feature"))).toEqual({
      left: rev("feature"),
      right: rev("main"),
    });
  });

  it("refuses to move the working tree to the left", () => {
    expect(canSwap(rev("main"), WORKDIR)).toBe(false);
    expect(swapSides(rev("main"), WORKDIR)).toEqual({
      left: rev("main"),
      right: WORKDIR,
    });
  });
});

describe("defaultLeftSide", () => {
  it("uses the checked-out branch", () => {
    expect(defaultLeftSide([branch("main"), branch("feature", true)])).toEqual(
      rev("feature"),
    );
  });

  it("falls back to HEAD when nothing is checked out (detached / unborn)", () => {
    expect(defaultLeftSide([branch("main")])).toEqual(rev("HEAD"));
    expect(defaultLeftSide([])).toEqual(rev("HEAD"));
  });
});

describe("diffBasisNote", () => {
  it("warns only when the base side has exclusive work to show as deletions", () => {
    expect(diffBasisNote(rev("main"), 0)).toBeNull();
    expect(diffBasisNote(rev("main"), 2)).toBe(
      "includes main-only files as deletions",
    );
  });

  it("names both trees in the long form", () => {
    const help = diffBasisHelp(rev("main"), rev("feature"));
    expect(help).toContain("main");
    expect(help).toContain("feature");
    expect(help).toContain("two-dot");
  });
});

describe("commitListHeading", () => {
  it("agrees with its own count", () => {
    expect(commitListHeading(1, rev("feature"), rev("main"))).toBe(
      "1 commit on feature not on main",
    );
    expect(commitListHeading(3, rev("feature"), rev("main"))).toBe(
      "3 commits on feature not on main",
    );
    expect(commitListHeading(0, rev("feature"), rev("main"))).toBe(
      "0 commits on feature not on main",
    );
  });
});
