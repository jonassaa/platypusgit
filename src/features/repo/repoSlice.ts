// The per-repository slice of `useRepoStore` — the app's multi-repo (#90)
// anti-leak contract.
//
// `useRepoStore` holds exactly ONE repository's live state: the active tab's.
// `useTabsStore` freezes the outgoing tab's slice and hydrates the incoming
// one on every switch. That is only safe if hydration is a TOTAL write — a
// patch would let the previous repo's `status`, `commits`, `branches` or
// `error` survive into the next tab, which is the exact bug tabs must not
// introduce.
//
// So the slice is declared here, once, as data:
//
//   REPO_SLICE_KEYS   every non-function field of the store
//   emptySlice()      the no-repo-open value of each one
//   sliceOf(state)    pick exactly those fields off a live state
//   frozenSlice(s)    the same, normalized for parking on an inactive tab
//
// and `repoSlice.test.ts` derives the store's real non-function keys at runtime
// and asserts they equal REPO_SLICE_KEYS. Adding a 22nd per-repo field without
// listing it here fails that test instead of leaking silently.
//
// It also collapses what used to be three hand-maintained copies of the reset
// list (the `create()` initializer, `applyOpenedRepo`, `closeRepo`) into one.

import type {
  BisectStatus,
  BranchInfo,
  CommitInfo,
  FileStatus,
  LogFilter,
  RebaseStatus,
  RemoteInfo,
  RepoHandle,
  RepoState as GitRepoState,
  StashInfo,
  TagInfo,
} from "@/lib/types";
import { LOG_REF_ALL } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import type { RepoActivity } from "./repoActivity";

export const DEFAULT_REBASE_STATUS: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
};

/** No bisect, with git's default terms. Mirrors Rust `BisectStatus::idle()`. */
export const DEFAULT_BISECT_STATUS: BisectStatus = {
  inProgress: false,
  startRef: null,
  badTerm: "bad",
  goodTerm: "good",
  currentOid: null,
  remaining: null,
  steps: null,
  firstBadOid: null,
  goodCount: 0,
  badCount: 0,
  skippedCount: 0,
};

/** Every field of `useRepoStore` that belongs to one repository. */
export interface RepoSlice {
  current: RepoHandle | null;
  status: FileStatus[];
  /** Every (non-ignored) file in the worktree, populated lazily by listAllFiles. */
  allFiles: FileStatus[];
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  remotes: RemoteInfo[];
  commits: CommitInfo[];
  /**
   * Backend-filtered commit log, or null when no search is active. Kept
   * separate from `commits` (the full HEAD log) so the History screen can fall
   * back to the unfiltered set and apply its own client-side toggles.
   */
  searchResults: CommitInfo[] | null;
  /** The active backend log filter (empty object when none). */
  commitFilter: LogFilter;
  /**
   * Revspec the log walk starts from: `LOG_REF_ALL` (the default — every branch
   * in one graph), null for HEAD only, or any revspec. Scoping applies to
   * `commits` AND backend searches, so every consumer of the log (History,
   * palette pickers, context menus) sees the browsed scope's commits.
   */
  logRef: string | null;
  /** True while a backend search is in flight. */
  searching: boolean;
  /**
   * Resume points for the paginated log walk (#68 G11) — the frontier of every
   * lane still awaiting a parent, NOT a single oid. null means that walk has
   * reached the end of history.
   *
   * Two cursors, because clearing a search must restore the unfiltered walk's
   * resume point: `searchCursor` belongs to `searchResults`, `commitCursor` to
   * `commits`, and `loadMoreCommits` extends whichever list is active.
   */
  commitCursor: string[] | null;
  searchCursor: string[] | null;
  /** True while an additional page is being fetched. */
  loadingMore: boolean;
  loading: boolean;
  error: AppError | null;
  repoState: GitRepoState;
  /**
   * Live rebase progress AND, once a plan finishes, its retained
   * `lastCompleted` summary — the backend keeps that until acknowledged (#47).
   */
  rebaseStatus: RebaseStatus;
  /**
   * The bisect git itself is running, if any (#93).
   *
   * Per-repo, so it belongs in the slice: a bisect open in one tab must not
   * show in another's OperationBar. Read from GIT's own `.git/BISECT_*` files
   * rather than an in-process map, so it survives a restart and picks up a
   * bisect started in a terminal.
   */
  bisectStatus: BisectStatus;
  /** Active long-running ops keyed by op kind. */
  activity: RepoActivity;
}

/**
 * The slice with no repository open. Also the store's initial state, the value
 * `closeRepo()` resets to, and the base a fresh open starts from — one
 * definition instead of three.
 *
 * A function, not a constant: the arrays and objects must not be shared between
 * tabs, or staging in one repo would mutate another's cached view.
 */
export function emptySlice(): RepoSlice {
  return {
    current: null,
    status: [],
    allFiles: [],
    branches: [],
    tags: [],
    stashes: [],
    remotes: [],
    commits: [],
    searchResults: null,
    commitFilter: {},
    logRef: LOG_REF_ALL,
    searching: false,
    commitCursor: null,
    searchCursor: null,
    loadingMore: false,
    loading: false,
    error: null,
    repoState: "Clean",
    rebaseStatus: DEFAULT_REBASE_STATUS,
    bisectStatus: DEFAULT_BISECT_STATUS,
    activity: {},
  };
}

/**
 * The key list, derived from `emptySlice()` so it can never disagree with the
 * shape above. Ordering is irrelevant; membership is the contract.
 */
export const REPO_SLICE_KEYS = Object.keys(emptySlice()) as (keyof RepoSlice)[];

/**
 * The slice as it should be PARKED on an inactive tab.
 *
 * The three in-flight flags are cleared: their requests were issued against the
 * repository that is no longer active, so `setFor` will drop their responses and
 * nothing will ever clear the flags again. Freezing `loadingMore: true` would
 * make "load more" a permanent no-op on that tab (its re-entry guard reads the
 * flag), and a frozen `loading`/`searching` would park a spinner forever.
 */
export function frozenSlice(slice: RepoSlice): RepoSlice {
  return { ...slice, loading: false, loadingMore: false, searching: false };
}

/** Pick exactly the per-repo fields off a live store state. */
export function sliceOf(state: RepoSlice): RepoSlice {
  const out = {} as RepoSlice;
  for (const key of REPO_SLICE_KEYS) {
    // Index-assignment through the key union needs one cast; the loop is
    // exhaustive by construction, which is what the test pins.
    (out as unknown as Record<string, unknown>)[key] = state[key];
  }
  return out;
}
