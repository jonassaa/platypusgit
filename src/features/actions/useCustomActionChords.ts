// Custom actions on the keyboard (#225) — the wiring between the settings list
// and the dispatcher.
//
// The dependency runs actions → keymap, like every other feature: the keymap
// store exposes a table of chords that are data (`UserBinding`) and knows
// nothing about custom actions; this file is what fills it.

import * as React from "react";

import {
  useKeymapStore,
  type UserBinding,
} from "@/features/keymap/useKeymapStore";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

import { boundChord } from "./actionChords";
import { type CustomAction } from "./customActions";
import { runAction } from "./runAction";

/**
 * The chord table for `list`.
 *
 * Only chords that would actually fire (`boundChord`), and the first action to
 * claim one keeps it — the editor refuses a duplicate, so a second can only
 * come from a hand-edited file, and one action running is a better answer than
 * two or an arbitrary one.
 */
export function buildUserBindings(
  list: readonly CustomAction[],
): Map<string, UserBinding> {
  const map = new Map<string, UserBinding>();
  for (const action of list) {
    const chord = boundChord(action);
    if (!chord || map.has(chord)) continue;
    map.set(chord, {
      title: action.name,
      run: () => {
        // The same guard `runAction` makes, asked synchronously so the chord
        // can DECLINE: every placeholder is about an open repository, and a
        // dispatcher that swallowed the key here would leave it doing nothing
        // instead of falling through.
        if (!useRepoStore.getState().current) return false;
        void runAction(action);
        return true;
      },
    });
  }
  return map;
}

/**
 * Keep the dispatcher's user bindings in step with Settings.
 *
 * Mounted once, in `AppShell`, next to the global keydown listener it feeds.
 */
export function useCustomActionChords(): void {
  const actions = useSettingsStore((s) => s.customActions);
  React.useEffect(() => {
    useKeymapStore.getState().setUserBindings(buildUserBindings(actions));
  }, [actions]);
}
