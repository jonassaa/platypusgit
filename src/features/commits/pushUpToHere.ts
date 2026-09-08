import { pgConfirm } from "@/design";
import { aheadBehind } from "@/lib/tauri";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { currentBranch } from "@/lib/derive";
// The one resolver for "which remote does this upstream name?" — it picks the
// LONGEST matching remote name, which matters when one remote's name is a
// prefix of another's.
import { remoteOfUpstream } from "@/features/branches/fastForward";

/** What "push up to here" needs to know, resolved from the branch's upstream. */
export interface PushTarget {
  remote: string;
  /** The branch NAME on the remote, without the remote prefix. */
  branch: string;
  /** `origin/main`, for saying where things are going. */
  upstream: string;
}

/**
 * Where a partial push would go: the current branch's upstream, split.
 *
 * `null` when the branch tracks nothing — there is no destination to infer, and
 * guessing `origin/<branch>` would publish to a remote the user never chose.
 * The menu disables the entry and says so.
 */
export function pushTarget(): PushTarget | null {
  const s = useRepoStore.getState();
  const branch = currentBranch(s.branches);
  const upstream = branch?.upstream ?? null;
  if (!upstream) return null;
  const remote = remoteOfUpstream(upstream, s.remotes);
  if (!remote) return null;
  // Strip only the leading `<remote>/`: a branch may itself contain slashes
  // (`release/2026/09`), so splitting on every `/` would truncate it.
  const prefix = `${remote}/`;
  const name = upstream.startsWith(prefix) ? upstream.slice(prefix.length) : upstream;
  if (!name) return null;
  return { remote, branch: name, upstream };
}

/**
 * Push history up to one commit, leaving the rest of the branch unpublished.
 *
 * The confirm names the REAL effect — "3 of your 7 commits" — because the
 * entry's own label cannot: how much of the branch this covers is the whole
 * question, and a user who reads "push all up to here" as "push everything"
 * has published work they meant to hold back.
 *
 * Fast-forward only. No force is offered anywhere on this path, so a push that
 * would discard remote commits is refused by the remote and surfaces in the
 * error banner like any other network failure.
 */
export async function pushUpToHere(oid: string): Promise<void> {
  const repo = useRepoStore.getState().current;
  const target = pushTarget();
  if (!repo || !target) return;

  const counts = await commitCounts(repo.id, oid, target.upstream);
  if (
    !(await pgConfirm({
      title: `Push up to ${oid.slice(0, 7)}?`,
      body: counts
        ? `${describe(counts.upTo, counts.total)} to ${target.upstream}. The rest of your branch stays local.`
        : `Pushes history up to this commit to ${target.upstream}. The rest of your branch stays local.`,
      confirmLabel: "Push",
    }))
  )
    return;

  await useRepoStore.getState().pushCommit(target.remote, oid, target.branch);
}

/**
 * How many commits this push would publish, and how many the branch has.
 *
 * Both are asked as `ahead` against the upstream — "on b, not on a" — so the
 * pair describes the same question at two points. `null` when either side
 * cannot be resolved: the confirm then omits the numbers rather than inventing
 * them, because a wrong count here is worse than no count.
 */
async function commitCounts(
  repoId: string,
  oid: string,
  upstream: string,
): Promise<{ upTo: number; total: number } | null> {
  try {
    const [atCommit, atHead] = await Promise.all([
      aheadBehind(repoId, upstream, oid),
      aheadBehind(repoId, upstream, "HEAD"),
    ]);
    return { upTo: atCommit.ahead, total: atHead.ahead };
  } catch {
    return null;
  }
}

function describe(upTo: number, total: number): string {
  const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;
  if (upTo === total) return `Pushes all ${commits(total)}`;
  return `Pushes ${upTo} of your ${commits(total)}`;
}
