import { create } from "zustand";

import { confirmTrust } from "@/features/repo/ownership";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useAuthStore } from "@/features/auth/useAuthStore";
import {
  cancelNetworkOp,
  cloneRepo,
  closeRepo as closeRepoIpc,
  initRepo,
  rememberCredential,
  trustRepoPath,
  type Credentials,
} from "@/lib/tauri";
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
  openClone: () => void;
  openInit: () => void;
  close: () => void;
  setProgress: (p: CloneProgress) => void;
  /**
   * Stop the clone in flight (#234). Cheap and idempotent: the running
   * `runClone` owns the unwind, so this only signals.
   *
   * A no-op when nothing is running, so the Cancel button can call it
   * unconditionally without first re-reading `busy` in the click handler.
   */
  cancelClone: () => Promise<void>;
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

  // Guarded against `busy`: a chord or palette command that swaps `open` to the
  // other dialog mid-run would unmount the running dialog's view behind a
  // disabled, undismissable one — and once the run finishes, its result
  // (including a failure) would render into the wrong dialog's error slot. Still
  // true now that a clone can be cancelled (#234): the cancel affordance is IN
  // the running dialog, so swapping it away is precisely what hides it.
  openClone: () => {
    if (get().busy) return;
    set({ open: "clone", error: null, progress: null });
  },
  openInit: () => {
    if (get().busy) return;
    set({ open: "init", error: null, progress: null });
  },
  // Still never closes mid-run, even now that a clone CAN be cancelled (#234):
  // dropping the dialog while git is being killed and its partial destination
  // removed would leave that work with no UI attached to it. The dialog closes
  // itself once `runClone` has unwound — which is a moment later, not never.
  close: () => {
    if (get().busy) return;
    set({ open: "none", error: null, progress: null });
  },
  setProgress: (p) => set({ progress: p }),

  async cancelClone() {
    if (!get().busy) return;
    // Nothing is set here: `runClone`'s catch owns the transition back to idle.
    // Clearing `busy` from here would unlock the dialog while git was still
    // being reaped, and a second Clone could start into the directory the first
    // one is in the middle of deleting.
    await cancelNetworkOp().catch((e) => {
      // A cancel that could not even be signalled leaves the user stuck with no
      // way out, which is the whole bug — so it gets said out loud, in the
      // dialog, where they are looking.
      set({ error: appErrorMessage(e) });
    });
  },

  async runClone({ url, parentDir, name, recurseSubmodules }) {
    set({ busy: true, error: null, progress: null });

    const attempt = async (creds?: Credentials) => {
      const dest = await cloneRepo(url, parentDir, name, recurseSubmodules, creds);
      useSettingsStore.getState().set("lastCreateDir", parentDir);
      // busy false BEFORE close(), which refuses to close while busy.
      set({ busy: false, progress: null });
      set({ open: "none" });
      await useTabsStore.getState().openRepo(dest);
    };

    try {
      await attempt();
    } catch (e) {
      // A private remote is exactly what the credential flow exists for. The
      // backend already classifies clone failures as AppError::Auth and
      // clone_repo already takes credentials; without raising the challenge the
      // Clone dialog just printed "Authentication required" with no way to
      // answer it.
      // A cancel is the outcome the user asked for, so it returns the dialog to
      // idle with the form intact and NO error — a red banner reading "early
      // EOF" would answer their own Cancel click with a failure. Everything the
      // backend does about it (killing git, removing the partial destination)
      // has already happened by the time this rejects (#234).
      if (isCancelledError(e)) {
        set({ busy: false, progress: null, error: null });
        return;
      }
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
            set({
              busy: false,
              progress: null,
              // Same rule as the first attempt: a cancelled retry is not a
              // failure to report back into the dialog.
              error: isCancelledError(retryError)
                ? null
                : appErrorMessage(retryError),
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
