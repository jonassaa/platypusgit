// Branch compare state (#131).
//
// Its own feature store, deliberately NOT a slice of `useRepoStore`: nothing
// here is per-repo live state the tab machinery has to freeze and rehydrate, so
// `RepoSlice`/`REPO_SLICE_KEYS` stay untouched. What it does need is the same
// staleness discipline `useRepoStore` gives `logRef`/`commitFilter`, and repo
// identity alone is NOT that: the sides, the context width and the
// ignore-whitespace flag are four more ways to start a second request while a
// first is in flight. So every write is fenced on a monotonic request token —
// see `requestSeq`.

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

/**
 * Monotonic request token. A `refresh` writes its results only if it is still
 * the newest request; anything that INVALIDATES the current results bumps it
 * too, so a response that predates a side change is discarded rather than
 * painted under a bar naming a different pair.
 *
 * Module-level rather than store state on purpose: it is not rendered, and a
 * test resetting the store must not be able to rewind it into collision with a
 * request already in flight.
 */
let requestSeq = 0;

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
  /**
   * Untracked files the backend left out because there were too many of them
   * (see `WorkdirDiff`). Reported, never swallowed — a silently short file list
   * is exactly the failure the ceiling exists to avoid becoming.
   */
  untrackedOmitted: number;
  loading: boolean;
  /**
   * Rendered in the screen, never pushed into `useRepoStore.error`: a revspec
   * typed into a picker that does not resolve is a bad input to this view, not
   * a repository-level failure worth the app banner.
   */
  error: string | null;
  /**
   * "Mark for compare" scratch value. Carries the repository it was taken in:
   * a ref name IS per-repo state, and offering `feature/pricing` from repo A in
   * repo B's menu resolves to `InvalidRef` on click. Read it through
   * `markedRefFor`, never directly.
   */
  marked: { repoId: string; ref: string } | null;

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
  untrackedOmitted: 0,
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
    requestSeq += 1;
    set({
      left,
      right,
      repoId: useRepoStore.getState().current?.id ?? null,
      ...EMPTY_RESULTS,
    });
  },

  setLeft(side) {
    requestSeq += 1;
    set({ left: side, ...EMPTY_RESULTS });
  },

  setRight(side) {
    requestSeq += 1;
    set({ right: side, ...EMPTY_RESULTS });
  },

  swap() {
    requestSeq += 1;
    const { left, right } = get();
    set({ ...swapSides(left, right), ...EMPTY_RESULTS });
  },

  mark(ref) {
    const repoId = useRepoStore.getState().current?.id;
    if (!repoId) return;
    set({ marked: { repoId, ref } });
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
    // Captured BEFORE the awaits. The token covers every way this request can
    // be superseded — a new side, a new context width, the whitespace toggle,
    // the refresh button, `openCompare` from the palette — because each of them
    // either bumps it directly or re-fires this function, which bumps it here.
    // The repo check is kept alongside it for the one case a token cannot see:
    // a tab switch, which leaves the compare store untouched.
    const forRepo = repo.id;
    const token = ++requestSeq;
    const fresh = () =>
      requestSeq === token && useRepoStore.getState().current?.id === forRepo;

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
      const workdir = await diffRefToWorkdir(
        repo.id,
        revspec,
        contextLines,
        ignoreWhitespace,
        true,
      );
      if (!fresh()) return;
      set({
        diffs: workdir.files,
        untrackedOmitted: workdir.untrackedOmitted,
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

/**
 * The marked ref, but only if it was marked in the repository that is open now.
 * The single read path for the mark — a bare `marked` read would offer another
 * repository's branch name, which resolves to `InvalidRef` the moment it is
 * clicked.
 */
export function markedRefFor(repoId: string | null | undefined): string | null {
  const marked = useCompareStore.getState().marked;
  if (!marked || !repoId || marked.repoId !== repoId) return null;
  return marked.ref;
}
