// Flatten ⇄ preserve for merge commits in a rebase plan, persisted like the
// other per-surface view preferences: localStorage, best-effort, never fatal.
//
// "flatten" is the default because it is git's own (`git rebase -i` drops merge
// commits and linearises); "preserve" is the `--rebase-merges` equivalent and
// carries costs the Rebase screen states up front.

import React from "react";

export type RebaseMergeMode = "flatten" | "preserve";

const STORAGE_KEY = "pg-rebase-merge-mode";

function read(): RebaseMergeMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "preserve" ? "preserve" : "flatten";
  } catch {
    return "flatten";
  }
}

export function useRebaseMergeMode(): [RebaseMergeMode, (m: RebaseMergeMode) => void] {
  const [mode, setMode] = React.useState<RebaseMergeMode>(read);
  const update = React.useCallback((m: RebaseMergeMode) => {
    setMode(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      // non-fatal — the session just won't remember the choice
    }
  }, []);
  return [mode, update];
}
