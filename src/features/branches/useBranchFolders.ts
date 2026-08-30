// Which branch folders a repository has collapsed (#244), persisted like the
// other per-surface view preferences (`useRebaseMergeMode`): localStorage,
// best-effort, never fatal.
//
// NOT in `useRepoStore`. That store holds exactly one repository's live git
// state and every field of it has to join `RepoSlice`; this is a view
// preference that must OUTLIVE the tab, so it is keyed by repository path
// here and re-read whenever the active repository changes.
//
// The stored value is the set of COLLAPSED folders, so the default is expanded:
// a folder that appears after a fetch shows up without anyone having asked, and
// a repository the user expanded again leaves no entry behind.

import React from "react";

/** One key for every repository's state — see `useForgeStore`'s host map. */
export const BRANCH_FOLDERS_KEY = "pg-branch-folders-v1";

type Store = Record<string, string[]>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(BRANCH_FOLDERS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

/** The folders `repoPath` has collapsed. Empty for an unknown or absent repo. */
export function readCollapsedFolders(repoPath: string | null): Set<string> {
  if (!repoPath) return new Set();
  const entry = readStore()[repoPath];
  if (!Array.isArray(entry)) return new Set();
  return new Set(entry.filter((p): p is string => typeof p === "string"));
}

/** Persist `collapsed` for `repoPath`, pruning the entry when it is empty. */
export function writeCollapsedFolders(
  repoPath: string | null,
  collapsed: ReadonlySet<string>,
): void {
  if (!repoPath) return;
  try {
    const store = readStore();
    if (collapsed.size === 0) delete store[repoPath];
    else store[repoPath] = [...collapsed];
    if (Object.keys(store).length === 0) {
      localStorage.removeItem(BRANCH_FOLDERS_KEY);
      return;
    }
    localStorage.setItem(BRANCH_FOLDERS_KEY, JSON.stringify(store));
  } catch {
    // non-fatal — the session just won't remember the folds
  }
}

export interface BranchFolders {
  collapsed: ReadonlySet<string>;
  toggle: (path: string) => void;
  /** Collapse exactly these folders, leaving the rest alone. */
  collapse: (paths: readonly string[]) => void;
  /** Expand exactly these folders, leaving the rest alone. */
  expand: (paths: readonly string[]) => void;
}

export function useBranchFolders(repoPath: string | null): BranchFolders {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() =>
    readCollapsedFolders(repoPath),
  );

  // Re-read on every tab switch. Without this the outgoing repository's folds
  // would be applied to the incoming one — and then written back under ITS
  // path on the next click.
  React.useEffect(() => {
    setCollapsed(readCollapsedFolders(repoPath));
  }, [repoPath]);

  // Side effects stay OUT of the state updater: these are single user
  // gestures, so deriving the next set from the rendered one is safe, and a
  // localStorage write inside an updater would run twice under StrictMode.
  const apply = React.useCallback(
    (next: Set<string>) => {
      setCollapsed(next);
      writeCollapsedFolders(repoPath, next);
    },
    [repoPath],
  );

  const toggle = React.useCallback(
    (path: string) => {
      const next = new Set(collapsed);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      apply(next);
    },
    [collapsed, apply],
  );

  const collapse = React.useCallback(
    (paths: readonly string[]) => {
      const next = new Set(collapsed);
      for (const p of paths) next.add(p);
      apply(next);
    },
    [collapsed, apply],
  );

  const expand = React.useCallback(
    (paths: readonly string[]) => {
      const next = new Set(collapsed);
      for (const p of paths) next.delete(p);
      apply(next);
    },
    [collapsed, apply],
  );

  return { collapsed, toggle, collapse, expand };
}
