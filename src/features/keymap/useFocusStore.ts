// Focus model — tracks which pane currently holds focus and the spatial
// neighbor graph between panes. Alt+Arrow actions call `move` to traverse it.
// Panes register themselves via <PGPane> on mount.
//
// The activity bar registers as a special "bar" pane: it never auto-grabs focus
// and is excluded from "first content pane" resolution, but it is reachable via
// the neighbor graph (Alt+Arrow) and as the move target from content edges.

import { create } from "zustand";

export type Neighbors = {
  left?: string;
  right?: string;
  up?: string;
  down?: string;
};

interface RegisterOpts {
  /** Auto-grab focus when this is the first content pane / a focus is pending.
   *  Default true. The bar passes false. */
  autoFocus?: boolean;
  /** Marks the activity bar — excluded from content-focus resolution. */
  isBar?: boolean;
}

interface FocusState {
  focused: string | null;
  panes: Map<string, Neighbors>;
  /** Registration order, used to find the "first" content pane. */
  order: string[];
  barId: string | null;
  /** Set when a screen switch wants the next content pane to take focus. */
  pendingContentFocus: boolean;
  register: (id: string, neighbors: Neighbors, opts?: RegisterOpts) => () => void;
  focus: (id: string) => void;
  move: (dir: keyof Neighbors) => void;
  /** Focus the first registered content pane now, or arm it for the next one. */
  requestContentFocus: () => void;
}

function firstContentId(s: Pick<FocusState, "order" | "barId" | "panes">): string | null {
  return s.order.find((id) => id !== s.barId && s.panes.has(id)) ?? null;
}

export const useFocusStore = create<FocusState>((set, get) => ({
  focused: null,
  panes: new Map(),
  order: [],
  barId: null,
  pendingContentFocus: false,

  register(id, neighbors, opts) {
    const isBar = opts?.isBar ?? false;
    const autoFocus = opts?.autoFocus ?? true;
    get().panes.set(id, neighbors);
    if (!get().order.includes(id)) set({ order: [...get().order, id] });
    if (isBar) set({ barId: id });

    // Claim focus when this is a content pane and either nothing is focused yet
    // (initial load) or a screen switch armed a pending content-focus request.
    if (autoFocus && !isBar && (get().pendingContentFocus || get().focused === null)) {
      set({ focused: id, pendingContentFocus: false });
    }

    return () => {
      get().panes.delete(id);
      set({ order: get().order.filter((x) => x !== id) });
      if (get().barId === id) set({ barId: null });
      if (get().focused === id) {
        // Prefer falling back to another content pane, else the bar, else none.
        const next = firstContentId(get()) ?? get().barId ?? null;
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
    // From the bar, Alt+Right enters the content area's first pane.
    if (cur === get().barId && dir === "right") {
      get().requestContentFocus();
      return;
    }
    const next = get().panes.get(cur)?.[dir];
    if (next && get().panes.has(next)) set({ focused: next });
  },

  requestContentFocus() {
    const first = firstContentId(get());
    if (first) set({ focused: first, pendingContentFocus: false });
    else set({ pendingContentFocus: true });
  },
}));
