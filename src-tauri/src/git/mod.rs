pub mod types;
pub mod libgit2;
pub mod cli;

use std::path::{Path, PathBuf};

use crate::error::AppResult;
use types::{
    BranchInfo, CommitInfo, CommitOptions, DiffHunks, DiffKind, FileStatus, RepoHandle, RepoId,
};

pub trait GitBackend: Send + Sync {
    fn open(&self, path: &Path) -> AppResult<RepoHandle>;
    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>>;
    fn log(&self, repo_id: &RepoId, limit: usize) -> AppResult<Vec<CommitInfo>>;
    fn diff(&self, repo_id: &RepoId, path: &Path, kind: DiffKind) -> AppResult<DiffHunks>;
    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String>;
    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>>;
    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()>;
    fn fetch(&self, repo_id: &RepoId, remote: &str) -> AppResult<()>;
    fn pull(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
    fn push(&self, repo_id: &RepoId, remote: &str, branch: &str) -> AppResult<()>;
}
