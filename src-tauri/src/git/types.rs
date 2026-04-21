use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct RepoId(pub String);

#[derive(Debug, Clone, Serialize)]
pub struct RepoHandle {
    pub id: RepoId,
    pub path: PathBuf,
    pub head: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum StatusFlag {
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Typechange,
    Untracked,
    Ignored,
    Conflicted,
}

#[derive(Debug, Clone, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub worktree: StatusFlag,
    pub index: StatusFlag,
}

#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub oid: String,
    pub summary: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub parents: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub upstream: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffKind {
    WorktreeToIndex,
    IndexToHead,
    WorktreeToHead,
}

#[derive(Debug, Clone, Serialize)]
pub struct DiffHunks {
    pub path: String,
    pub hunks: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitOptions {
    pub message: String,
    pub amend: bool,
    pub author_override: Option<AuthorOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorOverride {
    pub name: String,
    pub email: String,
}
