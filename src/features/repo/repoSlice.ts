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
  HeadInfo,
  LogFilter,
  RebaseStatus,
  RemoteInfo,
  RepoHandle,
  RepoState as GitRepoState,
  ShallowInfo,
  StashInfo,
  TagInfo,
} from "@/lib/types";
import { LOG_REF_ALL } from "@/lib/types";
import type { AppError, HookRejection } from "@/lib/errors";
import type { RepoActivity } from "./repoActivity";
import type { LoadingTask } from "./loadingTasks";

export const DEFAULT_REBASE_STATUS: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
};

/**
 * A repository with nothing missing (#255) — and the value a failed read
 * degrades to, so a `shallow_info` that could not run costs a notice rather
 * than the whole refresh.
 */
export const DEFAULT_SHALLOW_INFO: ShallowInfo = {
  shallow: false,
  boundaryCount: 0,
  singleBranch: false,
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
  /**
   * HEAD's current branch/oid, re-fetched on every `refreshAll` (#217) —
   * unlike `current.head`, which `open` sets once and does not follow a
   * checkout within the session.
   */
  headInfo: HeadInfo | null;
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
  /**
   * How much of this repository is actually here (#255) — read from git on
   * every refresh, never remembered.
   *
   * Per-repo, and therefore here: a shallow clone open in one tab must not put
   * a "history is truncated" strip on another tab's blame. It is also why the
   * value is re-read by `refreshAll` rather than fetched once on open — an
   * unshallow, a fetch, or a `git fetch --unshallow` in a terminal all change
   * it, and the notices have to come down when they do.
   */
  shallowInfo: ShallowInfo;
  /** Active long-running ops keyed by op kind. */
  activity: RepoActivity;
  /**
   * The backend reads in flight right now (#296 gap 8) — the detail behind
   * `loading`, which is one boolean for what is usually ten parallel queries.
   *
   * Per-repo like everything else here: a refresh running on a background tab
   * must not describe the one on screen.
   */
  loadingTasks: LoadingTask[];
  /**
   * Whether the user has already asked to cancel the network ops in flight
   * (#263).
   *
   * Per-repo, and therefore here: a cancel asked for in one tab must not make
   * another tab's Cancel read "Force stop". Purely a UI-intent flag — the
   * authoritative per-op state lives in the backend registry (`cancel.rs`) —
   * but the status bar has to show it, because the SECOND click is what
   * escalates SIGTERM to SIGKILL and a button that never changes gives the
   * user no way to know that. Cleared when `activity` empties, i.e. when the
   * ops this cancel was aimed at have all unwound.
   */
  cancelRequested: boolean;
  /**
   * The git hook refusal to display, or null (#232).
   *
   * Per-repo, and therefore here: a commit rejected by one repository's
   * `pre-commit` must not show its output in another tab's commit panel. It is
   * kept out of `error` on purpose — a hook's output needs a surface that
   * scrolls, and the user is about to act on it rather than dismiss it.
   */
  hookRejection: HookRejection | null;
  /**
   * A commit that was refused because git has no committer identity it will
   * accept (#212).
   *
   * Per-repo for the same reason `hookRejection` is, and kept out of `error`
   * for the same reason too: the remedy is a form, not an acknowledgement. A
   * fresh machine hits this on its very first commit, and before #212 it got a
   * banner reading "NoSignature" and no way to fix it from inside the app.
   */
  noSignature: boolean;
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
    headInfo: null,
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
    shallowInfo: DEFAULT_SHALLOW_INFO,
    activity: {},
    loadingTasks: [],
    cancelRequested: false,
    hookRejection: null,
    noSignature: false,
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
 * Every in-flight marker is cleared: those requests were issued against the
 * repository that is no longer active, so `setFor` will drop their responses and
 * nothing will ever clear the flags again. Freezing `loadingMore: true` would
 * make "load more" a permanent no-op on that tab (its re-entry guard reads the
 * flag), and a frozen `loading`/`searching` would park a spinner forever.
 */
export function frozenSlice(slice: RepoSlice): RepoSlice {
  // `activity` clears for the same reason (#296), and it is the same class of
  // bug the paragraph above describes: the op's `setActivity` is guarded on the
  // repository being current, so once this tab is parked nothing will ever clear
  // its entry. Left frozen, returning to the tab shows a spinner — and a Cancel
  // button — for an operation that finished long ago.
  return {
    ...slice,
    loading: false,
    loadingMore: false,
    searching: false,
    activity: {},
    loadingTasks: [],
  };
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
