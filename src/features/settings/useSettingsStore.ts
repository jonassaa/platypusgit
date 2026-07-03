import { create } from "zustand";
import type { PullMode } from "@/lib/tauri";

const STORAGE_KEY = "pg-settings-v2";

// ═════════════════════════════════════════════════════════════════════════════
// THEME MODEL
// ═════════════════════════════════════════════════════════════════════════════

export interface ThemeColors {
  bg0: string;
  bg1: string;
  bg2: string;
  bg3: string;
  bg4: string;
  titlebar: string;
  fg0: string;
  fg1: string;
  fg2: string;
  fg3: string;
  fg4: string;
  border0: string;
  border1: string;
  border2: string;
  accent: string;
  accentInk: string;
}

export interface ThemeDef {
  id: string;
  name: string;
  mode: "dark" | "light";
  builtin?: boolean;
  colors: ThemeColors;
}

export const THEME_COLOR_FIELDS: {
  key: keyof ThemeColors;
  label: string;
  group: "background" | "foreground" | "border" | "accent";
  hint?: string;
}[] = [
  { key: "bg0", label: "Background · base", group: "background", hint: "App canvas / main content area." },
  { key: "bg1", label: "Background · panel", group: "background", hint: "Sidebar, cards, panel bodies." },
  { key: "bg2", label: "Background · elevated", group: "background", hint: "Inputs, panel headers." },
  { key: "bg3", label: "Background · hover", group: "background", hint: "Hovered rows, buttons." },
  { key: "bg4", label: "Background · active", group: "background", hint: "Pressed / selected rows." },
  { key: "titlebar", label: "Titlebar", group: "background", hint: "Window chrome + activity bar." },
  { key: "fg0", label: "Foreground · primary", group: "foreground", hint: "Primary text color." },
  { key: "fg1", label: "Foreground · secondary", group: "foreground", hint: "Secondary text, labels." },
  { key: "fg2", label: "Foreground · muted", group: "foreground", hint: "Captions, meta, icons." },
  { key: "fg3", label: "Foreground · subtle", group: "foreground", hint: "Placeholders, hints." },
  { key: "fg4", label: "Foreground · disabled", group: "foreground", hint: "Disabled text." },
  { key: "border0", label: "Border · subtle", group: "border", hint: "Panel separators." },
  { key: "border1", label: "Border · default", group: "border", hint: "Inputs, buttons." },
  { key: "border2", label: "Border · emphasis", group: "border", hint: "Hovered / focused borders." },
  { key: "accent", label: "Accent", group: "accent", hint: "Primary actions, active tabs, focus rings." },
  { key: "accentInk", label: "Accent · on-ink", group: "accent", hint: "Text drawn *on* accent (buttons)." },
];

// ─── Built-in themes ─────────────────────────────────────────────────────────

