pub mod auth;
pub mod bisect;
pub mod cli;
pub mod libgit2;
pub mod lfs;
pub mod ownership;
pub mod rebase_plan;
pub mod rebase_state;
pub mod signature;
pub mod signing;
pub mod stash;
pub mod submodule;
pub mod tag;
pub mod types;
pub mod worktree;

use std::path::{Path, PathBuf};

use crate::error::AppResult;
use types::{
    AheadBehind,
    BisectMark, BisectStatus, BlameLine, BranchInfo, CommitInfo, CommitOptions, ConflictSides,
    DiffKind, FileContent,
    FileDiff, FileStatus, LfsStatus, LogFilter, LogPage, RebaseStatus, RebaseStep, ReflogEntry,
    RemoteInfo,
    RepoHandle,
    RepoId, RepoState, ResetMode, StashInfo, StashSaveOptions, SubmoduleInfo, TagInfo, TagTarget,
    WorkdirDiff, WorktreeBranch, WorktreeInfo,
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
    /// Forget an opened repository, releasing its `git2::Repository` (and with
    /// it every file handle and odb cache it holds).
    ///
    /// `open` mints a fresh `RepoId` on every call and nothing else ever
    /// removes an entry, so without this each open — a re-open of the same path
    /// included — costs one repository for the lifetime of the process. Called
    /// when a repository tab is closed.
    ///
    /// **Idempotent, and an unknown id is not an error.** The frontend may
    /// close a tab whose open never completed; turning that into an error
    /// banner would be noise. Using a closed id still answers `UnknownRepo`,
    /// which is the honest response to a real mistake.
    fn close(&self, repo_id: &RepoId) -> AppResult<()>;
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
    /// Commits reachable from `tip` but not from `base` — git's `base..tip` —
    /// newest-first, capped at `limit`. Both sides are any revspec; either one
    /// that cannot be resolved is `InvalidRef`.
    ///
    /// Deliberately NOT `commits_since`, which requires `base` to be an ancestor
    /// of HEAD and errors otherwise: that is right for a rebase base and exactly
    /// wrong for two diverged branches, which is the case branch compare exists
    /// to show. Deliberately NOT `log` with a range refspec either — `log`
    /// resolves through `revparse_single`, and libgit2 rejects a range spec
    /// there (`GIT_EINVALIDSPEC`), so `"main..feature"` can never reach a walk.
    fn commits_between(
        &self,
        repo_id: &RepoId,
        base: &str,
        tip: &str,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>>;
    /// How `b` stands relative to `a`, plus their merge base (#131). See
    /// `AheadBehind` for the direction convention. `InvalidRef` if either
    /// revspec cannot be resolved to a commit; unrelated histories are a
    /// `merge_base: None`, not an error.
    fn ahead_behind(&self, repo_id: &RepoId, a: &str, b: &str) -> AppResult<AheadBehind>;
    /// Commits that touched `path`, newest first, up to `limit`.
    fn file_history(
        &self,
        repo_id: &RepoId,
        path: &Path,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>>;
    fn blame_file(&self, repo_id: &RepoId, path: &Path) -> AppResult<Vec<BlameLine>>;
    fn read_reflog(&self, repo_id: &RepoId) -> AppResult<Vec<ReflogEntry>>;
    /// Signature status of ONE commit (#61 D6).
    ///
    /// Deliberately per-commit and called lazily for the selected commit: a
    /// badge on every log row would mean a gpg/ssh-keygen process per walked
    /// commit, which fights the paginated log walk and the windowed list.
    fn verify_commit(
        &self,
        repo_id: &RepoId,
        oid: &str,
    ) -> AppResult<crate::git::signing::SignatureStatus>;
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
    /// The INDEX copy of a file — what committing would record.
    ///
    /// Distinct from both other readers precisely when a file is partially
    /// staged, which is the case the commit panel could not colour correctly
    /// while it had to approximate the index with HEAD and the worktree.
    /// A path with no stage-0 entry (untracked, or conflicted) is an
    /// `InvalidPath`, so the caller can fall back to rendering plain rows.
    fn read_file_content_at_index(
        &self,
        repo_id: &RepoId,
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
    /// Diff the tree at `revspec` against the WORKING TREE — the whole tree, not
    /// one path. A general primitive: arbitrary revspec (branch, remote branch,
    /// tag, oid), with the same `context_lines` / `ignore_whitespace` knobs the
    /// other diff ops take. `InvalidRef` when the revspec cannot be peeled to a
    /// tree.
    ///
    /// Uses `diff_tree_to_workdir_with_index`, NOT `diff_tree_to_workdir`: the
    /// latter ignores the index, so a file staged and then reverted in the
    /// worktree would read as unchanged against the ref.
    ///
    /// `include_untracked` is explicit rather than hardcoded. Git's own
    /// `git diff <ref>` ignores untracked files, but `diff`'s worktree kinds in
    /// this backend already include them with content, so the compare view
    /// passes `true` — hiding a file you just wrote is the silent failure, and
    /// `.gitignore`d files are excluded either way. Callers that want git's
    /// exact semantics pass `false`.
    ///
    /// **The untracked side is BOUNDED, and `diff`'s is not comparable.** `diff`
    /// sets a pathspec before turning untracked content on, so it only ever
    /// reads one file; this walks the whole tree. Over `MAX_UNTRACKED_FILES`
    /// untracked entries the untracked side is dropped entirely and the count
    /// comes back as `WorkdirDiff::untracked_omitted` for the UI to report.
    /// Per-blob size is capped too (`MAX_WORKDIR_BLOB`), so one enormous file
    /// reports as binary rather than being serialised.
    fn diff_ref_to_workdir(
        &self,
        repo_id: &RepoId,
        revspec: &str,
        context_lines: u32,
        ignore_whitespace: bool,
        include_untracked: bool,
    ) -> AppResult<WorkdirDiff>;
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

    // === line-level staging (#61 D7) ===
    // `selected` holds indices among the hunk's CHANGED (`+`/`-`) lines,
    // counted in hunk order from 0 — NOT indices into `DiffHunk::lines`, which
    // also carries header and context entries. The two index spaces differ, so
    // a caller must count only changed lines.
    //
    // The `context_lines` and no-`ignore_whitespace` rules above apply
    // identically: that flag rewrites hunk boundaries, so line indices derived
    // from a whitespace-ignoring diff do not address what git would apply.
    /// Stage only the selected changed lines of one hunk of `path`.
    fn stage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()>;
    /// Unstage only the selected changed lines of one hunk of `path`.
    fn unstage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()>;
    /// Discard only the selected changed lines of one hunk of `path`.
    fn discard_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
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
    /// Create a tag. `target.annotation` picks lightweight vs annotated and
    /// `target.sign` picks signed vs not, defaulting to `tag.gpgsign` (#132).
    ///
    /// A signing failure creates **no tag**: an unsigned fallback would leave
    /// the user believing they had signed it.
    fn create_tag(&self, repo_id: &RepoId, name: &str, target: TagTarget) -> AppResult<()>;
    fn delete_tag(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    /// Signature status of ONE tag (#132).
    ///
    /// Lazy for the same reason `verify_commit` is: a verdict for every tag row
    /// would be a signer process per row on every refresh. `TagInfo.signed`
    /// carries the free half — whether a signature is there at all — so the
    /// listing needs no subprocess.
    fn verify_tag(
        &self,
        repo_id: &RepoId,
        name: &str,
    ) -> AppResult<crate::git::signing::SignatureStatus>;

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
    /// Stash only `paths` (#133).
    ///
    /// Shells out — libgit2's stash API takes no pathspec at all. Local, so it
    /// belongs with `run_git_capture`'s prompt-less family and NOT on
    /// `commands::net::run_git_authenticated`; no remote is contacted.
    ///
    /// `Ok(None)` means git found nothing to save under that pathspec, which is
    /// a state and not a failure — the same contract `stash_save` already has.
    fn stash_save_paths(
        &self,
        repo_id: &RepoId,
        opts: StashSaveOptions,
        paths: &[PathBuf],
    ) -> AppResult<Option<String>>;
    /// Rename the entry at `index` (#133).
    ///
    /// git has no rename op: the displayed text is the reflog message, and
    /// `git stash store` is its only supported writer. See
    /// `git::stash::stash_store_args` and the impl for why this stores a FRESH
    /// commit rather than the existing one, and why the drop is gated on a
    /// verification.
    fn stash_rename(&self, repo_id: &RepoId, index: usize, message: &str) -> AppResult<()>;
    /// What this stash changed: its first parent's tree against its own (#133).
    ///
    /// Addressed by OID, not index — see `StashInfo`. `include_untracked` folds
    /// in the third parent (the `git stash -u` payload) as added files; it is
    /// inert on an entry that has no third parent.
    fn stash_diff(
        &self,
        repo_id: &RepoId,
        oid: &str,
        context_lines: u32,
        ignore_whitespace: bool,
        include_untracked: bool,
    ) -> AppResult<Vec<FileDiff>>;

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
    /// Drop the retained `RebaseStatus.last_completed` summary. Called once the
    /// UI has shown it; without it the summary would greet the user again on
    /// every later poll, and after a restart. Starting or aborting a rebase
    /// drops it too, so this is the only path a plain "I've seen it" takes.
    fn rebase_acknowledge(&self, repo_id: &RepoId) -> AppResult<()>;

    // === ignore ===
    /// Append a pattern to the repo's top-level `.gitignore`, creating the file
    /// if it doesn't exist. No-op if the pattern is already present on its own line.
    fn append_gitignore(&self, repo_id: &RepoId, pattern: &str) -> AppResult<()>;

    // === submodules (#93) ===
    // libgit2 for everything local; `update` shells out because it fetches and
    // credentials only flow through the askpass subprocess env — see git/submodule.rs.
    /// Every submodule `.gitmodules` declares, with its state.
    fn submodules(&self, repo_id: &RepoId) -> AppResult<Vec<SubmoduleInfo>>;
    /// Copy `.gitmodules`' URL for `path` into `.git/config` (`git submodule init`).
    /// `path` is the worktree-relative submodule path; `None` inits all of them.
    fn submodule_init(&self, repo_id: &RepoId, path: Option<&str>) -> AppResult<()>;
    /// Re-copy `.gitmodules`' URLs into `.git/config` and the submodule's own
    /// `origin` (`git submodule sync`). `None` syncs all.
    fn submodule_sync(&self, repo_id: &RepoId, path: Option<&str>) -> AppResult<()>;
    /// Check out the commit the superproject records, fetching it if missing
    /// (`git submodule update`). Prompt-less: an authenticating submodule remote
    /// fails fast with `Auth`, which the command layer retries with credentials.
    fn submodule_update(
        &self,
        repo_id: &RepoId,
        path: Option<&str>,
        recursive: bool,
        init: bool,
    ) -> AppResult<()>;

    // === linked worktrees (#93) ===
    /// Every LINKED worktree (the main worktree is the repository itself).
    fn worktrees(&self, repo_id: &RepoId) -> AppResult<Vec<WorktreeInfo>>;
    /// Create a worktree at `path` on a new or existing branch. The git-visible
    /// name comes from `path`'s basename, as `git worktree add` derives it.
    fn worktree_add(
        &self,
        repo_id: &RepoId,
        path: &Path,
        branch: WorktreeBranch,
    ) -> AppResult<WorktreeInfo>;
    /// Delete a worktree and its admin files. Shells out to `git worktree remove`
    /// for its dirty check — `DirtyWorktree` unless `force` (see git/worktree.rs).
    fn worktree_remove(&self, repo_id: &RepoId, name: &str, force: bool) -> AppResult<()>;
    fn worktree_lock(&self, repo_id: &RepoId, name: &str, reason: Option<&str>) -> AppResult<()>;
    fn worktree_unlock(&self, repo_id: &RepoId, name: &str) -> AppResult<()>;
    /// Prune every prunable worktree (`git worktree prune`), returning the names
    /// that went. Never touches a valid or locked worktree.
    fn worktree_prune(&self, repo_id: &RepoId) -> AppResult<Vec<String>>;

    // === git-LFS (#93) ===
    /// Whether the binary is present, whether the repo uses LFS, and the
    /// pointer-vs-materialized state of every LFS path. `installed: false` is a
    /// state, not an error — the ops below are what raise `LfsUnavailable`.
    fn lfs_status(&self, repo_id: &RepoId) -> AppResult<LfsStatus>;
    /// Materialize pointers whose objects are already downloaded
    /// (`git lfs checkout`). Local, so no credentials.
    fn lfs_checkout(&self, repo_id: &RepoId) -> AppResult<()>;

    // === bisect (#93) ===
    // All four shell out: libgit2 has no bisect API, and GIT's `.git/BISECT_*`
    // files are the only state of record — see git/bisect.rs.
    fn bisect_status(&self, repo_id: &RepoId) -> AppResult<BisectStatus>;
    /// `git bisect start <bad> [good…]`. An empty `good` is legal — git then waits
    /// for one, which is what "this commit is broken, I'll find a good one" needs.
    fn bisect_start(&self, repo_id: &RepoId, bad: &str, good: &[String]) -> AppResult<BisectStatus>;
    /// Mark `rev` (or HEAD) good/bad/skip and advance. `NoBisect` when none is open.
    fn bisect_mark(
        &self,
        repo_id: &RepoId,
        mark: BisectMark,
        rev: Option<&str>,
    ) -> AppResult<BisectStatus>;
    /// `git bisect reset` — return to `BISECT_START`. NOT `abort_operation`, which
    /// hard-resets to HEAD and mid-bisect that is a detached test commit.
    fn bisect_reset(&self, repo_id: &RepoId) -> AppResult<()>;
}
