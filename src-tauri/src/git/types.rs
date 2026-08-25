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
    /// Lines added in this file, both sides combined (staged + unstaged).
    /// 0 for unmodified/binary files and in listings that don't compute stats.
    pub additions: u32,
    /// Lines removed in this file, both sides combined (staged + unstaged).
    pub deletions: u32,
    /// Lines added between HEAD and the INDEX — i.e. what committing would
    /// actually record. Kept separate from the unstaged side because one number
    /// per file cannot serve both: a partially staged file otherwise reports the
    /// same count on its staged and unstaged rows, and the commit composer
    /// overstates the commit by including edits that are not staged.
    pub staged_additions: u32,
    /// Lines removed between HEAD and the index.
    pub staged_deletions: u32,
    /// Lines added between the index and the WORKING TREE — i.e. what is still
    /// unstaged.
    pub unstaged_additions: u32,
    /// Lines removed between the index and the working tree.
    pub unstaged_deletions: u32,
    /// True when this entry is a directory that is itself a git repository and
    /// is not a registered submodule (a vendored dependency, a stray clone).
    /// libgit2 refuses to recurse across the nested `.git` boundary, so it
    /// reports the directory as ONE entry — with a trailing slash — instead of
    /// its files. Such an entry has no diff, no blame and no history, and
    /// staging it writes a bare gitlink no clone can resolve, so the UI has to
    /// treat the row as its own thing rather than as a file. Always false for
    /// ordinary files and for registered submodules.
    pub embedded: bool,
    /// True when this entry is a submodule the repository DECLARES — a
    /// `.gitmodules` entry with a URL, i.e. the exact complement of `embedded`
    /// (see `is_embedded_repo`: a registered submodule is deliberately excluded
    /// there). The two are mutually exclusive by construction.
    ///
    /// Its gitlink is intentional, so staging and committing it is an ordinary
    /// pointer update — but it still has no diff, no blame and no file history,
    /// so the UI must render the row as a submodule rather than as a directory
    /// nobody can explain (#93).
    pub submodule: bool,
}

/// Refspec sentinel meaning "walk every branch we know of", not one ref —
/// git's own spelling, and a token `revparse` could never resolve, so it cannot
/// collide with a real revspec. History's "All" scope sends it; the frontend
/// mirrors it as `LOG_REF_ALL` in `src/lib/types.ts`.
pub const REFSPEC_ALL: &str = "--all";

/// One page of a resumable log walk (#68 G11).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogPage {
    pub commits: Vec<CommitInfo>,
    /// Frontier oids to resume from — every parent still awaited when the page
    /// ended. `None` means the walk reached the true end of history.
    ///
    /// A SET, not a single oid: at a page boundary several lanes are alive,
    /// each awaiting a different parent, so resuming from just the last
    /// emitted commit would silently drop every other branch.
    pub next_cursor: Option<Vec<String>>,
}

/// A whole-tree diff against the WORKING TREE (#131).
///
/// Not a bare `Vec<FileDiff>` because the untracked side has to be BOUNDED and
/// the bound has to be visible: this op fans out over the entire tree, unlike
/// `diff`, which sets a pathspec first and therefore only ever reads one
/// untracked file's content. A repository with an untracked `dist/`, `.venv/`
/// or a downloaded dataset that nobody `.gitignore`d would otherwise serialise
/// all of it into one IPC payload and one `DiffRow` model per file in the
/// webview. Silently truncating would be worse than the overflow, so the count
/// travels with the result and the UI says so.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkdirDiff {
    pub files: Vec<FileDiff>,
    /// Untracked files left out because there were more than
    /// `MAX_UNTRACKED_FILES` of them. Zero in every ordinary repository, and
    /// always zero when `include_untracked` was false.
    pub untracked_omitted: usize,
}

