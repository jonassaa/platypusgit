import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { debug as logDebug, warn as logWarn, error as logError } from "@tauri-apps/plugin-log";
import { describeError } from "./errors";
import type {
  ActionContext,
  ActionOutput,
  AheadBehind,
  AuthorOverride,
  BisectMark,
  BisectStatus,
  BlameResult,
  BranchInfo,
  BulkFastForward,
  CliInstallOutcome,
  ChecksSummary,
  DeleteFailure,
  CliShimStatus,
  CloneOptions,
  CommitInfo,
  CommitNote,
  CommitResult,
  CommitTemplate,
  ConflictSides,
  DiagnosticsReport,
  DiffKind,
  DiffToolTarget,
  FastForward,
  FileContent,
  FileDiff,
  FileStatus,
  ForgeCheckoutRequest,
  ForgeDetection,
  GitIdentity,
  IdentityWriteScope,
  ForgeIdentity,
  ForgeKind,
  ForgeRepo,
  ForgeTokenStatus,
  HeadInfo,
  ImagePreview,
  ImageSource,
  LaunchIntent,
  LfsStatus,
  LogFilter,
  LogPage,
  NewPullRequest,
  PullMode,
  PullRequest,
  PushForce,
  RebaseStatus,
  StackedRef,
  RebaseStep,
  ReflogEntry,
  RemoteInfo,
  RepoHandle,
  ShallowInfo,
  SignatureStatus,
  RepoState,
  SshKeyGenerateRequest,
  SshKeyInfo,
  SshKeyStatus,
  StashInfo,
  SubmoduleInfo,
  TagInfo,
  UpdateCapability,
  UpdateChannel,
  UpdateInfo,
  WorkdirDiff,
  WorktreeBranch,
  WorktreeInfo,
} from "./types";

const SLOW_INVOKE_MS = 250;

/**
 * How long an invoke may stay unsettled before the watchdog reports it.
 *
 * Deliberately far above `SLOW_INVOKE_MS`: this is not a "slow" threshold but a
 * "we may never hear back" one. A real repository on a slow filesystem takes
 * seconds legitimately — a WSL repo under `/mnt/c` spent 9.8s on the startup
 * fan-out (#274) — so a low bound here would cry wolf on every launch.
 */
const STALL_INVOKE_MS = 10_000;

/**
 * Report an invoke that has not settled yet.
 *
 * Every other line this module writes is a PAST-TENSE record: emitted once the
 * call returned or threw, carrying its duration. That made a whole failure
 * class invisible — an invoke that hangs, or one that is never issued at all,
 * produces no line ever. So a log from a repository that "would not open" was
 * indistinguishable from a log of a session where nobody tried: the four WSL
 * launches in #274 showed `check_for_update` and then silence, and the log
 * could not say which.
 *
 * The watchdog logs in the PRESENT tense, from a timer, while the call is still
 * outstanding. The absence of a matching completion line afterwards then
 * becomes the evidence rather than the void: the call never came back.
 *
 * WARN, not DEBUG: the level has to clear the `Info` filter that
 * `src-tauri/src/lib.rs` pins the log file to, or the one line worth having
 * would be the one line dropped.
 */
function watchForStall(cmd: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    logWarn(`invoke ${cmd} still pending after ${STALL_INVOKE_MS}ms`);
  }, STALL_INVOKE_MS);
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
  // Paired with the `clearTimeout` in `finally`. Armed BEFORE the call so a
  // `rawInvoke` that throws synchronously cannot leave a timer running.
  const stall = watchForStall(cmd);
  try {
    const result = await rawInvoke<T>(cmd, args);
    const ms = Math.round(performance.now() - start);
    if (ms >= SLOW_INVOKE_MS) {
      logWarn(`invoke ${cmd} slow: ${ms}ms`);
    } else {
      logDebug(`invoke ${cmd} ${ms}ms`);
    }
    return result;
  } catch (err) {
    const ms = Math.round(performance.now() - start);
    // `describeError`, never `String(err)`: an AppError is an object, so the
    // template read `[object Object]` and every backend failure in a
    // user-supplied log carried no reason at all (#146).
    logError(`invoke ${cmd} failed after ${ms}ms: ${describeError(err)}`);
    throw err;
  } finally {
    clearTimeout(stall);
  }
}

export async function openRepo(path: string): Promise<RepoHandle> {
  return invoke<RepoHandle>("open_repo", { path });
}

/**
 * Forget an opened repository backend-side (a closed repository tab).
 *
 * `open_repo` mints a fresh id every time and the backend never evicts on its
 * own, so a session that opens N repositories holds N `git2::Repository` values
 * — with their file handles — until it exits. Closing an already-closed or never
 * -opened id is a silent success by contract.
 */
export async function closeRepo(repoId: string): Promise<void> {
  return invoke<void>("close_repo", { repoId });
}

/**
 * Add `path` to the user's global `safe.directory` list so git will open it
 * despite an ownership mismatch. Only ever call this behind an explicit
 * confirmation — it is a security exception, not a preference.
 */
export async function trustRepoPath(path: string): Promise<void> {
  return invoke<void>("trust_repo_path", { path });
}

export async function getStatus(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_status", { repoId });
}

/**
 * HEAD's current branch/oid. Unlike `RepoHandle.head` (set once by
 * `openRepo`), this is meant to be re-polled on every refresh so it follows
 * checkouts within the session (#217).
 */
export async function headInfo(repoId: string): Promise<HeadInfo> {
  return invoke<HeadInfo>("head_info", { repoId });
}

export async function listAllFiles(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("list_all_files", { repoId });
}

/**
 * Read a file's content from the worktree, falling back to the HEAD blob for a
 * deleted file.
 *
 * Resolves to `null` — it does NOT reject — when neither side holds text: a
 * directory, a submodule gitlink, or a path that vanished after the status
 * snapshot the caller is rendering. The HEAD fallback only recovers a BLOB, so
 * clicking a clean submodule row was routine and still cost ERROR lines in the
 * log for a pane that rendered nothing either way (#146). A genuine failure
 * (unknown repository, unreadable file) still rejects.
 */
export async function readFileContent(
  repoId: string,
  path: string,
): Promise<FileContent | null> {
  return invoke<FileContent | null>("read_file_content", { repoId, path });
}

/**
 * List every file in the tree at `revspec` (commit SHA, branch, tag, or any
 * revspec). All entries are reported `Unmodified` — it's a historical snapshot.
 */
export async function listFilesAtRev(
  repoId: string,
  revspec: string,
): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("list_files_at_rev", { repoId, revspec });
}

