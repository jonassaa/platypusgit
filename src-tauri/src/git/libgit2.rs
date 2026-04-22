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
        BranchInfo, CommitInfo, CommitOptions, DiffHunk, DiffKind, DiffLine, DiffLineKind,
        FileDiff, FileStatus, RemoteInfo, RepoHandle, RepoId, ResetMode, StashInfo,
        StashSaveOptions, StatusFlag, TagInfo, TagTarget,
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

    fn checkout_branch(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
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
    fn create_tag(&self, _repo_id: &RepoId, _name: &str, _target: TagTarget) -> AppResult<()> {
        Err(AppError::NotImplemented)
    }
    fn delete_tag(&self, _repo_id: &RepoId, _name: &str) -> AppResult<()> {
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
    fn stash_drop(&self, _repo_id: &RepoId, _index: usize) -> AppResult<()> {
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
