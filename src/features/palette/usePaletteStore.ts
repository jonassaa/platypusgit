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

/**
 * The palette's closed-at-root state.
 *
 * Exported so tests can reset every field at once. Listing the fields by hand
 * in a test helper is how `stack` got left behind: `closePalette()` only clears
 * `open`, so a test that pushed a step leaked it into whichever test ran next,
 * which then rendered a pick step where it expected root. Add a field to
 * `PaletteState` and it belongs here too.
 */
export const paletteInitial = (): Pick<
  PaletteState,
  "open" | "stack" | "query" | "activeChip"
> => ({
  open: false,
  stack: [{ kind: "root" }],
  query: "",
  activeChip: "all",
});

export const usePaletteStore = create<PaletteState>((set) => ({
  ...paletteInitial(),
  openPalette: () => set({ ...paletteInitial(), open: true }),
  closePalette: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  setChip: (activeChip) => set({ activeChip }),
  pushStep: (step) =>
    set((s) => ({
      // A pushed step must be visible. Chained flows (reset → pick commit →
      // pick mode, rename-branch → pick → input, push-tag, stash-branch) run
      // through pick-item builders whose run() calls closePalette() before
      // onPick pushes the follow-up step — without reopening here that step
      // lands on a closed (unmounted) palette and is unreachable.
      open: true,
      stack: [...s.stack, step],
      query: step.kind === "input" && step.initial != null ? step.initial : "",
    })),
  popStep: () =>
    set((s) => {
      if (s.stack.length <= 1) return { open: false };
      return { stack: s.stack.slice(0, -1), query: "" };
    }),
}));
