import { describe, it, expect } from "vitest";
import type { PGFileTreeNode } from "@/design";
import {
  buildStatusTree,
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
