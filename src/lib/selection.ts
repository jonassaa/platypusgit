// Multi-select list semantics shared by the CommitPanel change lists and the
// RepoBrowser file tree. Pure functions over row keys — components own the
// state, this module owns the rules.
//
// Two layers live here: the click/range/prune model (below) and, at the bottom
// of the file, the selection → path-bucket split every multi-file op needs.
//
// Model (classic desktop list):
// - plain click        → select exactly that row, anchor moves to it
// - cmd/ctrl click     → toggle row in/out; toggling in moves the anchor,
//                        toggling the anchor out re-homes it to the last
//                        remaining selected row
// - shift click        → replace selection with the contiguous range of
//                        visible rows between the anchor and the clicked row;
//                        the anchor stays put so successive shift-clicks
//                        re-extend from the same origin

import { isStaged, isUnstaged, isUntracked } from "./derive";
import { findStatusByTreeKey, treeKeyToPath } from "./tree";
import type { FileStatus } from "./types";

export interface Selection {
  /** Selected row keys, in click/range order, no duplicates. */
  keys: string[];
  /** Range origin: the last plain- or ctrl-selected row. */
  anchor: string | null;
}

export const emptySelection: Selection = { keys: [], anchor: null };

export interface ClickModifiers {
  /** Cmd/Ctrl held — toggle the row. */
  toggle?: boolean;
  /** Shift held — extend a contiguous range from the anchor. */
  range?: boolean;
}

/**
 * Apply a click on `key` to the previous selection. `order` is the current
 * visible row order (used for shift ranges). Range wins over toggle when both
 * modifiers are held, matching Finder/Explorer behavior.
 */
export function clickSelection(
  order: readonly string[],
  prev: Selection,
  key: string,
  mods: ClickModifiers = {},
): Selection {
  if (mods.range) {
    const anchor = prev.anchor ?? key;
    const ai = order.indexOf(anchor);
    const ki = order.indexOf(key);
    if (ai < 0 || ki < 0) return { keys: [key], anchor: key };
    const [lo, hi] = ai <= ki ? [ai, ki] : [ki, ai];
    return { keys: order.slice(lo, hi + 1), anchor };
  }
  if (mods.toggle) {
    if (prev.keys.includes(key)) {
      const keys = prev.keys.filter((k) => k !== key);
      const anchor =
        prev.anchor === key ? (keys[keys.length - 1] ?? null) : prev.anchor;
      return { keys, anchor };
    }
    return { keys: [...prev.keys, key], anchor: key };
  }
  return { keys: [key], anchor: key };
}

/**
 * Drop keys that no longer exist (refresh, repo switch, files moving between
 * lists). A vanished anchor falls back to the last surviving selected row.
 * Returns `prev` by reference when nothing changed so callers can pass the
 * result straight to setState without spurious re-renders.
 */
export function pruneSelection(
  prev: Selection,
  valid: ReadonlySet<string>,
): Selection {
  const keys = prev.keys.filter((k) => valid.has(k));
  const anchorAlive = prev.anchor === null || valid.has(prev.anchor);
  if (keys.length === prev.keys.length && anchorAlive) return prev;
  const anchor =
    prev.anchor !== null && valid.has(prev.anchor)
      ? prev.anchor
      : (keys[keys.length - 1] ?? null);
  return { keys, anchor };
}

/**
 * The row that drives the single-file preview pane: the anchor while it is
 * still selected, otherwise the most recently selected row.
 */
export function primarySelectedKey(sel: Selection): string | null {
  if (sel.anchor !== null && sel.keys.includes(sel.anchor)) return sel.anchor;
  return sel.keys[sel.keys.length - 1] ?? null;
}

// ── Selection → path buckets ────────────────────────────────────────────────
// `multiFileMenuItems` wants a multi-selection reduced to path arrays: what can
// be staged, what can be unstaged, what is untracked, what is an embedded repo,
// and everything selected (for the count and Copy paths). Two screens used to
// compute that twice, in two key spaces, and drifted: only one of them expanded
// a selected FOLDER to the files beneath it, which silently under-counted a
// destructive op (#47). The rules now live here once; each surface supplies
// only the key→row lookup its own key space needs.

/** Which side of a file's changes a row stands for. */
export type FileSide = "staged" | "unstaged";

/**
 * One selectable file row behind a selection key.
 *
 * `side` is set only by surfaces that split a file across two lists (the commit
 * panel's STAGED and CHANGES sections), where each row stands for ONE side of
 * that file's changes. Left undefined the row stands for the file as a whole
 * and both of its sides count — what the repo browser's single tree needs.
 */
export interface FileSelectionRow {
  path: string;
  status: FileStatus;
  side?: FileSide;
}

/** The path buckets `multiFileMenuItems` consumes. */
export interface FileSelectionSplit {
  stagedPaths: string[];
  unstagedPaths: string[];
  /** Every selected path, including embedded repos and unmodified files. */
  paths: string[];
  embeddedPaths: string[];
  untrackedPaths: string[];
}