/// How one revision stands relative to another (#131).
///
/// Both counts are read FROM `a` TOWARD `b`: `ahead` is what `b` has that `a`
/// does not, `behind` the mirror — the same reading `BranchInfo.ahead/behind`
/// has for a branch against its upstream, so the two never mean opposite things.
/// In git's own spelling that is `rev-list --left-right --count a...b`, left =
/// `behind`, right = `ahead`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AheadBehind {
    pub ahead: usize,
    pub behind: usize,
    /// Best common ancestor, or `None` for unrelated histories. It rides along
    /// because it is the same graph query, and without it "no shared history"
    /// is indistinguishable from "everything diverged".
    pub merge_base: Option<String>,
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
    /// Pattern that must appear in a line this commit added or removed —
    /// git's `-G`, not `-S`: "the text was touched", not "the occurrence count
    /// changed".
    pub content: Option<String>,
    /// Treat `content` as a regular expression rather than a literal substring.
    #[serde(default)]
    pub content_regex: bool,
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
            // `content_regex` deliberately does NOT count: a regex toggle with
            // no pattern is still no filter.
            && self.content.as_deref().map(str::trim).unwrap_or("").is_empty()
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
    /// Committer time of the tip commit, seconds since the epoch. `0` when the
    /// tip cannot be resolved (unborn or broken ref) — which sorts last under
    /// the frontend's newest-first ordering.
    pub tip_time: i64,
    /// Is this ref the repository's default branch (or a remote's copy of it)?
    /// See `libgit2::detect_default_branch` for how that is decided.
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    pub short_oid: String,
    pub oid: String,
    /// Whether this is an annotated tag whose object carries a signature block
    /// (#132). Read from the object during the tag walk — no subprocess, so
    /// `list_tags` costs what it always did. It states a fact, not a verdict:
    /// `verify_tag` is what grades the signature, lazily and one tag at a time.
    pub signed: bool,
}

/// One entry on the `refs/stash` reflog (#133).
///
/// It carries BOTH addresses on purpose, because they answer different
/// questions and are not interchangeable. `index` is a position in a reflog —
/// every write to `refs/stash` shifts it, including a rename's own
/// store-then-drop — so the ops that EDIT the reflog (`stash_drop`,
/// `stash_rename`) take BOTH: the index to address the entry and the oid to
/// prove it is still the one that was picked, re-read and compared under the
/// same lock they mutate from. `oid` alone names the commit and survives
/// whatever happens to the reflog around it, so it is what a COMPARISON takes:
/// a stale index would silently diff a different entry.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    pub index: usize,
    pub short_oid: String,
    pub oid: String,
    pub message: String,
    /// The entry carries files git had no copy of — `git stash -u`.
    ///
    /// git's stash layout is: parent 0 = the commit it was taken on, parent 1 =
    /// the index state, parent 2 = the untracked files, present only for `-u`.
    /// So this is `parent_count() > 2`, an O(1) read, and it is the only way
    /// anything in the app can tell that a comparison against the stash's TREE
    /// is leaving part of the entry out.
    pub untracked: bool,
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
    /// Set when both sides of this diff are git-LFS **pointer files** (#93).
    ///
    /// The pointer is a ≤3-line text file, so `binary` is false and every diff
    /// surface would otherwise render "3 lines changed" for a multi-megabyte
    /// asset — actively misleading. `binary` is deliberately NOT overloaded (it
    /// means "libgit2 says the blob is binary", and other code trusts that);
    /// consumers gate their text rendering on `binary || lfs` instead.
    ///
    /// The hunks are left intact: this is derived FROM them, by parsing the
    /// pointer out of the diff's own `+`/`-` lines, so it costs no extra I/O.
    pub lfs: Option<LfsDiff>,
}

/// The two sides of an LFS pointer change. Either side is `None` for an added or
/// deleted file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsDiff {
    pub old: Option<LfsPointer>,
    pub new: Option<LfsPointer>,
}

/// A parsed `version https://git-lfs.github.com/spec/v1` pointer file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsPointer {
    /// The object id, WITHOUT the `sha256:` prefix.
    pub oid: String,
    /// Size of the real object in bytes.
    pub size: u64,
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
    /// When true, append a `Signed-off-by:` trailer using the committer
    /// signature, matching `git commit -s` (deduped if already present).
    #[serde(default)]
    pub signoff: bool,
    /// Cryptographically sign this commit (#61 D6). `None` follows
    /// `commit.gpgsign` from git config; `Some` overrides it for this commit.
    #[serde(default)]
    pub sign: Option<bool>,
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
    /// Cryptographically sign this tag (#132). `None` follows `tag.gpgsign`
    /// from git config; `Some` overrides it for this tag — the same contract
    /// `CommitOptions.sign` has.
    ///
    /// Signing requires an annotation: a lightweight tag is a ref, with no
    /// object to sign. `Some(true)` with no annotation is refused rather than
    /// silently dropped.
    #[serde(default)]
    pub sign: Option<bool>,
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
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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

