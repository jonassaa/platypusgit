import { describe, it, expect } from "vitest";
import {
  clickSelection,
  emptySelection,
  primarySelectedKey,
  pruneSelection,
  sidedFileKey,
  sidedFolderKey,
  sidedSelectionSource,
  splitFileSelection,
  treeSelectionSource,
  type Selection,
} from "./selection";
import type { FileStatus } from "./types";

const order = ["a", "b", "c", "d", "e"];

describe("clickSelection", () => {
  it("plain click selects a single row and moves the anchor", () => {
    const s1 = clickSelection(order, emptySelection, "b");
    expect(s1).toEqual({ keys: ["b"], anchor: "b" });
    const s2 = clickSelection(order, s1, "d");
    expect(s2).toEqual({ keys: ["d"], anchor: "d" });
  });

  it("ctrl-click toggles rows in and moves the anchor", () => {
    let s: Selection = clickSelection(order, emptySelection, "a");
    s = clickSelection(order, s, "c", { toggle: true });
    expect(s).toEqual({ keys: ["a", "c"], anchor: "c" });
    s = clickSelection(order, s, "e", { toggle: true });
    expect(s).toEqual({ keys: ["a", "c", "e"], anchor: "e" });
  });

  it("ctrl-click toggles a selected row out, keeping the anchor if it survives", () => {
    let s: Selection = { keys: ["a", "c", "e"], anchor: "e" };
    s = clickSelection(order, s, "c", { toggle: true });
    expect(s).toEqual({ keys: ["a", "e"], anchor: "e" });
  });

  it("ctrl-click toggling the anchor out re-homes it to the last selected row", () => {
    let s: Selection = { keys: ["a", "c", "e"], anchor: "e" };
    s = clickSelection(order, s, "e", { toggle: true });
    expect(s).toEqual({ keys: ["a", "c"], anchor: "c" });
  });

  it("ctrl-click toggling the only row out empties the selection", () => {
    const s = clickSelection(order, { keys: ["b"], anchor: "b" }, "b", {
      toggle: true,
    });
    expect(s).toEqual({ keys: [], anchor: null });
  });

  it("shift-click selects the range from the anchor, forward", () => {
    const start = clickSelection(order, emptySelection, "b");
    const s = clickSelection(order, start, "d", { range: true });
    expect(s).toEqual({ keys: ["b", "c", "d"], anchor: "b" });
  });

  it("shift-click selects the range from the anchor, backward", () => {
    const start = clickSelection(order, emptySelection, "d");
    const s = clickSelection(order, start, "a", { range: true });
    expect(s).toEqual({ keys: ["a", "b", "c", "d"], anchor: "d" });
  });

  it("successive shift-clicks re-extend from the same anchor", () => {
    let s = clickSelection(order, emptySelection, "c");
    s = clickSelection(order, s, "e", { range: true });
    expect(s.keys).toEqual(["c", "d", "e"]);
    s = clickSelection(order, s, "a", { range: true });
    expect(s).toEqual({ keys: ["a", "b", "c"], anchor: "c" });
  });

  it("shift-click without an anchor behaves like a plain click", () => {
    const s = clickSelection(order, emptySelection, "c", { range: true });
    expect(s).toEqual({ keys: ["c"], anchor: "c" });
  });

  it("shift-click with a vanished anchor degrades to plain click", () => {
    const s = clickSelection(order, { keys: ["zz"], anchor: "zz" }, "b", {
      range: true,
    });
    expect(s).toEqual({ keys: ["b"], anchor: "b" });
  });

  it("range wins when both modifiers are held", () => {
    const start = clickSelection(order, emptySelection, "a");
    const s = clickSelection(order, start, "c", { range: true, toggle: true });
    expect(s.keys).toEqual(["a", "b", "c"]);
  });
});

describe("pruneSelection", () => {
  it("returns the same reference when nothing changed", () => {
    const s: Selection = { keys: ["a", "b"], anchor: "a" };
    expect(pruneSelection(s, new Set(order))).toBe(s);
  });

  it("drops keys that no longer exist", () => {
    const s: Selection = { keys: ["a", "b", "c"], anchor: "a" };
    expect(pruneSelection(s, new Set(["a", "c"]))).toEqual({
      keys: ["a", "c"],
      anchor: "a",
    });
  });

  it("re-homes a vanished anchor to the last surviving key", () => {
    const s: Selection = { keys: ["a", "b", "c"], anchor: "b" };
    expect(pruneSelection(s, new Set(["a", "c"]))).toEqual({
      keys: ["a", "c"],
      anchor: "c",
    });
  });

  it("empties out entirely when no keys survive", () => {
    const s: Selection = { keys: ["a"], anchor: "a" };
    expect(pruneSelection(s, new Set())).toEqual({ keys: [], anchor: null });
  });
});

