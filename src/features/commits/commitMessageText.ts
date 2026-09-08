import type { CommitInfo } from "@/lib/types";

/**
 * One commit's message as editable text: `summary`, then its body after a blank
 * line. The same starting point `git rebase -i` hands you in an editor, minus
 * the comment lines.
 *
 * The single owner of that rendering — `combinedSquashMessage` calls it per
 * commit and the reword prompt calls it for one, so a change to how a message
 * is reassembled cannot land in one of those places only.
 *
 * A whitespace-only body is treated as absent rather than rendered as trailing
 * blanks: the value goes straight into a prompt the user then edits, and git's
 * own cleanup would strip them anyway.
 */
export function fullCommitMessage(
  commit: Pick<CommitInfo, "summary" | "body">,
): string {
  const body = commit.body?.trim();
  return body ? `${commit.summary}\n\n${body}` : commit.summary;
}
