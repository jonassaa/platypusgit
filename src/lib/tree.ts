import type { PGFileTreeNode } from "@/design";
import type { FileStatus } from "./types";
import { statusMark } from "./derive";

/**
 * Build a tree of PGFileTreeNode from a flat list of FileStatus.
 * Folders collapse by default; the top-level first folder is expanded.
 */
export function buildStatusTree(files: FileStatus[]): PGFileTreeNode[] {
  interface MutableNode {
    name: string;
    status?: string;
    children?: MutableNode[];
    defaultExpanded?: boolean;
  }

  const root: MutableNode = { name: "", children: [] };

  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    const hasChange =
      f.worktree.kind !== "Unmodified" || f.index.kind !== "Unmodified";
    let cursor = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      cursor.children = cursor.children ?? [];
      let next = cursor.children.find((c) => c.name === part);
      if (!next) {
        next = isLeaf
          ? { name: part, status: hasChange ? statusMark(f) : undefined }
          : { name: part, children: [] };
        cursor.children.push(next);
      }
      cursor = next;
    });
  }

  // Sort: folders first, then alpha.
  const sortNode = (n: MutableNode) => {
    if (!n.children) return;
    n.children.sort((a, b) => {
      const aFolder = !!a.children?.length;
      const bFolder = !!b.children?.length;
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortNode);
  };
  sortNode(root);

  // Expand the first level by default.
  root.children?.forEach((c) => {
    if (c.children?.length) c.defaultExpanded = true;
  });

  return (root.children ?? []) as PGFileTreeNode[];
}
