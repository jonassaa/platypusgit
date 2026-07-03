import { create } from "zustand";
import type { FileDiff, ReflogEntry } from "@/lib/types";
import type { AppError } from "@/lib/errors";
import { isAppError } from "@/lib/errors";
import {
  checkoutDetached,
  createBranch as createBranchFn,
  diffCommits,
  getReflog,
  reset as resetFn,
  stashSave,
} from "@/lib/tauri";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

export type ReflogActionChoice = "reset" | "checkout" | "branch";

interface ReflogState {
  entries: ReflogEntry[];
  selectedOid: string | null;
  previewDiff: FileDiff[] | null;
  previewLoading: boolean;
  loading: boolean;
  error: AppError | null;
  rememberedAction: ReflogActionChoice | null;

  loadReflog: () => Promise<void>;
  selectEntry: (oid: string | null) => Promise<void>;
  resetBranchTo: (oid: string) => Promise<void>;
  checkoutAt: (oid: string) => Promise<void>;
  createBranchAt: (oid: string, name: string) => Promise<void>;
  stashAndThen: (action: () => Promise<void>) => Promise<void>;
  discardAndThen: (action: () => Promise<void>) => Promise<void>;
  rememberAction: (a: ReflogActionChoice) => void;
  clearRememberedAction: () => void;
  clearError: () => void;
}

function toAppError(e: unknown): AppError {
  return isAppError(e) ? e : { kind: "Internal", message: String(e) };
}

function currentRepoId(): string | null {
  return useRepoStore.getState().current?.id ?? null;
}

export const useReflogStore = create<ReflogState>((set, get) => ({
  entries: [],
  selectedOid: null,
  previewDiff: null,
  previewLoading: false,
  loading: false,
  error: null,
  rememberedAction: null,

  async loadReflog() {
    const repoId = currentRepoId();
    if (!repoId) return;
    set({ loading: true, error: null });
    try {
      const entries = await getReflog(repoId);
      set({ entries, loading: false });
    } catch (e) {
      set({ loading: false, error: toAppError(e) });
    }
  },

  async selectEntry(oid) {
    set({ selectedOid: oid, previewDiff: null });
    if (!oid) return;
    const repoId = currentRepoId();
    if (!repoId) return;
    // Read current HEAD from repo store (most recent commit) to diff against.
    const head = useRepoStore.getState().commits[0]?.oid;
    if (!head) {
      set({ previewDiff: [] });
      return;
    }
    set({ previewLoading: true });
    try {
      const diff = await diffCommits(
        repoId,
        head,
        oid,
        useSettingsStore.getState().diffContextLines,
      );
      set({ previewDiff: diff, previewLoading: false });
    } catch (e) {
      set({ previewLoading: false, error: toAppError(e) });
    }
  },

  async resetBranchTo(oid) {
    const repoId = currentRepoId();
    if (!repoId) return;
    try {
      await resetFn(repoId, oid, "Hard");
      await useRepoStore.getState().refreshAll();
      await get().loadReflog();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async checkoutAt(oid) {
    const repoId = currentRepoId();
    if (!repoId) return;
    try {
      await checkoutDetached(repoId, oid);
      await useRepoStore.getState().refreshAll();
      await get().loadReflog();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async createBranchAt(oid, name) {
    const repoId = currentRepoId();
    if (!repoId) return;
    try {
      await createBranchFn(repoId, name, oid);
      await useRepoStore.getState().refreshAll();
      await get().loadReflog();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async stashAndThen(action) {
    const repoId = currentRepoId();
    if (!repoId) return;
    const ts = new Date().toISOString();
    try {
      await stashSave(repoId, {
        message: `platypus: auto-stash before reflog jump ${ts}`,
        includeUntracked: true,
        keepIndex: false,
      });
      await action();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  async discardAndThen(action) {
    const repoId = currentRepoId();
    if (!repoId) return;
    try {
      await resetFn(repoId, "HEAD", "Hard");
      await action();
    } catch (e) {
      set({ error: toAppError(e) });
    }
  },

  rememberAction(a) {
    set({ rememberedAction: a });
  },
  clearRememberedAction() {
    set({ rememberedAction: null });
  },
  clearError() {
    set({ error: null });
  },
}));
