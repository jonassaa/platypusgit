import { describe, it, expect } from "vitest";
import type { PGFileTreeNode } from "@/design";
import {
  buildStatusTree,
  expandTreeKeys,
  findStatusByPath,
  findStatusByTreeKey,
  treeKeyToPath,
} from "./tree";
import type { FileStatus, StatusFlag } from "./types";

function file(path: string, worktree: StatusFlag["kind"] = "Modified"): FileStatus {
  return {
    path,
    worktree: { kind: worktree },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

/** Names of a node's descendants, as a nested [name, children?] shape. */
function shape(nodes: ReturnType<typeof buildStatusTree>): unknown {
  return nodes.map((n) =>
    n.children ? { name: n.name, children: shape(n.children) } : n.name,
  );
}

describe("buildStatusTree — path compaction (A1)", () => {
  it("collapses a single-child directory chain into one node", () => {
    const tree = buildStatusTree([file("src/features/repo/store.ts")]);
    expect(shape(tree)).toEqual([
      { name: "src/features/repo", children: ["store.ts"] },
    ]);
  });

  it("does NOT collapse a folder whose only child is a file", () => {
    const tree = buildStatusTree([file("src/main.ts")]);
    expect(shape(tree)).toEqual([{ name: "src", children: ["main.ts"] }]);
  });

  it("does NOT collapse a folder that has more than one child", () => {
    const tree = buildStatusTree([
      file("src/a/one.ts"),
      file("src/b/two.ts"),
    ]);
    // src has two folder children → stays; each of a/b is a single-file folder.
    expect(shape(tree)).toEqual([
      {
        name: "src",
        children: [
          { name: "a", children: ["one.ts"] },
          { name: "b", children: ["two.ts"] },
        ],
      },
    ]);
  });

  it("compacts only the single-child prefix, then stops at the branch point", () => {
    const tree = buildStatusTree([
      file("a/b/c/x.ts"),
      file("a/b/c/y.ts"),
    ]);
    expect(shape(tree)).toEqual([
      { name: "a/b/c", children: ["x.ts", "y.ts"] },
    ]);
  });

  it("preserves full per-segment nesting when compact:false", () => {
    const tree = buildStatusTree([file("src/features/repo/store.ts")], {
      compact: false,
    });
    expect(shape(tree)).toEqual([
      {
        name: "src",
        children: [
          {
            name: "features",
            children: [{ name: "repo", children: ["store.ts"] }],
          },
        ],
      },
    ]);
  });

  it("keeps leaf status marks on compacted nodes' children", () => {
    const tree = buildStatusTree([file("src/deep/nested/a.ts", "Added")]);
    const leaf = tree[0].children?.[0];
    expect(tree[0].name).toBe("src/deep/nested");
    expect(leaf?.status).toBeTruthy();
  });

  it("expands the first level of the compacted tree by default", () => {
    const tree = buildStatusTree([file("src/features/repo/store.ts")]);
    expect(tree[0].defaultExpanded).toBe(true);
  });
});

function stagedFile(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Modified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

function partialFile(path: string): FileStatus {
  return { ...stagedFile(path), worktree: { kind: "Modified" } };
}

function unmodifiedFile(path: string): FileStatus {
  return {
    path,
    worktree: { kind: "Unmodified" },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
    embedded: false,
  };
}

describe("buildStatusTree — staging rollup (A5)", () => {
  it("marks a fully staged leaf 'all' and an unstaged leaf 'none'", () => {
    const tree = buildStatusTree([stagedFile("a.ts"), file("b.ts")]);
    const byName = Object.fromEntries(tree.map((n) => [n.name, n]));
    expect(byName["a.ts"].staged).toBe("all");
    expect(byName["b.ts"].staged).toBe("none");
  });

  it("marks a partially staged leaf 'some'", () => {
    const tree = buildStatusTree([partialFile("a.ts")]);
    expect(tree[0].staged).toBe("some");
  });

  it("rolls a folder up to 'all' when every changed child is staged", () => {
    const tree = buildStatusTree([stagedFile("src/a.ts"), stagedFile("src/b.ts")]);
    expect(tree[0].name).toBe("src");
    expect(tree[0].staged).toBe("all");
  });

  it("rolls a folder up to 'some' when children disagree", () => {
    const tree = buildStatusTree([stagedFile("src/a.ts"), file("src/b.ts")]);
    expect(tree[0].staged).toBe("some");
  });

  it("rolls a folder up to 'none' when no child is staged", () => {
    const tree = buildStatusTree([file("src/a.ts"), file("src/b.ts")]);
    expect(tree[0].staged).toBe("none");
  });

  it("rolls up through a COMPACTED chain, not the pre-merge intermediate", () => {
    const tree = buildStatusTree([
      stagedFile("src/features/repo/a.ts"),
      file("src/features/repo/b.ts"),
    ]);
    expect(tree[0].name).toBe("src/features/repo");
    expect(tree[0].staged).toBe("some");
  });

  it("leaves unmodified files and their folders without a rollup", () => {
    const tree = buildStatusTree([unmodifiedFile("docs/readme.md")]);
    expect(tree[0].staged).toBeUndefined();
    expect(tree[0].children?.[0].staged).toBeUndefined();
  });

  it("ignores unmodified siblings when rolling a folder up", () => {
    const tree = buildStatusTree([
      stagedFile("src/a.ts"),
      unmodifiedFile("src/untouched.ts"),
    ]);
    expect(tree[0].staged).toBe("all");
  });

  it("decorates leaves with a file-type icon and tint", () => {
    const tree = buildStatusTree([file("src/index.css")]);
    const leaf = tree[0].children?.[0];
    expect(leaf?.icon).toBe("fileStyle");
    expect(leaf?.iconColor).toBe("var(--accent-4)");
  });
});

/** Row keys exactly as PGFileTree/flattenFileTree builds them: parent + "/" + name. */
function treeKeys(nodes: PGFileTreeNode[], parentKey = ""): string[] {
  return nodes.flatMap((n) => {
    const key = `${parentKey}/${n.name}`;
    return [key, ...(n.children ? treeKeys(n.children, key) : [])];
  });
}

describe("resolving a tree row key back to its FileStatus", () => {
  // libgit2 reports an untracked directory that is itself a git repo as ONE
  // entry with a trailing slash, because it won't recurse across the nested
  // .git. buildStatusTree drops that slash when it splits on "/", so the row
  // key is "/vendor/lib" while FileStatus.path is "vendor/lib/". An exact
  // match can never find it — and the call sites that missed used to hand the
  // slashless path straight to stage(), which wrote a silent gitlink.
  const embedded: FileStatus = {
    ...file("vendor/lib/", "Untracked"),
    embedded: true,
  };
  const normal = file("src/main.ts");
  const files = [normal, embedded];

  it("resolves an embedded-repo entry through the key the tree actually builds", () => {
    const keys = treeKeys(buildStatusTree(files));
    expect(keys).toContain("/vendor/lib");

    expect(findStatusByTreeKey("/vendor/lib", files)).toBe(embedded);
  });

  it("still resolves an ordinary path", () => {
    const keys = treeKeys(buildStatusTree(files));
    expect(keys).toContain("/src/main.ts");

    expect(findStatusByTreeKey("/src/main.ts", files)).toBe(normal);
  });

  it("searches lists in order and returns undefined when nothing matches", () => {
    expect(findStatusByTreeKey("/vendor", files)).toBeUndefined();
    expect(findStatusByTreeKey("/src/main.ts", [], files)).toBe(normal);
  });

  it("does not confuse a folder prefix with the embedded entry", () => {
    // "vendor" is the parent folder row, not the embedded repo itself.
    expect(findStatusByPath(files, "vendor")).toBeUndefined();
  });

  it("strips the leading slash the tree keys carry", () => {
    expect(treeKeyToPath("/a/b/c")).toBe("a/b/c");
    expect(treeKeyToPath("a/b")).toBe("a/b");
  });
});

describe("expandTreeKeys", () => {
  const a = file("src/a.ts");
  const b = file("src/nested/b.ts");
  const c = file("docs/c.md");
  const all = [a, b, c];

  it("resolves a file key to its own entry", () => {
    expect(expandTreeKeys(["/src/a.ts"], { lookup: [all], descendants: all }))
      .toEqual([a]);
  });

  it("expands a folder key to every descendant, including nested ones", () => {
    expect(expandTreeKeys(["/src"], { lookup: [all], descendants: all }))
      .toEqual([a, b]);
  });

  it("expands a nested folder key", () => {
    expect(expandTreeKeys(["/src/nested"], { lookup: [all], descendants: all }))
      .toEqual([b]);
  });

  it("deduplicates when a file and its parent folder are both selected", () => {
    const out = expandTreeKeys(["/src", "/src/a.ts"], {
      lookup: [all],
      descendants: all,
    });
    expect(out).toEqual([a, b]);
  });

  it("searches lookup lists in order", () => {
    const shadow = { ...file("src/a.ts"), additions: 99 };
    const out = expandTreeKeys(["/src/a.ts"], {
      lookup: [[shadow], all],
      descendants: all,
    });
    expect(out[0]).toBe(shadow);
  });

  it("resolves an embedded-repo key despite its trailing slash", () => {
    const embeddedRepo: FileStatus = {
      ...file("vendor/lib/", "Untracked"),
      embedded: true,
    };
    const files = [...all, embeddedRepo];
    expect(
      expandTreeKeys(["/vendor/lib"], { lookup: [files], descendants: files }),
    ).toEqual([embeddedRepo]);
  });

  it("returns nothing for a key that matches no file and no prefix", () => {
    expect(expandTreeKeys(["/nope"], { lookup: [all], descendants: all }))
      .toEqual([]);
  });
});
