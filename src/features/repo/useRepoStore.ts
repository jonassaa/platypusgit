import { create } from "zustand";
import type {
  BranchInfo,
  CommitInfo,
  FileContent,
  FileStatus,
  RebaseStatus,
  RebaseStep,
  RemoteInfo,
  RepoHandle,
  RepoState as GitRepoState,
  StashInfo,
  TagInfo,
} from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { isAppError } from "@/lib/errors";
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
  getLog,
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
  loading: boolean;
  error: AppError | null;
  repoState: GitRepoState;
  rebaseStatus: RebaseStatus;
  /** Active long-running ops keyed by op kind. */
  activity: RepoActivity;
  openRepo: (path: string) => Promise<void>;
  refreshAll: () => Promise<void>;
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
  mergeBranch: (name: string) => Promise<void>;
  rebaseOnto: (upstream: string) => Promise<void>;
  createTag: (name: string, target: TagTarget) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  pushTag: (remote: string, name: string) => Promise<void>;
  pushDeleteBranch: (remote: string, name: string) => Promise<void>;
  cherryPick: (oid: string) => Promise<void>;
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
  return ({
  current: null,
  status: [],
  allFiles: [],
  branches: [],
  tags: [],
  stashes: [],
  remotes: [],
  commits: [],
  loading: false,
  error: null,
  repoState: "Clean",
  rebaseStatus: DEFAULT_REBASE_STATUS,
  activity: {},

  async openRepo(path) {
    set({ loading: true, error: null });
    try {
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
      });
      await get().refreshAll();
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
    }
  },

  async refreshAll() {
    const repo = get().current;
    if (!repo) return;
    set({ loading: true, error: null });
    try {
      const [status, branches, tags, stashes, remotes, commits, repoState, rebaseStatus] =
        await Promise.all([
          getStatus(repo.id),
          listBranches(repo.id),
          listTags(repo.id),
          listStashes(repo.id),
          listRemotes(repo.id),
          getLog(repo.id, 500),
          repoStateFn(repo.id),
          rebaseStatusFn(repo.id),
        ]);
      set({
        status,
        branches,
        tags,
        stashes,
        remotes,
        commits,
        repoState,
        rebaseStatus,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
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
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async unstage(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstagePaths(repo.id, paths);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async discard(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardPaths(repo.id, paths);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async stageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stageHunk(repo.id, path, hunkIndex);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async unstageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstageHunk(repo.id, path, hunkIndex);
      await get().refreshAll();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async discardHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardHunk(repo.id, path, hunkIndex);
      await get().refreshAll();
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

  async commit(message, amend = false, signoff = false) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await commitFn(repo.id, message, amend, signoff);
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
      await fetchRemote(repo.id, remote);
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
      await fetchAll(repo.id);
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
      await pullRemote(repo.id, remote, branch, mode);
      await get().refreshAll();
    } catch (e) {
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
      set({ rebaseStatus: status });
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
      set({ rebaseStatus: status });
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
      set({ rebaseStatus: DEFAULT_REBASE_STATUS });
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
