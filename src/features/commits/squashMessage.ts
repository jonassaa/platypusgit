import type { CommitInfo } from "@/lib/types";
import { fullCommitMessage } from "./commitMessageText";

/**
 * Default message for a squash: every squashed commit's own message, oldest
 * first, blank-line separated — the same starting point `git rebase -i` hands
 * you in the editor, minus the comment lines. The user edits it in the prompt.
 *
 * `oids` is expected oldest→newest (what `planCommitSelection` returns). Unknown
 * oids are skipped rather than rendered as blanks: the log window may not hold
 * every selected commit's body.
 */
export function combinedSquashMessage(
  oids: readonly string[],
  byOid: ReadonlyMap<string, CommitInfo>,
): string {
  const parts: string[] = [];
  for (const oid of oids) {
    const c = byOid.get(oid);
    if (!c) continue;
    parts.push(fullCommitMessage(c));
  }
  return parts.join("\n\n");
}
