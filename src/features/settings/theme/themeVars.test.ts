import { describe, expect, it } from "vitest";

import {
  BUILTIN_THEMES,
  THEME_COLOR_FIELDS,
  applyTheme,
  themeVars,
} from "@/features/settings/useSettingsStore";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

describe("themeVars", () => {
  it("carries every editable colour slot", () => {
    const vars = themeVars(dark);
    const values = new Set(Object.values(vars));
    for (const field of THEME_COLOR_FIELDS) {
      expect(
        values.has(dark.colors[field.key]!),
        `no CSS var carries ${field.key}`,
      ).toBe(true);
    }
  });

  it("maps the slots onto the vars the app actually reads", () => {
    const vars = themeVars(dark);
    expect(vars["--bg-0"]).toBe(dark.colors.bg0);
    expect(vars["--bg-titlebar"]).toBe(dark.colors.titlebar);
    expect(vars["--fg-0"]).toBe(dark.colors.fg0);
    expect(vars["--border-1"]).toBe(dark.colors.border1);
    expect(vars["--accent"]).toBe(dark.colors.accent);
    expect(vars["--accent-ink"]).toBe(dark.colors.accentInk);
  });

  it("calibrates the semantic tokens per MODE, not per theme", () => {
    expect(themeVars(dark)["--git-added"]).not.toBe(themeVars(light)["--git-added"]);
    const otherDark = BUILTIN_THEMES.find((t) => t.id === "dark-warm")!;
    expect(themeVars(otherDark)["--git-added"]).toBe(themeVars(dark)["--git-added"]);
  });

  it("fills the logo slots for a theme persisted before they existed", () => {
    // The double cast is the honest spelling: `ThemeColors.logo` is typed
    // `string`, but a theme persisted before the slots existed has neither, and
    // `themeVars` falls back to the brand palette rather than painting
    // `undefined`. The type is a white lie about localStorage's contents.
    const legacy = {
      ...dark,
      colors: { ...dark.colors, logo: undefined, logo2: undefined },
    } as unknown as typeof dark;
    const vars = themeVars(legacy);
    expect(vars["--logo"]).toBeTruthy();
    expect(vars["--logo-2"]).toBeTruthy();
  });

  it("is exactly what applyTheme writes to :root", () => {
    // The whole point of the extraction: a preview painted from this map and
    // the live app painted by applyTheme cannot drift, because there is one
    // map. If someone adds a setProperty call to applyTheme without adding it
    // here, this fails.
    document.documentElement.style.cssText = "";
    applyTheme(light);
    const root = document.documentElement.style;
    const vars = themeVars(light);
    expect(Object.keys(vars).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(vars)) {
      expect(root.getPropertyValue(name), `applyTheme did not write ${name}`).toBe(value);
    }
    expect(root.length).toBe(Object.keys(vars).length);
  });
});
