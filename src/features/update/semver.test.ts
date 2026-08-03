import { describe, expect, it } from "vitest";

import { compareSemver, isNewerThan, parseSemver } from "./semver";

describe("compareSemver", () => {
  it("orders the numeric core left to right", () => {
    expect(compareSemver("0.0.6", "0.0.5")).toBe(1);
    expect(compareSemver("0.1.0", "0.0.9")).toBe(1);
    expect(compareSemver("1.0.0", "0.9.9")).toBe(1);
    expect(compareSemver("0.0.5", "0.0.6")).toBe(-1);
    expect(compareSemver("0.0.6", "0.0.6")).toBe(0);
  });

  it("tolerates a single leading v on either side", () => {
    expect(compareSemver("v0.0.6", "v0.0.5")).toBe(1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
    // ...but only one — matching parse_release's strip_prefix.
    expect(compareSemver("vvv1.0.0", "1.0.0")).toBeNull();
  });

  it("sorts a prerelease below its release", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-rc.1", "1.0.0-rc.1")).toBe(0);
  });

  it("compares prerelease identifiers per spec §11", () => {
    // Numeric identifiers compare numerically, not lexically.
    expect(compareSemver("1.0.0-rc.10", "1.0.0-rc.9")).toBe(1);
    // Numeric ranks below alphanumeric.
    expect(compareSemver("1.0.0-1", "1.0.0-alpha")).toBe(-1);
    // Alphanumeric compares by ASCII.
    expect(compareSemver("1.0.0-beta", "1.0.0-alpha")).toBe(1);
    // A larger set of identifiers wins when all preceding ones are equal.
    expect(compareSemver("1.0.0-alpha.1", "1.0.0-alpha")).toBe(1);
    // The spec's own worked example, in order.
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(compareSemver(ordered[i]!, ordered[i - 1]!)).toBe(1);
    }
  });

  it("ignores build metadata", () => {
    expect(compareSemver("0.2.0+build.5", "0.2.0")).toBe(0);
    expect(compareSemver("0.2.0", "0.2.0+build.5")).toBe(0);
    expect(compareSemver("0.2.1", "0.2.0+build.5")).toBe(1);
  });

  it("returns null for anything that is not semver", () => {
    expect(compareSemver("nightly", "0.1.0")).toBeNull();
    expect(compareSemver("0.1.0", "1.0.0.1")).toBeNull(); // 4 components
    expect(compareSemver("0.1.0", "")).toBeNull();
    expect(compareSemver("0.1.0", "v")).toBeNull();
    expect(compareSemver("0.1.0", "01.0.0")).toBeNull(); // leading zero
  });
});

describe("isNewerThan", () => {
  it("is true only for a strictly newer parseable version", () => {
    expect(isNewerThan("0.2.0", "0.1.0")).toBe(true);
    expect(isNewerThan("0.1.0", "0.2.0")).toBe(false);
    expect(isNewerThan("0.2.0", "0.2.0")).toBe(false);
    expect(isNewerThan("garbage", "0.2.0")).toBe(false);
  });
});

describe("parseSemver", () => {
  it("splits the prerelease and drops build metadata", () => {
    expect(parseSemver("1.2.3-rc.1+abc")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: ["rc", "1"],
    });
    expect(parseSemver("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      pre: [],
    });
  });
});
