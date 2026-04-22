pub mod cli;
pub mod libgit2;
pub mod signature;
pub mod types;

use std::path::{Path, PathBuf};

use crate::error::AppResult;
use types::{
    BranchInfo, CommitInfo, CommitOptions, DiffKind, FileDiff, FileStatus, RemoteInfo, RepoHandle,
    RepoId, StashInfo, TagInfo,
};

pub trait GitBackend: Send + Sync {
    fn open(&self, path: &Path) -> AppResult<RepoHandle>;
    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>>;
    fn log(&self, repo_id: &RepoId, limit: usize) -> AppResult<Vec<CommitInfo>>;
    fn diff(&self, repo_id: &RepoId, path: &Path, kind: DiffKind) -> AppResult<FileDiff>;
    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String>;
    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>>;
    fn tags(&self, repo_id: &RepoId) -> AppResult<Vec<TagInfo>>;
    fn stashes(&self, repo_id: &RepoId) -> AppResult<Vec<StashInfo>>;
    fn remotes(&self, repo_id: &RepoId) -> AppResult<Vec<RemoteInfo>>;
    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()>;
    fn fetch(&self, repo_id: &RepoId, remote: &str) -> AppResult<()>;
    fn pull(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
    fn push(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
}
