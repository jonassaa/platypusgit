import { create } from "zustand";
import type { PullMode } from "@/lib/tauri";
import {
  DEFAULT_HEAD_WEIGHT,
  HEAD_WEIGHTS,
  migrateHeadIndicator,
  normalizeHeadMarks,
  type HeadMark,
  type HeadWeight,
} from "./headMarks";
import {
  DEFAULT_TICKET_PATTERN,
  isValidTicketPattern,
} from "@/features/commits/message/ticket";
import {
  getSystemAppearance,
  watchSystemAppearance,
  type Appearance,
} from "./systemAppearance";

const STORAGE_KEY = "pg-settings-v2";

// ═════════════════════════════════════════════════════════════════════════════
// THEME MODEL
// ═════════════════════════════════════════════════════════════════════════════

// Brand logo colors (src-tauri/icons/logo.svg). Used as the default for every
// theme's logo slots and as the fallback for themes saved before the slots
// existed.
export const LOGO_PRIMARY = "#3e9b91"; // teal head
export const LOGO_SECONDARY = "#e6a95a"; // orange bill

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
  logo: string;
  logo2: string;
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
  group: "background" | "foreground" | "border" | "accent" | "logo";
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
  { key: "logo", label: "Logo · head", group: "logo", hint: "PlatypusGit mark, head fill — Welcome + titlebar." },
  { key: "logo2", label: "Logo · bill", group: "logo", hint: "PlatypusGit mark, bill fill." },
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
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
      logo: "#3e9b91",
      logo2: "#e6a95a",
    },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// APPLY + PERSIST
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Semantic tokens that are NOT part of the editable theme palette but still
 * have to change with the theme's mode (#61 B4).
 *
 * These carry meaning of their own — diff green must stay green, graph lanes
 * must stay mutually distinguishable — so they are deliberately not derived
 * from the accent. What they cannot be is fixed: the dark set is calibrated
 * for text on a dark canvas, and reusing it on a light theme leaves diff
 * add/remove, graph lanes, branch pills and shadows washed out and low
 * contrast. Two calibrations, picked by `theme.mode`.
 *
 * The dark column is byte-identical to the `:root` defaults in index.css, so
 * every dark theme renders exactly as before.
 */
const SEMANTIC_TOKENS: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--git-added": "oklch(0.72 0.15 155)",
    "--git-added-bg": "oklch(0.35 0.08 155 / 0.25)",
    "--git-added-gutter": "oklch(0.45 0.12 155 / 0.5)",
    "--git-removed": "oklch(0.68 0.18 25)",
    "--git-removed-bg": "oklch(0.35 0.10 25 / 0.25)",
    "--git-removed-gutter": "oklch(0.45 0.14 25 / 0.5)",
    "--git-added-word": "oklch(0.55 0.13 155 / 0.55)",
    "--git-removed-word": "oklch(0.52 0.16 25 / 0.55)",
    "--git-modified": "oklch(0.75 0.14 75)",
    "--git-modified-bg": "oklch(0.35 0.08 75 / 0.2)",
    "--git-renamed": "oklch(0.72 0.15 235)",
    "--git-conflict": "oklch(0.72 0.15 325)",
    "--git-untracked": "oklch(0.72 0.12 295)",
    "--git-staged": "oklch(0.72 0.15 155)",
    "--git-ignored": "oklch(0.55 0.005 260)",
    "--graph-1": "oklch(0.72 0.15 235)",
    "--graph-2": "oklch(0.72 0.15 295)",
    "--graph-3": "oklch(0.72 0.15 155)",
    "--graph-4": "oklch(0.72 0.15 65)",
    "--graph-5": "oklch(0.72 0.15 25)",
    "--graph-6": "oklch(0.72 0.15 355)",
    "--graph-7": "oklch(0.72 0.15 195)",
    "--accent-2": "oklch(0.72 0.15 295)",
    "--accent-3": "oklch(0.72 0.15 155)",
    "--accent-4": "oklch(0.72 0.15 65)",
    "--accent-5": "oklch(0.72 0.15 25)",
    "--shadow-1": "0 1px 2px rgba(0,0,0,0.4)",
    "--shadow-2": "0 4px 12px rgba(0,0,0,0.35)",
    "--shadow-3": "0 12px 40px rgba(0,0,0,0.5)",
    "--shadow-inset": "inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  light: {
    // Foreground hues drop to ~0.55 L so they carry contrast against a near-
    // white canvas; the *-bg fills invert — light tints instead of dark
    // washes — and gutters sit between the two.
    "--git-added": "oklch(0.55 0.16 155)",
    "--git-added-bg": "oklch(0.90 0.08 155 / 0.55)",
    "--git-added-gutter": "oklch(0.76 0.14 155 / 0.65)",
    "--git-removed": "oklch(0.54 0.20 25)",
    "--git-removed-bg": "oklch(0.91 0.07 25 / 0.55)",
    "--git-removed-gutter": "oklch(0.75 0.16 25 / 0.65)",
    // The word fill has to go DARKER than the pale *-bg it sits on, where dark
    // mode goes lighter — inheriting the dark value would wash out to invisible.
    "--git-added-word": "oklch(0.78 0.16 155 / 0.85)",
    "--git-removed-word": "oklch(0.78 0.17 25 / 0.85)",
    "--git-modified": "oklch(0.58 0.14 75)",
    "--git-modified-bg": "oklch(0.91 0.08 75 / 0.5)",
    "--git-renamed": "oklch(0.53 0.16 235)",
    "--git-conflict": "oklch(0.53 0.19 325)",
    "--git-untracked": "oklch(0.51 0.17 295)",
    "--git-staged": "oklch(0.55 0.16 155)",
    "--git-ignored": "oklch(0.66 0.005 260)",
    "--graph-1": "oklch(0.56 0.16 235)",
    "--graph-2": "oklch(0.54 0.17 295)",
    "--graph-3": "oklch(0.55 0.15 155)",
    "--graph-4": "oklch(0.60 0.14 65)",
    "--graph-5": "oklch(0.56 0.18 25)",
    "--graph-6": "oklch(0.55 0.18 355)",
    "--graph-7": "oklch(0.55 0.13 195)",
    "--accent-2": "oklch(0.54 0.17 295)",
    "--accent-3": "oklch(0.55 0.15 155)",
    "--accent-4": "oklch(0.60 0.14 65)",
    "--accent-5": "oklch(0.56 0.18 25)",
    // Dark themes cast shadows with pure black; on a light canvas that reads
    // as grime. Tint them with the same cool ink the text uses, and lighten.
    "--shadow-1": "0 1px 2px rgba(20,26,38,0.10)",
    "--shadow-2": "0 4px 12px rgba(20,26,38,0.12)",
    "--shadow-3": "0 12px 40px rgba(20,26,38,0.18)",
    "--shadow-inset": "inset 0 1px 0 rgba(255,255,255,0.65)",
  },
};

