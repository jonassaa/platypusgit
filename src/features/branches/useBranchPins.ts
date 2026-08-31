// Which branches a repository has pinned (#238), stored beside the folds
// (`useBranchFolders`): one localStorage key holding every repository's set,
// best-effort, never fatal.
//
// NOT in `useRepoStore`, for the reason the folds are not: that store holds one
// repository's live git state and every field of it has to join `RepoSlice`,
// while a pin is a view preference that must OUTLIVE the tab.
//
// A zustand STORE rather than the folds' React hook, because two of the four
// surfaces that order branches are not components — `design/context-menu.tsx`
// builds the menu items and `features/palette/commands.ts` builds the palette
// rows, and both reach state through `getState()`. Keying by repository path
// rather than tracking a "current" repository is what keeps a tab switch from
// showing one repository's pins against another's branches.

import { create } from "zustand";

/** One key for every repository's pins — see `useBranchFolders`'s fold map. */
export const BRANCH_PINS_KEY = "pg-branch-pins-v1";

type PinMap = Record<string, string[]>;

const EMPTY: string[] = [];

function readStore(): PinMap {
  try {
    const raw = localStorage.getItem(BRANCH_PINS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PinMap = {};
    for (const [repo, names] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(names)) continue;
      const clean = names.filter((n): n is string => typeof n === "string");
      if (clean.length > 0) out[repo] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(byRepo: PinMap): void {
  try {
    if (Object.keys(byRepo).length === 0) {
      localStorage.removeItem(BRANCH_PINS_KEY);
      return;
    }
    localStorage.setItem(BRANCH_PINS_KEY, JSON.stringify(byRepo));
  } catch {
    // non-fatal — the session just won't remember the pins
  }
}

interface BranchPinsState {
  /** Every repository's pinned branch names, keyed by workdir path. */
  byRepo: PinMap;
  /** Pin `name` in `repoPath`, or unpin it if it is already pinned. */
  toggle: (repoPath: string | null, name: string) => void;
  /** Re-read localStorage. Only a fresh app start needs this; tests use it. */
  reload: () => void;
}

export const useBranchPins = create<BranchPinsState>((set, get) => ({
  byRepo: readStore(),

  toggle(repoPath, name) {
    if (!repoPath || !name) return;
    const byRepo = { ...get().byRepo };
    const current = byRepo[repoPath] ?? EMPTY;
    const next = current.includes(name)
      ? current.filter((n) => n !== name)
      : [...current, name];
    // Prune rather than store an empty array, so a repository whose pins were
    // all removed leaves no entry behind.
    if (next.length === 0) delete byRepo[repoPath];
    else byRepo[repoPath] = next;
    set({ byRepo });
    persist(byRepo);
  },

  reload() {
    set({ byRepo: readStore() });
  },
}));

/**
 * The branch names pinned in `repoPath`, newest pin last.
 *
 * Returns the stored array itself, so the reference is stable while the pins
 * are — `Branches.tsx` memoizes a `Set` on it, and a fresh array per read would
 * rebuild the ordering on every unrelated store write.
 */
export function pinnedIn(repoPath: string | null): string[] {
  if (!repoPath) return EMPTY;
  return useBranchPins.getState().byRepo[repoPath] ?? EMPTY;
}
