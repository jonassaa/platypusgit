import type { HeadInfo } from "@/lib/types";

/** How many hex characters of a full oid the title shows (#217). Matches the
 *  short-oid length used elsewhere in the app (`shortOid` on `CommitInfo`). */
const SHORT_OID_LEN = 7;

/**
 * The OS window title for the active repository (#217).
 *
 * Pure so the effect that calls `setTitle` carries no fallback logic of its
 * own — the four cases below are exactly the ones a window switcher, dock, or
 * Mission Control needs to tell repositories apart:
 *
 *   - No repo open              → "PlatypusGit"
 *   - On a branch                → "myrepo — main — PlatypusGit"
 *   - Detached HEAD               → "myrepo — a1b2c3d — PlatypusGit"
 *   - Unborn branch (no commits) → "myrepo — PlatypusGit"
 *
 * The repo name comes first and the app name last: window switchers and
 * taskbar tooltips truncate from the right, so the part that distinguishes
 * windows has to lead.
 */
export function windowTitleFor(
  repoLabel: string | null,
  head: HeadInfo | null,
): string {
  if (!repoLabel) return "PlatypusGit";
  const branch = head?.branch ?? (head?.headOid ? head.headOid.slice(0, SHORT_OID_LEN) : null);
  return branch ? `${repoLabel} — ${branch} — PlatypusGit` : `${repoLabel} — PlatypusGit`;
}
