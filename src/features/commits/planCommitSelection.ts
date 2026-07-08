import type { CommitInfo } from "@/lib/types";

/**
 * Ancestry facts about a multi-commit selection, computed against the *full*
 * log (`commits`, newest-first) rather than the filtered visible list — so
 * contiguity and the rebase base reflect real ancestry even when the History
 * view hides merges or filters commits. Drives the combined diff (base→newest),
 * the cherry-pick set (`oids`, oldest→newest), and squash-range gating
 * (`contiguous && !hasMerge && baseOid`).
 */
export interface CommitSelectionPlan {
  /** Selected commits present in the log, ordered oldest→newest. */
  oids: string[];
  /** Oldest (deepest ancestor) selected commit. */
  oldestOid: string;
  /** Newest selected commit. */
  newestOid: string;
  /** Parent of the oldest selected commit (`commits[oldestIdx+1]`), or null
   *  when it's the root or its parent isn't loaded. */
  baseOid: string | null;
  /** Selected indices form one consecutive run in the log. */
  contiguous: boolean;
  /** Any selected commit is a merge (>1 parent). */
  hasMerge: boolean;
}

export function planCommitSelection(
  commits: CommitInfo[],
  selectedOids: Iterable<string>,
): CommitSelectionPlan | null {
  const set = new Set(selectedOids);
  // Indices into the newest-first log; larger index = older commit.
  const indices: number[] = [];
  commits.forEach((c, i) => {
    if (set.has(c.oid)) indices.push(i);
  });
  if (indices.length === 0) return null;

  const min = Math.min(...indices); // newest
  const max = Math.max(...indices); // oldest
  const oids = indices
    .slice()
    .sort((a, b) => b - a) // oldest→newest
    .map((i) => commits[i].oid);

  return {
    oids,
    oldestOid: commits[max].oid,
    newestOid: commits[min].oid,
    baseOid: commits[max + 1]?.oid ?? null,
    contiguous: max - min + 1 === indices.length,
    hasMerge: indices.some((i) => commits[i].parents.length > 1),
  };
}
