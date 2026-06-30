// Keymap presets — chord ↔ action binding tables. The keymap IS this data;
// no handler reads raw keys. KN2 will layer user overrides on top of a chosen
// preset, so the shape stays additive: presets are plain data.

import type { ActionId } from "./registry";

export interface KeymapPreset {
  id: string;
  name: string;
  bindings: Partial<Record<ActionId, string[]>>;
}

export const PLATYPUSGIT_PRESET: KeymapPreset = {
  id: "platypusgit",
  name: "platypusgit (default)",
  bindings: {
    "nav.files": ["Mod+1"],
    "nav.commit": ["Mod+2"],
    "nav.history": ["Mod+3"],
    "nav.branches": ["Mod+4"],
    "nav.conflict": ["Mod+5"],
    "nav.rebase": ["Mod+6"],
    "nav.remote": ["Mod+7"],
    "nav.diff": ["Mod+8"],
    "nav.reflog": ["Mod+9"],
    "nav.settings": ["Mod+,"],
    "app.cheatSheet": ["?"],
    "app.closeOverlay": ["Escape"],
    "pane.focusLeft": ["Alt+ArrowLeft"],
    "pane.focusRight": ["Alt+ArrowRight"],
    "pane.focusUp": ["Alt+ArrowUp"],
    "pane.focusDown": ["Alt+ArrowDown"],
    "list.up": ["ArrowUp"],
    "list.down": ["ArrowDown"],
    "list.expand": ["ArrowRight"],
    "list.collapse": ["ArrowLeft"],
    "list.activate": ["Enter"],
    "repo.fetch": ["Mod+Shift+F"],
    "repo.pull": ["Mod+Shift+L"],
    "repo.push": ["Mod+Shift+P"],
  },
};

export const BUILTIN_PRESETS: KeymapPreset[] = [PLATYPUSGIT_PRESET];

export function presetById(id: string): KeymapPreset {
  return BUILTIN_PRESETS.find((p) => p.id === id) ?? PLATYPUSGIT_PRESET;
}

/** Build the chord → action-ids lookup used by the dispatcher. */
export function buildReverseMap(p: KeymapPreset): Map<string, ActionId[]> {
  const m = new Map<string, ActionId[]>();
  for (const [id, chords] of Object.entries(p.bindings)) {
    for (const chord of chords ?? []) {
      const arr = m.get(chord) ?? [];
      arr.push(id as ActionId);
      m.set(chord, arr);
    }
  }
  return m;
}
