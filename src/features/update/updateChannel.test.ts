// The release-channel preference (#237).
//
// The gate in `updateCheckMode.test.ts` asserts a check does not HAPPEN; this
// file asserts what a check that does happen ASKS FOR. Those are different
// failures with the same symptom on screen ("no update offered"), so they get
// separate files rather than one that would pass while the store quietly asked
// the wrong endpoint.
//
// `@/lib/tauri` is mocked for the same reason it is there: the assertion is on
// the ARGUMENT handed across the IPC boundary, which is the only place the
// channel is expressed. A store that read the preference and then dropped it
// would satisfy any status-only assertion.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateInfo } from "@/lib/types";

const tauri = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getUpdateCapability: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);

import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useUpdateStore } from "./useUpdateStore";

const AVAILABLE: UpdateInfo = {
  available: true,
  currentVersion: "0.2.0",
  latestVersion: "0.3.0",
  notes: "notes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.3.0",
  publishedAt: "2026-08-30T10:00:00Z",
  prerelease: false,
};

beforeEach(() => {
  localStorage.clear();
  tauri.checkForUpdate.mockReset().mockResolvedValue(AVAILABLE);
  tauri.getUpdateCapability.mockReset().mockResolvedValue("notify");
  tauri.openUrl.mockReset().mockResolvedValue(undefined);
  useSettingsStore.getState().set("updateCheckMode", "auto");
  useSettingsStore.getState().set("updateChannel", "stable");
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

describe("the channel preference reaches the backend", () => {
  it("defaults to stable", () => {
    // The conservative default is load-bearing: nobody is put on prereleases by
    // upgrading into a build that has this feature.
    expect(useSettingsStore.getState().updateChannel).toBe("stable");
  });

  it("sends 'stable' on a stable-channel check", async () => {
    await useUpdateStore.getState().check(true);
    expect(tauri.checkForUpdate).toHaveBeenCalledWith("stable");
  });

  it("sends 'prerelease' once the preference is switched", async () => {
    useSettingsStore.getState().set("updateChannel", "prerelease");
    await useUpdateStore.getState().check(true);
    expect(tauri.checkForUpdate).toHaveBeenCalledWith("prerelease");
  });

  it("sends the channel on an automatic check too, not just a manual one", async () => {
    // Both initiatives read the same preference. A manual-only wiring would
    // leave the startup check silently on stable for a prerelease user, which
    // is the check that actually runs for most people most of the time.
    useSettingsStore.getState().set("updateChannel", "prerelease");
    await useUpdateStore.getState().check(false);
    expect(tauri.checkForUpdate).toHaveBeenCalledWith("prerelease");
  });

  it("persists the choice", () => {
    useSettingsStore.getState().set("updateChannel", "prerelease");
    const raw = JSON.parse(
      localStorage.getItem(
        Object.keys(localStorage).find((k) => k.startsWith("pg-settings")) ?? "",
      ) ?? "{}",
    );
    expect(raw.updateChannel).toBe("prerelease");
  });

  it("makes no request at all when checks are off, whatever the channel", async () => {
    // The channel must not become a second way in. `never` outranks it.
    useSettingsStore.getState().set("updateChannel", "prerelease");
    useSettingsStore.getState().set("updateCheckMode", "never");
    await useUpdateStore.getState().check(true);
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
  });
});

describe("what the panel is told about a prerelease", () => {
  it("carries the backend's prerelease flag into store state", async () => {
    tauri.checkForUpdate.mockResolvedValue({
      ...AVAILABLE,
      latestVersion: "0.4.0-rc.1",
      prerelease: true,
    });
    useSettingsStore.getState().set("updateChannel", "prerelease");
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().info?.prerelease).toBe(true);
  });

  it("does not infer 'prerelease' from the version string", async () => {
    // A release flagged prerelease on GitHub can carry a plain tag, and a
    // `-rc` tag can be published as a full release. The flag is the answer;
    // deriving it here would let the label contradict the backend.
    tauri.checkForUpdate.mockResolvedValue({
      ...AVAILABLE,
      latestVersion: "0.4.0-rc.1",
      prerelease: false,
    });
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().info?.prerelease).toBe(false);
  });
});
