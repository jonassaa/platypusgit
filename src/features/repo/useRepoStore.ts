import { create } from "zustand";
import { pgChoose, pgFlash } from "@/design";
import type {
  AuthorOverride,
  BisectMark,
  BulkFastForward,
  CommitResult,
  DiffToolTarget,
  FastForward,
  FileContent,
  FileStatus,
  LogFilter,
  NetProgress,
  RebaseProgress,
  RebaseStatus,
  RebaseStep,
  RepoHandle,
} from "@/lib/types";
import type { AppError, BranchHeld, HookRejection } from "@/lib/errors";
import {
  dubiousOwnershipPath,
  isAppError,
  isAuthError,
  isCancelledError,
  isDubiousOwnershipError,
  isNoSignatureError,
  toAppError,
} from "@/lib/errors";
import { useAuthStore } from "@/features/auth/useAuthStore";
import { confirmTrust } from "@/features/repo/ownership";
import {
  abortOperation,
  acceptOurs,
  acceptTheirs,
  addRemote,
  bisectMark as bisectMarkFn,
  bisectReset as bisectResetFn,
  bisectStart as bisectStartFn,
  bisectStatus as bisectStatusFn,
  appendGitignore as appendGitignoreFn,
  openInDifftool as openInDifftoolFn,
  openInEditor as openInEditorFn,
  revealInFileManager as revealInFileManagerFn,
  openInTerminal as openInTerminalFn,
  checkoutBranch,
  checkoutRef,
  cherryPick,
  commit as commitFn,
  continueOperation,
  createBranch,
  createTag,
  deleteBranch,
  deleteTag,
  discardHunk,
  discardLines as discardLinesFn,
  discardPaths,
  deleteUntrackedFiles as deleteUntrackedFilesFn,
  fastForwardAllBranches as fastForwardAllBranchesFn,
  fastForwardBranch as fastForwardBranchFn,
  fetch as fetchRemote,
  fetchAll,
  getLogFilteredPage,
  getLogPage,
  getStatus,
  headInfo as headInfoFn,
  listAllFiles,
  listFilesAtRev as listFilesAtRevFn,
  readFileContentAtRev as readFileContentAtRevFn,
  listBranches,
  listRemotes,
  listStashes,
  listTags,
  markResolved,
  mergeBranch as mergeBranchFn,
  openRepo,
  closeRepo as closeRepoIpc,
  trustRepoPath,
  pruneRemote,
  pull as pullRemote,
  push as pushRemote,
  pushDeleteBranch as pushDeleteBranchFn,
  pushTag as pushTagFn,
  rebaseAbort,
  rebaseAcknowledge as rebaseAcknowledgeFn,
  rebaseOnto as rebaseOntoFn,
  rebaseContinue as rebaseContinueFn,
  rebaseStart as rebaseStartFn,
  rebaseStatus as rebaseStatusFn,
  renameBranch,
  renameRemote,
  reset as resetFn,
  revert as revertFn,
  removeRemote,
  repoState as repoStateFn,
  runMergetool as runMergetoolFn,
  restartConflict as restartConflictFn,
  cancelNetworkOp,
  rememberCredential,
  setRemoteUrl,
  setUpstream as setUpstreamFn,
  shallowInfo as shallowInfoFn,
  unshallow as unshallowFn,
  type Credentials,
  stageHunk,
  stageLines as stageLinesFn,
  stagePaths,
  stashApply,
  stashBranch as stashBranchFn,
  stashDrop,
  stashPop,
  stashRename as stashRenameFn,
  stashSave,
  stashSavePaths,
  unstageHunk,
  unstageLines as unstageLinesFn,
  unstagePaths,
  type PullMode,
  type PushForce,
  type ResetMode,
  type StashSaveOptions,
  type TagTarget,
} from "@/lib/tauri";
import { isFilterEmpty } from "@/features/commits/logFilter";
import { remoteOfUpstream } from "@/features/branches/fastForward";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useRecentsStore } from "./useRecentsStore";
import {
  DEFAULT_BISECT_STATUS,
  DEFAULT_REBASE_STATUS,
  DEFAULT_SHALLOW_INFO,
  emptySlice,
  sliceOf,
  type RepoSlice,
} from "./repoSlice";
import type { ActivityKey } from "./repoActivity";
import { resolveUpdateRefs } from "@/features/commits/stackedRefs";
import {
  checkUndo,
  pushUndo,
  quoteSubject,
  redoable,
  shortOid,
  undoable,
  type HeadSnapshot,
  type UndoDirection,
  type UndoKind,
} from "./undoStack";

/**
 * The holder, when a checkout was refused because a linked worktree is standing
 * on the branch (#358) — otherwise null, and the caller rethrows.
 *
 * Shape-checked rather than trusted: `message` is only a struct for the handful
 * of variants that carry one, and a payload of the wrong type must fall through
 * to the ordinary banner instead of rendering a dialog with `undefined` in it.
 */
function heldByWorktree(e: unknown): BranchHeld | null {
  if (!isAppError(e) || e.kind !== "BranchHeldByWorktree") return null;
  const held = e.message as BranchHeld;
  return held && typeof held.branch === "string" && typeof held.path === "string"
    ? held
    : null;
}

/**
 * Ask what to do about a branch another worktree holds.
 *
 * The take is offered ONLY when the backend said the holder can let go
 * (`blocked === null`) — a button that is going to be refused is worse than no
 * button. Cancel, Escape and the backdrop all come back as null, so declining
 * can never be mistaken for a choice.
 */
async function askAboutHeldBranch(held: BranchHeld): Promise<string | null> {
  const where = `worktree ${held.worktree} (${held.path})`;
  const body = held.blocked
    ? `It is checked out in ${where}, and ${held.blocked}. Finish or unlock that first, or go and work there instead.`
    : `It is checked out in ${where}${held.dirty ? ", which has uncommitted changes" : ""}. ` +
      `Moving it here leaves that worktree on a detached HEAD at the same commit — its files are not touched.`;
  return pgChoose({
    title: `Move ${held.branch} here?`,
    body,
    choices: [
      { id: "open", label: "Open that one" },
      ...(held.blocked ? [] : [{ id: "take", label: "Move it here", primary: true }]),
    ],
  });
}

/** Ids for undo entries. Module-level so they are unique across repositories. */
let undoSeq = 0;

export type { RepoActivity } from "./repoActivity";

/**
 * Commits per log page (#68 G11). Was a `500` literal repeated at four call
 * sites, which is what made history past it unreachable — it is now the page
 * size, not the ceiling.
 */
const PAGE_SIZE = 500;

/**
 * The repository store: exactly ONE repository's live state — the ACTIVE tab's
 * (#90). Every per-repo field comes from `RepoSlice`, which `useTabsStore`
 * freezes on the way out of a tab and hydrates on the way in. Screens keep
 * reading `s.status` / `s.commits` / `s.branches` and calling the same actions;
 * they never learn that there is more than one repository open.
 *
 * Two rules keep a tab switch from leaking:
 *   - hydration is a TOTAL write of `RepoSlice` (see repoSlice.ts), and
 *   - every fetch/error write goes through `setFor`/`setErrorFor`, which drop a
 *     response that resolved after the user moved to another repository.
 */
/**
 * Options for the two refreshes.
 *
 * `preserveError` exists for exactly one caller: the filesystem watcher (#239).
 * A refresh nobody asked for must not clear a banner the user has not read.
 *
 * The bug it fixes: a failed `--ff-only` pull sets `error`, but the fetch half
 * of that same pull moved `refs/remotes/…`, so the watcher's DEBOUNCED event
 * lands a few hundred milliseconds later — after the operation has cleared
 * `activity`, so `fsRefreshPlan`'s busy guard no longer suppresses it — and
 * `refreshAll`'s opening `set({ error: null })` wipes the message. The user
 * sees a pull that silently did nothing, which is the worst possible reading of
 * a failure.
 */
export interface RefreshOptions {
  /** Leave `error` alone. For refreshes the user did not ask for. */
  preserveError?: boolean;
}