/**
 * Read a file's content from the INDEX — what committing would record.
 *
 * Differs from both other readers exactly when a file is partially staged, which
 * is why the commit panel needs it: its diffs are against the index, so tokens
 * taken from HEAD or the worktree could land on the wrong lines there.
 * Resolves to `null` — it does NOT reject — for a path with no stage-0 entry
 * (untracked, or conflicted); callers render those rows plain. Absence is the
 * expected answer, not a failure: the commit panel asks for the index side of
 * every row it draws (#146).
 */
export async function readFileContentAtIndex(
  repoId: string,
  path: string,
): Promise<FileContent | null> {
  return invoke<FileContent | null>("read_file_content_at_index", { repoId, path });
}

/**
 * Read a file's content from the tree at `revspec`.
 *
 * Resolves to `null` when that tree holds no text at that path — absent, a
 * directory, or a submodule gitlink. Every caller is a diff surface reading the
 * OTHER side of a file it is already rendering, so an added file having no old
 * side is routine and must not travel the error path (#146). A genuine failure
 * (bad revspec, unknown repository) still rejects.
 */
export async function readFileContentAtRev(
  repoId: string,
  revspec: string,
  path: string,
): Promise<FileContent | null> {
  return invoke<FileContent | null>("read_file_content_at_rev", {
    repoId,
    revspec,
    path,
  });
}

/**
 * The BYTES of an image at `path` on one side, sniffed (#224).
 *
 * The only reader that can feed an `<img>`: the other three carry
 * `FileContent.text`, which is `null` for a binary blob by contract.
 *
 * Resolves to `null` — it does NOT reject — when there is no blob at all on that
 * side, which is routine for a preview pair (an added file has no old side).
 * Everything else is a state ON the payload: `tooLarge`, `unsupported`,
 * `lfsMissing`. A genuine failure (unknown repository, unresolvable revspec)
 * still rejects.
 *
 * `data` is base64 of the whole blob, ready to be concatenated into a `data:`
 * URL — nothing decodes it on this side. **Image bytes reach the `<img>`
 * locally and only locally**; a preview never makes a request (#226).
 */
export async function readImagePreview(
  repoId: string,
  source: ImageSource,
  path: string,
): Promise<ImagePreview | null> {
  return invoke<ImagePreview | null>("read_image_preview", {
    repoId,
    source,
    path,
  });
}

/**
 * Commit log, newest-first. `refspec` scopes the walk start: omitted/null
 * walks from HEAD; any revspec (branch, tag, oid) walks from that commit.
 */
export async function getLog(
  repoId: string,
  limit?: number,
  refspec?: string | null,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_log", { repoId, limit, refspec });
}

/**
 * Commit log filtered by `filter` (message/author/sha/date/path), newest-first.
 * `limit` caps the number of *matching* commits. An empty filter behaves like
 * `getLog`. `refspec` scopes the walk exactly as in `getLog`.
 */
export async function getLogFiltered(
  repoId: string,
  filter: LogFilter,
  limit?: number,
  refspec?: string | null,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_log_filtered", {
    repoId,
    filter,
    limit,
    refspec,
  });
}

/**
 * One page of the log (#68 G11). Pass the previous page's `nextCursor` to
 * resume; omit it for the first page. `nextCursor === null` means the walk
 * reached the end of history.
 *
 * When `cursor` is given, `refspec` is ignored — the cursor is the walk
 * frontier and already encodes where this page continues from.
 */
export async function getLogPage(
  repoId: string,
  cursor?: string[] | null,
  limit?: number,
  refspec?: string | null,
): Promise<LogPage> {
  return invoke<LogPage>("get_log_page", { repoId, cursor, limit, refspec });
}

/** `getLogPage` with a filter; only matching commits count toward `limit`. */
export async function getLogFilteredPage(
  repoId: string,
  filter: LogFilter,
  cursor?: string[] | null,
  limit?: number,
  refspec?: string | null,
): Promise<LogPage> {
  return invoke<LogPage>("get_log_filtered_page", {
    repoId,
    filter,
    cursor,
    limit,
    refspec,
  });
}

/**
 * Commits in `base..HEAD` (reachable from HEAD, not from `base`), newest-first.
 * `base` is any revspec — branch, tag, short or full oid. Rejects a `base` that
 * can't be resolved or isn't an ancestor of HEAD.
 */
export async function commitsSince(
  repoId: string,
  base: string,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("commits_since", { repoId, base });
}

/**
 * Commits in `base..tip` (reachable from `tip`, not from `base`), newest-first
 * (#131). Both sides are any revspec, and — unlike `commitsSince` — neither has
 * to be an ancestor of the other, which is what makes it usable for two
 * diverged branches.
 */
export async function commitsBetween(
  repoId: string,
  base: string,
  tip: string,
  limit?: number,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("commits_between", { repoId, base, tip, limit });
}

/**
 * How `b` stands relative to `a`, plus their merge base (#131). `ahead` counts
 * what `b` has and `a` does not; `behind` is the mirror. `mergeBase` is null for
 * unrelated histories.
 */
export async function aheadBehind(
  repoId: string,
  a: string,
  b: string,
): Promise<AheadBehind> {
  return invoke<AheadBehind>("ahead_behind", { repoId, a, b });
}

export async function listBranches(repoId: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>("list_branches", { repoId });
}

export async function listTags(repoId: string): Promise<TagInfo[]> {
  return invoke<TagInfo[]>("list_tags", { repoId });
}

export async function listStashes(repoId: string): Promise<StashInfo[]> {
  return invoke<StashInfo[]>("list_stashes", { repoId });
}

export async function listRemotes(repoId: string): Promise<RemoteInfo[]> {
  return invoke<RemoteInfo[]>("list_remotes", { repoId });
}

/**
 * `ignoreWhitespace` is a VIEWING option: it folds whitespace-only changes into
 * context. Hunk indices from such a diff do NOT line up with the ones
 * stageHunk/discardHunk expect, so callers must disable hunk-level actions
 * while it is on (#61 D2).
 */
export async function getDiff(
  repoId: string,
  path: string,
  kind: DiffKind = "WorktreeToIndex",
  contextLines = 3,
  ignoreWhitespace = false,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_diff", {
    repoId,
    path,
    kind,
    contextLines,
    ignoreWhitespace,
  });
}

export async function getReflog(repoId: string): Promise<ReflogEntry[]> {
  return invoke<ReflogEntry[]>("get_reflog", { repoId });
}

export async function checkoutDetached(
  repoId: string,
  oid: string,
): Promise<void> {
  return invoke<void>("checkout_detached", { repoId, oid });
}

