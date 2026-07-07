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

describe("logo theme slots", () => {
  const BRAND_PRIMARY = "#3e9b91";
  const BRAND_SECONDARY = "#e6a95a";

  it("every builtin theme defaults the logo slots to the brand palette", async () => {
    const { BUILTIN_THEMES } = await freshStore();
    for (const t of BUILTIN_THEMES) {
      expect(t.colors.logo).toBe(BRAND_PRIMARY);
      expect(t.colors.logo2).toBe(BRAND_SECONDARY);
    }
  });

  it("applyTheme writes both logo colors to --logo and --logo-2", async () => {
    const { applyTheme, BUILTIN_THEMES } = await freshStore();
    const theme = BUILTIN_THEMES[0];
    applyTheme(theme);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--logo")).toBe(theme.colors.logo);
    expect(root.getPropertyValue("--logo-2")).toBe(theme.colors.logo2);
  });

  it("applyTheme falls back to the brand palette when a theme has no logo colors", async () => {
    const { applyTheme, BUILTIN_THEMES } = await freshStore();
    const base = BUILTIN_THEMES[0];
    const legacy = { ...base, colors: { ...base.colors } };
    // Simulate a theme persisted before the logo slots existed.
    delete (legacy.colors as Record<string, unknown>).logo;
    delete (legacy.colors as Record<string, unknown>).logo2;
    applyTheme(legacy);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--logo")).toBe(BRAND_PRIMARY);
    expect(root.getPropertyValue("--logo-2")).toBe(BRAND_SECONDARY);
  });

  it("backfills the brand palette for persisted custom themes without logo slots", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeThemeId: "legacy-custom",
        customThemes: [
          {
            id: "legacy-custom",
            name: "Legacy",
            mode: "dark",
            colors: {
              bg0: "#111111", bg1: "#161616", bg2: "#1c1c1c", bg3: "#222222",
              bg4: "#2a2a2a", titlebar: "#141414", fg0: "#eeeeee", fg1: "#cccccc",
              fg2: "#999999", fg3: "#777777", fg4: "#555555", border0: "#2a2a2a",
              border1: "#333333", border2: "#444444", accent: "#ff6600",
              accentInk: "#111111",
              // no logo / logo2 — pre-existing custom theme
            },
          },
        ],
      }),
    );
    const { useSettingsStore } = await freshStore();
    const active = useSettingsStore.getState().getActiveTheme();
    expect(active.colors.logo).toBe(BRAND_PRIMARY);
    expect(active.colors.logo2).toBe(BRAND_SECONDARY);
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--logo")).toBe(BRAND_PRIMARY);
    expect(root.getPropertyValue("--logo-2")).toBe(BRAND_SECONDARY);
  });

  it("importThemeJson falls back to the brand palette when the JSON omits logo slots", async () => {
    const { useSettingsStore } = await freshStore();
    const json = JSON.stringify({
      name: "No-logo import",
      mode: "dark",
      colors: {
        bg0: "#111111", bg1: "#161616", bg2: "#1c1c1c", bg3: "#222222",
        bg4: "#2a2a2a", titlebar: "#141414", fg0: "#eeeeee", fg1: "#cccccc",
        fg2: "#999999", fg3: "#777777", fg4: "#555555", border0: "#2a2a2a",
        border1: "#333333", border2: "#444444", accent: "#00cc88",
        accentInk: "#111111",
      },
    });
    const imported = useSettingsStore.getState().importThemeJson(json);
    expect(imported.colors.logo).toBe(BRAND_PRIMARY);
    expect(imported.colors.logo2).toBe(BRAND_SECONDARY);
  });

  it("editing a logo color on a builtin duplicates and applies the CSS var", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().setActiveThemeId("dark-cool");
    useSettingsStore.getState().updateActiveColors({ logo: "#abcdef", logo2: "#123456" });
    const active = useSettingsStore.getState().getActiveTheme();
    expect(active.builtin).toBeFalsy();
    expect(active.colors.logo).toBe("#abcdef");
    expect(active.colors.logo2).toBe("#123456");
    const root = document.documentElement.style;
    expect(root.getPropertyValue("--logo")).toBe("#abcdef");
    expect(root.getPropertyValue("--logo-2")).toBe("#123456");
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
