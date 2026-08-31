// Per-repository branch pins (#238), stored the way the folds are: one
// localStorage key holding every repository's set, best-effort, never fatal.

import { beforeEach, describe, expect, it } from "vitest";

import {
  BRANCH_PINS_KEY,
  pinnedIn,
  useBranchPins,
} from "./useBranchPins";

const raw = () =>
  JSON.parse(localStorage.getItem(BRANCH_PINS_KEY) ?? "null") as Record<
    string,
    string[]
  > | null;

/** Re-read localStorage into the store, as a fresh app start would. */
const reload = () => useBranchPins.getState().reload();

beforeEach(() => {
  localStorage.clear();
  useBranchPins.setState({ byRepo: {} });
});

describe("useBranchPins", () => {
  it("pins a branch and reads it back for that repository", () => {
    useBranchPins.getState().toggle("/a", "feat/foo");
    expect(pinnedIn("/a")).toEqual(["feat/foo"]);
    expect(raw()).toEqual({ "/a": ["feat/foo"] });
  });

  it("unpins on a second toggle", () => {
    useBranchPins.getState().toggle("/a", "feat/foo");
    useBranchPins.getState().toggle("/a", "feat/foo");
    expect(pinnedIn("/a")).toEqual([]);
    // The entry is pruned rather than left as an empty array, so a repository
    // with no pins leaves nothing behind.
    expect(raw()).toBeNull();
  });

  it("keeps repositories apart", () => {
    useBranchPins.getState().toggle("/a", "main");
    useBranchPins.getState().toggle("/b", "trunk");
    expect(pinnedIn("/a")).toEqual(["main"]);
    expect(pinnedIn("/b")).toEqual(["trunk"]);
  });

  it("leaves other repositories intact when one empties", () => {
    useBranchPins.getState().toggle("/a", "main");
    useBranchPins.getState().toggle("/b", "trunk");
    useBranchPins.getState().toggle("/b", "trunk");
    expect(raw()).toEqual({ "/a": ["main"] });
  });

  it("survives a restart", () => {
    useBranchPins.getState().toggle("/a", "feat/foo");
    useBranchPins.setState({ byRepo: {} });
    reload();
    expect(pinnedIn("/a")).toEqual(["feat/foo"]);
  });

  it("returns nothing for an unknown repository or none at all", () => {
    expect(pinnedIn("/nope")).toEqual([]);
    expect(pinnedIn(null)).toEqual([]);
  });

  it("keeps the array reference stable while the pins do not change", () => {
    useBranchPins.getState().toggle("/a", "main");
    const first = pinnedIn("/a");
    useBranchPins.getState().toggle("/b", "other");
    // Branches.tsx memoizes a Set on this reference; a fresh array per read
    // would rebuild the ordering on every unrelated store write.
    expect(pinnedIn("/a")).toBe(first);
  });

  it("survives a corrupt payload", () => {
    localStorage.setItem(BRANCH_PINS_KEY, "{not json");
    reload();
    expect(pinnedIn("/a")).toEqual([]);
  });

  it("survives a payload that is not an object", () => {
    localStorage.setItem(BRANCH_PINS_KEY, '["nope"]');
    reload();
    expect(pinnedIn("/a")).toEqual([]);
  });

  it("ignores non-string entries in a stored set", () => {
    localStorage.setItem(BRANCH_PINS_KEY, JSON.stringify({ "/a": ["ok", 3, null] }));
    reload();
    expect(pinnedIn("/a")).toEqual(["ok"]);
  });
});
