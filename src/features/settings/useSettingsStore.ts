import { create } from "zustand";
import type { PullMode } from "@/lib/tauri";

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

/**
 * How the commit HEAD points at is marked in History, on top of the graph's own
 * HEAD ring (part of the graph, always drawn).
 *
 * "bar" is the default: an edge bar reads at a glance without repainting a row
 * whose colors carry other meaning. "tint" is for wanting the whole row lit.
 */
export const HEAD_INDICATORS = ["none", "bar", "tint", "both"] as const;
export type HeadIndicator = (typeof HEAD_INDICATORS)[number];

export const HEAD_INDICATOR_LABELS: Record<HeadIndicator, string> = {
  none: "Graph marker only",
  bar: "Edge bar",
  tint: "Highlight row",
  both: "Bar + highlight",
};

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
  activeThemeId: string;
  customThemes: ThemeDef[];
  uiDensity: "compact" | "comfortable";
  /** Webview zoom factor — 1 is 100%. See applyZoom. */
  uiZoom: number;
  /** How the History row you are currently on (HEAD) is marked. */
  headIndicator: HeadIndicator;
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
  /** Parent directory last used for Clone/Init, prefilled next time. */
  lastCreateDir: string;
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
  /** Nudge the zoom by whole steps; clamped at both ends. */
  stepZoom: (steps: number) => void;
  reset: () => void;
}

const DEFAULTS: PersistedState = {
  activeThemeId: "dark-cool",
  customThemes: [],
  uiDensity: "compact",
  uiZoom: 1,
  headIndicator: "bar",
  defaultPullMode: "Rebase",
  autoFetchEnabled: false,
  autoFetchMinutes: 5,
  pruneOnFetch: true,
  confirmForcePush: true,
  autoStashBeforePull: true,
  addSignoff: false,
  signCommits: "config",
  diffContextLines: 3,
  diffViewMode: "inline",
  diffContextMode: "wholeFile",
  ignoreWhitespaceInDiff: false,
  lastCreateDir: "",
};

function load(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Only pick keys that still exist in the schema, so settings removed in
    // newer versions (e.g. showWhitespaceInDiff) don't leak stale properties
    // into the store state.
    const out = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof PersistedState)[]) {
      if (key in parsed) {
        (out as Record<string, unknown>)[key] = parsed[key];
      }
    }
    // `signCommits` was once a boolean no-op setting and is now a tri-state
    // (#61 D6), so an old payload can carry `true`/`false` where a mode is
    // expected. Anything that is not one of the three modes falls back to
    // "config", which defers to the repository rather than forcing signing on.
    if (!["config", "always", "never"].includes(out.signCommits as string)) {
      out.signCommits = DEFAULTS.signCommits;
    }
    // A hand-edited or newer-build zoom must not survive as-is: an out-of-range
    // factor is rejected by the webview and would leave the UI unzoomable.
    out.uiZoom = normalizeZoom(Number(out.uiZoom));
    // Same reasoning as the zoom clamp: an unknown value would silently mean
    // "no indicator at all" in the row renderer.
    if (!HEAD_INDICATORS.includes(out.headIndicator as HeadIndicator)) {
      out.headIndicator = DEFAULTS.headIndicator;
    }
    // Same reasoning again for the two diff modes: the renderers branch on these
    // exact strings, so an unknown value means "neither branch" — a blank pane.
    if (!["inline", "split"].includes(out.diffViewMode as string)) {
      out.diffViewMode = DEFAULTS.diffViewMode;
    }
    if (!["wholeFile", "chunks"].includes(out.diffContextMode as string)) {
      out.diffContextMode = DEFAULTS.diffContextMode;
    }
    // Backfill logo colors for custom themes saved before the slots existed,
    // so the theme editor and CSS vars always have a value.
    out.customThemes = out.customThemes.map((t) => {
      if (!t.colors) return t;
      const needs =
        t.colors.logo === undefined || t.colors.logo2 === undefined;
      return needs
        ? {
            ...t,
            colors: {
              ...t.colors,
              logo: t.colors.logo ?? LOGO_PRIMARY,
              logo2: t.colors.logo2 ?? LOGO_SECONDARY,
            },
          }
        : t;
    });
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
    uiZoom: s.uiZoom,
    headIndicator: s.headIndicator,
    defaultPullMode: s.defaultPullMode,
    autoFetchEnabled: s.autoFetchEnabled,
    autoFetchMinutes: s.autoFetchMinutes,
    pruneOnFetch: s.pruneOnFetch,
    confirmForcePush: s.confirmForcePush,
    autoStashBeforePull: s.autoStashBeforePull,
    addSignoff: s.addSignoff,
    signCommits: s.signCommits,
    diffContextLines: s.diffContextLines,
    diffViewMode: s.diffViewMode,
    diffContextMode: s.diffContextMode,
    ignoreWhitespaceInDiff: s.ignoreWhitespaceInDiff,
    lastCreateDir: s.lastCreateDir,
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
 * The active density's pixel step, for surfaces that need the NUMBER rather
 * than the `--row-step` CSS var — i.e. anything doing geometry math in JS.
 * Prefer the CSS token everywhere it works; this exists for SVG user-unit
 * drawing (see `PGGraphRow`), which a `calc()` cannot reach.
 */
export function useDensityStep(): number {
  return DENSITY_STEP_PX[normalizeDensity(useSettingsStore((s) => s.uiDensity))];
}
