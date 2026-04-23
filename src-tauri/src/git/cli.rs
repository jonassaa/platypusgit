use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

use super::{
    types::{
        BranchInfo, CommitInfo, CommitOptions, ConflictSides, DiffKind, FileDiff, FileStatus,
        RebaseStatus, RebaseStep, ReflogEntry, RemoteInfo, RepoHandle, RepoId, RepoState,
        ResetMode, StashInfo, StashSaveOptions, TagInfo, TagTarget,
    },
    GitBackend,
};

/// Shells out to the `git` CLI for operations libgit2 handles poorly
/// (complex merges, LFS, credential helpers). Stub for now.
pub struct CliBackend;

impl CliBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for CliBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl GitBackend for CliBackend {
    fn open(&self, _path: &Path) -> AppResult<RepoHandle> {
        Err(AppError::NotImplemented)
    }
    fn status(&self, _repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        Err(AppError::NotImplemented)
    }
    fn list_all_files(&self, _repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        Err(AppError::NotImplemented)
    }
    fn log(&self, _repo_id: &RepoId, _limit: usize) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn diff(&self, _repo_id: &RepoId, _path: &Path, _kind: DiffKind) -> AppResult<FileDiff> {
        Err(AppError::NotImplemented)
    }
    fn diff_commits(
        &self,
        _repo_id: &RepoId,
        _from_oid: &str,
        _to_oid: &str,
    ) -> AppResult<Vec<FileDiff>> {
        Err(AppError::NotImplemented)
    }
    fn stage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn unstage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn discard(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stage_hunk(&self, _repo_id: &RepoId, _path: &Path, _hunk_index: usize) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn unstage_hunk(&self, _repo_id: &RepoId, _path: &Path, _hunk_index: usize) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn discard_hunk(&self, _repo_id: &RepoId, _path: &Path, _hunk_index: usize) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn commit(&self, _repo_id: &RepoId, _opts: CommitOptions) -> AppResult<String> {
        Err(AppError::NotImplemented)
    }
    fn branches(&self, _repo_id: &RepoId) -> AppResult<Vec<BranchInfo>> {
        Err(AppError::NotImplemented)
    }
    fn tags(&self, _repo_id: &RepoId) -> AppResult<Vec<TagInfo>> {
        Err(AppError::NotImplemented)
    }
    fn stashes(&self, _repo_id: &RepoId) -> AppResult<Vec<StashInfo>> {
        Err(AppError::NotImplemented)
    }
    fn remotes(&self, _repo_id: &RepoId) -> AppResult<Vec<RemoteInfo>> {
        Err(AppError::NotImplemented)
    }
    fn checkout_branch(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn create_branch(&self, _repo_id: &RepoId, _name: &str, _from: Option<&str>) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn delete_branch(&self, _repo_id: &RepoId, _name: &str, _force: bool) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn rename_branch(&self, _repo_id: &RepoId, _from: &str, _to: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn create_tag(&self, _repo_id: &RepoId, _name: &str, _target: TagTarget) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn delete_tag(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn checkout_detached(&self, _repo_id: &RepoId, _oid: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn reset(&self, _repo_id: &RepoId, _target: &str, _mode: ResetMode) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn cherry_pick(&self, _repo_id: &RepoId, _oid: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn revert(&self, _repo_id: &RepoId, _oid: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_save(&self, _repo_id: &RepoId, _opts: StashSaveOptions) -> AppResult<Option<String>> {
        Err(AppError::NotImplemented)
    }
    fn stash_apply(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_pop(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_drop(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_branch(&self, _repo_id: &RepoId, _index: usize, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn repo_path(&self, _repo_id: &RepoId) -> AppResult<PathBuf> {
        Err(AppError::NotImplemented)
    }
    fn add_remote(&self, _repo_id: &RepoId, _name: &str, _url: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn remove_remote(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn rename_remote(&self, _repo_id: &RepoId, _from: &str, _to: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn set_remote_url(&self, _repo_id: &RepoId, _name: &str, _url: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn prune_remote(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn repo_state(&self, _repo_id: &RepoId) -> AppResult<RepoState> {
        Err(AppError::NotImplemented)
    }
    fn conflict_sides(&self, _repo_id: &RepoId, _path: &Path) -> AppResult<ConflictSides> {
        Err(AppError::NotImplemented)
    }
    fn accept_ours(&self, _repo_id: &RepoId, _path: &Path) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn accept_theirs(&self, _repo_id: &RepoId, _path: &Path) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn mark_resolved(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn abort_operation(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn continue_operation(&self, _repo_id: &RepoId) -> AppResult<String> {
        Err(AppError::NotImplemented)
    }
    fn rebase_start(&self, _repo_id: &RepoId, _plan: Vec<RebaseStep>) -> AppResult<RebaseStatus> {
        Err(AppError::NotImplemented)
    }
    fn rebase_continue(&self, _repo_id: &RepoId) -> AppResult<RebaseStatus> {
        Err(AppError::NotImplemented)
    }
    fn rebase_abort(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn rebase_status(&self, _repo_id: &RepoId) -> AppResult<RebaseStatus> {
        Err(AppError::NotImplemented)
    }
    fn fetch(&self, _repo_id: &RepoId, _remote: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn pull(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn push(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn read_reflog(&self, _repo_id: &RepoId) -> AppResult<Vec<ReflogEntry>> {
        Err(AppError::NotImplemented)
    }
    fn append_gitignore(&self, _repo_id: &RepoId, _pattern: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
}
