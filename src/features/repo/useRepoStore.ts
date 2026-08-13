import { create } from "zustand";
import type {
  AuthorOverride,
  BranchInfo,
  CommitInfo,
  FileContent,
  FileStatus,
  LogFilter,
  RebaseStatus,
  RebaseStep,
  RemoteInfo,
  RepoHandle,
  RepoState as GitRepoState,
  StashInfo,
  TagInfo,
} from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { dubiousOwnershipPath, isAppError, isDubiousOwnershipError } from "@/lib/errors";
import { confirmTrust } from "@/features/repo/ownership";
import {
  abortOperation,
  acceptOurs,
  acceptTheirs,
  addRemote,
  appendGitignore as appendGitignoreFn,
  openInEditor as openInEditorFn,
  checkoutBranch,
  checkoutRef,
  cherryPick,
  commit as commitFn,
  continueOperation,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  discardHunk,
  discardPaths,
  fetch as fetchRemote,
  fetchAll,
  getLogFilteredPage,
  getLogPage,
  getStatus,
  listAllFiles,
  listFilesAtRev as listFilesAtRevFn,
  readFileContentAtRev as readFileContentAtRevFn,
  listBranches,
  listRemotes,
  listStashes,
  listTags,
  markResolved,
  mergeBranch as mergeBranchFn,
  openRepo,
  trustRepoPath,
  pruneRemote,
  pull as pullRemote,
  push as pushRemote,
  pushDeleteBranch as pushDeleteBranchFn,
  pushTag as pushTagFn,
  rebaseAbort,
  rebaseOnto as rebaseOntoFn,
  rebaseContinue as rebaseContinueFn,
  rebaseStart as rebaseStartFn,
  rebaseStatus as rebaseStatusFn,
  renameBranch,
  renameRemote,
  reset as resetFn,
  revert as revertFn,
  removeRemote,
  repoState as repoStateFn,
  runMergetool as runMergetoolFn,
  restartConflict as restartConflictFn,
  setRemoteUrl,
  setUpstream as setUpstreamFn,
  stageHunk,
  stagePaths,
  stashApply,
  stashBranch as stashBranchFn,
  stashDrop,
  stashPop,
  stashSave,
  unstageHunk,
  unstagePaths,
  type PullMode,
  type PushForce,
  type ResetMode,
  type StashSaveOptions,
  type TagTarget,
} from "@/lib/tauri";
import { isFilterEmpty } from "@/features/commits/logFilter";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useRecentsStore } from "./useRecentsStore";

/**
 * Active long-running operations, keyed by operation kind. Value is the
 * user-visible label (e.g. "Fetching origin…"). Consumers can flip button
 * spinners with `!!activity.fetch` and render a status-bar line from the
 * first truthy entry.
 */
export interface RepoActivity {
  fetch?: string;
  pull?: string;
  push?: string;
  stash?: string;
  branch?: string;
}

/**
 * Commits per log page (#68 G11). Was a `500` literal repeated at four call
 * sites, which is what made history past it unreachable — it is now the page
 * size, not the ceiling.
 */
const PAGE_SIZE = 500;

