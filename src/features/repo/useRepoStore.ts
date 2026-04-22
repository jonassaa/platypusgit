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
  getLog,
  getStatus,
  listBranches,
  listRemotes,
  listStashes,
  listTags,
  openRepo,
} from "@/lib/tauri";

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
}));
