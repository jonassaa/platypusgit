import { pgFlash } from "@/design";
import { buildRebasePlan } from "./buildRebasePlan";
import { runRebasePlanNow } from "./runRebasePlan";
import { confirmRewrite, type RewriteCtx } from "./rewriteWarning";

/**
 * Remove one commit from history, replaying everything after it.
 *
 * Danger-confirmed, and the confirm names the alternative: unlike a revert,
 * nothing afterwards records that this commit ever existed. That is the whole
 * difference between the two entries, and it is not obvious from either label.
 */
export async function dropCommit(
  target: { oid: string },
  ctx: RewriteCtx,
): Promise<void> {
  const self = ctx.commits.find((c) => c.oid === target.oid);
  const baseOid = self?.parents[0] ?? null;
  // No parent means a root commit: there is no base to replay onto.
  if (!self || !baseOid) return;

  if (
    !(await confirmRewrite({
      title: `Drop ${target.oid.slice(0, 7)}?`,
      body: `"${self.summary}" is removed from history and every commit after it is replayed with a new id. Nothing records that it existed — use Revert instead to undo its changes with a new commit.`,
      confirmLabel: "Drop",
      danger: true,
      repoId: ctx.repoId,
      oid: target.oid,
      upstream: ctx.upstream,
    }))
  )
    return;

  const plan = buildRebasePlan(ctx.commits, baseOid, {
    kind: "drop",
    targetOid: target.oid,
  });
  if (!plan) return;
  const outcome = await runRebasePlanNow(plan);
  if (outcome === "done") pgFlash("commit dropped");
  else if (outcome === "paused") pgFlash("drop paused — see the Conflicts screen");
}
