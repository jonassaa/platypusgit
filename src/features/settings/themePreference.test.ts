// "Follow the system appearance" (#236).
//
// The load-bearing tests are the two that protect people who did nothing:
//
//   * THE MIGRATION — every install that predates this feature holds an
//     `activeThemeId` and no `themePreference`. It must land on "fixed" with
//     the same theme on screen. Nobody's app changes appearance because they
//     updated.
//   * THE FALLBACKS — an unknown mode, a half of the pair naming a theme this
//     machine does not have, a custom theme flipped from dark to light behind
//     the pairing's back. Each has to leave a real theme applied; "themeless"
//     is not an outcome the app can render.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { installMatchMedia, uninstallMatchMedia } from "@/test/matchMediaStub";

const STORAGE_KEY = "pg-settings-v2";

/** The store applies the theme at module load, so every test re-imports. */
async function freshStore() {
  vi.resetModules();
  return await import("./useSettingsStore");
}

const appliedThemeId = () => document.documentElement.dataset.theme;
const appliedMode = () => document.documentElement.dataset.themeMode;

/** A minimal but complete custom theme, so a pairing can name a non-builtin. */
function customTheme(id: string, mode: "dark" | "light") {
  return {
    id,
    name: id,
    mode,
    colors: {
      bg0: "#111111", bg1: "#161616", bg2: "#1c1c1c", bg3: "#222222",
      bg4: "#2a2a2a", titlebar: "#141414", fg0: "#eeeeee", fg1: "#cccccc",
      fg2: "#999999", fg3: "#777777", fg4: "#555555", border0: "#2a2a2a",
      border1: "#333333", border2: "#444444", accent: "#ff6600",
      accentInk: "#111111", logo: "#3e9b91", logo2: "#e6a95a",
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  uninstallMatchMedia();
});

afterEach(() => {
  uninstallMatchMedia();
});

// ═════════════════════════════════════════════════════════════════════════════
// THE MIGRATION
// ═════════════════════════════════════════════════════════════════════════════

describe("an install from before themePreference existed", () => {
  it("lands on fixed with its theme untouched, whatever the OS is doing", async () => {
    installMatchMedia("light"); // the OS is light; the app must not care
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeThemeId: "nord" }));
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.themePreference.mode).toBe("fixed");
    expect(s.activeThemeId).toBe("nord");
    expect(appliedThemeId()).toBe("nord");
    expect(appliedMode()).toBe("dark");
  });

  it("seeds the matching half of the pair from the theme it was already on", async () => {
    // So the day they DO switch to "Follow system", the half they were already
    // in is the one they kept — not the built-in pairing.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeThemeId: "gruvbox-dark" }));
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().themePreference.darkId).toBe("gruvbox-dark");
    expect(useSettingsStore.getState().themePreference.lightId).toBe("light");
  });

  it("seeds from a custom theme too", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeThemeId: "mine",
        customThemes: [customTheme("mine", "light")],
      }),
    );
    const { useSettingsStore } = await freshStore();
    const pref = useSettingsStore.getState().themePreference;
    expect(pref.lightId).toBe("mine");
    expect(pref.darkId).toBe("dark-cool");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FRESH INSTALLS
// ═════════════════════════════════════════════════════════════════════════════

