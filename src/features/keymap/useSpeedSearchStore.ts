// Speed-search query state — one live query per pane, written by the
// dispatcher's unbound-printable-key fallback (useKeymapStore) and read by
// usePaneList (jump-to-match) and PGPane (query chip). Queries die with pane
// focus: moving to another pane clears everything, matching the JetBrains
// speed-search lifetime.

import { create } from "zustand";
import { useFocusStore } from "./useFocusStore";

interface SpeedSearchState {
  queries: Record<string, string>;
  append: (paneId: string, ch: string) => void;
  backspace: (paneId: string) => void;
  clear: (paneId: string) => void;
}

export const useSpeedSearchStore = create<SpeedSearchState>((set) => ({
  queries: {},
  append: (paneId, ch) =>
    set((s) => ({
      queries: { ...s.queries, [paneId]: (s.queries[paneId] ?? "") + ch },
    })),
  backspace: (paneId) =>
    set((s) => ({
      queries: { ...s.queries, [paneId]: (s.queries[paneId] ?? "").slice(0, -1) },
    })),
  clear: (paneId) =>
    set((s) => {
      if (!(paneId in s.queries)) return s;
      const next = { ...s.queries };
      delete next[paneId];
      return { queries: next };
    }),
}));

// Focus change wipes all queries (also covers pane unmount → focus handoff).
useFocusStore.subscribe((s, prev) => {
  if (s.focused === prev.focused) return;
  if (Object.keys(useSpeedSearchStore.getState().queries).length === 0) return;
  useSpeedSearchStore.setState({ queries: {} });
});
