import { create } from "zustand";

import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { cloneRepo, initRepo } from "@/lib/tauri";
import type { CloneProgress } from "@/lib/types";
import { appErrorMessage } from "@/lib/errors";

type OpenDialog = "none" | "clone" | "init";

interface CreateState {
  open: OpenDialog;
  busy: boolean;
  progress: CloneProgress | null;
  error: string | null;
  openClone: () => void;
  openInit: () => void;
  close: () => void;
  setProgress: (p: CloneProgress) => void;
  runClone: (args: {
    url: string;
    parentDir: string;
    name: string;
    recurseSubmodules: boolean;
  }) => Promise<void>;
  runInit: (args: {
    parentDir: string;
    name: string;
    branch: string;
  }) => Promise<void>;
}

export const useCreateStore = create<CreateState>((set, get) => ({
  open: "none",
  busy: false,
  progress: null,
  error: null,

  // Guarded against `busy`: a clone/init in flight has no cancel, so a chord
  // or palette command that swaps `open` to the other dialog mid-run would
  // unmount the running dialog's view behind a disabled, undismissable one —
  // and once the run finishes, its result (including a failure) would render
  // into the wrong dialog's error slot.
  openClone: () => {
    if (get().busy) return;
    set({ open: "clone", error: null, progress: null });
  },
  openInit: () => {
    if (get().busy) return;
    set({ open: "init", error: null, progress: null });
  },
  // Never closes mid-run: a clone in flight has no cancel, so dropping the
  // dialog would leave a git process with no UI attached to it.
  close: () => {
    if (get().busy) return;
    set({ open: "none", error: null, progress: null });
  },
  setProgress: (p) => set({ progress: p }),

  async runClone({ url, parentDir, name, recurseSubmodules }) {
    set({ busy: true, error: null, progress: null });
    try {
      const dest = await cloneRepo(url, parentDir, name, recurseSubmodules);
      useSettingsStore.getState().set("lastCreateDir", parentDir);
      // busy false BEFORE close(), which refuses to close while busy.
      set({ busy: false, progress: null });
      set({ open: "none" });
      await useRepoStore.getState().openRepo(dest);
    } catch (e) {
      // Error stays in the dialog: the user needs the form still populated to
      // fix a bad URL and retry.
      set({ busy: false, progress: null, error: appErrorMessage(e) });
    }
  },

  async runInit({ parentDir, name, branch }) {
    set({ busy: true, error: null });
    try {
      const path = `${parentDir}/${name}`;
      const handle = await initRepo(path, branch);
      useSettingsStore.getState().set("lastCreateDir", parentDir);
      set({ busy: false, open: "none" });
      await useRepoStore.getState().openRepo(handle.path);
    } catch (e) {
      set({ busy: false, error: appErrorMessage(e) });
    }
  },
}));
