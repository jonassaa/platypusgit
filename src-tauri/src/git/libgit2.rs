use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

use git2::{
    BranchType, DiffFindOptions, DiffFormat, DiffOptions, Repository, Sort, Status, StatusOptions,
};
use uuid::Uuid;

use crate::error::{AppError, AppResult};

use super::{
    types::{
        BranchInfo, CommitInfo, CommitOptions, ConflictSides, DiffHunk, DiffKind, DiffLine,
        DiffLineKind, FileDiff, FileStatus, RemoteInfo, RepoHandle, RepoId, RepoState, ResetMode,
        StashInfo, StashSaveOptions, StatusFlag, TagInfo, TagTarget,
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

    fn with_repo_mut<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Repository) -> AppResult<T>,
    {
        let map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let repo_cell = map
            .get(repo_id)
            .ok_or_else(|| AppError::UnknownRepo(repo_id.0.clone()))?;
        let mut repo = repo_cell
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        f(&mut repo)
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

// ─── Hunk-level staging helpers ──────────────────────────────────────────────

/// Find which delta index corresponds to `path` inside a diff.
fn find_delta_index(diff: &git2::Diff, path: &Path) -> AppResult<usize> {
    for (i, delta) in diff.deltas().enumerate() {
        if let Some(p) = delta.new_file().path() {
            if p == path {
                return Ok(i);
            }
        }
        // Also check old_file path (e.g. for deleted files).
        if let Some(p) = delta.old_file().path() {
            if p == path {
                return Ok(i);
            }
        }
    }
    Err(AppError::InvalidPath(path.display().to_string()))
}

/// Build a minimal unified-diff patch string for a single hunk within a diff.
fn patch_text_for_hunk(diff: &git2::Diff, delta_index: usize, hunk_index: usize) -> AppResult<String> {
    let patch = git2::Patch::from_diff(diff, delta_index)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Internal("no patch for delta".into()))?;

    let num_hunks = patch.num_hunks();
    if hunk_index >= num_hunks {
        return Err(AppError::InvalidRef(format!(
            "hunk index {} out of range (file has {} hunks)",
            hunk_index, num_hunks
        )));
    }

    let delta = diff
        .get_delta(delta_index)
        .ok_or_else(|| AppError::Internal(format!("delta {} missing", delta_index)))?;

    // Use new_file path preferentially; fall back to old_file for deletions.
    let path_str = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .ok_or_else(|| AppError::Internal("delta has no path".into()))?
        .to_string_lossy()
        .to_string();

    let (hunk_header, _line_count) = patch.hunk(hunk_index).map_err(AppError::from)?;
    let header_str = std::str::from_utf8(hunk_header.header())
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let mut out = String::new();
    out.push_str(&format!("diff --git a/{p} b/{p}\n", p = path_str));
    out.push_str(&format!("--- a/{}\n", path_str));
    out.push_str(&format!("+++ b/{}\n", path_str));
    // hunk header may or may not end with \n
    out.push_str(header_str);
    if !header_str.ends_with('\n') {
        out.push('\n');
    }

    let line_count = patch.num_lines_in_hunk(hunk_index).map_err(AppError::from)?;
    for line_i in 0..line_count {
        let line = patch.line_in_hunk(hunk_index, line_i).map_err(AppError::from)?;
        let origin = line.origin();
        // Skip git-internal pseudo-lines (file headers etc.)
        if !matches!(origin, '+' | '-' | ' ') {
            continue;
        }
        out.push(origin);
        let content = std::str::from_utf8(line.content())
            .map_err(|e| AppError::Internal(e.to_string()))?;
        out.push_str(content);
        // Ensure each line ends with newline (some diffs omit trailing \n).
        if !content.ends_with('\n') {
            out.push('\n');
        }
    }

    Ok(out)
}

/// Run `git apply [extra_args...] -` with `patch_text` piped to stdin.
fn git_apply(repo_path: &Path, extra_args: &[&str], patch_text: &str) -> AppResult<()> {
    use std::io::Write as _;
    let mut child = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .arg("apply")
        .args(extra_args)
        .arg("--whitespace=nowarn")
        .arg("-")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Io(e.to_string()))?;

    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(patch_text.as_bytes())
        .map_err(|e| AppError::Io(e.to_string()))?;

    let output = child
        .wait_with_output()
        .map_err(|e| AppError::Io(e.to_string()))?;

    if !output.status.success() {
        return Err(AppError::Git(format!(
            "git apply failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    Ok(())
}

/// Map git2's per-ref lookup by target OID. Scans once per log call.
fn collect_ref_map(repo: &Repository) -> Vec<(git2::Oid, String)> {
    let mut out = Vec::new();
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            let name = match r.shorthand() {
                Some(n) => n.to_string(),
                None => continue,
            };
            // Peel annotated tags to the commit they point at.
            if let Ok(peeled) = r.peel(git2::ObjectType::Commit) {
                if let Some(c) = peeled.as_commit() {
                    out.push((c.id(), name));
                    continue;
                }
            }
            if let Some(oid) = r.target() {
                out.push((oid, name));
            }
        }
    }
    out
}

fn accept_side(
    backend: &Libgit2Backend,
    repo_id: &RepoId,
    path: &Path,
    ours: bool,
) -> AppResult<()> {
    backend.with_repo(repo_id, |repo| {
        let index = repo.index()?;
        let path_bytes = path.to_string_lossy().as_bytes().to_vec();

        let mut target_oid: Option<git2::Oid> = None;
        let mut side_existed = false;
        let conflicts = index.conflicts()?;
        for conflict in conflicts {
            let c = conflict?;
            let entry = if ours { &c.our } else { &c.their };
            if let Some(e) = entry {
                if e.path == path_bytes {
                    target_oid = Some(e.id);
                    side_existed = true;
                    break;
                }
            }
            // The file may be absent on the chosen side (deleted in that branch).
            // Detect that case by matching the other-side entry.
            let other = if ours { &c.their } else { &c.our };
            if let Some(e) = other {
                if e.path == path_bytes {
                    side_existed = false;
                    break;
                }
            }
        }
        drop(index);

        let workdir = repo
            .workdir()
            .ok_or_else(|| AppError::Internal("bare repo has no workdir".into()))?;
        let full = workdir.join(path);

        match target_oid {
            Some(oid) => {
                let blob = repo.find_blob(oid)?;
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| AppError::Io(e.to_string()))?;
                }
                std::fs::write(&full, blob.content())
                    .map_err(|e| AppError::Io(e.to_string()))?;
                let mut index = repo.index()?;
                let _ = index.remove_path(path);
                index.add_path(path)?;
                index.write()?;
            }
            None if !side_existed => {
                // File deleted on the chosen side — remove from worktree + index.
                if full.exists() {
                    std::fs::remove_file(&full).map_err(|e| AppError::Io(e.to_string()))?;
                }
                let mut index = repo.index()?;
                let _ = index.remove_path(path);
                index.write()?;
            }
            None => {
                return Err(AppError::InvalidPath(format!(
                    "no conflict entry for path: {}",
                    path.display()
                )));
            }
        }
        Ok(())
    })
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

    fn log(&self, repo_id: &RepoId, limit: usize) -> AppResult<Vec<CommitInfo>> {
        self.with_repo(repo_id, |repo| {
            let ref_map = collect_ref_map(repo);
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
            // If HEAD is unborn we have no commits to walk.
            match walk.push_head() {
                Ok(()) => {}
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok(Vec::new()),
                Err(e) => return Err(e.into()),
            }

            let mut out = Vec::with_capacity(limit.min(4096));
            for oid in walk.take(limit) {
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                let summary = commit.summary().unwrap_or("").to_string();
                let full_message = commit.message().unwrap_or("").to_string();
                let body = full_message
                    .split_once("\n\n")
                    .map(|(_, rest)| rest.trim_end().to_string())
                    .filter(|s| !s.is_empty());
                let author = commit.author();
                let refs: Vec<String> = ref_map
                    .iter()
                    .filter(|(o, _)| *o == oid)
                    .map(|(_, name)| name.clone())
                    .collect();
                out.push(CommitInfo {
                    oid: oid.to_string(),
                    short_oid: oid.to_string()[..7].to_string(),
                    summary,
                    body,
                    author: author.name().unwrap_or("").to_string(),
                    email: author.email().unwrap_or("").to_string(),
                    timestamp: commit.time().seconds(),
                    parents: commit.parent_ids().map(|p| p.to_string()).collect(),
                    refs,
                });
            }
            Ok(out)
        })
    }

    fn diff(&self, repo_id: &RepoId, path: &Path, kind: DiffKind) -> AppResult<FileDiff> {
        self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(3);

            let mut diff = match kind {
                DiffKind::WorktreeToIndex => repo.diff_index_to_workdir(None, Some(&mut opts))?,
                DiffKind::IndexToHead => {
                    let head_tree = match repo.head() {
                        Ok(h) => Some(h.peel_to_tree()?),
                        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                        Err(e) => return Err(e.into()),
                    };
                    repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?
                }
                DiffKind::WorktreeToHead => {
                    let head_tree = match repo.head() {
                        Ok(h) => Some(h.peel_to_tree()?),
                        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                        Err(e) => return Err(e.into()),
                    };
                    repo.diff_tree_to_workdir(head_tree.as_ref(), Some(&mut opts))?
                }
            };

            let mut find = DiffFindOptions::new();
            find.renames(true).copies(true);
            diff.find_similar(Some(&mut find))?;

            let path_str = path.to_string_lossy().to_string();
            let mut current_path: Option<String> = None;
            let mut old_path: Option<String> = None;
            let mut binary = false;
            let mut additions: u32 = 0;
            let mut deletions: u32 = 0;
            let mut hunks: Vec<DiffHunk> = Vec::new();

            diff.print(DiffFormat::Patch, |delta, hunk, line| {
                let new_path = delta
                    .new_file()
                    .path()
                    .map(|p| p.to_string_lossy().to_string());
                if current_path.is_none() {
                    current_path = new_path.clone();
                    old_path = delta
                        .old_file()
                        .path()
                        .map(|p| p.to_string_lossy().to_string());
                }
                if delta.flags().contains(git2::DiffFlags::BINARY) {
                    binary = true;
                    return true;
                }
                let origin = line.origin();
                let content = std::str::from_utf8(line.content())
                    .unwrap_or("")
                    .trim_end_matches('\n')
                    .to_string();

                match origin {
                    'H' | 'F' => return true,
                    'B' => {
                        binary = true;
                        return true;
                    }
                    _ => {}
                }

                if let Some(h) = hunk {
                    if hunks
                        .last()
                        .map(|last| last.header.as_bytes() != h.header())
                        .unwrap_or(true)
                    {
                        let header_str = std::str::from_utf8(h.header())
                            .unwrap_or("")
                            .trim_end_matches('\n')
                            .to_string();
                        hunks.push(DiffHunk {
                            header: header_str,
                            old_start: h.old_start(),
                            old_lines: h.old_lines(),
                            new_start: h.new_start(),
                            new_lines: h.new_lines(),
                            lines: Vec::new(),
                        });
                    }
                }

                let Some(current_hunk) = hunks.last_mut() else {
                    // no hunk context — skip
                    return true;
                };

                let kind = match origin {
                    '+' => {
                        additions += 1;
                        DiffLineKind::Addition
                    }
                    '-' => {
                        deletions += 1;
                        DiffLineKind::Deletion
                    }
                    _ => DiffLineKind::Context,
                };

                current_hunk.lines.push(DiffLine {
                    kind,
                    old_lineno: line.old_lineno(),
                    new_lineno: line.new_lineno(),
                    content,
                });
                true
            })?;

            Ok(FileDiff {
                path: current_path.unwrap_or(path_str),
                old_path,
                binary,
                additions,
                deletions,
                hunks,
            })
        })
    }

    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let mut index = repo.index()?;
            for p in paths {
                // `add_path` treats paths as repo-relative; it handles creates and modifications.
                // For deletions from the worktree, we need `remove_path` instead.
                if repo.workdir().map(|w| w.join(p).exists()).unwrap_or(false) {
                    index.add_path(p)?;
                } else {
                    index.remove_path(p)?;
                }
            }
            index.write()?;
            Ok(())
        })
    }
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // Resetting paths to HEAD is the equivalent of `git reset HEAD -- paths`.
            // If HEAD is unborn, just clear the entries from the index.
            let head = match repo.head() {
                Ok(h) => Some(h.peel_to_commit()?),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };
            match head {
                Some(commit) => {
                    let paths: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
                    repo.reset_default(Some(commit.as_object()), paths)?;
                }
                None => {
                    let mut index = repo.index()?;
                    for p in paths {
                        let _ = index.remove_path(p);
                    }
                    index.write()?;
                }
            }
            Ok(())
        })
    }
    fn discard(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let mut opts = git2::build::CheckoutBuilder::new();
            opts.force();
            for p in paths {
                opts.path(p);
            }
            repo.checkout_index(None, Some(&mut opts))?;
            Ok(())
        })
    }

    fn stage_hunk(&self, repo_id: &RepoId, path: &Path, hunk_index: usize) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(3);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;

            // Find delta for path, then count hunks via Patch.
            let delta_idx = find_delta_index(&diff, path)?;
            let patch = git2::Patch::from_diff(&diff, delta_idx)
                .map_err(AppError::from)?
                .ok_or_else(|| AppError::Internal("no patch for delta".into()))?;
            let num_hunks = patch.num_hunks();
            // Drop patch before we call apply (apply needs exclusive access to diff).
            drop(patch);

            if hunk_index >= num_hunks {
                return Err(AppError::InvalidRef(format!(
                    "hunk index {} out of range for {} (file has {} hunks)",
                    hunk_index,
                    path.display(),
                    num_hunks,
                )));
            }

            // Use ApplyOptions::hunk_callback to apply only the matching hunk.
            let mut counter: usize = 0;
            let mut apply_opts = git2::ApplyOptions::new();
            apply_opts.hunk_callback(move |_h| {
                let idx = counter;
                counter += 1;
                idx == hunk_index
            });

            repo.apply(&diff, git2::ApplyLocation::Index, Some(&mut apply_opts))?;
            // apply_opts is dropped here, releasing the closure borrow.
            Ok(())
        })
    }

    fn unstage_hunk(&self, repo_id: &RepoId, path: &Path, hunk_index: usize) -> AppResult<()> {
        // Build patch text from the IndexToHead diff, then `git apply --cached --reverse`.
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(3);
            let head_tree = match repo.head() {
                Ok(h) => Some(h.peel_to_tree()?),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };
            let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_hunk(&diff, delta_index, hunk_index)
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--cached", "--reverse"], &patch_text)
    }

    fn discard_hunk(&self, repo_id: &RepoId, path: &Path, hunk_index: usize) -> AppResult<()> {
        // Build patch text from the WorktreeToIndex diff, then `git apply --reverse`.
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.context_lines(3);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_hunk(&diff, delta_index, hunk_index)
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--reverse"], &patch_text)
    }

    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<String> {
        use crate::git::signature::default_signature;

        self.with_repo(repo_id, |repo| {
            let sig = match opts.author_override {
                Some(o) => git2::Signature::now(&o.name, &o.email)?,
                None => default_signature(repo)?,
            };

            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;

            let head = match repo.head() {
                Ok(h) => Some(h),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };

            if opts.amend {
                let head_ref = head.ok_or(AppError::Unborn)?;
                let tip = head_ref.peel_to_commit()?;
                let new_oid = tip.amend(
                    Some("HEAD"),
                    Some(&sig),
                    Some(&sig),
                    None,
                    Some(&opts.message),
                    Some(&tree),
                )?;
                return Ok(new_oid.to_string());
            }

            let parents: Vec<git2::Commit> = match head {
                Some(h) => vec![h.peel_to_commit()?],
                None => Vec::new(),
            };
            let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

            let oid = repo.commit(
                Some("HEAD"),
                &sig,
                &sig,
                &opts.message,
                &tree,
                &parent_refs,
            )?;
            Ok(oid.to_string())
        })
    }

    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>> {
        self.with_repo(repo_id, |repo| {
            let head_ref = repo.head().ok();
            let head_name = head_ref.as_ref().and_then(|r| r.shorthand()).map(String::from);

            let mut out = Vec::new();
            let branches = repo.branches(None)?;
            for b in branches {
                let (branch, btype) = b?;
                let name = match branch.name()? {
                    Some(n) => n.to_string(),
                    None => continue,
                };
                let is_remote = matches!(btype, BranchType::Remote);
                let is_head = !is_remote && head_name.as_deref() == Some(name.as_str());

                let tip = branch
                    .get()
                    .target()
                    .map(|o| o.to_string()[..7].to_string());

                let (upstream, ahead, behind) = if !is_remote {
                    match branch.upstream() {
                        Ok(up) => {
                            let up_name = up.name().ok().flatten().map(String::from);
                            let counts = match (branch.get().target(), up.get().target()) {
                                (Some(local), Some(remote)) => repo
                                    .graph_ahead_behind(local, remote)
                                    .unwrap_or((0, 0)),
                                _ => (0, 0),
                            };
                            (up_name, counts.0, counts.1)
                        }
                        Err(_) => (None, 0, 0),
                    }
                } else {
                    (None, 0, 0)
                };

                out.push(BranchInfo {
                    name,
                    is_head,
                    is_remote,
                    upstream,
                    ahead,
                    behind,
                    tip,
                });
            }
            Ok(out)
        })
    }

    fn tags(&self, repo_id: &RepoId) -> AppResult<Vec<TagInfo>> {
        self.with_repo(repo_id, |repo| {
            let mut out = Vec::new();
            repo.tag_foreach(|oid, name_bytes| {
                let name = std::str::from_utf8(name_bytes)
                    .unwrap_or("")
                    .trim_start_matches("refs/tags/")
                    .to_string();
                // Peel annotated tags to the commit.
                let tip_oid = repo
                    .find_object(oid, None)
                    .ok()
                    .and_then(|o| o.peel(git2::ObjectType::Commit).ok())
                    .map(|c| c.id())
                    .unwrap_or(oid);
                out.push(TagInfo {
                    name,
                    short_oid: tip_oid.to_string()[..7].to_string(),
                    oid: tip_oid.to_string(),
                });
                true
            })?;
            Ok(out)
        })
    }

    fn stashes(&self, repo_id: &RepoId) -> AppResult<Vec<StashInfo>> {
        self.with_repo_mut(repo_id, |repo| {
            let mut out = Vec::new();
            repo.stash_foreach(|index, message, oid| {
                out.push(StashInfo {
                    index,
                    short_oid: oid.to_string()[..7].to_string(),
                    message: message.to_string(),
                });
                true
            })?;
            Ok(out)
        })
    }

    fn remotes(&self, repo_id: &RepoId) -> AppResult<Vec<RemoteInfo>> {
        self.with_repo(repo_id, |repo| {
            let mut out = Vec::new();
            for name in repo.remotes()?.iter().flatten() {
                let url = repo
                    .find_remote(name)
                    .ok()
                    .and_then(|r| r.url().map(String::from));
                out.push(RemoteInfo {
                    name: name.to_string(),
                    url,
                });
            }
            Ok(out)
        })
    }

    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // Refuse only when tracked paths have pending modifications or staged
            // changes; untracked files are fine unless they would be overwritten by
            // the target tree (that's checked by checkout_tree's conflict detection).
            let statuses = repo.statuses(None)?;
            let dirty = statuses.iter().any(|s| {
                let bits = s.status();
                bits.is_wt_modified()
                    || bits.is_wt_deleted()
                    || bits.is_wt_typechange()
                    || bits.is_wt_renamed()
                    || bits.is_index_modified()
                    || bits.is_index_new()
                    || bits.is_index_deleted()
                    || bits.is_index_renamed()
                    || bits.is_index_typechange()
            });
            if dirty {
                return Err(AppError::DirtyWorktree(
                    "commit or stash before switching branches".into(),
                ));
            }
            let refname = format!("refs/heads/{}", name);
            let obj = repo
                .revparse_single(&refname)
                .map_err(|_| AppError::InvalidRef(name.to_string()))?;
            repo.checkout_tree(&obj, None).map_err(|e| match e.code() {
                git2::ErrorCode::Conflict => AppError::DirtyWorktree(
                    "untracked files would be overwritten by checkout".into(),
                ),
                _ => AppError::from(e),
            })?;
            repo.set_head(&refname)?;
            Ok(())
        })
    }
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let target_commit = match from {
                Some(rev) => {
                    let obj = repo
                        .revparse_single(rev)
                        .map_err(|_| AppError::InvalidRef(rev.to_string()))?;
                    obj.peel_to_commit()?
                }
                None => match repo.head() {
                    Ok(h) => h.peel_to_commit()?,
                    Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
                        return Err(AppError::Unborn)
                    }
                    Err(e) => return Err(e.into()),
                },
            };
            repo.branch(name, &target_commit, false)?;
            Ok(())
        })
    }
    fn delete_branch(&self, repo_id: &RepoId, name: &str, force: bool) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // Refuse to delete the currently checked-out branch.
            if let Ok(head) = repo.head() {
                if head.shorthand() == Some(name) {
                    return Err(AppError::InvalidRef(
                        "cannot delete the currently checked-out branch".into(),
                    ));
                }
            }
            let mut branch = repo.find_branch(name, git2::BranchType::Local)?;
            if !force {
                // git's default safety: if the branch isn't merged into HEAD, refuse.
                let branch_commit = branch.get().peel_to_commit()?.id();
                if let Ok(head) = repo.head() {
                    let head_commit = head.peel_to_commit()?.id();
                    let base = repo.merge_base(head_commit, branch_commit).ok();
                    if base != Some(branch_commit) {
                        return Err(AppError::NotMerged(format!(
                            "branch {} is not fully merged",
                            name
                        )));
                    }
                }
            }
            branch.delete()?;
            Ok(())
        })
    }

    fn rename_branch(&self, repo_id: &RepoId, from: &str, to: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let mut branch = repo.find_branch(from, git2::BranchType::Local)?;
            branch.rename(to, false)?;
            Ok(())
        })
    }
    fn create_tag(&self, repo_id: &RepoId, name: &str, target: TagTarget) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let obj = repo
                .revparse_single(&target.oid)
                .map_err(|_| AppError::InvalidRef(target.oid.clone()))?;
            match target.annotation {
                Some(msg) => {
                    let sig = crate::git::signature::default_signature(repo)?;
                    repo.tag(name, &obj, &sig, &msg, false)?;
                }
                None => {
                    repo.tag_lightweight(name, &obj, false)?;
                }
            }
            Ok(())
        })
    }
    fn delete_tag(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            repo.tag_delete(name)?;
            Ok(())
        })
    }
    fn reset(&self, repo_id: &RepoId, target: &str, mode: ResetMode) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let obj = repo
                .revparse_single(target)
                .map_err(|_| AppError::InvalidRef(target.to_string()))?;
            let reset_type = match mode {
                ResetMode::Soft => git2::ResetType::Soft,
                ResetMode::Mixed => git2::ResetType::Mixed,
                ResetMode::Hard => git2::ResetType::Hard,
            };
            repo.reset(&obj, reset_type, None)?;
            Ok(())
        })
    }
    fn cherry_pick(&self, repo_id: &RepoId, oid: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(oid)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?;
            let commit = target.peel_to_commit()?;

            // Apply changes into the index + worktree.
            repo.cherrypick(&commit, None)?;

            // If there are conflicts, leave them for the user to resolve (Plan C).
            let statuses = repo.statuses(None)?;
            let has_conflict = statuses.iter().any(|s| s.status().is_conflicted());
            if has_conflict {
                return Err(AppError::ConflictsDetected(format!(
                    "cherry-pick of {} produced conflicts",
                    &commit.id().to_string()[..7]
                )));
            }

            // Build the commit.
            let sig = crate::git::signature::default_signature(repo)?;
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let parent = repo.head()?.peel_to_commit()?;

            // Preserve original author, new committer.
            let author = commit.author();
            repo.commit(
                Some("HEAD"),
                &author,
                &sig,
                commit.message().unwrap_or(""),
                &tree,
                &[&parent],
            )?;

            // Clear cherrypick state.
            repo.cleanup_state()?;
            Ok(())
        })
    }
    fn revert(&self, repo_id: &RepoId, oid: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(oid)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?;
            let commit = target.peel_to_commit()?;

            repo.revert(&commit, None)?;

            let statuses = repo.statuses(None)?;
            if statuses.iter().any(|s| s.status().is_conflicted()) {
                return Err(AppError::ConflictsDetected(format!(
                    "revert of {} produced conflicts",
                    &commit.id().to_string()[..7]
                )));
            }

            let sig = crate::git::signature::default_signature(repo)?;
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let parent = repo.head()?.peel_to_commit()?;

            let msg = format!("Revert \"{}\"", commit.summary().unwrap_or("commit"));
            repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[&parent])?;
            repo.cleanup_state()?;
            Ok(())
        })
    }
    fn stash_save(&self, repo_id: &RepoId, opts: StashSaveOptions) -> AppResult<Option<String>> {
        self.with_repo_mut(repo_id, |repo| {
            // Build the signature before taking `&mut repo` for stash_save2.
            // default_signature borrows `&Repository`, so we must call to_owned()
            // to release the shared borrow before the mutable borrow below.
            let sig = crate::git::signature::default_signature(repo)?.to_owned();
            let mut flags = git2::StashFlags::DEFAULT;
            if opts.include_untracked {
                flags |= git2::StashFlags::INCLUDE_UNTRACKED;
            }
            if opts.keep_index {
                flags |= git2::StashFlags::KEEP_INDEX;
            }
            let message = opts.message.as_deref();
            match repo.stash_save2(&sig, message, Some(flags)) {
                Ok(oid) => Ok(Some(oid.to_string())),
                Err(e) if e.code() == git2::ErrorCode::NotFound => Ok(None),
                Err(e) => Err(e.into()),
            }
        })
    }
    fn stash_apply(&self, repo_id: &RepoId, index: usize) -> AppResult<()> {
        self.with_repo_mut(repo_id, |repo| {
            repo.stash_apply(index, None)?;
            Ok(())
        })
    }
    fn stash_pop(&self, repo_id: &RepoId, index: usize) -> AppResult<()> {
        self.with_repo_mut(repo_id, |repo| {
            repo.stash_pop(index, None)?;
            Ok(())
        })
    }
    fn stash_drop(&self, repo_id: &RepoId, index: usize) -> AppResult<()> {
        self.with_repo_mut(repo_id, |repo| {
            repo.stash_drop(index)?;
            Ok(())
        })
    }
    fn repo_path(&self, repo_id: &RepoId) -> AppResult<PathBuf> {
        self.with_repo(repo_id, |repo| {
            repo.workdir()
                .map(PathBuf::from)
                .ok_or_else(|| AppError::InvalidPath("bare repository has no workdir".into()))
        })
    }

    fn add_remote(&self, repo_id: &RepoId, name: &str, url: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            repo.remote(name, url)?;
            Ok(())
        })
    }

    fn remove_remote(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            repo.remote_delete(name)?;
            Ok(())
        })
    }

    fn rename_remote(&self, repo_id: &RepoId, from: &str, to: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // remote_rename returns a list of refspecs that were not renamed
            // (e.g. custom ones); we ignore them — standard push/fetch refspecs
            // are always updated.
            repo.remote_rename(from, to)?;
            Ok(())
        })
    }

    fn set_remote_url(&self, repo_id: &RepoId, name: &str, url: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            repo.remote_set_url(name, url)?;
            Ok(())
        })
    }

    /// Prune stale remote-tracking refs by shelling out to `git remote prune`.
    /// libgit2 lacks a first-class prune API that handles all edge cases, so we
    /// delegate to the CLI — same as how `git fetch --prune` works under the hood.
    fn prune_remote(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
        // We need the path synchronously here (called from spawn_blocking context).
        let path = self.repo_path(repo_id)?;
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&path)
            .arg("remote")
            .arg("prune")
            .arg(name)
            .output()
            .map_err(|e| AppError::Io(e.to_string()))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(AppError::Network(format!("prune failed: {}", stderr)));
        }
        Ok(())
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

    fn repo_state(&self, repo_id: &RepoId) -> AppResult<RepoState> {
        self.with_repo(repo_id, |repo| {
            use git2::RepositoryState as RS;
            Ok(match repo.state() {
                RS::Clean => RepoState::Clean,
                RS::Merge => RepoState::Merge,
                RS::Revert => RepoState::Revert,
                RS::RevertSequence => RepoState::RevertSequence,
                RS::CherryPick => RepoState::CherryPick,
                RS::CherryPickSequence => RepoState::CherryPickSequence,
                RS::Bisect => RepoState::Bisect,
                RS::Rebase => RepoState::Rebase,
                RS::RebaseInteractive => RepoState::RebaseInteractive,
                RS::RebaseMerge => RepoState::RebaseMerge,
                RS::ApplyMailbox => RepoState::ApplyMailbox,
                RS::ApplyMailboxOrRebase => RepoState::ApplyMailboxOrRebase,
            })
        })
    }

    fn conflict_sides(&self, repo_id: &RepoId, path: &Path) -> AppResult<ConflictSides> {
        self.with_repo(repo_id, |repo| {
            let index = repo.index()?;
            let path_str = path.to_string_lossy().to_string();
            let path_bytes = path.to_string_lossy().as_bytes().to_vec();

            let mut base_oid = None;
            let mut ours_oid = None;
            let mut theirs_oid = None;

            let conflicts = index.conflicts()?;
            for conflict in conflicts {
                let c = conflict?;
                // Any of ancestor/our/their may refer to `path` — collect those that do.
                let matches_path = |e: &Option<git2::IndexEntry>| {
                    e.as_ref().map(|entry| entry.path == path_bytes).unwrap_or(false)
                };
                if matches_path(&c.ancestor) || matches_path(&c.our) || matches_path(&c.their) {
                    if let Some(ref e) = c.ancestor { base_oid = Some(e.id); }
                    if let Some(ref e) = c.our { ours_oid = Some(e.id); }
                    if let Some(ref e) = c.their { theirs_oid = Some(e.id); }
                    break;
                }
            }

            let read_stage = |oid: Option<git2::Oid>| -> AppResult<(Option<String>, bool)> {
                match oid {
                    None => Ok((None, false)),
                    Some(o) => {
                        let blob = repo.find_blob(o)?;
                        if blob.is_binary() {
                            Ok((None, true))
                        } else {
                            match std::str::from_utf8(blob.content()) {
                                Ok(s) => Ok((Some(s.to_string()), false)),
                                Err(_) => Ok((None, true)),
                            }
                        }
                    }
                }
            };

            let (base, b1) = read_stage(base_oid)?;
            let (ours, b2) = read_stage(ours_oid)?;
            let (theirs, b3) = read_stage(theirs_oid)?;
            let binary = b1 || b2 || b3;

            Ok(ConflictSides {
                path: path_str,
                base: if binary { None } else { base },
                ours: if binary { None } else { ours },
                theirs: if binary { None } else { theirs },
                binary,
            })
        })
    }

    fn accept_ours(&self, repo_id: &RepoId, path: &Path) -> AppResult<()> {
        accept_side(self, repo_id, path, /* ours = */ true)
    }

    fn accept_theirs(&self, repo_id: &RepoId, path: &Path) -> AppResult<()> {
        accept_side(self, repo_id, path, /* ours = */ false)
    }

    fn mark_resolved(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let mut index = repo.index()?;
            for p in paths {
                // remove_path drops all three stages; add_path re-inserts the worktree version as stage 0.
                let _ = index.remove_path(p);
                index.add_path(p)?;
            }
            index.write()?;
            Ok(())
        })
    }

    fn abort_operation(&self, repo_id: &RepoId) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let head = match repo.head() {
                Ok(h) => h.peel_to_commit()?,
                Err(_) => return Err(AppError::Unborn),
            };
            repo.reset(head.as_object(), git2::ResetType::Hard, None)?;
            repo.cleanup_state()?;
            Ok(())
        })
    }

    fn continue_operation(&self, repo_id: &RepoId) -> AppResult<String> {
        self.with_repo(repo_id, |repo| {
            let statuses = repo.statuses(None)?;
            if statuses.iter().any(|s| s.status().is_conflicted()) {
                return Err(AppError::ConflictsDetected(
                    "some files still have unresolved conflicts".into(),
                ));
            }

            let sig = crate::git::signature::default_signature(repo)?.to_owned();
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let head_commit = repo.head()?.peel_to_commit()?;

            let message = repo
                .message()
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "merge commit".into());

            let parents: Vec<git2::Commit> = match repo.state() {
                git2::RepositoryState::Merge => {
                    let merge_head = repo
                        .revparse_single("MERGE_HEAD")
                        .map_err(|_| AppError::Internal("MERGE_HEAD missing".into()))?;
                    let second = merge_head.peel_to_commit()?;
                    vec![head_commit, second]
                }
                _ => vec![head_commit],
            };
            let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

            let oid = repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parent_refs)?;
            repo.cleanup_state()?;
            Ok(oid.to_string())
        })
    }
}
