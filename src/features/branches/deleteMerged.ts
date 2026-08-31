// "Delete merged branches in this folder" (#244).
//
// A folder row's one destructive action, and the operation a flat list of forty
// branches makes tedious enough that nobody does it. Split the way
// `fastForward.ts` is: the decisions are pure and tested here, the screen owns
// the confirm and the store owns the deletes.
//
// "Merged" means git's own definition — `git branch --merged`, i.e. contained
// in HEAD — rather than "merged into its upstream" or "merged into the default
// branch". It is the definition the CLI would give the same answer for, and the
// one the confirm can state in a single line.

import { aheadBehind } from "@/lib/tauri";
import type { BranchInfo } from "@/lib/types";
import { branchesInFolder } from "./branchTree";

/**
 * The branches in `folderPath` a bulk delete may even CONSIDER, before anything
 * has been asked about merge state. Pure.
 *
 * Remotes are out: deleting one is a push, and a menu click must not reach
 * across the network. HEAD is out: git refuses, and offering it is a lie. The
 * default branch is out even when it sits in a folder — it is contained in HEAD
 * for half of a repository's life, so "merged" would happily delete `main`.
 */
export function deleteMergedCandidates(
  branches: readonly BranchInfo[],
  folderPath: string,
): BranchInfo[] {
  return branchesInFolder(branches, folderPath).filter(
    (b) => !b.isRemote && !b.isHead && !b.isDefault && b.tip !== null,
  );
}

/**
 * Which candidates are fully contained in `base` — `ahead` counts what the
 * branch has and the base does not, so zero is "merged".
 *
 * Sequential on purpose: the backend serializes per-repository work behind one
 * mutex, so firing forty of these at once only queues them while making a
 * cancel meaningless. A branch we cannot ask about is reported UNMERGED — the
 * safe direction, and one unreadable ref does not abandon the other thirty-nine.
 */
export async function findMergedBranches(
  repoId: string,
  base: string,
  candidates: readonly BranchInfo[],
): Promise<BranchInfo[]> {
  const merged: BranchInfo[] = [];
  for (const branch of candidates) {
    try {
      const rel = await aheadBehind(repoId, base, branch.name);
      if (rel.ahead === 0) merged.push(branch);
    } catch {
      // Unreadable ref → not offered for deletion.
    }
  }
  return merged;
}

/**
 * One line describing what a bulk delete did.
 *
 * The failures lead the interesting half and are never dropped: a partial
 * delete must not read as success. One name is named, several are counted —
 * a toast is one line and eight branch names is not.
 */
export function summarizeDeleteMerged(
  deleted: readonly string[],
  failed: readonly string[],
): string {
  const parts: string[] = [];
  if (deleted.length === 1) parts.push(`Deleted ${deleted[0]}`);
  else if (deleted.length > 1) parts.push(`Deleted ${deleted.length} branches`);
  if (failed.length === 1) parts.push(`${failed[0]} could not be deleted`);
  else if (failed.length > 1)
    parts.push(`${failed.length} branches could not be deleted`);
  return parts.length ? parts.join(" · ") : "No branches were deleted";
}