interface RepoStoreState extends RepoSlice {
  /**
   * Open `path` into the ACTIVE slice and refresh it, returning the handle (or
   * null on failure, with the error already on the store).
   *
   * The low-level half of opening a repository: it knows nothing about tabs.
   * `useTabsStore.openRepo` is the entry point everything else calls — it
   * dedupes by path, creates the tab, and snapshots the outgoing one.
   */
  /**
   * Open `path` and adopt it as the live repository.
   *
   * `stillWanted` is re-asked AFTER the open resolves and BEFORE anything is
   * written: only the caller knows whether the user has moved on in the
   * meantime, and adopting a repository nobody is looking at is what left the
   * store holding a handle the tab layer then evicted (#177). Answer `false`
   * and the handle is closed and `null` returned, with the slice untouched.
   *
   * REQUIRED, deliberately: the store cannot answer this question for itself,
   * and a caller that omitted the predicate would silently reinstate the bug.
   * A default (`() => true`) plus a counter in here was tried and dropped — the
   * counter is a second, weaker answer to the same question, and it gets the
   * answer WRONG when one activation opens twice: the ownership-trust retry
   * bumps it past a concurrent, still-current activation's in-flight open, which
   * is then discarded and its tab marked failed. One authoritative guard,
   * enforced by the signature.
   */
  openRepoAt: (
    path: string,
    stillWanted: () => boolean,
  ) => Promise<RepoHandle | null>;
  /** Replace every per-repo field with `slice` (activating a tab). Total write
   *  by contract — see repoSlice.ts. */
  hydrate: (slice: RepoSlice) => void;
  /** Freeze the live per-repo fields (leaving a tab). */
  snapshot: () => RepoSlice;
  /** Put an error back on the banner. Needed because a rollback (a failed open
   *  re-activating the tab you were on) runs a `refreshAll`, which clears
   *  `error` as its first act — same hazard as the refresh-first-error-last
   *  convention in the catch arms. */
  setError: (e: AppError | null) => void;
  /**
   * Run a backend commit-log search. An empty filter clears the search and
   * falls back to the full log. Sets `searchResults` + `commitFilter`.
   */
  searchCommits: (filter: LogFilter) => Promise<void>;
  /**
   * Append the next page to whichever log list is active (#68 G11). No-op at
   * the end of history or while a page is already in flight.
   */
  loadMoreCommits: () => Promise<void>;
  /**
   * Scope the commit log to `refspec` (null = HEAD) and reload it. An active
   * search is re-run under the new scope. Errors (e.g. InvalidRef) are set on
   * the store; the previous list is kept.
   */
  setLogRef: (refspec: string | null) => Promise<void>;
  /**
   * Re-read everything about the repository.
   *
   * Clears `error` first, because a refresh the USER asked for means "show me
   * where things stand now" and a stale banner from a previous action is not
   * that. A BACKGROUND refresh must pass `preserveError` — see
   * `RefreshOptions`.
   */
  refreshAll: (opts?: RefreshOptions) => Promise<void>;
  /**
   * Lightweight refresh for index-only mutations (stage/unstage/discard and
   * the hunk ops): re-fetches just `status` + `repoState`, skipping the full
   * branch/tag/stash/remote enumeration and the ≤500-commit log walk that
   * `refreshAll` does but that these ops can't change.
   */
  refreshStatus: (opts?: RefreshOptions) => Promise<void>;
  /**
   * Undo (or redo) the last recorded operation (#242).
   *
   * Re-checks preconditions against the BACKEND first — `head_info` and a
   * fresh status, never `s.commits`, which is only a prefix of history. On a
   * mismatch it refuses with a message naming the operation, and changes
   * nothing.
   *
   * Does NOT confirm, for the same reason `deleteUntracked` does not: this is
   * the layer a keyboard shortcut reaches. `undoOp`/`redoOp` in ops.ts own the
   * `pgConfirm` for the hard kinds — and the preconditions are re-checked
   * HERE, after that dialog has been answered, because the world can move
   * while it is open.
   */
  applyUndo: (direction: UndoDirection) => Promise<void>;
  refreshAllFiles: () => Promise<void>;
  /**
   * List every file in the tree at `revspec` (commit/branch/tag/revspec).
   * Returns the file list, or null on failure (error is set on the store).
   */
  listFilesAtRev: (revspec: string) => Promise<FileStatus[] | null>;
  /**
   * Read a file's content from the tree at `revspec`.
   *
   * `null` means one of two things, and the caller cannot tell them apart from
   * the value alone: that tree holds no text at that path (absent, a directory,
   * a submodule gitlink — a STATE since #146, nothing set on the store), or the
   * read failed and `error` is now set. Both render the same empty pane, which
   * is why one sentinel is enough here; read `error` if you need to distinguish.
   */
  readFileContentAtRev: (
    revspec: string,
    path: string,
  ) => Promise<FileContent | null>;
  clearError: () => void;
  closeRepo: () => void;
  stage: (paths: string[]) => Promise<void>;
  unstage: (paths: string[]) => Promise<void>;
  discard: (paths: string[]) => Promise<void>;
  /**
   * Delete untracked files outright (#245).
   *
   * A different op from `discard`, not a nicer name for it: discard restores a
   * tracked path from the index, and this refuses one. Callers must therefore
   * confirm first (`pgConfirm`) — the store does not, because it is also the
   * layer a keyboard shortcut would reach.
   */
  deleteUntracked: (paths: string[]) => Promise<void>;
  stageHunk: (path: string, hunkIndex: number) => Promise<void>;
  unstageHunk: (path: string, hunkIndex: number) => Promise<void>;
  discardHunk: (path: string, hunkIndex: number) => Promise<void>;
  /**
   * Line-level staging (#61 D7). `selected` holds indices among the hunk's
   * changed (`+`/`-`) lines counted from 0, not indices into `hunk.lines`.
   */
  stageLines: (path: string, hunkIndex: number, selected: number[]) => Promise<void>;
  unstageLines: (path: string, hunkIndex: number, selected: number[]) => Promise<void>;
  discardLines: (path: string, hunkIndex: number, selected: number[]) => Promise<void>;
  commit: (
    message: string,
    amend?: boolean,
    signoff?: boolean,
    /** "Commit as" — null uses the repo config identity. */
    authorOverride?: AuthorOverride | null,
    /** Sign this commit (#61 D6). null follows commit.gpgsign. */
    sign?: boolean | null,
    /** Skip every commit-side hook for this commit only (#232). */
    noVerify?: boolean,
  ) => Promise<CommitResult | null>;
  /** Dismiss the hook refusal on display (#232). */
  clearHookRejection: () => void;
  /**
   * Dismiss the "no committer identity" prompt (#212). Called after the
   * identity is saved, and by the prompt's own Dismiss.
   */
  clearNoSignature: () => void;
  reset: (target: string, mode: ResetMode) => Promise<void>;
  checkoutBranch: (name: string) => Promise<void>;
  checkoutRef: (reference: string) => Promise<void>;
  createBranch: (name: string, from?: string) => Promise<void>;
  /**
   * Create a branch and switch to it. When the worktree is dirty and
   * `autoStash` is true, stashes before checkout and pops the stash after.
   * Returns true on success, false on any failure (error is set on the store).
   */
  createAndSwitchBranch: (
    name: string,
    opts?: { from?: string; autoStash?: boolean },
  ) => Promise<boolean>;
  deleteBranch: (name: string, force?: boolean) => Promise<void>;
  /**
   * Delete several local branches, refreshing ONCE (#244). Best-effort: two
   * refs that refuse do not decide the fate of the other six, so the report
   * names both halves — see `summarizeDeleteMerged`.
   */
  deleteBranches: (
    names: readonly string[],
  ) => Promise<{ deleted: string[]; failed: string[] }>;
  renameBranch: (from: string, to: string) => Promise<void>;
  /** Set (`"origin/main"`) or clear (`null`) a local branch's upstream. */
  setUpstream: (branch: string, upstream: string | null) => Promise<void>;
  mergeBranch: (name: string) => Promise<void>;
  rebaseOnto: (upstream: string) => Promise<void>;
  createTag: (name: string, target: TagTarget) => Promise<void>;
  deleteTag: (name: string) => Promise<void>;
  pushTag: (remote: string, name: string) => Promise<void>;
  pushDeleteBranch: (remote: string, name: string) => Promise<void>;
  cherryPick: (oid: string) => Promise<void>;
  cherryPickMany: (oids: string[]) => Promise<void>;
  revert: (oid: string) => Promise<void>;
  stashSave: (opts: StashSaveOptions) => Promise<string | null>;
  /**
   * Stash only `paths` (#133). `null` when git found nothing to save under that
   * pathspec — a state, not a failure.
   */
  stashSavePaths: (
    opts: StashSaveOptions,
    paths: string[],
  ) => Promise<string | null>;
  /** Rename the entry at `index` (#133). Re-reads the list; see the action. */
  stashRename: (index: number, oid: string, message: string) => Promise<void>;
  stashApply: (index: number) => Promise<void>;
  stashPop: (index: number) => Promise<void>;
  /**
   * Drop a stash entry. `oid` is required and verified backend-side: an index
   * is a reflog POSITION, so a stale one drops a stash nobody picked (#133).
   */
  stashDrop: (index: number, oid: string) => Promise<void>;
  stashBranch: (index: number, branch: string) => Promise<void>;
  // network
  fetch: (remote: string) => Promise<void>;
  fetchAll: () => Promise<void>;
  /**
   * `git fetch --unshallow` — fetch the history a shallow clone left behind
   * (#255). A no-op on a repository that is already complete.
   */
  unshallow: () => Promise<void>;
  pull: (remote: string, branch: string, mode?: PullMode) => Promise<void>;
  /**
   * Fetch a branch's remote and advance the branch to its upstream (#246).
   *
   * The op `pull` cannot be: `git pull <remote> <branch>` merges the fetched
   * head into whatever HEAD is, so it never advanced the branch it named.
   *
   * **The branch that IS HEAD is routed to `pull` with the user's own
   * `defaultPullMode`** — it needs a working-tree update, and a user who chose
   * Rebase must not be quietly given `--ff-only`. Every other branch has its ref
   * moved, and a divergence comes back as a `NotFastForward` banner rather than
   * a surprise merge.
   *
   * Answers the outcome so a caller can say what happened (the ref moved, or it
   * was already current); `null` when it routed to pull or failed.
   */
  fastForwardBranch: (name: string) => Promise<FastForward | null>;
  /**
   * `fastForwardBranch` for every local branch that can be, on one fetch (#246).
   *
   * Answers the report — advanced, diverged, checked-out — so the caller can
   * summarize it; `null` when it failed (the banner already says why). The
   * checked-out branch is REPORTED, never pulled: a bulk button must not rewrite
   * the working tree.
   */
  fastForwardAllBranches: () => Promise<BulkFastForward | null>;
  push: (
    remote: string,
    branch: string,
    force?: PushForce,
    /** Skip `pre-push` for this push only (#232). */
    noVerify?: boolean,
  ) => Promise<void>;
  /**
   * Stop every network op running on this repository (#234) — the way out of a
   * fetch, pull or push that has stalled, which used to be force-quit.
   *
   * Repository-wide and not per op: the auto-fetch timer stacks fetches behind a
   * stalled one, and those are ops the user never started and cannot point at.
   * The ops themselves clean up — each returns `Cancelled`, which
   * `setErrorFor` drops and each `finally` clears the spinner for.
   */
  cancelNetworkOps: () => Promise<void>;
  // remote management
  addRemote: (name: string, url: string) => Promise<void>;
  removeRemote: (name: string) => Promise<void>;
  renameRemote: (from: string, to: string) => Promise<void>;
  setRemoteUrl: (name: string, url: string) => Promise<void>;
  pruneRemote: (name: string) => Promise<void>;
  // conflict resolution
  acceptOurs: (path: string) => Promise<void>;
  acceptTheirs: (path: string) => Promise<void>;
  markResolved: (paths: string[]) => Promise<void>;
  abortOperation: () => Promise<void>;
  continueOperation: () => Promise<string | null>;
  runMergetool: (path: string) => Promise<void>;
  restartConflict: (path: string) => Promise<void>;
  // interactive rebase
  rebaseStart: (plan: RebaseStep[]) => Promise<RebaseStatus | null>;
  rebaseContinue: () => Promise<RebaseStatus | null>;
  rebaseAbort: () => Promise<void>;
  /** Drop the backend's retained completed-rebase summary once it's been shown. */
  rebaseAcknowledge: () => Promise<void>;
  // bisect (#93)
  /** `good` may be empty — git then waits for a good revision. */
  bisectStart: (bad: string, good?: string[]) => Promise<void>;
  /** Mark `rev` (default HEAD) and let git pick the next revision to test. */
  bisectMark: (mark: BisectMark, rev?: string | null) => Promise<void>;
  /**
   * `git bisect reset`. NOT `abortOperation`, whose hard reset to HEAD would
   * strand the user on the detached commit they were last testing.
   */
  bisectReset: () => Promise<void>;
  appendGitignore: (pattern: string) => Promise<void>;
  openInEditor: (relativePath: string) => Promise<void>;
  /**
   * Open `paths` in the user's own diff tool (#235).
   *
   * `paths` is a list because a rename has two of them — pass
   * `[oldPath, newPath]` so git can pair them; one path is the ordinary case.
   * Resolves when the TOOL exits, which can be minutes, so this holds a
   * `difftool` activity entry for the whole time.
   */
  openInDifftool: (target: DiffToolTarget, paths: string[]) => Promise<void>;
  /** Reveal in the OS file manager; omitted reveals the repo root (#215). */
  revealInFileManager: (relativePath?: string) => Promise<void>;
  /** Open a terminal at the containing directory; omitted uses the repo root. */
  openInTerminal: (relativePath?: string) => Promise<void>;
}