interface RepoStoreState {
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
   * Revspec the log walk starts from, or null for HEAD. Scoping applies to
   * `commits` AND backend searches, so every consumer of the log (History,
   * palette pickers, context menus) sees the browsed ref's commits.
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
  rebaseStatus: RebaseStatus;
  /**
   * Final status of the most recently completed rebase, held frontend-side.
   * The backend sweeps RebaseState on completion (#28), so the very next
   * refreshAll's rebase_status poll reports total: 0 — this field preserves
   * the "N steps completed" summary for the Rebase screen. Cleared when a
   * new rebase starts, on abort, and on repo open/close.
   */
  lastRebaseSummary: RebaseStatus | null;
  /** Active long-running ops keyed by op kind. */
  activity: RepoActivity;
  openRepo: (path: string) => Promise<void>;
  /**
   * Run a backend commit-log search. An empty filter clears the search and
   * falls back to the full log. Sets `searchResults` + `commitFilter`.
   */
  searchCommits: (filter: LogFilter) => Promise<void>;
  /**
   * Append the next page to whichever log list is active (#68 G11). No-op at
   * the end of history or while a page is already in flight.
   */
  loadMoreCommits: () => Promise<void>;
  /**
   * Scope the commit log to `refspec` (null = HEAD) and reload it. An active
   * search is re-run under the new scope. Errors (e.g. InvalidRef) are set on
   * the store; the previous list is kept.
   */
  setLogRef: (refspec: string | null) => Promise<void>;
  refreshAll: () => Promise<void>;
  /**
   * Lightweight refresh for index-only mutations (stage/unstage/discard and
   * the hunk ops): re-fetches just `status` + `repoState`, skipping the full
   * branch/tag/stash/remote enumeration and the ≤500-commit log walk that
   * `refreshAll` does but that these ops can't change.
   */
  refreshStatus: () => Promise<void>;
  refreshAllFiles: () => Promise<void>;
  /**
   * List every file in the tree at `revspec` (commit/branch/tag/revspec).
   * Returns the file list, or null on failure (error is set on the store).
   */
  listFilesAtRev: (revspec: string) => Promise<FileStatus[] | null>;
  /**
   * Read a file's content from the tree at `revspec`. Returns null on failure
   * (error is set on the store).
   */
  readFileContentAtRev: (
    revspec: string,
    path: string,
  ) => Promise<FileContent | null>;
  clearError: () => void;
  closeRepo: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  stageHunk: (path: string, hunkIndex: number) => Promise<void>;
  unstageHunk: (path: string, hunkIndex: number) => Promise<void>;
  discardHunk: (path: string, hunkIndex: number) => Promise<void>;
  commit: (
    message: string,
    amend?: boolean,
    signoff?: boolean,
    /** "Commit as" — null uses the repo config identity. */
    authorOverride?: AuthorOverride | null,
  ) => Promise<string | null>;
  reset: (target: string, mode: ResetMode) => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  checkoutRef: (reference: string) => Promise<void>;
  createBranch: (name: string, from?: string) => Promise<void>;
  /**
   * Create a branch and switch to it. When the worktree is dirty and
   * `autoStash` is true, stashes before checkout and pops the stash after.
   * Returns true on success, false on any failure (error is set on the store).
   */
  createAndSwitchBranch: (
    name: string,
    opts?: { from?: string; autoStash?: boolean },
  ) => Promise<boolean>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  renameBranch: (from: string, to: string) => Promise<void>;
  /** Set (`"origin/main"`) or clear (`null`) a local branch's upstream. */
  setUpstream: (branch: string, upstream: string | null) => Promise<void>;
  mergeBranch: (name: string) => Promise<void>;
  rebaseOnto: (upstream: string) => Promise<void>;
  createTag: (name: string, target: TagTarget) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  pushTag: (remote: string, name: string) => Promise<void>;
  pushDeleteBranch: (remote: string, name: string) => Promise<void>;
  cherryPick: (oid: string) => Promise<void>;
  cherryPickMany: (oids: string[]) => Promise<void>;
  revert: (oid: string) => Promise<void>;
  stashSave: (opts: StashSaveOptions) => Promise<string | null>;
  stashApply: (index: number) => Promise<void>;
  stashPop: (index: number) => Promise<void>;
  stashDrop: (index: number) => Promise<void>;
  stashBranch: (index: number, branch: string) => Promise<void>;
  // network
  fetch: (remote: string) => Promise<void>;
  fetchAll: () => Promise<void>;
  pull: (remote: string, branch: string, mode?: PullMode) => Promise<void>;
  push: (remote: string, branch: string, force?: PushForce) => Promise<void>;
  // remote management
  addRemote: (name: string, url: string) => Promise<void>;
  removeRemote: (name: string) => Promise<void>;
  renameRemote: (from: string, to: string) => Promise<void>;
  setRemoteUrl: (name: string, url: string) => Promise<void>;
  pruneRemote: (name: string) => Promise<void>;
  // conflict resolution
  acceptOurs: (path: string) => Promise<void>;
  acceptTheirs: (path: string) => Promise<void>;
  markResolved: (paths: string[]) => Promise<void>;
  abortOperation: () => Promise<void>;
  continueOperation: () => Promise<string | null>;
  runMergetool: (path: string) => Promise<void>;
  restartConflict: (path: string) => Promise<void>;
  // interactive rebase
  rebaseStart: (plan: RebaseStep[]) => Promise<RebaseStatus | null>;
  rebaseContinue: () => Promise<RebaseStatus | null>;
  rebaseAbort: () => Promise<void>;
  appendGitignore: (pattern: string) => Promise<void>;
  openInEditor: (relativePath: string) => Promise<void>;
}

