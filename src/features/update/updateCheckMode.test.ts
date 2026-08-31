// The update-check preference (#237) — the gate, not the label.
//
// The point of this file is a NEGATIVE assertion: when the preference forbids a
// check, `checkForUpdate` must not be CALLED. "A request whose result is
// ignored" would satisfy a status-only test and still put a packet on the wire,
// which is exactly what "Never" promises not to do — so `@/lib/tauri` is mocked
// here and the assertion is on the call count.
//
// Mocking the wrapper module rather than `invoke` is deliberate: it pins the
// boundary the store is allowed to reach, so a future second discovery path
// (a bare `invoke`, a fetch) would show up as an unmocked call rather than
// slipping past a satisfied assertion.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateInfo } from "@/lib/types";

const tauri = vi.hoisted(() => ({
  checkForUpdate: vi.fn(),
  getUpdateCapability: vi.fn(),
  openUrl: vi.fn(),
}));
vi.mock("@/lib/tauri", () => tauri);

import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { checkAllowed, useUpdateStore } from "./useUpdateStore";

const AVAILABLE: UpdateInfo = {
  available: true,
  currentVersion: "0.0.5",
  latestVersion: "0.1.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
  publishedAt: "2026-07-08T10:00:00Z",
  prerelease: false,
};

beforeEach(() => {
  localStorage.clear();
  tauri.checkForUpdate.mockReset().mockResolvedValue(AVAILABLE);
  tauri.getUpdateCapability.mockReset().mockResolvedValue("notify");
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

describe("updateCheckMode gate — no request the user disabled", () => {
  it("automatic check makes NO request when the mode is 'manual'", async () => {
    useSettingsStore.getState().set("updateCheckMode", "manual");
    await useUpdateStore.getState().check(false);
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
    expect(tauri.getUpdateCapability).not.toHaveBeenCalled();
    // Silent: a startup check the user turned off is not an error state.
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it("automatic check makes NO request when the mode is 'never'", async () => {
    useSettingsStore.getState().set("updateCheckMode", "never");
    await useUpdateStore.getState().check(false);
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
    expect(tauri.getUpdateCapability).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("MANUAL check makes NO request when the mode is 'never'", async () => {
    // The whole reason the gate lives in the store: Settings, the command
    // palette and the keymap all reach check(true), and "Never" has to hold on
    // every one of them — including a click on a button that somehow rendered
    // enabled.
    useSettingsStore.getState().set("updateCheckMode", "never");
    await useUpdateStore.getState().check(true);
    expect(tauri.checkForUpdate).not.toHaveBeenCalled();
    expect(tauri.getUpdateCapability).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("idle");
  });

  it("manual check DOES request when the mode is 'manual'", async () => {
    useSettingsStore.getState().set("updateCheckMode", "manual");
    await useUpdateStore.getState().check(true);
    expect(tauri.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("automatic check DOES request when the mode is 'auto'", async () => {
    await useUpdateStore.getState().check(false);
    expect(tauri.checkForUpdate).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().status).toBe("available");
  });

  it("leaves an already-known update on screen when switched to 'never'", async () => {
    // Turning checks off must not make a check that already happened vanish
    // mid-session; it stops future requests. What the chip does with it is
    // UpdateChip's business (see UpdatePanel.test.tsx).
    await useUpdateStore.getState().check(false);
    useSettingsStore.getState().set("updateCheckMode", "never");
    expect(useUpdateStore.getState().info).toEqual(AVAILABLE);
  });

  it("still honours the per-version snooze, which is orthogonal", async () => {
    useUpdateStore.setState({ dismissedVersion: "0.1.0" });
    await useUpdateStore.getState().check(false);
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.panelOpen).toBe(false);
  });
});

describe("lastCheckedAt", () => {
  it("is recorded and persisted after a completed check", async () => {
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
    const before = Date.now();
    await useUpdateStore.getState().check(true);
    const at = useUpdateStore.getState().lastCheckedAt;
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
    expect(localStorage.getItem("pg-update-last-checked")).toBe(String(at));
  });

  it("does NOT advance on a failed check", async () => {
    // A timestamp that moves on an offline failure reads as "checked fine just
    // now" on precisely the machine whose updater is stuck.
    tauri.checkForUpdate.mockRejectedValue({ kind: "Network", message: "offline" });
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
    expect(localStorage.getItem("pg-update-last-checked")).toBeNull();
  });

  it("does NOT advance for a blocked check", async () => {
    useSettingsStore.getState().set("updateCheckMode", "never");
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().lastCheckedAt).toBeNull();
  });

  it("stays OUT of the portable settings payload (#254 exports it)", async () => {
    // Per-machine state, not a preference: a last-checked time must not travel
    // in someone's exported settings file.
    await useUpdateStore.getState().check(true);
    const raw = JSON.parse(localStorage.getItem("pg-settings-v2") ?? "{}");
    expect("lastCheckedAt" in raw).toBe(false);
  });
});

describe("checkAllowed — the rule, as a table", () => {
  it("lets automatic through only on auto, and manual through unless never", () => {
    expect(checkAllowed("auto", false)).toBe(true);
    expect(checkAllowed("auto", true)).toBe(true);
    expect(checkAllowed("manual", false)).toBe(false);
    expect(checkAllowed("manual", true)).toBe(true);
    expect(checkAllowed("never", false)).toBe(false);
    expect(checkAllowed("never", true)).toBe(false);
  });
});
