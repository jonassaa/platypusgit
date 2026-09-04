// Which branch folders a repository has collapsed (#244), persisted like the
// other per-surface view preferences: localStorage, best-effort, never fatal.

import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  readCollapsedFolders,
  reloadCollapsedFolders,
  useBranchFolders,
  writeCollapsedFolders,
  BRANCH_FOLDERS_KEY,
} from "./useBranchFolders";

const raw = () => localStorage.getItem(BRANCH_FOLDERS_KEY);

describe("collapsed branch folders", () => {
  beforeEach(() => localStorage.clear());

  it("is empty for a repository nobody has collapsed anything in", () => {
    expect(readCollapsedFolders("/repos/a")).toEqual(new Set());
  });

  it("round-trips a set for one repository", () => {
    writeCollapsedFolders("/repos/a", new Set(["feat", "release/1"]));

    expect(readCollapsedFolders("/repos/a")).toEqual(
      new Set(["feat", "release/1"]),
    );
  });

  // One key holds every repository's state, so two open tabs must not read
  // each other's folders — the same anti-leak rule the repo slice enforces.
  it("keeps repositories apart", () => {
    writeCollapsedFolders("/repos/a", new Set(["feat"]));
    writeCollapsedFolders("/repos/b", new Set(["fix"]));

    expect(readCollapsedFolders("/repos/a")).toEqual(new Set(["feat"]));
    expect(readCollapsedFolders("/repos/b")).toEqual(new Set(["fix"]));
  });

  // Collapsing is the exception, not the default — so a repository the user
  // expanded again leaves nothing behind, and the key self-prunes instead of
  // growing one entry per repository ever opened.
  it("drops a repository's entry once nothing is collapsed", () => {
    writeCollapsedFolders("/repos/a", new Set(["feat"]));
    writeCollapsedFolders("/repos/b", new Set(["fix"]));

    writeCollapsedFolders("/repos/a", new Set());

    expect(JSON.parse(raw() ?? "{}")).toEqual({ "/repos/b": ["fix"] });
  });

  it("writes nothing at all when the last repository is emptied", () => {
    writeCollapsedFolders("/repos/a", new Set(["feat"]));

    writeCollapsedFolders("/repos/a", new Set());

    expect(raw()).toBeNull();
  });

  it("has nowhere to store state for a repository that is not open", () => {
    writeCollapsedFolders(null, new Set(["feat"]));

    expect(raw()).toBeNull();
    expect(readCollapsedFolders(null)).toEqual(new Set());
  });

  // A hand-edited or half-written payload must degrade to "nothing collapsed",
  // never to a screen that throws on mount.
  it("survives a corrupt payload", () => {
    localStorage.setItem(BRANCH_FOLDERS_KEY, "{not json");

    expect(readCollapsedFolders("/repos/a")).toEqual(new Set());
  });

  it("ignores entries that are not a list of strings", () => {
    localStorage.setItem(
      BRANCH_FOLDERS_KEY,
      JSON.stringify({ "/repos/a": ["feat", 7, null, "fix"], "/repos/b": 3 }),
    );

    expect(readCollapsedFolders("/repos/a")).toEqual(new Set(["feat", "fix"]));
    expect(readCollapsedFolders("/repos/b")).toEqual(new Set());
  });

  it("survives a payload that is not an object", () => {
    localStorage.setItem(BRANCH_FOLDERS_KEY, JSON.stringify(["feat"]));

    expect(readCollapsedFolders("/repos/a")).toEqual(new Set());
  });

  it("leaves other repositories intact when one is rewritten", () => {
    writeCollapsedFolders("/repos/a", new Set(["feat"]));
    writeCollapsedFolders("/repos/b", new Set(["fix"]));

    writeCollapsedFolders("/repos/a", new Set(["feat", "chore"]));

    expect(readCollapsedFolders("/repos/b")).toEqual(new Set(["fix"]));
  });
});

// Two surfaces render the tree at once — the Branches screen and the titlebar
// picker (#244) — so the folds have to be ONE live set. With a copy per hook,
// the last one to write would silently drop the other's folds.
describe("useBranchFolders", () => {
  beforeEach(() => {
    localStorage.clear();
    reloadCollapsedFolders();
  });

  it("shows one surface's fold to the other immediately", () => {
    const screen = renderHook(() => useBranchFolders("/repos/a"));
    const picker = renderHook(() => useBranchFolders("/repos/a"));

    act(() => picker.result.current.collapse(["feat"]));

    expect([...screen.result.current.collapsed]).toEqual(["feat"]);
    expect(readCollapsedFolders("/repos/a")).toEqual(new Set(["feat"]));
  });

  it("does not let one surface's write drop the other's folds", () => {
    const screen = renderHook(() => useBranchFolders("/repos/a"));
    const picker = renderHook(() => useBranchFolders("/repos/a"));

    act(() => picker.result.current.collapse(["feat"]));
    act(() => screen.result.current.collapse(["release"]));

    expect([...picker.result.current.collapsed].sort()).toEqual([
      "feat",
      "release",
    ]);
  });

  it("keeps two open repositories apart", () => {
    const a = renderHook(() => useBranchFolders("/repos/a"));
    const b = renderHook(() => useBranchFolders("/repos/b"));

    act(() => a.result.current.toggle("feat"));

    expect([...a.result.current.collapsed]).toEqual(["feat"]);
    expect([...b.result.current.collapsed]).toEqual([]);
  });

  it("keeps the set's reference stable while the folds do not change", () => {
    const a = renderHook(() => useBranchFolders("/repos/a"));
    const first = a.result.current.collapsed;

    // Another repository's write must not rebuild this one's Set — the Branches
    // screen memoizes its whole row list on the reference.
    const b = renderHook(() => useBranchFolders("/repos/b"));
    act(() => b.result.current.collapse(["fix"]));
    a.rerender();

    expect(a.result.current.collapsed).toBe(first);
  });

  it("has nowhere to write for a repository that is not open", () => {
    const none = renderHook(() => useBranchFolders(null));

    act(() => none.result.current.collapse(["feat"]));

    expect([...none.result.current.collapsed]).toEqual([]);
    expect(localStorage.getItem(BRANCH_FOLDERS_KEY)).toBeNull();
  });
});
