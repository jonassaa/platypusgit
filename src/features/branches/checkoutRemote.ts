import { pgChoose, pgPrompt, type PGChooseOption } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { aheadBehind } from "@/lib/tauri";
import type { BranchInfo } from "@/lib/types";

/** `origin/feat/x` → `feat/x`. The remote prefix is the FIRST segment only. */
export function withoutRemotePrefix(name: string): string {
  const i = name.indexOf("/");
  return i >= 0 ? name.slice(i + 1) : name;
}

/**
 * How an existing local branch stands against the remote ref that was asked
 * for — NOT against its own upstream, which in the case this exists for is
 * typically nothing at all.
 */
export interface RemoteRelation {
  /** Commits the local branch has that the remote ref does not. */
  ahead: number;
  /** The mirror: commits on the remote ref that the local branch lacks. */
  behind: number;
  /** Unrelated histories — or the comparison could not be made at all. */
  unrelated: boolean;
}

/** What `pgChoose` is asked when the name is already taken. */
export interface ExistingBranchPrompt {
  title: string;
  body: string;
  choices: PGChooseOption[];
}

const plural = (n: number) => (n === 1 ? "commit" : "commits");

/** One sentence for where the local branch sits relative to the remote ref. */
function relationSentence(
  local: string,
  remote: string,
  rel: RemoteRelation,
): string {
  if (rel.unrelated) return `${local} shares no history with ${remote}.`;
  if (rel.ahead === 0 && rel.behind === 0)
    return `${local} is already at ${remote}.`;
  if (rel.ahead === 0)
    return `${local} is ${rel.behind} ${plural(rel.behind)} behind ${remote}.`;
  if (rel.behind === 0)
    return `${local} is ${rel.ahead} ${plural(rel.ahead)} ahead of ${remote}.`;
  return `${local} has ${rel.ahead} ${plural(rel.ahead)} ${remote} does not, and is ${rel.behind} behind it.`;
}

/** One sentence for what the local branch currently tracks. */
function trackingSentence(remote: string, upstream: string | null): string {
  if (upstream === remote) return `It already tracks ${remote}.`;
  if (upstream) return `It tracks ${upstream}.`;
  return "It tracks nothing.";
}

/** The half of the existing branch this dialog reads. */
export interface ExistingBranch {
  upstream: string | null;
  isHead: boolean;
}

/**
 * The dialog for "you asked for `origin/x`, but a local `x` already exists".
 *
 * PURE, so what the user is told — and which answers they are offered — is
 * testable without a repository. The flow below only renders it.
 *
 * The update offer is deliberately narrow. It appears only when the existing
 * branch is STRICTLY behind and the ref it would be advanced along is the one
 * the user named: fast-forwarding a branch that tracks something ELSE would
 * move it along a ref this dialog never mentioned, and a branch with commits
 * of its own cannot be fast-forwarded at all. Everything else gets the plain
 * checkout and keeps its commits.
 *
 * The collision can be the branch you are STANDING ON — you are on `feat`,
 * someone pushes, you right-click `origin/feat`. Offering to "check out feat"
 * there says nothing true, so the wording changes: the useful action on a
 * branch you are already on is to make it track the remote, or to catch it up.
 */
export function existingBranchPrompt(
  local: string,
  remote: string,
  existing: ExistingBranch,
  rel: RemoteRelation,
): ExistingBranchPrompt {
  const { upstream, isHead } = existing;
  const canUpdate =
    !rel.unrelated &&
    rel.behind > 0 &&
    rel.ahead === 0 &&
    (upstream === null || upstream === remote);

  const choices: PGChooseOption[] = [];
  if (canUpdate)
    choices.push({
      id: "update",
      label: isHead
        ? `Update ${local} to ${remote}`
        : `Check out and update to ${remote}`,
      primary: true,
    });
  choices.push({
    id: "checkout",
    label: isHead
      ? upstream === null
        ? `Track ${remote}`
        : `Stay on ${local}`
      : canUpdate
        ? `Check out ${local} as it is`
        : `Check out ${local}`,
    primary: !canUpdate,
  });
  choices.push({ id: "rename", label: "Use a different name…" });

  const where = isHead ? " You are on it." : "";
  return {
    title: isHead ? `Stay on ${local}?` : `Check out the existing ${local}?`,
    body: `A local branch named ${local} already exists.${where} ${relationSentence(
      local,
      remote,
      rel,
    )} ${trackingSentence(remote, upstream)}`,
    choices,
  };
}

