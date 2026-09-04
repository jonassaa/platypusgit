// Grouping branches on "/" (#244). Pure — see branchTree.test.ts.
//
// Every team names branches `feat/…`, `fix/…`, `release/…`, so a forty-branch
// repository renders as forty rows with nothing to collapse. This turns that
// flat list into a tree WITHOUT touching the order it arrives in: the caller
// filters, then orders with `orderBranches` (#135), then groups here. Grouping
// is the last step for a reason — it only ever moves rows into folders, so the
// pinned default branch and the newest-first order both survive it.
//
// The output is FLAT: one array of rows carrying their own `depth`. The
// Branches screen keeps its grid, its keyboard list and its selection index
// exactly as they were — a nested render would have needed all three rewritten.

/** A folder row: a name prefix that groups two or more things. */
export interface BranchTreeFolder {
  kind: "folder";
  /** Full prefix — `feat/foo`. The identity a collapse state keys on. */
  path: string;
  /** What the row shows: the segments this row owns after compression. */
  label: string;
  depth: number;
  /** Branches beneath it, recursively — shown even while collapsed. */
  count: number;
  collapsed: boolean;
}

/** A branch row. `path` is always the branch's full name. */
export interface BranchTreeLeaf<T> {
  kind: "branch";
  path: string;
  label: string;
  depth: number;
  branch: T;
}

export type BranchTreeRow<T> = BranchTreeFolder | BranchTreeLeaf<T>;

interface Node<T> {
  /** The one segment this node was created for. */
  label: string;
  /** Full path from the root. */
  path: string;
  branch?: T;
  /** Insertion-ordered on purpose — that IS the within-folder order. */
  children: Map<string, Node<T>>;
}

/**
 * The segments a name groups on.
 *
 * A ref name cannot contain an empty segment (`git check-ref-format` rejects
 * `a//b`, a leading `/` and a trailing one), and splitting one anyway would
 * produce a leaf whose `path` is no longer the branch's name — which selection,
 * context menus and the inspector all key off. So such a name stays whole.
 */
function segmentsOf(name: string): string[] {
  const parts = name.split("/");
  return parts.some((p) => p === "") ? [name] : parts;
}

function build<T extends { name: string }>(branches: readonly T[]): Node<T> {
  const root: Node<T> = { label: "", path: "", children: new Map() };
  for (const branch of branches) {
    let cursor = root;
    for (const seg of segmentsOf(branch.name)) {
      let next = cursor.children.get(seg);
      if (!next) {
        next = {
          label: seg,
          path: cursor.path ? `${cursor.path}/${seg}` : seg,
          children: new Map(),
        };
        cursor.children.set(seg, next);
      }
      cursor = next;
    }
    cursor.branch = branch;
  }
  return root;
}

/**
 * Merge a single-child chain into one row (Fork / IntelliJ style, and the same
 * rule `lib/tree.ts::compactNode` applies to file paths).
 *
 * A prefix that groups nothing is not a folder, it is part of the name: a lone
 * `feat/foo/bar` is ONE row reading `feat/foo/bar`, not three nested ones. The
 * merge walks through the final leaf too, which is what makes that one row a
 * BRANCH row rather than a folder holding a single child.
 */
function compress<T>(node: Node<T>): Node<T> {
  let n = node;
  let label = node.label;
  while (!n.branch && n.children.size === 1) {
    const only = n.children.values().next().value as Node<T>;
    label = `${label}/${only.label}`;
    n = only;
  }
  return { ...n, label };
}

function countBranches<T>(node: Node<T>): number {
  let n = node.branch ? 1 : 0;
  for (const child of node.children.values()) n += countBranches(child);
  return n;
}

function countBelow<T>(node: Node<T>): number {
  let n = 0;
  for (const child of node.children.values()) n += countBranches(child);
  return n;
}

function emit<T>(
  parent: Node<T>,
  depth: number,
  collapsed: ReadonlySet<string>,
  out: BranchTreeRow<T>[],
): void {
  for (const raw of parent.children.values()) {
    const node = compress(raw);
    // A node can hold a branch AND children only if a repository contains both
    // `feat` and `feat/a`, which git refuses to create. Rendering both anyway
    // costs one row; assuming it away would silently drop a real branch.
    if (node.branch) {
      out.push({
        kind: "branch",
        path: node.path,
        label: node.label,
        depth,
        branch: node.branch,
      });
    }
    if (node.children.size > 0) {
      const isCollapsed = collapsed.has(node.path);
      out.push({
        kind: "folder",
        path: node.path,
        label: node.label,
        depth,
        count: countBelow(node),
        collapsed: isCollapsed,
      });
      if (!isCollapsed) emit(node, depth + 1, collapsed, out);
    }
  }
}

