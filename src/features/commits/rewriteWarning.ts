import { pgConfirm } from "@/design";
import { aheadBehind } from "@/lib/tauri";
import type { CommitInfo } from "@/lib/types";

/**
 * Everything a rewrite flow reads, gathered by the CALLER.
 *
 * Shared vocabulary rather than any one flow's own type, so the menu's three
 * call sites are identical. Keeping the store reads at the call site — where
 * menu building already reads the store synchronously — is what lets the flows
 * be unit tested without a store.
 */
export interface RewriteCtx {
  /** HEAD's ancestry, newest first — what a rebase plan is defined over. */
  commits: CommitInfo[];
  repoId: string;
  /** The current branch's upstream, for the published-commit warning. */
  upstream: string | null;
  headOid: string | null;
}

/**
 * Is this commit already contained in the branch's upstream?
 *
 * `aheadBehind(repoId, a, b).behind` is "on `a`, not on `b`" (pinned by
 * `ref_compare.rs::ahead_behind_counts_a_diverged_pair_both_ways`), so zero
 * means the commit holds nothing the upstream is missing — it is published.
 * Getting that order backwards inverts the warning silently, which is why the
 * order has its own test.
 *
 * One IPC call, made from an `onClick` and never while building a menu: menu
 * building runs on every right-click and must stay synchronous.
 *
 * A branch that tracks nothing is not published and is not asked about. An
 * unresolvable upstream — a deleted remote branch, a stale config — answers
 * "false" rather than throwing: a warning is a courtesy, and failing to compute
 * one must never block the operation the user actually asked for.
 */
export async function isPublished(
  repoId: string,
  oid: string,
  upstream: string | null,
): Promise<boolean> {
  if (!upstream) return false;
  try {
    const ab = await aheadBehind(repoId, oid, upstream);
    return ab.behind === 0;
  } catch {
    return false;
  }
}

/** The sentence a rewrite confirm gains when the commit is already pushed. */
export function rewriteWarning(
  upstream: string | null,
  published: boolean,
): string | null {
  if (!upstream || !published) return null;
  return `This commit is already on ${upstream}. Rewriting it means your next push has to be forced.`;
}

/**
 * The one confirm every history-rewriting menu entry goes through, so all five
 * of them — reword, drop, undo, squash, fixup — say the same thing about a
 * published commit. Five entries that rewrite history splitting into two
 * behaviours is the inconsistency this shared helper exists to prevent.
 *
 * **No force-push is offered.** A network write behind a menu item that does not
 * mention pushing is a surprise, and force-with-lease is its own design
 * question.
 */
export async function confirmRewrite(opts: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  repoId: string;
  oid: string;
  upstream: string | null;
}): Promise<boolean> {
  const warning = rewriteWarning(
    opts.upstream,
    await isPublished(opts.repoId, opts.oid, opts.upstream),
  );
  return pgConfirm({
    title: opts.title,
    body: warning ? `${opts.body}\n\n${warning}` : opts.body,
    confirmLabel: opts.confirmLabel,
    danger: opts.danger,
  });
}
