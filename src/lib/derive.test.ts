import { describe, it, expect } from "vitest";
import { windowTitle } from "./derive";
import type { BranchInfo } from "./types";

function branch(over: Partial<BranchInfo> = {}): BranchInfo {
  return {
    name: "main",
    isHead: true,
    isRemote: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    tip: "deadbeefcafe",
    tipTime: 0,
    isDefault: true,
    ...over,
  };
}

describe("windowTitle", () => {
  it("is just the app name with no repo open", () => {
    expect(windowTitle(null, [], null)).toBe("PlatypusGit");
  });

  it("names the repo and its checked-out branch, name last", () => {
    expect(
      windowTitle("/Users/dev/myrepo", [branch({ name: "main" })], "main"),
    ).toBe("myrepo — main — PlatypusGit");
  });

  it("falls back to the short OID when detached (no branch has isHead)", () => {
    expect(
      windowTitle(
        "/Users/dev/myrepo",
        [branch({ isHead: false })],
        "abc1234567890",
      ),
    ).toBe("myrepo — abc1234 — PlatypusGit");
  });

  it("omits the branch segment for an unborn branch (no commits, no OID)", () => {
    expect(windowTitle("/Users/dev/myrepo", [], null)).toBe(
      "myrepo — PlatypusGit",
    );
  });

  it("strips a trailing slash from the workdir when naming the repo", () => {
    expect(windowTitle("/Users/dev/myrepo/", [branch()], "main")).toBe(
      "myrepo — main — PlatypusGit",
    );
  });
});