/**
 * Selection tints and the focus ring genuinely ARE accent-tinted, so they are
 * derived from `--accent` with relative-color syntax rather than tabulated —
 * that way a custom accent carries through instead of leaving blue selection
 * on an amber theme. Light mode substitutes a high lightness so the tint sits
 * *behind* dark text instead of drowning it.
 */
const SELECTION_TOKENS: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--bg-selection": "oklch(from var(--accent) 0.35 calc(c * 0.35) h / 0.4)",
    "--bg-selection-dim": "oklch(from var(--accent) 0.35 calc(c * 0.15) h / 0.22)",
    "--bg-selection-focused": "oklch(from var(--accent) 0.45 calc(c * 0.6) h / 0.35)",
  },
  light: {
    "--bg-selection": "oklch(from var(--accent) 0.88 calc(c * 0.5) h / 0.55)",
    "--bg-selection-dim": "oklch(from var(--accent) 0.93 calc(c * 0.3) h / 0.6)",
    "--bg-selection-focused": "oklch(from var(--accent) 0.84 calc(c * 0.8) h / 0.6)",
  },
};

/**
 * Syntax palette, per theme MODE. Same reasoning as SEMANTIC_TOKENS: light is
 * calibrated on its own rather than inherited, because dark-calibrated syntax
 * colours over a light canvas wash out (#61 B4).
 *
 * The dark column is byte-identical to the `:root` defaults in index.css. Edit
 * both or they drift.
 */
const SYNTAX_TOKENS: Record<"dark" | "light", Record<string, string>> = {
  dark: {
    "--syn-keyword": "oklch(0.72 0.16 20)",
    "--syn-string": "oklch(0.82 0.09 220)",
    "--syn-number": "oklch(0.78 0.12 250)",
    "--syn-comment": "oklch(0.62 0.02 260)",
    "--syn-func": "oklch(0.78 0.14 300)",
    "--syn-type": "oklch(0.80 0.13 155)",
    "--syn-var": "oklch(0.78 0.13 60)",
    "--syn-punct": "oklch(0.80 0.01 260)",
    "--syn-tag": "oklch(0.78 0.13 155)",
    "--syn-attr": "oklch(0.78 0.12 250)",
    "--syn-regexp": "oklch(0.78 0.12 185)",
    "--syn-meta": "oklch(0.75 0.12 300)",
  },
  light: {
    "--syn-keyword": "oklch(0.52 0.20 20)",
    "--syn-string": "oklch(0.42 0.14 250)",
    "--syn-number": "oklch(0.48 0.16 255)",
    "--syn-comment": "oklch(0.55 0.02 260)",
    "--syn-func": "oklch(0.50 0.20 300)",
    "--syn-type": "oklch(0.45 0.14 150)",
    "--syn-var": "oklch(0.50 0.14 55)",
    "--syn-punct": "oklch(0.35 0.01 260)",
    "--syn-tag": "oklch(0.45 0.14 150)",
    "--syn-attr": "oklch(0.48 0.16 255)",
    "--syn-regexp": "oklch(0.45 0.13 185)",
    "--syn-meta": "oklch(0.50 0.18 300)",
  },
};

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
  // logo colors fall back to the brand palette for themes persisted before the
  // logo slots existed.
  root.style.setProperty("--logo", c.logo ?? LOGO_PRIMARY);
  root.style.setProperty("--logo-2", c.logo2 ?? LOGO_SECONDARY);
  root.style.setProperty("--ring", `0 0 0 2px ${c.accent}80`);
  // Mode-calibrated semantics + accent-derived selection tints. Written on
  // every apply (not only on a mode change) so switching dark → light → dark
  // can't leave a stale calibration behind.
  const mode = theme.mode === "light" ? "light" : "dark";
  for (const [token, value] of Object.entries(SEMANTIC_TOKENS[mode])) {
    root.style.setProperty(token, value);
  }
  for (const [token, value] of Object.entries(SELECTION_TOKENS[mode])) {
    root.style.setProperty(token, value);
  }
  for (const [token, value] of Object.entries(SYNTAX_TOKENS[mode])) {
    root.style.setProperty(token, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
}

// ═════════════════════════════════════════════════════════════════════════════
// THEME PREFERENCE — following the system appearance (#236)
// ═════════════════════════════════════════════════════════════════════════════

export type ThemeFollowMode = "system" | "fixed";

export const THEME_FOLLOW_MODES: readonly ThemeFollowMode[] = ["fixed", "system"];

/**
 * Which theme to apply, and on whose say-so.
 *
 * A PAIR plus a mode, rather than a third magic value in `activeThemeId`. A
 * theme is intrinsically one mode (`ThemeDef.mode`), so "follow the system"
 * cannot be a theme — it is a rule for choosing between two of them, and the
 * person gets to say WHICH light and WHICH dark, not just "the light one".
 *
 * `activeThemeId` stays the single answer to "what is on screen":
 *
 *   fixed  — `activeThemeId` is the user's choice and nothing moves it.
 *   system — `activeThemeId` is DERIVED from this pair and the observed OS
 *            appearance, and is rewritten every time the OS switches.
 *
 * Keeping it derived rather than adding a second "resolved id" field is what
 * makes the feature invisible downstream: `getActiveTheme`, the theme editor
 * and `DiffMinimap`'s repaint subscription all keep working unchanged, and the
 * minimap repaints on an OS switch for free.
 */
export interface ThemePreference {
  mode: ThemeFollowMode;
  /** Theme id used while the OS is light. Must name a `mode: "light"` theme. */
  lightId: string;
  /** Theme id used while the OS is dark. Must name a `mode: "dark"` theme. */
  darkId: string;
}

/**
 * The built-in pairing, so "Follow system" works the instant it is chosen with
 * nothing else configured.
 *
 * The default MODE is `fixed`, not `system`: every install before #236 was
 * effectively fixed, and a fresh install that suddenly renders light on a light
 * Mac is a different product decision from the one this feature asked for.
 * Following the system is one click away and needs no further setup.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = {
  mode: "fixed",
  lightId: "light",
  darkId: "dark-cool",
};

/**
 * The id one half of the pairing names, validated.
 *
 * Validated on every read rather than only at load, because the pairing can be
 * broken from behind: the theme editor lets a custom theme be flipped from dark
 * to light (and writes `customThemes` directly), which would otherwise leave
 * `darkId` naming a light theme and the app resolving to the same half twice —
 * i.e. not switching at all, the exact bug this feature exists to fix.
 */
function pairedThemeId(
  pref: ThemePreference,
  appearance: Appearance,
  customThemes: ThemeDef[],
): string {
  const wanted = appearance === "light" ? pref.lightId : pref.darkId;
  const found = findTheme({ customThemes }, wanted);
  if (found && found.mode === appearance) return wanted;
  return appearance === "light"
    ? DEFAULT_THEME_PREFERENCE.lightId
    : DEFAULT_THEME_PREFERENCE.darkId;
}

/** What `activeThemeId` should be, for a given state and OS appearance. */
function resolveActiveThemeId(
  s: Pick<PersistedState, "themePreference" | "customThemes" | "activeThemeId">,
  appearance: Appearance,
): string {
  return s.themePreference.mode === "system"
    ? pairedThemeId(s.themePreference, appearance, s.customThemes)
    : s.activeThemeId;
}

/**
 * The `{ activeThemeId, themePreference }` patch that makes `theme` the user's
 * choice.
 *
 * In system mode "which theme is active" is not a free choice, so every path
 * that used to just assign `activeThemeId` (pick, fork, duplicate, import)
 * routes through here instead: the id goes into the half matching the theme's
 * OWN mode, and what ends up on screen is still whatever the OS asked for.
 * Without this, a fork made while following the system is thrown away by the
 * next re-resolve.
 *
 * `customThemes` is a parameter because three callers create the theme in the
 * same breath — it is not in the store's list yet.
 */
function activationPatch(
  s: Pick<PersistedState, "themePreference">,
  theme: ThemeDef,
  appearance: Appearance,
  customThemes: ThemeDef[],
): Pick<PersistedState, "activeThemeId" | "themePreference"> {
  if (s.themePreference.mode !== "system") {
    return { activeThemeId: theme.id, themePreference: s.themePreference };
  }
  const themePreference: ThemePreference = {
    ...s.themePreference,
    ...(theme.mode === "light" ? { lightId: theme.id } : { darkId: theme.id }),
  };
  return {
    themePreference,
    activeThemeId: pairedThemeId(themePreference, appearance, customThemes),
  };
}

/**
 * Extra vertical pixels each row-ish surface adds for a given density.
 *
 * THE source of truth for the number. `index.css` declares `--row-step: 0px`
 * as a pre-hydration default and derives every row token from it
 * (`--row-h: calc(24px + var(--row-step))`, …); `applyDensity` overwrites the
 * var from this table, so CSS never hardcodes the comfortable delta and cannot
 * drift from the JS one. Compact is 0 by definition — comfortable is opt-in,
 * and the default layout stays pixel-identical to the pre-density one.
 */
export const DENSITY_STEP_PX = { compact: 0, comfortable: 4 } as const;

export type UiDensity = keyof typeof DENSITY_STEP_PX;

/**
 * Coerce a persisted density into a known one.
 *
 * `load()` copies any JSON value for a known key without validating it, so
 * state can hold a density this build has never heard of — a hand-edited
 * `pg-settings-v2`, or a value written by a newer build the user downgraded
 * from. That must degrade to compact: an unknown key would otherwise emit
 * `--row-step: undefinedpx`, and one invalid substitution makes every
 * `calc(Npx + var(--row-step))` compute to `auto`, collapsing the height of
 * every row in the app at once.
 */
function normalizeDensity(density: UiDensity): UiDensity {
  return density in DENSITY_STEP_PX ? density : "compact";
}

/**
 * Apply UI density by writing the row-step slot to CSS vars on :root.
 *
 * `data-density` is also set — a reserved hook for any future density rule
 * that isn't a simple pixel delta. Nothing reads it today (it's asserted only
 * in useSettingsStore.test.ts); drop it if that stays true.
 */
export function applyDensity(density: UiDensity) {
  const root = document.documentElement;
  const d = normalizeDensity(density);
  root.style.setProperty("--row-step", `${DENSITY_STEP_PX[d]}px`);
  root.dataset.density = d;
}

// ─── HEAD ("you are here") indicator ─────────────────────────────────────────
//
// The catalog, the weight table and the resolver live in `./headMarks` — pure
// and separately tested. Re-exported here because every existing consumer
// already imports its HEAD types from this module.
export * from "./headMarks";

// ─── UI zoom (Mod+= / Mod+- / Mod+0, like an editor) ─────────────────────────

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 0.1;

/** Snap to the step grid and clamp — also the guard for a hand-edited value. */
export function normalizeZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  const snapped = Math.round(zoom / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(snapped * 100) / 100));
}

