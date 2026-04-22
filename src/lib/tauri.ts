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
