// Grouping branches on "/" (#244). Pure, so the whole table is testable
// without a DOM, a store or a repository — the Branches screen only renders
// what comes out of here.

import { describe, it, expect } from "vitest";
import {
  branchTreeRows,
  branchFolderPaths,
  branchesInFolder,
  parentFolderPath,
  type BranchTreeRow,
} from "./branchTree";

const b = (name: string) => ({ name });
const none = new Set<string>();

/** `depth:kind:label` per row — the shape assertions read off. */
const shape = (rows: readonly BranchTreeRow<{ name: string }>[]) =>
  rows.map((r) => `${r.depth}:${r.kind === "folder" ? "d" : "-"}:${r.label}`);

describe("branchTreeRows", () => {
  it("leaves a slashless list exactly as it found it", () => {
    const rows = branchTreeRows([b("main"), b("wip"), b("gh-pages")], none);

    expect(shape(rows)).toEqual(["0:-:main", "0:-:wip", "0:-:gh-pages"]);
  });

  it("groups branches that share a first segment into a folder", () => {
    const rows = branchTreeRows([b("main"), b("feat/a"), b("feat/b")], none);

    expect(shape(rows)).toEqual(["0:-:main", "0:d:feat", "1:-:a", "1:-:b"]);
  });

  // The point of the compression: a prefix that groups nothing is not a folder,
  // it is part of the name. `feat/foo/bar` alone is ONE row, not three.
  it("renders a lone deep branch as one row, not a chain of folders", () => {
    const rows = branchTreeRows([b("feat/foo/bar")], none);

    expect(shape(rows)).toEqual(["0:-:feat/foo/bar"]);
    expect(rows[0].path).toBe("feat/foo/bar");
  });

  it("compresses only the part of the chain that branches nothing", () => {
    const rows = branchTreeRows(
      [b("feat/foo/bar"), b("feat/foo/baz"), b("other")],
      none,
    );

    // `feat` holds one thing, so it merges with `foo`, which holds two.
    expect(shape(rows)).toEqual([
      "0:d:feat/foo",
      "1:-:bar",
      "1:-:baz",
      "0:-:other",
    ]);
    expect(rows[0].path).toBe("feat/foo");
  });

  it("nests arbitrarily deep", () => {
    const rows = branchTreeRows(
      [b("a/b/one"), b("a/b/two"), b("a/c/three"), b("a/c/four")],
      none,
    );

    expect(shape(rows)).toEqual([
      "0:d:a",
      "1:d:b",
      "2:-:one",
      "2:-:two",
      "1:d:c",
      "2:-:three",
      "2:-:four",
    ]);
  });

  // Ordering is `orderBranches`' job (#135) and stays its job: the tree groups
  // what it is handed and never re-sorts, or the pinned default and the
  // recency order would both be silently undone.
  it("keeps the order it was given inside a folder", () => {
    const rows = branchTreeRows(
      [b("feat/zeta"), b("feat/alpha"), b("feat/mid")],
      none,
    );

    expect(shape(rows)).toEqual([
      "0:d:feat",
      "1:-:zeta",
      "1:-:alpha",
      "1:-:mid",
    ]);
  });

  // A folder is only as recent as its freshest branch, and the input is already
  // newest-first — so first touch wins, and a folder full of stale branches
  // sinks below a fresh loose one.
  it("ranks a folder where its first branch was", () => {
    const rows = branchTreeRows(
      [b("chore/old"), b("hotfix"), b("chore/older")],
      none,
    );

    expect(shape(rows)).toEqual([
      "0:d:chore",
      "1:-:old",
      "1:-:older",
      "0:-:hotfix",
    ]);
  });

  it("counts every branch beneath a folder, however deep", () => {
    const rows = branchTreeRows(
      [b("a/b/one"), b("a/b/two"), b("a/three")],
      none,
    );

    const folders = rows.filter((r) => r.kind === "folder");
    expect(folders.map((f) => [f.path, f.kind === "folder" && f.count])).toEqual(
      [
        ["a", 3],
        ["a/b", 2],
      ],
    );
  });

  it("hides a collapsed folder's subtree but still counts it", () => {
    const rows = branchTreeRows(
      [b("main"), b("feat/a"), b("feat/b")],
      new Set(["feat"]),
    );

    expect(shape(rows)).toEqual(["0:-:main", "0:d:feat"]);
    const folder = rows[1];
    expect(folder.kind === "folder" && folder.count).toBe(2);
    expect(folder.kind === "folder" && folder.collapsed).toBe(true);
  });

  it("hides folders nested inside a collapsed folder", () => {
    const rows = branchTreeRows(
      [b("a/b/one"), b("a/b/two"), b("a/three")],
      new Set(["a"]),
    );

    expect(shape(rows)).toEqual(["0:d:a"]);
  });

  it("collapsing an inner folder leaves its parent's other rows alone", () => {
    const rows = branchTreeRows(
      [b("a/b/one"), b("a/b/two"), b("a/three")],
      new Set(["a/b"]),
    );

    expect(shape(rows)).toEqual(["0:d:a", "1:d:b", "1:-:three"]);
  });

  // Every branch row has to be able to say which branch it is: the screen keys
  // selection, context menus and the inspector off the full name.
  it("carries the full branch name and the row's own branch object", () => {
    const rows = branchTreeRows([b("feat/foo/bar"), b("feat/foo/baz")], none);

    const leaves = rows.filter((r) => r.kind === "branch");
    expect(leaves.map((l) => l.path)).toEqual(["feat/foo/bar", "feat/foo/baz"]);
    expect(leaves[0].kind === "branch" && leaves[0].branch.name).toBe(
      "feat/foo/bar",
    );
  });

  it("shows every branch exactly once when nothing is collapsed", () => {
    const input = [
      b("main"),
      b("feat/a"),
      b("feat/deep/b"),
      b("feat/deep/c"),
      b("origin/main"),
      b("origin/feat/a"),
    ];

    const leaves = branchTreeRows(input, none)
      .filter((r) => r.kind === "branch")
      .map((r) => r.path);

    expect(leaves.slice().sort()).toEqual(input.map((r) => r.name).sort());
  });

  // Remote names are `origin/<branch>`, so the remote IS the first segment and
  // grouping labels the remote block for free — the flat list never did.
  it("groups remote branches under their remote", () => {
    const rows = branchTreeRows(
      [b("origin/main"), b("origin/feat/a"), b("origin/feat/b")],
      none,
    );

    expect(shape(rows)).toEqual([
      "0:d:origin",
      "1:-:main",
      "1:d:feat",
      "2:-:a",
      "2:-:b",
    ]);
  });

  // Git refuses a branch called `feat` next to `feat/x` ("cannot lock ref"), so
  // this shape cannot come from a repository — but a row that vanished because
  // the tree assumed it away would be a silent wrong answer, so both render.
  it("still renders a branch whose name is also a folder prefix", () => {
    const rows = branchTreeRows([b("feat"), b("feat/a")], none);

    expect(shape(rows)).toEqual(["0:-:feat", "0:d:feat", "1:-:a"]);
  });

  // `refs/heads/a//b` is not a legal ref either. Splitting it would produce a
  // leaf whose path is no longer the branch's name, which every call site keys
  // off — so such a name is left whole instead.
  it("does not split a name with an empty segment", () => {
    const rows = branchTreeRows([b("a//b")], none);

    expect(shape(rows)).toEqual(["0:-:a//b"]);
    expect(rows[0].path).toBe("a//b");
  });

  it("does not mutate its input", () => {
    const input = [b("feat/b"), b("feat/a")];
    const before = input.map((r) => r.name);

    branchTreeRows(input, none);

    expect(input.map((r) => r.name)).toEqual(before);
  });

  it("is empty for an empty list", () => {
    expect(branchTreeRows([], none)).toEqual([]);
  });
});