/**
 * Set or clear one activity entry, for `repoId` only (#296).
 *
 * Module-level rather than a closure inside `create()` because `withAuthRetry`
 * — which owns the indicator for every network op — is module-level too.
 *
 * **Guarded on the repository, like `setFor`.** `activity` lives in the
 * per-repo slice, and an op outlives a tab switch: a fetch on A that finished
 * after the user moved to B used to clear B's entry, taking B's own spinner and
 * Cancel button with it. Same reasoning, same guard — the write belongs to the
 * repository that asked for it, not to whichever tab happens to be open.
 * `frozenSlice` handles the other half by clearing `activity` on the way out.
 *
 * A label change on a live entry KEEPS its `startedAt`: pull's stash → pull →
 * pop sequence is three labels but one wait, and restarting the clock at each
 * would make the elapsed readout useless exactly when it matters. It clears
 * `phase`/`percent` though: those describe the transfer the previous label
 * named, and carrying a stale bar into the next phase is worse than no bar.
 */
export function setActivity(repoId: string, key: ActivityKey, label: string | null) {
  useRepoStore.setState((s) => {
    if (s.current?.id !== repoId) return {};
    const next = { ...s.activity };
    if (label === null) delete next[key];
    else next[key] = { label, startedAt: next[key]?.startedAt ?? Date.now() };
    // The one place `cancelRequested` is dropped (#263). An op's `finally`
    // clears its own label and nothing else; when the LAST one goes, the ops
    // that cancel was aimed at have all unwound, so the next click starts a
    // fresh SIGTERM-then-SIGKILL escalation rather than inheriting the previous
    // one's second-click state — which would send SIGKILL to a git that had
    // never been asked politely.
    return Object.keys(next).length === 0
      ? { activity: next, cancelRequested: false }
      : { activity: next };
  });
}

/**
 * Register `work` as a named backend read for as long as it runs (#296 gap 8).
 *
 * Returns `work` unchanged, so it drops into an existing `Promise.all` without
 * restructuring the call — which is the point: ten reads become ten named reads
 * by wrapping each one, and a read added later that skips this is simply absent
 * from the popover rather than breaking it.
 *
 * NOT `async`: the task has to be registered synchronously, before the first
 * suspension point, or a `Promise.all` of ten reads would register them one
 * microtask apart and the "longest-running" pick would be meaningless.
 *
 * Both ends are guarded on the repository, like `setFor` and `setActivity`: a
 * read issued against a tab the user has since left must not add — or remove —
 * a row describing the tab they are looking at now.
 */
export function trackLoad<T>(
  repoId: string,
  id: string,
  label: string,
  work: Promise<T>,
): Promise<T> {
  useRepoStore.setState((s) => {
    if (s.current?.id !== repoId) return {};
    // Replace rather than append when the id is already present: two refreshes
    // can overlap, and the same read counted twice would inflate the "+ N
    // others" count with work that is not actually separate.
    const rest = s.loadingTasks.filter((t) => t.id !== id);
    return { loadingTasks: [...rest, { id, label, startedAt: Date.now() }] };
  });
  return work.finally(() => {
    useRepoStore.setState((s) => {
      if (s.current?.id !== repoId) return {};
      if (!s.loadingTasks.some((t) => t.id === id)) return {};
      return { loadingTasks: s.loadingTasks.filter((t) => t.id !== id) };
    });
  });
}

/** Which activity entry a `net://progress` tick drives. */
const NET_OP_KEY: Record<NetProgress["op"], ActivityKey> = {
  Fetch: "fetch",
  Pull: "pull",
  Push: "push",
};

/**
 * Apply one `net://progress` tick to the indicator already on screen (#296).
 *
 * Two guards, both load-bearing:
 *
 * - **The repository must still be the open one.** The event is app-global; a
 *   fetch running on a background tab would otherwise drive the active tab's bar.
 * - **The entry must already exist.** A tick that arrives after the op finished
 *   (they are in flight when the process exits) must not resurrect a cleared
 *   indicator, which would leave a Cancel button over nothing.
 */
export function applyNetProgress(p: NetProgress) {
  const key = NET_OP_KEY[p.op];
  useRepoStore.setState((s) => {
    if (s.current?.id !== p.repoId) return {};
    const live = s.activity[key];
    if (!live) return {};
    return {
      activity: { ...s.activity, [key]: { ...live, phase: p.phase, percent: p.percent } },
    };
  });
}

/**
 * Apply one `rebase://progress` tick (#296).
 *
 * Relabels the `rebase` entry rather than writing `rebaseStatus`: the status is
 * the backend's to report when the replay ends or pauses, and a second writer
 * would race that. The percentage is steps, not bytes — which is the honest unit
 * for a rebase, where one step can take far longer than another.
 */
export function applyRebaseProgress(p: RebaseProgress) {
  useRepoStore.setState((s) => {
    if (s.current?.id !== p.repoId) return {};
    const live = s.activity.rebase;
    if (!live) return {};
    const step = p.nextIndex + 1;
    const what = p.subject || p.shortOid;
    return {
      activity: {
        ...s.activity,
        rebase: {
          ...live,
          label: `Rebasing ${step} of ${p.total}: ${what}`,
          percent: p.total > 0 ? Math.round((p.nextIndex / p.total) * 100) : undefined,
        },
      },
    };
  });
}

/**
 * Run a network op; on an authentication failure, raise a credential challenge
 * whose retry re-runs the SAME op with credentials (#61 D5).
 *
 * Exported since #93: `git submodule update` and `git lfs fetch/pull` are network
 * ops owned by their own feature stores, and they must use THIS credential flow
 * rather than a second one — a private copy would raise a challenge the shared
 * `CredentialDialog` does not answer.
 *
 * The first attempt is always prompt-less, so the common case (a credential
 * helper or ssh-agent already answers) behaves exactly as it did before. A
 * cancelled dialog never calls `onError`, leaving the original error already
 * reported by the caller's own catch.
 *
 * Exported so a network op owned by ANOTHER feature store can reuse it rather
 * than growing a second retry path — `useForgeStore.checkout` fetches a pull
 * request's head ref, which needs a git-transport credential exactly like
 * fetch/pull/push/pushTag do (#92). Keep it the only implementation.
 *
 * **`activity` is why this function, and not its callers, owns the indicator
 * (#296).** This resolves the moment it RAISES a challenge — it does not await
 * the retry, which runs later from the dialog's callback. So a caller that set
 * a label before calling and cleared it in a `finally` cleared it while the user
 * was still typing their password, and the retried push — the slower attempt, by
 * definition — then ran with no spinner, no status line and no Cancel button.
 * Passing the label here instead makes every attempt carry its own indicator,
 * and makes it impossible for a network op added later to forget.
 */
