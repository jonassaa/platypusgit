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
  /** First parent of the oldest selected commit, or null when it's the root. */
  baseOid: string | null;
  /** The selection is an unbroken first-parent chain (oldest→newest). */
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
  const oldestFirst = indices
    .slice()
    .sort((a, b) => b - a) // oldest→newest
    .map((i) => commits[i]);
  const oids = oldestFirst.map((c) => c.oid);
  const oldest = commits[max];

  // The base is the oldest selected commit's FIRST PARENT, looked up by oid. It
  // used to be `commits[max + 1]` — the next row in a graph-ordered log, which
  // on any non-linear history is frequently a side-branch commit rather than a
  // parent, so a rebase reset to the wrong base and silently dropped whatever
  // sat between.
  const baseOid = oldest.parents[0] ?? null;

  // Contiguity means "these commits form an unbroken first-parent chain", which
  // is what a range squash replays. Adjacent log rows are not enough: C and F
  // can be neighbours while belonging to different branches.
  const contiguous = oldestFirst.every(
    (c, i) => i === 0 || c.parents[0] === oldestFirst[i - 1].oid,
  );

  return {
    oids,
    oldestOid: oldest.oid,
    newestOid: commits[min].oid,
    baseOid,
    contiguous,
    hasMerge: indices.some((i) => commits[i].parents.length > 1),
  };
}
