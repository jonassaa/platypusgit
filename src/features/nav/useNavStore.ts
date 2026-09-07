import { create } from "zustand";
import type { RebaseStep } from "@/lib/types";
// A PURE module (no store, no IPC), so carrying a compare side here does not
// make nav depend on the compare feature's store.
import type { CompareSide } from "@/features/compare/compareSides";
// Same reasoning: `nav/types.ts` holds only `import type` statements, so it
// erases at build time and carries no runtime dependency on the settings
// feature or its store.
import type { SettingsPageId } from "@/features/settings/nav/types";

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
   * Replay the current branch onto a NEW base, interactively (186) — the
   * `git rebase -i <newbase>` half. `base` is any revspec (a full oid where the
   * caller has one, else a branch name); `label` is what to call it on screen.
   *
   * Deliberately NOT a `rebase-plan` carrying a base: the range is `base..HEAD`
   * and only the backend can walk it. The log is PAGED, so a plan assembled from
   * `useRepoStore.commits` would silently come up short for exactly the diverged
   * bases this exists for — and a branch context menu has a name, not commits.
   */
  | { kind: "rebase-onto"; base: string; label: string }
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
  | { kind: "switch-screen"; screen: string }
  /**
   * Open Settings, optionally on a named page.
   *
   * Its own kind rather than a field on `switch-screen`, whose `screen` is a
   * bare `string`: this one carries a typed page id, so a deep link cannot name
   * a page that does not exist. With no `page`, the screen lands on the
   * remembered one.
   */
  | { kind: "open-settings"; page?: SettingsPageId };

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
