// Submodule state (#93). Its own store, because submodules are a per-screen
// concern that `useRepoStore` does not need to refresh on every index op — the
// only thing the repo store carries about them is `FileStatus.submodule`.

import { create } from "zustand";
import type { AppError } from "@/lib/errors";
import { isAppError } from "@/lib/errors";
import type { SubmoduleInfo } from "@/lib/types";
import {
  listSubmodules,
  submoduleInit,
  submoduleSync,
  submoduleUpdate,
} from "@/lib/tauri";
import { useRepoStore, withAuthRetry } from "@/features/repo/useRepoStore";

const RECURSIVE_KEY = "pg-submodule-recursive";

function readRecursive(): boolean {
  try {
    return localStorage.getItem(RECURSIVE_KEY) === "1";
  } catch {
    return false;
  }
}

function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: String(e) };
}

/** Absolute path of a submodule's checkout, for "open as repository". */
export function submoduleAbsPath(repoPath: string, subPath: string): string {
  const base = repoPath.replace(/[/\\]+$/, "");
  return `${base}/${subPath}`;
}

interface SubmodulesState {
  items: SubmoduleInfo[];
  loading: boolean;
  error: AppError | null;
  /** Submodule path whose op is in flight, or `"*"` for a whole-repo op. */
  busy: string | null;
  /** `--recursive` on update, persisted: a repo with nested submodules wants it
   *  every time, and re-ticking a checkbox per update is friction. */
  recursive: boolean;
  setRecursive: (v: boolean) => void;
  refresh: () => Promise<void>;
  /** `path` omitted = every submodule. */
  init: (path?: string | null) => Promise<void>;
  sync: (path?: string | null) => Promise<void>;
  update: (path?: string | null) => Promise<void>;
  /** Open the submodule's own checkout as the app's repository. */
  openAsRepo: (path: string) => Promise<void>;
  clearError: () => void;
}

export const useSubmodulesStore = create<SubmodulesState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  busy: null,
  recursive: readRecursive(),

  setRecursive(v) {
    set({ recursive: v });
    try {
      localStorage.setItem(RECURSIVE_KEY, v ? "1" : "0");
    } catch {
      // Private-mode / disabled storage: the toggle still works for this session.
    }
  },

  clearError() {
    set({ error: null });
  },

  async refresh() {
    const repo = useRepoStore.getState().current;
    if (!repo) {
      set({ items: [], error: null });
      return;
    }
    set({ loading: true, error: null });
    try {
      set({ items: await listSubmodules(repo.id), loading: false });
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
    }
  },

  async init(path) {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    set({ busy: path ?? "*", error: null });
    try {
      await submoduleInit(repo.id, path ?? null);
      await get().refresh();
    } catch (e) {
      await get().refresh();
      set({ error: toAppError(e) });
    } finally {
      set({ busy: null });
    }
  },

  async sync(path) {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    set({ busy: path ?? "*", error: null });
    try {
      await submoduleSync(repo.id, path ?? null);
      await get().refresh();
    } catch (e) {
      await get().refresh();
      set({ error: toAppError(e) });
    } finally {
      set({ busy: null });
    }
  },

  async update(path) {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    set({ busy: path ?? "*", error: null });
    const recursive = get().recursive;
    try {
      // Updating fetches when the recorded commit is missing, so it goes through
      // the SHARED credential flow: prompt-less first, and an `Auth` failure
      // raises the same challenge the rest of the app answers.
      await withAuthRetry(
        repo.id,
        async (creds) => {
          // `init: true` — `git submodule update --init`, git's own one-shot, and
          // idempotent on an already-initialized submodule.
          await submoduleUpdate(repo.id, path ?? null, recursive, true, creds);
          await get().refresh();
          // A pointer that moved changes the superproject's status too.
          await useRepoStore.getState().refreshStatus();
        },
        async (e) => {
          await get().refresh();
          set({ error: toAppError(e) });
        },
      );
    } finally {
      set({ busy: null });
    }
  },

  async openAsRepo(path) {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    // No new backend op needed: a submodule checkout IS a repository.
    await useRepoStore.getState().openRepo(submoduleAbsPath(repo.path, path));
  },
}));