/// Current HEAD identity, refreshed on every `refreshAll` (#217) so the
/// window title can follow checkouts rather than the one-shot value `open`
/// returns on `RepoHandle`. Same branch/oid split `WorktreeInfo` already
/// uses: `branch` is `None` on a detached HEAD, `head_oid` is `None` only on
/// an unborn branch (a fresh `git init` with no commits).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadInfo {
    pub branch: Option<String>,
    pub head_oid: Option<String>,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum RebaseAction {
    Pick,
    Reword,
    Edit,
    Squash,
    Fixup,
    Drop,
    /// A merge commit applied as its diff against its **first** parent — one
    /// ordinary commit, keeping the merge's message (`git cherry-pick -m 1`).
    /// On a non-merge commit it is identical to `Pick`.
    MainlinePick,
    /// Recreate a merge commit: re-merge its rewritten parents and commit the
    /// result with the original message and parent count (the equivalent of
    /// `git rebase --rebase-merges`). Conflict resolutions recorded in the
    /// original merge are NOT reused — git does not either.
    Merge,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseStep {
    /// Commit to operate on (full OID from the log).
    pub oid: String,
    pub action: RebaseAction,
    /// New message for reword / squash. Ignored for other actions.
    pub message: Option<String>,
    /// The **original** oid this step must be applied onto. The engine resolves
    /// it through the rewritten map and resets the detached HEAD there before
    /// applying. `None` means "onto whatever the previous step produced" — the
    /// linear default, which is every plan built before topology existed.
    ///
    /// This is how a generated plan expresses topology without git's
    /// `label`/`reset` todo language: every commit is implicitly its own label.
    #[serde(default)]
    pub onto: Option<String>,
    /// A merge step's **original** parents beyond the first, resolved through
    /// the rewritten map at merge time. Empty for every other action.
    #[serde(default)]
    pub merge_parents: Vec<String>,
}

/// What a rebase that ran to completion did, kept after the rebase itself is
/// over so the UI can still report it.
///
/// The engine sweeps its `RebaseState` the moment a plan finishes, so a
/// `rebase_status` poll one tick later has nothing left to describe. The
/// frontend used to cache the final status for the "N steps completed" line,
/// which meant every abort and every start path had to remember to clear that
/// cache (#47). The backend retains this instead, until `rebase_acknowledge`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RebaseSummary {
    /// Steps the completed plan contained.
    pub total: usize,
    /// Steps that ran, drops included — equal to `total` for a plan that
    /// reached its end, which is the only way a summary is recorded.
    pub completed: usize,
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
    /// The most recently completed rebase, until it is acknowledged. Always
    /// `None` while a rebase is in progress: starting one supersedes it, and
    /// aborting one drops it. See {@link RebaseSummary}.
    pub last_completed: Option<RebaseSummary>,
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

/// One progress tick from `git clone --progress`, as emitted on
/// `clone://progress`. `phase` is git's own label ("Receiving objects"),
/// `percent` is 0–100.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgress {
    pub phase: String,
    pub percent: u8,
}

// ─── Submodules (#93) ─────────────────────────────────────────────────────────

/// `git2::SubmoduleStatus`'s 13 bits collapsed to the four things a user can act
/// on. Derived in a fixed priority order (see `submodule::state_from_status`):
/// uninitialized outranks everything (nothing else is meaningful without a
/// checkout), then a pointer mismatch, then dirt inside the submodule.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SubmoduleState {
    /// Declared in `.gitmodules`, but the worktree has no checkout yet.
    Uninitialized,
    /// Checked out at the commit the superproject records, and clean.
    UpToDate,
    /// Right commit, but the submodule's own index or worktree is dirty.
    Modified,
    /// The checked-out commit differs from the gitlink the superproject records
    /// — either it needs updating, or a new pointer needs staging.
    OutOfSync,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleInfo {
    /// `.gitmodules` section name — usually, but not necessarily, the path.
    pub name: String,
    /// Path relative to the superproject worktree.
    pub path: String,
    pub url: Option<String>,
    /// `submodule.<name>.branch`, when one is configured.
    pub branch: Option<String>,
    /// The gitlink the superproject records (HEAD's tree). `None` when the
    /// submodule is not committed yet.
    pub head_oid: Option<String>,
    /// The commit checked out in the submodule's worktree. `None` when
    /// uninitialized.
    pub workdir_oid: Option<String>,
    pub state: SubmoduleState,
}

// ─── Linked worktrees (#93) ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    /// git's own name for the worktree (`.git/worktrees/<name>`).
    pub name: String,
    pub path: String,
    /// Short branch name checked out there; `None` when detached or unreadable.
    pub branch: Option<String>,
    pub head_oid: Option<String>,
    pub locked: bool,
    /// Reason recorded by `worktree lock`, when one was given.
    pub lock_reason: Option<String>,
    /// git considers the admin files prunable — normally because the working
    /// directory was deleted behind git's back.
    pub prunable: bool,
    /// True when this entry is the worktree the app currently has open, so a
    /// user who opened the app *inside* a linked worktree can see where they
    /// are standing.
    pub is_current: bool,
}