export const BUILTIN_THEMES: ThemeDef[] = [
  {
    id: "dark-cool",
    name: "Dark · Cool",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#1a1d24",
      bg1: "#1e222a",
      bg2: "#232833",
      bg3: "#2a303c",
      bg4: "#343b47",
      titlebar: "#1f232c",
      fg0: "#eef1f5",
      fg1: "#c6cad2",
      fg2: "#8d94a1",
      fg3: "#656b77",
      fg4: "#4c525d",
      border0: "#2d323c",
      border1: "#393f4b",
      border2: "#515764",
      accent: "#5aa8e8",
      accentInk: "#0e1a26",
    },
  },
  {
    id: "dark-warm",
    name: "Dark · Warm",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#1e1a17",
      bg1: "#231f1b",
      bg2: "#2a2520",
      bg3: "#322c26",
      bg4: "#3d362f",
      titlebar: "#241f1b",
      fg0: "#f2ece4",
      fg1: "#d3c9bd",
      fg2: "#9e9387",
      fg3: "#736a5f",
      fg4: "#574f46",
      border0: "#332c26",
      border1: "#3f3830",
      border2: "#57504a",
      accent: "#e6a050",
      accentInk: "#241607",
    },
  },
  {
    id: "dark-neutral",
    name: "Dark · Neutral",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#1c1c1c",
      bg1: "#212121",
      bg2: "#282828",
      bg3: "#303030",
      bg4: "#3a3a3a",
      titlebar: "#232323",
      fg0: "#f0f0f0",
      fg1: "#cccccc",
      fg2: "#999999",
      fg3: "#707070",
      fg4: "#555555",
      border0: "#2e2e2e",
      border1: "#3a3a3a",
      border2: "#4c4c4c",
      accent: "#7aa7d9",
      accentInk: "#101820",
    },
  },
  {
    id: "light",
    name: "Light",
    mode: "light",
    builtin: true,
    colors: {
      bg0: "#fcfcfd",
      bg1: "#f6f7f9",
      bg2: "#eef0f3",
      bg3: "#e4e7ec",
      bg4: "#d7dbe2",
      titlebar: "#f0f2f5",
      fg0: "#1c2129",
      fg1: "#3a414c",
      fg2: "#5c6472",
      fg3: "#808894",
      fg4: "#a3aab4",
      border0: "#dde1e6",
      border1: "#cdd2da",
      border2: "#b3bac3",
      accent: "#2563c7",
      accentInk: "#ffffff",
    },
  },
  {
    id: "nord",
    name: "Nord",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#2e3440",
      bg1: "#323846",
      bg2: "#3b4252",
      bg3: "#434c5e",
      bg4: "#4c566a",
      titlebar: "#2b303b",
      fg0: "#eceff4",
      fg1: "#e5e9f0",
      fg2: "#d8dee9",
      fg3: "#a1acbf",
      fg4: "#6d7a8e",
      border0: "#3b4252",
      border1: "#434c5e",
      border2: "#4c566a",
      accent: "#88c0d0",
      accentInk: "#2e3440",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#282a36",
      bg1: "#2d2f3d",
      bg2: "#353746",
      bg3: "#3d4052",
      bg4: "#44475a",
      titlebar: "#21222c",
      fg0: "#f8f8f2",
      fg1: "#e8e8dd",
      fg2: "#c5c6b8",
      fg3: "#8a8c80",
      fg4: "#6272a4",
      border0: "#343746",
      border1: "#3e4154",
      border2: "#4b4f65",
      accent: "#bd93f9",
      accentInk: "#282a36",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#002b36",
      bg1: "#063541",
      bg2: "#073642",
      bg3: "#0b4250",
      bg4: "#104f60",
      titlebar: "#00252e",
      fg0: "#fdf6e3",
      fg1: "#eee8d5",
      fg2: "#93a1a1",
      fg3: "#839496",
      fg4: "#586e75",
      border0: "#0b4250",
      border1: "#104f60",
      border2: "#1a6379",
      accent: "#268bd2",
      accentInk: "#002b36",
    },
  },
  {
    id: "gruvbox-dark",
    name: "Gruvbox Dark",
    mode: "dark",
    builtin: true,
    colors: {
      bg0: "#282828",
      bg1: "#32302f",
      bg2: "#3c3836",
      bg3: "#504945",
      bg4: "#665c54",
      titlebar: "#1d2021",
      fg0: "#fbf1c7",
      fg1: "#ebdbb2",
      fg2: "#d5c4a1",
      fg3: "#a89984",
      fg4: "#7c6f64",
      border0: "#3c3836",
      border1: "#504945",
      border2: "#665c54",
      accent: "#d79921",
      accentInk: "#1d2021",
    },
  },
  {
    id: "github-light",
    name: "GitHub Light",
    mode: "light",
    builtin: true,
    colors: {
      bg0: "#ffffff",
      bg1: "#f6f8fa",
      bg2: "#eaeef2",
      bg3: "#dee3e8",
      bg4: "#d0d7de",
      titlebar: "#f6f8fa",
      fg0: "#1f2328",
      fg1: "#414852",
      fg2: "#656d76",
      fg3: "#8c959f",
      fg4: "#afb8c1",
      border0: "#d0d7de",
      border1: "#afb8c1",
      border2: "#8c959f",
      accent: "#0969da",
      accentInk: "#ffffff",
    },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// APPLY + PERSIST
// ═════════════════════════════════════════════════════════════════════════════

/** Apply theme by writing every color slot to CSS vars on :root. */
export function applyTheme(theme: ThemeDef) {
  const root = document.documentElement;
  const c = theme.colors;
  root.style.setProperty("--bg-0", c.bg0);
  root.style.setProperty("--bg-1", c.bg1);
  root.style.setProperty("--bg-2", c.bg2);
  root.style.setProperty("--bg-3", c.bg3);
  root.style.setProperty("--bg-4", c.bg4);
  root.style.setProperty("--bg-titlebar", c.titlebar);
  root.style.setProperty("--fg-0", c.fg0);
  root.style.setProperty("--fg-1", c.fg1);
  root.style.setProperty("--fg-2", c.fg2);
  root.style.setProperty("--fg-3", c.fg3);
  root.style.setProperty("--fg-4", c.fg4);
  root.style.setProperty("--border-0", c.border0);
  root.style.setProperty("--border-1", c.border1);
  root.style.setProperty("--border-2", c.border2);
  root.style.setProperty("--accent", c.accent);
  root.style.setProperty("--accent-ink", c.accentInk);
  root.style.setProperty("--ring", `0 0 0 2px ${c.accent}80`);
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
}

/** Apply UI density by writing the row-height slot to CSS vars on :root. */
export function applyDensity(density: "compact" | "comfortable") {
  const root = document.documentElement;
  root.style.setProperty("--row-h", density === "comfortable" ? "28px" : "24px");
  root.dataset.density = density;
}

// ═════════════════════════════════════════════════════════════════════════════
// STORE
// ═════════════════════════════════════════════════════════════════════════════

// Removed settings (persisted keys are dropped by load()'s known-key filter):
// - signCommits: GPG/SSH signing needs real key plumbing; a toggle that only
//   pretends to sign erodes trust. Re-add together with actual signing.
// - showWhitespaceInDiff: no cheap consumer — libgit2's whitespace flags
//   invert the semantics and would desync hunk indices from staging.
interface PersistedState {
  activeThemeId: string;
  customThemes: ThemeDef[];
  uiDensity: "compact" | "comfortable";
  defaultPullMode: PullMode;
  autoFetchEnabled: boolean;
  autoFetchMinutes: number;
  pruneOnFetch: boolean;
  confirmForcePush: boolean;
  autoStashBeforePull: boolean;
  addSignoff: boolean;
  diffContextLines: number;
}

export interface SettingsState extends PersistedState {
  getActiveTheme: () => ThemeDef;
  setActiveThemeId: (id: string) => void;
  updateActiveColors: (patch: Partial<ThemeColors>) => void;
  saveAsNewTheme: (name: string) => ThemeDef;
  renameTheme: (id: string, name: string) => void;
  deleteTheme: (id: string) => void;
  duplicateTheme: (id: string, newName?: string) => ThemeDef;
  exportTheme: (id: string) => string;
  downloadTheme: (id: string) => void;
  importThemeJson: (json: string) => ThemeDef;
  set: <K extends keyof PersistedState>(key: K, value: PersistedState[K]) => void;
  reset: () => void;
}

const DEFAULTS: PersistedState = {
  activeThemeId: "dark-cool",
  customThemes: [],
  uiDensity: "compact",
  defaultPullMode: "Rebase",
  autoFetchEnabled: false,
  autoFetchMinutes: 5,
  pruneOnFetch: true,
  confirmForcePush: true,
  autoStashBeforePull: true,
  addSignoff: false,
  diffContextLines: 3,
};

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Only pick keys that still exist in the schema, so settings removed in
    // newer versions (e.g. signCommits, showWhitespaceInDiff) don't leak
    // stale properties into the store state.
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof PersistedState)[]) {
      if (key in parsed) {
        (out as Record<string, unknown>)[key] = parsed[key];
      }
    }
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(state: PersistedState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // non-fatal
  }
}

