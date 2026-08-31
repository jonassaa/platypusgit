// The open repository's pins, as a memoized Set (#238) — the React side of
// `useBranchPins`, for the two surfaces that ARE components.
//
// Subscribes to the stored ARRAY, not to a derived Set: the store hands back
// the same array reference while the pins are unchanged, so the Set is rebuilt
// only when a pin is actually toggled. Selecting a fresh `new Set(...)` would
// fail zustand's identity check and re-render the picker on every store write.

import React from "react";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { useBranchPins } from "./useBranchPins";

export function usePinSet(): ReadonlySet<string> {
  const repoPath = useRepoStore((s) => s.current?.path ?? null);
  const names = useBranchPins((s) => (repoPath ? s.byRepo[repoPath] : undefined));
  return React.useMemo(() => new Set(names ?? []), [names]);
}
