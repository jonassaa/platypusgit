import { describe, expect, it } from "vitest";

import {
  WORKDIR,
  canSwap,
  commitListHeading,
  compareHeader,
  defaultLeftSide,
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