/// Which branch a new worktree checks out.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", content = "name", rename_all = "camelCase")]
pub enum WorktreeBranch {
    /// Create a new branch at the current HEAD and check it out there.
    New(String),
    /// Check out an existing local branch (which must not be checked out
    /// elsewhere).
    Existing(String),
}

// ─── git-LFS (#93) ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsStatus {
    /// `git lfs version` ran and exited 0. Everything below except `in_use` and
    /// `patterns` needs it.
    pub installed: bool,
    /// Whatever `git lfs version` printed, when installed.
    pub version: Option<String>,
    /// The repository declares at least one `filter=lfs` attribute. Computed by
    /// us from the `.gitattributes` files, NOT from `git lfs track` — this
    /// question has to be answerable with the binary missing, which is exactly
    /// when the user needs to be told the repository needs it.
    pub in_use: bool,
    /// The pattern half of those attribute lines.
    pub patterns: Vec<String>,
    /// LFS-managed paths in the worktree. Empty when the binary is missing.
    pub files: Vec<LfsFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LfsFile {
    pub path: String,
    /// Short oid as `git lfs ls-files` prints it.
    pub oid: String,
    /// True when the real object is in the worktree (`*`), false when the file
    /// is still just a pointer (`-`).
    pub materialized: bool,
}

// ─── Bisect (#93) ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BisectMark {
    Good,
    Bad,
    Skip,
}

/// A bisect in progress, read entirely from GIT's own state (`.git/BISECT_*`,
/// `refs/bisect/*`) — there is deliberately no parallel state file, because
/// every transition here is a `git bisect` invocation and a second record could
/// only ever disagree with git's.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BisectStatus {
    pub in_progress: bool,
    /// Where `git bisect reset` will return to (`.git/BISECT_START`).
    pub start_ref: Option<String>,
    /// Terms in use, from `.git/BISECT_TERMS` — "bad"/"good" unless the user
    /// started the bisect with `--term-old`/`--term-new` in a terminal.
    pub bad_term: String,
    pub good_term: String,
    /// The revision currently checked out for testing.
    pub current_oid: Option<String>,
    /// git's own `bisect_nr`: revisions left to test after this one.
    pub remaining: Option<usize>,
    /// git's own `bisect_steps`: the log2 estimate.
    pub steps: Option<usize>,
    /// Set once the search converges. Note HEAD then sits on the last *tested*
    /// commit, not on this one.
    pub first_bad_oid: Option<String>,
    pub good_count: usize,
    pub bad_count: usize,
    pub skipped_count: usize,
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    /// The one #93 type whose wire shape is not obvious from the struct — an
    /// adjacently-tagged enum. A mismatch here fails only at runtime, in the one
    /// command that creates a worktree, so pin it.
    #[test]
    fn worktree_branch_matches_the_typescript_union() {
        let new: WorktreeBranch =
            serde_json::from_str(r#"{"kind":"new","name":"feature/x"}"#).expect("new");
        assert!(matches!(new, WorktreeBranch::New(ref n) if n == "feature/x"));
        let existing: WorktreeBranch =
            serde_json::from_str(r#"{"kind":"existing","name":"main"}"#).expect("existing");
        assert!(matches!(existing, WorktreeBranch::Existing(ref n) if n == "main"));
        assert_eq!(
            serde_json::to_string(&WorktreeBranch::New("wt".into())).unwrap(),
            r#"{"kind":"new","name":"wt"}"#
        );
    }

    #[test]
    fn bisect_mark_and_submodule_state_are_plain_strings() {
        assert_eq!(serde_json::to_string(&BisectMark::Skip).unwrap(), r#""Skip""#);
        assert_eq!(
            serde_json::to_string(&SubmoduleState::OutOfSync).unwrap(),
            r#""OutOfSync""#
        );
    }

    #[test]
    fn an_lfs_diff_serializes_the_camel_case_fields_the_ui_reads() {
        let json = serde_json::to_string(&LfsDiff {
            old: None,
            new: Some(LfsPointer {
                oid: "abc".into(),
                size: 12,
            }),
        })
        .unwrap();
        assert_eq!(json, r#"{"old":null,"new":{"oid":"abc","size":12}}"#);
    }
}

impl BisectStatus {
    /// The "no bisect here" answer, with git's default terms.
    pub fn idle() -> Self {
        Self {
            in_progress: false,
            start_ref: None,
            bad_term: "bad".to_string(),
            good_term: "good".to_string(),
            current_oid: None,
            remaining: None,
            steps: None,
            first_bad_oid: None,
            good_count: 0,
            bad_count: 0,
            skipped_count: 0,
        }
    }
}
