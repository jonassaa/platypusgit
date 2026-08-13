pub mod cli;
pub mod libgit2;
pub mod ownership;
pub mod signature;
pub mod types;

use std::path::{Path, PathBuf};

use crate::error::AppResult;
use types::{
    BlameLine, BranchInfo, CommitInfo, CommitOptions, ConflictSides, DiffKind, FileContent,
    FileDiff, FileStatus, LogFilter, LogPage, RebaseStatus, RebaseStep, ReflogEntry, RemoteInfo,
    RepoHandle,
    RepoId, RepoState, ResetMode, StashInfo, StashSaveOptions, TagInfo, TagTarget,
};


pub trait GitBackend: Send + Sync {
    // === existing reads ===
    fn open(&self, path: &Path) -> AppResult<RepoHandle>;
    /// Create a new repository at `path` and register it, returning its handle.
    ///
    /// Shaped like `open` rather than the `repo_id` methods below: there is no
    /// repository to address yet. `initial_branch` overrides the configured
    /// default; `None` resolves `init.defaultBranch`, falling back to `main`.
    fn init(&self, path: &Path, initial_branch: Option<&str>) -> AppResult<RepoHandle>;
    /// Record `path` in the user's global `safe.directory` list so libgit2
    /// will open it despite an ownership mismatch (`AppError::DubiousOwnership`).
    ///
    /// A security exception, so call it only after the user has explicitly
    /// confirmed. Shaped like `open` rather than the `repo_id` methods: by
    /// definition there is no open repository to address.
    fn trust_path(&self, path: &Path) -> AppResult<()>;
    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>>;
    /// Like `status`, but also includes tracked-but-unmodified files so UIs
    /// can browse the whole worktree (ignored files are still excluded).
    fn list_all_files(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>>;
    /// Commit log, newest-first, up to `limit`. `refspec` picks the walk
    /// start: `None` walks from HEAD (empty result on an unborn HEAD);
    /// `Some(spec)` walks from any revspec (branch, tag, short/full oid) —
    /// `InvalidRef` if the revspec can't be resolved to a commit.
    fn log(
        &self,
        repo_id: &RepoId,
        refspec: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>>;
    /// Like `log`, but only returns commits matching `filter`. The `limit`
    /// caps the number of *matching* commits returned (newest-first), so the
    /// walk may visit more than `limit` commits to fill the result. An empty
    /// filter behaves like `log`. `refspec` scopes the walk exactly as in
    /// `log`.
    fn log_filtered(
        &self,
        repo_id: &RepoId,
        filter: &LogFilter,
        refspec: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>>;
    /// One page of `log`, resumable via `cursor` (#68 G11).
    ///
    /// `cursor` is the frontier returned by the previous page — the set of
    /// parents still awaited when it ended. When `cursor` is `Some`, `refspec`
    /// is IGNORED: the frontier already encodes where this walk came from.
    /// `next_cursor` is `None` at the true end of history.
    fn log_page(
        &self,
        repo_id: &RepoId,
        refspec: Option<&str>,
        cursor: Option<&[String]>,
        limit: usize,
    ) -> AppResult<LogPage>;
    /// Like `log_page`, but only counts commits matching `filter` toward
    /// `limit`. The frontier comes from every commit VISITED, not just the
    /// matches — resuming from the matches' parents would skip the
    /// non-matching commits between them and lose their ancestors.
    fn log_filtered_page(
        &self,
        repo_id: &RepoId,
        filter: &LogFilter,
        refspec: Option<&str>,
        cursor: Option<&[String]>,
        limit: usize,
    ) -> AppResult<LogPage>;
    /// Commits reachable from HEAD but not from `base` (the `base..HEAD` range),
    /// newest-first. `base` is any revspec — branch, tag, short or full oid.
    /// Errors with `InvalidRef` if `base` can't be resolved or is not an
    /// ancestor of HEAD (a rebase base must be reachable from HEAD).
    fn commits_since(&self, repo_id: &RepoId, base: &str) -> AppResult<Vec<CommitInfo>>;
    /// Commits that touched `path`, newest first, up to `limit`.
    fn file_history(
        &self,
        repo_id: &RepoId,
        path: &Path,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>>;
    fn blame_file(&self, repo_id: &RepoId, path: &Path) -> AppResult<Vec<BlameLine>>;
    fn read_reflog(&self, repo_id: &RepoId) -> AppResult<Vec<ReflogEntry>>;
    /// Diff a single file. `context_lines` controls how many unchanged lines
    /// surround each hunk (git default: 3).
    ///
    /// `ignore_whitespace` turns lines that differ only in whitespace into
    /// context lines. It is a VIEWING option only: the hunks it produces are
    /// not the hunks git would apply, so a hunk index taken from such a diff
    /// must never be fed to `stage_hunk`/`unstage_hunk`/`discard_hunk` — see
    /// the note on those.
    fn diff(
        &self,
        repo_id: &RepoId,
        path: &Path,
        kind: DiffKind,
        context_lines: u32,
        ignore_whitespace: bool,
    ) -> AppResult<FileDiff>;
    /// Read the full content of a file from the worktree. Falls back to the
    /// HEAD blob when the worktree copy is missing (e.g. a deleted file).
    fn read_file_content(&self, repo_id: &RepoId, path: &Path) -> AppResult<FileContent>;
    /// List every file in the tree at `revspec` (commit, branch, tag, or any
    /// revspec). Resolves the revspec to a tree and walks it recursively.
    /// Returns `FileStatus` entries with both sides `Unmodified` — the tree is
    /// a historical snapshot, not the working state. `InvalidRef` if the
    /// revspec can't be resolved.
    fn list_files_at_rev(&self, repo_id: &RepoId, revspec: &str) -> AppResult<Vec<FileStatus>>;
    /// Read the content of `path` from the tree at `revspec`. `InvalidRef` if
    /// the revspec can't be resolved; `InvalidPath` if the path isn't in that
    /// tree. The returned `FileContent.from_head` is true (content is from a
    /// committed tree, not the worktree).
    fn read_file_content_at_rev(
        &self,
        repo_id: &RepoId,
        revspec: &str,
        path: &Path,
    ) -> AppResult<FileContent>;
    fn diff_commits(
        &self,
        repo_id: &RepoId,
        from_oid: &str,
        to_oid: &str,
        context_lines: u32,
        ignore_whitespace: bool,
    ) -> AppResult<Vec<FileDiff>>;
    /// Diff a single commit against its first parent — i.e. "what this commit
    /// changed." A root commit (no parent) diffs against the empty tree
    /// (all-added); a merge commit diffs against its first parent (git-show
    /// default). Distinct from `diff_commits`, which cannot express the
    /// empty-tree case for a root commit.
    fn diff_commit(
        &self,
        repo_id: &RepoId,
        oid: &str,
        context_lines: u32,
        ignore_whitespace: bool,
    ) -> AppResult<Vec<FileDiff>>;
    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>>;
    fn tags(&self, repo_id: &RepoId) -> AppResult<Vec<TagInfo>>;
    fn stashes(&self, repo_id: &RepoId) -> AppResult<Vec<StashInfo>>;
    fn remotes(&self, repo_id: &RepoId) -> AppResult<Vec<RemoteInfo>>;

    /// Return the working-directory path for a given open repo.
    /// Used by network commands that shell out to git CLI.
    fn repo_path(&self, repo_id: &RepoId) -> AppResult<PathBuf>;

    // === index writes ===
    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    fn discard(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;

    // === hunk-level staging ===
    // Hunk indices are positions in the diff produced with `context_lines`.
    // Callers MUST pass the same `context_lines` they used for the `diff` that
    // displayed the hunks — a different context width can merge/split hunks
    // and shift indices, applying the wrong hunk.
    //
    // For the same reason these take no `ignore_whitespace`: that flag rewrites
    // whitespace-only changes into context lines, so its hunks neither line up
    // with these indices nor describe a patch that would apply. The UI disables
    // hunk staging while the whitespace-ignore toggle is on (#61 D2).
    /// Stage a single hunk (by index into the WorktreeToIndex diff) for `path`.
    fn stage_hunk(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        context_lines: u32,
    ) -> AppResult<()>;
    /// Unstage a single hunk (by index into the IndexToHead diff) for `path`.
    fn unstage_hunk(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        context_lines: u32,
    ) -> AppResult<()>;
    /// Discard a single hunk (by index into the WorktreeToIndex diff) for `path`.
    fn discard_hunk(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        context_lines: u32,
    ) -> AppResult<()>;

    // === commit ===
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String>;

    // === refs ===
    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()>;
    fn delete_branch(&self, repo_id: &RepoId, name: &str, force: bool) -> AppResult<()>;
    fn rename_branch(&self, repo_id: &RepoId, from: &str, to: &str) -> AppResult<()>;
    /// Set or clear a local branch's upstream (tracking) branch.
    ///
    /// `upstream` is a remote-tracking branch shorthand such as `"origin/main"`;
    /// `None` clears tracking. Both the local branch and the remote-tracking
    /// branch must exist — either missing is `InvalidRef`, which is why this
    /// validates before mutating rather than letting libgit2 fail deep inside
    /// with a stringified message.
    fn set_upstream(
        &self,
        repo_id: &RepoId,
        branch: &str,
        upstream: Option<&str>,
    ) -> AppResult<()>;
    fn create_tag(&self, repo_id: &RepoId, name: &str, target: TagTarget) -> AppResult<()>;
    fn delete_tag(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;

    // === history manipulation ===
    fn checkout_detached(&self, repo_id: &RepoId, oid: &str) -> AppResult<()>;
    fn reset(&self, repo_id: &RepoId, target: &str, mode: ResetMode) -> AppResult<()>;
    fn cherry_pick(&self, repo_id: &RepoId, oid: &str) -> AppResult<()>;
    fn revert(&self, repo_id: &RepoId, oid: &str) -> AppResult<()>;

    // === stash ===
    fn stash_save(&self, repo_id: &RepoId, opts: StashSaveOptions) -> AppResult<Option<String>>;
    fn stash_apply(&self, repo_id: &RepoId, index: usize) -> AppResult<()>;
    fn stash_pop(&self, repo_id: &RepoId, index: usize) -> AppResult<()>;
    fn stash_drop(&self, repo_id: &RepoId, index: usize) -> AppResult<()>;
    fn stash_branch(&self, repo_id: &RepoId, index: usize, branch: &str) -> AppResult<()>;

    // === remote management ===
    fn add_remote(&self, repo_id: &RepoId, name: &str, url: &str) -> AppResult<()>;
    fn remove_remote(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    fn rename_remote(&self, repo_id: &RepoId, from: &str, to: &str) -> AppResult<()>;
    fn set_remote_url(&self, repo_id: &RepoId, name: &str, url: &str) -> AppResult<()>;
    fn prune_remote(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;

    // === conflict resolution ===
    /// Return the current operation state of the repo (Merge, CherryPick, etc.).
    fn repo_state(&self, repo_id: &RepoId) -> AppResult<RepoState>;
    /// Read the three index stages for a conflicted file (base/ours/theirs).
    fn conflict_sides(&self, repo_id: &RepoId, path: &Path) -> AppResult<ConflictSides>;
    /// Write stage 2 (ours) to the worktree file and stage it.
    fn accept_ours(&self, repo_id: &RepoId, path: &Path) -> AppResult<()>;
    /// Write stage 3 (theirs) to the worktree file and stage it.
    fn accept_theirs(&self, repo_id: &RepoId, path: &Path) -> AppResult<()>;
    /// Stage paths as-is, clearing their conflict entries.
    fn mark_resolved(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()>;
    /// Write `content` to the worktree file and stage it, clearing the conflict.
    fn save_resolution(&self, repo_id: &RepoId, path: &Path, content: &str) -> AppResult<()>;
    /// Hard-reset to HEAD and clear the in-progress operation state.
    fn abort_operation(&self, repo_id: &RepoId) -> AppResult<()>;
    /// Create the merge/cherry-pick/revert commit after all conflicts are resolved.
    /// Returns the new commit OID.
    fn continue_operation(&self, repo_id: &RepoId) -> AppResult<String>;

    // === interactive rebase ===
    fn rebase_start(&self, repo_id: &RepoId, plan: Vec<RebaseStep>) -> AppResult<RebaseStatus>;
    fn rebase_continue(&self, repo_id: &RepoId) -> AppResult<RebaseStatus>;
    fn rebase_abort(&self, repo_id: &RepoId) -> AppResult<()>;
    fn rebase_status(&self, repo_id: &RepoId) -> AppResult<RebaseStatus>;

    // === ignore ===
    /// Append a pattern to the repo's top-level `.gitignore`, creating the file
    /// if it doesn't exist. No-op if the pattern is already present on its own line.
    fn append_gitignore(&self, repo_id: &RepoId, pattern: &str) -> AppResult<()>;
}
