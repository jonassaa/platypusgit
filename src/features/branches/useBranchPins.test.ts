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

  // A pin matches the name exactly, so a rename — including a branch dragged
  // into a folder (#244) — has to carry the pin with it.
  it("follows a renamed branch, keeping its place in the order", () => {
    useBranchPins.getState().toggle("/a", "main");
    useBranchPins.getState().toggle("/a", "foo");
    useBranchPins.getState().toggle("/a", "other");
    useBranchPins.getState().rename("/a", "foo", "feat/foo");
    expect(pinnedIn("/a")).toEqual(["main", "feat/foo", "other"]);
    expect(raw()).toEqual({ "/a": ["main", "feat/foo", "other"] });
  });

  it("does not pin a branch that was not pinned before the rename", () => {
    useBranchPins.getState().toggle("/a", "main");
    useBranchPins.getState().rename("/a", "foo", "feat/foo");
    expect(pinnedIn("/a")).toEqual(["main"]);
  });

  it("never doubles up when the new name was already pinned", () => {
    useBranchPins.getState().toggle("/a", "foo");
    useBranchPins.getState().toggle("/a", "feat/foo");
    useBranchPins.getState().rename("/a", "foo", "feat/foo");
    expect(pinnedIn("/a")).toEqual(["feat/foo"]);
  });

  it("ignores a rename with nothing to do", () => {
    useBranchPins.getState().toggle("/a", "foo");
    useBranchPins.getState().rename("/a", "foo", "foo");
    useBranchPins.getState().rename(null, "foo", "bar");
    useBranchPins.getState().rename("/a", "foo", "");
    expect(pinnedIn("/a")).toEqual(["foo"]);
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
