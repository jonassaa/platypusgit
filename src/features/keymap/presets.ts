// Keymap presets — chord ↔ action binding tables. The keymap IS this data;
// no handler reads raw keys. KN2 will layer user overrides on top of a chosen
// preset, so the shape stays additive: presets are plain data.
//
// "rider" is the default: git chords resemble JetBrains Rider (⌘K commit,
// ⌘⇧K push, ⌘T update/pull, ⌘D diff, ⌘9 git log, ⌘⇧A / double-Shift palette).

import { DOUBLE_SHIFT } from "./chord";
import type { ActionId } from "./actions";

export interface KeymapPreset {
  id: string;
  name: string;
  bindings: Partial<Record<ActionId, string[]>>;
}

/** Bindings shared by every preset — panes, lists, overlay. */
const COMMON = {
  "app.closeOverlay": ["Escape"],
  "pane.focusLeft": ["Alt+ArrowLeft"],
  "pane.focusRight": ["Alt+ArrowRight"],
  "pane.focusUp": ["Alt+ArrowUp"],
  "pane.focusDown": ["Alt+ArrowDown"],
  "pane.focusNext": ["Tab"],
  "pane.focusPrev": ["Shift+Tab"],
  "list.up": ["ArrowUp"],
  "list.down": ["ArrowDown"],
  "list.expand": ["ArrowRight"],
  "list.collapse": ["ArrowLeft"],
  "list.activate": ["Enter"],
  "list.toggle": [" "],
  "list.top": ["Home"],
  "list.bottom": ["End"],
} satisfies Partial<Record<ActionId, string[]>>;

export const RIDER_PRESET: KeymapPreset = {
  id: "rider",
  name: "JetBrains Rider (default)",
  bindings: {
    ...COMMON,
    "nav.files": ["Mod+1"],
    "nav.commit": ["Mod+K", "Mod+2"],
    "nav.history": ["Mod+9", "Mod+3"],
    "nav.branches": ["Mod+4"],
    "nav.conflict": ["Mod+5"],
    "nav.rebase": ["Mod+6"],
    "nav.remote": ["Mod+7"],
    "nav.diff": ["Mod+D", "Mod+8"],
    "nav.reflog": ["Mod+Shift+9"],
    "nav.settings": ["Mod+,"],
    "palette.open": ["Mod+P", "Mod+Shift+A", DOUBLE_SHIFT],
    "app.cheatSheet": ["?"],
    "repo.fetch": ["Mod+Shift+T"],
    "repo.pull": ["Mod+T"],
    "repo.push": ["Mod+Shift+K"],
    "repo.refresh": ["Mod+Alt+Y"],
  },
};

export const PLATYPUSGIT_PRESET: KeymapPreset = {
  id: "platypusgit",
  name: "platypusgit classic",
  bindings: {
    ...COMMON,
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
    "palette.open": ["Mod+P"],
    "app.cheatSheet": ["?"],
    "repo.fetch": ["Mod+Shift+F"],
    "repo.pull": ["Mod+Shift+L"],
    "repo.push": ["Mod+Shift+P"],
    "repo.refresh": ["Mod+Shift+R"],
  },
};

export const BUILTIN_PRESETS: KeymapPreset[] = [RIDER_PRESET, PLATYPUSGIT_PRESET];

export const DEFAULT_PRESET = RIDER_PRESET;

export function presetById(id: string): KeymapPreset {
  return BUILTIN_PRESETS.find((p) => p.id === id) ?? DEFAULT_PRESET;
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
