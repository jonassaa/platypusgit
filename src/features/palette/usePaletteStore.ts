import { create } from "zustand";
import type { PaletteStep, ChipKind } from "./types";

/**
 * UI state for the command palette (⌘P). Holds open state, the step stack of
 * the inline state machine, the current query, and the active type-filter
 * chip. Result *data* is read live from the other feature stores by the
 * component + commands module, so nothing here knows about branches/files/etc.
 */
interface PaletteState {
  open: boolean;
  /** Bottom is always `{ kind: "root" }`; the top step is what renders. */
  stack: PaletteStep[];
  /** Query for the active (top) step. */
  query: string;
  /** Root-only type filter. */
  activeChip: ChipKind;
  openPalette: () => void;
  closePalette: () => void;
  setQuery: (q: string) => void;
  setChip: (c: ChipKind) => void;
  pushStep: (step: PaletteStep) => void;
  popStep: () => void;
}

export const usePaletteStore = create<PaletteState>((set) => ({
  open: false,
  stack: [{ kind: "root" }],
  query: "",
  activeChip: "all",
  openPalette: () =>
    set({ open: true, stack: [{ kind: "root" }], query: "", activeChip: "all" }),
  closePalette: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  setChip: (activeChip) => set({ activeChip }),
  pushStep: (step) =>
    set((s) => ({
      stack: [...s.stack, step],
      query: step.kind === "input" && step.initial != null ? step.initial : "",
    })),
  popStep: () =>
    set((s) => {
      if (s.stack.length <= 1) return { open: false };
      return { stack: s.stack.slice(0, -1), query: "" };
    }),
}));
