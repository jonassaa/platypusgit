import { create } from "zustand";

import { confirmTrust } from "@/features/repo/ownership";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  cancelOperation,
  cloneRepo,
  closeRepo as closeRepoIpc,
  initRepo,
  rememberCredential,
  trustRepoPath,
  type Credentials,
} from "@/lib/tauri";
import { newOpId } from "@/lib/opId";
import type { CloneProgress, RepoHandle } from "@/lib/types";
import {
  appErrorMessage,
  dubiousOwnershipPath,
  isAuthError,
  isCancelledError,
  isDubiousOwnershipError,
} from "@/lib/errors";

type OpenDialog = "none" | "clone" | "init";

interface CreateState {
  open: OpenDialog;
  busy: boolean;
  progress: CloneProgress | null;
  error: string | null;
  /**
   * The running clone's backend op id, or null (#234).
   *
   * Also what the dialog's Cancel button is gated on: a clone with no id is one
   * the backend cannot be asked to stop, so the button must not offer to.
   */
  cloneOpId: string | null;
  openClone: () => void;
  openInit: () => void;
  close: () => void;
  /**
   * Stop the running clone (#234). Returns immediately; `runClone`'s own catch
   * closes the dialog when the backend confirms with `AppError::Cancelled`,
   * which is also what guarantees the half-written destination has been removed
   * before the dialog says it is over.
   */
  cancelClone: () => void;
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
  cloneOpId: null,

  // Guarded against `busy`: a chord or palette command that swaps `open` to the
  // other dialog mid-run would unmount the running dialog's view — taking the
  // Cancel button for the op with it — and once the run finishes, its result
  // (including a failure) would render into the wrong dialog's error slot.
  openClone: () => {
    if (get().busy) return;
    set({ open: "clone", error: null, progress: null });
  },
  openInit: () => {
    if (get().busy) return;
    set({ open: "init", error: null, progress: null });
  },
  // Still never closes mid-run — but the way out is now Cancel, not waiting.
  // Dropping the dialog while a clone runs would leave a git process with no UI
  // attached to it AND a half-written destination nobody is going to clean up;
  // `cancelClone` does both, and this closes once the backend has confirmed.
  close: () => {
    if (get().busy) return;
    set({ open: "none", error: null, progress: null });
  },

  cancelClone: () => {
    const opId = get().cloneOpId;
    if (!opId) return;
    // Fire and forget: `runClone`'s catch owns the transition out of `busy`,
    // because only it knows the backend finished cleaning up. A failed cancel
    // means the clone had already finished — which is the outcome the user wanted
    // reported by the clone itself, not by an error here.
    void cancelOperation(opId).catch(() => {});
  },
  setProgress: (p) => set({ progress: p }),

  async runClone({ url, parentDir, name, recurseSubmodules }) {
    set({ busy: true, error: null, progress: null });

    const attempt = async (creds?: Credentials) => {
      // A fresh id per attempt. The credential retry is a SECOND `git clone`, so
      // reusing the first attempt's id would leave the Cancel button pointed at
      // a process that has already exited.
      const opId = newOpId("clone");
      set({ cloneOpId: opId });
      try {
        const dest = await cloneRepo(
          url,
          parentDir,
          name,
          recurseSubmodules,
          creds,
          opId,
        );
        useSettingsStore.getState().set("lastCreateDir", parentDir);
        // busy false BEFORE close(), which refuses to close while busy.
        set({ busy: false, progress: null });
        set({ open: "none" });
        await useTabsStore.getState().openRepo(dest);
      } finally {
        set({ cloneOpId: null });
      }
    };

    /**
     * A cancelled clone closes the dialog and says nothing.
     *
     * By the time this rejection arrives the backend has already removed the
     * half-written destination, so there is nothing left for the user to decide
     * — and an error banner reading "operation cancelled" over the form they
     * just dismissed is the app arguing with them.
     */
    const settleCancel = () => {
      set({ busy: false, progress: null, error: null, cloneOpId: null });
      set({ open: "none" });
    };

    try {
      await attempt();
    } catch (e) {
      if (isCancelledError(e)) {
        settleCancel();
        return;
      }
      // A private remote is exactly what the credential flow exists for. The
      // backend already classifies clone failures as AppError::Auth and
      // clone_repo already takes credentials; without raising the challenge the
      // Clone dialog just printed "Authentication required" with no way to
      // answer it.
      if (!isAuthError(e)) {
        // Error stays in the dialog: the user needs the form still populated to
        // fix a bad URL and retry.
        set({ busy: false, progress: null, error: appErrorMessage(e) });
        return;
      }
      const { host, kind } = e.message;
      // Drop `busy` before prompting. `close()` refuses to close while busy, so
      // staying busy would leave the Clone dialog undismissable if the user
      // cancels the credential prompt.
      set({ busy: false, progress: null, error: null });
      useAuthStore.getState().raise({
        host,
        kind,
        retry: async (creds, remember) => {
          set({ busy: true, error: null, progress: null });
          try {
            await attempt(creds);
            // Only after it worked, and only for HTTPS — `git credential
            // approve` stores an HTTP(S) password. Needs the freshly opened repo
            // to run the helper in, so this comes after `attempt` succeeded.
            if (remember && host && kind === "Https") {
              const repo = useRepoStore.getState().current;
              if (repo) {
                await rememberCredential(repo.id, host, creds).catch(() => {
                  // No helper configured is not a failure worth surfacing — the
                  // clone the user asked for still succeeded.
                });
              }
            }
          } catch (retryError) {
            if (isCancelledError(retryError)) {
              settleCancel();
              return;
            }
            set({
              busy: false,
              progress: null,
              error: appErrorMessage(retryError),
            });
          }
        },
      });
    }
  },

  async runInit({ parentDir, name, branch }) {
    set({ busy: true, error: null });
    const path = `${parentDir}/${name}`;
    const finish = async (handle: RepoHandle) => {
      useSettingsStore.getState().set("lastCreateDir", parentDir);
      set({ busy: false, open: "none" });
      // `init_repo` goes through `open` so the repository lands in the backend's
      // map, which means the handle it answers with is a REGISTERED RepoId — and
      // `openRepo` below mints a second one for the same path, because `open`
      // never reuses an entry and only `close_repo` removes one. Nothing here
      // reads the handle past its path, so evict it BEFORE delegating, or it is a
      // git2::Repository held for the life of the process (issue 177's leak,
      // through the New-repository door instead of the launch one).
      const path = handle.path;
      await closeRepoIpc(handle.id).catch(() => {});
      await useTabsStore.getState().openRepo(path);
    };
    try {
      await finish(await initRepo(path, branch));
    } catch (e) {
      // Initialising on a Windows drive under WSL trips the same ownership
      // check as opening one — libgit2 opens what it just created. Offer the
      // same remedy here, or the Init dialog is a dead end for exactly the
      // users issue #83 is about.
      if (isDubiousOwnershipError(e)) {
        const target = dubiousOwnershipPath(e) ?? path;
        if (await confirmTrust(target)) {
          try {
            await trustRepoPath(target);
            await finish(await initRepo(path, branch));
            return;
          } catch (retryError) {
            set({ busy: false, error: appErrorMessage(retryError) });
            return;
          }
        }
      }
      // Error stays in the dialog so the form keeps its values.
      set({ busy: false, error: appErrorMessage(e) });
    }
  },
}));
