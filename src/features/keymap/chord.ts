// Chord model — normalize keyboard events to a canonical chord string, and
// render chords for display. Keymap is data; this is the parse/format layer.
//
// Canonical form: modifiers in fixed order `Mod`, `Ctrl`, `Alt`, `Shift`,
// joined to the base key by `+`. `Mod` collapses ⌘ (mac) / Ctrl (other).

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const LONE_MODS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

type ChordEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/** Normalize a DOM keyboard event to a canonical chord string, or null for a
 *  lone modifier keypress (which is never itself a chord). */
export function eventToChord(e: ChordEvent): string | null {
  if (LONE_MODS.has(e.key)) return null;
  const parts: string[] = [];
  // `Mod` = platform-primary accelerator: ⌘ on mac, Ctrl elsewhere.
  if (e.metaKey || (e.ctrlKey && !IS_MAC)) parts.push("Mod");
  // A literal Ctrl on mac (distinct from Mod) keeps its own slot.
  if (e.ctrlKey && IS_MAC && !e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  let base = e.key;
  if (base.length === 1) base = base.toUpperCase();
  parts.push(base);
  return parts.join("+");
}

const GLYPH: Record<string, string> = {
  Mod: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "↵",
  Escape: "Esc",
};

const WORD: Record<string, string> = {
  Mod: "Ctrl",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

const ARROW_GLYPH: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
};

/** Pretty-print a chord for menus / tooltips / cheat-sheet. */
export function formatChord(
  chord: string,
  platform: "mac" | "other" = IS_MAC ? "mac" : "other",
): string {
  const segs = chord.split("+");
  const base = segs[segs.length - 1];
  const mods = segs
    .slice(0, -1)
    .sort(
      (a, b) =>
        MOD_ORDER.indexOf(a as (typeof MOD_ORDER)[number]) -
        MOD_ORDER.indexOf(b as (typeof MOD_ORDER)[number]),
    );
  if (platform === "mac") {
    return mods.map((m) => GLYPH[m] ?? m).join("") + (GLYPH[base] ?? base);
  }
  const baseOut = ARROW_GLYPH[base] ?? base;
  return [...mods.map((m) => WORD[m] ?? m), baseOut].join("+");
}
