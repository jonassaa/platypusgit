// The single branch ordering (#135). Pure — see orderBranches.test.ts.
//
// Every branch list in the app goes through this: the titlebar picker, the
// Branches screen, and the palette's branch rows. One helper is the point; a
// second ordering somewhere else is how the three drifted apart before.

import type { BranchInfo } from "@/lib/types";

/** Shared empty set, so the no-pins path allocates nothing. */
const NO_PINS: ReadonlySet<string> = new Set();

/**
 * USER PINS first, then the default branch, then newest tip first, then name
 * ascending.
 *
 * `isHead` is deliberately NOT read: the current branch is already accent-
 * coloured and badged, it is the one branch the picker exists to leave, and
 * pinning it would push the actual default down for no navigational gain.
 *
 * Pins rank ABOVE the default branch (#238). Two reasons, and the second is the
 * load-bearing one:
 *
 *  - #135's pin is a DEFAULT — the app guessing what you want on top. A user
 *    pin is an instruction. An instruction that loses to a guess is not a pin,
 *    and the default branch is the one row nobody has trouble finding anyway.
 *  - The Branches screen hoists pinned branches OUT of the folder tree, above
 *    it. Ranking pins second here would put the comparator (default first) and
 *    that screen (pins first) in permanent disagreement about the same list.
 *
 * With nothing pinned this is exactly #135's order, which is why its tests are
 * untouched — and pinning the default branch alone still changes nothing.
 *
 * A pin matches `name` exactly, so pinning `feat/foo` does not also pin
 * `origin/feat/foo` — they are two rows in two sections, and the user pinned
 * one of them.
 */
export function compareBranches(
  a: BranchInfo,
  b: BranchInfo,
  pins: ReadonlySet<string> = NO_PINS,
): number {
  const aPinned = pins.has(a.name);
  const bPinned = pins.has(b.name);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
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
export function orderBranches<T extends BranchInfo>(
  rows: readonly T[],
  pins: ReadonlySet<string> = NO_PINS,
): T[] {
  return [...rows].sort((a, b) => compareBranches(a, b, pins));
}

/**
 * Order a MIXED list into one flat array, locals ahead of remotes and ordered
 * within each group.
 *
 * The picker renders two labelled sections and the Branches screen splits by
 * view, so both get this grouping structurally. A surface that renders one
 * undivided list (the palette's branch steps) needs it done here instead —
 * otherwise `main` and `origin/main` are both `isDefault` and take rows 1-2,
 * and locals and remotes interleave by tip time below them.
 */
export function orderBranchesGrouped<T extends BranchInfo>(
  rows: readonly T[],
  pins: ReadonlySet<string> = NO_PINS,
): T[] {
  return [
    ...orderBranches(rows.filter((r) => !r.isRemote), pins),
    ...orderBranches(rows.filter((r) => r.isRemote), pins),
  ];
}