/**
 * Scale the whole UI through the WEBVIEW's own zoom, not a CSS transform: text
 * stays hinted at the new size and every fixed/absolute layout keeps working,
 * which a `scale()` on a wrapper would break (dialogs, popovers, the titlebar).
 *
 * Fire-and-forget and failure-tolerant on purpose — it runs on module load, and
 * in a plain browser (component tests) there is no webview to zoom.
 */
export function applyZoom(zoom: number): void {
  const z = normalizeZoom(zoom);
  document.documentElement.dataset.zoom = String(z);
  void (async () => {
    try {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      await getCurrentWebview().setZoom(z);
    } catch {
      // No webview bridge (tests / browser) — the dataset hook is all there is.
    }
  })();
}

// ─── Update checks (#237) ────────────────────────────────────────────────────

/**
 * When the app is allowed to ask GitHub whether a newer release exists.
 *
 * Three modes rather than a toggle, because "manual" and "never" are different
 * promises and conflating them breaks one of them:
 *
 * - `auto`   — the startup check runs (today's behaviour, and the default:
 *              shipping security fixes matters more than the request).
 * - `manual` — no automatic request, ever; Settings → "Check for updates" still
 *              works. For people who want to control the TIMING.
 * - `never`  — no request from any path. The Settings button renders disabled,
 *              so an accidental click cannot produce outbound traffic either.
 *              For locked-down, offline or blocked-endpoint machines, and for
 *              users who chose this app partly for "no telemetry, no account"
 *              and want that to include the update endpoint.
 *
 * Orthogonal to the per-version snooze (`useUpdateStore.dismissedVersion`),
 * which is about one release rather than about checking at all.
 */
export type UpdateCheckMode = "auto" | "manual" | "never";

export const UPDATE_CHECK_MODES: readonly UpdateCheckMode[] = [
  "auto",
  "manual",
  "never",
];

// ═════════════════════════════════════════════════════════════════════════════
// STORE
// ═════════════════════════════════════════════════════════════════════════════

