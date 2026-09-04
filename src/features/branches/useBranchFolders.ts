// Which branch folders a repository has collapsed (#244), persisted like the
// other per-surface view preferences (`useRebaseMergeMode`): localStorage,
// best-effort, never fatal.
//
// NOT in `useRepoStore`. That store holds exactly one repository's live git
// state and every field of it has to join `RepoSlice`; this is a view
// preference that must OUTLIVE the tab, so it is keyed by repository path here
// and selected by the open repository on read. It IS a zustand store rather
// than per-hook state, because two surfaces render the tree at once — see
// `useFoldStore` below.
//
// The stored value is the set of COLLAPSED folders, so the default is expanded:
// a folder that appears after a fetch shows up without anyone having asked, and
// a repository the user expanded again leaves no entry behind.

import React from "react";
import { create } from "zustand";

/** One key for every repository's state — see `useForgeStore`'s host map. */
export const BRANCH_FOLDERS_KEY = "pg-branch-folders-v1";

type Store = Record<string, string[]>;

const EMPTY: string[] = [];

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

/**
 * The folders `repoPath` has collapsed, read straight off disk. Empty for an
 * unknown or absent repository.
 *
 * The live set comes from the store below; this is the pure reader the storage
 * tests pin the parse hardening through — a corrupt or hand-edited payload has
 * to degrade to "nothing collapsed", never to a screen that throws on mount.
 */
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

/**
 * The live fold map, shared by every surface that renders the tree.
 *
 * A STORE and not per-hook `useState`, for the reason `useBranchPins` is one:
 * two consumers are mounted at once — the Branches screen and the titlebar
 * picker (#244) — and with private copies the last one to write would silently
 * drop the other's folds. Keying by repository path rather than tracking a
 * "current" repository is what keeps a tab switch from applying one
 * repository's folds to another's branches.
 */
const useFoldStore = create<{ byRepo: Store }>(() => ({ byRepo: readStore() }));

/** Re-read localStorage. Only a fresh app start needs this; tests use it. */
export function reloadCollapsedFolders(): void {
  useFoldStore.setState({ byRepo: readStore() });
}

export function useBranchFolders(repoPath: string | null): BranchFolders {
  // Subscribes to this repository's stored ARRAY, so the memoized Set is
  // rebuilt only when a fold actually changes — `Branches.tsx` memoizes its
  // whole row list on the reference.
  const entry = useFoldStore((s) => (repoPath ? s.byRepo[repoPath] : undefined));
  const collapsed = React.useMemo<ReadonlySet<string>>(
    () => new Set(entry ?? EMPTY),
    [entry],
  );

  // Every mutation reads the set out of the STORE, never out of the render
  // that produced the callback: a fold can be applied after an await (the
  // Branches screen opens the destination folder once a move's rename has
  // landed), and the rendered set may be several folds old by then.
  //
  // The in-memory map is the truth and the write is best-effort: a browser that
  // refuses localStorage still folds correctly for the session, it just won't
  // remember. `writeCollapsedFolders` keeps owning the stored SHAPE.
  const mutate = React.useCallback(
    (fn: (next: Set<string>) => void) => {
      if (!repoPath) return;
      const byRepo = { ...useFoldStore.getState().byRepo };
      const next = new Set(byRepo[repoPath] ?? EMPTY);
      fn(next);
      if (next.size === 0) delete byRepo[repoPath];
      else byRepo[repoPath] = [...next];
      useFoldStore.setState({ byRepo });
      writeCollapsedFolders(repoPath, next);
    },
    [repoPath],
  );

  const toggle = React.useCallback(
    (path: string) =>
      mutate((next) => {
        if (next.has(path)) next.delete(path);
        else next.add(path);
      }),
    [mutate],
  );

  const collapse = React.useCallback(
    (paths: readonly string[]) =>
      mutate((next) => {
        for (const p of paths) next.add(p);
      }),
    [mutate],
  );

  const expand = React.useCallback(
    (paths: readonly string[]) =>
      mutate((next) => {
        for (const p of paths) next.delete(p);
      }),
    [mutate],
  );

  return { collapsed, toggle, collapse, expand };
}