export async function withAuthRetry(
  repoId: string,
  run: (creds?: Credentials) => Promise<void>,
  onError: (e: unknown) => void | Promise<void>,
  activity?: { key: ActivityKey; label: string },
): Promise<void> {
  /** One attempt, wrapped in its own indicator. */
  const attempt = async (creds?: Credentials) => {
    if (!activity) return run(creds);
    setActivity(repoId, activity.key, activity.label);
    try {
      await run(creds);
    } finally {
      setActivity(repoId, activity.key, null);
    }
  };
  try {
    await attempt();
    return;
  } catch (e) {
    if (!isAuthError(e)) {
      await onError(e);
      return;
    }
    const { host, kind } = e.message;
    useAuthStore.getState().raise({
      host,
      kind,
      retry: async (creds, remember) => {
        try {
          await attempt(creds);
          // Only after it worked: storing on submit would persist a typo.
          // HTTPS only: `git credential approve` stores an HTTP(S) password, so
          // remembering an SSH passphrase there would file the wrong secret
          // under `protocol=https` for this host and offer it at the next HTTPS
          // prompt. SSH passphrases belong to ssh-agent, which we do not manage.
          // `creds` is optional now (#248: an SSH retry carries none), and
          // there is nothing to remember when nothing was typed.
          if (remember && host && creds && kind === "Https") {
            await rememberCredential(repoId, host, creds).catch(() => {
              // No helper configured is not a failure the user needs to see —
              // the operation they asked for still succeeded.
            });
          }
        } catch (retryError) {
          await onError(retryError);
        }
      },
    });
  }
}

