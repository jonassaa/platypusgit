import type { CommitInfo } from "@/lib/types";

/**
 * The loaded commits that list `oid` among their parents — this commit's
 * children, newest first (input order preserved).
 *
 * **A commit can have several children** (a branch point), and a merge is a
 * child of BOTH its parents — so every parent slot is searched, not just the
 * first. Searching `parents[0]` alone would make a side branch look childless.
 *
 * **The answer is only as complete as the loaded log**, which is a PREFIX of
 * history (`s.commits`, `PAGE_SIZE = 500`). An empty result means "no child in
 * what is loaded", never "no child exists". Callers must say that: the menu
 * disables its entry with a label naming the loaded log as the reason, rather
 * than asserting something about the repository it cannot know.
 */
export function commitChildren(commits: CommitInfo[], oid: string): CommitInfo[] {
  if (!oid) return [];
  return commits.filter((c) => c.parents.includes(oid));
}