/**
 * Group an ALREADY filtered and ordered branch list into display rows.
 *
 * `collapsed` holds folder paths, so the persisted state is the exceptions:
 * a folder that appears after a fetch is visible without anyone having said so.
 */
export function branchTreeRows<T extends { name: string }>(
  branches: readonly T[],
  collapsed: ReadonlySet<string>,
): BranchTreeRow<T>[] {
  const out: BranchTreeRow<T>[] = [];
  emit(build(branches), 0, collapsed, out);
  return out;
}

/**
 * One ungrouped row per branch, under its FULL name — what a filter renders.
 *
 * A filter flattens the tree to its matches, as filters should: hiding a hit
 * behind a folded folder is the one thing a search box must never do, and a
 * bare `bar` with no `feat/foo` above it names nothing.
 */
export function branchLeafRows<T extends { name: string }>(
  branches: readonly T[],
): BranchTreeRow<T>[] {
  return branches.map((branch) => ({
    kind: "branch",
    path: branch.name,
    label: branch.name,
    depth: 0,
    branch,
  }));
}

/**
 * The display rows for an already filtered and ordered list, with the pinned
 * branches (#238) HOISTED OUT of the tree rather than sorted to the front of
 * it.
 *
 * Grouping only moves ordered rows into folders, so a pinned `feat/foo` would
 * otherwise be the first row INSIDE `feat` — invisible whenever that folder is
 * collapsed, which is the case pinning exists for. Hoisted rows render at depth
 * 0 under their full names and are REMOVED from the tree rather than duplicated
 * into it.
 *
 * Both surfaces that render the tree go through this, so the Branches screen
 * and the titlebar picker can never disagree about one list.
 */
export function branchTreeRowsWithPins<T extends { name: string }>(
  ordered: readonly T[],
  pins: ReadonlySet<string>,
  collapsed: ReadonlySet<string>,
): BranchTreeRow<T>[] {
  if (pins.size === 0) return branchTreeRows(ordered, collapsed);
  const pinned = ordered.filter((b) => pins.has(b.name));
  const rest = ordered.filter((b) => !pins.has(b.name));
  // `ordered` is already pins-first, so the hoisted block and the tree below
  // it stay one continuous order.
  return [...branchLeafRows(pinned), ...branchTreeRows(rest, collapsed)];
}

/**
 * Every folder path the tree would render, expanded or not — what "collapse
 * all" writes. A compressed chain is ONE path (`feat/foo`), never one per
 * segment, or collapsing all would leave rows keyed on folders that don't exist.
 */
export function branchFolderPaths<T extends { name: string }>(
  branches: readonly T[],
): string[] {
  return branchTreeRows(branches, new Set())
    .filter((r) => r.kind === "folder")
    .map((r) => r.path);
}

/**
 * The folder a row sits in: the nearest row above it that is a folder at a
 * shallower depth. Null at the top level, or past the end of the tree.
 *
 * This is ←'s answer for a row that is not itself an expanded folder — the
 * "climb out" half of tree navigation. Read off the RENDERED rows rather than
 * off the path: chain compression means the folder holding `feat/foo/bar` may
 * be `feat/foo` or `feat`, depending on what else the repository contains.
 */
export function parentFolderPath<T>(
  rows: readonly BranchTreeRow<T>[],
  index: number,
): string | null {
  const row = rows[index];
  if (!row) return null;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = rows[i];
    if (candidate.kind === "folder" && candidate.depth < row.depth)
      return candidate.path;
  }
  return null;
}

/**
 * The branches beneath a folder, in the order given.
 *
 * Prefix match on a SEGMENT boundary: `feat` does not contain `feature/x`.
 */
export function branchesInFolder<T extends { name: string }>(
  branches: readonly T[],
  folderPath: string,
): T[] {
  const prefix = `${folderPath}/`;
  return branches.filter((b) => b.name.startsWith(prefix));
}
