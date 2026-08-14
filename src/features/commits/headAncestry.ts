import type { BranchInfo, CommitInfo } from "@/lib/types";
import { currentBranch } from "@/lib/derive";

/**
 * The subsequence of a loaded log that is actually reachable from HEAD, newest
 * first (input order preserved).
 *
 * Every rebase operation is defined over HEAD's ancestry: `buildRebasePlan`
 * takes "everything newer than this base" as its todo list, and
 * `planCommitSelection` calls a selection contiguous when nothing sits between
 * its ends. Both are only true if the list they read IS HEAD's ancestry.
 *
 * History's log walk covers every branch by default, so the list it hands
 * around also holds commits HEAD cannot reach. Feeding those to a plan replays
 * a foreign branch's commit onto the current one — a squash that should collapse
 * two commits instead added a third (caught by rebase.e2e.ts).
 *
 * Walks ALL parents, not just the first: a merge's second parent and everything
 * under it is genuine HEAD ancestry, and dropping it would make a selection
 * spanning a merge look non-contiguous.
 *
 * With no resolvable tip (detached HEAD, no branches loaded yet) the list is
 * returned untouched — the callers' own base/contiguity checks still gate them,
 * and silently emptying the log would disable the menus altogether.
 */
export function headAncestryLog(
  commits: CommitInfo[],
  tipOid: string | null | undefined,
): CommitInfo[] {
  if (!tipOid) return commits;
  const byOid = new Map(commits.map((c) => [c.oid, c]));
  if (!byOid.has(tipOid)) return commits;

  const reachable = new Set<string>();
  const stack = [tipOid];
  while (stack.length > 0) {
    const oid = stack.pop()!;
    if (reachable.has(oid)) continue;
    reachable.add(oid);
    // Parents outside the loaded window simply end the walk there.
    for (const p of byOid.get(oid)?.parents ?? []) {
      if (!reachable.has(p) && byOid.has(p)) stack.push(p);
    }
  }
  return commits.filter((c) => reachable.has(c.oid));
}

/** `headAncestryLog` for the store's shape: resolves the tip from `branches`. */
export function headAncestryOf(
  commits: CommitInfo[],
  branches: BranchInfo[],
): CommitInfo[] {
  return headAncestryLog(commits, currentBranch(branches)?.tip ?? null);
}
