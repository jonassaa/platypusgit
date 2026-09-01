import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { confirmStackedRefs, resolveUpdateRefs } from "./stackedRefs";
import type { RebaseStep } from "@/lib/types";

export type RebaseRunOutcome = "done" | "paused" | "failed";

/**
 * Run a rebase plan straight away instead of handing the user the plan builder.
 *
 * Squash/fixup from History are complete instructions — the user already picked
 * the commits and the message, so routing them to the Rebase screen to press
 * Start is a detour that also throws away where they were. `rebaseStart`
 * refreshes the repo, so the log repaints itself.
 *
 * Returns the outcome rather than announcing it: `pgFlash` lives in
 * `design/context-menu`, which is itself one of this function's callers, and
 * importing it back would close an import cycle.
 *
 * - "done"   — the rebase ran to completion.
 * - "paused" — it stopped (conflict, or an `edit` step); the Conflicts screen
 *              owns it from here. Still no navigation.
 * - "failed" — it errored; `rebaseStart` has already set the error banner.
 */
export async function runRebasePlanNow(plan: RebaseStep[]): Promise<RebaseRunOutcome> {
  const repo = useRepoStore.getState().current;
  if (!repo) return "failed";
  // "This will also move feat/b and feat/c" (#240), before anything runs. The
  // dialog is silent when nothing points into the range, which is the ordinary
  // case — a confirmation on every rebase would be trained away in a week.
  const ok = await confirmStackedRefs(
    repo.id,
    plan,
    resolveUpdateRefs(useSettingsStore.getState().rebaseUpdateRefs),
  );
  if (!ok) return "failed";
  const status = await useRepoStore.getState().rebaseStart(plan);
  if (!status) return "failed";
  return status.inProgress ? "paused" : "done";
}
