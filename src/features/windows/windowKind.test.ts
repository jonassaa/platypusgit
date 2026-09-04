import { beforeEach, describe, expect, it } from "vitest";

import {
  cascadeFrom,
  forgetWindow,
  isRepoWindowLabel,
  loadWindowRecords,
  MAIN_LABEL,
  openReposKey,
  rememberWindow,
  saveWindowRecords,
  WINDOWS_KEY,
  WINDOW_LIMIT,
} from "./windowKind";

beforeEach(() => {
  localStorage.clear();
});

describe("window labels", () => {
  it("recognises the app's own windows and nothing else", () => {
    expect(isRepoWindowLabel("main")).toBe(true);
    expect(isRepoWindowLabel("pg-1")).toBe(true);
    expect(isRepoWindowLabel("pg-12")).toBe(true);
    // The resolver is a window, but not a repository window.
    expect(isRepoWindowLabel("merge")).toBe(false);
    expect(isRepoWindowLabel("pg-")).toBe(false);
    expect(isRepoWindowLabel("pg-x")).toBe(false);
    expect(isRepoWindowLabel("pg-1x")).toBe(false);
  });
});

describe("per-window storage keys", () => {
  it("leaves main on the key it has written since #90", () => {
    // The upgrade case: namespacing every window would have emptied every
    // existing user's tab strip exactly once, on the build that shipped this.
    expect(openReposKey(MAIN_LABEL)).toBe("pg-open-repos");
  });

  it("namespaces every sibling", () => {
    expect(openReposKey("pg-1")).toBe("pg-open-repos:pg-1");
    expect(openReposKey("pg-2")).toBe("pg-open-repos:pg-2");
  });
});

describe("the restore record", () => {
  it("round-trips", () => {
    saveWindowRecords([{ label: "pg-1", bounds: { x: 10, y: 20, width: 900, height: 700 } }]);
    expect(loadWindowRecords()).toEqual([
      { label: "pg-1", bounds: { x: 10, y: 20, width: 900, height: 700 } },
    ]);
  });

  it("reads junk as nothing to restore rather than throwing", () => {
    // Same contract as loadOpenRepos: the alternative is an app that will not
    // start until someone clears localStorage by hand.
    localStorage.setItem(WINDOWS_KEY, "not json");
    expect(loadWindowRecords()).toEqual([]);
    localStorage.setItem(WINDOWS_KEY, JSON.stringify({ label: "pg-1" }));
    expect(loadWindowRecords()).toEqual([]);
    localStorage.setItem(WINDOWS_KEY, JSON.stringify([1, "pg-2", null]));
    expect(loadWindowRecords()).toEqual([]);
  });

  it("never restores main — it is what does the restoring", () => {
    localStorage.setItem(
      WINDOWS_KEY,
      JSON.stringify([{ label: "main", bounds: null }, { label: "pg-1", bounds: null }]),
    );
    expect(loadWindowRecords().map((r) => r.label)).toEqual(["pg-1"]);
  });

  it("drops duplicates and anything that is not a window label", () => {
    localStorage.setItem(
      WINDOWS_KEY,
      JSON.stringify([
        { label: "pg-1", bounds: null },
        { label: "pg-1", bounds: null },
        { label: "merge", bounds: null },
        { label: "whatever", bounds: null },
      ]),
    );
    expect(loadWindowRecords().map((r) => r.label)).toEqual(["pg-1"]);
  });

  it("caps how many windows a corrupted record can open at launch", () => {
    saveWindowRecords(
      Array.from({ length: 40 }, (_, i) => ({ label: `pg-${i + 1}`, bounds: null })),
    );
    expect(loadWindowRecords()).toHaveLength(WINDOW_LIMIT);
  });

  it("treats incomplete or zero-area bounds as no remembered place", () => {
    localStorage.setItem(
      WINDOWS_KEY,
      JSON.stringify([
        { label: "pg-1", bounds: { x: 1, y: 2 } },
        { label: "pg-2", bounds: { x: 1, y: 2, width: 0, height: 700 } },
        { label: "pg-3", bounds: { x: 1, y: 2, width: Number.NaN, height: 700 } },
      ]),
    );
    // The RECORD survives — only the geometry is dropped, so the window still
    // comes back, just wherever the OS puts it.
    expect(loadWindowRecords()).toEqual([
      { label: "pg-1", bounds: null },
      { label: "pg-2", bounds: null },
      { label: "pg-3", bounds: null },
    ]);
  });
});

describe("remembering and forgetting a window", () => {
  it("adds a window once and updates its bounds in place", () => {
    rememberWindow("pg-1", { x: 0, y: 0, width: 900, height: 700 });
    rememberWindow("pg-1", { x: 40, y: 50, width: 900, height: 700 });
    expect(loadWindowRecords()).toEqual([
      { label: "pg-1", bounds: { x: 40, y: 50, width: 900, height: 700 } },
    ]);
  });

  it("a null on an update means 'no new measurement', not 'forget where it was'", () => {
    rememberWindow("pg-1", { x: 40, y: 50, width: 900, height: 700 });
    rememberWindow("pg-1", null);
    expect(loadWindowRecords()[0].bounds).toEqual({ x: 40, y: 50, width: 900, height: 700 });
  });

  it("refuses to record main or the resolver", () => {
    rememberWindow(MAIN_LABEL, null);
    rememberWindow("merge", null);
    expect(loadWindowRecords()).toEqual([]);
  });

  it("forgetting drops the record AND the window's open repositories", () => {
    rememberWindow("pg-1", null);
    localStorage.setItem(openReposKey("pg-1"), JSON.stringify({ paths: ["/a"], active: "/a" }));
    forgetWindow("pg-1");
    expect(loadWindowRecords()).toEqual([]);
    expect(localStorage.getItem(openReposKey("pg-1"))).toBeNull();
  });

  it("forgetting main can never delete the primary session", () => {
    localStorage.setItem(openReposKey(MAIN_LABEL), JSON.stringify({ paths: ["/a"], active: "/a" }));
    forgetWindow(MAIN_LABEL);
    expect(localStorage.getItem(openReposKey(MAIN_LABEL))).not.toBeNull();
  });
});

describe("cascade", () => {
  it("offsets down and right, so a new window is visibly a second one", () => {
    expect(cascadeFrom({ x: 100, y: 100, width: 900, height: 700 }, 32)).toEqual({
      x: 132,
      y: 132,
      width: 900,
      height: 700,
    });
  });

  it("cannot walk a window off the top-left", () => {
    expect(cascadeFrom({ x: -80, y: -80, width: 900, height: 700 }, 32)).toEqual({
      x: 0,
      y: 0,
      width: 900,
      height: 700,
    });
  });

  it("no anchor means let the OS place it", () => {
    expect(cascadeFrom(null)).toBeNull();
  });
});
