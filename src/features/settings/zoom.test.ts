// UI zoom: the setting, the chord runners, and what reaches the webview.
import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  normalizeZoom,
  useSettingsStore,
} from "./useSettingsStore";
import { ACTIONS } from "@/features/keymap/actions";
import { RIDER_PRESET, PLATYPUSGIT_PRESET } from "@/features/keymap/presets";
import { getZoomCalls } from "@/test/webviewMock";

const zoom = () => useSettingsStore.getState().uiZoom;

describe("normalizeZoom", () => {
  it("clamps both ends", () => {
    expect(normalizeZoom(9)).toBe(ZOOM_MAX);
    expect(normalizeZoom(0.01)).toBe(ZOOM_MIN);
  });

  it("snaps to the step grid", () => {
    expect(normalizeZoom(1.04)).toBe(1);
    expect(normalizeZoom(1.06)).toBe(1.1);
  });

  it("falls back to 100% for a junk value", () => {
    expect(normalizeZoom(Number.NaN)).toBe(1);
    // Infinity is not a factor to clamp — it is nonsense, same as NaN.
    expect(normalizeZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("zoom setting", () => {
  beforeEach(() => {
    useSettingsStore.getState().set("uiZoom", 1);
  });

  it("steps up and down by one step", () => {
    useSettingsStore.getState().stepZoom(1);
    expect(zoom()).toBeCloseTo(1 + ZOOM_STEP, 5);
    useSettingsStore.getState().stepZoom(-2);
    expect(zoom()).toBeCloseTo(1 - ZOOM_STEP, 5);
  });

  it("pushes the factor to the webview", async () => {
    useSettingsStore.getState().stepZoom(2);
    // applyZoom reaches the webview through a dynamic import, so the call
    // lands a tick or two after the setting changes.
    await vi.waitFor(() =>
      expect(getZoomCalls().at(-1)).toBeCloseTo(1 + 2 * ZOOM_STEP, 5),
    );
  });

  it("cannot be stepped past its bounds", () => {
    useSettingsStore.getState().stepZoom(100);
    expect(zoom()).toBe(ZOOM_MAX);
    useSettingsStore.getState().stepZoom(-100);
    expect(zoom()).toBe(ZOOM_MIN);
  });

  it("persists so the next launch opens at the same size", () => {
    useSettingsStore.getState().stepZoom(2);
    const raw = localStorage.getItem("pg-settings-v2") ?? "{}";
    expect(JSON.parse(raw).uiZoom).toBeCloseTo(1 + 2 * ZOOM_STEP, 5);
  });

  it("mirrors the factor onto the root element", () => {
    useSettingsStore.getState().stepZoom(1);
    expect(document.documentElement.dataset.zoom).toBe(String(zoom()));
  });
});

describe("zoom actions", () => {
  beforeEach(() => {
    useSettingsStore.getState().set("uiZoom", 1);
  });

  it("are wired to runners that move the setting", () => {
    ACTIONS["view.zoomIn"].run?.();
    expect(zoom()).toBeCloseTo(1 + ZOOM_STEP, 5);
    ACTIONS["view.zoomOut"].run?.();
    expect(zoom()).toBe(1);
    ACTIONS["view.zoomIn"].run?.();
    ACTIONS["view.zoomReset"].run?.();
    expect(zoom()).toBe(1);
  });

  it("are bound in both presets, including the shifted plus", () => {
    for (const preset of [RIDER_PRESET, PLATYPUSGIT_PRESET]) {
      expect(preset.bindings["view.zoomIn"]).toEqual(["Mod+=", "Mod++"]);
      expect(preset.bindings["view.zoomOut"]).toEqual(["Mod+-", "Mod+_"]);
      expect(preset.bindings["view.zoomReset"]).toEqual(["Mod+0"]);
    }
  });

  it("stay live while typing — an editor zooms mid-edit", () => {
    expect(ACTIONS["view.zoomIn"].allowInInput).toBe(true);
    expect(ACTIONS["view.zoomOut"].allowInInput).toBe(true);
    expect(ACTIONS["view.zoomReset"].allowInInput).toBe(true);
  });
});
