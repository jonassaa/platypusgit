// "This will also move feat/b and feat/c" (#240).
//
// The issue is explicit that this is the valuable half of the feature: the flag
// alone is a silent behaviour change, and a rebase that quietly moves branches
// the user did not think about is worse than one that leaves them behind — at
// least the second is visible. So nothing starts until the consequence has been
// stated and agreed to.
//
// Pure message-building here, with the dialog in `confirmStackedRefs`, so what
// the sentence SAYS is testable without a dialog host.

import { pgConfirm } from "@/design";
import { stackedRefs } from "@/lib/tauri";
import type { RebaseStep, StackedRef, UpdateRefsMode } from "@/lib/types";

/**
 * Whether this run should move dependent refs.
 *
 * `"config"` defers to the repository's own `rebase.updateRefs`, which the
 * backend reads — expressed as `null` across the IPC boundary rather than as a
 * resolved boolean, so the app never has to guess and never has to keep its
 * answer in step with git's.
 */
export function resolveUpdateRefs(mode: UpdateRefsMode): boolean | null {
  switch (mode) {
    case "always":
      return true;
    case "never":
      return false;
    default:
      return null;
  }
}

/**
 * The sentence the confirmation leads with.
 *
 * Names every ref rather than counting them: "3 branches will move" is not
 * something anyone can check, and the whole point is that the user recognises
 * the names as their stack.
 */
export function describeStackedRefs(refs: readonly StackedRef[]): string {
  const names = refs.map((r) => r.short);
  if (names.length === 1) return `This will also move ${names[0]}.`;
  const last = names[names.length - 1];
  return `This will also move ${names.slice(0, -1).join(", ")} and ${last}.`;
}

/**
 * Ask before a rebase that will move other branches.
 *
 * Returns true when the rebase should proceed. Silent — and therefore true —
 * when nothing points into the range, which is the ordinary case: a
 * confirmation that appears on every rebase would be trained away in a week.
 *
 * A failed lookup also returns true rather than blocking the rebase. This is an
 * advisory read; refusing to rebase because we could not enumerate branches
 * would turn a missing warning into a broken feature.
 */
export async function confirmStackedRefs(
  repoId: string,
  plan: readonly RebaseStep[],
  updateRefs: boolean | null,
): Promise<boolean> {
  // `false` means the refs stay put, so there is nothing to warn about. `null`
  // still needs asking: the repository's config may well say yes.
  if (updateRefs === false) return true;

  let refs: StackedRef[];
  try {
    refs = await stackedRefs(repoId, plan.map((s) => s.oid));
  } catch {
    return true;
  }
  if (refs.length === 0) return true;

  return pgConfirm({
    title: "Move dependent branches too?",
    body:
      `${describeStackedRefs(refs)} They point at commits inside the range ` +
      `being replayed, so without this they would be left on the old commits. ` +
      `Any of them you have already pushed will need a force-push afterwards.`,
    confirmLabel: "Rebase",
  });
}
