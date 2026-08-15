// Pure LFS presentation logic (#93).
//
// `formatBytes` and `lfsSizeSummary` exist because the whole point of the LFS diff
// notice is telling the user how big the thing they cannot see actually is — a
// wrong or unreadable number there is the only content the panel has.

import { describe, it, expect } from "vitest";
import { formatBytes, lfsCounts, lfsDisabledReason } from "./useLfsStore";
import { lfsSizeSummary } from "./LfsDiffNotice";
import type { FileDiff, LfsStatus } from "@/lib/types";

function diff(over: Partial<FileDiff> = {}): FileDiff {
  return {
    path: "art/asset.psd",
    oldPath: null,
    binary: false,
    additions: 0,
    deletions: 0,
    hunks: [],
    ...over,
  };
}

function status(over: Partial<LfsStatus> = {}): LfsStatus {
  return {
    installed: true,
    version: "git-lfs/3.5.1",
    inUse: true,
    patterns: ["*.psd"],
    files: [],
    ...over,
  };
}

describe("formatBytes", () => {
  it("uses byte units up to a kilobyte", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });

  it("keeps one decimal below ten, and none above", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
    expect(formatBytes(512 * 1024 * 1024)).toBe("512 MB");
  });

  it("climbs through the units without running out", () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.0 TB");
    // Beyond terabytes it stays in TB rather than printing an undefined unit.
    expect(formatBytes(5000 * 1024 ** 4)).toBe("5000 TB");
  });

  it("refuses to invent a number for garbage", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("lfsSizeSummary", () => {
  it("shows both sides of a changed pointer", () => {
    expect(
      lfsSizeSummary(
        diff({
          lfs: { old: { oid: "aaa", size: 1024 }, new: { oid: "bbb", size: 2048 } },
        }),
      ),
    ).toBe("1.0 KB → 2.0 KB");
  });

  it("names an add and a delete rather than showing a phantom side", () => {
    expect(
      lfsSizeSummary(diff({ lfs: { old: null, new: { oid: "b", size: 2048 } } })),
    ).toBe("added · 2.0 KB");
    expect(
      lfsSizeSummary(diff({ lfs: { old: { oid: "a", size: 1024 }, new: null } })),
    ).toBe("removed · 1.0 KB");
  });

  it("degrades on a diff with no pointer at all", () => {
    expect(lfsSizeSummary(diff())).toBe("—");
  });
});

describe("lfsCounts", () => {
  it("splits materialized from pointer-only", () => {
    const c = lfsCounts(
      status({
        files: [
          { path: "a.psd", oid: "1", materialized: true },
          { path: "b.psd", oid: "2", materialized: false },
          { path: "c.psd", oid: "3", materialized: false },
        ],
      }),
    );
    expect(c).toEqual({ total: 3, materialized: 1, pointers: 2 });
  });

  it("is all zeroes before the status has loaded", () => {
    expect(lfsCounts(null)).toEqual({ total: 0, materialized: 0, pointers: 0 });
  });
});

describe("lfsDisabledReason", () => {
  it("says why the actions are unavailable, and nothing when they are not", () => {
    expect(lfsDisabledReason(null)).toContain("Checking");
    // A missing binary is a STATE with a reason, never an error banner.
    expect(lfsDisabledReason(status({ installed: false, version: null }))).toBe(
      "git-lfs is not installed",
    );
    expect(lfsDisabledReason(status({ inUse: false, patterns: [] }))).toBe(
      "This repository does not use LFS",
    );
    expect(lfsDisabledReason(status())).toBeNull();
  });

  it("reports the missing binary first — it is the blocking one", () => {
    // Both wrong at once: telling the user "does not use LFS" would send them
    // looking in the wrong place.
    expect(
      lfsDisabledReason(status({ installed: false, version: null, inUse: false })),
    ).toBe("git-lfs is not installed");
  });
});
