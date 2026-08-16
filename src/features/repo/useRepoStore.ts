import { create } from "zustand";
import type {
  AuthorOverride,
  BisectMark,
  FileContent,
  FileStatus,
  LogFilter,
  RebaseStatus,
  RebaseStep,
  RepoHandle,
} from "@/lib/types";
import type { AppError } from "@/lib/errors";
import {
  dubiousOwnershipPath,
  isAppError,
  isAuthError,
  isDubiousOwnershipError,
} from "@/lib/errors";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { confirmTrust } from "@/features/repo/ownership";
import {
  abortOperation,
  acceptOurs,
  acceptTheirs,
  addRemote,
  bisectMark as bisectMarkFn,
  bisectReset as bisectResetFn,
  bisectStart as bisectStartFn,
  bisectStatus as bisectStatusFn,
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
  discardLines as discardLinesFn,
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
  rebaseAcknowledge as rebaseAcknowledgeFn,
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
  rememberCredential,
  setRemoteUrl,
  setUpstream as setUpstreamFn,
  type Credentials,
  stageHunk,
  stageLines as stageLinesFn,
  stagePaths,
  stashApply,
  stashBranch as stashBranchFn,
  stashDrop,
  stashPop,
  stashRename as stashRenameFn,
  stashSave,
  stashSavePaths,
  unstageHunk,
  unstageLines as unstageLinesFn,
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
import {
  DEFAULT_BISECT_STATUS,
  DEFAULT_REBASE_STATUS,
  emptySlice,
  sliceOf,
  type RepoSlice,
} from "./repoSlice";
import type { RepoActivity } from "./repoActivity";

export type { RepoActivity } from "./repoActivity";

/**
 * Commits per log page (#68 G11). Was a `500` literal repeated at four call
 * sites, which is what made history past it unreachable — it is now the page
 * size, not the ceiling.
 */
const PAGE_SIZE = 500;

/**
 * The repository store: exactly ONE repository's live state — the ACTIVE tab's
 * (#90). Every per-repo field comes from `RepoSlice`, which `useTabsStore`
 * freezes on the way out of a tab and hydrates on the way in. Screens keep
 * reading `s.status` / `s.commits` / `s.branches` and calling the same actions;
 * they never learn that there is more than one repository open.
 *
 * Two rules keep a tab switch from leaking:
 *   - hydration is a TOTAL write of `RepoSlice` (see repoSlice.ts), and
 *   - every fetch/error write goes through `setFor`/`setErrorFor`, which drop a
 *     response that resolved after the user moved to another repository.
 */
interface RepoStoreState extends RepoSlice {
  /**
   * Open `path` into the ACTIVE slice and refresh it, returning the handle (or
   * null on failure, with the error already on the store).
   *
   * The low-level half of opening a repository: it knows nothing about tabs.
   * `useTabsStore.openRepo` is the entry point everything else calls — it
   * dedupes by path, creates the tab, and snapshots the outgoing one.
   */
  openRepoAt: (path: string) => Promise<RepoHandle | null>;
  /** Replace every per-repo field with `slice` (activating a tab). Total write
   *  by contract — see repoSlice.ts. */
  hydrate: (slice: RepoSlice) => void;
  /** Freeze the live per-repo fields (leaving a tab). */
  snapshot: () => RepoSlice;
  /** Put an error back on the banner. Needed because a rollback (a failed open
   *  re-activating the tab you were on) runs a `refreshAll`, which clears
   *  `error` as its first act — same hazard as the refresh-first-error-last
   *  convention in the catch arms. */
  setError: (e: AppError | null) => void;
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
  /**
   * Line-level staging (#61 D7). `selected` holds indices among the hunk's
   * changed (`+`/`-`) lines counted from 0, not indices into `hunk.lines`.
   */
  stageLines: (path: string, hunkIndex: number, selected: number[]) => Promise<void>;
  unstageLines: (path: string, hunkIndex: number, selected: number[]) => Promise<void>;
  discardLines: (path: string, hunkIndex: number, selected: number[]) => Promise<void>;
  commit: (
    message: string,
    amend?: boolean,
    signoff?: boolean,
    /** "Commit as" — null uses the repo config identity. */
    authorOverride?: AuthorOverride | null,
    /** Sign this commit (#61 D6). null follows commit.gpgsign. */
    sign?: boolean | null,
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
  /**
   * Stash only `paths` (#133). `null` when git found nothing to save under that
   * pathspec — a state, not a failure.
   */
  stashSavePaths: (
    opts: StashSaveOptions,
    paths: string[],
  ) => Promise<string | null>;
  /** Rename the entry at `index` (#133). Re-reads the list; see the action. */
  stashRename: (index: number, oid: string, message: string) => Promise<void>;
  stashApply: (index: number) => Promise<void>;
  stashPop: (index: number) => Promise<void>;
  /**
   * Drop a stash entry. `oid` is required and verified backend-side: an index
   * is a reflog POSITION, so a stale one drops a stash nobody picked (#133).
   */
  stashDrop: (index: number, oid: string) => Promise<void>;
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
  /** Drop the backend's retained completed-rebase summary once it's been shown. */
  rebaseAcknowledge: () => Promise<void>;
  // bisect (#93)
  /** `good` may be empty — git then waits for a good revision. */
  bisectStart: (bad: string, good?: string[]) => Promise<void>;
  /** Mark `rev` (default HEAD) and let git pick the next revision to test. */
  bisectMark: (mark: BisectMark, rev?: string | null) => Promise<void>;
  /**
   * `git bisect reset`. NOT `abortOperation`, whose hard reset to HEAD would
   * strand the user on the detached commit they were last testing.
   */
  bisectReset: () => Promise<void>;
  appendGitignore: (pattern: string) => Promise<void>;
  openInEditor: (relativePath: string) => Promise<void>;
}

function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: String(e) };
}