describe("primarySelectedKey", () => {
  it("prefers the anchor while selected", () => {
    expect(primarySelectedKey({ keys: ["a", "b"], anchor: "a" })).toBe("a");
  });

  it("falls back to the last selected key", () => {
    expect(primarySelectedKey({ keys: ["a", "b"], anchor: "zz" })).toBe("b");
  });

  it("is null for an empty selection", () => {
    expect(primarySelectedKey(emptySelection)).toBeNull();
  });
});

// ── splitFileSelection ──────────────────────────────────────────────────────
// The bucketing both multi-file surfaces feed to `multiFileMenuItems`. Folder
// expansion and embedded-repo bucketing are correctness-critical: a folder that
// silently drops out under-counts a destructive op, and an embedded repo that
// leaks into a stage batch writes a bare gitlink.

const fileStatus = (
  path: string,
  over: Partial<FileStatus> = {},
): FileStatus => ({
  path,
  worktree: { kind: "Unmodified" },
  index: { kind: "Unmodified" },
  additions: 0,
  deletions: 0,
  embedded: false,
  ...over,
});

const dirty = (path: string) =>
  fileStatus(path, { worktree: { kind: "Modified" } });
const inIndex = (path: string) => fileStatus(path, { index: { kind: "Modified" } });
const bothSides = (path: string) =>
  fileStatus(path, {
    index: { kind: "Modified" },
    worktree: { kind: "Modified" },
  });
const untracked = (path: string) =>
  fileStatus(path, { worktree: { kind: "Untracked" } });
/** libgit2 reports an embedded repo as one entry with a trailing slash. */
const embeddedRepo = (path: string) =>
  fileStatus(path, { worktree: { kind: "Untracked" }, embedded: true });

describe("splitFileSelection over the tree key space", () => {
  const status = [
    dirty("src/a.ts"),
    inIndex("src/b.ts"),
    bothSides("src/c.ts"),
    untracked("src/new.ts"),
    embeddedRepo("vendor/lib/"),
  ];
  const source = treeSelectionSource(status, status);

  it("buckets each side of a file's changes", () => {
    const split = splitFileSelection(["/src/a.ts", "/src/b.ts", "/src/c.ts"], source);
    expect(split.stagedPaths).toEqual(["src/b.ts", "src/c.ts"]);
    expect(split.unstagedPaths).toEqual(["src/a.ts", "src/c.ts"]);
    expect(split.paths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(split.embeddedPaths).toEqual([]);
    expect(split.untrackedPaths).toEqual([]);
  });

  it("expands a folder key to every descendant", () => {
    const split = splitFileSelection(["/src"], source);
    expect(split.paths).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/new.ts",
    ]);
    expect(split.unstagedPaths).toEqual(["src/a.ts", "src/c.ts", "src/new.ts"]);
    expect(split.stagedPaths).toEqual(["src/b.ts", "src/c.ts"]);
  });

  it("dedupes a file reachable both directly and through its folder", () => {
    const split = splitFileSelection(["/src/a.ts", "/src"], source);
    expect(split.paths).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/new.ts",
    ]);
    expect(split.unstagedPaths).toEqual(["src/a.ts", "src/c.ts", "src/new.ts"]);
  });

  it("names untracked paths separately so the discard confirm can warn", () => {
    const split = splitFileSelection(["/src/new.ts", "/src/a.ts"], source);
    expect(split.untrackedPaths).toEqual(["src/new.ts"]);
    expect(split.unstagedPaths).toEqual(["src/new.ts", "src/a.ts"]);
  });

  it("keeps an embedded repo out of every actionable bucket but still counts it", () => {
    // The key drops the trailing slash the way buildStatusTree does.
    const split = splitFileSelection(["/vendor/lib", "/src/a.ts"], source);
    expect(split.embeddedPaths).toEqual(["vendor/lib/"]);
    expect(split.stagedPaths).toEqual([]);
    expect(split.unstagedPaths).toEqual(["src/a.ts"]);
    expect(split.untrackedPaths).toEqual([]);
    expect(split.paths).toEqual(["vendor/lib/", "src/a.ts"]);
  });

  it("expands a folder against the tree's own source set, not the lookup lists", () => {
    // All-files mode: unmodified files resolve by key but are not tree rows, so
    // a folder must expand to the filtered set the tree actually shows.
    const unmodified = fileStatus("src/quiet.ts");
    const narrowed = treeSelectionSource([dirty("src/a.ts")], status, [unmodified]);
    expect(splitFileSelection(["/src"], narrowed).paths).toEqual(["src/a.ts"]);
    // ...while the unmodified file still resolves, counts and copies on its own.
    const one = splitFileSelection(["/src/quiet.ts"], narrowed);
    expect(one.paths).toEqual(["src/quiet.ts"]);
    expect(one.stagedPaths).toEqual([]);
    expect(one.unstagedPaths).toEqual([]);
  });

  it("yields nothing for a key that resolves to neither a row nor a folder", () => {
    expect(splitFileSelection(["/gone.ts"], source)).toEqual({
      stagedPaths: [],
      unstagedPaths: [],
      paths: [],
      embeddedPaths: [],
      untrackedPaths: [],
    });
  });
});

