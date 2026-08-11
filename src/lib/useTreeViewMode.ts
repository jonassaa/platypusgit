// Tree ⇄ flat view mode for a file list, persisted per surface (#61 A6).
//
// Each list keeps its own preference — flat-with-full-paths reads faster for a
// small changeset, a tree for a large one, and the right answer differs
// between the repo browser and the commit screen. Same shape as the pane-width
// persistence: localStorage, best-effort, never fatal.

import React from "react";

export type TreeViewMode = "tree" | "flat";

function read(storageKey: string, fallback: TreeViewMode): TreeViewMode {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw === "tree" || raw === "flat" ? raw : fallback;
  } catch {
    return fallback;
  }
}

export function useTreeViewMode(
  storageKey: string,
  fallback: TreeViewMode = "tree",
): [TreeViewMode, (m: TreeViewMode) => void] {
  const [mode, setMode] = React.useState<TreeViewMode>(() =>
    read(storageKey, fallback),
  );
  const update = React.useCallback(
    (m: TreeViewMode) => {
      setMode(m);
      try {
        localStorage.setItem(storageKey, m);
      } catch {
        // non-fatal — the session just won't remember the choice
      }
    },
    [storageKey],
  );
  return [mode, update];
}
