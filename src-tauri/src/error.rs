use serde::Serialize;

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("path is not a git repository: {0}")]
    NotARepo(String),

    #[error("repository not found: {0}")]
    UnknownRepo(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("git error: {0}")]
    Git(String),

    #[error("not implemented")]
    NotImplemented,

    #[error("repository has no HEAD yet")]
    Unborn,

    #[error("invalid reference: {0}")]
    InvalidRef(String),

    #[error("worktree is dirty: {0}")]
    DirtyWorktree(String),

    #[error("branch not fully merged: {0}")]
    NotMerged(String),

    #[error("operation produced conflicts: {0}")]
    ConflictsDetected(String),

    #[error("no signature configured (set user.name and user.email)")]
    NoSignature,

    #[error("internal error: {0}")]
    Internal(String),
}

impl From<git2::Error> for AppError {
    fn from(e: git2::Error) -> Self {
        AppError::Git(e.message().to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
