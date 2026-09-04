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
  document.documentElement.style.removeProperty("--row-step");
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

  it("drops removed settings (showWhitespaceInDiff) from old payloads", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        showWhitespaceInDiff: true,
        pruneOnFetch: false,
      }),
    );
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    // Known key still honored…
    expect(s.pruneOnFetch).toBe(false);
    // …but stale keys don't leak into store state.
    expect("showWhitespaceInDiff" in s).toBe(false);

    // And the next persist writes a clean payload without them.
    useSettingsStore.getState().set("pruneOnFetch", true);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect("showWhitespaceInDiff" in raw).toBe(false);
    expect(raw.pruneOnFetch).toBe(true);
  });

  // signCommits was a removed no-op setting and is now real (#61 D6), so a
  // persisted value must be honored again rather than filtered out. An OLD
  // payload holds a boolean, though, where the setting is now tri-state.
  it("honors signCommits and defaults to following git config", async () => {
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().signCommits).toBe("config");

    useSettingsStore.getState().set("signCommits", "always");
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.signCommits).toBe("always");
  });

  it("falls back to following git config for a legacy boolean signCommits", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ signCommits: true }));
    const { useSettingsStore } = await freshStore();
    // A stale boolean is not one of the three valid modes; "config" is the safe
    // reading, since it defers to the repository instead of forcing signing on.
    expect(useSettingsStore.getState().signCommits).toBe("config");
  });

  it("defaults the diff to an inline, whole-file view", async () => {
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.diffViewMode).toBe("inline");
    expect(s.diffContextMode).toBe("wholeFile");
  });

  it("persists both diff view settings", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("diffViewMode", "split");
    useSettingsStore.getState().set("diffContextMode", "chunks");
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.diffViewMode).toBe("split");
    expect(raw.diffContextMode).toBe("chunks");
  });

  // Same reasoning as the uiDensity clamp below: load() copies a persisted value
  // for a known key without validating it, and an unknown mode reaching the
  // renderer would mean "neither branch" — a blank diff pane.
  it("degrades unrecognized persisted diff modes to the defaults", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ diffViewMode: "sideways", diffContextMode: "everything" }),
    );
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.diffViewMode).toBe("inline");
    expect(s.diffContextMode).toBe("wholeFile");
  });

  it("set() persists the changed key", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("autoStashBeforePull", false);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(raw.autoStashBeforePull).toBe(false);
  });
});

// The HEAD treatment moved from one `headIndicator` enum to marks × weight. The
// old key is NOT in the schema any more, so the generic copy loop skips it — the
// migration has to reach into the raw payload, and these tests are what say it
// still does. Silently losing the setting looks identical to a fresh install.
describe("head marks migration", () => {
  it("carries a legacy headIndicator over to marks at the strong weight", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ headIndicator: "both" }));
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.headMarks).toEqual(["bar", "tint", "ring"]);
    expect(s.headWeight).toBe("strong");
  });

  it("keeps a legacy 'none' honest — the graph ring, and nothing else", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ headIndicator: "none" }));
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().headMarks).toEqual(["ring"]);
  });

  it("prefers a stored mark list over the legacy key", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ headIndicator: "both", headMarks: ["badge"] }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().headMarks).toEqual(["badge"]);
  });

  it("respects an empty mark list instead of resetting to the default", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ headMarks: [] }));
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().headMarks).toEqual([]);
  });

  it("sanitizes a junk list and an unknown weight", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ headMarks: ["ring", "sparkles", "ring"], headWeight: "nuclear" }),
    );
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.headMarks).toEqual(["ring"]);
    expect(s.headWeight).toBe("strong");
  });

  it("defaults a fresh install to bar + wash + ring", async () => {
    const { useSettingsStore } = await freshStore();
    const s = useSettingsStore.getState();
    expect(s.headMarks).toEqual(["bar", "tint", "ring"]);
    expect(s.headWeight).toBe("strong");
  });
});