export const useRepoStore = create<RepoStoreState>((set, get) => {
  /**
   * Apply `patch` only while `repoId` is still the open repository (#90).
   *
   * A tab switch is atomic, but the fetches already in flight are not: a
   * `refreshAll` for repo A can resolve after the user moved to B and would
   * write A's status, log and branches into B's slice. This is the same
   * staleness guard `logRef` and `commitFilter` already carry, on repo identity.
   */
  const setFor = (repoId: string, patch: Partial<RepoStoreState>) => {
    if (get().current?.id !== repoId) return;
    set(patch);
  };
  /** `setFor` for the error banner: a failure in a repository you have left
   *  must not raise a banner over the one you are in. Keeps the
   *  refresh-first-error-last ordering — it is still just a guarded set.
   *
   *  Also the one place a cancellation is dropped (#234). Every network op ends
   *  in one of these, and a cancel is the outcome the user ASKED for — routing
   *  it to the banner would answer their Cancel click with a red error. Filtered
   *  here rather than in each catch arm so a network op added later cannot
   *  forget: there are seven call sites and they would not stay in step. */
  const setErrorFor = (repoId: string, e: unknown) => {
    if (get().current?.id !== repoId) return;
    if (isCancelledError(e)) return;
    set({ error: toAppError(e) });
  };

  /** Where HEAD is according to the last refresh, or null if it is unborn. */
  const headSnapshot = (): HeadSnapshot | null => {
    const h = get().headInfo;
    return h?.headOid ? { ref: h.branch, oid: h.headOid } : null;
  };

  /**
   * Record an operation that moved HEAD (#242).
   *
   * Called AFTER the op's `refreshAll()`, so `headInfo` is the new position —
   * and guarded on the repository the way `setErrorFor` is, because an op that
   * resolves after a tab switch must not push an entry onto the wrong stack.
   *
   * `pushUndo` drops an entry whose before and after are identical, so a
   * checkout of the branch you are already on records nothing rather than an
   * entry ⌘Z would appear to apply and then not.
   */
  const noteUndo = (
    repoId: string,
    kind: UndoKind,
    label: string,
    before: HeadSnapshot | null,
  ) => {
    if (!before) return;
    if (get().current?.id !== repoId) return;
    const after = headSnapshot();
    if (!after) return;
    undoSeq += 1;
    set(
      pushUndo(
        { undoStack: get().undoStack, undoCursor: get().undoCursor },
        { id: `undo-${undoSeq}`, kind, label, before, after },
      ),
    );
  };
  // `setActivity` is the module-level one above — shared with `withAuthRetry`,
  // which owns the indicator for every op that can raise a credential challenge.
  /**
   * Open `path` into a freshly reset slice. Throws on failure.
   *
   * Answers null WITHOUT writing anything when the open turned out to be
   * unwanted by the time it resolved. `open_repo` mints a fresh `RepoId` per
   * call and only `close_repo` ever removes one, so two opens in flight at once
   * (a session restore racing a `pgit <path>` launch intent, #177) are two live
   * `git2::Repository`s of which exactly one is wanted. Whichever RESOLVED last
   * used to win `current` regardless of which was asked for last — so the
   * loser's handle became the store's open repository and was then evicted by
   * the tab layer, leaving every later call answering `UnknownRepo` for the rest
   * of the session with no banner to explain it (the diff pane silently dead,
   * because `useLazyVerification` swallows its half).
   *
   * The guard sits BEFORE the first write on purpose: adopting first and
   * cleaning up afterwards is exactly what made the orphan reachable.
   */
  const applyOpenedRepo = async (
    path: string,
    stillWanted: () => boolean,
  ): Promise<RepoHandle | null> => {
    const handle = await openRepo(path);
    if (!stillWanted()) {
      // Nobody will ever use this handle and `open` never evicts on its own, so
      // close it here — this is the only moment at which it is both known to be
      // unwanted and still known at all.
      void closeRepoIpc(handle.id).catch(() => {});
      return null;
    }
    useRecentsStore.getState().addRecent(handle.path);
    // Total write: every per-repo field is reset, so nothing of the previously
    // open repository can survive into this one (see repoSlice.ts).
    set({ ...emptySlice(), current: handle });
    await get().refreshAll();
    return handle;
  };
  return ({
  ...emptySlice(),

  async openRepoAt(path, stillWanted) {
    set({ loading: true, error: null });
    try {
      // The handle THIS call opened, never `get().current`: a superseded open
      // resolves with the winner's repository sitting in `current`, and handing
      // that back would have the caller evict the live repository as if it were
      // the abandoned one (#177).
      return await applyOpenedRepo(path, stillWanted);
    } catch (e) {
      // git refuses a repository owned by another user, which a Windows drive
      // mounted under WSL routinely looks like. That refusal is remediable,
      // and handling it here rather than per-screen covers Welcome, recents,
      // the CLI launch and the palette at once.
      if (isDubiousOwnershipError(e)) {
        // Trust what the backend named — it canonicalised the path, and
        // safe.directory matching is exact.
        const target = dubiousOwnershipPath(e) ?? path;
        if (await confirmTrust(target)) {
          try {
            await trustRepoPath(target);
            // Deliberately not recursive: one retry. If the exception did not
            // help, show the error rather than asking again forever.
            return await applyOpenedRepo(path, stillWanted);
          } catch (retryError) {
            set({ loading: false, error: toAppError(retryError) });
            return null;
          }
        }
      }
      // A failed open leaves the slice alone: whatever tab the user was on is
      // still there with its data, and only `loading`/`error` moved.
      set({ loading: false, error: toAppError(e) });
      return null;
    }
  },

  hydrate(slice) {
    // Total write, never a patch — that is the whole anti-leak contract.
    set(slice);
  },

  snapshot() {
    return sliceOf(get());
  },

  setError(e) {
    set({ error: e });
  },

  async searchCommits(filter) {
    const repo = get().current;
    if (!repo) return;
    // Empty filter → clear the search, fall back to full log.
    if (isFilterEmpty(filter)) {
      // Dropping the search hands the list back to `commits`, whose own cursor
      // was never touched — so "load more" resumes the unfiltered walk.
      set({
        searchResults: null,
        commitFilter: {},
        searching: false,
        searchCursor: null,
      });
      return;
    }
    set({ commitFilter: filter, searching: true });
    const refspec = get().logRef;
    try {
      const page = await trackLoad(
        repo.id,
        "search",
        "searching commits",
        getLogFilteredPage(repo.id, filter, null, PAGE_SIZE, refspec),
      );
      // Guard against a stale response overwriting a newer filter or scope.
      if (get().commitFilter !== filter || get().logRef !== refspec) return;
      setFor(repo.id, {
        searchResults: page.commits,
        searchCursor: page.nextCursor,
        searching: false,
      });
    } catch (e) {
      setFor(repo.id, { searching: false, error: toAppError(e) });
    }
  },

  async loadMoreCommits() {
    const { current, searchResults, searchCursor, commitCursor, loadingMore } = get();
    const searching = searchResults !== null;
    const cursor = searching ? searchCursor : commitCursor;
    // Re-entry guard: History's window can ask for more several times before
    // the first page resolves.
    if (!current || !cursor || loadingMore) return;

    const refspec = get().logRef;
    const filter = get().commitFilter;
    set({ loadingMore: true });
    try {
      const page = searching
        ? await getLogFilteredPage(current.id, filter, cursor, PAGE_SIZE, refspec)
        : await getLogPage(current.id, cursor, PAGE_SIZE, refspec);
      // The list may have been replaced while the page was in flight (repo
      // switch, ref change, new search) — dropping a stale page is correct.
      // A repo switch also invalidates the page: `current` is the repo this
      // walk belongs to, not necessarily the one now open.
      if (get().current?.id !== current.id || get().logRef !== refspec) return;
      if (searching) {
        if (get().commitFilter !== filter || get().searchResults === null) return;
        set((s) => ({
          searchResults: [...(s.searchResults ?? []), ...page.commits],
          searchCursor: page.nextCursor,
        }));
      } else {
        if (get().searchResults !== null) return;
        set((s) => ({
          commits: [...s.commits, ...page.commits],
          commitCursor: page.nextCursor,
        }));
      }
    } catch (e) {
      setErrorFor(current.id, e);
    } finally {
      set({ loadingMore: false });
    }
  },

  async setLogRef(refspec) {
    const repo = get().current;
    if (!repo) {
      set({ logRef: refspec });
      return;
    }
    set({ logRef: refspec, loading: true, error: null });
    try {
      const page = await trackLoad(
        repo.id,
        "log",
        "loading history",
        getLogPage(repo.id, null, PAGE_SIZE, refspec),
      );
      // Guard against a stale response overwriting a newer scope.
      if (get().logRef !== refspec) return;
      setFor(repo.id, {
        commits: page.commits,
        commitCursor: page.nextCursor,
        loading: false,
      });
      // Re-run an active search under the new scope.
      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      if (get().logRef !== refspec) return;
      setFor(repo.id, { loading: false, error: toAppError(e) });
    }
  },

  async refreshAll(opts) {
    const repo = get().current;
    if (!repo) return;
    set({ loading: true, ...(opts?.preserveError ? {} : { error: null }) });
    const logRef = get().logRef;
    try {
      const [
        status,
        branches,
        tags,
        stashes,
        remotes,
        commitPage,
        repoState,
        rebaseStatus,
        bisectStatus,
        headInfo,
        shallow,
      // Each read is named while it runs (#296 gap 8), so a refresh that takes
      // nine seconds can say WHICH of the ten is holding it up instead of
      // showing one undifferentiated "syncing…". The wrappers are the only
      // change here — every promise is the same promise it always was.
      ] = await Promise.all([
          trackLoad(repo.id, "status", "reading status", getStatus(repo.id)),
          trackLoad(repo.id, "branches", "listing branches", listBranches(repo.id)),
          trackLoad(repo.id, "tags", "listing tags", listTags(repo.id)),
          trackLoad(repo.id, "stashes", "listing stashes", listStashes(repo.id)),
          trackLoad(repo.id, "remotes", "fetching remotes", listRemotes(repo.id)),
          trackLoad(
            repo.id,
            "log",
            "loading history",
            getLogPage(repo.id, null, PAGE_SIZE, logRef).catch((e) => {
              // The browsed ref may have vanished since it was selected (e.g.
              // the branch was deleted) — fall back to HEAD instead of failing
              // the whole refresh.
              if (logRef === null) throw e;
              setFor(repo.id, { logRef: null });
              return getLogPage(repo.id, null, PAGE_SIZE);
            }),
          ),
          trackLoad(repo.id, "repoState", "reading repository state", repoStateFn(repo.id)),
          trackLoad(repo.id, "rebase", "reading rebase state", rebaseStatusFn(repo.id)),
          // Degrades instead of failing the refresh. `bisect_status` shells out to
          // `git rev-list --bisect-vars` for its progress numbers, and a repository
          // where that cannot run must still show its status, branches and log —
          // the same reasoning as the browsed-ref fallback above. The cost of the
          // fallback is a bar without step counts, not a broken screen.
          trackLoad(
            repo.id,
            "bisect",
            "reading bisect state",
            bisectStatusFn(repo.id).catch(() => DEFAULT_BISECT_STATUS),
          ),
          // Same degrade-don't-fail policy: the window title (#217) falls back
          // to just the repo name rather than losing the whole refresh.
          trackLoad(
            repo.id,
            "head",
            "reading HEAD",
            headInfoFn(repo.id).catch(() => null),
          ),
          // Re-read on every refresh, not once on open (#255): a fetch, an
          // unshallow here, or a `git fetch --unshallow` in a terminal all
          // change the answer, and the truncation notices have to come DOWN
          // when the history arrives. Same degrade-don't-fail policy as its
          // neighbours — a repository whose shallow state cannot be read must
          // still show its log.
          trackLoad(
            repo.id,
            "shallow",
            "reading clone depth",
            shallowInfoFn(repo.id).catch(() => DEFAULT_SHALLOW_INFO),
          ),
        ]);
      setFor(repo.id, {
        status,
        branches,
        tags,
        stashes,
        remotes,
        commits: commitPage.commits,
        // A refresh restarts the walk, so the old resume point is void.
        commitCursor: commitPage.nextCursor,
        repoState,
        rebaseStatus,
        bisectStatus,
        headInfo,
        shallowInfo: shallow,
        loading: false,
        // Only on the success path, and never reset (#368): a refresh that
        // could not read status has not loaded one, and a LATER refresh must
        // not un-answer "have we read this repository?" — that is what made
        // the commit panel flicker when it asked `loading` instead.
        statusLoaded: true,
      });
      // Keep an active search in sync with the refreshed history.
      const activeFilter = get().commitFilter;
      if (!isFilterEmpty(activeFilter)) {
        void get().searchCommits(activeFilter);
      }
    } catch (e) {
      setFor(repo.id, { loading: false, error: toAppError(e) });
    }
  },

  async refreshStatus(opts) {
    const repo = get().current;
    if (!repo) return;
    if (!opts?.preserveError) set({ error: null });
    try {
      // `bisect_status` joins the pair here because the operation bar's bisect
      // actions must stay live after an index op too. The backend short-circuits
      // on a single `Path::exists()`, so this is free unless a bisect is open.
      const [status, repoState, bisectStatus] = await Promise.all([
        getStatus(repo.id),
        repoStateFn(repo.id),
        // Same degrade-don't-fail policy as `refreshAll`.
        bisectStatusFn(repo.id).catch(() => DEFAULT_BISECT_STATUS),
      ]);
      // `statusLoaded` for the same reason `refreshAll` sets it (#368): this is
      // the other path that lands a status, and a repository whose first read
      // came from a stage/unstage is just as read as one that ran a full
      // refresh.
      setFor(repo.id, { status, repoState, bisectStatus, statusLoaded: true });
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  clearError() {
    set({ error: null });
  },

  closeRepo() {
    // Total write via emptySlice(), so a later hydrate of another tab starts
    // from a genuinely empty slice rather than this repo's leftovers.
    set(emptySlice());
  },

  async refreshAllFiles() {
    const repo = get().current;
    if (!repo) return;
    try {
      const allFiles = await listAllFiles(repo.id);
      setFor(repo.id, { allFiles });
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async listFilesAtRev(revspec) {
    const repo = get().current;
    if (!repo) return null;
    try {
      return await listFilesAtRevFn(repo.id, revspec);
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async readFileContentAtRev(revspec, path) {
    const repo = get().current;
    if (!repo) return null;
    try {
      return await readFileContentAtRevFn(repo.id, revspec, path);
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async stage(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stagePaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async unstage(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstagePaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async discard(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardPaths(repo.id, paths);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async deleteUntracked(paths) {
    const repo = get().current;
    if (!repo || !paths.length) return;
    try {
      const failed = await deleteUntrackedFilesFn(repo.id, paths);
      // Refresh BEFORE reporting, on the success path as much as in the catch
      // arm: the delete is best-effort, so "some of these are gone" is a
      // partial outcome and the list has to show which ones before the banner
      // talks about the rest.
      await get().refreshStatus();
      if (failed.length) {
        const detail = failed.map((f) => `${f.path} (${f.reason})`).join("; ");
        setErrorFor(repo.id, {
          kind: "Io",
          message: `could not delete ${failed.length} file${
            failed.length === 1 ? "" : "s"
          }: ${detail}`,
        });
      }
    } catch (e) {
      // A danger op: refreshAll() FIRST, the error LAST. The backend refuses a
      // batch before deleting anything, but a rejection can also come from a
      // dropped IPC call mid-flight — the UI must show what is actually on disk
      // before it explains itself.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    }
  },

  // Hunk ops pass the same diffContextLines the viewers used for getDiff so
  // the backend recomputes an identical hunk list — indices stay aligned.
  async stageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stageHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async unstageHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstageHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async discardHunk(path, hunkIndex) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardHunk(repo.id, path, hunkIndex, useSettingsStore.getState().diffContextLines);
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stageLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stageLinesFn(
        repo.id,
        path,
        hunkIndex,
        selected,
        useSettingsStore.getState().diffContextLines,
      );
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async unstageLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await unstageLinesFn(
        repo.id,
        path,
        hunkIndex,
        selected,
        useSettingsStore.getState().diffContextLines,
      );
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async discardLines(path, hunkIndex, selected) {
    const repo = get().current;
    if (!repo) return;
    try {
      await discardLinesFn(
        repo.id,
        path,
        hunkIndex,
        selected,
        useSettingsStore.getState().diffContextLines,
      );
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async reset(target, mode) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    try {
      await resetFn(repo.id, target, mode);
      await get().refreshAll();
      noteUndo(repo.id, "reset", `${mode.toLowerCase()} reset to ${shortOid(target)}`, before);
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async commit(
    message,
    amend = false,
    signoff = false,
    authorOverride = null,
    sign = null,
    noVerify = false,
  ) {
    const repo = get().current;
    if (!repo) return null;
    // Clear the previous refusal first: a stale block sitting above a fresh
    // attempt reads as though the new attempt failed too.
    setFor(repo.id, { hookRejection: null, noSignature: false });
    const before = headSnapshot();
    try {
      const result = await commitFn(
        repo.id,
        message,
        amend,
        signoff,
        authorOverride,
        sign,
        noVerify,
      );
      await get().refreshAll();
      // An AMEND replaces the tip rather than adding one, so undoing it puts
      // the ORIGINAL commit back — which is exactly what before/after already
      // describes, with no special case needed.
      noteUndo(
        repo.id,
        "commit",
        amend ? "amend" : `commit ${quoteSubject(message)}`,
        before,
      );
      return result;
    } catch (e) {
      // A hook refusal is NOT a banner error. Its output needs a surface that
      // scrolls, and the user is about to act on it in the panel rather than
      // dismiss it — so it lands in its own per-repo field.
      if (isAppError(e) && e.kind === "HookRejected") {
        // refreshAll regardless: a `pre-commit` hook may have reformatted and
        // restaged files before refusing, so the lists on screen are stale.
        await get().refreshAll();
        setFor(repo.id, { hookRejection: e.message as HookRejection });
        return null;
      }
      // Nor is a missing identity (#212). It is not a failure to report but a
      // question to answer, and the panel can answer it in place — so it gets
      // its own field rather than a banner, the same split the hook refusal
      // above makes. Nothing was created, so nothing needs refreshing.
      if (isNoSignatureError(e)) {
        setFor(repo.id, { noSignature: true });
        return null;
      }
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async applyUndo(direction) {
    const repo = get().current;
    if (!repo) return;
    const entry = direction === "undo" ? undoable(get()) : redoable(get());
    if (!entry) {
      pgFlash(direction === "undo" ? "Nothing to undo" : "Nothing to redo");
      return;
    }

    // Ask the BACKEND where HEAD is, rather than trusting the last refresh.
    // Something may have moved it since — a terminal, another window — and
    // this whole check exists to notice exactly that. `s.commits` is a prefix
    // of history and can never answer it.
    let headOid: string | null;
    try {
      headOid = (await headInfoFn(repo.id)).headOid;
      await get().refreshStatus();
    } catch (e) {
      setErrorFor(repo.id, e);
      return;
    }
    if (get().current?.id !== repo.id) return;

    const check = checkUndo(entry, direction, {
      headOid,
      dirty: get().status.length > 0,
    });
    if (!check.ok) {
      // A precondition refusal is not a backend error — nothing was attempted.
      // It must not become an `AppError`, whose union stays 1:1 with the Rust
      // enum; a frontend-only condition has no variant there and inventing one
      // would claim git refused something it was never asked.
      pgFlash(check.reason);
      return;
    }

    try {
      if (entry.kind === "checkout") {
        // Put HEAD back the way it was, on the branch it was on — not
        // detached at the same commit, which would look identical in the log
        // and be a different repository state.
        await checkoutRef(repo.id, check.target.ref ?? check.target.oid);
      } else {
        await resetFn(repo.id, check.target.oid, "Hard");
      }
      await get().refreshAll();
      set({
        undoCursor:
          direction === "undo" ? get().undoCursor - 1 : get().undoCursor + 1,
      });
    } catch (e) {
      await get().refreshAll();
      setErrorFor(repo.id, e);
    }
  },

  clearHookRejection() {
    const repo = get().current;
    if (!repo) return;
    setFor(repo.id, { hookRejection: null });
  },

  clearNoSignature() {
    const repo = get().current;
    if (!repo) return;
    setFor(repo.id, { noSignature: false });
  },

  async checkoutBranch(name) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    setActivity(repo.id, "branch", `Switching to ${name}…`);
    try {
      // Carry over uncommitted work automatically: stash → checkout → pop.
      // stashSave returns null when there's nothing to stash, so this is a
      // no-op on a clean tree. The client-side `status` can lag behind the
      // backend, so we always attempt the stash rather than gating on it.
      setActivity(repo.id, "branch", `Stashing changes…`);
      const stashed = await stashSave(repo.id, {
        message: `auto: switch to ${name}`,
        includeUntracked: true,
        keepIndex: false,
      });
      setActivity(repo.id, "branch", `Switching to ${name}…`);
      try {
        await checkoutBranch(repo.id, name);
      } catch (e) {
        // A branch another worktree is standing on is not a failure to report —
        // it is a question with two answers (#358). Anything else still is.
        const held = heldByWorktree(e);
        if (!held) throw e;
        const answer = await askAboutHeldBranch(held);
        if (answer !== "take") {
          // Declined. Give the auto-stash back BEFORE going anywhere, or the
          // user's uncommitted work is left in a stash they never made.
          if (stashed) {
            setActivity(repo.id, "branch", `Restoring stashed changes…`);
            await stashPop(repo.id, 0);
          }
          if (answer === "open") {
            // Imported here, not at the top: `useTabsStore` imports THIS module,
            // and a static edge back would close the cycle at module-eval time.
            const { useTabsStore } = await import("./useTabsStore");
            await useTabsStore.getState().openRepo(held.path);
          }
          // No banner: the user chose this, and refreshAll puts the UI back in
          // step with a repository nothing happened to.
          await get().refreshAll();
          return;
        }
        setActivity(repo.id, "branch", `Taking ${name} from ${held.worktree}…`);
        try {
          await checkoutBranch(repo.id, name, true);
        } catch (takeError) {
          // The backend re-validates, so the take can still be refused — a lock
          // or a rebase may have started over there since the dialog opened.
          // Hand the work back before reporting it, exactly as declining does;
          // unlike a decline this one DOES deserve a banner, so it rethrows.
          if (stashed) {
            setActivity(repo.id, "branch", `Restoring stashed changes…`);
            await stashPop(repo.id, 0);
          }
          throw takeError;
        }
      }
      if (stashed) {
        setActivity(repo.id, "branch", `Restoring stashed changes…`);
        await stashPop(repo.id, 0);
      }
      await get().refreshAll();
      noteUndo(repo.id, "checkout", `switch to ${name}`, before);
    } catch (e) {
      setErrorFor(repo.id, e);
      await get().refreshAll();
    } finally {
      setActivity(repo.id, "branch", null);
    }
  },

  async checkoutRef(reference) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    try {
      await checkoutRef(repo.id, reference);
      await get().refreshAll();
      noteUndo(repo.id, "checkout", `checkout of ${reference}`, before);
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async mergeBranch(name) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    try {
      await mergeBranchFn(repo.id, name);
      await get().refreshAll();
      noteUndo(repo.id, "merge", `merge of ${name}`, before);
    } catch (e) {
      // refreshAll clears `error` as its first act, so refresh before
      // recording the error — otherwise the two synchronous `set()` calls
      // land in the same React batch and the error is wiped before render.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    }
  },

  async rebaseOnto(upstream) {
    const repo = get().current;
    if (!repo) return;
    setActivity(repo.id, "rebase", `Rebasing onto ${upstream}…`);
    try {
      await rebaseOntoFn(repo.id, upstream);
      await get().refreshAll();
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    } finally {
      setActivity(repo.id, "rebase", null);
    }
  },

  // Tag push and remote-branch delete are pushes, so they get the same
  // challenge/retry as push/pull/fetch/clone. D5 threaded the four sites its
  // spec named and left these two on the credential-less path, where an
  // authenticated remote failed with git's stderr and no way to answer it.
  async pushTag(remote, name) {
    const repo = get().current;
    if (!repo) return;
    // These two are pushes, and a push to a slow remote is a wait like any other
    // (#296). Without an activity entry they were completely silent: no spinner,
    // no status line, and — because the status bar's Cancel is gated on one —
    // no way to stop a stalled one either.
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await pushTagFn(repo.id, remote, name, creds);
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
      { key: "push", label: `Pushing tag ${name}…` },
    );
  },

  async pushDeleteBranch(remote, name) {
    const repo = get().current;
    if (!repo) return;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await pushDeleteBranchFn(repo.id, remote, name, creds);
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
      { key: "push", label: `Deleting ${remote}/${name}…` },
    );
  },

  async createBranch(name, from) {
    const repo = get().current;
    if (!repo) return;
    try {
      await createBranch(repo.id, name, from);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async createAndSwitchBranch(name, opts) {
    const repo = get().current;
    if (!repo) return false;
    setActivity(repo.id, "branch", `Creating ${name}…`);
    try {
      await createBranch(repo.id, name, opts?.from);
    } catch (e) {
      setErrorFor(repo.id, e);
      setActivity(repo.id, "branch", null);
      await get().refreshAll();
      return false;
    }
    setActivity(repo.id, "branch", null);
    // checkoutBranch handles stash + checkout + pop and its own activity
    // labels. Any error surfaces via the store's `error` field.
    await get().checkoutBranch(name);
    return !get().error;
  },

  async deleteBranch(name, force = false) {
    const repo = get().current;
    if (!repo) return;
    try {
      await deleteBranch(repo.id, name, force);
    } catch (e) {
      setErrorFor(repo.id, e);
      return;
    }
    await get().refreshAll();
  },

  async deleteBranches(names) {
    const repo = get().current;
    if (!repo) return { deleted: [], failed: [] };
    const deleted: string[] = [];
    const failed: string[] = [];
    let firstError: unknown = null;
    for (const name of names) {
      try {
        await deleteBranch(repo.id, name);
        deleted.push(name);
      } catch (e) {
        failed.push(name);
        firstError ??= e;
      }
    }
    // Refresh FIRST, then report — the branch list must already match reality
    // by the time an error banner points at it.
    await get().refreshAll();
    if (firstError) setErrorFor(repo.id, firstError);
    return { deleted, failed };
  },

  async renameBranch(from, to) {
    const repo = get().current;
    if (!repo) return;
    try {
      await renameBranch(repo.id, from, to);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async setUpstream(branch, upstream) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setUpstreamFn(repo.id, branch, upstream);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async createTag(name, target) {
    const repo = get().current;
    if (!repo) return;
    try {
      await createTag(repo.id, name, target);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async deleteTag(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await deleteTag(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async cherryPick(oid) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    try {
      await cherryPick(repo.id, oid);
      await get().refreshAll();
      noteUndo(repo.id, "cherryPick", `cherry-pick of ${shortOid(oid)}`, before);
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    }
  },

  async cherryPickMany(oids) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    try {
      // Apply oldest→newest (the caller orders them). Each clean pick
      // auto-commits and moves HEAD; the next applies on top. A conflicting
      // pick throws (ConflictsDetected), stopping the sequence and leaving the
      // repo in a conflicted CherryPick state — which the operation bar then
      // announces. Refresh once at the end rather than per pick.
      for (const oid of oids) {
        await cherryPick(repo.id, oid);
      }
      await get().refreshAll();
      noteUndo(
        repo.id,
        "cherryPick",
        oids.length === 1
          ? `cherry-pick of ${shortOid(oids[0] ?? "")}`
          : `cherry-pick of ${oids.length} commits`,
        before,
      );
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    }
  },

  async revert(oid) {
    const repo = get().current;
    if (!repo) return;
    const before = headSnapshot();
    try {
      await revertFn(repo.id, oid);
      await get().refreshAll();
      noteUndo(repo.id, "revert", `revert of ${shortOid(oid)}`, before);
    } catch (e) {
      // See mergeBranch's catch: refresh first, error last, so it isn't
      // batched away by refreshAll's own `error: null` reset.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    }
  },

  async stashSave(opts) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await stashSave(repo.id, opts);
      await get().refreshAll();
      return oid;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async stashApply(index) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashApply(repo.id, index);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashPop(index) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashPop(repo.id, index);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashDrop(index, oid) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashDrop(repo.id, index, oid);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashBranch(index, branch) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashBranchFn(repo.id, index, branch);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async stashSavePaths(opts, paths) {
    const repo = get().current;
    if (!repo) return null;
    try {
      const oid = await stashSavePaths(repo.id, opts, paths);
      await get().refreshAll();
      return oid;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async stashRename(index, oid, message) {
    const repo = get().current;
    if (!repo) return;
    try {
      await stashRenameFn(repo.id, index, oid, message);
      // `refreshAll`, never a local patch of `stashes`: a rename is a store
      // followed by a drop and `refs/stash` can only be prepended to, so the
      // renamed entry lands at index 0 and everything between it and its old
      // position shifts down. Anything holding the old indices addresses the
      // wrong entry on the next click.
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async fetch(remote) {
    const repo = get().current;
    if (!repo) return;
    // The label belongs to `withAuthRetry`, not to a `finally` here (#296):
    // that `finally` fired the moment a credential challenge was raised, so the
    // retry ran with no spinner and no Cancel. See `withAuthRetry`.
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await fetchRemote(
          repo.id,
          remote,
          useSettingsStore.getState().pruneOnFetch,
          creds,
        );
        // The fetch is done; the refresh that follows is not the fetch, and on a
        // large repository it is a real share of the wait. Saying so beats
        // holding "Fetching origin…" up over ten queries against a local repo.
        setActivity(repo.id, "fetch", "Refreshing…");
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
      { key: "fetch", label: `Fetching ${remote}…` },
    );
  },

  async fetchAll() {
    const repo = get().current;
    if (!repo) return;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await fetchAll(repo.id, useSettingsStore.getState().pruneOnFetch, creds);
        setActivity(repo.id, "fetch", "Refreshing…");
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
      { key: "fetch", label: "Fetching all remotes…" },
    );
  },

  /**
   * Fetch the history a shallow clone left behind (#255).
   *
   * Filed under the `fetch` activity key because that is what it is — which
   * also means it inherits the status line, the progress bar and the Cancel
   * button, and `isCancellable` already lists that key. Unshallowing a large
   * repository is the longest single wait in the app, so all three matter.
   *
   * Nothing is reported when the repository was already complete: the backend
   * answers `false` rather than relaying git's refusal, and `refreshAll` takes
   * the notice down either way.
   */
  async unshallow() {
    const repo = get().current;
    if (!repo) return;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await unshallowFn(repo.id, creds);
        setActivity(repo.id, "fetch", "Refreshing…");
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
      { key: "fetch", label: "Fetching full history…" },
    );
  },

  async pull(remote, branch, mode = "Merge") {
    const repo = get().current;
    if (!repo) return;
    // Declared OUTSIDE the retried closure on purpose. An auth failure leaves
    // the stash in place (see the failure policy below) and then re-runs this
    // closure with credentials; a per-attempt variable would start at null, find
    // the now-clean tree, pull successfully and never pop — silently stranding
    // the user's uncommitted work in a stash they were never told about.
    let stashed: string | null = null;
    // `withAuthRetry` sets and clears the indicator around EACH attempt (#296),
    // which is what this closure used to hand-roll — the phase changes below
    // just relabel the entry it opened.
    await withAuthRetry(
      repo.id,
      async (creds) => {
        // Carry over uncommitted work when the setting is on: stash → pull →
        // pop, mirroring checkoutBranch's auto-stash. stashSave returns null
        // when the tree is clean, so this is a no-op in the common case. If
        // the pull fails, the stash is deliberately NOT popped — the work
        // stays safe in the stash list rather than colliding with a conflicted
        // worktree (same policy as checkoutBranch).
        if (useSettingsStore.getState().autoStashBeforePull && stashed === null) {
          setActivity(repo.id, "pull", "Stashing changes…");
          stashed = await stashSave(repo.id, {
            message: `auto: pull ${remote}/${branch}`,
            includeUntracked: true,
            keepIndex: false,
          });
          setActivity(repo.id, "pull", `Pulling ${remote}/${branch}…`);
        }
        await pullRemote(repo.id, remote, branch, mode, creds);
        if (stashed) {
          setActivity(repo.id, "pull", "Restoring stashed changes…");
          await stashPop(repo.id, 0);
          // Popped — a later attempt must not pop it a second time.
          stashed = null;
        }
        setActivity(repo.id, "pull", "Refreshing…");
        await get().refreshAll();
      },
      async (e) => {
        // See mergeBranch's catch: refresh first, error last, so it isn't
        // batched away by refreshAll's own `error: null` reset.
        await get().refreshAll();
        setErrorFor(repo.id, e);
      },
      { key: "pull", label: `Pulling ${remote}/${branch}…` },
    );
  },

  async fastForwardBranch(name) {
    const repo = get().current;
    if (!repo) return null;

    // HEAD's ref cannot just be moved: the index and worktree would still be at
    // the old tip, so every incoming change would render as a deletion. Route to
    // the real pull — which carries the auto-stash and the user's own mode.
    const branch = get().branches.find((b) => !b.isRemote && b.name === name);
    if (branch?.isHead) {
      const remote = remoteOfUpstream(branch.upstream, get().remotes);
      // No resolvable remote means no upstream to pull from; let the backend
      // say so rather than guessing "origin".
      if (remote) {
        await get().pull(
          remote,
          name,
          useSettingsStore.getState().defaultPullMode,
        );
        return null;
      }
    }

    let out: FastForward | null = null;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        out = await fastForwardBranchFn(
          repo.id,
          name,
          useSettingsStore.getState().pruneOnFetch,
          creds,
        );
        setActivity(repo.id, "fetch", "Refreshing…");
        await get().refreshAll();
      },
      async (e) => {
        // Refresh first, error last — refreshAll clears `error` as its first
        // act, so the other order loses the banner (see mergeBranch).
        await get().refreshAll();
        setErrorFor(repo.id, e);
      },
      { key: "fetch", label: `Fast-forwarding ${name}…` },
    );
    return out;
  },

  async fastForwardAllBranches() {
    const repo = get().current;
    if (!repo) return null;
    let out: BulkFastForward | null = null;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        out = await fastForwardAllBranchesFn(
          repo.id,
          useSettingsStore.getState().pruneOnFetch,
          creds,
        );
        setActivity(repo.id, "fetch", "Refreshing…");
        await get().refreshAll();
      },
      async (e) => {
        await get().refreshAll();
        setErrorFor(repo.id, e);
      },
      { key: "fetch", label: "Fast-forwarding branches…" },
    );
    return out;
  },

  async push(remote, branch, force = "None", noVerify = false) {
    const repo = get().current;
    if (!repo) return;
    await withAuthRetry(
      repo.id,
      async (creds) => {
        await pushRemote(repo.id, remote, branch, force, creds, noVerify);
        setActivity(repo.id, "push", "Refreshing…");
        await get().refreshAll();
      },
      (e) => setErrorFor(repo.id, e),
      { key: "push", label: `Pushing ${remote}/${branch}…` },
    );
  },

  async cancelNetworkOps() {
    const repo = get().current;
    if (!repo) return;
    // The ONLY thing set here, and it is UI intent rather than op state (#263):
    // the backend escalates SIGTERM → SIGKILL on the second cancel of the same
    // op, so the user has to be able to see that the first click landed and
    // that clicking again does something different. Without it the label reads
    // "Cancel" and the status line reads "Fetching…" exactly as before, and an
    // ordinary impatient double-click reaches SIGKILL in a few hundred
    // milliseconds — killing git before it can run its own lock-file cleanup,
    // which is the bug the SIGTERM exists to avoid.
    //
    // Everything else the running op still owns: it returns `Cancelled`, its
    // `finally` clears the activity label, and `setErrorFor` drops the error.
    // Clearing `activity` from here would race that and blank the status line
    // while git was still being reaped.
    set({ cancelRequested: true });
    await cancelNetworkOp(repo.id).catch((e) => {
      // The op finishing first is the common way this "fails", and it is the
      // outcome the click wanted anyway. A real failure to signal is worth a
      // banner: the user is still stuck, and silence would read as "cancelled".
      setErrorFor(repo.id, e);
    });
  },

  async addRemote(name, url) {
    const repo = get().current;
    if (!repo) return;
    try {
      await addRemote(repo.id, name, url);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async removeRemote(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await removeRemote(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async renameRemote(from, to) {
    const repo = get().current;
    if (!repo) return;
    try {
      await renameRemote(repo.id, from, to);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async setRemoteUrl(name, url) {
    const repo = get().current;
    if (!repo) return;
    try {
      await setRemoteUrl(repo.id, name, url);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async pruneRemote(name) {
    const repo = get().current;
    if (!repo) return;
    try {
      await pruneRemote(repo.id, name);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async acceptOurs(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await acceptOurs(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async acceptTheirs(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await acceptTheirs(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async markResolved(paths) {
    const repo = get().current;
    if (!repo) return;
    try {
      await markResolved(repo.id, paths);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async abortOperation() {
    const repo = get().current;
    if (!repo) return;
    // A paused interactive rebase must abort via rebaseAbort, which clears the
    // RebaseState entry and restores the pre-rebase tip. The generic abort
    // would leave that entry behind (see rebaseAbort / abort_operation).
    if (get().rebaseStatus.inProgress) {
      await get().rebaseAbort();
      return;
    }
    try {
      await abortOperation(repo.id);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async continueOperation() {
    const repo = get().current;
    if (!repo) return null;
    // Resolving a conflict during an interactive rebase must continue the
    // rebase (commit the resolved tree + advance the plan), not create a
    // standalone commit that leaves the rebase half-done — a later abort would
    // then reset to orig_head and silently discard the finalized commit.
    if (get().rebaseStatus.inProgress) {
      await get().rebaseContinue();
      return null;
    }
    try {
      const oid = await continueOperation(repo.id);
      await get().refreshAll();
      return oid;
    } catch (e) {
      // Refresh BEFORE recording the error (see mergeBranch): refreshAll clears
      // `error` as its first act, and React batches same-tick sets. A `git
      // rebase --continue` that stops on the NEXT conflict fails here with the
      // repository already moved on, so the operation bar must re-read disk.
      await get().refreshAll();
      setErrorFor(repo.id, e);
      return null;
    }
  },

  async runMergetool(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await runMergetoolFn(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async restartConflict(path) {
    const repo = get().current;
    if (!repo) return;
    try {
      await restartConflictFn(repo.id, path);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async rebaseStart(plan) {
    const repo = get().current;
    if (!repo) return null;
    // The whole plan replays inside this one call, so without an activity entry
    // the Start button sat un-spun and re-clickable for the entire run (#296).
    // `rebase://progress` relabels this entry per step as the replay advances.
    setActivity(repo.id, "rebase", `Rebasing ${plan.length} commit${plan.length === 1 ? "" : "s"}…`);
    try {
      const status = await rebaseStartFn(
        repo.id,
        plan,
        resolveUpdateRefs(useSettingsStore.getState().rebaseUpdateRefs),
      );
      setFor(repo.id, { rebaseStatus: status });
      setActivity(repo.id, "rebase", "Refreshing…");
      await get().refreshAll();
      return status;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    } finally {
      setActivity(repo.id, "rebase", null);
    }
  },

  async rebaseContinue() {
    const repo = get().current;
    if (!repo) return null;
    setActivity(repo.id, "rebase", "Continuing rebase…");
    try {
      const status = await rebaseContinueFn(repo.id);
      setFor(repo.id, { rebaseStatus: status });
      setActivity(repo.id, "rebase", "Refreshing…");
      await get().refreshAll();
      return status;
    } catch (e) {
      setErrorFor(repo.id, e);
      return null;
    } finally {
      setActivity(repo.id, "rebase", null);
    }
  },

  async rebaseAbort() {
    const repo = get().current;
    if (!repo) return;
    setActivity(repo.id, "rebase", "Aborting rebase…");
    try {
      await rebaseAbort(repo.id);
      setFor(repo.id, { rebaseStatus: DEFAULT_REBASE_STATUS });
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    } finally {
      setActivity(repo.id, "rebase", null);
    }
  },

  async rebaseAcknowledge() {
    const repo = get().current;
    if (!repo) return;
    try {
      await rebaseAcknowledgeFn(repo.id);
      // Mirror the drop locally instead of a full refreshAll: acknowledging is
      // a notice being dismissed, not a change to the repository, and a refresh
      // here would re-walk the log on every visit to the Rebase screen.
      setFor(repo.id, {
        rebaseStatus: { ...get().rebaseStatus, lastCompleted: null },
      });
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async bisectStart(bad, good = []) {
    const repo = get().current;
    if (!repo) return;
    try {
      const status = await bisectStartFn(repo.id, bad, good);
      set({ bisectStatus: status });
      // A bisect checks out a revision to test, so the whole world moved.
      await get().refreshAll();
    } catch (e) {
      // Danger-op convention: refresh first, error last, so refreshAll's own
      // `error: null` reset cannot batch the banner away.
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async bisectMark(mark, rev = null) {
    const repo = get().current;
    if (!repo) return;
    try {
      const status = await bisectMarkFn(repo.id, mark, rev);
      set({ bisectStatus: status });
      await get().refreshAll();
    } catch (e) {
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async bisectReset() {
    const repo = get().current;
    if (!repo) return;
    try {
      await bisectResetFn(repo.id);
      set({ bisectStatus: DEFAULT_BISECT_STATUS });
      await get().refreshAll();
    } catch (e) {
      await get().refreshAll();
      set({ error: toAppError(e) });
    }
  },

  async appendGitignore(pattern) {
    const repo = get().current;
    if (!repo) return;
    try {
      await appendGitignoreFn(repo.id, pattern);
      await get().refreshAll();
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async openInEditor(relativePath) {
    const repo = get().current;
    if (!repo) return;
    try {
      await openInEditorFn(repo.id, relativePath);
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async openInDifftool(target, paths) {
    const repo = get().current;
    if (!repo || paths.length === 0) return;
    // The label names the FILE, not the tool: we deliberately do not resolve
    // which tool git will pick (see git/difftool.rs), so claiming one here
    // would be a guess printed as a fact.
    const label = `Diffing ${paths[paths.length - 1]} externally…`;
    setActivity(repo.id, "difftool", label);
    try {
      // Empty means "let git decide", which is the zero-config case the whole
      // feature is built around — so it is passed through as null rather than
      // as an empty `--tool=`.
      const tool = useSettingsStore.getState().externalDiffTool.trim();
      await openInDifftoolFn(repo.id, target, paths, tool === "" ? null : tool);
      // The tool may have EDITED the file: when the right-hand side is the
      // working tree, git difftool hands it the real one rather than a copy.
      await get().refreshAll();
    } catch (e) {
      // Refresh first, error last — refreshAll clears `error` as its first act
      // and React batches same-tick sets. Same order every danger-op catch arm
      // uses; a tool that half-wrote a file must not leave the UI stale either.
      await get().refreshAll();
      setErrorFor(repo.id, e);
    } finally {
      setActivity(repo.id, "difftool", null);
    }
  },

  async revealInFileManager(relativePath) {
    const repo = get().current;
    if (!repo) return;
    try {
      await revealInFileManagerFn(repo.id, relativePath);
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },

  async openInTerminal(relativePath) {
    const repo = get().current;
    if (!repo) return;
    try {
      await openInTerminalFn(repo.id, relativePath);
    } catch (e) {
      setErrorFor(repo.id, e);
    }
  },
  });
});
