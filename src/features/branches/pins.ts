// Branch pins as the ACTIVE repository sees them (#238).
//
// Split from `useBranchPins` so that the storage module stays pure key/value
// and only this one knows which repository is open. Both consumers here are
// non-React — `design/context-menu.tsx` builds menu items and
// `features/palette/commands.ts` builds palette rows — which is the whole
// reason the pins live in a store rather than in the folds' React hook.

import type { ContextMenuItem } from "@/design/context-menu";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { pinnedIn, useBranchPins } from "./useBranchPins";

function activeRepoPath(): string | null {
  return useRepoStore.getState().current?.path ?? null;
}

/** The open repository's pins, as a set for the comparator. */
export function activePins(): ReadonlySet<string> {
  return new Set(pinnedIn(activeRepoPath()));
}

/** The Pin/Unpin entry shared by the local and the remote branch menus. */
export function pinItem(name: string): ContextMenuItem {
  const repoPath = activeRepoPath();
  const pinned = !!repoPath && pinnedIn(repoPath).includes(name);
  return {
    icon: "pin",
    label: pinned ? "Unpin" : "Pin to top",
    // No repository open means no per-repository set to write to. Shown
    // disabled rather than hidden, so the menu keeps a stable shape.
    disabled: !repoPath || !name,
    onClick: () => useBranchPins.getState().toggle(repoPath, name),
  };
}