describe("updateCheckMode (#237)", () => {
  // The out-of-box behaviour must not change: an app that stops telling people
  // about security fixes by default is worse than one that asks.
  it("defaults to auto", async () => {
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().updateCheckMode).toBe("auto");
  });

  it("honors a persisted mode", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ updateCheckMode: "never" }));
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().updateCheckMode).toBe("never");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ updateCheckMode: "manual" }));
    const again = await freshStore();
    expect(again.useSettingsStore.getState().updateCheckMode).toBe("manual");
  });

  // Same reasoning as the signCommits tri-state and the diff modes: the store
  // and the gate branch on these exact strings, so an unknown value has to fall
  // back rather than resolve to "neither" — which here would mean an app that
  // silently never checks for updates again.
  it("falls back to auto for an unknown or wrongly-typed persisted value", async () => {
    for (const bad of ["weekly", "", true, 0, null] as unknown[]) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ updateCheckMode: bad }));
      const { useSettingsStore } = await freshStore();
      expect(useSettingsStore.getState().updateCheckMode, String(bad)).toBe("auto");
    }
  });

  it("reset() returns to auto", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("updateCheckMode", "never");
    expect(useSettingsStore.getState().updateCheckMode).toBe("never");
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().updateCheckMode).toBe("auto");
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

  it("applyTheme writes every --syn-* token", async () => {
    const { applyTheme, BUILTIN_THEMES } = await freshStore();
    const { SYN_TOKENS } = await import("@/lib/syntax/scopes");
    applyTheme({ ...BUILTIN_THEMES[0], mode: "dark" });
    const root = document.documentElement.style;
    for (const t of SYN_TOKENS) {
      expect(root.getPropertyValue(`--syn-${t}`), `--syn-${t}`).not.toBe("");
    }
  });

  it("calibrates --syn-* separately for light mode", async () => {
    const { applyTheme, BUILTIN_THEMES } = await freshStore();
    const base = BUILTIN_THEMES[0];
    const root = document.documentElement.style;
    applyTheme({ ...base, mode: "dark" });
    const dark = root.getPropertyValue("--syn-keyword");
    applyTheme({ ...base, mode: "light" });
    const light = root.getPropertyValue("--syn-keyword");
    // Dark-calibrated syntax colours over a light canvas wash out exactly like
    // the diff and graph tokens did (#61 B4), so the two must differ.
    expect(light).not.toBe(dark);
    expect(light).not.toBe("");
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

// Density is one CSS var — `--row-step` — that every row surface adds to its
// base geometry (index.css derives `--row-h` and friends from it). jsdom can't
// resolve those calc()s, so the per-surface pixel results are asserted in
// e2e/specs/settings.e2e.ts against a real webview; here we pin the var itself.
const rowStep = () =>
  document.documentElement.style.getPropertyValue("--row-step");

// ═════════════════════════════════════════════════════════════════════════════
// DATE FORMAT (#354)
// ═════════════════════════════════════════════════════════════════════════════

describe("dateFormat", () => {
  // Relative by default: the pre-#354 log, unchanged for anyone who never
  // opens Settings. The hover tooltip is what gives them the exact time.
  it("defaults to relative", async () => {
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().dateFormat).toBe("relative");
  });

  it("persists a chosen format", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("dateFormat", "both");
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as Record<string, unknown>;
    expect(raw.dateFormat).toBe("both");
    const again = await freshStore();
    expect(again.useSettingsStore.getState().dateFormat).toBe("both");
  });

  // The format picks the Date column's WIDTH as well as its text, so an
  // unknown value would size the column from `undefined` — every row's grid
  // resolving to `auto` at once, which is the density trap one column over.
  it("falls back to relative for an unknown or wrongly-typed persisted value", async () => {
    for (const bad of ["iso", "Relative", "", true, 0, null] as unknown[]) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ dateFormat: bad }));
      const { useSettingsStore } = await freshStore();
      expect(useSettingsStore.getState().dateFormat, String(bad)).toBe("relative");
    }
  });

  it("reset() returns to relative", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("dateFormat", "absolute");
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().dateFormat).toBe("relative");
  });

  it("useDateColumnWidth reports the width the chosen format needs", async () => {
    const { useSettingsStore, useDateColumnWidth } = await freshStore();
    const { DATE_COL_W } = await import("@/design/graph-geometry");
    const { renderHook } = await import("@testing-library/react");
    const { act } = await import("react");

    const { result } = renderHook(() => useDateColumnWidth());
    expect(result.current).toBe(DATE_COL_W.relative);

    await act(async () => {
      useSettingsStore.getState().set("dateFormat", "both");
    });
    expect(result.current).toBe(DATE_COL_W.both);
  });
});

