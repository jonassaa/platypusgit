// A custom action's keyboard shortcut (#225) — what fires, and what a chord is
// not allowed to collide with.
//
// Split out of `customActions.ts` because this is the one part of the feature
// that has to know the KEYMAP: everything else there is a list and its
// validation. The dependency runs one way — `presets.ts` is plain data and
// imports nothing from this feature.

import { ACTIONS } from "@/features/keymap/actions";
import { BUILTIN_PRESETS } from "@/features/keymap/presets";

import {
  isBindableChord,
  normalizeChord,
  showsOn,
  type CustomAction,
} from "./customActions";

/** Why a chord cannot be used. */
export type ChordConflict =
  | { kind: "builtin"; title: string; preset: string }
  | { kind: "custom"; name: string };

/**
 * The built-in action bound to `chord`, in ANY preset.
 *
 * Every preset, not just the active one, on purpose: presets are switchable, so
 * a chord vetted against one alone would start colliding the day its owner
 * tries the other keymap — and the collision would be silent, because the
 * built-in wins. Checking the union costs the user a handful of chords and buys
 * "a shortcut that works keeps working".
 */
export function builtinChordOwner(
  chord: string,
): { title: string; preset: string } | null {
  if (!chord) return null;
  for (const preset of BUILTIN_PRESETS) {
    for (const [id, chords] of Object.entries(preset.bindings)) {
      if (chords?.includes(chord)) {
        return {
          title: ACTIONS[id as keyof typeof ACTIONS]?.title ?? id,
          preset: preset.name,
        };
      }
    }
  }
  return null;
}

/**
 * The chord that actually fires for `a`, or `""`.
 *
 * ONE gate, so the dispatcher, the cheat sheet, the palette chip and the
 * Settings row can never disagree about whether a shortcut is live. Three
 * things have to be true:
 *
 * 1. **It is a chord a shortcut may take** — `isBindableChord`.
 * 2. **The action is on the palette.** A shortcut runs the action the way the
 *    palette runs it, with the repository context, because a key press carries
 *    no selection: `$FILE` and `$SHA` are filled by the menu that named a file
 *    or a commit, and there is no such menu behind a chord. The stored value
 *    survives unticking `repo` rather than being cleared, so re-ticking gives
 *    the shortcut back instead of asking the user to remember what it was.
 * 3. **No built-in owns the chord.** The dispatcher offers every catalog
 *    binding first, so such a chord could never fire — and a palette chip or a
 *    cheat-sheet row advertising a key that does something else is worse than
 *    no shortcut at all. Settings refuses to record one; this is what also
 *    covers a hand-edited settings file.
 */
export function boundChord(a: CustomAction): string {
  const chord = normalizeChord(a.chord);
  if (!isBindableChord(chord)) return "";
  if (!showsOn(a, "repo")) return "";
  return builtinChordOwner(chord) ? "" : chord;
}

/**
 * Why `chord` cannot be given to the action `selfId`, or null when it can.
 *
 * Says nothing about whether the chord is BINDABLE (`chordRefusal`) — that is a
 * property of the chord alone and the field asks it separately, so the two
 * refusals can say different things.
 */
export function chordConflict(
  chord: string,
  list: readonly CustomAction[],
  selfId: string,
): ChordConflict | null {
  const c = normalizeChord(chord);
  if (!c) return null;
  const builtin = builtinChordOwner(c);
  if (builtin) return { kind: "builtin", ...builtin };
  // Only against chords that would actually fire: an action whose shortcut is
  // dormant because it left the palette is not competing for the key.
  const other = list.find((a) => a.id !== selfId && boundChord(a) === c);
  return other ? { kind: "custom", name: other.name } : null;
}

/** The refusal, in prose. */
export function describeConflict(c: ChordConflict): string {
  return c.kind === "builtin"
    ? `${c.preset} already uses this for ${c.title}.`
    : `${c.name} already uses this.`;
}
