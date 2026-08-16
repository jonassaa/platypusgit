import { create } from "zustand";
import type { RebaseStep } from "@/lib/types";
// A PURE module (no store, no IPC), so carrying a compare side here does not
// make nav depend on the compare feature's store.
import type { CompareSide } from "@/features/compare/compareSides";

/**
 * Cross-screen navigation intent. A context menu item can ask the app
 * to switch to a screen *and* pre-select a target. The target screen
 * reads the intent once on mount / when it changes, then clears it.
 */
export type NavIntent =
  | { kind: "diff-file"; path: string }
  | { kind: "commit-vs-wt"; oid: string }
  // A commit's own diff (vs its first parent) — "what this commit changed."
  | { kind: "commit-self"; oid: string }
  | { kind: "commit-vs-commit"; from: string; to: string }
  // Compare two refs, or a ref against the working tree (#131). The sides ride
  // along so the routing is self-describing, but the SCREEN reads them from
  // `useCompareStore` — it owns them, and they stay mutable once you are there.
  | { kind: "ref-compare"; left: CompareSide; right: CompareSide }
  | { kind: "file-history"; path: string }
  | { kind: "blame"; path: string }
  | { kind: "rebase-plan"; plan: RebaseStep[] }
  /**
   * A stash comparison (#133). Two targets, one screen.
   *
   * `oid` is the FULL stash-commit oid, never `stash@{N}` and never the index:
   * an index is a reflog position that anything writing to `refs/stash` shifts
   * (a rename included), so a stale one would silently compare a different
   * entry. `label` is what the user calls it (`stash@{0}`), carried only for
   * the header, and `untracked` says whether the entry has the `git stash -u`
   * third parent — which the two targets treat differently on purpose.
   */
  | { kind: "stash-diff"; oid: string; label: string; untracked: boolean }
  | { kind: "stash-vs-wt"; oid: string; label: string; untracked: boolean }
  | { kind: "switch-screen"; screen: string };

interface NavState {
  intent: NavIntent | null;
  /**
   * Screen to return to from a deep view (CommitDiff / FileHistory / Blame).
   * Set by AppShell when it routes an intent into a deep view; read by the
   * deep view's back affordance so "Back" lands where the user came from.
   */
  deepOrigin: string | null;
  setIntent: (i: NavIntent) => void;
  clearIntent: () => void;
  setDeepOrigin: (screen: string | null) => void;
}

export const useNavStore = create<NavState>((set) => ({
  intent: null,
  deepOrigin: null,
  setIntent: (intent) => set({ intent }),
  clearIntent: () => set({ intent: null }),
  setDeepOrigin: (deepOrigin) => set({ deepOrigin }),
}));