// `signCommits` is back, and this time it signs. It was removed once because a
// toggle that only pretended to sign erodes trust; the condition for re-adding
// it was real key plumbing, which #61 D6 provides — commit_create_buffer →
// gpg/ssh-keygen → commit_signed, with a signing failure failing the commit
// rather than quietly producing an unsigned one. Default is "config", so the app
// does not override a repository that already decided via commit.gpgsign.
//
// `ignoreWhitespaceInDiff` is the successor to the removed showWhitespaceInDiff.
// The hunk-index desync that killed the first attempt is real (see the
// whitespace_diff.rs backend test), and is handled rather than ignored: the
// flag reaches the diff READ paths only, and every surface disables its
// hunk-level stage/discard while it is on.
interface PersistedState {
  /**
   * The theme on screen. In `themePreference.mode === "system"` this is
   * DERIVED — recomputed from the pairing every time the OS appearance
   * changes — and it is still persisted, as the cache that lets the next
   * launch paint before the async window-theme query answers.
   */
  activeThemeId: string;
  /** Which theme to apply and on whose say-so (#236). See ThemePreference. */
  themePreference: ThemePreference;
  customThemes: ThemeDef[];
  uiDensity: "compact" | "comfortable";
  /** Webview zoom factor — 1 is 100%. See applyZoom. */
  uiZoom: number;
  /**
   * Which marks the History row you are currently on (HEAD) carries, and how
   * hard they hit. Two orthogonal settings rather than one enum of every
   * combination — see ./headMarks.
   */
  headMarks: HeadMark[];
  headWeight: HeadWeight;
  defaultPullMode: PullMode;
  autoFetchEnabled: boolean;
  autoFetchMinutes: number;
  pruneOnFetch: boolean;
  confirmForcePush: boolean;
  autoStashBeforePull: boolean;
  addSignoff: boolean;
  /**
   * Whether new commits are signed (#61 D6). "config" follows commit.gpgsign
   * from git config, which is the default so the app does not override a
   * repository that has already made this decision.
   */
  signCommits: "config" | "always" | "never";
  /**
   * Regex the commit composer runs over the BRANCH NAME to find a ticket key
   * to offer (#252). Its own setting rather than a hard-coded shape because
   * ticket conventions are per-team and there is no majority: Jira keys,
   * `issue-NNN`, bare `#NNN`. Capture group 1 wins when the pattern has one.
   *
   * A pattern that does not compile is replaced with the default on load —
   * `extractTicket` also refuses to throw, so a half-typed one in Settings only
   * means "no chip", never a broken commit screen.
   */
  commitTicketPattern: string;
  diffContextLines: number;
  /**
   * Inline (unified) or side-by-side. Persisted so it is a preference rather
   * than a per-visit choice — it used to live in the Diff screen's local state
   * and reset on every navigation.
   */
  diffViewMode: "inline" | "split";
  /**
   * Whether the diff shows the whole file or only the changed chunks.
   *
   * `diffContextLines` still governs the FETCH in both modes: it is what hunk
   * indices and `changedIndex` are computed against, so staging depends on it
   * either way. This setting only selects whether the unchanged remainder of the
   * file is filled in around those hunks for display.
   */
  diffContextMode: "wholeFile" | "chunks";
  ignoreWhitespaceInDiff: boolean;
  /**
   * Whether the app checks for a newer release, and on whose initiative — see
   * UpdateCheckMode. The gate itself lives in `useUpdateStore.check()`, not at
   * the call sites, so no path can spend a request the user disabled.
   *
   * The last-checked TIMESTAMP deliberately does not live here: `PersistedState`
   * is the portable-preferences bag (#254 exports it to a shareable file), and a
   * per-machine "when did this install last look" is not a preference anyone
   * would want to import. It lives beside `dismissedVersion` in the update
   * store's own localStorage key.
   */
  updateCheckMode: UpdateCheckMode;
  /** Parent directory last used for Clone/Init, prefilled next time. */
  lastCreateDir: string;
}

export interface SettingsState extends PersistedState {
  /**
   * The OS appearance this window last observed.
   *
   * NOT in `PersistedState`, and that is the whole point: it is observed state
   * about this machine right now, so it is neither written to localStorage nor
   * carried by a settings export. `snapshot()` and `PORTABLE_KEYS` both derive
   * from `DEFAULTS`, so staying out of the schema keeps it out of both by
   * construction. Same call #283 made for `useUpdateStore.lastCheckedAt`.
   *
   * It lives on the store rather than only in the `systemAppearance` module so
   * the Settings screen re-renders when it flips.
   */
  systemAppearance: Appearance;
  getActiveTheme: () => ThemeDef;
  setActiveThemeId: (id: string) => void;
  /** Switch between following the OS and one fixed theme. */
  setThemeFollowMode: (mode: ThemeFollowMode) => void;
  /**
   * Choose the theme for one half of the pairing. A theme whose own mode is
   * not `appearance` is refused — the pairing would resolve to the same half
   * twice and stop switching.
   */
  setPairedThemeId: (appearance: Appearance, id: string) => void;
  /**
   * Record a new OS appearance and re-resolve. Called by the watcher started
   * in `main.tsx`; exported so a test can flip the OS without one.
   */
  syncSystemAppearance: (appearance: Appearance) => void;
  updateActiveColors: (patch: Partial<ThemeColors>) => void;
  saveAsNewTheme: (name: string) => ThemeDef;
  renameTheme: (id: string, name: string) => void;
  deleteTheme: (id: string) => void;
  duplicateTheme: (id: string, newName?: string) => ThemeDef;
  exportTheme: (id: string) => string;
  downloadTheme: (id: string) => void;
  importThemeJson: (json: string) => ThemeDef;
  /**
   * Serialise every portable setting to one versioned JSON string (#254).
   * Custom themes travel in it, in the same per-theme shape `exportTheme`
   * writes; machine-specific keys (`NON_PORTABLE_KEYS`) do not.
   */
  exportSettings: (opts?: SettingsExportOptions) => string;
  /**
   * `exportSettings` plus the download. Returns the filename, because "your
   * settings were exported" is useless without saying to what.
   */
  downloadSettings: (opts?: SettingsExportOptions) => string;
  /**
   * Apply a settings file and report what it changed — an import that replaces
   * every preference silently is indistinguishable from one that did nothing.
   * Throws an `Error` with a user-facing message when the file cannot be read.
   */
  importSettings: (json: string) => SettingsImportReport;
  set: <K extends keyof PersistedState>(key: K, value: PersistedState[K]) => void;
  /** Nudge the zoom by whole steps; clamped at both ends. */
  stepZoom: (steps: number) => void;
  reset: () => void;
}

const DEFAULTS: PersistedState = {
  activeThemeId: "dark-cool",
  themePreference: { ...DEFAULT_THEME_PREFERENCE },
  customThemes: [],
  uiDensity: "compact",
  uiZoom: 1,
  headMarks: ["bar", "tint", "ring"],
  headWeight: DEFAULT_HEAD_WEIGHT,
  defaultPullMode: "Rebase",
  autoFetchEnabled: false,
  autoFetchMinutes: 5,
  pruneOnFetch: true,
  confirmForcePush: true,
  autoStashBeforePull: true,
  addSignoff: false,
  signCommits: "config",
  commitTicketPattern: DEFAULT_TICKET_PATTERN,
  diffContextLines: 3,
  diffViewMode: "inline",
  diffContextMode: "wholeFile",
  ignoreWhitespaceInDiff: false,
  updateCheckMode: "auto",
  lastCreateDir: "",
};

