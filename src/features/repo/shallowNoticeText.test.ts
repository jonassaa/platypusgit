import { describe, expect, it } from "vitest";

import { shallowNoticeText, type ShallowSurface } from "./shallowNoticeText";
import { DEFAULT_SHALLOW_INFO } from "./repoSlice";

const SURFACES: ShallowSurface[] = ["history", "fileHistory", "blame", "compare"];

describe("shallowNoticeText", () => {
  it("says nothing about a repository with nothing missing", () => {
    for (const surface of SURFACES) {
      expect(shallowNoticeText(DEFAULT_SHALLOW_INFO, surface)).toBeNull();
    }
  });

  it("names the boundary count, singular and plural", () => {
    const one = shallowNoticeText(
      { ...DEFAULT_SHALLOW_INFO, shallow: true, boundaryCount: 1 },
      "history",
    );
    expect(one?.headline).toContain("stops at 1 commit.");

    const many = shallowNoticeText(
      { ...DEFAULT_SHALLOW_INFO, shallow: true, boundaryCount: 4 },
      "history",
    );
    expect(many?.headline).toContain("stops at 4 commits.");
  });

  it("omits the count rather than claiming zero when it could not be read", () => {
    // `boundaryCount: 0` with `shallow: true` means the file was unreadable —
    // the boolean is the load-bearing half, and "History stops at 0 commits"
    // would be a sentence that is simply false.
    const notice = shallowNoticeText(
      { ...DEFAULT_SHALLOW_INFO, shallow: true, boundaryCount: 0 },
      "history",
    );
    expect(notice).not.toBeNull();
    expect(notice?.headline).not.toContain("stops at");
    expect(notice?.headline).toContain("Shallow clone");
  });

  it("gives each surface its own consequence, not one generic sentence", () => {
    const details = SURFACES.map(
      (s) =>
        shallowNoticeText({ ...DEFAULT_SHALLOW_INFO, shallow: true }, s)!.detail,
    );
    expect(new Set(details).size).toBe(SURFACES.length);
    // The one that matters most: a reader of a blame needs to know what is
    // wrong with the blame, not with the repository in the abstract.
    expect(
      shallowNoticeText({ ...DEFAULT_SHALLOW_INFO, shallow: true }, "blame")!
        .detail,
    ).toContain("attributed to the oldest commit present");
  });

  it("offers unshallow for a shallow clone", () => {
    expect(
      shallowNoticeText({ ...DEFAULT_SHALLOW_INFO, shallow: true }, "history")
        ?.canUnshallow,
    ).toBe(true);
  });

  it("reports a single-branch clone without offering unshallow", () => {
    // `git fetch --unshallow` fetches history, not branches. A button that runs
    // and changes nothing the reader complained about is worse than no button.
    const notice = shallowNoticeText(
      { ...DEFAULT_SHALLOW_INFO, singleBranch: true },
      "compare",
    );
    expect(notice?.headline).toContain("Single-branch clone");
    expect(notice?.canUnshallow).toBe(false);
    expect(notice?.detail).toContain("never fetched");
  });

  it("leads with shallow when a clone is both, and keeps the remedy", () => {
    // Two stacked strips is how a warning stops being read. Shallow is the
    // bigger distortion and the one with a button, so it wins.
    const notice = shallowNoticeText(
      { shallow: true, boundaryCount: 1, singleBranch: true },
      "history",
    );
    expect(notice?.headline).toContain("Shallow clone");
    expect(notice?.headline).not.toContain("Single-branch");
    expect(notice?.canUnshallow).toBe(true);
  });
});
