// Overlay state owned by the keymap feature — currently just the cheat-sheet.
// Lives in its own store so action default runners (actions.ts) can toggle it
// without importing the dispatcher (avoids an import cycle).

import { create } from "zustand";

interface OverlayState {
  cheatSheetOpen: boolean;
  toggleCheatSheet: () => void;
  closeCheatSheet: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  cheatSheetOpen: false,
  toggleCheatSheet: () => set((s) => ({ cheatSheetOpen: !s.cheatSheetOpen })),
  closeCheatSheet: () => set({ cheatSheetOpen: false }),
}));
