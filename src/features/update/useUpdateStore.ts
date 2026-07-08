import { create } from "zustand";

import { appErrorMessage } from "@/lib/errors";
import { checkForUpdate, getUpdateCapability, openUrl } from "@/lib/tauri";
import type { UpdateCapability, UpdateInfo } from "@/lib/types";

const DISMISS_KEY = "pg-update-dismissed";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "installing"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  capability: UpdateCapability | null;
  dismissedVersion: string | null;
  progress: number | null; // 0..1 during self-update download
  error: string | null;
  panelOpen: boolean;
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  openReleasePage: () => Promise<void>;
  openPanel: () => void;
  closePanel: () => void;
  dismiss: () => void;
}

function loadDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** An update exists that the user hasn't already dismissed. */
export function shouldNag(
  s: Pick<UpdateState, "info" | "dismissedVersion">,
): boolean {
  return !!s.info?.available && s.info.latestVersion !== s.dismissedVersion;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  info: null,
  capability: null,
  dismissedVersion: loadDismissed(),
  progress: null,
  error: null,
  panelOpen: false,

  async check(manual) {
    set({ status: "checking", error: null });
    try {
      // Capability is stable per install; fetch once.
      let capability = get().capability;
      if (!capability) {
        capability = await getUpdateCapability();
      }
      const info = await checkForUpdate();
      set({ info, capability });
      if (info.available) {
        set({ status: "available" });
        // Auto-open the panel only for a version the user hasn't dismissed.
        if (shouldNag({ info, dismissedVersion: get().dismissedVersion })) {
          set({ panelOpen: true });
        }
      } else {
        set({ status: "up-to-date" });
      }
    } catch (e) {
      if (manual) {
        set({ status: "error", error: appErrorMessage(e) });
      } else {
        // Startup check stays silent (offline, rate-limited, etc.).
        set({ status: "idle" });
      }
    }
  },

  async install() {
    set({ status: "installing", error: null, progress: 0 });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        set({ status: "up-to-date", progress: null });
        return;
      }
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          set({ progress: total ? downloaded / total : null });
        }
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: appErrorMessage(e), progress: null });
    }
  },

  async openReleasePage() {
    const url = get().info?.releaseUrl;
    if (url) await openUrl(url);
  },

  openPanel() {
    set({ panelOpen: true });
  },

  closePanel() {
    set({ panelOpen: false });
  },

  dismiss() {
    const v = get().info?.latestVersion ?? null;
    try {
      if (v) localStorage.setItem(DISMISS_KEY, v);
    } catch {
      // non-fatal
    }
    set({ dismissedVersion: v, panelOpen: false });
  },
}));