export async function diffCommits(
  repoId: string,
  fromOid: string,
  toOid: string,
  contextLines = 3,
  ignoreWhitespace = false,
): Promise<FileDiff[]> {
  return invoke<FileDiff[]>("diff_commits", {
    repoId,
    fromOid,
    toOid,
    contextLines,
    ignoreWhitespace,
  });
}

/**
 * A single commit's own diff — against its first parent. Root commit (no
 * parent) diffs against the empty tree (all-added); a merge commit diffs
 * against its first parent. This is "what this commit changed."
 */
export async function diffCommit(
  repoId: string,
  oid: string,
  contextLines = 3,
  ignoreWhitespace = false,
): Promise<FileDiff[]> {
  return invoke<FileDiff[]>("diff_commit", {
    repoId,
    oid,
    contextLines,
    ignoreWhitespace,
  });
}

/**
 * The tree at `revspec` against the WORKING TREE (#131) — every changed file,
 * not one path.
 *
 * `includeUntracked` is explicit: git's own `git diff <ref>` ignores untracked
 * files, but this app's worktree diffs include them with content, so the compare
 * screen passes `true`. `.gitignore`d files are excluded either way.
 *
 * The untracked side is BOUNDED — over the backend's ceiling it is dropped
 * whole and the count comes back as `untrackedOmitted`. Render that; a short
 * file list with no explanation is the failure the cap exists to prevent.
 */
export async function diffRefToWorkdir(
  repoId: string,
  revspec: string,
  contextLines = 3,
  ignoreWhitespace = false,
  includeUntracked = false,
): Promise<WorkdirDiff> {
  return invoke<WorkdirDiff>("diff_ref_to_workdir", {
    repoId,
    revspec,
    contextLines,
    ignoreWhitespace,
    includeUntracked,
  });
}

export async function stagePaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("stage_paths", { repoId, paths });
}

export async function unstagePaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("unstage_paths", { repoId, paths });
}

export async function commit(
  repoId: string,
  message: string,
  amend = false,
  signoff = false,
  /** "Commit as" — omit to use the repo config identity. */
  authorOverride: AuthorOverride | null = null,
  /**
   * Sign this commit (#61 D6). `null`/omitted follows `commit.gpgsign` from git
   * config; `true`/`false` overrides it for this commit.
   */
  sign: boolean | null = null,
  /**
   * Skip every commit-side hook for this commit only (#232), matching
   * `git commit --no-verify`. Defaults to running them.
   */
  noVerify = false,
): Promise<CommitResult> {
  return invoke<CommitResult>("commit", {
    repoId,
    message,
    amend,
    signoff,
    authorOverride,
    sign,
    noVerify,
  });
}

/**
 * Signature status of ONE commit (#61 D6).
 *
 * Lazy and per-selection by design: a badge on every log row would mean a
 * gpg/ssh-keygen process per walked commit, which fights the paginated log and
 * the windowed list.
 */
export async function verifyCommit(
  repoId: string,
  oid: string,
): Promise<SignatureStatus> {
  return invoke<SignatureStatus>("verify_commit", { repoId, oid });
}

/**
 * The repository's `commit.template` and comment prefix (#252).
 *
 * Resolves even when `commit.template` names a file that is not there: the
 * result carries `unreadable`, and the composer says so on screen. A stale
 * config line must not stop the commit screen from opening.
 */
export async function getCommitTemplate(repoId: string): Promise<CommitTemplate> {
  return invoke<CommitTemplate>("get_commit_template", { repoId });
}

/**
 * The committer identity a commit would use, and where each half is configured
 * (#212).
 *
 * `repoId` is optional because Settings is reachable before a repository is
 * open, and the global + system chain is the effective identity there.
 */
export async function getIdentity(repoId?: string | null): Promise<GitIdentity> {
  return invoke<GitIdentity>("get_identity", { repoId: repoId ?? null });
}

/**
 * Write `user.name` / `user.email` at `scope` (#212, #233) — the remedy for
 * `NoSignature`, and the way a repository gets its own identity.
 *
 * `scope` is REQUIRED, with no default: "which config did that change?" is the
 * question this feature exists to stop people having to ask, and a default here
 * would answer it silently at the one call site that forgot to.
 *
 * `"repository"` needs `repoId`; the backend refuses it without one rather than
 * falling back to global.
 *
 * Rejects with `InvalidArgument` for anything git would refuse, and writes
 * nothing in that case.
 */
export async function setIdentity(
  name: string,
  email: string,
  scope: IdentityWriteScope,
  repoId?: string | null,
): Promise<void> {
  return invoke<void>("set_identity", {
    name,
    email,
    scope,
    repoId: repoId ?? null,
  });
}

export async function discardPaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("discard_paths", { repoId, paths });
}

/**
 * Delete UNTRACKED files from the working tree (#245).
 *
 * Not `discardPaths`: that restores a tracked path from the index and only
 * deletes an untracked one, while this refuses a tracked path outright — the
 * backend enforces untracked-only, inside-the-worktree, no directories and no
 * embedded repositories, and none of those are the frontend's to decide.
 *
 * Rejects without deleting anything when a path fails one of those rules.
 * Resolves with one entry per path the OS refused to unlink (an empty array
 * means the whole selection is gone) — the delete is best-effort once it starts.
 */
export async function deleteUntrackedFiles(
  repoId: string,
  paths: string[],
): Promise<DeleteFailure[]> {
  return invoke<DeleteFailure[]>("delete_untracked_files", { repoId, paths });
}

// Hunk indices refer to the diff computed with `contextLines` — always pass
// the same value used for the getDiff() that displayed the hunks, or the
// backend may apply the wrong hunk (context width changes hunk merging).
export async function stageHunk(
  repoId: string,
  path: string,
  hunkIndex: number,
  contextLines = 3,
): Promise<void> {
  return invoke<void>("stage_hunk", { repoId, path, hunkIndex, contextLines });
}

export async function unstageHunk(
  repoId: string,
  path: string,
  hunkIndex: number,
  contextLines = 3,
): Promise<void> {
  return invoke<void>("unstage_hunk", { repoId, path, hunkIndex, contextLines });
}

export async function discardHunk(
  repoId: string,
  path: string,
  hunkIndex: number,
  contextLines = 3,
): Promise<void> {
  return invoke<void>("discard_hunk", { repoId, path, hunkIndex, contextLines });
}

/**
 * Line-level staging (#61 D7). `selected` holds indices among the hunk's
 * CHANGED (`+`/`-`) lines counted from 0 — NOT indices into `hunk.lines`, which
 * also contains header and context rows.
 */
