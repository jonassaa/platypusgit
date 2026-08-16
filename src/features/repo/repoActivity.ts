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
