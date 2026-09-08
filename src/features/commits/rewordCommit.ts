import { pgFlash, pgPrompt } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { buildRebasePlan } from "./buildRebasePlan";
import { fullCommitMessage } from "./commitMessageText";
import { runRebasePlanNow } from "./runRebasePlan";
import { confirmRewrite, type RewriteCtx } from "./rewriteWarning";

/**
 * Edit one commit's message.
 *
 * TWO paths, and the split is not an optimisation:
 *
 * - **HEAD** gets a message-only amend. The rebase engine refuses a dirty
 *   worktree, and rewording the commit you are sitting on — usually while you
 *   have uncommitted work — is by far the most common reword. Nothing is
 *   replayed, so no other commit changes id.
 * - **An older commit** gets a one-target `Reword` plan through the rebase
 *   engine, which is what already runs squash and fixup from this menu.
 *
 * The prompt is the same surface squash already uses. It does NOT open a second
 * commit-message composer beside `features/commits/message/` — that surface owns
 * composing a NEW commit's message, with its co-authors and trailers; this edits
 * one existing message in place.
 */
export async function rewordCommit(
  target: { oid: string },
  ctx: RewriteCtx,
): Promise<void> {
  const self = ctx.commits.find((c) => c.oid === target.oid);
  if (!self) return;

  const short = target.oid.slice(0, 7);
  const existing = fullCommitMessage(self);
  const next = await pgPrompt({
    title: "Edit commit message",
    body: `Rewriting ${short}.`,
    initialValue: existing,
    confirmLabel: "Save",
    requireValue: true,
    multiline: 8,
  });
  if (next === null) return;

  // An unchanged message must NOT rewrite the commit. Every descendant would
  // get a new id for nothing, and on a published commit it would demand a
  // force-push for nothing.
  if (next === existing) return;

  const isHead = ctx.headOid === target.oid;
  const baseOid = self.parents[0] ?? null;

  if (
    !(await confirmRewrite({
      title: `Reword ${short}?`,
      body: isHead
        ? "The commit keeps its changes, author and date; only the message and the commit id change."
        : "Every commit after this one is replayed, so they all get new ids.",
      confirmLabel: "Reword",
      repoId: ctx.repoId,
      oid: target.oid,
      upstream: ctx.upstream,
    }))
  )
    return;

  if (isHead) {
    if (await useRepoStore.getState().amendMessage(target.oid, next)) {
      pgFlash("message updated");
    }
    return;
  }

  // A root commit cannot be reworded through a rebase — there is no base to
  // replay onto. The menu disables that case; this is the guard for any other
  // caller.
  if (!baseOid) return;
  const plan = buildRebasePlan(ctx.commits, baseOid, {
    kind: "reword",
    targetOid: target.oid,
    message: next,
  });
  if (!plan) return;
  const outcome = await runRebasePlanNow(plan);
  if (outcome === "done") pgFlash("message updated");
  else if (outcome === "paused") pgFlash("reword paused — see the Conflicts screen");
}
