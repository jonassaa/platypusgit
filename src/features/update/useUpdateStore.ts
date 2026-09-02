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
  /**
   * Fetch the install's update capability once, without checking for updates.
   *
   * Its own action because the capability decides whether an update surface is
   * rendered AT ALL (#360), and `check()` is no longer a reliable way to learn
   * it: with `updateCheckMode: "never"` that function returns before it fetches
   * anything, which would leave a Store install rendering the full update UI.
   * A local IPC call, never the network.
   */
  loadCapability: () => Promise<void>;
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
 * Does something OTHER than this app own updates on this install?
 *
 * Today that is exactly the Microsoft Store (MSIX), and it is a stronger
 * statement than any `notify` variant makes (#360). A notify install checks,
 * then defers the *install* to a package manager. A store-managed install does
 * not check, is not told, and is offered nothing: Store policy 10.2.5 requires
 * that a Store product be updated only through the Store, and the v0.4.0
 * submission failed certification on the notification alone — the startup check
 * found a newer GitHub release and the panel auto-opened with a "View release"
 * button onto an `.msi`. The report's location was "In App, soon after launch".
 *
 * PURE and exported for the same reason `checkAllowed` is: it is read by
 * `check()`, by `UpdateChip` and by Settings, and the three must not each
 * re-spell the condition. Written as a predicate over the capability rather than
 * `=== "store-managed"` at three call sites so that a second externally-managed
 * channel (a future winget/`msstore` variant) is one edit here.
 *
 * `null` — capability not loaded yet — answers `false`, and that is deliberate:
 * `check()` loads the capability before it can reach the network, so the "not
 * yet known" window belongs to nothing that could leak. Answering `true` there
 * would hide the update UI for a frame on every ordinary install.
 */
export function updatesManagedExternally(
  capability: UpdateCapability | null,
): boolean {
  return capability === "store-managed";
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
    const settings = useSettingsStore.getState();
    if (!checkAllowed(settings.updateCheckMode, manual)) {
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
      // The SECOND gate, and the one certification cares about (#360). A
      // Microsoft Store install must not check, must not be told, and must not
      // be offered a release page — policy 10.2.5. It sits here, above the
      // fetch, rather than beside the `updateCheckMode` gate above, because it
      // needs the capability and because it is not a preference: no setting can
      // turn it off, which is why `status` goes back to `idle` and no error is
      // raised even for a manual call. The backend refuses too
      // (`AppError::UpdatesManagedExternally`); this is what keeps the request
      // from being made at all.
      if (updatesManagedExternally(capability)) {
        set({ capability, status: "idle", info: null, panelOpen: false });
        return;
      }
      // Read from the same snapshot the gate used, so a channel switch
      // mid-check cannot produce a result attributed to the other channel.
      const info = await checkForUpdate(settings.updateChannel);
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
    // Unreachable through the UI — the panel offers "Install & restart" only for
    // `self-update`, and a store-managed install never gets a panel at all — but
    // this is the one action that would actually write to the package, so it
    // refuses on its own rather than trusting two layers of rendering (#360).
    // A self-update over an MSIX does not fail cleanly: Windows refuses to
    // launch a package whose files were tampered with, so the outcome is an app
    // that will not start.
    if (updatesManagedExternally(get().capability)) return;
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

  async loadCapability() {
    if (get().capability) return;
    try {
      set({ capability: await getUpdateCapability() });
    } catch {
      // Leave null. Consumers read it through `updatesManagedExternally`, which
      // answers `false` for null — so a failed probe shows the ordinary update
      // UI rather than hiding it. That is the right way round: the surface only
      // has to be *gone* on an install where the probe SUCCEEDS and says
      // store-managed, and `check()` re-probes before it could reach the
      // network anyway.
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
