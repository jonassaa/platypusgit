import type { BulkFastForward, FastForward } from "@/lib/types";

/**
 * The remote a branch's upstream lives on (#246).
 *
 * NOT `upstream.split("/")[0]`. A git remote name may itself contain a slash —
 * `git remote add team/fork …` is legal — and splitting on the first one turns
 * `team/fork/main` into a remote called `team`, which either does not exist or,
 * worse, is a different repository. Resolved against the repository's OWN remote
 * list instead, longest name first so `team/fork` beats a sibling `team`.
 *
 * The match must end on a segment boundary: `orig` is not a prefix of
 * `origin/main` in any sense that matters.
 *
 * The backend answers this question properly for the fast-forward path itself
 * (`GitBackend::fast_forward_remote` reads `branch.<name>.remote`); this is the
 * frontend's answer for the call that has to name a remote up front — the pull
 * a checked-out branch is routed to.
 */
export function remoteOfUpstream(
  upstream: string | null | undefined,
  remotes: readonly { name: string }[],
): string | null {
  if (!upstream) return null;
  const matches = remotes
    .filter((r) => upstream.startsWith(`${r.name}/`))
    .map((r) => r.name)
    .sort((a, b) => b.length - a.length);
  return matches[0] ?? null;
}

/**
 * One line describing what a bulk fast-forward did (#246).
 *
 * The branches that did NOT move lead the interesting half, so they are never
 * dropped: a diverged branch needs a merge or a rebase, and the branch you are
 * standing on needs a pull. One name is named; several are counted, because a
 * toast is one line and eight branch names is not.
 */
export function summarizeFastForward(report: BulkFastForward): string {
  const parts: string[] = [];
  const names = (list: readonly string[], verb: string) =>
    list.length === 1
      ? `${list[0]} ${verb}`
      : `${list.length} branches ${verb.replace(/^has /, "have ")}`;

  if (report.advanced.length === 1) {
    parts.push(`Fast-forwarded ${report.advanced[0].branch}`);
  } else if (report.advanced.length > 1) {
    parts.push(`Fast-forwarded ${report.advanced.length} branches`);
  }
  if (report.diverged.length) parts.push(names(report.diverged, "has diverged"));
  if (report.checkedOut.length) {
    parts.push(
      report.checkedOut.length === 1
        ? `${report.checkedOut[0]} is checked out — pull it`
        : `${report.checkedOut.length} branches are checked out — pull them`,
    );
  }
  return parts.length ? parts.join(" · ") : "All branches are up to date";
}

/**
 * One line describing what a single fast-forward did (#246).
 *
 * "Already up to date" is a real outcome, not silence: the action fetched
 * first, so the user cannot tell from the row whether anything happened.
 */
export function describeFastForward(ff: FastForward): string {
  return ff.moved
    ? `Fast-forwarded ${ff.branch} to ${ff.upstream}`
    : `${ff.branch} is already up to date`;
}
