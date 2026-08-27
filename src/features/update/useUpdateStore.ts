import { create } from "zustand";

import {
  useSettingsStore,
  type UpdateCheckMode,
} from "@/features/settings/useSettingsStore";
import { appErrorMessage } from "@/lib/errors";
import { checkForUpdate, getUpdateCapability, openUrl } from "@/lib/tauri";
import type { UpdateCapability, UpdateInfo } from "@/lib/types";
import { compareSemver } from "./semver";

const DISMISS_KEY = "pg-update-dismissed";
/**
 * When this install last completed an update check.
 *
 * Stored here rather than in the settings store's `PersistedState` on purpose:
 * that bag is the portable preferences payload (#254 exports it to a file people
 * share), and a per-machine timestamp is state, not a preference — it must not
 * travel in someone else's settings.
 */
const LAST_CHECKED_KEY = "pg-update-last-checked";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  capability: UpdateCapability | null;
  dismissedVersion: string | null;
  /** The running app's version — one source for every version readout. */
  currentVersion: string | null;
  /**
   * Epoch ms of the last COMPLETED check, or null if this install has never
   * finished one. Only advanced on success: a timestamp that moved on an
   * offline failure would read as "checked fine just now" on exactly the
   * machine whose updater is stuck, which is what people open this panel to
   * find out.
   */
  lastCheckedAt: number | null;
  /**
   * A self-update is downloading/installing. Deliberately NOT a `status` value:
   * `status` is owned by `check()`, so overloading it let any check (e.g.
   * Settings → "Check for updates" mid-download) re-enable the Install button
   * and start a second `downloadAndInstall` + `relaunch()`.
   */
  installing: boolean;
  progress: number | null; // 0..1 during self-update download
  error: string | null;
  /** Non-error explanation shown in the panel (e.g. no signed installer yet). */
  message: string | null;
  panelOpen: boolean;
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  openReleasePage: () => Promise<void>;
  loadCurrentVersion: () => Promise<void>;
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

function loadLastChecked(): number | null {
  try {
    const raw = localStorage.getItem(LAST_CHECKED_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Whether a check with this initiative is allowed to hit the network at all.
 *
 * PURE and exported so the rule can be read (and tested) without a store: an
 * automatic check needs `auto`, a manual one needs anything but `never`.
 */
export function checkAllowed(mode: UpdateCheckMode, manual: boolean): boolean {
  return manual ? mode !== "never" : mode === "auto";
}

/**
 * An update exists that the user hasn't already dismissed.
 *
 * Compares by semver, not string inequality: after dismissing 0.2.0, a yanked
 * release making /releases/latest return 0.1.0 would otherwise re-nag with an
 * *older* version. Falls back to inequality only when a version is unparseable.
 */
export function shouldNag(
  s: Pick<UpdateState, "info" | "dismissedVersion">,
): boolean {
  if (!s.info?.available) return false;
  if (!s.dismissedVersion) return true;
  const cmp = compareSemver(s.info.latestVersion, s.dismissedVersion);
  if (cmp === null) return s.info.latestVersion !== s.dismissedVersion;
  return cmp > 0;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  info: null,
  capability: null,
  dismissedVersion: loadDismissed(),
  currentVersion: null,
  lastCheckedAt: loadLastChecked(),
  installing: false,
  progress: null,
  error: null,
  message: null,
  panelOpen: false,

  async check(manual) {
    // Never yank the Install button out from under an in-flight install.
    if (get().installing) return;
    // The update-check preference is enforced HERE, before anything reaches the
    // network — not only at the AppShell startup call site. check() is reachable
    // from the startup timer and from Settings today, and from any palette or
    // keymap entry someone adds tomorrow; a call-site-only gate would need
    // remembering at each one, and the one that forgets spends a request the
    // user switched off. Silent rather than an error: a check the user disabled
    // is not a failure, and the Settings panel already says checks are off.
    if (!checkAllowed(useSettingsStore.getState().updateCheckMode, manual)) {
      set({ status: "idle" });
      return;
    }
    set({ status: "checking", error: null, message: null });
    try {
      // Capability is stable per install; fetch once.
      let capability = get().capability;
      if (!capability) {
        capability = await getUpdateCapability();
      }
      const info = await checkForUpdate();
      const lastCheckedAt = Date.now();
      try {
        localStorage.setItem(LAST_CHECKED_KEY, String(lastCheckedAt));
      } catch {
        // non-fatal — the in-memory value still serves this session
      }
      set({
        info,
        capability,
        currentVersion: info.currentVersion,
        lastCheckedAt,
      });
      if (info.available) {
        set({ status: "available" });
        // Auto-open the panel only for a version the user hasn't dismissed.
        if (shouldNag({ info, dismissedVersion: get().dismissedVersion })) {
          set({ panelOpen: true });
        }
      } else {
        set({ status: "up-to-date", panelOpen: false });
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
    if (get().installing) return;
    set({ installing: true, error: null, message: null, progress: 0 });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        // The updater found no signed manifest for this release — the real
        // state whenever latest.json is missing. Do NOT claim "up to date":
        // GitHub discovery already found a newer version, and saying otherwise
        // leaves a dead Install button. Degrade to the notify path.
        set({
          installing: false,
          progress: null,
          message:
            "No signed installer is published for this release yet — opening the release page instead.",
        });
        await get().openReleasePage();
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
      // Only reached if relaunch() somehow returns without replacing us.
      set({ installing: false, progress: null });
    } catch (e) {
      set({
        installing: false,
        status: "error",
        error: appErrorMessage(e),
        progress: null,
      });
    }
  },

  async openReleasePage() {
    const url = get().info?.releaseUrl;
    if (!url) return;
    try {
      await openUrl(url);
    } catch (e) {
      // `open_url` genuinely fails (rejected URL, no handler, non-zero exit).
      // Without this the rejection was unhandled at the onClick call site and
      // the user saw nothing happen.
      set({ status: "error", error: appErrorMessage(e) });
    }
  },

  async loadCurrentVersion() {
    if (get().currentVersion) return;
    try {
      const { getVersion } = await import("@tauri-apps/api/app");
      set({ currentVersion: await getVersion() });
    } catch {
      // Leave null; consumers render a placeholder.
    }
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