function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: String(e) };
}

const DEFAULT_REBASE_STATUS: RebaseStatus = {
  inProgress: false,
  nextIndex: 0,
  total: 0,
  pauseReason: null,
};

export const useRepoStore = create<RepoStoreState>((set, get) => {
  const setActivity = (key: keyof RepoActivity, label: string | null) => {
    set((s) => {
      const next = { ...s.activity };
      if (label === null) delete next[key];
      else next[key] = label;
      return { activity: next };
    });
  };
  /** Open `path` and reset every per-repo slice. Throws on failure. */
  const applyOpenedRepo = async (path: string) => {
    const handle = await openRepo(path);
    useRecentsStore.getState().addRecent(handle.path);
    set({
      current: handle,
      status: [],
      allFiles: [],
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      commits: [],
      searchResults: null,
      commitFilter: {},
      lastRebaseSummary: null,
      logRef: null,
      commitCursor: null,
      searchCursor: null,
    });
    await get().refreshAll();
  };
  return ({
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
  logRef: null,
  searching: false,
  commitCursor: null,
  searchCursor: null,
  loadingMore: false,
  loading: false,
  error: null,
  repoState: "Clean",
  rebaseStatus: DEFAULT_REBASE_STATUS,
  lastRebaseSummary: null,
  activity: {},

  async openRepo(path) {
    set({ loading: true, error: null });
    try {
      await applyOpenedRepo(path);
    } catch (e) {
      // git refuses a repository owned by another user, which a Windows drive
      // mounted under WSL routinely looks like. That refusal is remediable,
      // and handling it here rather than per-screen covers Welcome, recents,
      // the CLI launch and the palette at once.
      if (isDubiousOwnershipError(e)) {
        // Trust what the backend named — it canonicalised the path, and
        // safe.directory matching is exact.
        const target = dubiousOwnershipPath(e) ?? path;
        if (await confirmTrust(target)) {
          try {
            await trustRepoPath(target);
            // Deliberately not recursive: one retry. If the exception did not
            // help, show the error rather than asking again forever.
            await applyOpenedRepo(path);
            return;
          } catch (retryError) {
            set({ loading: false, error: toAppError(retryError) });
            return;
          }
        }
      }
      set({ loading: false, error: toAppError(e) });
    }
  },

  async searchCommits(filter) {
    const repo = get().current;
    if (!repo) return;
    // Empty filter → clear the search, fall back to full log.
    if (isFilterEmpty(filter)) {
      // Dropping the search hands the list back to `commits`, whose own cursor
      // was never touched — so "load more" resumes the unfiltered walk.
      set({
        searchResults: null,
        commitFilter: {},
        searching: false,
        searchCursor: null,
      });
      return;
    }
    set({ commitFilter: filter, searching: true });
    const refspec = get().logRef;
    try {
      const page = await getLogFilteredPage(repo.id, filter, null, PAGE_SIZE, refspec);
      // Guard against a stale response overwriting a newer filter or scope.
      if (get().commitFilter !== filter || get().logRef !== refspec) return;
      set({
        searchResults: page.commits,
        searchCursor: page.nextCursor,
        searching: false,
      });
    } catch (e) {
      set({ searching: false, error: toAppError(e) });
    }
  },

  async loadMoreCommits() {
    const { current, searchResults, searchCursor, commitCursor, loadingMore } = get();
    const searching = searchResults !== null;
    const cursor = searching ? searchCursor : commitCursor;
    // Re-entry guard: History's window can ask for more several times before
    // the first page resolves.
    if (!current || !cursor || loadingMore) return;

    const refspec = get().logRef;
    const filter = get().commitFilter;
    set({ loadingMore: true });
    try {
      const page = searching
        ? await getLogFilteredPage(current.id, filter, cursor, PAGE_SIZE, refspec)
        : await getLogPage(current.id, cursor, PAGE_SIZE, refspec);
      // The list may have been replaced while the page was in flight (repo
      // switch, ref change, new search) — dropping a stale page is correct.
      if (get().logRef !== refspec) return;
      if (searching) {
        if (get().commitFilter !== filter || get().searchResults === null) return;
        set((s) => ({
          searchResults: [...(s.searchResults ?? []), ...page.commits],
          searchCursor: page.nextCursor,
        }));
      } else {
        if (get().searchResults !== null) return;
        set((s) => ({
          commits: [...s.commits, ...page.commits],
          commitCursor: page.nextCursor,
        }));
      }
    } catch (e) {
      set({ error: toAppError(e) });
    } finally {
      set({ loadingMore: false });
    }
  },

  async setLogRef(refspec) {
    const repo = get().current;
    if (!repo) {
      set({ logRef: refspec });
      return;
    }
    set({ logRef: refspec, loading: true, error: null });
    try {
      const page = await getLogPage(repo.id, null, PAGE_SIZE, refspec);
      // Guard against a stale response overwriting a newer scope.
      if (get().logRef !== refspec) return;
      set({ commits: page.commits, commitCursor: page.nextCursor, loading: false });
      // Re-run an active search under the new scope.
      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      if (get().logRef !== refspec) return;
      set({ loading: false, error: toAppError(e) });
    }
  },

  async refreshAll() {
    const repo = get().current;
    if (!repo) return;
    set({ loading: true, error: null });
    const logRef = get().logRef;
    try {
      const [status, branches, tags, stashes, remotes, commitPage, repoState, rebaseStatus] =
        await Promise.all([
          getStatus(repo.id),
          listBranches(repo.id),
          listTags(repo.id),
          listStashes(repo.id),
          listRemotes(repo.id),
          getLogPage(repo.id, null, PAGE_SIZE, logRef).catch((e) => {
            // The browsed ref may have vanished since it was selected (e.g.
            // the branch was deleted) — fall back to HEAD instead of failing
            // the whole refresh.
            if (logRef === null) throw e;
            set({ logRef: null });
            return getLogPage(repo.id, null, PAGE_SIZE);
          }),
          repoStateFn(repo.id),
          rebaseStatusFn(repo.id),
        ]);
      set({
        status,
        branches,
        tags,
        stashes,
        remotes,
        commits: commitPage.commits,
        // A refresh restarts the walk, so the old resume point is void.
        commitCursor: commitPage.nextCursor,
        repoState,
        rebaseStatus,
        loading: false,
      });
      // Keep an active search in sync with the refreshed history.
      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
    }
  },

  async refreshStatus() {
    const repo = get().current;
    if (!repo) return;
    set({ error: null });
    try {
      const [status, repoState] = await Promise.all([
        getStatus(repo.id),
        repoStateFn(repo.id),
      ]);
      set({ status, repoState });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  clearError() {
    set({ error: null });
  },

  closeRepo() {
    set({
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
      logRef: null,
      searching: false,
      lastRebaseSummary: null,
      error: null,
    });
  },

  async refreshAllFiles() {
    const repo = get().current;
    if (!repo) return;
    try {
      const allFiles = await listAllFiles(repo.id);
      set({ allFiles });
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async listFilesAtRev(revspec) {
    const repo = get().current;
    if (!repo) return null;
    try {
      return await listFilesAtRevFn(repo.id, revspec);
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async readFileContentAtRev(revspec, path) {
    const repo = get().current;
    if (!repo) return null;
    try {
      return await readFileContentAtRevFn(repo.id, revspec, path);
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async stage(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stagePaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async unstage(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstagePaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async discard(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardPaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  // Hunk ops pass the same diffContextLines the viewers used for getDiff so
  // the backend recomputes an identical hunk list — indices stay aligned.
  async stageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stageHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async unstageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstageHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async discardHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async reset(target, mode) {
    const repo = get().current;
    if (!repo) return;
    try {
      await resetFn(repo.id, target, mode);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async commit(message, amend = false, signoff = false, authorOverride = null) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await commitFn(repo.id, message, amend, signoff, authorOverride);
      await get().refreshAll();
      return oid;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async checkoutBranch(name) {
    const repo = get().current;
    if (!repo) return;
    setActivity("branch", `Switching to ${name}…`);
    try {
      // Carry over uncommitted work automatically: stash → checkout → pop.
      // stashSave returns null when there's nothing to stash, so this is a
      // no-op on a clean tree. The client-side `status` can lag behind the
      // backend, so we always attempt the stash rather than gating on it.
      setActivity("branch", `Stashing changes…`);
      const stashed = await stashSave(repo.id, {
        message: `auto: switch to ${name}`,
        includeUntracked: true,
        keepIndex: false,
      });
      setActivity("branch", `Switching to ${name}…`);
      await checkoutBranch(repo.id, name);
      if (stashed) {
        setActivity("branch", `Restoring stashed changes…`);
        await stashPop(repo.id, 0);
      }
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
      await get().refreshAll();
    } finally {
      setActivity("branch", null);
    }
  },

  async checkoutRef(reference) {
    const repo = get().current;
    if (!repo) return;
    try {
      await checkoutRef(repo.id, reference);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async mergeBranch(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await mergeBranchFn(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      // refreshAll clears `error` as its first act, so refresh before
      // recording the error — otherwise the two synchronous `set()` calls
      // land in the same React batch and the error is wiped before render.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async rebaseOnto(upstream) {
    const repo = get().current;
    if (!repo) return;
    try {
      await rebaseOntoFn(repo.id, upstream);
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async pushTag(remote, name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await pushTagFn(repo.id, remote, name);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async pushDeleteBranch(remote, name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await pushDeleteBranchFn(repo.id, remote, name);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async createBranch(name, from) {
    const repo = get().current;
    if (!repo) return;
    try {
      await createBranch(repo.id, name, from);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async createAndSwitchBranch(name, opts) {
    const repo = get().current;
    if (!repo) return false;
    setActivity("branch", `Creating ${name}…`);
    try {
      await createBranch(repo.id, name, opts?.from);
    } catch (e) {
      set({ error: toAppError(e) });
      setActivity("branch", null);
      await get().refreshAll();
      return false;
    }
    setActivity("branch", null);
    // checkoutBranch handles stash + checkout + pop and its own activity
    // labels. Any error surfaces via the store's `error` field.
    await get().checkoutBranch(name);
    return !get().error;
  },

  async deleteBranch(name, force = false) {
    const repo = get().current;
    if (!repo) return;
    try {
      await deleteBranch(repo.id, name, force);
    } catch (e) {
      set({ error: toAppError(e) });
      return;
    }
    await get().refreshAll();
  },

  async renameBranch(from, to) {
    const repo = get().current;
    if (!repo) return;
    try {
      await renameBranch(repo.id, from, to);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async setUpstream(branch, upstream) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setUpstreamFn(repo.id, branch, upstream);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async createTag(name, target) {
    const repo = get().current;
    if (!repo) return;
    try {
      await createTag(repo.id, name, target);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async deleteTag(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await deleteTag(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async cherryPick(oid) {
    const repo = get().current;
    if (!repo) return;
    try {
      await cherryPick(repo.id, oid);
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async cherryPickMany(oids) {
    const repo = get().current;
    if (!repo) return;
    try {
      // Apply oldest→newest (the caller orders them). Each clean pick
      // auto-commits and moves HEAD; the next applies on top. A conflicting
      // pick throws (ConflictsDetected), stopping the sequence and leaving the
      // repo in a conflicted CherryPick state for the Conflict screen. Refresh
      // once at the end rather than per pick.
      for (const oid of oids) {
        await cherryPick(repo.id, oid);
      }
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async revert(oid) {
    const repo = get().current;
    if (!repo) return;
    try {
      await revertFn(repo.id, oid);
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async stashSave(opts) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await stashSave(repo.id, opts);
      await get().refreshAll();
      return oid;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async stashApply(index) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashApply(repo.id, index);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async stashPop(index) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashPop(repo.id, index);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async stashDrop(index) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashDrop(repo.id, index);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async stashBranch(index, branch) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashBranchFn(repo.id, index, branch);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async fetch(remote) {
    const repo = get().current;
    if (!repo) return;
    setActivity("fetch", `Fetching ${remote}…`);
    try {
      await fetchRemote(repo.id, remote, useSettingsStore.getState().pruneOnFetch);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    } finally {
      setActivity("fetch", null);
    }
  },

  async fetchAll() {
    const repo = get().current;
    if (!repo) return;
    setActivity("fetch", "Fetching all remotes…");
    try {
      await fetchAll(repo.id, useSettingsStore.getState().pruneOnFetch);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    } finally {
      setActivity("fetch", null);
    }
  },

  async pull(remote, branch, mode = "Merge") {
    const repo = get().current;
    if (!repo) return;
    setActivity("pull", `Pulling ${remote}/${branch}…`);
    try {
      // Carry over uncommitted work when the setting is on: stash → pull →
      // pop, mirroring checkoutBranch's auto-stash. stashSave returns null
      // when the tree is clean, so this is a no-op in the common case. If
      // the pull fails, the stash is deliberately NOT popped — the work
      // stays safe in the stash list rather than colliding with a conflicted
      // worktree (same policy as checkoutBranch).
      let stashed: string | null = null;
      if (useSettingsStore.getState().autoStashBeforePull) {
        setActivity("pull", "Stashing changes…");
        stashed = await stashSave(repo.id, {
          message: `auto: pull ${remote}/${branch}`,
          includeUntracked: true,
          keepIndex: false,
        });
        setActivity("pull", `Pulling ${remote}/${branch}…`);
      }
      await pullRemote(repo.id, remote, branch, mode);
      if (stashed) {
        setActivity("pull", "Restoring stashed changes…");
        await stashPop(repo.id, 0);
      }
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      set({ error: toAppError(e) });
    } finally {
      setActivity("pull", null);
    }
  },

  async push(remote, branch, force = "None") {
    const repo = get().current;
    if (!repo) return;
    setActivity("push", `Pushing ${remote}/${branch}…`);
    try {
      await pushRemote(repo.id, remote, branch, force);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    } finally {
      setActivity("push", null);
    }
  },

  async addRemote(name, url) {
    const repo = get().current;
    if (!repo) return;
    try {
      await addRemote(repo.id, name, url);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async removeRemote(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await removeRemote(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async renameRemote(from, to) {
    const repo = get().current;
    if (!repo) return;
    try {
      await renameRemote(repo.id, from, to);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async setRemoteUrl(name, url) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setRemoteUrl(repo.id, name, url);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async pruneRemote(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await pruneRemote(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async acceptOurs(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await acceptOurs(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async acceptTheirs(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await acceptTheirs(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async markResolved(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await markResolved(repo.id, paths);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async abortOperation() {
    const repo = get().current;
    if (!repo) return;
    // A paused interactive rebase must abort via rebaseAbort, which clears the
    // RebaseState entry and restores the pre-rebase tip. The generic abort
    // would leave that entry behind (see rebaseAbort / abort_operation).
    if (get().rebaseStatus.inProgress) {
      await get().rebaseAbort();
      return;
    }
    try {
      await abortOperation(repo.id);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async continueOperation() {
    const repo = get().current;
    if (!repo) return null;
    // Resolving a conflict during an interactive rebase must continue the
    // rebase (commit the resolved tree + advance the plan), not create a
    // standalone commit that leaves the rebase half-done — a later abort would
    // then reset to orig_head and silently discard the finalized commit.
    if (get().rebaseStatus.inProgress) {
      await get().rebaseContinue();
      return null;
    }
    try {
      const oid = await continueOperation(repo.id);
      await get().refreshAll();
      return oid;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async runMergetool(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await runMergetoolFn(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async restartConflict(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await restartConflictFn(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async rebaseStart(plan) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const status = await rebaseStartFn(repo.id, plan);
      // Capture the summary before refreshAll re-polls rebase_status — the
      // backend sweeps RebaseState on completion, so the poll returns total: 0.
      set({
        rebaseStatus: status,
        lastRebaseSummary: status.inProgress ? null : status,
      });
      await get().refreshAll();
      return status;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async rebaseContinue() {
    const repo = get().current;
    if (!repo) return null;
    try {
      const status = await rebaseContinueFn(repo.id);
      set({
        rebaseStatus: status,
        ...(status.inProgress ? {} : { lastRebaseSummary: status }),
      });
      await get().refreshAll();
      return status;
    } catch (e) {
      set({ error: toAppError(e) });
      return null;
    }
  },

  async rebaseAbort() {
    const repo = get().current;
    if (!repo) return;
    try {
      await rebaseAbort(repo.id);
      set({ rebaseStatus: DEFAULT_REBASE_STATUS, lastRebaseSummary: null });
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async appendGitignore(pattern) {
    const repo = get().current;
    if (!repo) return;
    try {
      await appendGitignoreFn(repo.id, pattern);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async openInEditor(relativePath) {
    const repo = get().current;
    if (!repo) return;
    try {
      await openInEditorFn(repo.id, relativePath);
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },
  });
});