/**
 * How one surface maps its own selection keys onto rows.
 *
 * Two methods because a folder key resolves to no single row: `rowFor` answers
 * file keys, `rowsUnder` expands a folder key to the rows beneath it. A key
 * that is neither yields nothing from both, which is how an already-vanished
 * key drops out instead of being counted.
 */
export interface FileSelectionSource {
  rowFor(key: string): FileSelectionRow | undefined;
  rowsUnder(key: string): FileSelectionRow[];
}

/**
 * Bucket a multi-selection into the path arrays a batch op acts on.
 *
 * Folder keys expand to every row beneath them, so a selected folder counts and
 * stages/discards like the rows it contains. Rows are deduped (a file reachable
 * both directly and through a selected ancestor is added once), preserving key
 * order.
 *
 * An embedded git repository lands in `embeddedPaths` and nowhere else: it is
 * not a file, so Stage/Unstage/Discard must never reach it (see
 * `FileStatus.embedded`). It still counts and copies like any other row.
 */
export function splitFileSelection(
  keys: readonly string[],
  source: FileSelectionSource,
): FileSelectionSplit {
  const stagedPaths: string[] = [];
  const unstagedPaths: string[] = [];
  const embeddedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  const paths: string[] = [];
  const seen = new Set<string>();

  const add = (row: FileSelectionRow) => {
    // A side-split surface lists one file twice (once per side) on purpose, so
    // dedup keys carry the side; a whole-file surface dedups by path alone.
    const dedupKey = row.side ? `${row.side}:${row.path}` : row.path;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);
    paths.push(row.path);
    if (row.status.embedded) {
      embeddedPaths.push(row.path);
      return;
    }
    const staged = row.side ? row.side === "staged" : isStaged(row.status);
    const unstaged = row.side ? row.side === "unstaged" : isUnstaged(row.status);
    if (staged) stagedPaths.push(row.path);
    if (unstaged) unstagedPaths.push(row.path);
    // Untracked means "git holds no copy", which is only ever a worktree-side
    // fact — discarding one deletes it, so the confirm has to name it.
    if (unstaged && isUntracked(row.status)) untrackedPaths.push(row.path);
  };

  for (const key of keys) {
    const row = source.rowFor(key);
    if (row) {
      add(row);
      continue;
    }
    for (const child of source.rowsUnder(key)) add(child);
  }

  return { stagedPaths, unstagedPaths, paths, embeddedPaths, untrackedPaths };
}

// `dir:` keeps folder keys out of the file key space, so nothing can mistake a
// directory for a file with an unlucky name. Folder is tested FIRST: a file
// literally named `dir:x` would otherwise be ambiguous, and reading it as a
// folder (which finds nothing) is the safe end of that ambiguity.
const SIDED_FOLDER_KEY = /^(staged|unstaged):dir:(.*)$/;
const SIDED_FILE_KEY = /^(staged|unstaged):(.*)$/;

/** Selection key for a file row on one side of a side-split surface. */
export function sidedFileKey(side: FileSide, path: string): string {
  return `${side}:${path}`;
}

/** Selection key for a folder row on one side of a side-split surface. */
export function sidedFolderKey(side: FileSide, dirPath: string): string {
  return `${side}:dir:${dirPath}`;
}

/**
 * Source for the `side:path` / `side:dir:path` key space — two pre-split row
 * lists, one per section. A folder key only ever expands within its own
 * section, so staging a folder in CHANGES cannot reach the STAGED rows below.
 */
export function sidedSelectionSource(
  staged: readonly FileSelectionRow[],
  unstaged: readonly FileSelectionRow[],
): FileSelectionSource {
  const rowsOn = (side: FileSide) => (side === "staged" ? staged : unstaged);
  return {
    rowFor(key) {
      if (SIDED_FOLDER_KEY.test(key)) return undefined;
      const m = SIDED_FILE_KEY.exec(key);
      if (!m) return undefined;
      return rowsOn(m[1] as FileSide).find((r) => r.path === m[2]);
    },
    rowsUnder(key) {
      const m = SIDED_FOLDER_KEY.exec(key);
      if (!m) return [];
      const prefix = `${m[2]}/`;
      return rowsOn(m[1] as FileSide).filter((r) => r.path.startsWith(prefix));
    },
  };
}

/**
 * Source for the PGFileTree `/a/b` key space over one tree.
 *
 * `descendants` is the tree's own source set, so a folder expands to exactly
 * the rows that tree shows (a filter narrowing the tree narrows the batch too).
 * `lookupLists` are searched in order for a file key — the repo browser passes
 * `status` then `allFiles`, so an unmodified file still resolves in all-files
 * mode even though it carries no stage/unstage action.
 */
export function treeSelectionSource(
  descendants: readonly FileStatus[],
  ...lookupLists: readonly (readonly FileStatus[])[]
): FileSelectionSource {
  return {
    rowFor(key) {
      const status = findStatusByTreeKey(key, ...lookupLists);
      return status ? { path: status.path, status } : undefined;
    },
    rowsUnder(key) {
      const prefix = `${treeKeyToPath(key)}/`;
      return descendants
        .filter((s) => s.path.startsWith(prefix))
        .map((s) => ({ path: s.path, status: s }));
    },
  };
}
