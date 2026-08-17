// Linked-worktree state (#93).
//
// The destructive flows live HERE rather than in the screen, because the screen
// and the row context menu both need them and a duplicated confirm is a
// duplicated chance to get the gate wrong.

import { create } from "zustand";
import { pgConfirm, pgPrompt } from "@/design";
import type { AppError } from "@/lib/errors";
import { toAppError } from "@/lib/errors";
import type { WorktreeBranch, WorktreeInfo } from "@/lib/types";
import {
  listWorktrees,
  worktreeAdd,
  worktreeLock,
  worktreePrune,
  worktreeRemove,
  worktreeUnlock,
} from "@/lib/tauri";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useRepoStore } from "@/features/repo/useRepoStore";

interface WorktreesState {
  items: WorktreeInfo[];
  loading: boolean;
  error: AppError | null;
  /** Worktree name whose op is in flight, or `"*"` for a whole-repo op. */
  busy: string | null;
  refresh: () => Promise<void>;
  /** Create a worktree. Returns true on success (the dialog closes on true). */
  add: (path: string, branch: WorktreeBranch) => Promise<boolean>;
  /**
   * Remove a worktree behind TWO gates: a `pgConfirm` for the admin files, and —
   * only if git refuses because the worktree holds uncommitted work — a second,
   * type-the-name confirm that passes `--force`. The first gate is about deleting
   * a checkout; the second is about deleting somebody's unsaved work, and they
   * are not the same decision.
   */
  remove: (name: string) => Promise<void>;
  toggleLock: (worktree: WorktreeInfo) => Promise<void>;
  /** Prune every worktree whose directory vanished, behind a confirm. */
  prune: () => Promise<void>;
  /** Open a linked worktree as the app's repository. */
  openAsRepo: (path: string) => Promise<void>;
  clearError: () => void;
}

export const useWorktreesStore = create<WorktreesState>((set, get) => ({
  items: [],
  loading: false,
  error: null,
  busy: null,

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
      set({ items: await listWorktrees(repo.id), loading: false });
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
    }
  },

  async add(path, branch) {
    const repo = useRepoStore.getState().current;
    if (!repo) return false;
    set({ busy: "*", error: null });
    try {
      await worktreeAdd(repo.id, path, branch);
      await get().refresh();
      // A new worktree can create a branch, so the branch list moved too.
      await useRepoStore.getState().refreshAll();
      return true;
    } catch (e) {
      await get().refresh();
      set({ error: toAppError(e) });
      return false;
    } finally {
      set({ busy: null });
    }
  },

  async remove(name) {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    const target = get().items.find((w) => w.name === name);
    if (
      !(await pgConfirm({
        title: `Remove worktree "${name}"?`,
        body: `Deletes ${target?.path ?? "the worktree directory"} and its git admin files. The branch it has checked out is left alone.`,
        danger: true,
        confirmLabel: "Remove",
      }))
    ) {
      return;
    }
    set({ busy: name, error: null });
    try {
      await worktreeRemove(repo.id, name, false);
      await get().refresh();
      return;
    } catch (e) {
      const err = toAppError(e);
      if (err.kind !== "DirtyWorktree") {
        await get().refresh();
        set({ error: err });
        return;
      }
      // git refused because there is uncommitted work in there. That is a
      // different, larger decision than the one already confirmed, so it gets its
      // own gate — and a typed name, because the work is unrecoverable.
      const forced = await pgConfirm({
        title: `"${name}" has uncommitted changes`,
        body: "Removing it now discards them permanently. Type the worktree name to confirm.",
        danger: true,
        confirmLabel: "Discard and remove",
        requireText: name,
      });
      if (!forced) {
        await get().refresh();
        return;
      }
      try {
        await worktreeRemove(repo.id, name, true);
        await get().refresh();
      } catch (forceError) {
        await get().refresh();
        set({ error: toAppError(forceError) });
      }
    } finally {
      set({ busy: null });
    }
  },

  async toggleLock(worktree) {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    set({ busy: worktree.name, error: null });
    try {
      if (worktree.locked) {
        await worktreeUnlock(repo.id, worktree.name);
      } else {
        // A reason is optional but worth asking for: it is what the row shows,
        // and what tells the next person why prune skips this one.
        const reason = await pgPrompt({
          title: `Lock "${worktree.name}"`,
          body: "A locked worktree is never pruned, even if its directory is missing. The reason is shown on the row.",
          placeholder: "on an external drive",
          confirmLabel: "Lock",
        });
        // Dismissal (null) cancels; an empty string is a lock with no reason.
        if (reason === null) {
          set({ busy: null });
          return;
        }
        await worktreeLock(repo.id, worktree.name, reason || null);
      }
      await get().refresh();
    } catch (e) {
      await get().refresh();
      set({ error: toAppError(e) });
    } finally {
      set({ busy: null });
    }
  },

  async prune() {
    const repo = useRepoStore.getState().current;
    if (!repo) return;
    const prunable = get().items.filter((w) => w.prunable);
    if (prunable.length === 0) return;
    if (
      !(await pgConfirm({
        title: `Prune ${prunable.length} worktree${prunable.length === 1 ? "" : "s"}?`,
        body: `Forgets the admin files for ${prunable
          .map((w) => w.name)
          .join(", ")}, whose directories are already gone. Nothing on disk is deleted.`,
        confirmLabel: "Prune",
      }))
    ) {
      return;
    }
    set({ busy: "*", error: null });
    try {
      await worktreePrune(repo.id);
      await get().refresh();
    } catch (e) {
      await get().refresh();
      set({ error: toAppError(e) });
    } finally {
      set({ busy: null });
    }
  },

  async openAsRepo(path) {
    await useTabsStore.getState().openRepo(path);
  },
}));
