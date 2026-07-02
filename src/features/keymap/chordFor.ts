// chordFor — resolve the first display chord for an action under the active
// preset. Used to surface live bindings in context menus and tooltips.

import { presetById } from "./presets";
import { formatChord } from "./chord";
import type { ActionId } from "./actions";
import { useKeymapStore } from "./useKeymapStore";

export function chordFor(id: ActionId): string {
  const preset = presetById(useKeymapStore.getState().activePresetId);
  const chords = preset.bindings[id];
  return chords && chords.length ? formatChord(chords[0]) : "";
}
