/**
 * Active long-running operations, keyed by operation kind (#296).
 *
 * Its own module so `repoSlice.ts` can name it without importing
 * `useRepoStore` — which imports `repoSlice`.
 *
 * This is the app's ONE answer to "is something running, what is it, how far
 * along, and can I stop it": the toolbar spins a button off `!!activity.fetch`,
 * the status bar renders the first live entry as a line with a bar and a Cancel
 * button beside it. A long-running op that keeps its busy state privately gets
 * none of that — which is exactly how LFS and submodule updates ended up
 * cancellable in the backend but unstoppable from the UI. New long ops join
 * here; a private `busy` field is only for saying WHICH row is busy.
 */

/** What one running operation is doing right now. */
export interface ActivityState {
  /** The user-visible line: "Fetching origin…". */
  label: string;
  /**
   * Git's own phase name for the current transfer stage ("Receiving objects"),
   * when it is reporting one. Absent until the first `net://progress` tick, and
   * absent for the whole op when git has no sideband to report (a local
   * operation, or `git lfs`, whose stderr is not git's progress protocol).
   */
  phase?: string;
  /** 0–100 for `phase`. Absent means indeterminate — spinner, no bar. */
  percent?: number;
  /**
   * `Date.now()` when this operation started, for the elapsed-time readout.
   *
   * Survives a label change within the same op (pull's stash → pull → pop
   * sequence is one wait from the user's side, so the clock must not restart
   * three times), which is why `setActivity` carries it forward rather than
   * stamping a new one on every call.
   */
  startedAt: number;
}

/**
 * Every operation kind that can be in flight on one repository.
 *
 * Only fetch/pull/push ever carry a `percent`: they are the ones run with
 * `--progress`, which is the only source of a real number. The rest are
 * honestly indeterminate and say so by having no bar.
 */
export interface RepoActivity {
  fetch?: ActivityState;
  pull?: ActivityState;
  push?: ActivityState;
  stash?: ActivityState;
  branch?: ActivityState;
  /** An interactive rebase replaying its plan, or a `rebase --onto`. */
  rebase?: ActivityState;
  /** `git lfs fetch` / `git lfs pull`. */
  lfs?: ActivityState;
  /** `git submodule update`. */
  submodule?: ActivityState;
  /** Checking out a pull request's head ref. */
  forge?: ActivityState;
  /**
   * `git difftool` — the user's own diff tool, open on one file (#235).
   *
   * The longest-lived entry in here by a wide margin: git waits for the tool,
   * and a person reading a diff in Beyond Compare takes minutes. That is exactly
   * why it is an entry at all — without one, clicking "Open in external diff
   * tool" and then alt-tabbing back to a window that says nothing looks like the
   * click was swallowed.
   */
  difftool?: ActivityState;
  /**
   * A user-defined custom action (#225).
   *
   * It is here for the same reason `difftool` is: a user's own program can take
   * as long as it likes, and one that pins nothing visible is indistinguishable
   * from one that never started.
   */
  action?: ActivityState;
  /**
   * Searching one file's history (#474).
   *
   * The first entry here that is not a subprocess and not a mutation — it is a
   * libgit2 revwalk, and it earns an entry for the one reason this module
   * exists: on a large repository it is a wait long enough to need stopping.
   * `file_history` walks from HEAD comparing trees at the path, so before the
   * visit cap a rarely-touched file walked to the root of history — ~1.5
   * million commits on `torvalds/linux`, for a file the user clicked once, with
   * a spinner and no way out. The cap bounds it; this is what makes the bounded
   * wait visible and cancellable.
   */
  history?: ActivityState;
}

export type ActivityKey = keyof RepoActivity;

/**
 * The order the status bar picks an entry in when more than one is live.
 *
 * "Expected to be one at a time" stopped being true once LFS, submodule and
 * forge ops joined: a submodule update fetching while the user pushes is
 * ordinary. The order is by how much the user is waiting on it — the push they
 * just started outranks a background submodule fetch. `difftool` sits low for
 * the same reason it is the longest-lived: the app is not busy, the user is
 * reading, and any real git op running underneath is the more urgent thing to
 * say.
 */
export const ACTIVITY_PRIORITY: readonly ActivityKey[] = [
  "push",
  "pull",
  "fetch",
  "rebase",
  "stash",
  "branch",
  "forge",
  // Above difftool because the app really is busy here, below the git ops
  // because a push the user started outranks a screen filling in behind it.
  "history",
  "difftool",
  // Below difftool: like it, the app is not busy — someone else's program is —
  // and any real git op running underneath is the more urgent thing to say.
  "action",
  "lfs",
  "submodule",
];

/** The entry the status bar should show, with its key, or null when idle. */
export function primaryActivity(
  activity: RepoActivity,
): { key: ActivityKey; state: ActivityState } | null {
  for (const key of ACTIVITY_PRIORITY) {
    const state = activity[key];
    if (state) return { key, state };
  }
  return null;
}

/** How many operations are running. Drives the "+2 more" hint in the status bar. */
export function activityCount(activity: RepoActivity): number {
  return ACTIVITY_PRIORITY.filter((k) => activity[k]).length;
}

/**
 * How a kind of operation is stopped — `null` for one that cannot be.
 *
 * ONE table rather than a set plus a branch at the button, because "can this be
 * cancelled" and "what cancels it" are the same question asked twice, and two
 * answers are free to disagree. `useActivityView` reads it to decide both.
 *
 * * `"network"` — a `git` subprocess through
 *   `commands::net::run_git_authenticated`, registered under
 *   `cancel::Scope::Repo` and stopped by `cancel_network_op` signalling its
 *   process group.
 * * `"walk"` — libgit2 inside one blocking call, registered under
 *   `cancel::Scope::Walk` and stopped by `cancel_walk` setting a flag the walk
 *   polls between commits (#474). There is no process to signal.
 *
 * Everything absent is libgit2 work with nothing to poll: a rebase replay
 * cannot be interrupted at all yet (#296 gap 6), and a checkout or stash is
 * over before a button could be found. Offering Cancel on those would be a
 * button that does nothing, which is worse than no button.
 */
const CANCEL_PATH: Partial<Record<ActivityKey, "network" | "walk">> = {
  fetch: "network",
  pull: "network",
  push: "network",
  lfs: "network",
  submodule: "network",
  forge: "network",
  history: "walk",
};

/** What stops an operation of this kind, or null when nothing does. */
export function cancelPath(key: ActivityKey): "network" | "walk" | null {
  return CANCEL_PATH[key] ?? null;
}

export function isCancellable(key: ActivityKey): boolean {
  return cancelPath(key) !== null;
}