describe("uiDensity CSS hook", () => {
  it("applies --row-step from the persisted density at load", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiDensity: "comfortable" }));
    await freshStore();
    expect(rowStep()).toBe("4px");
    expect(document.documentElement.dataset.density).toBe("comfortable");
  });

  it("re-applies --row-step when the density setting changes", async () => {
    const { useSettingsStore } = await freshStore();
    expect(rowStep()).toBe("0px");
    useSettingsStore.getState().set("uiDensity", "comfortable");
    expect(rowStep()).toBe("4px");
    expect(document.documentElement.dataset.density).toBe("comfortable");
    useSettingsStore.getState().set("uiDensity", "compact");
    expect(rowStep()).toBe("0px");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("reset() restores compact density", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().set("uiDensity", "comfortable");
    useSettingsStore.getState().reset();
    expect(rowStep()).toBe("0px");
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  // Compact must be a no-op delta: the pre-density layout is the compact
  // layout, so every `calc(Npx + var(--row-step))` has to collapse to Npx.
  it("keeps compact at a zero step so the default layout is unchanged", async () => {
    const { DENSITY_STEP_PX } = await freshStore();
    expect(DENSITY_STEP_PX.compact).toBe(0);
  });

  // load() copies any persisted value for a known key without validating it,
  // so an unrecognized density must degrade to compact rather than emit
  // `--row-step: undefinedpx` — an invalid substitution makes every
  // `calc(Npx + var(--row-step))` compute to `auto`, collapsing the height of
  // every row in the app at once.
  it("degrades an unrecognized persisted density to compact", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ uiDensity: "cozy" }));
    await freshStore();
    expect(rowStep()).toBe("0px");
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CUSTOM ACTIONS — the surfaces migration (#225, second half)
// ═════════════════════════════════════════════════════════════════════════════
//
// `customActions` is object-valued, so `coerceSettings`' scalar type-guard
// (which compares against `typeof DEFAULTS[key]`) never looks at it — the whole
// list arrives from localStorage exactly as it was written. That is precisely
// where an action saved before `surfaces` existed lands, and getting this wrong
// means someone's action silently disappears from the palette they have been
// running it from.
describe("useSettingsStore custom actions", () => {
  const legacy = {
    id: "act-1",
    name: "Open in editor",
    command: "code -g $FILE",
    showOutput: false,
    refreshAfter: true,
  };

  it("keeps an action saved before surfaces existed in the palette", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ customActions: [legacy] }));
    const { useSettingsStore } = await freshStore();
    // ...and reads it as having no shortcut (#225): `chord` arrived with the
    // same load, and an absent one is unbound, never a key that starts firing.
    expect(useSettingsStore.getState().customActions).toEqual([
      { ...legacy, surfaces: ["repo"], chord: "" },
    ]);
  });

  it("repairs an action a hand-edited file ticked into no surface at all", async () => {
    // The editor refuses to save one, so this can only come from a file — and
    // an action reachable from nowhere is one that can never be run. The
    // palette is where an action nobody placed has always lived.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ customActions: [{ ...legacy, surfaces: [] }] }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().customActions[0].surfaces).toEqual(["repo"]);
  });

  it("keeps a stored surface list, canonically ordered and free of unknowns", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        customActions: [{ ...legacy, surfaces: ["commit", "branch", "file"] }],
      }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().customActions[0].surfaces).toEqual([
      "file",
      "commit",
    ]);
  });

  it("drops an unusable entry rather than the whole list", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ customActions: [legacy, null, { name: "no id" }, 7] }),
    );
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().customActions.map((a) => a.id)).toEqual([
      "act-1",
    ]);
  });

  it("falls back to no actions when the stored value is not a list", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ customActions: "code" }));
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().customActions).toEqual([]);
  });
});
