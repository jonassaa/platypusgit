// Chord model — normalize keyboard events to a canonical chord string, and
// render chords for display. Keymap is data; this is the parse/format layer.
//
// Canonical form: modifiers in fixed order `Mod`, `Ctrl`, `Alt`, `Shift`,
// joined to the base key by `+`. `Mod` collapses ⌘ (mac) / Ctrl (other).
//
// The base key for letters and digits comes from `e.code` (KeyA…, Digit0…),
// not `e.key` — on macOS, Alt+letter produces a composed character ("ƒ" for
// Alt+F) and non-US layouts move symbols around, so `e.key` would make Alt
// and cross-layout bindings impossible. Symbols and named keys keep `e.key`.
//
// `DoubleShift` is a synthetic chord emitted by the dispatcher when Shift is
// tapped twice in quick succession (JetBrains "Search Everywhere").

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const DOUBLE_SHIFT = "DoubleShift";

const MOD_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const LONE_MODS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

type ChordEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/** Layout-independent base key: letters/digits from e.code, rest from e.key. */
function baseKeyOf(e: ChordEvent): string {
  const code = e.code ?? "";
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  let base = e.key;
  if (base.length === 1) base = base.toUpperCase();
  return base;
}

/** Normalize a DOM keyboard event to a canonical chord string, or null for a
 *  lone modifier keypress (which is never itself a chord). */
export function eventToChord(e: ChordEvent): string | null {
  if (LONE_MODS.has(e.key)) return null;
  const base = baseKeyOf(e);
  // For shifted symbols (e.g. "?" = Shift+/), the shift is already baked into
  // the produced character — don't double-count it as a Shift modifier. Only
  // letters, digits, and named keys (ArrowLeft, Enter, …) carry explicit Shift.
  const isAlnum = base.length === 1 && /[A-Z0-9]/.test(base);
  const isNamed = base.length > 1;
  const parts: string[] = [];
  // `Mod` = platform-primary accelerator: ⌘ on mac, Ctrl elsewhere.
  if (e.metaKey || (e.ctrlKey && !IS_MAC)) parts.push("Mod");
  // A literal Ctrl on mac (distinct from Mod) keeps its own slot.
  if (e.ctrlKey && IS_MAC && !e.metaKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey && (isAlnum || isNamed)) parts.push("Shift");
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
  Tab: "⇥",
  Backspace: "⌫",
  " ": "Space",
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
  " ": "Space",
};

/** Pretty-print a chord for menus / tooltips / cheat-sheet. */
export function formatChord(
  chord: string,
  platform: "mac" | "other" = IS_MAC ? "mac" : "other",
): string {
  if (chord === DOUBLE_SHIFT) {
    return platform === "mac" ? "⇧⇧" : "Shift Shift";
  }
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
