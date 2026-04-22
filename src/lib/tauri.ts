import { invoke } from "@tauri-apps/api/core";
import type {
  BranchInfo,
  CommitInfo,
  DiffKind,
  FileDiff,
  FileStatus,
  RemoteInfo,
  RepoHandle,
  StashInfo,
  TagInfo,
} from "./types";

export async function openRepo(path: string): Promise<RepoHandle> {
  return invoke<RepoHandle>("open_repo", { path });
}

export async function getStatus(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_status", { repoId });
}

export async function getLog(
  repoId: string,
  limit?: number,
): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>("get_log", { repoId, limit });
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
): Promise<FileDiff> {
  return invoke<FileDiff>("get_diff", { repoId, path, kind });
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
): Promise<string> {
  return invoke<string>("commit", { repoId, message, amend });
}

export async function discardPaths(repoId: string, paths: string[]): Promise<void> {
  return invoke<void>("discard_paths", { repoId, paths });
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
