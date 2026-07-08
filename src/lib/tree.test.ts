import { describe, it, expect } from "vitest";
import { buildStatusTree } from "./tree";
import type { FileStatus, StatusFlag } from "./types";

function file(path: string, worktree: StatusFlag["kind"] = "Modified"): FileStatus {
  return {
    path,
    worktree: { kind: worktree },
    index: { kind: "Unmodified" },
    additions: 0,
    deletions: 0,
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
