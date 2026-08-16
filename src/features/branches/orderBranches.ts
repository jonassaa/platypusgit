// The single branch ordering (#135). Pure — see orderBranches.test.ts.
//
// Every branch list in the app goes through this: the titlebar picker, the
// Branches screen, and the palette's branch rows. One helper is the point; a
// second ordering somewhere else is how the three drifted apart before.

import type { BranchInfo } from "@/lib/types";

/**
 * Default branch first, then newest tip first, then name ascending.
 *
 * `isHead` is deliberately NOT read: the current branch is already accent-
 * coloured and badged, it is the one branch the picker exists to leave, and
 * pinning it would push the actual default down for no navigational gain.
 */
export function compareBranches(a: BranchInfo, b: BranchInfo): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.tipTime !== b.tipTime) return b.tipTime - a.tipTime;
  // Plain comparison, not localeCompare: branches cut from one commit all share
  // a tip time, so this tiebreaker decides the visible order and must not
  // depend on the runtime's ICU data.
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return 0;
}

/**
 * Order a branch list. Copies first — `useRepoStore.branches` is store state
 * and must not be sorted in place.
 *
 * This only ever PERMUTES: same length, same rows, nothing added. Call sites
 * filter first and order second, so a query that excludes the default branch
 * keeps excluding it.
 */
export function orderBranches<T extends BranchInfo>(rows: readonly T[]): T[] {
  return [...rows].sort(compareBranches);
}
