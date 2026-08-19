import type { CommitInfo, RebaseStep } from "@/lib/types";

/**
 * Build a topology-preserving plan for `range` — the commits between a base and
 * HEAD, newest-first, exactly as `commitsSince` returns them.
 *
 * git expresses topology in its todo file with `label` / `reset` / `merge
 * <label>` because a human edits that file. A generated plan does not need the
 * naming layer: every step names the ORIGINAL commit it must be applied onto,
 * and the engine resolves that through its rewritten map. `onto: null` means
 * "onto the previous step's result", so a linear range produces exactly the plan
 * it did before this existed.
 *
 * Step order is the reverse of the log walk, which is TIME | TOPOLOGICAL —
 * parents always precede children. Grouping does not affect correctness, because
 * each step carries its own base.
 */
export function buildPreservePlan(range: CommitInfo[]): RebaseStep[] {
  const oldestFirst = [...range].reverse();

  return oldestFirst.map((c, i): RebaseStep => {
    const firstParent = c.parents[0] ?? null;
    const previousOid = i > 0 ? oldestFirst[i - 1].oid : null;
    const isMerge = c.parents.length > 1;

    // Only name a base when it is not where the replay already sits. Naming it
    // unconditionally would work, but it would make every step a reset and hide
    // the linear default from anyone reading the plan. The FIRST step stays null
    // here on purpose: its base is the range's base, which the Rebase screen
    // attaches with `withPlanBase` at submit (186) — and which `rebase_start`
    // derives from the first parent when nothing names it.
    const onto =
      i > 0 && firstParent && firstParent !== previousOid ? firstParent : null;

    return {
      oid: c.oid,
      action: isMerge ? "Merge" : "Pick",
      message: null,
      onto,
      mergeParents: isMerge ? c.parents.slice(1) : [],
    };
  });
}
