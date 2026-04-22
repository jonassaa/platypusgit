import { create } from "zustand";
import type {
  BranchInfo,
  CommitInfo,
  FileStatus,
  RemoteInfo,
  RepoHandle,
  StashInfo,
  TagInfo,
} from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { isAppError } from "@/lib/errors";
import {
  checkoutBranch,
  commit as commitFn,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  discardPaths,
  getLog,
  getStatus,
  listBranches,
  listRemotes,
  listStashes,
  listTags,
  openRepo,
  renameBranch,
  reset as resetFn,
  stagePaths,
  unstagePaths,
  type ResetMode,
  type TagTarget,
} from "@/lib/tauri";
import { useRecentsStore } from "./useRecentsStore";

interface RepoState {
  current: RepoHandle | null;
  status: FileStatus[];
  branches: BranchInfo[];
  tags: TagInfo[];
  stashes: StashInfo[];
  remotes: RemoteInfo[];
  commits: CommitInfo[];
  loading: boolean;
  error: AppError | null;
  openRepo: (path: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  clearError: () => void;
  closeRepo: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  commit: (message: string, amend?: boolean) => Promise<string | null>;
  reset: (target: string, mode: ResetMode) => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  createBranch: (name: string, from?: string) => Promise<void>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  renameBranch: (from: string, to: string) => Promise<void>;
  createTag: (name: string, target: TagTarget) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
}

function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: String(e) };
}

export const useRepoStore = create<RepoState>((set, get) => ({
  current: null,
  status: [],
  branches: [],
  tags: [],
  stashes: [],
  remotes: [],
  commits: [],
  loading: false,
  error: null,

  async openRepo(path) {
    set({ loading: true, error: null });
    try {
      const handle = await openRepo(path);
      useRecentsStore.getState().addRecent(handle.path);
      set({
        current: handle,
        status: [],
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
      const [status, branches, tags, stashes, remotes, commits] = await Promise.all([
        getStatus(repo.id),
        listBranches(repo.id),
        listTags(repo.id),
        listStashes(repo.id),
        listRemotes(repo.id),
        getLog(repo.id, 500),
      ]);
      set({ status, branches, tags, stashes, remotes, commits, loading: false });
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
      branches: [],
      tags: [],
      stashes: [],
      remotes: [],
      commits: [],
      error: null,
    });
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

  async commit(message, amend = false) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await commitFn(repo.id, message, amend);
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
    try {
      await checkoutBranch(repo.id, name);
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
}));
