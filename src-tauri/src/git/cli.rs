use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

use super::{
    types::{
        AheadBehind, BisectMark, BisectStatus, BlameResult, BranchInfo, CommitInfo, CommitNote, CommitOptions, CommitResult, ConflictSides,
        DeleteFailure, DiffKind, DiffToolTarget, FileContent,
        BulkFastForward, FastForward,
        FileDiff, FileStatus, HeadInfo, LfsStatus, LogFilter, LogPage, RebaseProgressSink, RebaseStatus, RebaseStep, ReflogEntry,
        BlobSource, ImagePreview,
        RemoteInfo, RepoHandle, RepoId, RepoState, ResetMode, ShallowInfo, StashInfo,
        StashSaveOptions,
        SubmoduleInfo, TagInfo,
        TagTarget, WorkdirDiff, WorktreeBranch, WorktreeInfo,
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
    fn init(&self, _path: &Path, _initial_branch: Option<&str>) -> AppResult<RepoHandle> {
        Err(AppError::NotImplemented)
    }
    fn trust_path(&self, _path: &Path) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn close(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn status(&self, _repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        Err(AppError::NotImplemented)
    }
    fn list_all_files(&self, _repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        Err(AppError::NotImplemented)
    }
    fn log(
        &self,
        _repo_id: &RepoId,
        _refspec: Option<&str>,
        _limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn log_filtered(
        &self,
        _repo_id: &RepoId,
        _filter: &LogFilter,
        _refspec: Option<&str>,
        _limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn log_page(
        &self,
        _repo_id: &RepoId,
        _refspec: Option<&str>,
        _cursor: Option<&[String]>,
        _limit: usize,
    ) -> AppResult<LogPage> {
        Err(AppError::NotImplemented)
    }
    fn log_filtered_page(
        &self,
        _repo_id: &RepoId,
        _filter: &LogFilter,
        _refspec: Option<&str>,
        _cursor: Option<&[String]>,
        _limit: usize,
    ) -> AppResult<LogPage> {
        Err(AppError::NotImplemented)
    }
    fn commits_since(&self, _repo_id: &RepoId, _base: &str) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn commits_between(
        &self,
        _repo_id: &RepoId,
        _base: &str,
        _tip: &str,
        _limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn ahead_behind(&self, _repo_id: &RepoId, _a: &str, _b: &str) -> AppResult<AheadBehind> {
        Err(AppError::NotImplemented)
    }
    fn file_history(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        Err(AppError::NotImplemented)
    }
    fn diff(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _kind: DiffKind,
        _context_lines: u32,
        _ignore_whitespace: bool,
    ) -> AppResult<FileDiff> {
        Err(AppError::NotImplemented)
    }
    fn read_file_content(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
    ) -> AppResult<Option<FileContent>> {
        Err(AppError::NotImplemented)
    }
    fn list_files_at_rev(&self, _repo_id: &RepoId, _revspec: &str) -> AppResult<Vec<FileStatus>> {
        Err(AppError::NotImplemented)
    }
    fn read_file_content_at_rev(
        &self,
        _repo_id: &RepoId,
        _revspec: &str,
        _path: &Path,
    ) -> AppResult<Option<FileContent>> {
        Err(AppError::NotImplemented)
    }
    fn read_file_content_at_index(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
    ) -> AppResult<Option<FileContent>> {
        Err(AppError::NotImplemented)
    }
    fn read_image_preview(
        &self,
        _repo_id: &RepoId,
        _source: &BlobSource,
        _path: &Path,
    ) -> AppResult<Option<ImagePreview>> {
        Err(AppError::NotImplemented)
    }
    fn diff_commits(
        &self,
        _repo_id: &RepoId,
        _from_oid: &str,
        _to_oid: &str,
        _context_lines: u32,
        _ignore_whitespace: bool,
    ) -> AppResult<Vec<FileDiff>> {
        Err(AppError::NotImplemented)
    }
    fn diff_commit(
        &self,
        _repo_id: &RepoId,
        _oid: &str,
        _context_lines: u32,
        _ignore_whitespace: bool,
    ) -> AppResult<Vec<FileDiff>> {
        Err(AppError::NotImplemented)
    }
    fn diff_ref_to_workdir(
        &self,
        _repo_id: &RepoId,
        _revspec: &str,
        _context_lines: u32,
        _ignore_whitespace: bool,
        _include_untracked: bool,
    ) -> AppResult<WorkdirDiff> {
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
    fn delete_untracked(
        &self,
        _repo_id: &RepoId,
        _paths: &[PathBuf],
    ) -> AppResult<Vec<DeleteFailure>> {
        Err(AppError::NotImplemented)
    }
    fn stage_hunk(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _hunk_index: usize,
        _context_lines: u32,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn unstage_hunk(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _hunk_index: usize,
        _context_lines: u32,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn discard_hunk(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _hunk_index: usize,
        _context_lines: u32,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stage_lines(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _hunk_index: usize,
        _selected: &[usize],
        _context_lines: u32,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn unstage_lines(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _hunk_index: usize,
        _selected: &[usize],
        _context_lines: u32,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn discard_lines(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _hunk_index: usize,
        _selected: &[usize],
        _context_lines: u32,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn commit(&self, _repo_id: &RepoId, _opts: CommitOptions) -> AppResult<CommitResult> {
        Err(AppError::NotImplemented)
    }

    fn commit_template(
        &self,
        _repo_id: &RepoId,
    ) -> AppResult<super::commit_template::CommitTemplate> {
        Err(AppError::NotImplemented)
    }

    fn identity(&self, _repo_id: Option<&RepoId>) -> AppResult<super::signature::GitIdentity> {
        Err(AppError::NotImplemented)
    }

    fn set_identity(
        &self,
        _repo_id: Option<&RepoId>,
        _scope: super::signature::IdentityWriteScope,
        _name: &str,
        _email: &str,
    ) -> AppResult<()> {
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
    fn checkout_branch(&self, _repo_id: &RepoId, _name: &str, _take: bool) -> AppResult<()> {
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
    fn set_upstream(
        &self,
        _repo_id: &RepoId,
        _branch: &str,
        _upstream: Option<&str>,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn fast_forward_remote(&self, _repo_id: &RepoId, _branch: &str) -> AppResult<String> {
        Err(AppError::NotImplemented)
    }
    fn fast_forward_branch(&self, _repo_id: &RepoId, _branch: &str) -> AppResult<FastForward> {
        Err(AppError::NotImplemented)
    }
    fn fast_forward_all(&self, _repo_id: &RepoId) -> AppResult<BulkFastForward> {
        Err(AppError::NotImplemented)
    }
    fn create_tag(&self, _repo_id: &RepoId, _name: &str, _target: TagTarget) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn delete_tag(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn verify_tag(
        &self,
        _repo_id: &RepoId,
        _name: &str,
    ) -> AppResult<crate::git::signing::SignatureStatus> {
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
    fn stash_drop(&self, _repo_id: &RepoId, _index: usize, _expect_oid: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_branch(&self, _repo_id: &RepoId, _index: usize, _branch: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_save_paths(
        &self,
        _repo_id: &RepoId,
        _opts: StashSaveOptions,
        _paths: &[PathBuf],
    ) -> AppResult<Option<String>> {
        Err(AppError::NotImplemented)
    }
    fn stash_rename(
        &self,
        _repo_id: &RepoId,
        _index: usize,
        _expect_oid: &str,
        _message: &str,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn stash_diff(
        &self,
        _repo_id: &RepoId,
        _oid: &str,
        _context_lines: u32,
        _ignore_whitespace: bool,
        _include_untracked: bool,
    ) -> AppResult<Vec<FileDiff>> {
        Err(AppError::NotImplemented)
    }
    fn repo_path(&self, _repo_id: &RepoId) -> AppResult<PathBuf> {
        Err(AppError::NotImplemented)
    }
    fn shallow_info(&self, _repo_id: &RepoId) -> AppResult<ShallowInfo> {
        Err(AppError::NotImplemented)
    }
    fn difftool_plan(
        &self,
        _repo_id: &RepoId,
        _target: &DiffToolTarget,
        _paths: &[String],
        _tool: Option<&str>,
    ) -> AppResult<crate::git::difftool::DiffToolPlan> {
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
    fn head_info(&self, _repo_id: &RepoId) -> AppResult<HeadInfo> {
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
    fn save_resolution(&self, _repo_id: &RepoId, _path: &Path, _content: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn abort_operation(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn continue_operation(&self, _repo_id: &RepoId) -> AppResult<String> {
        Err(AppError::NotImplemented)
    }
    fn rebase_start_with_progress(
        &self,
        _repo_id: &RepoId,
        _plan: Vec<RebaseStep>,
        _update_refs: Option<bool>,
        _on_progress: RebaseProgressSink<'_>,
    ) -> AppResult<RebaseStatus> {
        Err(AppError::NotImplemented)
    }
    fn stacked_refs(
        &self,
        _repo_id: &RepoId,
        _oids: Vec<String>,
    ) -> AppResult<Vec<super::update_refs::StackedRef>> {
        Err(AppError::NotImplemented)
    }
    fn rebase_continue_with_progress(
        &self,
        _repo_id: &RepoId,
        _on_progress: RebaseProgressSink<'_>,
    ) -> AppResult<RebaseStatus> {
        Err(AppError::NotImplemented)
    }
    fn rebase_abort(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn rebase_status(&self, _repo_id: &RepoId) -> AppResult<RebaseStatus> {
        Err(AppError::NotImplemented)
    }
    fn rebase_acknowledge(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn read_reflog(&self, _repo_id: &RepoId) -> AppResult<Vec<ReflogEntry>> {
        Err(AppError::NotImplemented)
    }
    fn verify_commit(
        &self,
        _repo_id: &RepoId,
        _oid: &str,
    ) -> AppResult<crate::git::signing::SignatureStatus> {
        Err(AppError::NotImplemented)
    }
    fn append_gitignore(&self, _repo_id: &RepoId, _pattern: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn blame_file(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _ignore_revs: bool,
    ) -> AppResult<BlameResult> {
        Err(AppError::NotImplemented)
    }
    fn commit_notes(&self, _repo_id: &RepoId, _oid: &str) -> AppResult<Vec<CommitNote>> {
        Err(AppError::NotImplemented)
    }

    // === submodules / worktrees / LFS / bisect (#93) ===
    // Stubs, per the standard path: keeping the trait shape exercised here is what
    // catches a signature that only one impl can satisfy. The real shell-outs live
    // in `Libgit2Backend` because they all need the same opened `Repository`
    // (workdir, gitdir, index) their neighbours already have — reviving this type
    // as a second real backend is a separate job.
    fn submodules(&self, _repo_id: &RepoId) -> AppResult<Vec<SubmoduleInfo>> {
        Err(AppError::NotImplemented)
    }
    fn submodule_init(&self, _repo_id: &RepoId, _path: Option<&str>) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn submodule_sync(&self, _repo_id: &RepoId, _path: Option<&str>) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn submodule_update(
        &self,
        _repo_id: &RepoId,
        _path: Option<&str>,
        _recursive: bool,
        _init: bool,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn worktrees(&self, _repo_id: &RepoId) -> AppResult<Vec<WorktreeInfo>> {
        Err(AppError::NotImplemented)
    }
    fn worktree_add(
        &self,
        _repo_id: &RepoId,
        _path: &Path,
        _branch: WorktreeBranch,
    ) -> AppResult<WorktreeInfo> {
        Err(AppError::NotImplemented)
    }
    fn worktree_remove(&self, _repo_id: &RepoId, _name: &str, _force: bool) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn worktree_lock(
        &self,
        _repo_id: &RepoId,
        _name: &str,
        _reason: Option<&str>,
    ) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn worktree_unlock(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn worktree_prune(&self, _repo_id: &RepoId) -> AppResult<Vec<String>> {
        Err(AppError::NotImplemented)
    }
    fn lfs_status(&self, _repo_id: &RepoId) -> AppResult<LfsStatus> {
        Err(AppError::NotImplemented)
    }
    fn lfs_checkout(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn bisect_status(&self, _repo_id: &RepoId) -> AppResult<BisectStatus> {
        Err(AppError::NotImplemented)
    }
    fn bisect_start(
        &self,
        _repo_id: &RepoId,
        _bad: &str,
        _good: &[String],
    ) -> AppResult<BisectStatus> {
        Err(AppError::NotImplemented)
    }
    fn bisect_mark(
        &self,
        _repo_id: &RepoId,
        _mark: BisectMark,
        _rev: Option<&str>,
    ) -> AppResult<BisectStatus> {
        Err(AppError::NotImplemented)
    }
    fn bisect_reset(&self, _repo_id: &RepoId) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
}
