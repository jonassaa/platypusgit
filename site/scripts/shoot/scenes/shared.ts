// What every figure has in common: the settings they are all pinned to, and the
// handlers the app calls on any start regardless of what is open.
import type { Scene } from "../shim/core";

/**
 * Settings every figure renders under, written to `pg-settings-v2`.
 *
 * Pinned rather than left to defaults because a figure that changes when
 * nothing changed is a figure nobody trusts — and because two of these are
 * genuinely load-bearing:
 *
 * - `uiZoom: 1.2` matches the shipped 2026-08-18 captures (measured: the
 *   Welcome card is 634 CSS px there, 526 at 100%). It is a legibility
 *   decision, not an accident: Screenshot.astro renders a 1462px window into a
 *   1040px column, and 13px body text does not survive that 71% downscale
 *   well. The shim turns this into real browser zoom, through the app's own
 *   applyZoom path.
 * - `uiSpacing` / `uiTextScale` are #459's presets, which drive `--row-scale`
 *   and `--row-step`. Unpinned, a preset change would silently re-flow every
 *   row in every figure.
 *
 * The values other than uiZoom are the app's own defaults, restated so that a
 * future default change does not quietly restyle the marketing figures.
 */
export const FIGURE_SETTINGS = {
  activeThemeId: "dark-cool",
  uiSpacing: "cozy",
  uiTextScale: "default",
  uiZoom: 1.2,
  dateFormat: "relative",
  diffViewMode: "inline",
} as const;

/**
 * `pg-settings-v2` holds a PLAIN object — not a zustand persist envelope, so
 * this is written straight in with no `{ state, version }` wrapper.
 *
 * Takes overrides because the figures genuinely disagree about one setting:
 * the commit figure shows the SPLIT diff and the history figure the inline one,
 * which is what each screen's pane width is worth showing.
 */
export function settingsStorage(
  overrides: Partial<Record<keyof typeof FIGURE_SETTINGS, unknown>> = {},
): string {
  return JSON.stringify({ ...FIGURE_SETTINGS, ...overrides });
}

/**
 * Commands the app issues on any start, whatever is open. Each was added
 * because a `--report` run named it; nothing here is speculative.
 */
export const BOOT_HANDLERS: Scene["handlers"] = {
  // No `pgit .` argument brought this window up — these figures are the app
  // opened on its own. `null` is the "nothing to act on" answer.
  take_launch_intent: () => null,
  // The filesystem watcher has nothing to watch in a rendered figure.
  watch_stop: () => undefined,
  // macOS reports `Notify`: update.rs::capability falls through to it for every
  // target that is not Windows or Linux, because macOS updates come from the
  // Homebrew cask (latest.json carries no darwin entry). Saying "self-update"
  // here would put a control in the figure that the shipped macOS app does not
  // have.
  get_update_capability: () => "notify",
  // No update available. Keeps the update chip out of the titlebar — a figure
  // advertising the app should not also advertise that the build in it is old.
  check_for_update: () => null,
};
