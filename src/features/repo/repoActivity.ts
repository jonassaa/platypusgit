/**
 * Active long-running operations, keyed by operation kind. Value is the
 * user-visible label (e.g. "Fetching origin…"). Consumers can flip button
 * spinners with `!!activity.fetch` and render a status-bar line from the
 * first truthy entry.
 *
 * Its own module so `repoSlice.ts` can name it without importing
 * `useRepoStore` — which imports `repoSlice`.
 */
export interface RepoActivity {
  fetch?: string;
  pull?: string;
  push?: string;
  stash?: string;
  branch?: string;
}

/**
 * The network ops that can be stopped from the UI (#234). A subset of
 * `RepoActivity`'s keys: `stash` and `branch` are local work, done before a
 * cancel button could be found.
 */
export type CancellableOp = "fetch" | "pull" | "push";

/**
 * Backend op ids for the in-flight cancellable ops, keyed exactly like
 * [`RepoActivity`]'s labels — `activity.fetch` says a fetch is running,
 * `netOps.fetch` says how to stop it. Set and cleared by the same four store
 * actions, in the same `finally`.
 *
 * Kept as a separate field rather than folded into `RepoActivity`'s values
 * because `pull` re-labels itself three times (stash → pull → pop), and
 * threading an id through each relabel is how one of them ends up dropping it.
 */
export type NetOps = Partial<Record<CancellableOp, string>>;
