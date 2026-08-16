// Branch compare state (#131).
//
// Its own feature store, deliberately NOT a slice of `useRepoStore`: nothing
// here is per-repo live state the tab machinery has to freeze and rehydrate, so
// `RepoSlice`/`REPO_SLICE_KEYS` stay untouched. What it does need is the same
// staleness discipline — a tab switch can land between a request and its
// resolution — so every write is guarded on the repo id captured before the
// await.

import { create } from "zustand";

import { appErrorMessage } from "@/lib/errors";
import {
  aheadBehind as ipcAheadBehind,
  commitsBetween,
  diffCommits,
  diffRefToWorkdir,
} from "@/lib/tauri";
import type { AheadBehind, CommitInfo, FileDiff } from "@/lib/types";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import {
  COMPARE_COMMIT_LIMIT,
  WORKDIR,
  hasCommitLists,
  swapSides,
  type CompareSide,
} from "./compareSides";

interface CompareState {
  /** Repo the current results belong to; a mismatch discards a late write. */
  repoId: string | null;
  left: CompareSide;
  right: CompareSide;
  diffs: FileDiff[];
  /** null while loading, or for a working-tree right side (no ancestry). */
  summary: AheadBehind | null;
  /** Commits on the RIGHT side and not the left (`left..right`). */
  aheadCommits: CommitInfo[];
  /** Commits on the LEFT side and not the right (`right..left`). */
  behindCommits: CommitInfo[];
  loading: boolean;
  /**
   * Rendered in the screen, never pushed into `useRepoStore.error`: a revspec
   * typed into a picker that does not resolve is a bad input to this view, not
   * a repository-level failure worth the app banner.
   */
  error: string | null;
  /** "Mark for compare" scratch value — a ref name, not per-repo state. */
  marked: string | null;

  /** Point the view at a pair and clear the previous results. */
  open: (left: CompareSide, right: CompareSide) => void;
  setLeft: (side: CompareSide) => void;
  setRight: (side: CompareSide) => void;
  swap: () => void;
  mark: (ref: string) => void;
  clearMark: () => void;
  refresh: (contextLines: number, ignoreWhitespace: boolean) => Promise<void>;
}

const EMPTY_RESULTS = {
  diffs: [] as FileDiff[],
  summary: null,
  aheadCommits: [] as CommitInfo[],
  behindCommits: [] as CommitInfo[],
  error: null,
};

export const useCompareStore = create<CompareState>((set, get) => ({
  repoId: null,
  left: { kind: "rev", rev: "HEAD" },
  right: WORKDIR,
  ...EMPTY_RESULTS,
  loading: false,
  marked: null,

  open(left, right) {
    set({
      left,
      right,
      repoId: useRepoStore.getState().current?.id ?? null,
      ...EMPTY_RESULTS,
    });
  },

  setLeft(side) {
    set({ left: side, ...EMPTY_RESULTS });
  },

  setRight(side) {
    set({ right: side, ...EMPTY_RESULTS });
  },

  swap() {
    const { left, right } = get();
    set({ ...swapSides(left, right), ...EMPTY_RESULTS });
  },

  mark(ref) {
    set({ marked: ref });
  },

  clearMark() {
    set({ marked: null });
  },

  async refresh(contextLines, ignoreWhitespace) {
    const repo = useRepoStore.getState().current;
    if (!repo) {
      set({ ...EMPTY_RESULTS, loading: false });
      return;
    }
    const { left, right } = get();
    // Captured BEFORE the awaits; every write below is dropped if the active
    // repository moved on in the meantime.
    const forRepo = repo.id;
    const fresh = () => useRepoStore.getState().current?.id === forRepo;

    set({ repoId: forRepo, loading: true, error: null });

    try {
      if (hasCommitLists(left, right) && right.kind === "rev") {
        const [summary, ahead, behind, diffs] = await Promise.all([
          ipcAheadBehind(repo.id, left.rev, right.rev),
          commitsBetween(repo.id, left.rev, right.rev, COMPARE_COMMIT_LIMIT),
          commitsBetween(repo.id, right.rev, left.rev, COMPARE_COMMIT_LIMIT),
          diffCommits(repo.id, left.rev, right.rev, contextLines, ignoreWhitespace),
        ]);
        if (!fresh()) return;
        set({
          summary,
          aheadCommits: ahead,
          behindCommits: behind,
          diffs,
          loading: false,
        });
        return;
      }

      // A working-tree right side has no ancestry: no summary, no lists.
      // `includeUntracked: true` on purpose — see the wrapper's doc.
      const revspec = left.kind === "rev" ? left.rev : "HEAD";
      const diffs = await diffRefToWorkdir(
        repo.id,
        revspec,
        contextLines,
        ignoreWhitespace,
        true,
      );
      if (!fresh()) return;
      set({
        diffs,
        summary: null,
        aheadCommits: [],
        behindCommits: [],
        loading: false,
      });
    } catch (e) {
      if (!fresh()) return;
      set({ ...EMPTY_RESULTS, loading: false, error: appErrorMessage(e) });
    }
  },
}));

/**
 * Open the compare screen on a pair, from anywhere (a context menu, the
 * palette). One helper so every entry point sets the sides and the nav intent
 * in the same order — the screen reads the store, and the intent only routes.
 */
export function openCompare(left: CompareSide, right: CompareSide): void {
  useCompareStore.getState().open(left, right);
  useNavStore.getState().setIntent({ kind: "ref-compare", left, right });
}