export async function stageLines(
  repoId: string,
  path: string,
  hunkIndex: number,
  selected: number[],
  contextLines = 3,
): Promise<void> {
  return invoke<void>("stage_lines", {
    repoId,
    path,
    hunkIndex,
    selected,
    contextLines,
  });
}

/** Unstage only the selected changed lines of a hunk (see `stageLines`). */
export async function unstageLines(
  repoId: string,
  path: string,
  hunkIndex: number,
  selected: number[],
  contextLines = 3,
): Promise<void> {
  return invoke<void>("unstage_lines", {
    repoId,
    path,
    hunkIndex,
    selected,
    contextLines,
  });
}

/** Discard only the selected changed lines of a hunk (see `stageLines`). */
export async function discardLines(
  repoId: string,
  path: string,
  hunkIndex: number,
  selected: number[],
  contextLines = 3,
): Promise<void> {
  return invoke<void>("discard_lines", {
    repoId,
    path,
    hunkIndex,
    selected,
    contextLines,
  });
}

export type ResetMode = "Soft" | "Mixed" | "Hard";

export async function reset(
  repoId: string,
  target: string,
  mode: ResetMode,
): Promise<void> {
  return invoke<void>("reset", { repoId, target, mode });
}

export async function cherryPick(repoId: string, oid: string): Promise<void> {
  return invoke<void>("cherry_pick", { repoId, oid });
}

export async function revert(repoId: string, oid: string): Promise<void> {
  return invoke<void>("revert", { repoId, oid });
}

/**
 * Switch to a local branch.
 *
 * `take` releases the branch from a linked worktree that holds it instead of
 * rejecting with `BranchHeldByWorktree` (#358). Pass it only after the user has
 * answered that refusal — `useRepoStore.checkoutBranch` owns that conversation.
 */
export async function checkoutBranch(
  repoId: string,
  name: string,
  take = false,
): Promise<void> {
  return invoke<void>("checkout_branch", { repoId, name, take });
}

export async function createBranch(
  repoId: string,
  name: string,
  from?: string,
): Promise<void> {
  return invoke<void>("create_branch", { repoId, name, from });
}

export async function deleteBranch(
  repoId: string,
  name: string,
  force = false,
): Promise<void> {
  return invoke<void>("delete_branch", { repoId, name, force });
}

export async function renameBranch(
  repoId: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke<void>("rename_branch", { repoId, from, to });
}

/**
 * Set or clear a branch's upstream. `null` clears tracking; a remote-tracking
 * shorthand such as `"origin/main"` sets it.
 */
export async function setUpstream(
  repoId: string,
  branch: string,
  upstream: string | null,
): Promise<void> {
  return invoke<void>("set_upstream", { repoId, branch, upstream });
}

export interface TagTarget {
  oid: string;
  /** null = lightweight tag; a string = annotated tag with this message. */
  annotation: string | null;
  /**
   * Sign this tag (#132). `null` follows `tag.gpgsign`; a boolean overrides it
   * for this tag — the same contract `CommitOptions.sign` has.
   *
   * Signing requires an annotation: `true` with `annotation: null` is refused
   * by the backend rather than silently dropped, because a lightweight tag is a
   * ref with no object to sign.
   */
  sign?: boolean | null;
}

export async function createTag(
  repoId: string,
  name: string,
  target: TagTarget,
): Promise<void> {
  return invoke<void>("create_tag", { repoId, name, target });
}

export async function deleteTag(repoId: string, name: string): Promise<void> {
  return invoke<void>("delete_tag", { repoId, name });
}

/**
 * Signature status of ONE tag (#132).
 *
 * Lazy for the same reason `verifyCommit` is: the Branches screen renders every
 * tag at once, so a verdict per row would be a signer process per row on every
 * refresh. `TagInfo.signed` carries the free half — whether a signature is
 * there at all.
 */
export async function verifyTag(
  repoId: string,
  name: string,
): Promise<SignatureStatus> {
  return invoke<SignatureStatus>("verify_tag", { repoId, name });
}

export async function mergeBranch(repoId: string, name: string): Promise<void> {
  return invoke<void>("merge_branch", { repoId, name });
}

export async function rebaseOnto(
  repoId: string,
  upstream: string,
): Promise<void> {
  return invoke<void>("rebase_onto", { repoId, upstream });
}

export async function checkoutRef(
  repoId: string,
  reference: string,
): Promise<void> {
  return invoke<void>("checkout_ref", { repoId, reference });
}

/**
 * Push one tag. Takes `credentials` like the other pushes: the first attempt is
 * prompt-less and only a retry after an `Auth` failure carries a credential
 * (#61 D5, extended to tag push in the D5 follow-up).
 */
export async function pushTag(
  repoId: string,
  remote: string,
  name: string,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("push_tag", { repoId, remote, name, credentials });
}

/** Delete a branch on the remote (see `pushTag` for the credential contract). */
export async function pushDeleteBranch(
  repoId: string,
  remote: string,
  name: string,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("push_delete_branch", { repoId, remote, name, credentials });
}

export interface StashSaveOptions {
  message: string | null;
  includeUntracked: boolean;
  keepIndex: boolean;
}

export async function stashSave(
  repoId: string,
  opts: StashSaveOptions,
): Promise<string | null> {
  return invoke<string | null>("stash_save", { repoId, opts });
}

export async function stashApply(repoId: string, index: number): Promise<void> {
  return invoke<void>("stash_apply", { repoId, index });
}

export async function stashPop(repoId: string, index: number): Promise<void> {
  return invoke<void>("stash_pop", { repoId, index });
}

/**
 * Drop the entry at `index`, refusing unless it is still `oid` (#133).
 *
 * The oid is not optional: an index is a position in the `refs/stash` reflog,
 * so any write to that ref shifts it, and dropping whatever moved into the slot
 * destroys a stash that was never selected. A `StaleStash` error means "the list
 * changed, refresh and pick again".
 */
export async function stashDrop(
  repoId: string,
  index: number,
  oid: string,
): Promise<void> {
  return invoke<void>("stash_drop", { repoId, index, oid });
}

export async function stashBranch(
  repoId: string,
  index: number,
  branch: string,
): Promise<void> {
  return invoke<void>("stash_branch", { repoId, index, branch });
}

/**
 * Stash only `paths` (#133).
 *
 * `null` means git found nothing to save under that pathspec — a state, not a
 * failure, exactly as `stashSave` already reports it.
 *
 * `includeUntracked` is not a preference here: `git stash push -- <untracked
 * path>` FAILS without it, so callers derive it from whether the selection
 * contains an untracked path.
 */
export async function stashSavePaths(
  repoId: string,
  opts: StashSaveOptions,
  paths: string[],
): Promise<string | null> {
  return invoke<string | null>("stash_save_paths", { repoId, opts, paths });
}

