import { create } from "zustand";

/**
 * UI state for the command palette (⌘P). Holds only open/query state —
 * result data is read live from the other feature stores by the component,
 * so nothing here needs to know about branches/files/commits.
 */
interface PaletteState {
  open: boolean;
  query: string;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  query: "",
  openPalette: () => set({ open: true, query: "" }),
  closePalette: () => set({ open: false }),
  setQuery: (query) => set({ query }),
}));
