use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
pub struct RepoId(pub String);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub path: String,
    pub worktree: StatusFlag,
    pub index: StatusFlag,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub body: Option<String>,
    pub author: String,
    pub email: String,
    /// Unix timestamp, seconds.
    pub timestamp: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

/// Filter applied to the commit log walk. All fields are ANDed together;
/// an all-`None`/empty filter matches every commit (equivalent to a plain log).
/// String matches are case-insensitive substring matches except `sha_prefix`,
/// which matches a prefix of the full OID (hex).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilter {
    /// Substring of the commit message (summary + body), case-insensitive.
    pub message: Option<String>,
    /// Substring of the author name OR email, case-insensitive.
    pub author: Option<String>,
    /// Prefix of the commit OID (hex, case-insensitive).
    pub sha_prefix: Option<String>,
    /// Lower bound on commit time (unix seconds, inclusive).
    pub since: Option<i64>,
    /// Upper bound on commit time (unix seconds, inclusive).
    pub until: Option<i64>,
    /// Only commits that touched this path (relative to repo root).
    pub path: Option<String>,
}

impl LogFilter {
    /// True when no filter dimension is set — the walk can skip per-commit checks.
    pub fn is_empty(&self) -> bool {
        self.message.as_deref().map(str::trim).unwrap_or("").is_empty()
            && self.author.as_deref().map(str::trim).unwrap_or("").is_empty()
            && self.sha_prefix.as_deref().map(str::trim).unwrap_or("").is_empty()
            && self.since.is_none()
            && self.until.is_none()
            && self.path.as_deref().map(str::trim).unwrap_or("").is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub tip: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub short_oid: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    pub index: usize,
    pub short_oid: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DiffKind {
    WorktreeToIndex,
    IndexToHead,
    WorktreeToHead,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind")]
pub enum DiffLineKind {
    Context,
    Addition,
    Deletion,
    HunkHeader,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
    pub content: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub old_path: Option<String>,
    pub binary: bool,
    pub additions: u32,
    pub deletions: u32,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub binary: bool,
    /// None when `binary` is true, or when the file is missing.
    pub text: Option<String>,
    /// True when the file only exists in HEAD (deleted from worktree).
    pub from_head: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    pub message: String,
    pub amend: bool,
    pub author_override: Option<AuthorOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorOverride {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResetMode {
    Soft,
    Mixed,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagTarget {
    pub oid: String,
    /// None = lightweight tag; Some = annotated tag with this message.
    pub annotation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashSaveOptions {
    pub message: Option<String>,
    pub include_untracked: bool,
    pub keep_index: bool,
}

/// The current operation state of a repository.
/// Mirrors `git2::RepositoryState`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum RepoState {
    Clean,
    Merge,
    Revert,
    RevertSequence,
    CherryPick,
    CherryPickSequence,
    Bisect,
    Rebase,
    RebaseInteractive,
    RebaseMerge,
    ApplyMailbox,
    ApplyMailboxOrRebase,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    /// 1-indexed line number in the current version of the file.
    pub line_no: u32,
    /// Commit OID that last modified this line.
    pub oid: String,
    pub short_oid: String,
    pub author: String,
    pub email: String,
    pub timestamp: i64,
    pub summary: String,
    pub content: String,
}

/// Content of the three index stages for a conflicted file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSides {
    pub path: String,
    /// Stage 1 — common ancestor. None when no common ancestor exists (both sides added).
    pub base: Option<String>,
    /// Stage 2 — HEAD / ours.
    pub ours: Option<String>,
    /// Stage 3 — incoming / theirs.
    pub theirs: Option<String>,
    /// True when any side is binary; all three string fields will be None.
    pub binary: bool,
}

// ─── Interactive rebase ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    /// Commit to operate on (full OID from the log).
    pub oid: String,
    pub action: RebaseAction,
    /// New message for reword / squash. Ignored for other actions.
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStatus {
    /// True when a rebase is in progress.
    pub in_progress: bool,
    /// Zero-based index of the next step to process (equals total when done).
    pub next_index: usize,
    pub total: usize,
    /// "conflict" | "edit" | "ok" — only meaningful when in_progress is true.
    pub pause_reason: Option<String>,
}

/// How to integrate fetched changes during a pull.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PullMode {
    /// `--ff-only`: refuse if not a fast-forward.
    FastForward,
    /// Default merge commit.
    Merge,
    /// `--rebase`: rebase local commits on top of upstream.
    Rebase,
}

/// Whether to force-push and what safety level.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PushForce {
    /// No force flag — reject if remote has diverged.
    None,
    /// `--force-with-lease`: safe force; aborts if someone else pushed.
    WithLease,
    /// `--force`: unconditional overwrite. Use with care.
    Force,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "detail")]
pub enum ReflogOp {
    Commit,
    Amend,
    Reset,
    Checkout,
    Merge,
    Rebase,
    Pull,
    Clone,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    pub oid: String,
    pub short_oid: String,
    pub message: String,
    pub op: ReflogOp,
    pub timestamp: i64,
}