/**
 * Where the local branch sits relative to the remote ref.
 *
 * Advisory: a failure degrades to "we cannot say" rather than blocking the
 * checkout the user asked for. `unrelated` then drops the update offer, which
 * is the conservative half of the dialog anyway.
 */
async function relationTo(
  repoId: string,
  remote: string,
  local: string,
): Promise<RemoteRelation> {
  try {
    // `aheadBehind(a, b)` reads FROM a TOWARD b, so with the remote ref as `a`
    // `ahead` is what the LOCAL branch has on its own. Reversing this pair
    // inverts the whole dialog silently.
    const ab = await aheadBehind(repoId, remote, local);
    return { ahead: ab.ahead, behind: ab.behind, unrelated: ab.mergeBase === null };
  } catch {
    return { ahead: 0, behind: 0, unrelated: true };
  }
}

/** Act on the existing branch the user chose to keep. */
async function useExistingBranch(
  local: string,
  remote: string,
  existing: BranchInfo,
  update: boolean,
): Promise<void> {
  // The missing upstream IS what the user came here for: they asked for
  // `remote`, and a branch tracking nothing shows no ahead/behind and has
  // nothing to pull. One that already tracks something else is left alone —
  // re-pointing it is a different decision, and not the one this dialog asked.
  if (!existing.upstream) {
    await useRepoStore.getState().setUpstream(local, remote);
    if (useRepoStore.getState().error) return;
  }
  // Advance the ref BEFORE anything stands on it — for a branch that is not
  // HEAD this is a pure ref move. For the one you ARE on, `fastForwardBranch`
  // reroutes to `pull` under the user's own pull mode, which is the only
  // correct way to advance a checked-out branch: its index and worktree have
  // to move too.
  if (update) {
    await useRepoStore.getState().fastForwardBranch(local);
    if (useRepoStore.getState().error) return;
  }
  // Already standing on it: `checkoutBranch` would be a no-op that still spends
  // a stash → checkout → pop cycle on the user's working tree.
  if (existing.isHead) return;
  await useRepoStore.getState().checkoutBranch(local);
}

/**
 * Check a remote-tracking ref out as a local branch that TRACKS it.
 *
 * ONE definition, shared by the remote-branch menu, the commit menu's remote
 * entry (#179) and the Branches detail pane: a bare `checkoutRef("origin/foo")`
 * would silently DETACH, which is the whole reason this flow exists, so a
 * second copy is how one of those call sites would come to detach.
 *
 * The create and the checkout are ONE store action (`createAndSwitchBranch`),
 * because as two they were not atomic in the way that matters. The store's
 * `createBranch` reports failure by setting the banner, and the checkout that
 * used to follow it unconditionally then SUCCEEDED — on whatever unrelated
 * local branch already had that name — and cleared the banner on its way past.
 * The user asked for `origin/x` and silently landed on a stale `x` that had
 * never seen the remote, with nothing on screen to say so. That collision is
 * now the question below rather than an accident.
 *
 * Tracking itself is set by the BACKEND (`create_branch` off a remote-tracking
 * start point), so every other way of branching off `origin/x` gets it too.
 */
export async function checkoutRemoteAsLocalBranch(remote: string): Promise<void> {
  if (!remote) return;
  let suggested = withoutRemotePrefix(remote);
  // Loops only on "use a different name"; every other answer returns.
  for (;;) {
    const local = await pgPrompt({
      title: "Check out as new local branch",
      body: `Tracking ${remote}.`,
      initialValue: suggested,
      confirmLabel: "Check out",
      requireValue: true,
      mono: true,
    });
    if (!local) return;

    const store = useRepoStore.getState();
    const existing = store.branches.find((b) => !b.isRemote && b.name === local);
    if (!existing) {
      await store.createAndSwitchBranch(local, { from: remote });
      return;
    }

    const repoId = store.current?.id;
    const rel = repoId
      ? await relationTo(repoId, remote, local)
      : { ahead: 0, behind: 0, unrelated: true };
    const answer = await pgChoose(
      existingBranchPrompt(local, remote, existing, rel),
    );
    if (answer === "rename") {
      // Re-open on what they typed, not on the original suggestion — the name
      // they chose is usually a prefix of the one they want.
      suggested = local;
      continue;
    }
    if (answer === null) return;
    await useExistingBranch(local, remote, existing, answer === "update");
    return;
  }
}