describe("branchFolderPaths", () => {
  // "Collapse all" writes this set, so it must name exactly the folder rows the
  // tree renders — a compressed chain is ONE path, not one per segment.
  it("names every folder the tree renders, and nothing else", () => {
    expect(
      branchFolderPaths([
        b("main"),
        b("feat/foo/bar"),
        b("feat/foo/baz"),
        b("release/1/x"),
        b("a/b/one"),
        b("a/b/two"),
        b("a/three"),
      ]),
    ).toEqual(["feat/foo", "a", "a/b"]);
  });

  it("has no folders when no name has a slash", () => {
    expect(branchFolderPaths([b("main"), b("wip")])).toEqual([]);
  });
});

describe("parentFolderPath", () => {
  const rows = branchTreeRows(
    [b("main"), b("a/b/one"), b("a/b/two"), b("a/three")],
    none,
  );
  // 0 main · 1 folder a · 2 folder a/b · 3 one · 4 two · 5 three

  it("is null for a top-level row", () => {
    expect(parentFolderPath(rows, 0)).toBeNull();
    expect(parentFolderPath(rows, 1)).toBeNull();
  });

  it("climbs from a branch to the folder it sits in", () => {
    expect(parentFolderPath(rows, 3)).toBe("a/b");
    expect(parentFolderPath(rows, 5)).toBe("a");
  });

  it("climbs from a folder to the folder above it", () => {
    expect(parentFolderPath(rows, 2)).toBe("a");
  });

  // The keyboard list also holds tags and stashes, whose indices run past the
  // end of the tree — those must climb nowhere rather than throw.
  it("is null past the end of the rows", () => {
    expect(parentFolderPath(rows, 99)).toBeNull();
  });
});

describe("branchesInFolder", () => {
  it("returns the branches beneath a folder, in the order given", () => {
    const input = [b("feat/b"), b("feat/a"), b("feat/deep/c"), b("main")];

    expect(branchesInFolder(input, "feat").map((r) => r.name)).toEqual([
      "feat/b",
      "feat/a",
      "feat/deep/c",
    ]);
  });

  it("matches on a segment boundary, never a bare prefix", () => {
    const input = [b("feature/x"), b("feat/y")];

    expect(branchesInFolder(input, "feat").map((r) => r.name)).toEqual([
      "feat/y",
    ]);
  });

  it("is empty for a folder nothing lives in", () => {
    expect(branchesInFolder([b("main")], "feat")).toEqual([]);
  });
});
