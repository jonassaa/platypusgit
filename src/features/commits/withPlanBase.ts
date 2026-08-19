import type { RebaseStep } from "@/lib/types";

/**
 * Attach a run's base to a plan: `onto: baseOid` on the FIRST non-Drop step.
 *
 * `rebase_start` takes the run's base from exactly that step's `onto`, falling
 * back to its first parent when there is none (`libgit2.rs`). Naming the base
 * explicitly is what makes a plan `git rebase --onto <base>` — the whole reason a
 * diverged base works at all — and `rebase_plan::validate` accepts any existing
 * commit there, with no ancestry requirement.
 *
 * Call this at SUBMIT, never when the rows are built. Flatten mode lets the user
 * reorder the plan, and the base belongs to the plan's first step rather than to
 * the row that happened to be first when it was built: pinned at build time, a
 * row dragged out of first place would take the base with it and the run would
 * detach somewhere else entirely.
 *
 * `baseOid: null` means "nothing better than the engine's parent fallback is
 * known" (a root commit, or an oldest step outside the loaded log) and returns
 * the plan untouched. `baseOid` may be any revspec — an oid, a prefix, a branch
 * name — because both the validator and the engine `revparse_single` it.
 */
export function withPlanBase(
  steps: RebaseStep[],
  baseOid: string | null,
): RebaseStep[] {
  if (!baseOid) return steps;
  const first = steps.findIndex((s) => s.action !== "Drop");
  if (first < 0) return steps;
  return steps.map((s, i) => (i === first ? { ...s, onto: baseOid } : s));
}
