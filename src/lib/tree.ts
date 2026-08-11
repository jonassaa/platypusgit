import type { IconName, PGFileTreeNode, PGStageState } from "@/design";
import type { FileStatus } from "./types";
import { isStaged, isUnstaged, statusMark } from "./derive";
import { fileIcon } from "./fileIcons";

export type StageState = PGStageState;

interface MutableNode {
  name: string;
  status?: string;
  children?: MutableNode[];
  defaultExpanded?: boolean;
  staged?: StageState;
  icon?: IconName;
  iconColor?: string;
}

/**
 * Staging state of one file. `undefined` for an unmodified file — that is the
 * signal to render no checkbox at all, rather than an empty one.
 *
 * An embedded repo keeps a "none" state (and therefore a checkbox) so the
 * existing stage guard can flash its explanation on click, matching what the
 * flat CommitPanel row does today.
 */
export function fileStageState(f: FileStatus): StageState | undefined {
  const st = isStaged(f);
  const wt = isUnstaged(f);
  if (!st && !wt) return undefined;
  if (st && wt) return "some";
  return st ? "all" : "none";
}

/**
 * Bottom-up staging rollup over changed descendants only. Must run AFTER
 * compaction — compaction merges folder chains, so a rollup computed before it
 * would be attached to an intermediate node that no longer renders.
 */
function rollupStaged(node: MutableNode): StageState | undefined {
  if (!node.children) return node.staged;
  let seen = false;
  let allStaged = true;
  let noneStaged = true;
  for (const child of node.children) {
    const s = rollupStaged(child);
    if (s === undefined) continue;
    seen = true;
    if (s !== "all") allStaged = false;
    if (s !== "none") noneStaged = false;
  }
  node.staged = !seen ? undefined : allStaged ? "all" : noneStaged ? "none" : "some";
  return node.staged;
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
        if (isLeaf) {
          const { icon, tint } = fileIcon(f.path);
          next = {
            name: part,
            status: hasChange ? statusMark(f) : undefined,
            staged: fileStageState(f),
            icon,
            iconColor: tint,
          };
        } else {
          next = { name: part, children: [] };
        }
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

  // After compaction, never before: a rollup computed pre-merge would be
  // attached to an intermediate node that no longer renders.
  children.forEach(rollupStaged);

  // Expand the first level by default.
  children.forEach((c) => {
    if (c.children?.length) c.defaultExpanded = true;
  });

  return children as PGFileTreeNode[];
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

/**
 * Resolve tree row keys to the file entries they act on.
 *
 * A key that matches a file yields that file. A key that matches nothing is
 * treated as a FOLDER prefix and yields every entry beneath it — otherwise a
 * selected folder is silently dropped from a Stage or Discard batch,
 * under-counting a destructive op.
 *
 * `lookup` lists are searched in order for the direct hit (the caller decides
 * precedence, e.g. worktree status before the all-files list); `descendants` is
 * the set scanned for the prefix expansion, and should be the same set the tree
 * was built from so a batch never reaches a row the user cannot see.
 */
export function expandTreeKeys<T extends { path: string }>(
  keys: readonly string[],
  opts: { lookup: readonly (readonly T[])[]; descendants: readonly T[] },
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const add = (entry: T) => {
    if (seen.has(entry.path)) return;
    seen.add(entry.path);
    out.push(entry);
  };
  for (const key of keys) {
    const hit = findStatusByTreeKey(key, ...opts.lookup);
    if (hit) {
      add(hit);
      continue;
    }
    const prefix = treeKeyToPath(key) + "/";
    for (const child of opts.descendants) {
      if (child.path.startsWith(prefix)) add(child);
    }
  }
  return out;
}
