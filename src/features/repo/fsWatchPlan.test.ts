// What a filesystem event is allowed to refresh (#239).
//
// Four ways this can be wrong, and each of them is a real bug rather than a
// tidiness concern: refreshing for the wrong repository writes another tab's
// status over the open one; refreshing mid-operation reads a half-applied
// state; repainting history on a file save makes the feature cost more than it
// saves; and honouring an event after the setting is off breaks a promise.

import { describe, expect, it } from "vitest";

import type { FsChange } from "@/lib/types";
import { fsRefreshPlan, mergeRefresh } from "./fsWatchPlan";

const change = (over?: Partial<FsChange>): FsChange => ({
  repoId: "repo-1",
  refsMoved: false,
  ...over,
});

const plan = (over?: Partial<Parameters<typeof fsRefreshPlan>[0]>) =>
  fsRefreshPlan({
    change: change(),
    currentRepoId: "repo-1",
    busy: false,
    enabled: true,
    ...over,
  });

describe("how much to refresh", () => {
  it("a file save re-reads status only", () => {
    // The common case by far, and the one whose cost decides whether the
    // whole feature is worth having.
    expect(plan()).toBe("status");
  });

  it("a ref move re-reads everything", () => {
    // A commit or a branch switch in a terminal: the graph and the HEAD marks
    // are now wrong, and only a full refresh fixes them.
    expect(plan({ change: change({ refsMoved: true }) })).toBe("all");
  });
});

describe("when to do nothing at all", () => {
  it("drops an event for a different repository", () => {
    // `useRepoStore` holds exactly ONE repository's state — the active tab's.
    // Applying another tab's event would write its status over the open one.
    expect(plan({ change: change({ repoId: "repo-2" }) })).toBe("none");
  });

  it("drops an event that arrives after the tab is closed", () => {
    expect(plan({ currentRepoId: null })).toBe("none");
  });

  it("drops an event while an operation is in flight", () => {
    // A rebase or a merge writes to .git/ in a storm, and a refresh landing
    // mid-transition can read a half-applied state. Skipping loses nothing:
    // every operation refreshes on completion anyway, so only the flicker of
    // intermediate states is dropped, never the final one.
    expect(plan({ busy: true })).toBe("none");
    expect(plan({ busy: true, change: change({ refsMoved: true }) })).toBe("none");
  });

  it("drops an event still in flight when the setting was switched off", () => {
    // The backend watch is stopped too, but an event already on its way must
    // not sneak a refresh through — otherwise "off" is off with exceptions.
    expect(plan({ enabled: false })).toBe("none");
    expect(plan({ enabled: false, change: change({ refsMoved: true }) })).toBe(
      "none",
    );
  });

  it("checks the repository even when the setting is on and nothing is busy", () => {
    // Guards against a future reordering that returns early on `enabled`
    // alone.
    expect(
      plan({ change: change({ repoId: "other", refsMoved: true }) }),
    ).toBe("none");
  });
});

describe("mergeRefresh", () => {
  it("never downgrades a pending log refresh", () => {
    // Events arrive faster than a refresh completes on a big repository. A
    // `status` queued behind an `all` must not turn it into a status-only one,
    // or a branch switch during a busy save loop leaves the graph stale.
    expect(mergeRefresh("all", "status")).toBe("all");
    expect(mergeRefresh("status", "all")).toBe("all");
  });

  it("keeps the stronger of two", () => {
    expect(mergeRefresh("none", "status")).toBe("status");
    expect(mergeRefresh("status", "none")).toBe("status");
    expect(mergeRefresh("none", "none")).toBe("none");
    expect(mergeRefresh("all", "all")).toBe("all");
  });
});