/**
 * Run a network op; on an authentication failure, raise a credential challenge
 * whose retry re-runs the SAME op with credentials (#61 D5).
 *
 * Exported since #93: `git submodule update` and `git lfs fetch/pull` are network
 * ops owned by their own feature stores, and they must use THIS credential flow
 * rather than a second one — a private copy would raise a challenge the shared
 * `CredentialDialog` does not answer.
 *
 * The first attempt is always prompt-less, so the common case (a credential
 * helper or ssh-agent already answers) behaves exactly as it did before. A
 * cancelled dialog never calls `onError`, leaving the original error already
 * reported by the caller's own catch.
 *
 * Exported so a network op owned by ANOTHER feature store can reuse it rather
 * than growing a second retry path — `useForgeStore.checkout` fetches a pull
 * request's head ref, which needs a git-transport credential exactly like
 * fetch/pull/push/pushTag do (#92). Keep it the only implementation.
 */
export async function withAuthRetry(
  repoId: string,
  run: (creds?: Credentials) => Promise<void>,
  onError: (e: unknown) => void | Promise<void>,
): Promise<void> {
  try {
    await run();
    return;
  } catch (e) {
    if (!isAuthError(e)) {
      await onError(e);
      return;
    }
    const { host, kind } = e.message;
    useAuthStore.getState().raise({
      host,
      kind,
      retry: async (creds, remember) => {
        try {
          await run(creds);
          // Only after it worked: storing on submit would persist a typo.
          // HTTPS only: `git credential approve` stores an HTTP(S) password, so
          // remembering an SSH passphrase there would file the wrong secret
          // under `protocol=https` for this host and offer it at the next HTTPS
          // prompt. SSH passphrases belong to ssh-agent, which we do not manage.
          if (remember && host && kind === "Https") {
            await rememberCredential(repoId, host, creds).catch(() => {
              // No helper configured is not a failure the user needs to see —
              // the operation they asked for still succeeded.
            });
          }
        } catch (retryError) {
          await onError(retryError);
        }
      },
    });
  }
}

