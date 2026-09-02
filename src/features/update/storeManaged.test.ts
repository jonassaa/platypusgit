// A Microsoft Store install has NO update surface (#360).
//
// This file exists because of a certification failure, not a bug report. The
// v0.4.0 MSIX submission was rejected under Store policy 10.2.5 — "the product
// and in-app products are updated only through the Store" — with the finding
// spelled out as:
//
//   The product updates outside the Store. […]
//   Location where update is found: In App, soon after launch
//
// The app installed nothing. `capability` already took a packaged install off
// the self-update path, so the "Install & restart" button was never offered.
// What failed was the NOTIFICATION: the startup check asked GitHub for the
// newest release, found one, and auto-opened a panel whose primary button
// opened the release page — where the user downloads an `.msi` and updates
// outside the Store. Finding out about the update in the app is the violation.
//
// So the assertions here are negative, in the shape `updateCheckMode.test.ts`
// already uses: `checkForUpdate` must not be CALLED. A request whose result is
// discarded would satisfy a status-only test and still be a GitHub round-trip
// on every launch of a Store install — and a discarded result is one `set()`
// away from being rendered again.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateInfo } from "@/lib/types";

const tauri = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getUpdateCapability: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);

import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { updatesManagedExternally, useUpdateStore } from "./useUpdateStore";

const AVAILABLE: UpdateInfo = {
  available: true,
  currentVersion: "0.4.0",
  latestVersion: "0.5.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.5.0",
  publishedAt: "2026-09-02T10:00:00Z",
  prerelease: false,
};

beforeEach(() => {
  localStorage.clear();
  tauri.checkForUpdate.mockReset().mockResolvedValue(AVAILABLE);
  tauri.getUpdateCapability.mockReset().mockResolvedValue("store-managed");
  tauri.openUrl.mockReset().mockResolvedValue(undefined);
  useSettingsStore.getState().set("updateCheckMode", "auto");
  useUpdateStore.setState({
    status: "idle",
    info: null,
    capability: null,
    dismissedVersion: null,
    currentVersion: null,
    lastCheckedAt: null,
    installing: false,
    progress: null,
    error: null,
    message: null,
    panelOpen: false,
  });
});

describe("updatesManagedExternally", () => {
  it("is true for a Store install and false for every other capability", () => {
    expect(updatesManagedExternally("store-managed")).toBe(true);
    for (const cap of [
      "self-update",
      "notify",
      "notify-apt",
      "notify-scoop",
    ] as const) {
      // The notify variants still check — they defer the INSTALL to a package
      // manager, and telling a `.deb` user that `apt upgrade` has something for
      // them is the whole point of #187. A predicate that swept them up would
      // delete that feature while looking like a Store fix.
      expect(updatesManagedExternally(cap)).toBe(false);
    }
  });

  it("is false while the capability is still unknown", () => {
    // `check()` loads the capability before it can reach the network, so the
    // unknown window belongs to nothing that could leak. Answering true here
    // would blank the update UI for a frame on every ordinary install.
    expect(updatesManagedExternally(null)).toBe(false);
  });
});

describe("the Store gate — no check, no notification", () => {
  it("makes NO GitHub request on the startup check", async () => {
    await useUpdateStore.getState().check(false);
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
    // The capability probe itself IS allowed and required: it is a local IPC
    // call, and it is what produced the refusal.
    expect(tauri.getUpdateCapability).toHaveBeenCalled();
  });

  it("makes NO GitHub request on a MANUAL check either", async () => {
    // The Settings button is not rendered on such an install, but the gate has
    // to hold for the command palette, the keymap, and any call site added
    // later. This is not a preference — no setting turns it off — which is why
    // it is checked separately from `updateCheckMode`.
    await useUpdateStore.getState().check(true);
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
  });

  it("leaves no info, no panel and no error behind", async () => {
    await useUpdateStore.getState().check(true);
    const s = useUpdateStore.getState();
    // `info: null` is the load-bearing one. `UpdateChip` renders on
    // `info.available` and `UpdatePanel` returns null without an `info`, so an
    // empty result is what makes the whole surface absent rather than merely
    // closed.
    expect(s.info).toBeNull();
    expect(s.panelOpen).toBe(false);
    // Silent, like a check the user turned off: a refusal the user cannot
    // change is not a failure to report, and an error banner about updates is
    // still an in-app statement about updates.
    expect(s.status).toBe("idle");
    expect(s.error).toBeNull();
    // ...and the capability is retained, so Settings and the chip can gate on
    // it without probing again.
    expect(s.capability).toBe("store-managed");
  });

  it("records no last-checked time", async () => {
    // The panel and Settings read this to say when the install last looked. A
    // Store install never looks, and a timestamp would claim otherwise.
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
  });

  it("refuses to self-install even if something calls install()", async () => {
    // Unreachable through the UI, but this is the one action that writes to the
    // package. A self-update over an MSIX does not fail cleanly: Windows
    // refuses to launch a package whose files were tampered with, so the
    // outcome is an app that will not start.
    useUpdateStore.setState({ capability: "store-managed", info: AVAILABLE });
    await useUpdateStore.getState().install();
    const s = useUpdateStore.getState();
    expect(s.installing).toBe(false);
    expect(s.progress).toBeNull();
  });

  it("still checks on the same code path when the install is not packaged", async () => {
    // The other half of the gate: this must be a Store rule, not a switch that
    // quietly turned update checks off for everyone.
    tauri.getUpdateCapability.mockResolvedValue("self-update");
    await useUpdateStore.getState().check(false);
    expect(tauri.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().info).toEqual(AVAILABLE);
  });
});

describe("loadCapability", () => {
  it("learns the capability without checking for updates", async () => {
    // Its own action because `check()` is no longer a reliable way to learn
    // this: with `updateCheckMode: "never"` it returns before fetching
    // anything, which would leave a Store install rendering the full update UI
    // in Settings.
    useSettingsStore.getState().set("updateCheckMode", "never");
    await useUpdateStore.getState().loadCapability();
    expect(useUpdateStore.getState().capability).toBe("store-managed");
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
  });

  it("probes once per session", async () => {
    await useUpdateStore.getState().loadCapability();
    await useUpdateStore.getState().loadCapability();
    expect(tauri.getUpdateCapability).toHaveBeenCalledTimes(1);
  });

  it("leaves the capability null when the probe fails", async () => {
    // Fails toward showing the ordinary update UI, on purpose: the surface only
    // has to be gone where the probe SUCCEEDS and says store-managed, and
    // `check()` re-probes before it could reach the network anyway.
    tauri.getUpdateCapability.mockRejectedValue(new Error("no ipc"));
    await useUpdateStore.getState().loadCapability();
    expect(useUpdateStore.getState().capability).toBeNull();
  });
});
