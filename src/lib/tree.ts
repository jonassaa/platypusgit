import type { PGFileTreeNode } from "@/design";
import type { FileStatus } from "./types";
import { statusMark } from "./derive";

interface MutableNode {
  name: string;
  status?: string;
  children?: MutableNode[];
  defaultExpanded?: boolean;
  submodule?: boolean;
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
          ? {
              name: part,
              status: hasChange ? statusMark(f) : undefined,
              // A gitlink leaf renders as a submodule rather than as a nameless
              // directory (#93). Only leaves: git does not recurse into one, so a
              // submodule never has children in this tree.
              submodule: f.submodule || undefined,
            }
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

/**
 * Flat counterpart of {@link buildStatusTree}: one leaf node per file, named
 * with its full path, no nesting.
 *
 * Row keys come out identical to the nested build ("/" + full path), which is
 * what lets a view flip between tree and flat without touching selection,
 * staging state, or context menus — they all key off the same strings.
 */
export function buildStatusList(files: FileStatus[]): PGFileTreeNode[] {
  return files
    .map((f) => {
      const hasChange =
        f.worktree.kind !== "Unmodified" || f.index.kind !== "Unmodified";
      return {
        // libgit2's embedded-repo entry carries a trailing slash; the nested
        // build drops it when splitting, so drop it here too or the two modes
        // would disagree about one row's key.
        name: f.path.replace(/\/+$/, ""),
        status: hasChange ? statusMark(f) : undefined,
        submodule: f.submodule || undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Repo-relative path for a PGFileTree row key. Keys are built by joining node
 * names with "/" from an empty root, so they carry a leading slash: "/a/b".
 */
export function treeKeyToPath(key: string): string {
  return key.replace(/^\//, "");
}

/**
 * Find the FileStatus for a repo-relative path, tolerating the trailing slash
 * libgit2 puts on an embedded-repo entry.
 *
 * {@link buildStatusTree} splits paths on "/" and drops empty segments, so
 * `vendor/lib/` becomes the key "/vendor/lib" and an exact `s.path === path`
 * lookup can never match it back. Every call site that maps a row key to its
 * status must go through here, or they disagree about the same row: the ones
 * that miss treat an embedded repo as an ordinary file (and used to stage it as
 * a gitlink), while the ones that hit correctly refuse.
 */
export function findStatusByPath<T extends { path: string }>(
  files: readonly T[],
  path: string,
): T | undefined {
  const withSlash = `${path}/`;
  return files.find((f) => f.path === path || f.path === withSlash);
}

/** {@link findStatusByPath} for a PGFileTree row key, across several lists. */
export function findStatusByTreeKey<T extends { path: string }>(
  key: string,
  ...lists: readonly (readonly T[])[]
): T | undefined {
  const path = treeKeyToPath(key);
  for (const list of lists) {
    const hit = findStatusByPath(list, path);
    if (hit) return hit;
  }
  return undefined;
}
