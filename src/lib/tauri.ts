import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { debug as logDebug, warn as logWarn, error as logError } from "@tauri-apps/plugin-log";
import type {
  BlameLine,
  BranchInfo,
  CliInstallOutcome,
  CliShimStatus,
  CommitInfo,
  ConflictSides,
  DiffKind,
  FileContent,
  FileDiff,
  FileStatus,
  LaunchIntent,
  LogFilter,
  PullMode,
  PushForce,
  RebaseStatus,
  RebaseStep,
  ReflogEntry,
  RemoteInfo,
  RepoHandle,
  RepoState,
  StashInfo,
  TagInfo,
} from "./types";

const SLOW_INVOKE_MS = 250;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const start = performance.now();
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
    logError(`invoke ${cmd} failed after ${ms}ms: ${String(err)}`);
    throw err;
  }
}

export async function openRepo(path: string): Promise<RepoHandle> {
  return invoke<RepoHandle>("open_repo", { path });
}

export async function getStatus(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_status", { repoId });
}

export async function listAllFiles(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("list_all_files", { repoId });
}

export async function readFileContent(
  repoId: string,
  path: string,
): Promise<FileContent> {
  return invoke<FileContent>("read_file_content", { repoId, path });
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

/** Read a file's content from the tree at `revspec`. */
export async function readFileContentAtRev(
  repoId: string,
  revspec: string,
  path: string,
): Promise<FileContent> {
  return invoke<FileContent>("read_file_content_at_rev", {
    repoId,
    revspec,
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

export async function getDiff(
  repoId: string,
  path: string,
  kind: DiffKind = "WorktreeToIndex",
  contextLines = 3,
): Promise<FileDiff> {
  return invoke<FileDiff>("get_diff", { repoId, path, kind, contextLines });
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
): Promise<FileDiff[]> {
  return invoke<FileDiff[]>("diff_commits", { repoId, fromOid, toOid, contextLines });
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
): Promise<string> {
  return invoke<string>("commit", { repoId, message, amend, signoff });
}

export async function discardPaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("discard_paths", { repoId, paths });
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

export async function checkoutBranch(repoId: string, name: string): Promise<void> {
  return invoke<void>("checkout_branch", { repoId, name });
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

export interface TagTarget {
  oid: string;
  annotation: string | null;
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

export async function pushTag(
  repoId: string,
  remote: string,
  name: string,
): Promise<void> {
  return invoke<void>("push_tag", { repoId, remote, name });
}

export async function pushDeleteBranch(
  repoId: string,
  remote: string,
  name: string,
): Promise<void> {
  return invoke<void>("push_delete_branch", { repoId, remote, name });
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

export async function stashDrop(repoId: string, index: number): Promise<void> {
  return invoke<void>("stash_drop", { repoId, index });
}

export async function stashBranch(
  repoId: string,
  index: number,
  branch: string,
): Promise<void> {
  return invoke<void>("stash_branch", { repoId, index, branch });
}

// ─── Network operations ──────────────────────────────────────────────────────

/** Fetch a single remote, pruning deleted remote refs. */
export async function fetch(
  repoId: string,
  remote: string,
  prune = true,
): Promise<void> {
  return invoke<void>("fetch", { repoId, remote, prune });
}

/** Fetch all remotes, pruning deleted remote refs. */
export async function fetchAll(repoId: string, prune = true): Promise<void> {
  return invoke<void>("fetch_all", { repoId, prune });
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
): Promise<void> {
  return invoke<void>("pull", { repoId, remote, branch, mode });
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
): Promise<void> {
  return invoke<void>("push", { repoId, remote, branch, force });
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

export async function rebaseStart(
  repoId: string,
  plan: RebaseStep[],
): Promise<RebaseStatus> {
  return invoke<RebaseStatus>("rebase_start", { repoId, plan });
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

export async function blameFile(
  repoId: string,
  path: string,
): Promise<BlameLine[]> {
  return invoke<BlameLine[]>("blame_file", { repoId, path });
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