// ═════════════════════════════════════════════════════════════════════════════
// PORTABLE SETTINGS — export / import the whole bag (#254)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Schema version of an exported settings FILE.
 *
 * A different notion from `STORAGE_KEY`'s "-v2": that versions the localStorage
 * slot THIS install reads, and bumping it is a local migration. This versions
 * the interchange format, and bumping it changes what other builds can read.
 * Conflating them would let a localStorage migration silently invalidate every
 * export anyone had already saved.
 */
export const SETTINGS_EXPORT_VERSION = 1;

/** Marks a file as ours — a `.pgtheme.json` or a stray JSON is refused. */
export const SETTINGS_EXPORT_KIND = "platypusgit-settings";

// An identifier, not a fetch: nothing in the app dereferences it. Same
// reasoning as the theme export's, and the same allow-list entry in
// test/privacy.test.ts.
const SETTINGS_SCHEMA_URL = "https://platypusgit.dev/settings.schema.json";

/**
 * Settings that describe THIS MACHINE and must not travel.
 *
 * A deny-list rather than an allow-list, and the asymmetry is the point: the
 * export walks `DEFAULTS` and skips these, so a preference added tomorrow is
 * exported by default instead of waiting for someone to remember a second
 * list. #283 added `updateCheckMode` days before this export existed — a
 * hand-written allow-list would have missed it and quietly dropped a real
 * preference from every file people had already saved.
 *
 * Nothing secret needs denying, because nothing secret is in `PersistedState`:
 * forge tokens and git credentials live in their own `Secret`-typed storage and
 * no command returns them. `useSettingsStore.export.test.ts` asserts that
 * against the serialised payload rather than leaving it to memory.
 */
export const NON_PORTABLE_KEYS: readonly (keyof PersistedState)[] = [
  "lastCreateDir",
];

/** `DEFAULTS`' keys minus the deny-list — exactly what an export carries. */
export const PORTABLE_KEYS: readonly (keyof PersistedState)[] = (
  Object.keys(DEFAULTS) as (keyof PersistedState)[]
).filter((k) => !NON_PORTABLE_KEYS.includes(k));

export interface SettingsExportOptions {
  /**
   * The active keymap preset id, when the caller wants it in the file. The
   * keymap is the setting people are most attached to, but it is persisted by
   * `useKeymapStore` under its own localStorage key — and `keymap/actions.ts`
   * imports THIS module, so reading it from here would be an import cycle.
   * `screens/Settings.tsx` already owns both stores and bridges them.
   */
  keymapPresetId?: string | null;
}

export interface SettingsImportReport {
  /** Settings whose value the file actually changed. */
  changed: (keyof PersistedState)[];
  /**
   * Keys in the file this build has no setting for — removed since, or added by
   * a newer build. Reported rather than swallowed so "why did my X not come
   * across" has an answer on screen.
   */
  ignored: string[];
  /** The preset the file asks for, for the caller to hand to the keymap store. */
  keymapPresetId: string | null;
  /** The file's declared schema version, or null when it declared none. */
  version: number | null;
  /** True when the file was written by a build newer than this one. */
  fromNewerVersion: boolean;
}

// The three values the backend's PullMode accepts. A fourth string would reach
// git as a mode nobody implements.
const PULL_MODES: readonly PullMode[] = ["Rebase", "Merge", "FastForward"];

const NOT_AN_EXPORT = "That file isn't a platypusgit settings export.";

/**
 * Read the envelope of a settings file, or throw a message a user can act on.
 *
 * Deliberately strict about the WRAPPER and lenient about the contents: the
 * wrapper is how we know this file was meant for us at all, while every setting
 * inside is validated one at a time by `coerceSettings`.
 */
function parseSettingsExport(json: string): {
  settings: Record<string, unknown>;
  keymapPresetId: string | null;
  version: number | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    // The failure people hit by accident (wrong file, truncated download), so
    // it names which half went wrong instead of surfacing a parser message.
    throw new Error("That file isn't valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(NOT_AN_EXPORT);
  }
  const o = parsed as Record<string, unknown>;
  if (o.kind !== undefined && o.kind !== SETTINGS_EXPORT_KIND) {
    throw new Error(NOT_AN_EXPORT);
  }
  const settings = o.settings;
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    // A single-theme file is the near miss worth naming: it is the other file
    // this app writes, and it has its own button three rows up.
    if (o.colors && typeof o.colors === "object") {
      throw new Error(
        "That looks like a single theme file — import it under Appearance.",
      );
    }
    throw new Error(NOT_AN_EXPORT);
  }
  const keymap = o.keymap as Record<string, unknown> | undefined;
  const presetId =
    keymap && typeof keymap === "object" && typeof keymap.presetId === "string"
      ? keymap.presetId.trim()
      : "";
  return {
    settings: settings as Record<string, unknown>,
    keymapPresetId: presetId || null,
    version:
      typeof o.version === "number" && Number.isFinite(o.version) ? o.version : null,
  };
}

/** Structural equality, enough for the two array-valued settings. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a !== null && typeof a === "object") || (b !== null && typeof b === "object")) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Coerce a persisted or imported theme list into usable `ThemeDef`s.
 *
 * Lenient in the direction `validateTheme` already chose for the logo slots: a
 * missing colour is filled from the default theme rather than costing the user
 * the whole theme, and one unusable entry costs only itself. Every colour goes
 * through `sanitizeHex`, so neither a hand-edited localStorage payload nor a
 * shared file can put an arbitrary string into a CSS var. `builtin` is never
 * carried over — a custom theme that claims to be built in renders read-only in
 * the editor and cannot be deleted.
 */
function normalizeCustomThemes(value: unknown, fallback: ThemeDef[]): ThemeDef[] {
  if (!Array.isArray(value)) return fallback;
  const out: ThemeDef[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    if (!o.colors || typeof o.colors !== "object") continue;
    const src = o.colors as Record<string, unknown>;
    const colors = {} as ThemeColors;
    for (const f of THEME_COLOR_FIELDS) {
      const v = src[f.key];
      colors[f.key] =
        typeof v === "string" ? sanitizeHex(v) : BUILTIN_THEMES[0].colors[f.key];
    }
    // The id has to survive, or `activeThemeId` dangles and the app silently
    // falls back to the default theme.
    const wanted =
      typeof o.id === "string" && o.id.trim() ? o.id.trim() : uniqueId(out);
    const id = seen.has(wanted) ? `${wanted}-${out.length}` : wanted;
    seen.add(id);
    out.push({
      id,
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Imported theme",
      mode: o.mode === "light" ? "light" : "dark",
      colors,
    });
  }
  return out;
}

/**
 * Coerce a persisted or imported value into a usable `ThemePreference`.
 *
 * Its own normalizer for the same reason `customThemes` and `headMarks` have
 * one: the scalar type-guard in `coerceSettings` compares against
 * `typeof DEFAULTS[key]`, and every object-valued setting is `"object"` — so a
 * hand-edited `{ mode: "auto" }`, a `lightId` of `7`, or a bare string would
 * all sail through it.
 *
 * An unknown mode reads as `fixed`, never `system`: fixed falls back on
 * `activeThemeId`, which always resolves (`getActiveTheme` ends at
 * `BUILTIN_THEMES[0]`), so the worst case is the theme the person already had
 * rather than an app with no theme at all.
 */
