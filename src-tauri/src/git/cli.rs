use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

use super::{
    types::{
        BranchInfo, CommitInfo, CommitOptions, DiffKind, FileDiff, FileStatus, RemoteInfo,
        RepoHandle, RepoId, StashInfo, TagInfo,
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
    fn log(&self, _repo_id: &RepoId, _limit: usize) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn diff(&self, _repo_id: &RepoId, _path: &Path, _kind: DiffKind) -> AppResult<FileDiff> {
        Err(AppError::NotImplemented)
    }
    fn stage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn unstage(&self, _repo_id: &RepoId, _paths: &[PathBuf]) -> AppResult<()> {
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
    fn fetch(&self, _repo_id: &RepoId, _remote: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn pull(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn push(&self, _repo_id: &RepoId, _remote: &str, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
}
