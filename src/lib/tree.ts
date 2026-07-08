import type { PGFileTreeNode } from "@/design";
import type { FileStatus } from "./types";
import { statusMark } from "./derive";

interface MutableNode {
  name: string;
  status?: string;
  children?: MutableNode[];
  defaultExpanded?: boolean;
}

/**
 * Collapse single-child directory chains into one node (Fork / Sublime / IntelliJ
 * style): a folder whose only child is another folder merges with it, joining
 * names with `/`. A folder with a file child or multiple children is left alone,
 * so `src/features/repo` renders as one row instead of three nested ones.
 */
function compactNode(node: MutableNode): MutableNode {
  if (!node.children) return node;
  let n: MutableNode = { ...node, children: node.children.map(compactNode) };
  while (
    n.children!.length === 1 &&
    n.children![0].children &&
    n.children![0].children.length > 0 &&
    n.children![0].status === undefined
  ) {
    const child = n.children![0];
    n = {
      name: `${n.name}/${child.name}`,
      children: child.children,
      defaultExpanded: n.defaultExpanded,
    };
  }
  return n;
}

/**
 * Build a tree of PGFileTreeNode from a flat list of FileStatus.
 * Folders collapse by default; the top-level first folder is expanded.
 *
 * `compact` (default true) merges single-child directory chains — see
 * {@link compactNode}. Pass `{ compact: false }` for full per-segment nesting.
 */
export function buildStatusTree(
  files: FileStatus[],
  opts: { compact?: boolean } = {},
): PGFileTreeNode[] {
  const { compact = true } = opts;

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

  let children = root.children ?? [];
  if (compact) children = children.map(compactNode);

  // Expand the first level by default.
  children.forEach((c) => {
    if (c.children?.length) c.defaultExpanded = true;
  });

  return children as PGFileTreeNode[];
}
