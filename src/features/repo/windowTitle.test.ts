import { describe, it, expect } from "vitest";
import { windowTitleFor } from "./windowTitle";

describe("windowTitleFor", () => {
  it("is just the app name with no repo open", () => {
    expect(windowTitleFor(null, null)).toBe("PlatypusGit");
  });

  it("puts the branch between the repo name and the app name", () => {
    expect(windowTitleFor("myrepo", { branch: "main", headOid: "abc123" })).toBe(
      "myrepo — main — PlatypusGit",
    );
  });

  it("falls back to the short oid on a detached HEAD", () => {
    expect(
      windowTitleFor("myrepo", {
        branch: null,
        headOid: "a1b2c3d4e5f6",
      }),
    ).toBe("myrepo — a1b2c3d — PlatypusGit");
  });

  it("drops the branch segment on an unborn branch (no commits yet)", () => {
    expect(windowTitleFor("myrepo", { branch: null, headOid: null })).toBe(
      "myrepo — PlatypusGit",
    );
  });

  it("drops the branch segment when head info has not loaded yet", () => {
    expect(windowTitleFor("myrepo", null)).toBe("myrepo — PlatypusGit");
  });
});