/**
 * Rename the entry at `index` (#133).
 *
 * `oid` proves the entry at `index` is still the one that was picked — see
 * `stashDrop`. The caller must RE-READ the stash list afterwards, never patch
 * its own copy: a rename is a store followed by a drop, and `refs/stash` can
 * only be prepended to, so the renamed entry ends up at index 0 and everything
 * between shifts down.
 */
export async function stashRename(
  repoId: string,
  index: number,
  oid: string,
  message: string,
): Promise<void> {
  return invoke<void>("stash_rename", { repoId, index, oid, message });
}

/**
 * What this stash changed — its own first parent's tree against its own (#133).
 *
 * Addressed by OID, not index: an index is a reflog position and goes stale the
 * moment anything writes to `refs/stash`, so a stale one would silently diff a
 * different entry.
 *
 * `includeUntracked` folds in the `git stash -u` payload, which lives in a
 * THIRD parent that no tree-level diff of the stash commit can reach. Inert on
 * an entry that has none — see `StashInfo.untracked`.
 */
export async function stashDiff(
  repoId: string,
  oid: string,
  contextLines = 3,
  ignoreWhitespace = false,
  includeUntracked = true,
): Promise<FileDiff[]> {
  return invoke<FileDiff[]>("stash_diff", {
    repoId,
    oid,
    contextLines,
    ignoreWhitespace,
    includeUntracked,
  });
}

// ─── Network operations ──────────────────────────────────────────────────────

/** Fetch a single remote, pruning deleted remote refs. */
/**
 * A credential supplied for ONE retry of a network op (#61 D5).
 *
 * `username` is absent for an SSH passphrase, which has none. Nothing is
 * persisted by the app: "remember" hands the credential to git's own configured
 * credential helper.
 */
export interface Credentials {
  username?: string;
  secret: string;
}

/**
 * Store a credential with git's own configured credential helper. Called only
 * after the credential has actually worked — storing on submit would persist a
 * typo.
 */
export async function rememberCredential(
  repoId: string,
  host: string,
  credentials: Credentials,
): Promise<void> {
  return invoke<void>("remember_credential", { repoId, host, credentials });
}

/**
 * Stop the network ops running in one scope (#234) — a clone, or every fetch,
 * pull and push on one repository.
 *
 * `repoId` omitted means the clone the Clone dialog is running: a clone has no
 * repository to name yet. Scoped rather than per-op on purpose — the auto-fetch
 * timer can stack fetches behind a stalled one, and Cancel has to reach the
 * whole pile, not just the op the user can see.
 *
 * Answers how many ops were signalled. Zero is a normal answer, not a failure:
 * the op can finish between the user reading the status line and clicking.
 */
export async function cancelNetworkOp(repoId?: string): Promise<number> {
  return invoke<number>("cancel_network_op", { repoId: repoId ?? null });
}

/**
 * How much of this repository is actually here (#255) — shallow or not, how many
 * commits history stops at, and whether the remotes fetch a single branch.
 *
 * Answered by reading git's own state on every call, so an `--unshallow` from a
 * terminal or another window needs nothing invalidated.
 */
export async function shallowInfo(repoId: string): Promise<ShallowInfo> {
  return invoke<ShallowInfo>("shallow_info", { repoId });
}

/**
 * `git fetch --unshallow` — fetch the history a shallow clone left behind.
 *
 * Resolves `false` when the repository was already complete: git refuses that
 * outright ("--unshallow on a complete repository does not make sense"), and a
 * user who clicked a button another window had already acted on must not be
 * shown an error for it.
 */
export async function unshallow(
  repoId: string,
  credentials?: Credentials,
): Promise<boolean> {
  return invoke<boolean>("unshallow", { repoId, credentials });
}

export async function fetch(
  repoId: string,
  remote: string,
  prune = true,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("fetch", { repoId, remote, prune, credentials });
}

/** Fetch all remotes, pruning deleted remote refs. */
export async function fetchAll(
  repoId: string,
  prune = true,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("fetch_all", { repoId, prune, credentials });
}

/**
 * Pull from remote/branch.
 * Default mode is `Merge` (same as git default). Use `FastForward` or
 * `Rebase` for stricter semantics. Pull-mode UI will land in a later
 * iteration; the groundwork is here so it only needs UI, not backend changes.
 */
export async function pull(
  repoId: string,
  remote: string,
  branch: string,
  mode: PullMode = "Merge",
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("pull", { repoId, remote, branch, mode, credentials });
}

/**
 * Fetch a branch's remote, then advance the branch to its upstream (#246).
 *
 * The op `pull` cannot be: `git pull <remote> <branch>` merges the fetched head
 * into whatever HEAD is, so it never advanced the branch it named. This moves
 * that branch's REF and leaves HEAD alone — and therefore REFUSES a branch that
 * is checked out here or in a linked worktree. Route those to `pull` with the
 * user's own `defaultPullMode`; `useRepoStore.fastForwardBranch` does.
 *
 * Rejects with `NotFastForward` when the branch has diverged. Never merges,
 * never rebases, never silently does nothing.
 */
export async function fastForwardBranch(
  repoId: string,
  branch: string,
  prune = true,
  credentials?: Credentials,
): Promise<FastForward> {
  return invoke<FastForward>("fast_forward_branch", {
    repoId,
    branch,
    prune,
    credentials,
  });
}

/**
 * Fetch every remote, then fast-forward every local branch that can be (#246).
 *
 * One fetch for the whole sweep, which is why it is a command rather than a
 * loop over `fastForwardBranch` — that would cost a network round trip per
 * branch. Per-branch refusals come back in the report, not as a rejection.
 */
export async function fastForwardAllBranches(
  repoId: string,
  prune = true,
  credentials?: Credentials,
): Promise<BulkFastForward> {
  return invoke<BulkFastForward>("fast_forward_all_branches", {
    repoId,
    prune,
    credentials,
  });
}

/**
 * Push local branch to remote.
 * `force` defaults to `None` (reject on diverge). Use `WithLease` for safe
 * force-push or `Force` to unconditionally overwrite.
 */
export async function push(
  repoId: string,
  remote: string,
  branch: string,
  force: PushForce = "None",
  credentials?: Credentials,
  /** Skip `pre-push` for this push only (#232). */
  noVerify = false,
): Promise<void> {
  return invoke<void>("push", {
    repoId,
    remote,
    branch,
    force,
    credentials,
    noVerify,
  });
}

// ─── Remote management ───────────────────────────────────────────────────────

