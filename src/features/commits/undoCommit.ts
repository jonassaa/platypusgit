import { pgFlash } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { confirmRewrite, type RewriteCtx } from "./rewriteWarning";

/**
 * Undo the last commit, keeping its changes staged — `reset --soft HEAD^`.
 *
 * HEAD only, which is the only commit this means anything for: undoing an older
 * commit is a drop or a revert, and both have their own entry.
 *
 * It earns a named entry over the reset submenu because reaching it there means
 * right-clicking a DIFFERENT commit — the parent — and picking "Soft". This
 * names the intent instead of the mechanism.
 *
 * No new backend op: the reset already exists, and it is already undoable.
 */
export async function undoCommit(
  target: { oid: string },
  ctx: RewriteCtx,
): Promise<void> {
  if (ctx.headOid !== target.oid) return;
  const self = ctx.commits.find((c) => c.oid === target.oid);
  const parent = self?.parents[0] ?? null;
  // A root commit has no parent to reset to; unmaking it would mean an unborn
  // HEAD, which is not what this entry offers.
  if (!self || !parent) return;

  if (
    !(await confirmRewrite({
      title: `Undo ${target.oid.slice(0, 7)}?`,
      body: `"${self.summary}" stops being a commit. Its changes stay in your working tree, staged and ready to commit again.`,
      confirmLabel: "Undo commit",
      repoId: ctx.repoId,
      oid: target.oid,
      upstream: ctx.upstream,
    }))
  )
    return;

  await useRepoStore.getState().reset(parent, "Soft");
  pgFlash("commit undone — changes are staged");
}
