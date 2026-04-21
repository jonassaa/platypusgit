import { create } from "zustand";
import type { FileStatus, RepoHandle } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { isAppError } from "@/lib/errors";
import { getStatus, openRepo } from "@/lib/tauri";

interface RepoState {
  current: RepoHandle | null;
  status: FileStatus[];
  loading: boolean;
  error: AppError | null;
  openRepo: (path: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
  clearError: () => void;
}

export const useRepoStore = create<RepoState>((set, get) => ({
  current: null,
  status: [],
  loading: false,
  error: null,

  async openRepo(path: string) {
    set({ loading: true, error: null });
    try {
      const handle = await openRepo(path);
      set({ current: handle });
      const status = await getStatus(handle.id);
      set({ status, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: isAppError(e)
          ? e
          : { kind: "Internal", message: String(e) },
      });
    }
  },

  async refreshStatus() {
    const repo = get().current;
    if (!repo) return;
    set({ loading: true, error: null });
    try {
      const status = await getStatus(repo.id);
      set({ status, loading: false });
    } catch (e) {
      set({
        loading: false,
        error: isAppError(e)
          ? e
          : { kind: "Internal", message: String(e) },
      });
    }
  },

  clearError() {
    set({ error: null });
  },
}));
