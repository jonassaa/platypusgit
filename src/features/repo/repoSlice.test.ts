// The anti-leak contract (#90). `useTabsStore` hydrates a tab by writing the
// WHOLE slice; if a per-repo field is missing from REPO_SLICE_KEYS, hydration
// silently becomes a patch and the previous repository's data survives into the
// next tab. This file is what makes that a failing test instead of a bug report.

import { describe, expect, it } from "vitest";

import { LOG_REF_ALL } from "@/lib/types";
import { REPO_SLICE_KEYS, emptySlice, frozenSlice, sliceOf } from "./repoSlice";
import { useRepoStore } from "./useRepoStore";

describe("repoSlice", () => {
  it("covers every non-function field of the live store", () => {
    const live = Object.entries(useRepoStore.getState())
      .filter(([, v]) => typeof v !== "function")
      .map(([k]) => k)
      .sort();
    expect(
      [...REPO_SLICE_KEYS].sort(),
      "a per-repo field exists on useRepoStore but is not in REPO_SLICE_KEYS — " +
        "hydrating a tab would leave the previous repository's value in place. " +
        "Add it to RepoSlice/emptySlice in repoSlice.ts.",
    ).toEqual(live);
  });

  it("emptySlice is the no-repo state", () => {
    const s = emptySlice();
    expect(s.current).toBeNull();
    expect(s.status).toEqual([]);
    expect(s.commits).toEqual([]);
    expect(s.searchResults).toBeNull();
    expect(s.error).toBeNull();
    expect(s.repoState).toBe("Clean");
    expect(s.logRef).toBe(LOG_REF_ALL);
    expect(s.rebaseStatus.inProgress).toBe(false);
    expect(s.activity).toEqual({});
  });

  it("never shares mutable values between slices", () => {
    // Two tabs holding the SAME array would make staging in one repository
    // mutate another's cached view.
    const a = emptySlice();
    const b = emptySlice();
    expect(a.status).not.toBe(b.status);
    expect(a.activity).not.toBe(b.activity);
    expect(a.commitFilter).not.toBe(b.commitFilter);
  });

  it("frozenSlice clears the in-flight flags but nothing else", () => {
    // A parked `loadingMore: true` would make "load more" a permanent no-op on
    // that tab: nothing will ever clear it, because the request it belonged to
    // resolves into the OTHER repository's slice (and setFor drops it).
    const busy = {
      ...emptySlice(),
      loading: true,
      loadingMore: true,
      searching: true,
      logRef: "origin/main",
      error: { kind: "Internal", message: "kept" } as const,
    };
    expect(frozenSlice(busy)).toEqual({
      ...busy,
      loading: false,
      loadingMore: false,
      searching: false,
    });
  });

  it("sliceOf picks exactly the slice keys, ignoring actions", () => {
    const picked = sliceOf(useRepoStore.getState());
    expect(Object.keys(picked).sort()).toEqual([...REPO_SLICE_KEYS].sort());
    for (const v of Object.values(picked)) {
      expect(typeof v).not.toBe("function");
    }
  });

  it("round-trips a seeded slice through the store", () => {
    const seeded = {
      ...emptySlice(),
      current: { id: "r1", path: "/tmp/a", head: "main" },
      status: [],
      logRef: "origin/main",
    };
    useRepoStore.getState().hydrate(seeded);
    expect(sliceOf(useRepoStore.getState())).toEqual(seeded);
    // And hydrating an empty slice must remove every trace of it.
    useRepoStore.getState().hydrate(emptySlice());
    expect(useRepoStore.getState().current).toBeNull();
    expect(useRepoStore.getState().logRef).toBe(LOG_REF_ALL);
  });
});
