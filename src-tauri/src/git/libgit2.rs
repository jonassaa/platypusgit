use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use git2::{Repository, Status, StatusOptions};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    types::{
        BranchInfo, CommitInfo, CommitOptions, DiffHunks, DiffKind, FileStatus, RepoHandle,
        RepoId, StatusFlag,
    },
    GitBackend,
};

pub struct Libgit2Backend {
    repos: Mutex<HashMap<RepoId, Mutex<Repository>>>,
}

impl Libgit2Backend {
    pub fn new() -> Self {
        Self {
            repos: Mutex::new(HashMap::new()),
        }
    }

    fn with_repo<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&Repository) -> AppResult<T>,
    {
        let map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let repo_cell = map
            .get(repo_id)
            .ok_or_else(|| AppError::UnknownRepo(repo_id.0.clone()))?;
        let repo = repo_cell
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        f(&repo)
    }
}

impl Default for Libgit2Backend {
    fn default() -> Self {
        Self::new()
    }
}

enum StatusSide {
    Worktree,
    Index,
}

fn map_status_flag(s: Status, side: StatusSide) -> StatusFlag {
    match side {
        StatusSide::Worktree => {
            if s.contains(Status::CONFLICTED) {
                StatusFlag::Conflicted
            } else if s.contains(Status::WT_NEW) {
                StatusFlag::Untracked
            } else if s.contains(Status::WT_MODIFIED) {
                StatusFlag::Modified
            } else if s.contains(Status::WT_DELETED) {
                StatusFlag::Deleted
            } else if s.contains(Status::WT_RENAMED) {
                StatusFlag::Renamed
            } else if s.contains(Status::WT_TYPECHANGE) {
                StatusFlag::Typechange
            } else if s.contains(Status::IGNORED) {
                StatusFlag::Ignored
            } else {
                StatusFlag::Unmodified
            }
        }
        StatusSide::Index => {
            if s.contains(Status::INDEX_NEW) {
                StatusFlag::Added
            } else if s.contains(Status::INDEX_MODIFIED) {
                StatusFlag::Modified
            } else if s.contains(Status::INDEX_DELETED) {
                StatusFlag::Deleted
            } else if s.contains(Status::INDEX_RENAMED) {
                StatusFlag::Renamed
            } else if s.contains(Status::INDEX_TYPECHANGE) {
                StatusFlag::Typechange
            } else {
                StatusFlag::Unmodified
            }
        }
    }
}

impl GitBackend for Libgit2Backend {
    fn open(&self, path: &Path) -> AppResult<RepoHandle> {
        if !path.exists() {
            return Err(AppError::InvalidPath(path.display().to_string()));
        }
        let repo = Repository::open(path).map_err(|e| {
            if e.code() == git2::ErrorCode::NotFound {
                AppError::NotARepo(path.display().to_string())
            } else {
                AppError::from(e)
            }
        })?;

        let head = match repo.head() {
            Ok(r) => r.shorthand().map(|s| s.to_string()),
            Err(e)
                if e.code() == git2::ErrorCode::UnbornBranch
                    || e.code() == git2::ErrorCode::NotFound =>
            {
                None
            }
            Err(e) => return Err(e.into()),
        };

        let id = RepoId(Uuid::new_v4().to_string());
        let workdir = repo
            .workdir()
            .map(PathBuf::from)
            .unwrap_or_else(|| path.to_path_buf());

        let mut map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        map.insert(id.clone(), Mutex::new(repo));

        Ok(RepoHandle {
            id,
            path: workdir,
            head,
        })
    }

    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        self.with_repo(repo_id, |repo| {
            let mut opts = StatusOptions::new();
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false);
            let statuses = repo.statuses(Some(&mut opts))?;
            let mut out = Vec::with_capacity(statuses.len());
            for entry in statuses.iter() {
                let path = entry.path().unwrap_or("").to_string();
                let s = entry.status();
                out.push(FileStatus {
                    path,
                    worktree: map_status_flag(s, StatusSide::Worktree),
                    index: map_status_flag(s, StatusSide::Index),
                });
            }
            Ok(out)
        })
    }

    fn log(&self, _repo_id: &RepoId, _limit: usize) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn diff(&self, _repo_id: &RepoId, _path: &Path, _kind: DiffKind) -> AppResult<DiffHunks> {
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