describe("splitFileSelection over the sided key space", () => {
  const stagedRows = [
    { path: "src/b.ts", status: inIndex("src/b.ts"), side: "staged" as const },
    { path: "src/c.ts", status: bothSides("src/c.ts"), side: "staged" as const },
  ];
  const unstagedRows = [
    { path: "src/a.ts", status: dirty("src/a.ts"), side: "unstaged" as const },
    { path: "src/c.ts", status: bothSides("src/c.ts"), side: "unstaged" as const },
    { path: "src/new.ts", status: untracked("src/new.ts"), side: "unstaged" as const },
    { path: "vendor/lib/", status: embeddedRepo("vendor/lib/"), side: "unstaged" as const },
  ];
  const source = sidedSelectionSource(stagedRows, unstagedRows);

  it("buckets a row by the side it stands for", () => {
    const split = splitFileSelection(
      [sidedFileKey("staged", "src/c.ts"), sidedFileKey("unstaged", "src/a.ts")],
      source,
    );
    expect(split.stagedPaths).toEqual(["src/c.ts"]);
    expect(split.unstagedPaths).toEqual(["src/a.ts"]);
  });

  it("keeps a file selected on both sides in both buckets", () => {
    const split = splitFileSelection(
      [sidedFileKey("staged", "src/c.ts"), sidedFileKey("unstaged", "src/c.ts")],
      source,
    );
    expect(split.stagedPaths).toEqual(["src/c.ts"]);
    expect(split.unstagedPaths).toEqual(["src/c.ts"]);
    // Two rows selected, so the menu says two — same as before the unification.
    expect(split.paths).toEqual(["src/c.ts", "src/c.ts"]);
  });

  it("expands a folder key within its own section only", () => {
    const split = splitFileSelection([sidedFolderKey("unstaged", "src")], source);
    expect(split.unstagedPaths).toEqual(["src/a.ts", "src/c.ts", "src/new.ts"]);
    expect(split.stagedPaths).toEqual([]);
    const stagedSide = splitFileSelection([sidedFolderKey("staged", "src")], source);
    expect(stagedSide.stagedPaths).toEqual(["src/b.ts", "src/c.ts"]);
    expect(stagedSide.unstagedPaths).toEqual([]);
  });

  it("keeps an embedded repo out of the actionable buckets", () => {
    const split = splitFileSelection(
      [
        sidedFileKey("unstaged", "vendor/lib/"),
        sidedFileKey("unstaged", "src/a.ts"),
      ],
      source,
    );
    expect(split.embeddedPaths).toEqual(["vendor/lib/"]);
    expect(split.unstagedPaths).toEqual(["src/a.ts"]);
    expect(split.untrackedPaths).toEqual([]);
  });

  it("reads an ambiguous key as a folder, never as a file", () => {
    // A file literally named `dir:x` collides with the folder marker. Reading
    // it as a folder finds nothing, which is the safe end of the ambiguity —
    // the opposite would let a batch op reach a row the user did not pick.
    const withColon = sidedSelectionSource(
      [],
      [{ path: "dir:x", status: dirty("dir:x"), side: "unstaged" as const }],
    );
    expect(splitFileSelection([sidedFileKey("unstaged", "dir:x")], withColon)).toEqual(
      {
        stagedPaths: [],
        unstagedPaths: [],
        paths: [],
        embeddedPaths: [],
        untrackedPaths: [],
      },
    );
  });

  it("yields nothing for a key outside the space", () => {
    expect(splitFileSelection(["/src/a.ts"], source).paths).toEqual([]);
  });
});