export async function addRemote(
  repoId: string,
  name: string,
  url: string,
): Promise<void> {
  return invoke<void>("add_remote", { repoId, name, url });
}

export async function removeRemote(repoId: string, name: string): Promise<void> {
  return invoke<void>("remove_remote", { repoId, name });
}

export async function renameRemote(
  repoId: string,
  from: string,
  to: string,
): Promise<void> {
  return invoke<void>("rename_remote", { repoId, from, to });
}

export async function setRemoteUrl(
  repoId: string,
  name: string,
  url: string,
): Promise<void> {
  return invoke<void>("set_remote_url", { repoId, name, url });
}

export async function pruneRemote(repoId: string, name: string): Promise<void> {
  return invoke<void>("prune_remote", { repoId, name });
}

// Re-export types for consumers who only import from tauri.ts
export type { PullMode, PushForce };

// ─── Conflict resolution ─────────────────────────────────────────────────────

export async function repoState(repoId: string): Promise<RepoState> {
  return invoke<RepoState>("repo_state", { repoId });
}

export async function conflictSides(
  repoId: string,
  path: string,
): Promise<ConflictSides> {
  return invoke<ConflictSides>("conflict_sides", { repoId, path });
}

export async function acceptOurs(repoId: string, path: string): Promise<void> {
  return invoke<void>("accept_ours", { repoId, path });
}

export async function acceptTheirs(
  repoId: string,
  path: string,
): Promise<void> {
  return invoke<void>("accept_theirs", { repoId, path });
}

export async function markResolved(
  repoId: string,
  paths: string[],
): Promise<void> {
  return invoke<void>("mark_resolved", { repoId, paths });
}

export async function saveResolution(
  repoId: string,
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("save_resolution", { repoId, path, content });
}

export async function abortOperation(repoId: string): Promise<void> {
  return invoke<void>("abort_operation", { repoId });
}

export async function continueOperation(repoId: string): Promise<string> {
  return invoke<string>("continue_operation", { repoId });
}

export async function runMergetool(
  repoId: string,
  path: string,
): Promise<void> {
  return invoke<void>("run_mergetool", { repoId, path });
}

export async function restartConflict(
  repoId: string,
  path: string,
): Promise<void> {
  return invoke<void>("restart_conflict", { repoId, path });
}

// ─── Interactive rebase ───────────────────────────────────────────────────────

/**
 * Local branches whose tips are among `oids` — the refs an update-refs rebase
 * would move (#240). Read-only, asked before the rebase so the user can still
 * say no.
 */
export async function stackedRefs(
  repoId: string,
  oids: string[],
): Promise<StackedRef[]> {
  return invoke<StackedRef[]>("stacked_refs", { repoId, oids });
}

export async function rebaseStart(
  repoId: string,
  plan: RebaseStep[],
  /**
   * Move dependent branches whose tips are inside the replayed range (#240).
   * `null` defers to the repository's own `rebase.updateRefs`.
   */
  updateRefs: boolean | null = null,
): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("rebase_start", { repoId, plan, updateRefs });
}

export async function rebaseContinue(repoId: string): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("rebase_continue", { repoId });
}

export async function rebaseAbort(repoId: string): Promise<void> {
  return invoke<void>("rebase_abort", { repoId });
}

export async function rebaseStatus(repoId: string): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("rebase_status", { repoId });
}

/**
 * Drop the retained `RebaseStatus.lastCompleted` summary. The backend holds it
 * until something has shown it, so a screen that renders the "N steps
 * completed" line calls this — otherwise the same line reappears on every later
 * poll and after a restart.
 */
export async function rebaseAcknowledge(repoId: string): Promise<void> {
  return invoke<void>("rebase_acknowledge", { repoId });
}

export async function fileHistory(
  repoId: string,
  path: string,
  limit = 200,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("file_history", { repoId, path, limit });
}

export async function appendGitignore(
  repoId: string,
  pattern: string,
): Promise<void> {
  return invoke<void>("append_gitignore", { repoId, pattern });
}

export async function openInEditor(
  repoId: string,
  relativePath: string,
): Promise<void> {
  return invoke<void>("open_in_editor", { repoId, relativePath });
}

/**
 * Hand one file's diff to the user's own diff tool (#235).
 *
 * `paths` is a LIST so a rename can pass `[oldPath, newPath]`: scoped to the new
 * path alone, `git difftool` reports a renamed file as a whole file added, which
 * is the dead end this feature exists to remove.
 *
 * `tool` is the app's optional Settings override. Omit it — the normal case —
 * and git resolves the tool itself from `diff.guitool` / `diff.tool` /
 * `merge.tool`, which is what makes this zero-config for anyone already set up.
 *
 * Resolves when the tool EXITS: `git difftool` waits for it, so this promise is
 * open for as long as the window is. Callers show an activity entry.
 */
export async function openInDifftool(
  repoId: string,
  target: DiffToolTarget,
  paths: string[],
  tool?: string | null,
): Promise<void> {
  return invoke<void>("open_in_difftool", { repoId, target, paths, tool });
}

/**
 * Reveal `relativePath` in the OS file manager, with it selected where the
 * platform allows (#215). Omitted/`null` reveals the repo's root directory
 * instead — the repo tab menu's case, which has no file to select.
 */
export async function revealInFileManager(
  repoId: string,
  relativePath?: string | null,
): Promise<void> {
  return invoke<void>("reveal_in_file_manager", { repoId, relativePath });
}

/**
 * Open a terminal at `relativePath`'s containing directory, or the repo's
 * root when `relativePath` is omitted/`null` (#215).
 */
export async function openInTerminal(
  repoId: string,
  relativePath?: string | null,
): Promise<void> {
  return invoke<void>("open_in_terminal", { repoId, relativePath });
}

/**
 * Blame one file as of HEAD (#253).
 *
 * `ignoreRevs` defaults to git's own behaviour — a configured
 * `blame.ignoreRevsFile` is honoured. Pass `false` for the un-ignored truth
 * behind the Blame screen's toggle.
 */
export async function blameFile(
  repoId: string,
  path: string,
  ignoreRevs = true,
): Promise<BlameResult> {
  return invoke<BlameResult>("blame_file", { repoId, path, ignoreRevs });
}

/**
 * Every `refs/notes/*` note on ONE commit (#253).
 *
 * Called lazily for the SELECTED commit only — never per log row. No note is
 * an empty array, at every level of absence.
 */
export async function commitNotes(
  repoId: string,
  oid: string,
): Promise<CommitNote[]> {
  return invoke<CommitNote[]>("commit_notes", { repoId, oid });
}

export async function takeLaunchIntent(): Promise<LaunchIntent | null> {
  return invoke<LaunchIntent | null>("take_launch_intent");
}