function normalizeThemePreference(value: unknown): ThemePreference {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_THEME_PREFERENCE };
  }
  const o = value as Record<string, unknown>;
  const id = (raw: unknown, fallback: string) =>
    typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
  return {
    mode: o.mode === "system" ? "system" : "fixed",
    lightId: id(o.lightId, DEFAULT_THEME_PREFERENCE.lightId),
    darkId: id(o.darkId, DEFAULT_THEME_PREFERENCE.darkId),
  };
}

/**
 * Point the half matching `activeThemeId`'s own mode at it.
 *
 * The migration for every install that predates #236: they hold an
 * `activeThemeId` and no `themePreference`, and they land on `fixed` — so
 * nothing changes appearance on upgrade. But the day they DO switch to
 * "Follow system", handing them the built-in pairing would take away the theme
 * they had been using for years. Seeding costs one lookup and keeps it.
 */
function seedPairingFrom(
  pref: ThemePreference,
  activeThemeId: string,
  customThemes: ThemeDef[],
): ThemePreference {
  const active = findTheme({ customThemes }, activeThemeId);
  if (!active) return pref;
  return active.mode === "light"
    ? { ...pref, lightId: active.id }
    : { ...pref, darkId: active.id };
}

interface CoercedSettings {
  state: PersistedState;
  /** Keys whose value ended up different from `base`. */
  changed: (keyof PersistedState)[];
  /** Keys in the payload this build has no setting for. */
  ignored: string[];
}

/**
 * Fold an arbitrary object into a complete, valid `PersistedState`.
 *
 * ONE validator for both untrusted sources — the localStorage payload `load()`
 * reads on startup, and the file `importSettings` reads. They face the same
 * problems (a hand-edited value, a setting this build removed, a value from a
 * newer build), and a second copy of these guards would be a second copy to
 * forget to update.
 *
 * The rules, in order:
 *   absent from `parsed`  → keep `base`'s value. For `load()` that is DEFAULTS;
 *                           for an import it means an older file cannot silently
 *                           reset a preference it predates (an export without
 *                           `updateCheckMode` must not switch update checks back
 *                           on for someone who turned them off).
 *   present and valid     → apply it.
 *   present and unusable  → the DEFAULT, not `base`: the payload asked for a
 *                           change, and the documented safe value is the honest
 *                           answer to garbage.
 */
