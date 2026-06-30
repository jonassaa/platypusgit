// Focus model — tracks which pane currently holds focus and the spatial
// neighbor graph between panes. Alt+Arrow actions call `move` to traverse it.
// Panes register themselves via <PGPane> on mount.

import { create } from "zustand";

export type Neighbors = {
  left?: string;
  right?: string;
  up?: string;
  down?: string;
};

interface FocusState {
  focused: string | null;
  panes: Map<string, Neighbors>;
  register: (id: string, neighbors: Neighbors) => () => void;
  focus: (id: string) => void;
  move: (dir: keyof Neighbors) => void;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focused: null,
  panes: new Map(),

  register(id, neighbors) {
    get().panes.set(id, neighbors);
    // First pane to register on a screen takes focus.
    if (get().focused === null) set({ focused: id });
    return () => {
      get().panes.delete(id);
      if (get().focused === id) {
        const next = get().panes.keys().next().value ?? null;
        set({ focused: next });
      }
    };
  },

  focus(id) {
    if (get().panes.has(id)) set({ focused: id });
  },

  move(dir) {
    const cur = get().focused;
    if (!cur) return;
    const next = get().panes.get(cur)?.[dir];
    if (next && get().panes.has(next)) set({ focused: next });
  },
}));
