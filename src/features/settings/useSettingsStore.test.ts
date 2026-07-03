// Store-logic tests for the settings store: persistence shape (including the
// removal migration for dead settings) and the uiDensity CSS-var hook.
import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "pg-settings-v2";

// The store applies theme + density at module load, so each test re-imports a
// fresh module instance after seeding localStorage.
async function freshStore() {
  vi.resetModules();
  return await import("./useSettingsStore");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--row-h");
});

describe("useSettingsStore persistence", () => {
  it("loads persisted values over defaults", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ pruneOnFetch: false, diffContextLines: 8 }),
    );
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.pruneOnFetch).toBe(false);
    expect(s.diffContextLines).toBe(8);
    // Untouched keys keep defaults.
    expect(s.autoStashBeforePull).toBe(true);
  });

  it("drops removed settings (signCommits, showWhitespaceInDiff) from old payloads", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        signCommits: true,
        showWhitespaceInDiff: true,
        pruneOnFetch: false,
      }),
    );
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    // Known key still honored…
    expect(s.pruneOnFetch).toBe(false);
    // …but stale keys don't leak into store state.
    expect("signCommits" in s).toBe(false);
    expect("showWhitespaceInDiff" in s).toBe(false);

    // And the next persist writes a clean payload without them.
    useSettingsStore.getState().set("pruneOnFetch", true);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect("signCommits" in raw).toBe(false);
    expect("showWhitespaceInDiff" in raw).toBe(false);
    expect(raw.pruneOnFetch).toBe(true);
  });

  it("set() persists the changed key", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("autoStashBeforePull", false);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.autoStashBeforePull).toBe(false);
  });
});

describe("uiDensity CSS hook", () => {
  it("applies --row-h from the persisted density at load", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiDensity: "comfortable" }));
    await freshStore();
    expect(document.documentElement.style.getPropertyValue("--row-h")).toBe("28px");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("re-applies --row-h when the density setting changes", async () => {
    const { useSettingsStore } = await freshStore();
    expect(document.documentElement.style.getPropertyValue("--row-h")).toBe("24px");
    useSettingsStore.getState().set("uiDensity", "comfortable");
    expect(document.documentElement.style.getPropertyValue("--row-h")).toBe("28px");
    useSettingsStore.getState().set("uiDensity", "compact");
    expect(document.documentElement.style.getPropertyValue("--row-h")).toBe("24px");
  });

  it("reset() restores compact density", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("uiDensity", "comfortable");
    useSettingsStore.getState().reset();
    expect(document.documentElement.style.getPropertyValue("--row-h")).toBe("24px");
  });
});