function snapshot(s: SettingsState): PersistedState {
  return {
    activeThemeId: s.activeThemeId,
    customThemes: s.customThemes,
    uiDensity: s.uiDensity,
    defaultPullMode: s.defaultPullMode,
    autoFetchEnabled: s.autoFetchEnabled,
    autoFetchMinutes: s.autoFetchMinutes,
    pruneOnFetch: s.pruneOnFetch,
    confirmForcePush: s.confirmForcePush,
    autoStashBeforePull: s.autoStashBeforePull,
    addSignoff: s.addSignoff,
    diffContextLines: s.diffContextLines,
  };
}

function findTheme(
  state: Pick<SettingsState, "customThemes">,
  id: string,
): ThemeDef | undefined {
  return (
    BUILTIN_THEMES.find((t) => t.id === id) ??
    state.customThemes.find((t) => t.id === id)
  );
}

function uniqueId(existing: ThemeDef[]): string {
  return `custom-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}${existing.length > 0 ? "" : ""}`;
}

function sanitizeHex(value: string): string {
  // Accept "#rgb", "#rrggbb", "#rrggbbaa". Return 6-char hex. Return "#000000" if invalid.
  const v = value.trim().toLowerCase();
  if (!/^#?[0-9a-f]{3,8}$/.test(v)) return "#000000";
  const body = v.startsWith("#") ? v.slice(1) : v;
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  if (body.length === 6) return `#${body}`;
  if (body.length === 8) return `#${body.slice(0, 6)}`;
  return "#000000";
}

function validateTheme(obj: unknown): ThemeDef {
  if (!obj || typeof obj !== "object") throw new Error("Not a JSON object");
  const o = obj as Record<string, unknown>;
  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Imported theme";
  const mode = o.mode === "light" ? "light" : "dark";
  const colors = o.colors as Record<string, unknown> | undefined;
  if (!colors || typeof colors !== "object") throw new Error("Missing colors");
  const out: Partial<ThemeColors> = {};
  for (const f of THEME_COLOR_FIELDS) {
    const raw = colors[f.key];
    if (typeof raw !== "string") throw new Error(`Missing color: ${f.key}`);
    out[f.key] = sanitizeHex(raw);
  }
  return {
    id: `custom-imported-${Date.now().toString(36)}`,
    name,
    mode,
    colors: out as ThemeColors,
  };
}

const initial = load();

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,

  getActiveTheme() {
    const s = get();
    return (
      findTheme(s, s.activeThemeId) ??
      BUILTIN_THEMES[0]
    );
  },

  setActiveThemeId(id) {
    const s = get();
    const theme = findTheme(s, id);
    if (!theme) return;
    set({ activeThemeId: id });
    persist(snapshot(get()));
    applyTheme(theme);
  },

  updateActiveColors(patch) {
    const s = get();
    const active = findTheme(s, s.activeThemeId);
    if (!active) return;

    // Built-in themes are read-only: auto-duplicate first, then apply the edit.
    if (active.builtin) {
      const dup: ThemeDef = {
        id: uniqueId(s.customThemes),
        name: `${active.name} (custom)`,
        mode: active.mode,
        colors: { ...active.colors, ...patch },
      };
      set({
        customThemes: [...s.customThemes, dup],
        activeThemeId: dup.id,
      });
      persist(snapshot(get()));
      applyTheme(dup);
      return;
    }

    const updated: ThemeDef = {
      ...active,
      colors: { ...active.colors, ...patch },
    };
    set({
      customThemes: s.customThemes.map((t) => (t.id === active.id ? updated : t)),
    });
    persist(snapshot(get()));
    applyTheme(updated);
  },

  saveAsNewTheme(name) {
    const s = get();
    const active = findTheme(s, s.activeThemeId) ?? BUILTIN_THEMES[0];
    const dup: ThemeDef = {
      id: uniqueId(s.customThemes),
      name: name.trim() || `${active.name} (copy)`,
      mode: active.mode,
      colors: { ...active.colors },
    };
    set({
      customThemes: [...s.customThemes, dup],
      activeThemeId: dup.id,
    });
    persist(snapshot(get()));
    applyTheme(dup);
    return dup;
  },

  duplicateTheme(id, newName) {
    const s = get();
    const src = findTheme(s, id);
    if (!src) throw new Error(`No theme with id ${id}`);
    const dup: ThemeDef = {
      id: uniqueId(s.customThemes),
      name: newName?.trim() || `${src.name} (copy)`,
      mode: src.mode,
      colors: { ...src.colors },
    };
    set({
      customThemes: [...s.customThemes, dup],
      activeThemeId: dup.id,
    });
    persist(snapshot(get()));
    applyTheme(dup);
    return dup;
  },

  renameTheme(id, name) {
    const s = get();
    const found = s.customThemes.find((t) => t.id === id);
    if (!found) return;
    set({
      customThemes: s.customThemes.map((t) =>
        t.id === id ? { ...t, name: name.trim() || t.name } : t,
      ),
    });
    persist(snapshot(get()));
  },

  deleteTheme(id) {
    const s = get();
    if (!s.customThemes.some((t) => t.id === id)) return;
    const next = s.customThemes.filter((t) => t.id !== id);
    const nextActive =
      s.activeThemeId === id ? "dark-cool" : s.activeThemeId;
    set({ customThemes: next, activeThemeId: nextActive });
    persist(snapshot(get()));
    if (s.activeThemeId === id) {
      applyTheme(BUILTIN_THEMES[0]);
    }
  },

  exportTheme(id) {
    const s = get();
    const t = findTheme(s, id);
    if (!t) throw new Error(`No theme with id ${id}`);
    const payload = {
      $schema: "https://platypusgit.dev/theme.schema.json",
      version: 1,
      name: t.name,
      mode: t.mode,
      colors: t.colors,
    };
    return JSON.stringify(payload, null, 2);
  },

  downloadTheme(id) {
    const json = get().exportTheme(id);
    const theme = findTheme(get(), id);
    const slug = (theme?.name ?? "theme")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "theme"}.pgtheme.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  importThemeJson(json) {
    const parsed = JSON.parse(json);
    const theme = validateTheme(parsed);
    const s = get();
    // Ensure id is unique among customs.
    theme.id = uniqueId(s.customThemes);
    set({
      customThemes: [...s.customThemes, theme],
      activeThemeId: theme.id,
    });
    persist(snapshot(get()));
    applyTheme(theme);
    return theme;
  },

  set(key, value) {
    set({ [key]: value } as Partial<SettingsState>);
    persist(snapshot(get()));
    if (key === "uiDensity") {
      applyDensity(get().uiDensity);
    }
  },

  reset() {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
    applyTheme(BUILTIN_THEMES[0]);
    applyDensity(DEFAULTS.uiDensity);
  },
}));

// Apply active theme + density on module load so there's no flash before
// first render.
{
  const s = useSettingsStore.getState();
  const active = findTheme(s, s.activeThemeId) ?? BUILTIN_THEMES[0];
  applyTheme(active);
  applyDensity(s.uiDensity);
}