export async function cliShimStatus(): Promise<CliShimStatus> {
  return invoke<CliShimStatus>("cli_shim_status");
}

export async function installCliShim(): Promise<CliInstallOutcome> {
  return invoke<CliInstallOutcome>("install_cli_shim");
}

/**
 * Where the log is, and what machine is writing it (#274).
 *
 * The log path is per-platform and was previously undocumented anywhere the
 * user could see, which made "send me your log" a support conversation instead
 * of a click.
 */
export async function diagnosticsReport(): Promise<DiagnosticsReport> {
  return invoke<DiagnosticsReport>("diagnostics_report");
}

/**
 * The tail of the log file, ready to paste into an issue.
 *
 * A TAIL, not the whole file: the log rotates at 5 MB and the backend reads only
 * the last megabyte of it. Rejects when no log file exists yet.
 */
export async function readLogTail(): Promise<string> {
  return invoke<string>("read_log_tail");
}

/** Reveal the log file in the platform's file manager. */
export async function revealLogFile(): Promise<void> {
  return invoke<void>("reveal_log_file");
}

export function checkForUpdate(channel: UpdateChannel): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_update", { channel });
}

/**
 * Run a user-defined command (#225).
 *
 * The command string is parsed into argv and the placeholders substituted BY
 * THE BACKEND — never here, and never by a shell. See `custom_action.rs`.
 */
export function runCustomAction(
  repoId: string,
  command: string,
  context: ActionContext,
): Promise<ActionOutput> {
  return invoke<ActionOutput>("run_custom_action", { repoId, command, context });
}

export function getUpdateCapability(): Promise<UpdateCapability> {
  return invoke<UpdateCapability>("get_update_capability");
}

/**
 * Watch this repository's working directory for changes (#239), replacing any
 * existing watch. Only the ACTIVE repository is watched — a second call is a
 * swap, not an addition, so a tab switch needs no matching stop.
 */
export function watchRepo(repoId: string): Promise<void> {
  return invoke<void>("watch_repo", { repoId });
}

/** Stop watching. Idempotent — safe to call without knowing whether a watch is running. */
export function watchStop(): Promise<void> {
  return invoke<void>("watch_stop");
}

/**
 * Start a shell for this repository, or adopt the one already running (#243).
 *
 * Returns the session's EPOCH. Every `term://data` and `term://exit` event
 * carries one, and a view must drop the events whose epoch is not the one it
 * opened — a reader still mid-read when the terminal was closed and reopened
 * would otherwise paint the dead shell's last line into the new one.
 *
 * `shell` blank or omitted means the backend's default: `$SHELL` then `/bin/sh`
 * on unix, PowerShell on Windows.
 */
export function termOpen(
  repoId: string,
  rows: number,
  cols: number,
  shell?: string,
): Promise<number> {
  return invoke<number>("term_open", {
    repoId,
    rows,
    cols,
    shell: shell?.trim() ? shell : null,
  });
}

/** Send input to the shell. This is what the user typed — never log it. */
export function termWrite(repoId: string, data: string): Promise<void> {
  return invoke<void>("term_write", { repoId, data });
}

/** Tell the pty how big the renderer is, so the shell wraps where the user
 *  sees the edge and a full-screen program fills the pane. */
export function termResize(
  repoId: string,
  rows: number,
  cols: number,
): Promise<void> {
  return invoke<void>("term_resize", { repoId, rows, cols });
}

/** Kill this repository's shell. Idempotent — safe on a tab that never opened
 *  a terminal. */
export function termClose(repoId: string): Promise<void> {
  return invoke<void>("term_close", { repoId });
}

export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

/**
 * Which SSH keys are on this machine, and where a new one would go (#248).
 *
 * `host` comes from the failed challenge, and drives both the add-key link and
 * a host-specific default file name; `kind` disambiguates a self-hosted
 * instance, which a URL cannot tell apart. Both optional — the panel still
 * works without them, it just cannot link.
 */
export function sshKeyStatus(
  host?: string | null,
  kind?: ForgeKind | null,
): Promise<SshKeyStatus> {
  return invoke<SshKeyStatus>("ssh_key_status", {
    host: host ?? undefined,
    kind: kind ?? undefined,
  });
}

/**
 * Generate an ed25519 key pair, resolving with its PUBLIC half (#248).
 *
 * The passphrase in `request` is the only place it exists on this side: it is
 * component state handed straight to this call, never written to a store — the
 * same rule `CredentialDialog` follows for a credential.
 */
export function sshKeyGenerate(
  request: SshKeyGenerateRequest,
): Promise<SshKeyInfo> {
  return invoke<SshKeyInfo>("ssh_key_generate", { request });
}

export async function initRepo(
  path: string,
  initialBranch?: string,
): Promise<RepoHandle> {
  return invoke<RepoHandle>("init_repo", { path, initialBranch });
}

export async function defaultInitBranch(): Promise<string> {
  return invoke<string>("default_init_branch");
}

/**
 * Clone `url` into `parentDir/name`, resolving with the destination path.
 * Progress arrives out of band on the `clone://progress` event — listen before
 * calling, since the first tick can land before this promise settles.
 *
 * `options` carries the Advanced section's four flags (#255). They are flags on
 * the same clone, not a second one — cancel, progress and the credential retry
 * behave identically whatever is set.
 */
export async function cloneRepo(
  url: string,
  parentDir: string,
  name: string,
  options: CloneOptions,
  credentials?: Credentials,
): Promise<string> {
  return invoke<string>("clone_repo", {
    url,
    parentDir,
    name,
    options,
    credentials,
  });
}

// ─── Forge integration (GitHub / GitLab) — #92 ───────────────────────────────
//
// A forge API token is a DIFFERENT credential from the git-transport
// `Credentials` above: it authenticates an HTTP header for a host's API, not
// git's askpass prompt for one remote. The two share no type and no storage —
// see `src-tauri/src/forge/token.rs`. Nothing here ever returns a token.

/**
 * What forge, if any, this repository's remotes point at.
 *
 * `hostKinds` is the user's per-host mapping for self-hosted instances (GitHub
 * Enterprise and GitLab are indistinguishable from a URL). Resolves to `null`
 * when no remote parses as a forge — a state the UI renders, not an error.
 */
export function forgeDetect(
  repoId: string,
  hostKinds: Record<string, ForgeKind>,
): Promise<ForgeDetection | null> {
  return invoke<ForgeDetection | null>("forge_detect", { repoId, hostKinds });
}

/**
 * Validate `token` against `host`'s API and then store it, resolving with the
 * identity it belongs to. Validation happens FIRST: storing on submit would
 * persist a typo into the user's keychain.
 */