describe("a fresh install", () => {
  it("is fixed on dark-cool, exactly as before this feature", async () => {
    installMatchMedia("light");
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.themePreference).toEqual({
      mode: "fixed",
      lightId: "light",
      darkId: "dark-cool",
    });
    expect(appliedThemeId()).toBe("dark-cool");
  });

  it("follows the system the moment the mode is switched, with no other setup", async () => {
    installMatchMedia("light");
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().setThemeFollowMode("system");
    expect(useSettingsStore.getState().activeThemeId).toBe("light");
    expect(appliedThemeId()).toBe("light");
    expect(appliedMode()).toBe("light");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RESOLUTION
// ═════════════════════════════════════════════════════════════════════════════

describe("system mode", () => {
  it("resolves to the dark half when the OS reports dark", async () => {
    installMatchMedia("dark");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeThemeId: "light",
        themePreference: { mode: "system", lightId: "github-light", darkId: "nord" },
      }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().activeThemeId).toBe("nord");
    expect(appliedThemeId()).toBe("nord");
    expect(appliedMode()).toBe("dark");
  });

  it("resolves to the light half when the OS reports light", async () => {
    installMatchMedia("light");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeThemeId: "nord",
        themePreference: { mode: "system", lightId: "github-light", darkId: "nord" },
      }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().activeThemeId).toBe("github-light");
    expect(appliedThemeId()).toBe("github-light");
    expect(appliedMode()).toBe("light");
  });

  it("re-resolves and re-applies when the OS switches mid-session", async () => {
    installMatchMedia("dark");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        themePreference: { mode: "system", lightId: "github-light", darkId: "nord" },
      }),
    );
    const { useSettingsStore, BUILTIN_THEMES } = await freshStore();
    expect(appliedThemeId()).toBe("nord");

    useSettingsStore.getState().syncSystemAppearance("light");
    expect(useSettingsStore.getState().systemAppearance).toBe("light");
    expect(useSettingsStore.getState().activeThemeId).toBe("github-light");
    expect(appliedThemeId()).toBe("github-light");
    // On Windows/Linux the titlebar is OURS, painted from --bg-titlebar — so
    // "the titlebar follows too" is exactly applyTheme having re-run.
    const target = BUILTIN_THEMES.find((t) => t.id === "github-light")!;
    expect(document.documentElement.style.getPropertyValue("--bg-titlebar")).toBe(
      target.colors.titlebar,
    );
  });

  it("leaves a fixed install alone when the OS switches", async () => {
    installMatchMedia("dark");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeThemeId: "dracula" }));
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().syncSystemAppearance("light");
    // Observed, and recorded — but nothing on screen moves.
    expect(useSettingsStore.getState().systemAppearance).toBe("light");
    expect(useSettingsStore.getState().activeThemeId).toBe("dracula");
    expect(appliedThemeId()).toBe("dracula");
  });

  it("switching back to fixed keeps whatever is on screen", async () => {
    installMatchMedia("light");
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().setThemeFollowMode("system");
    expect(useSettingsStore.getState().activeThemeId).toBe("light");
    useSettingsStore.getState().setThemeFollowMode("fixed");
    expect(useSettingsStore.getState().activeThemeId).toBe("light");
    useSettingsStore.getState().syncSystemAppearance("dark");
    expect(useSettingsStore.getState().activeThemeId).toBe("light");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// VALIDATION — a hand-edited or foreign payload must not poison the store
// ═════════════════════════════════════════════════════════════════════════════

describe("a payload the app did not write", () => {
  it("reads an unknown mode as fixed, so activeThemeId still answers", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeThemeId: "dracula",
        themePreference: { mode: "auto", lightId: "light", darkId: "nord" },
      }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().themePreference.mode).toBe("fixed");
    expect(appliedThemeId()).toBe("dracula");
  });

  it("repairs a half that names a theme this machine does not have", async () => {
    installMatchMedia("light");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        themePreference: { mode: "system", lightId: "someone-elses-theme", darkId: "nord" },
      }),
    );
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    // Repaired in state, not merely resolved around — the Settings picker has
    // to show what the app will actually use.
    expect(s.themePreference.lightId).toBe("light");
    expect(s.themePreference.darkId).toBe("nord");
    expect(appliedThemeId()).toBe("light");
  });

  it("repairs a half that names a theme of the wrong mode", async () => {
    // Otherwise "follow the system" resolves to the same half twice and the
    // app never switches — the exact bug the feature exists to fix.
    installMatchMedia("dark");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        themePreference: { mode: "system", lightId: "light", darkId: "github-light" },
      }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().themePreference.darkId).toBe("dark-cool");
    expect(appliedMode()).toBe("dark");
  });

  it("survives a missing half, a wrong type and a non-object", async () => {
    for (const themePreference of [
      { mode: "system" },
      { mode: "system", lightId: 7, darkId: null },
      "system",
      [],
      null,
    ]) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ themePreference }));
      const { useSettingsStore } = await freshStore();
      const pref = useSettingsStore.getState().themePreference;
      expect(typeof pref.lightId).toBe("string");
      expect(typeof pref.darkId).toBe("string");
      expect(["system", "fixed"]).toContain(pref.mode);
      // Whatever the payload said, a real theme is on screen.
      expect(useSettingsStore.getState().getActiveTheme().colors.bg0).toBeTruthy();
      expect(appliedThemeId()).toBeTruthy();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LIVING WITH THE PAIRING