export const useRepoStore = create<RepoStoreState>((set, get) => {
  /**
   * Apply `patch` only while `repoId` is still the open repository (#90).
   *
   * A tab switch is atomic, but the fetches already in flight are not: a
   * `refreshAll` for repo A can resolve after the user moved to B and would
   * write A's status, log and branches into B's slice. This is the same
   * staleness guard `logRef` and `commitFilter` already carry, on repo identity.
   */
  const setFor = (repoId: string, patch: Partial<RepoStoreState>) => {
    if (get().current?.id !== repoId) return;
    set(patch);
  };
  /** `setFor` for the error banner: a failure in a repository you have left
   *  must not raise a banner over the one you are in. Keeps the
   *  refresh-first-error-last ordering — it is still just a guarded set. */
  const setErrorFor = (repoId: string, e: unknown) => {
    if (get().current?.id !== repoId) return;
    set({ error: toAppError(e) });
  };
  const setActivity = (key: keyof RepoActivity, label: string | null) => {
    set((s) => {
      const next = { ...s.activity };
      if (label === null) delete next[key];
      else next[key] = label;
      return { activity: next };
    });
  };
  /** Open `path` into a freshly reset slice. Throws on failure. */
  const applyOpenedRepo = async (path: string) => {
    const handle = await openRepo(path);
    useRecentsStore.getState().addRecent(handle.path);
    // Total write: every per-repo field is reset, so nothing of the previously
    // open repository can survive into this one (see repoSlice.ts).
    set({ ...emptySlice(), current: handle });
    await get().refreshAll();
  };
  return ({
  ...emptySlice(),

  async openRepoAt(path) {
    set({ loading: true, error: null });
    try {
      await applyOpenedRepo(path);
      return get().current;
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
            return get().current;
          } catch (retryError) {
            set({ loading: false, error: toAppError(retryError) });
            return null;
          }
        }
      }
      // A failed open leaves the slice alone: whatever tab the user was on is
      // still there with its data, and only `loading`/`error` moved.
      set({ loading: false, error: toAppError(e) });
      return null;
    }
  },

  hydrate(slice) {
    // Total write, never a patch — that is the whole anti-leak contract.
    set(slice);
  },

  snapshot() {
    return sliceOf(get());
  },

  setError(e) {
    set({ error: e });
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
      setFor(repo.id, {
        searchResults: page.commits,
        searchCursor: page.nextCursor,
        searching: false,
      });
    } catch (e) {
      setFor(repo.id, { searching: false, error: toAppError(e) });
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
      // A repo switch also invalidates the page: `current` is the repo this
      // walk belongs to, not necessarily the one now open.
      if (get().current?.id !== current.id || get().logRef !== refspec) return;
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
      setErrorFor(current.id, e);
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
      setFor(repo.id, {
        commits: page.commits,
        commitCursor: page.nextCursor,
        loading: false,
      });
      // Re-run an active search under the new scope.
      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      if (get().logRef !== refspec) return;
      setFor(repo.id, { loading: false, error: toAppError(e) });
    }
  },

  async refreshAll() {
    const repo = get().current;
    if (!repo) return;
    set({ loading: true, error: null });
    const logRef = get().logRef;
    try {
      const [
        status,
        branches,
        tags,
        stashes,
        remotes,
        commitPage,
        repoState,
        rebaseStatus,
        bisectStatus,
      ] = await Promise.all([
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
            setFor(repo.id, { logRef: null });
            return getLogPage(repo.id, null, PAGE_SIZE);
          }),
          repoStateFn(repo.id),
          rebaseStatusFn(repo.id),
          // Degrades instead of failing the refresh. `bisect_status` shells out to
          // `git rev-list --bisect-vars` for its progress numbers, and a repository
          // where that cannot run must still show its status, branches and log —
          // the same reasoning as the browsed-ref fallback above. The cost of the
          // fallback is a bar without step counts, not a broken screen.
          bisectStatusFn(repo.id).catch(() => DEFAULT_BISECT_STATUS),
        ]);
      setFor(repo.id, {
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
        bisectStatus,
        loading: false,
      });
      // Keep an active search in sync with the refreshed history.
      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      setFor(repo.id, { loading: false, error: toAppError(e) });
    }
  },

  async refreshStatus() {
    const repo = get().current;
    if (!repo) return;
    set({ error: null });
    try {
      // `bisect_status` joins the pair here because the operation bar's bisect
      // actions must stay live after an index op too. The backend short-circuits
      // on a single `Path::exists()`, so this is free unless a bisect is open.
      const [status, repoState, bisectStatus] = await Promise.all([
        getStatus(repo.id),
        repoStateFn(repo.id),
        // Same degrade-don't-fail policy as `refreshAll`.
        bisectStatusFn(repo.id).catch(() => DEFAULT_BISECT_STATUS),
      ]);
      setFor(repo.id, { status, repoState, bisectStatus });
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  clearError() {
    set({ error: null });
  },

  closeRepo() {
    // Total write via emptySlice(), so a later hydrate of another tab starts
    // from a genuinely empty slice rather than this repo's leftovers.
    set(emptySlice());
  },

  async refreshAllFiles() {
    const repo = get().current;
    if (!repo) return;
    try {
      const allFiles = await listAllFiles(repo.id);
      setFor(repo.id, { allFiles });
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async listFilesAtRev(revspec) {
    const repo = get().current;
    if (!repo) return null;
    try {
      return await listFilesAtRevFn(repo.id, revspec);
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async readFileContentAtRev(revspec, path) {
    const repo = get().current;
    if (!repo) return null;
    try {
      return await readFileContentAtRevFn(repo.id, revspec, path);
    } catch (e) {
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  async unstage(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstagePaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async discard(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardPaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  async unstageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstageHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async discardHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stageLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stageLinesFn(
        repo.id,
        path,
        hunkIndex,
        selected,
        useSettingsStore.getState().diffContextLines,
      );
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async unstageLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstageLinesFn(
        repo.id,
        path,
        hunkIndex,
        selected,
        useSettingsStore.getState().diffContextLines,
      );
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async discardLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardLinesFn(
        repo.id,
        path,
        hunkIndex,
        selected,
        useSettingsStore.getState().diffContextLines,
      );
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async reset(target, mode) {
    const repo = get().current;
    if (!repo) return;
    try {
      await resetFn(repo.id, target, mode);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async commit(
    message,
    amend = false,
    signoff = false,
    authorOverride = null,
    sign = null,
  ) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await commitFn(
        repo.id,
        message,
        amend,
        signoff,
        authorOverride,
        sign,
      );
      await get().refreshAll();
      return oid;
    } catch (e) {
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  // Tag push and remote-branch delete are pushes, so they get the same
  // challenge/retry as push/pull/fetch/clone. D5 threaded the four sites its
  // spec named and left these two on the credential-less path, where an
  // authenticated remote failed with git's stderr and no way to answer it.
  async pushTag(remote, name) {
    const repo = get().current;
    if (!repo) return;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await pushTagFn(repo.id, remote, name, creds);
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
    );
  },

  async pushDeleteBranch(remote, name) {
    const repo = get().current;
    if (!repo) return;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await pushDeleteBranchFn(repo.id, remote, name, creds);
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
    );
  },

  async createBranch(name, from) {
    const repo = get().current;
    if (!repo) return;
    try {
      await createBranch(repo.id, name, from);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async createAndSwitchBranch(name, opts) {
    const repo = get().current;
    if (!repo) return false;
    setActivity("branch", `Creating ${name}…`);
    try {
      await createBranch(repo.id, name, opts?.from);
    } catch (e) {
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  async setUpstream(branch, upstream) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setUpstreamFn(repo.id, branch, upstream);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async createTag(name, target) {
    const repo = get().current;
    if (!repo) return;
    try {
      await createTag(repo.id, name, target);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async deleteTag(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await deleteTag(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  async cherryPickMany(oids) {
    const repo = get().current;
    if (!repo) return;
    try {
      // Apply oldest→newest (the caller orders them). Each clean pick
      // auto-commits and moves HEAD; the next applies on top. A conflicting
      // pick throws (ConflictsDetected), stopping the sequence and leaving the
      // repo in a conflicted CherryPick state — which the operation bar then
      // announces. Refresh once at the end rather than per pick.
      for (const oid of oids) {
        await cherryPick(repo.id, oid);
      }
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  async stashPop(index) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashPop(repo.id, index);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashDrop(index, oid) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashDrop(repo.id, index, oid);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashBranch(index, branch) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashBranchFn(repo.id, index, branch);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashSavePaths(opts, paths) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await stashSavePaths(repo.id, opts, paths);
      await get().refreshAll();
      return oid;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async stashRename(index, oid, message) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashRenameFn(repo.id, index, oid, message);
      // `refreshAll`, never a local patch of `stashes`: a rename is a store
      // followed by a drop and `refs/stash` can only be prepended to, so the
      // renamed entry lands at index 0 and everything between it and its old
      // position shifts down. Anything holding the old indices addresses the
      // wrong entry on the next click.
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async fetch(remote) {
    const repo = get().current;
    if (!repo) return;
    setActivity("fetch", `Fetching ${remote}…`);
    try {
      await withAuthRetry(
        repo.id,
        async (creds) => {
          await fetchRemote(
            repo.id,
            remote,
            useSettingsStore.getState().pruneOnFetch,
            creds,
          );
          await get().refreshAll();
        },
        (e) => setErrorFor(repo.id, e),
      );
    } finally {
      setActivity("fetch", null);
    }
  },

  async fetchAll() {
    const repo = get().current;
    if (!repo) return;
    setActivity("fetch", "Fetching all remotes…");
    try {
      await withAuthRetry(
        repo.id,
        async (creds) => {
          await fetchAll(repo.id, useSettingsStore.getState().pruneOnFetch, creds);
          await get().refreshAll();
        },
        (e) => setErrorFor(repo.id, e),
      );
    } finally {
      setActivity("fetch", null);
    }
  },

  async pull(remote, branch, mode = "Merge") {
    const repo = get().current;
    if (!repo) return;
    // Declared OUTSIDE the retried closure on purpose. An auth failure leaves
    // the stash in place (see the failure policy below) and then re-runs this
    // closure with credentials; a per-attempt variable would start at null, find
    // the now-clean tree, pull successfully and never pop — silently stranding
    // the user's uncommitted work in a stash they were never told about.
    let stashed: string | null = null;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        // Each attempt owns its own progress indicator: the retry runs long
        // after the first attempt's `finally` would have cleared it.
        setActivity("pull", `Pulling ${remote}/${branch}…`);
        try {
          // Carry over uncommitted work when the setting is on: stash → pull →
          // pop, mirroring checkoutBranch's auto-stash. stashSave returns null
          // when the tree is clean, so this is a no-op in the common case. If
          // the pull fails, the stash is deliberately NOT popped — the work
          // stays safe in the stash list rather than colliding with a conflicted
          // worktree (same policy as checkoutBranch).
          if (useSettingsStore.getState().autoStashBeforePull && stashed === null) {
            setActivity("pull", "Stashing changes…");
            stashed = await stashSave(repo.id, {
              message: `auto: pull ${remote}/${branch}`,
              includeUntracked: true,
              keepIndex: false,
            });
            setActivity("pull", `Pulling ${remote}/${branch}…`);
          }
          await pullRemote(repo.id, remote, branch, mode, creds);
          if (stashed) {
            setActivity("pull", "Restoring stashed changes…");
            await stashPop(repo.id, 0);
            // Popped — a later attempt must not pop it a second time.
            stashed = null;
          }
          await get().refreshAll();
        } finally {
          setActivity("pull", null);
        }
      },
      async (e) => {
        // See mergeBranch's catch: refresh first, error last, so it isn't
        // batched away by refreshAll's own `error: null` reset.
        await get().refreshAll();
        setErrorFor(repo.id, e);
      },
    );
  },

  async push(remote, branch, force = "None") {
    const repo = get().current;
    if (!repo) return;
    setActivity("push", `Pushing ${remote}/${branch}…`);
    try {
      await withAuthRetry(
        repo.id,
        async (creds) => {
          await pushRemote(repo.id, remote, branch, force, creds);
          await get().refreshAll();
        },
        (e) => setErrorFor(repo.id, e),
      );
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
      setErrorFor(repo.id, e);
    }
  },

  async removeRemote(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await removeRemote(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async renameRemote(from, to) {
    const repo = get().current;
    if (!repo) return;
    try {
      await renameRemote(repo.id, from, to);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async setRemoteUrl(name, url) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setRemoteUrl(repo.id, name, url);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async pruneRemote(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await pruneRemote(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async acceptOurs(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await acceptOurs(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async acceptTheirs(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await acceptTheirs(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async markResolved(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await markResolved(repo.id, paths);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
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
      // Refresh BEFORE recording the error (see mergeBranch): refreshAll clears
      // `error` as its first act, and React batches same-tick sets. A `git
      // rebase --continue` that stops on the NEXT conflict fails here with the
      // repository already moved on, so the operation bar must re-read disk.
      await get().refreshAll();
      setErrorFor(repo.id, e);
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
      setErrorFor(repo.id, e);
    }
  },

  async restartConflict(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await restartConflictFn(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async rebaseStart(plan) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const status = await rebaseStartFn(repo.id, plan);
      setFor(repo.id, { rebaseStatus: status });
      await get().refreshAll();
      return status;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async rebaseContinue() {
    const repo = get().current;
    if (!repo) return null;
    try {
      const status = await rebaseContinueFn(repo.id);
      setFor(repo.id, { rebaseStatus: status });
      await get().refreshAll();
      return status;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async rebaseAbort() {
    const repo = get().current;
    if (!repo) return;
    try {
      await rebaseAbort(repo.id);
      setFor(repo.id, { rebaseStatus: DEFAULT_REBASE_STATUS });
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async rebaseAcknowledge() {
    const repo = get().current;
    if (!repo) return;
    try {
      await rebaseAcknowledgeFn(repo.id);
      // Mirror the drop locally instead of a full refreshAll: acknowledging is
      // a notice being dismissed, not a change to the repository, and a refresh
      // here would re-walk the log on every visit to the Rebase screen.
      setFor(repo.id, {
        rebaseStatus: { ...get().rebaseStatus, lastCompleted: null },
      });
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async bisectStart(bad, good = []) {
    const repo = get().current;
    if (!repo) return;
    try {
      const status = await bisectStartFn(repo.id, bad, good);
      set({ bisectStatus: status });
      // A bisect checks out a revision to test, so the whole world moved.
      await get().refreshAll();
    } catch (e) {
      // Danger-op convention: refresh first, error last, so refreshAll's own
      // `error: null` reset cannot batch the banner away.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async bisectMark(mark, rev = null) {
    const repo = get().current;
    if (!repo) return;
    try {
      const status = await bisectMarkFn(repo.id, mark, rev);
      set({ bisectStatus: status });
      await get().refreshAll();
    } catch (e) {
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async bisectReset() {
    const repo = get().current;
    if (!repo) return;
    try {
      await bisectResetFn(repo.id);
      set({ bisectStatus: DEFAULT_BISECT_STATUS });
      await get().refreshAll();
    } catch (e) {
      await get().refreshAll();
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
      setErrorFor(repo.id, e);
    }
  },

  async openInEditor(relativePath) {
    const repo = get().current;
    if (!repo) return;
    try {
      await openInEditorFn(repo.id, relativePath);
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },
  });
});