function coerceSettings(
  parsed: Record<string, unknown>,
  base: PersistedState,
): CoercedSettings {
  const known = new Set<string>(Object.keys(DEFAULTS));
  const ignored = Object.keys(parsed).filter(
    // `headIndicator` left the schema but the migration below still reads it,
    // so it is honoured rather than ignored.
    (k) => !known.has(k) && k !== "headIndicator",
  );

  // Only pick keys that still exist in the schema, so settings removed in
  // newer versions (e.g. showWhitespaceInDiff) don't leak stale properties
  // into the store state.
  const out: PersistedState = { ...base };
  for (const key of Object.keys(DEFAULTS) as (keyof PersistedState)[]) {
    if (key in parsed) {
      (out as unknown as Record<string, unknown>)[key] = parsed[key];
    }
  }

  // Type-guard every scalar against the type of its default. A payload can hold
  // a string where a toggle expects a boolean, and `checked={"no"}` is a toggle
  // stuck ON — the user sees the opposite of what the file said. Deriving the
  // expected type from DEFAULTS means a new scalar preference is guarded the day
  // it is added, for the same reason the export derives its key set. The two
  // object-valued settings (customThemes, headMarks) have their own normalizers
  // below.
  for (const key of Object.keys(DEFAULTS) as (keyof PersistedState)[]) {
    const want = typeof DEFAULTS[key];
    if (want !== "object" && typeof out[key] !== want) {
      (out as unknown as Record<string, unknown>)[key] = DEFAULTS[key];
    }
  }

  // `signCommits` was once a boolean no-op setting and is now a tri-state
  // (#61 D6), so an old payload can carry `true`/`false` where a mode is
  // expected. Anything that is not one of the three modes falls back to
  // "config", which defers to the repository rather than forcing signing on.
  if (!["config", "always", "never"].includes(out.signCommits as string)) {
    out.signCommits = DEFAULTS.signCommits;
  }
  // A pattern that does not compile would make the ticket chip permanently
  // absent with nothing on screen saying why. `extractTicket` refuses to throw
  // either way, so this is about the user getting their feature back, not about
  // safety.
  if (!isValidTicketPattern(String(out.commitTicketPattern))) {
    out.commitTicketPattern = DEFAULTS.commitTicketPattern;
  }
  // A hand-edited or newer-build zoom must not survive as-is: an out-of-range
  // factor is rejected by the webview and would leave the UI unzoomable.
  out.uiZoom = normalizeZoom(Number(out.uiZoom));
  // An unrecognized density would emit `--row-step: undefinedpx`, and an
  // invalid substitution makes every `calc(Npx + var(--row-step))` compute to
  // `auto` — collapsing the height of every row in the app at once.
  out.uiDensity = normalizeDensity(out.uiDensity);
  // HEAD marks: prefer a stored list, else carry over the pre-#118 single
  // `headIndicator` enum, else — if the payload spoke about marks at all but
  // said something unusable — the default, and otherwise whatever `base` had.
  // Migration reads `parsed`, not `out`: the old key is gone from the schema, so
  // the copy loop above never picked it up. Landing an upgraded install on
  // "strong" is deliberate: the same choice as before, at roughly twice the
  // visibility.
  const storedMarks =
    normalizeHeadMarks(parsed.headMarks) ?? migrateHeadIndicator(parsed.headIndicator);
  const mentionsMarks = "headMarks" in parsed || "headIndicator" in parsed;
  out.headMarks = storedMarks ?? (mentionsMarks ? DEFAULTS.headMarks : base.headMarks);
  // Same reasoning as the zoom clamp: an unknown weight would resolve every
  // mark to NaN and silently draw nothing.
  if (!HEAD_WEIGHTS.includes(out.headWeight as HeadWeight)) {
    out.headWeight = DEFAULTS.headWeight;
  }
  // Same reasoning again for the two diff modes: the renderers branch on these
  // exact strings, so an unknown value means "neither branch" — a blank pane.
  if (!["inline", "split"].includes(out.diffViewMode as string)) {
    out.diffViewMode = DEFAULTS.diffViewMode;
  }
  if (!["wholeFile", "chunks"].includes(out.diffContextMode as string)) {
    out.diffContextMode = DEFAULTS.diffContextMode;
  }
  // Same reasoning for the update-check mode, with a sharper failure: the gate
  // in useUpdateStore only lets `auto` through automatically, so an unknown
  // string (hand-edited file, a mode a newer build added) would silently mean
  // "this install never checks for updates again" — the one outcome nobody
  // asked for. Anything not one of the three modes falls back to "auto".
  if (!UPDATE_CHECK_MODES.includes(out.updateCheckMode as UpdateCheckMode)) {
    out.updateCheckMode = DEFAULTS.updateCheckMode;
  }
  // A pull mode the backend has no arm for would fail every pull.
  if (!PULL_MODES.includes(out.defaultPullMode)) {
    out.defaultPullMode = DEFAULTS.defaultPullMode;
  }
  // The same bounds the Settings inputs enforce, applied to values that did not
  // come through those inputs.
  out.diffContextLines = clampInt(out.diffContextLines, 0, 20, DEFAULTS.diffContextLines);
  out.autoFetchMinutes = clampInt(out.autoFetchMinutes, 1, 60, DEFAULTS.autoFetchMinutes);
  // Backfill logo colors for custom themes saved before the slots existed, drop
  // anything unusable, and keep the ids so `activeThemeId` still resolves.
  out.customThemes = normalizeCustomThemes(out.customThemes, base.customThemes);

  // THEME PREFERENCE (#236). Runs after `customThemes` so both the repair and
  // the seed can see the theme list this payload actually brings.
  //
  // Absent means an install from before the feature existed: it keeps `base`'s
  // preference — DEFAULTS for `load()`, so `fixed`, so nothing on screen moves
  // on upgrade — and the half matching the theme they were already on is
  // seeded from it. Seeded only when the preference is still untouched, or an
  // import of an OLD file would silently overwrite a pairing this install has
  // since configured.
  if ("themePreference" in parsed) {
    out.themePreference = normalizeThemePreference(parsed.themePreference);
  } else if (sameValue(base.themePreference, DEFAULTS.themePreference)) {
    out.themePreference = seedPairingFrom(
      base.themePreference,
      out.activeThemeId,
      out.customThemes,
    );
  }
  // Repair a half naming a theme this machine does not have, or one whose mode
  // no longer matches. Written BACK rather than only resolved around, so the
  // Settings pickers show the theme the app will actually use.
  out.themePreference = {
    ...out.themePreference,
    lightId: pairedThemeId(out.themePreference, "light", out.customThemes),
    darkId: pairedThemeId(out.themePreference, "dark", out.customThemes),
  };
  // In system mode `activeThemeId` is derived, so it is re-derived here rather
  // than trusted: the persisted value is only a cache of the last resolution,
  // and an imported one records whichever half was on screen on someone else's
  // machine. This machine's own appearance is the only correct answer.
  if (out.themePreference.mode === "system") {
    out.activeThemeId = pairedThemeId(
      out.themePreference,
      getSystemAppearance(),
      out.customThemes,
    );
  }

  const changed = (Object.keys(DEFAULTS) as (keyof PersistedState)[]).filter(
    (key) => !sameValue(out[key], base[key]),
  );
  return { state: out, changed, ignored };
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return coerceSettings(parsed, DEFAULTS).state;
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

/**
 * The persisted slice of the store.
 *
 * Derived from `DEFAULTS` rather than hand-listed: the key set already lives in
 * one place, and a third copy is a third thing to forget when a preference is
 * added — which is the same reason the export derives its keys.
 */
function snapshot(s: SettingsState): PersistedState {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = (s as unknown as Record<string, unknown>)[key];
  }
  return out as unknown as PersistedState;
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

/** Re-apply whatever the state now resolves to. */
function applyResolved(s: SettingsState): void {
  applyTheme(findTheme(s, s.activeThemeId) ?? BUILTIN_THEMES[0]);
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

/**
 * The wire shape of ONE theme. Shared by the single-theme export and the
 * settings bundle, so there is one theme format rather than two — a bundle adds
 * `id` on top, because it has to keep `activeThemeId` resolvable.
 */
function themePayload(t: ThemeDef): Pick<ThemeDef, "name" | "mode" | "colors"> {
  return { name: t.name, mode: t.mode, colors: t.colors };
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
    if (typeof raw !== "string") {
      // logo slots were added after the first theme format; older exports omit
      // them. Fall back to the brand palette rather than rejecting the theme.
      if (f.key === "logo" || f.key === "logo2") continue;
      throw new Error(`Missing color: ${f.key}`);
    }
    out[f.key] = sanitizeHex(raw);
  }
  if (out.logo === undefined) out.logo = LOGO_PRIMARY;
  if (out.logo2 === undefined) out.logo2 = LOGO_SECONDARY;
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
  // Read synchronously from `prefers-color-scheme` at module load; the Tauri
  // window theme refines it a tick later (see startSystemAppearanceWatch), so
  // the first paint is already right instead of flashing the other half.
  systemAppearance: getSystemAppearance(),

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
    set(activationPatch(s, theme, s.systemAppearance, s.customThemes));
    persist(snapshot(get()));
    applyResolved(get());
  },

  setThemeFollowMode(mode) {
    const s = get();
    if (s.themePreference.mode === mode) return;
    const themePreference: ThemePreference = { ...s.themePreference, mode };
    // Going system → fixed keeps whatever is on screen: `activeThemeId` is
    // already the resolved half, so "fixed" means "stop here", which is the
    // only reading that does not surprise the person who just clicked it.
    set({
      themePreference,
      activeThemeId: resolveActiveThemeId({ ...s, themePreference }, s.systemAppearance),
    });
    persist(snapshot(get()));
    applyResolved(get());
  },

  setPairedThemeId(appearance, id) {
    const s = get();
    const theme = findTheme(s, id);
    if (!theme || theme.mode !== appearance) return;
    const themePreference: ThemePreference = {
      ...s.themePreference,
      ...(appearance === "light" ? { lightId: id } : { darkId: id }),
    };
    set({
      themePreference,
      activeThemeId: resolveActiveThemeId({ ...s, themePreference }, s.systemAppearance),
    });
    persist(snapshot(get()));
    applyResolved(get());
  },

  syncSystemAppearance(appearance) {
    const s = get();
    if (s.systemAppearance === appearance) return;
    set({ systemAppearance: appearance });
    // A fixed install records the observation (Settings shows it) and stops
    // there — nothing on screen moves, and nothing is written.
    if (s.themePreference.mode !== "system") return;
    const activeThemeId = resolveActiveThemeId(s, appearance);
    if (activeThemeId === s.activeThemeId) return;
    set({ activeThemeId });
    persist(snapshot(get()));
    applyResolved(get());
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
      const customThemes = [...s.customThemes, dup];
      set({
        customThemes,
        ...activationPatch(s, dup, s.systemAppearance, customThemes),
      });
      persist(snapshot(get()));
      applyResolved(get());
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
    const customThemes = [...s.customThemes, dup];
    set({
      customThemes,
      ...activationPatch(s, dup, s.systemAppearance, customThemes),
    });
    persist(snapshot(get()));
    applyResolved(get());
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
    const customThemes = [...s.customThemes, dup];
    set({
      customThemes,
      ...activationPatch(s, dup, s.systemAppearance, customThemes),
    });
    persist(snapshot(get()));
    applyResolved(get());
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
    // The pairing can name the theme being deleted, in either half. Repair
    // both against the surviving list rather than only the active one: a
    // dangling `lightId` is invisible until sunrise, which is the worst time
    // to discover it.
    const themePreference: ThemePreference = {
      ...s.themePreference,
      lightId: pairedThemeId(s.themePreference, "light", next),
      darkId: pairedThemeId(s.themePreference, "dark", next),
    };
    const activeThemeId =
      themePreference.mode === "system"
        ? pairedThemeId(themePreference, s.systemAppearance, next)
        : s.activeThemeId === id
          ? DEFAULT_THEME_PREFERENCE.darkId
          : s.activeThemeId;
    set({ customThemes: next, themePreference, activeThemeId });
    persist(snapshot(get()));
    if (activeThemeId !== s.activeThemeId) applyResolved(get());
  },

  exportTheme(id) {
    const s = get();
    const t = findTheme(s, id);
    if (!t) throw new Error(`No theme with id ${id}`);
    const payload = {
      $schema: "https://platypusgit.dev/theme.schema.json",
      version: 1,
      ...themePayload(t),
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
    const customThemes = [...s.customThemes, theme];
    set({
      customThemes,
      ...activationPatch(s, theme, s.systemAppearance, customThemes),
    });
    persist(snapshot(get()));
    applyResolved(get());
    return theme;
  },

  exportSettings(opts) {
    const s = get();
    const settings: Record<string, unknown> = {};
    for (const key of PORTABLE_KEYS) {
      settings[key] =
        key === "customThemes"
          ? s.customThemes.map((t) => ({ id: t.id, ...themePayload(t) }))
          : s[key];
    }
    const presetId = opts?.keymapPresetId?.trim();
    return JSON.stringify(
      {
        $schema: SETTINGS_SCHEMA_URL,
        kind: SETTINGS_EXPORT_KIND,
        version: SETTINGS_EXPORT_VERSION,
        // File metadata, not a preference: the import path never reads it. It
        // is here because "attach your settings export" is a support story, and
        // the first question is always how old the file is.
        exportedAt: new Date().toISOString(),
        settings,
        ...(presetId ? { keymap: { presetId } } : {}),
      },
      null,
      2,
    );
  },

  downloadSettings(opts) {
    const json = get().exportSettings(opts);
    // Date, not timestamp: this is a file people keep and re-read, so a name
    // they can recognise beats a name that is unique.
    const filename = `platypusgit-settings-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  },

  importSettings(json) {
    const file = parseSettingsExport(json);
    // The deny-list works in BOTH directions. Export skipping a key is only
    // half the promise: a hand-edited file, or one from a build that shortened
    // its own deny-list, must not be able to set a preference that describes
    // another machine either. Reported, not swallowed.
    const portable: Record<string, unknown> = {};
    const denied: string[] = [];
    for (const [key, value] of Object.entries(file.settings)) {
      if (NON_PORTABLE_KEYS.includes(key as keyof PersistedState)) {
        denied.push(key);
      } else {
        portable[key] = value;
      }
    }
    // Merge onto the CURRENT state, not onto DEFAULTS — see coerceSettings.
    const { state, changed, ignored } = coerceSettings(portable, snapshot(get()));
    set(state);
    persist(state);
    // Everything with an effect outside the store has to be re-applied, or the
    // import lands in state and not on screen.
    applyTheme(findTheme(state, state.activeThemeId) ?? BUILTIN_THEMES[0]);
    applyDensity(state.uiDensity);
    applyZoom(state.uiZoom);
    return {
      changed,
      ignored: [...ignored, ...denied],
      keymapPresetId: file.keymapPresetId,
      version: file.version,
      // Accepted, not rejected: every field is validated on its own and unknown
      // keys are reported, so a file from a newer build degrades to "the
      // settings this build understands". Rejecting it would strand anyone
      // moving a machine back onto an older release — one of the cases the
      // export exists for.
      fromNewerVersion:
        file.version !== null && file.version > SETTINGS_EXPORT_VERSION,
    };
  },

  set(key, value) {
    set({ [key]: value } as Partial<SettingsState>);
    if (key === "themePreference") {
      // The generic setter is public API, so it must not be a back door around
      // the resolve: assigning a preference without re-deriving `activeThemeId`
      // would leave "follow the system" set and the wrong half on screen.
      const s = get();
      set({ activeThemeId: resolveActiveThemeId(s, s.systemAppearance) });
      applyResolved(get());
    }
    persist(snapshot(get()));
    if (key === "uiDensity") {
      applyDensity(get().uiDensity);
    }
    if (key === "uiZoom") {
      applyZoom(get().uiZoom);
    }
  },

  stepZoom(steps) {
    get().set("uiZoom", normalizeZoom(get().uiZoom + steps * ZOOM_STEP));
  },

  reset() {
    set({ ...DEFAULTS });
    persist(DEFAULTS);
    applyTheme(BUILTIN_THEMES[0]);
    applyDensity(DEFAULTS.uiDensity);
    applyZoom(DEFAULTS.uiZoom);
  },
}));

// Apply active theme + density on module load so there's no flash before
// first render.
{
  const s = useSettingsStore.getState();
  const active = findTheme(s, s.activeThemeId) ?? BUILTIN_THEMES[0];
  applyTheme(active);
  applyDensity(s.uiDensity);
  applyZoom(s.uiZoom);
}

/**
 * Follow the OS light/dark appearance for as long as this window lives (#236).
 *
 * Called from `main.tsx` — which BOTH windows run, before it branches on the
 * `window=merge` query param, so the merge resolver subscribes for itself.
 * A resolver left in last night's theme while the main window switched is
 * exactly the bug this feature exists to fix, and the two windows do not
 * depend on each other being open.
 *
 * Not a module-load side effect: an async subscription firing in every test
 * that so much as imports a setting is noise, and the caller is the one that
 * knows the window's lifetime.
 */
export function startSystemAppearanceWatch(): () => void {
  return watchSystemAppearance((appearance) => {
    useSettingsStore.getState().syncSystemAppearance(appearance);
  });
}

export type { Appearance } from "./systemAppearance";

/**
 * The active density's pixel step, for surfaces that need the NUMBER rather
 * than the `--row-step` CSS var — i.e. anything doing geometry math in JS.
 * Prefer the CSS token everywhere it works; this exists for SVG user-unit
 * drawing (see `PGGraphRow`), which a `calc()` cannot reach.
 */
export function useDensityStep(): number {
  return DENSITY_STEP_PX[normalizeDensity(useSettingsStore((s) => s.uiDensity))];
}