// ═════════════════════════════════════════════════════════════════════════════

describe("editing themes while following the system", () => {
  it("picking a theme writes the half matching its OWN mode", async () => {
    installMatchMedia("dark");
    const { useSettingsStore } = await freshStore();
    const s = () => useSettingsStore.getState();
    s().setThemeFollowMode("system");
    // A light theme picked while the OS is dark is the light half of the pair.
    // It does not win the screen — that would break the promise of the mode.
    s().setActiveThemeId("github-light");
    expect(s().themePreference.lightId).toBe("github-light");
    expect(s().activeThemeId).toBe("dark-cool");
    // A dark one does take effect immediately.
    s().setActiveThemeId("dracula");
    expect(s().themePreference.darkId).toBe("dracula");
    expect(s().activeThemeId).toBe("dracula");
  });

  it("a fork of the active theme survives the next re-resolve", async () => {
    installMatchMedia("dark");
    const { useSettingsStore } = await freshStore();
    const s = () => useSettingsStore.getState();
    s().setThemeFollowMode("system");
    // Editing a builtin auto-duplicates it; in system mode the duplicate has
    // to become the dark half, or the next OS flip throws the fork away.
    s().updateActiveColors({ accent: "#ff0000" });
    const forkId = s().activeThemeId;
    expect(forkId).not.toBe("dark-cool");
    s().syncSystemAppearance("light");
    s().syncSystemAppearance("dark");
    expect(s().activeThemeId).toBe(forkId);
  });

  it("deleting a paired theme repairs the pair instead of leaving it dangling", async () => {
    installMatchMedia("dark");
    const { useSettingsStore } = await freshStore();
    const s = () => useSettingsStore.getState();
    s().setThemeFollowMode("system");
    const fork = s().saveAsNewTheme("Mine");
    expect(s().themePreference.darkId).toBe(fork.id);
    s().deleteTheme(fork.id);
    expect(s().themePreference.darkId).toBe("dark-cool");
    expect(s().activeThemeId).toBe("dark-cool");
    expect(appliedThemeId()).toBe("dark-cool");
  });

  it("setPairedThemeId refuses a theme of the wrong mode", async () => {
    const { useSettingsStore } = await freshStore();
    const s = () => useSettingsStore.getState();
    s().setPairedThemeId("light", "nord");
    expect(s().themePreference.lightId).toBe("light");
    s().setPairedThemeId("light", "github-light");
    expect(s().themePreference.lightId).toBe("github-light");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PERSISTENCE
// ═════════════════════════════════════════════════════════════════════════════

describe("what reaches localStorage", () => {
  it("persists the preference and never the observed appearance", async () => {
    installMatchMedia("light");
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().setThemeFollowMode("system");
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.themePreference).toEqual({
      mode: "system",
      lightId: "light",
      darkId: "dark-cool",
    });
    // Observed state about THIS machine at THIS moment — not a setting.
    expect(raw).not.toHaveProperty("systemAppearance");
  });

  it("re-resolves when the preference goes through the generic setter", async () => {
    // `set(key, value)` is public API and must not be a back door around the
    // resolve — a preference set without re-deriving activeThemeId leaves
    // "follow the system" on with the wrong half on screen.
    installMatchMedia("light");
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("themePreference", {
      mode: "system",
      lightId: "github-light",
      darkId: "nord",
    });
    expect(useSettingsStore.getState().activeThemeId).toBe("github-light");
    expect(appliedThemeId()).toBe("github-light");
  });

  it("re-resolves at load from the OS, not from the persisted active id", async () => {
    // The persisted `activeThemeId` is a cache of the last resolution. Booting
    // on the other appearance must not honour it.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeThemeId: "nord",
        themePreference: { mode: "system", lightId: "github-light", darkId: "nord" },
      }),
    );
    installMatchMedia("light");
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().activeThemeId).toBe("github-light");
  });
});
