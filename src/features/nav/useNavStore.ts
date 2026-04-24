import { create } from "zustand";
import type { RebaseStep } from "@/lib/types";

/**
 * Cross-screen navigation intent. A context menu item can ask the app
 * to switch to a screen *and* pre-select a target. The target screen
 * reads the intent once on mount / when it changes, then clears it.
 */
export type NavIntent =
  | { kind: "diff-file"; path: string }
  | { kind: "commit-vs-wt"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  | { kind: "file-history"; path: string }
  | { kind: "blame"; path: string }
  | { kind: "rebase-plan"; plan: RebaseStep[] }
  | { kind: "stash-diff"; oid: string };

interface NavState {
  intent: NavIntent | null;
  setIntent: (i: NavIntent) => void;
  clearIntent: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  intent: null,
  setIntent: (intent) => set({ intent }),
  clearIntent: () => set({ intent: null }),
}));