export function forgeSignIn(
  host: string,
  kind: ForgeKind,
  token: string,
): Promise<ForgeIdentity> {
  return invoke<ForgeIdentity>("forge_sign_in", { host, kind, token });
}

/** Whether `host` has a stored token. Does NOT hit the network. */
export function forgeTokenStatus(host: string): Promise<ForgeTokenStatus> {
  return invoke<ForgeTokenStatus>("forge_token_status", { host });
}

/** Re-probe the stored token and report who it belongs to. */
export function forgeValidateToken(
  host: string,
  kind: ForgeKind,
): Promise<ForgeIdentity> {
  return invoke<ForgeIdentity>("forge_validate_token", { host, kind });
}

/** Forget the token for `host`. */
export function forgeSignOut(host: string): Promise<void> {
  return invoke<void>("forge_sign_out", { host });
}

export function forgeListPullRequests(
  forge: ForgeRepo,
): Promise<PullRequest[]> {
  return invoke<PullRequest[]>("forge_list_pull_requests", { forge });
}

/**
 * CI verdict for one commit. Deliberately per-request rather than per-row:
 * GitHub's PR list carries no status, so a column would cost one request per row
 * on every refresh.
 */
export function forgePullRequestChecks(
  forge: ForgeRepo,
  sha: string,
): Promise<ChecksSummary> {
  return invoke<ChecksSummary>("forge_pull_request_checks", { forge, sha });
}

export function forgeCreatePullRequest(
  forge: ForgeRepo,
  request: NewPullRequest,
): Promise<PullRequest> {
  return invoke<PullRequest>("forge_create_pull_request", { forge, request });
}

/**
 * Check out a pull request's head as a local branch.
 *
 * Fetches the ref the forge synthesises on the BASE repository
 * (`refs/pull/N/head` / `refs/merge-requests/N/head`), so a fork request needs no
 * knowledge of the fork. Rejects with `BranchExists` when `localBranch` already
 * exists and `force` is false — confirm, then retry with `force: true`.
 *
 * The fetch uses an ordinary git-transport credential, so an `Auth` rejection is
 * the existing credential-retry path's (#61 D5). The forge token is not used here.
 */
export function forgeCheckoutPullRequest(
  request: ForgeCheckoutRequest,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("forge_checkout_pull_request", { request, credentials });
}

// ─── Submodules (#93) ─────────────────────────────────────────────────────────

export async function listSubmodules(repoId: string): Promise<SubmoduleInfo[]> {
  return invoke<SubmoduleInfo[]>("list_submodules", { repoId });
}

/** `git submodule init` — copy `.gitmodules`' url into `.git/config`. */
export async function submoduleInit(
  repoId: string,
  path?: string | null,
): Promise<void> {
  return invoke<void>("submodule_init", { repoId, path });
}

/** `git submodule sync` — re-copy `.gitmodules`' urls over `.git/config`'s. */
export async function submoduleSync(
  repoId: string,
  path?: string | null,
): Promise<void> {
  return invoke<void>("submodule_sync", { repoId, path });
}

/**
 * `git submodule update` — check out the recorded commit, fetching it if needed.
 *
 * Can hit the network, so it follows the fetch/pull/push contract: the first
 * attempt is prompt-less and an authenticating remote raises `Auth`, which
 * `withAuthRetry` re-runs with credentials.
 */
export async function submoduleUpdate(
  repoId: string,
  path: string | null,
  recursive: boolean,
  init: boolean,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("submodule_update", {
    repoId,
    path,
    recursive,
    init,
    credentials,
  });
}

// ─── Linked worktrees (#93) ───────────────────────────────────────────────────

export async function listWorktrees(repoId: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>("list_worktrees", { repoId });
}

export async function worktreeAdd(
  repoId: string,
  path: string,
  branch: WorktreeBranch,
): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>("worktree_add", { repoId, path, branch });
}

/**
 * Remove a worktree. Without `force`, git refuses on uncommitted work and the
 * rejection arrives as `DirtyWorktree` — only pass `force` behind a SECOND,
 * explicit confirmation.
 */
export async function worktreeRemove(
  repoId: string,
  name: string,
  force: boolean,
): Promise<void> {
  return invoke<void>("worktree_remove", { repoId, name, force });
}

export async function worktreeLock(
  repoId: string,
  name: string,
  reason?: string | null,
): Promise<void> {
  return invoke<void>("worktree_lock", { repoId, name, reason });
}

export async function worktreeUnlock(
  repoId: string,
  name: string,
): Promise<void> {
  return invoke<void>("worktree_unlock", { repoId, name });
}

/** Prune every prunable worktree, resolving with the names that went. */
export async function worktreePrune(repoId: string): Promise<string[]> {
  return invoke<string[]>("worktree_prune", { repoId });
}

// ─── git-LFS (#93) ────────────────────────────────────────────────────────────

export async function lfsStatus(repoId: string): Promise<LfsStatus> {
  return invoke<LfsStatus>("lfs_status", { repoId });
}

/** Materialize pointers whose objects are already downloaded. Local. */
export async function lfsCheckout(repoId: string): Promise<void> {
  return invoke<void>("lfs_checkout", { repoId });
}

/** Download objects into `.git/lfs` without touching the worktree. */
export async function lfsFetch(
  repoId: string,
  remote?: string | null,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("lfs_fetch", { repoId, remote, credentials });
}

/** Fetch AND materialize (`git lfs pull` = fetch + checkout). */
export async function lfsPull(
  repoId: string,
  remote?: string | null,
  credentials?: Credentials,
): Promise<void> {
  return invoke<void>("lfs_pull", { repoId, remote, credentials });
}

// ─── Bisect (#93) ─────────────────────────────────────────────────────────────

export async function bisectStatus(repoId: string): Promise<BisectStatus> {
  return invoke<BisectStatus>("bisect_status", { repoId });
}

/** `good` may be empty — git then waits for a good revision. */
export async function bisectStart(
  repoId: string,
  bad: string,
  good: string[],
): Promise<BisectStatus> {
  return invoke<BisectStatus>("bisect_start", { repoId, bad, good });
}

/** Mark `rev` (or HEAD when omitted) and let git pick the next revision. */
export async function bisectMark(
  repoId: string,
  mark: BisectMark,
  rev?: string | null,
): Promise<BisectStatus> {
  return invoke<BisectStatus>("bisect_mark", { repoId, mark, rev });
}

/** `git bisect reset` — return to where the bisect started. */
export async function bisectReset(repoId: string): Promise<void> {
  return invoke<void>("bisect_reset", { repoId });
}
