use std::{
    collections::{HashMap, VecDeque},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

use git2::{
    BranchType, DiffFindOptions, DiffFormat, DiffOptions, Repository, Sort, Status, StatusOptions,
};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::git::image;
use crate::git::ownership;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use crate::opener::{resolved_workdir_path, safe_workdir_path};

use super::{
    types::{
        AheadBehind, BisectMark, BisectStatus,
        BlameLine, BlameResult, BranchInfo, CommitInfo, CommitNote, CommitOptions, CommitResult,
        ConflictSides,
        DeleteFailure, DiffHunk,
        BulkFastForward,
        BlobSource,
        DiffKind,
        DiffLine, DiffLineKind, FastForward, FileContent, FileDiff, FileStatus, HeadInfo, ImagePreview,
        LfsStatus,
        LogFilter, LogPage,
        RebaseAction, RebaseStatus, RebaseStep, RebaseSummary, ReflogEntry, ReflogOp, RemoteInfo,
        RepoHandle, RepoId, RepoState, ResetMode, StashInfo, StashSaveOptions, StatusFlag,
        SubmoduleInfo, TagInfo, TagTarget, UnsupportedReason, WorkdirDiff, WorktreeBranch, WorktreeInfo,
        REFSPEC_ALL,
    },
    GitBackend,
};

/// In-memory state for a running interactive rebase on a given repo.
pub struct RebaseState {
    pub plan: VecDeque<RebaseStep>,
    pub total: usize,
    pub completed: usize,
    pub pause_reason: Option<String>,
    /// The step whose cherry-pick conflicted and is awaiting resolution. Held
    /// out of `plan` so `rebase_continue` commits the user-resolved tree
    /// instead of re-running the cherry-pick from scratch (which would
    /// re-conflict). Cleared once the resolved step is committed.
    pub conflict_step: Option<RebaseStep>,
    /// Branch tip before `rebase_start` moved it — `rebase_abort` restores
    /// this rather than just resetting to wherever the in-progress rebase
    /// happened to stop (see `rebase_abort` doc comment).
    pub orig_head: String,
    /// Full ref name of the branch HEAD pointed at when the rebase started
    /// (`refs/heads/…`), or `None` when it started from a detached HEAD. The
    /// replay runs detached; this ref is moved exactly once, when the plan
    /// completes.
    pub head_name: Option<String>,
    /// The commit the replay started from — the base every step sits on top of
    /// unless it says otherwise. Recorded so a resumed session knows where the
    /// replay began.
    pub onto: String,
    /// Original oid → rewritten oid for every step that has run. A dropped or
    /// skipped step maps to the HEAD it left behind, so a later step that has
    /// to sit on top of it still resolves to a real commit.
    pub rewritten: HashMap<String, String>,
}

pub struct Libgit2Backend {
    repos: Mutex<HashMap<RepoId, Arc<Mutex<Repository>>>>,
    rebases: Mutex<HashMap<RepoId, RebaseState>>,
    /// Serializes the guard → write → cleanup window in `init` to prevent two
    /// concurrent calls on the same path from interfering. Without this lock, call
    /// A's cleanup could delete `.git` that call B just created, since the
    /// pre-init guard and post-write cleanup are not atomic across both calls.
    init_lock: Mutex<()>,
}

impl Libgit2Backend {
    pub fn new() -> Self {
        Self {
            repos: Mutex::new(HashMap::new()),
            rebases: Mutex::new(HashMap::new()),
            init_lock: Mutex::new(()),
        }
    }

    /// Clone the repo's own `Arc<Mutex<_>>` out of the map and RELEASE the map
    /// lock before running `f`. The map guard used to stay alive for the whole
    /// operation, so every git op in the process — any repository, any window —
    /// serialized on one mutex: a 500-commit log walk in one tab blocked a
    /// status refresh in another, and `refreshAll`'s parallel commands ran
    /// strictly one after another. Same-repo ops still serialize on the inner
    /// mutex (`git2::Repository` is Send but not Sync — that part is
    /// load-bearing, e.g. the stash TOCTOU note relies on it); different repos
    /// now genuinely run in parallel.
    fn repo_cell(&self, repo_id: &RepoId) -> AppResult<Arc<Mutex<Repository>>> {
        let map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        map.get(repo_id)
            .cloned()
            .ok_or_else(|| AppError::UnknownRepo(repo_id.0.clone()))
    }

    fn with_repo<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&Repository) -> AppResult<T>,
    {
        let cell = self.repo_cell(repo_id)?;
        let repo = cell
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        f(&repo)
    }

    fn with_repo_mut<F, T>(&self, repo_id: &RepoId, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Repository) -> AppResult<T>,
    {
        let cell = self.repo_cell(repo_id)?;
        let mut repo = cell
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        f(&mut repo)
    }

    /// The in-process blame: libgit2, HEAD, no subprocess.
    ///
    /// This is what a repository with no `blame.ignoreRevsFile` gets, and what
    /// a repository whose ignore-revs file is broken falls back to — so a
    /// misconfigured file costs a warning, never the screen. libgit2 has no
    /// ignore-revs support of any kind, which is the whole reason
    /// `git/blame.rs` exists.
    fn blame_with_libgit2(&self, repo_id: &RepoId, path: &Path) -> AppResult<Vec<BlameLine>> {
        self.with_repo(repo_id, |repo| {
            let mut opts = git2::BlameOptions::new();
            let blame = repo.blame_file(path, Some(&mut opts))?;

            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::Git("bare repo has no worktree".into()))?;
            let content = std::fs::read_to_string(workdir.join(path))?;
            let content_lines: Vec<&str> = content.lines().collect();

            let mut out = Vec::new();
            for hunk in blame.iter() {
                let oid = hunk.final_commit_id();
                let commit = repo.find_commit(oid).ok();
                let author = commit
                    .as_ref()
                    .map(|c| c.author().name().unwrap_or("").to_string())
                    .unwrap_or_default();
                let email = commit
                    .as_ref()
                    .map(|c| c.author().email().unwrap_or("").to_string())
                    .unwrap_or_default();
                let timestamp = commit
                    .as_ref()
                    .map(|c| c.time().seconds())
                    .unwrap_or(0);
                let summary = commit
                    .as_ref()
                    .and_then(|c| c.summary().map(String::from))
                    .unwrap_or_default();
                let short = oid.to_string()[..7].to_string();
                let start = hunk.final_start_line();
                for i in 0..hunk.lines_in_hunk() {
                    let line_no = (start + i) as u32;
                    let content_str = content_lines
                        .get((line_no - 1) as usize)
                        .copied()
                        .unwrap_or("")
                        .to_string();
                    out.push(BlameLine {
                        line_no,
                        oid: oid.to_string(),
                        short_oid: short.clone(),
                        author: author.clone(),
                        email: email.clone(),
                        timestamp,
                        summary: summary.clone(),
                        content: content_str,
                        // libgit2 ignores nothing, so it can mark nothing.
                        ignored: false,
                        unblamable: false,
                    });
                }
            }
            out.sort_by_key(|l| l.line_no);
            Ok(out)
        })
    }

    /// Drop the entry at `index`, but only if it is still the one the caller
    /// picked (#133).
    ///
    /// **Enumerate, verify and drop happen in ONE `with_repo_mut` closure, and
    /// that is the entire point.** `with_repo_mut` holds the backend's `repos`
    /// mutex only for its closure's duration, so a check in one acquisition and
    /// a drop in the next is a TOCTOU: the map mutex serialises every backend
    /// git op, which means a concurrent command already parked on it is
    /// scheduled to run at exactly that boundary. Any write to `refs/stash`
    /// landing there shifts every index, and the drop then deletes a DIFFERENT
    /// entry — permanently, and one the user never touched. Nothing on the
    /// frontend gates stash writes with a busy flag, and the reflog screen's
    /// auto-stash is another live writer, so this is not a theoretical race.
    fn stash_drop_at(&self, repo_id: &RepoId, index: usize, expect_oid: &str) -> AppResult<()> {
        self.with_repo_mut(repo_id, |repo| {
            let (oid, _) = stash_entry_at(repo, index)?;
            if oid != expect_oid {
                return Err(AppError::StaleStash(format!("stash@{{{index}}}")));
            }
            repo.stash_drop(index)?;
            Ok(())
        })
    }

    /// The post-store half of a rename: verify the list, then drop — in ONE
    /// lock acquisition (#133).
    ///
    /// Same reasoning as `stash_drop_at`, and the reason the gate reads the
    /// list *here* rather than in the caller: a `rename_store_landed` decision
    /// taken under one acquisition and acted on under the next is a check about
    /// a list that may no longer exist. Both halves have to see the same one.
    fn stash_finish_rename(
        &self,
        repo_id: &RepoId,
        index: usize,
        before: &[(String, String)],
        new_oid: &str,
        message: &str,
    ) -> AppResult<()> {
        self.with_repo_mut(repo_id, |repo| {
            let after = stash_pairs(repo)?;
            if !crate::git::stash::rename_store_landed(before, &after, index, new_oid, message) {
                return Err(AppError::Git(format!(
                    "stash rename could not be verified; the original stash@{{{index}}} was left in place"
                )));
            }
            repo.stash_drop(index + 1)?;
            Ok(())
        })
    }

    /// What `refs/stash` points at right now, or `None` when the repository has
    /// no stash at all (#133).
    ///
    /// Read either side of a `git stash push` shell-out to tell "an entry was
    /// created" from "git had nothing to save": the pathspec form prints
    /// `No local changes to save` and exits **0**, so the exit status cannot
    /// answer that question and the ref has to.
    fn stash_tip(&self, repo_id: &RepoId) -> AppResult<Option<String>> {
        self.with_repo(repo_id, |repo| {
            Ok(repo
                .find_reference("refs/stash")
                .ok()
                .and_then(|r| r.target())
                .map(|oid| oid.to_string()))
        })
    }
}

impl Default for Libgit2Backend {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Interactive rebase helpers ───────────────────────────────────────────────

impl Libgit2Backend {
    /// Cherry-pick `oid` onto the current HEAD without the libgit2-level commit
    /// (we build our own commit so we can control the message, tree, etc.).
    /// Returns Ok(true) on a clean apply; Ok(false) when the pick produced
    /// conflicts (the worktree is left dirty so the user can resolve them).
    /// Apply `oid`'s diff into the index + worktree (a cherry-pick), WITHOUT
    /// committing. Returns `Ok(false)` when the merge left conflicts (caller
    /// pauses for the user), `Ok(true)` when it applied cleanly and the tree is
    /// staged ready for `finish_pick`.
    /// `mainline` is 0 for an ordinary commit and 1 for a merge commit being
    /// flattened into one commit — libgit2 refuses a merge without one
    /// ("mainline branch is not specified"), which is exactly the error a plan
    /// containing an unhandled merge used to hit mid-replay, and it equally
    /// refuses a mainline on a single-parent commit.
    fn start_pick(&self, repo_id: &RepoId, oid: &str, mainline: u32) -> AppResult<bool> {
        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(oid)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?
                .peel_to_commit()?;
            let mut opts = git2::CherrypickOptions::new();
            opts.mainline(mainline);
            repo.cherrypick(&target, Some(&mut opts))?;
            let statuses = repo.statuses(None)?;
            Ok(!statuses.iter().any(|s| s.status().is_conflicted()))
        })
    }

    /// Commit the currently-staged tree as `oid`'s rebased commit onto HEAD,
    /// preserving the original author + message, then clear the cherry-pick
    /// state. Used both after a clean `start_pick` and when resuming a
    /// conflict the user has resolved (the staged tree is then their merge).
    fn finish_pick(&self, repo_id: &RepoId, oid: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(oid)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?
                .peel_to_commit()?;
            let sig = crate::git::signature::default_signature(repo)?;
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let head_commit = repo.head()?.peel_to_commit()?;
            let author = target.author();
            repo.commit(
                Some("HEAD"),
                &author,
                &sig,
                target.message().unwrap_or(""),
                &tree,
                &[&head_commit],
            )?;
            repo.cleanup_state()?;
            Ok(())
        })
    }

    /// Resolve a merge step's original parents through the rewritten map. A
    /// parent that was not replayed (it lives below the range) keeps its own
    /// oid.
    fn resolved_merge_parents(
        &self,
        repo_id: &RepoId,
        step: &RebaseStep,
    ) -> AppResult<Vec<String>> {
        let rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let rewritten = rebases.get(repo_id).map(|s| &s.rewritten);
        Ok(step
            .merge_parents
            .iter()
            .map(|old| {
                rewritten
                    .and_then(|m| m.get(old).cloned())
                    .unwrap_or_else(|| old.clone())
            })
            .collect())
    }

    /// Re-merge a recreated merge's other parents into the current HEAD.
    /// Returns `Ok(false)` when the merge conflicts — the worktree keeps the
    /// conflicted index, so the operation bar and the merge resolver window work
    /// exactly as they do for a conflicting pick.
    ///
    /// A worktree merge, not `merge_commits`: the conflicted index with its
    /// stages is what every conflict surface in the app reads.
    fn apply_merge(&self, repo_id: &RepoId, step: &RebaseStep) -> AppResult<bool> {
        let parents = self.resolved_merge_parents(repo_id, step)?;
        self.with_repo(repo_id, |repo| {
            let annotated: Vec<git2::AnnotatedCommit> = parents
                .iter()
                .map(|oid| {
                    let commit = repo
                        .revparse_single(oid)
                        .map_err(|_| AppError::InvalidRef(oid.clone()))?
                        .peel_to_commit()?;
                    Ok(repo.find_annotated_commit(commit.id())?)
                })
                .collect::<AppResult<Vec<_>>>()?;
            let refs: Vec<&git2::AnnotatedCommit> = annotated.iter().collect();
            repo.merge(&refs, None, None)?;
            let index = repo.index()?;
            Ok(!index.has_conflicts())
        })
    }

    /// Commit the staged tree as the recreated merge — original message and
    /// author, parents = current HEAD plus the rewritten other parents.
    fn finish_merge(&self, repo_id: &RepoId, step: &RebaseStep) -> AppResult<()> {
        let parents = self.resolved_merge_parents(repo_id, step)?;
        self.with_repo(repo_id, |repo| {
            let original = repo
                .revparse_single(&step.oid)
                .map_err(|_| AppError::InvalidRef(step.oid.clone()))?
                .peel_to_commit()?;
            let sig = crate::git::signature::default_signature(repo)?;
            let mut index = repo.index()?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;
            let head = repo.head()?.peel_to_commit()?;

            let others: Vec<git2::Commit> = parents
                .iter()
                .map(|oid| {
                    Ok(repo
                        .revparse_single(oid)
                        .map_err(|_| AppError::InvalidRef(oid.clone()))?
                        .peel_to_commit()?)
                })
                .collect::<AppResult<Vec<_>>>()?;
            let mut parent_refs: Vec<&git2::Commit> = vec![&head];
            parent_refs.extend(others.iter());

            repo.commit(
                Some("HEAD"),
                &original.author(),
                &sig,
                original.message().unwrap_or(""),
                &tree,
                &parent_refs,
            )?;
            repo.cleanup_state()?;
            Ok(())
        })
    }

    /// True when a rebase GIT itself owns is in progress — the `.git/rebase-*`
    /// state written by the `git rebase` that the `rebase_onto` command shells
    /// out to, or by one the user started in a terminal before opening the app.
    ///
    /// Ours is excluded via `rebase_in_progress`, which covers both the
    /// in-memory plan and the rehydratable state file — checking only the
    /// HashMap would misread one of our own rebases as git's after a restart,
    /// and then hand `git rebase --abort` a repository git sees no rebase in.
    /// With ours ruled out, `repo_state` cannot be reporting our override
    /// either, so what remains is libgit2's honest read of git's own dirs.
    ///
    /// The distinction matters because libgit2 cannot finish a git-owned rebase
    /// and the generic paths are actively wrong for it: `continue_operation`
    /// would commit the resolved tree and `cleanup_state()` — abandoning every
    /// step still queued — and `abort_operation` would hard reset to the
    /// mid-rebase HEAD, leaving the user detached at a half-rebased position
    /// instead of back on their branch. Both hand off to git instead.
    fn cli_rebase_in_progress(&self, repo_id: &RepoId) -> AppResult<bool> {
        if self.rebase_in_progress(repo_id)? {
            return Ok(false);
        }
        Ok(matches!(
            self.repo_state(repo_id)?,
            RepoState::Rebase | RepoState::RebaseInteractive | RepoState::RebaseMerge
        ))
    }

    /// `git rebase --continue` / `--abort` in the worktree.
    fn run_rebase_flag(&self, repo_id: &RepoId, flag: &str) -> AppResult<()> {
        let repo_path = self.repo_path(repo_id)?;
        let out = crate::proc::git(&repo_path)
            .args(["rebase", flag])
            // `--continue` commits the resolved tree, and git opens an editor
            // for the message unless told not to. There is no tty here, so an
            // editor would block forever. (`GIT_TERMINAL_PROMPT=0` and the
            // closed stdin come from `proc::git`.)
            .env("GIT_EDITOR", "true")
            .env("GIT_SEQUENCE_EDITOR", "true")
            .output()
            .map_err(|e| AppError::Io(e.to_string()))?;
        if !out.status.success() {
            // A `--continue` that runs into the NEXT conflict also exits
            // non-zero, and says so on stdout rather than stderr — take
            // whichever stream spoke so the banner is not empty.
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let detail = if stderr.is_empty() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                stderr
            };
            return Err(AppError::Git(format!("git rebase {flag}: {detail}")));
        }
        Ok(())
    }

    fn bump_completed(&self, repo_id: &RepoId) -> AppResult<()> {
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(state) = rebases.get_mut(repo_id) {
            state.completed += 1;
        }
        Ok(())
    }

    /// Record what a step's commit became, so a later step that has to sit on
    /// top of it can resolve the rewritten oid. A dropped step maps to the HEAD
    /// it left behind.
    fn record_rewritten(&self, repo_id: &RepoId, old: &str) -> AppResult<()> {
        let new = self.with_repo(repo_id, |repo| {
            Ok(repo.head()?.peel_to_commit()?.id().to_string())
        })?;
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(state) = rebases.get_mut(repo_id) {
            state.rewritten.insert(old.to_string(), new);
        }
        Ok(())
    }

    /// Mirror the in-memory rebase to the gitdir. Called after every state
    /// transition; a missing in-memory entry means the rebase is over, so the
    /// file goes away.
    fn persist_rebase(&self, repo_id: &RepoId) -> AppResult<()> {
        let snapshot = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases
                .get(repo_id)
                .map(|s| crate::git::rebase_state::PersistedRebase {
                    version: crate::git::rebase_state::VERSION,
                    head_name: s.head_name.clone(),
                    orig_head: s.orig_head.clone(),
                    onto: s.onto.clone(),
                    total: s.total,
                    completed: s.completed,
                    remaining: s.plan.iter().cloned().collect(),
                    pause_reason: s.pause_reason.clone(),
                    current: s.conflict_step.clone().map(|step| {
                        crate::git::rebase_state::PersistedCurrent {
                            step,
                            phase: s.pause_reason.clone().unwrap_or_else(|| "conflict".into()),
                        }
                    }),
                    rewritten: s
                        .rewritten
                        .iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect(),
                })
        };

        self.with_repo(repo_id, |repo| match &snapshot {
            Some(state) => {
                // Re-assert ORIG_HEAD on every transition, not just at start: a
                // hard reset writes its own ORIG_HEAD, so the resets this engine
                // performs mid-replay (moving to a step's base, collapsing a
                // squash) would otherwise leave a mid-rebase commit there and
                // break `git reset --hard ORIG_HEAD` as an escape hatch.
                crate::git::rebase_state::write_orig_head(repo, &state.orig_head)?;
                crate::git::rebase_state::save(repo, state)
            }
            None => crate::git::rebase_state::clear(repo),
        })
    }

    /// Rebuild the in-memory rebase from the state file. Used when this process
    /// did not start the rebase — the app was restarted mid-operation — so that
    /// Continue and Abort work the same as they would have in the original
    /// session. Returns false when there is no rebase on disk.
    fn rehydrate_rebase(&self, repo_id: &RepoId) -> AppResult<bool> {
        let Some(p) = self.with_repo(repo_id, crate::git::rebase_state::load)? else {
            return Ok(false);
        };
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        rebases.insert(
            repo_id.clone(),
            RebaseState {
                plan: p.remaining.into_iter().collect(),
                total: p.total,
                completed: p.completed,
                pause_reason: p.pause_reason,
                conflict_step: p.current.map(|c| c.step),
                orig_head: p.orig_head,
                head_name: p.head_name,
                onto: p.onto,
                rewritten: p.rewritten.into_iter().collect(),
            },
        );
        Ok(true)
    }

    /// True when a rebase this backend can drive is in progress — in memory, or
    /// recorded on disk by an earlier session.
    fn rebase_in_progress(&self, repo_id: &RepoId) -> AppResult<bool> {
        let in_memory = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.contains_key(repo_id)
        };
        if in_memory {
            return Ok(true);
        }
        Ok(self
            .with_repo(repo_id, crate::git::rebase_state::load)?
            .is_some())
    }

    /// Put the detached HEAD on the commit a step wants to be applied onto.
    /// `original_oid` is the pre-rebase oid; the rewritten map translates it to
    /// this run's copy, falling back to the original when the commit was not
    /// rewritten (it sits below the range).
    fn move_to_base(&self, repo_id: &RepoId, original_oid: &str) -> AppResult<()> {
        let resolved = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases
                .get(repo_id)
                .and_then(|s| s.rewritten.get(original_oid).cloned())
                .unwrap_or_else(|| original_oid.to_string())
        };

        self.with_repo(repo_id, |repo| {
            let target = repo
                .revparse_single(&resolved)
                .map_err(|_| AppError::InvalidRef(resolved.clone()))?
                .peel_to_commit()?;
            if repo.head()?.peel_to_commit()?.id() == target.id() {
                return Ok(()); // already there — nothing to reset
            }
            repo.set_head_detached(target.id())?;
            repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
            Ok(())
        })
    }

    /// Point the original branch at the replayed history and reattach HEAD to
    /// it. Called once, when the plan is exhausted. A rebase that started from
    /// a detached HEAD just stays detached.
    fn finish_rebase(&self, repo_id: &RepoId) -> AppResult<()> {
        let head_name = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.get(repo_id).and_then(|s| s.head_name.clone())
        };
        let Some(head_name) = head_name else {
            return Ok(());
        };

        self.with_repo(repo_id, |repo| {
            let tip = repo.head()?.peel_to_commit()?.id();
            repo.reference(&head_name, tip, true, "rebase (finish)")?;
            repo.set_head(&head_name)?;
            Ok(())
        })
    }

    fn mark_paused(&self, repo_id: &RepoId, reason: &str) -> AppResult<RebaseStatus> {
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        if let Some(state) = rebases.get_mut(repo_id) {
            state.pause_reason = Some(reason.into());
        }
        drop(rebases);
        self.persist_rebase(repo_id)?;
        self.rebase_status(repo_id)
    }

    /// The main execution loop: pops steps off the front of the plan and
    /// applies them until either (a) the plan is exhausted, or (b) a step
    /// pauses execution (conflict / edit).
    fn advance_rebase(&self, repo_id: &RepoId) -> AppResult<RebaseStatus> {
        loop {
            // Resume a conflict step first (its cherry-pick already ran and the
            // user has resolved + staged the tree), else take the next planned
            // step. A resumed step skips the cherry-pick — its tree is already
            // the user's merge — so `finish_pick` commits that directly.
            let (step, resuming) = {
                let mut rebases = self
                    .rebases
                    .lock()
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                let state = match rebases.get_mut(repo_id) {
                    Some(s) => s,
                    None => {
                        return Err(AppError::InvalidRef("no rebase in progress".into()))
                    }
                };
                state.pause_reason = None;
                match state.conflict_step.take() {
                    Some(s) => (Some(s), true),
                    None => (state.plan.pop_front(), false),
                }
            };

            let Some(step) = step else {
                // Plan exhausted — move the branch to the replayed history and
                // reattach HEAD before reporting, so the caller's refresh sees
                // the finished state.
                self.finish_rebase(repo_id)?;
                // Rebase complete. Capture the final status
                // before dropping the in-memory state so this call's caller
                // still sees the completed count, but remove the entry so a
                // later `rebase_status` poll (banner) or `abort_operation`
                // call doesn't treat this finished rebase as still
                // in-progress/abortable via its now-stale `orig_head`.
                let mut status = self.rebase_status(repo_id)?;
                {
                    let mut rebases = self
                        .rebases
                        .lock()
                        .map_err(|e| AppError::Internal(e.to_string()))?;
                    rebases.remove(repo_id);
                }
                // No in-memory entry any more, so this sweeps the state file
                // too — the operation is over on disk as well.
                self.persist_rebase(repo_id)?;
                // ...which is exactly why the summary is written separately:
                // with the state gone, this is the only record that the rebase
                // happened, and `rebase_status` keeps reporting it until the UI
                // acknowledges it (#47). Frontend caching of this is what the
                // retained summary replaces.
                let summary = RebaseSummary {
                    total: status.total,
                    completed: status.next_index,
                };
                self.with_repo(repo_id, |repo| {
                    crate::git::rebase_state::save_summary(repo, &summary)
                })?;
                status.last_completed = Some(summary);
                return Ok(status);
            };

            // Drop is never cherry-picked, so it is never a resume step. It
            // still maps into `rewritten` — as the HEAD it left behind — so a
            // later step whose base was dropped resolves to a real commit.
            if !resuming && step.action == RebaseAction::Drop {
                self.bump_completed(repo_id)?;
                self.record_rewritten(repo_id, &step.oid)?;
                self.persist_rebase(repo_id)?;
                continue;
            }

            // Topology: a step that names an `onto` is replayed there rather
            // than on the previous step's result. Skipped while resuming — the
            // worktree already holds the user's resolution for this step.
            if !resuming {
                if let Some(onto) = step.onto.clone() {
                    self.move_to_base(repo_id, &onto)?;
                }
            }

            // A recreated merge is not a cherry-pick: it re-merges its rewritten
            // parents. A resumed one skips the merge (the worktree already holds
            // the user's resolution) and goes straight to committing it with
            // both parents — which is why only `apply_merge` is guarded here.
            if step.action == RebaseAction::Merge {
                if !resuming && !self.apply_merge(repo_id, &step)? {
                    let mut rebases = self
                        .rebases
                        .lock()
                        .map_err(|e| AppError::Internal(e.to_string()))?;
                    if let Some(state) = rebases.get_mut(repo_id) {
                        state.conflict_step = Some(step);
                    }
                    drop(rebases);
                    return self.mark_paused(repo_id, "conflict");
                }
                self.finish_merge(repo_id, &step)?;
                self.bump_completed(repo_id)?;
                self.record_rewritten(repo_id, &step.oid)?;
                self.persist_rebase(repo_id)?;
                continue;
            }

            // A merge commit being kept as one commit needs a mainline; every
            // other step must not get one.
            let mainline = if step.action == RebaseAction::MainlinePick {
                let parents = self.with_repo(repo_id, |repo| {
                    Ok(repo
                        .revparse_single(&step.oid)
                        .map_err(|_| AppError::InvalidRef(step.oid.clone()))?
                        .peel_to_commit()?
                        .parent_count())
                })?;
                if parents > 1 {
                    1
                } else {
                    0
                }
            } else {
                0
            };

            // Stage the step's changes. On resume the resolved tree is already
            // staged, so skip the (re-)cherry-pick that would re-conflict.
            if !resuming && !self.start_pick(repo_id, &step.oid, mainline)? {
                // Conflict: stash the step out of the plan (so continue commits
                // the resolution rather than re-picking) and pause.
                let mut rebases = self
                    .rebases
                    .lock()
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                if let Some(state) = rebases.get_mut(repo_id) {
                    state.conflict_step = Some(step);
                }
                drop(rebases);
                return self.mark_paused(repo_id, "conflict");
            }

            // Commit the staged tree as this step's rebased commit, then apply
            // the action's post-commit semantics.
            self.finish_pick(repo_id, &step.oid)?;

            match step.action {
                RebaseAction::Drop => {
                    // Only reachable when resuming — a Drop never conflicts and
                    // is handled above on the fresh path. Nothing extra to do.
                    self.bump_completed(repo_id)?;
                }

                RebaseAction::Pick | RebaseAction::MainlinePick => {
                    self.bump_completed(repo_id)?;
                }

                RebaseAction::Merge => {
                    // Unreachable: a Merge step is handled and `continue`d above,
                    // because it re-merges rather than cherry-picks. Kept as an
                    // explicit arm so adding an action forces a decision here.
                    return Err(AppError::Internal(
                        "merge step reached the cherry-pick path".into(),
                    ));
                }

                RebaseAction::Reword => {
                    let new_msg = step.message.clone().unwrap_or_default();
                    self.with_repo(repo_id, |repo| {
                        let sig = crate::git::signature::default_signature(repo)?;
                        let head = repo.head()?.peel_to_commit()?;
                        head.amend(
                            Some("HEAD"),
                            None,
                            Some(&sig),
                            None,
                            Some(&new_msg),
                            None,
                        )?;
                        Ok(())
                    })?;
                    self.bump_completed(repo_id)?;
                }

                RebaseAction::Edit => {
                    self.bump_completed(repo_id)?;
                    self.record_rewritten(repo_id, &step.oid)?;
                    return self.mark_paused(repo_id, "edit");
                }

                RebaseAction::Squash | RebaseAction::Fixup => {
                    let is_fixup = matches!(step.action, RebaseAction::Fixup);

                    self.with_repo(repo_id, |repo| {
                        let sig = crate::git::signature::default_signature(repo)?;
                        let head = repo.head()?.peel_to_commit()?;
                        // head's parent is the previous commit in the new history.
                        let prev = head.parent(0)?;

                        let new_msg = if is_fixup {
                            prev.message().unwrap_or("").to_string()
                        } else {
                            step.message.clone().unwrap_or_else(|| {
                                format!(
                                    "{}\n\n{}",
                                    prev.message().unwrap_or(""),
                                    head.message().unwrap_or(""),
                                )
                            })
                        };

                        // New commit parents are prev's parents (i.e. we squash head into prev).
                        let grandparents: Vec<git2::Commit> = (0..prev.parent_count())
                            .filter_map(|i| prev.parent(i).ok())
                            .collect();
                        let gp_refs: Vec<&git2::Commit> = grandparents.iter().collect();

                        let tree = head.tree()?;
                        let new_oid =
                            repo.commit(None, &sig, &sig, &new_msg, &tree, &gp_refs)?;
                        let new_commit = repo.find_commit(new_oid)?;
                        repo.reset(
                            new_commit.as_object(),
                            git2::ResetType::Hard,
                            None,
                        )?;
                        Ok(())
                    })?;
                    self.bump_completed(repo_id)?;
                }
            }

            // Record what this step became AFTER the action's post-commit
            // rewrite — reword amends, squash/fixup collapse — so the map holds
            // the oid a later step should build on rather than the intermediate
            // commit `finish_pick` wrote.
            self.record_rewritten(repo_id, &step.oid)?;
            self.persist_rebase(repo_id)?;
        }
    }
}

enum StatusSide {
    Worktree,
    Index,
}

// ─── Embedded (nested) repositories ──────────────────────────────────────────

/// Drop the trailing separator libgit2 appends to directory status entries, so
/// `vendor/lib/` and `vendor/lib` normalize to the same path. BOTH forms reach
/// the backend: `status()` emits the slashed one, while the file-tree UI splits
/// paths into segments and rebuilds the slashless one.
fn strip_trailing_slash(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let trimmed = s.trim_end_matches(['/', '\\']);
    PathBuf::from(trimmed)
}

/// True when `path` names a directory inside the worktree that is itself a git
/// repository and is NOT a registered submodule.
///
/// Tests the actual condition — the path is opened as a repository — rather
/// than guessing from the path's shape, because the trailing slash `status()`
/// adds is lost before most call sites and a plain directory looks identical
/// once it is gone.
///
/// It matters because libgit2 stops at the nested `.git` boundary: such a path
/// has no diff (an empty one comes back, so the viewer shows a blank panel), no
/// blame ("path does not exist in the given tree"), no file history (0 entries
/// after a full revwalk), and — worst — `Index::add_path` accepts the slashless
/// form and writes a bare `160000` gitlink with no `.gitmodules` entry, which
/// no clone can resolve.
///
/// A registered submodule is deliberately excluded: its gitlink is intentional,
/// and staging or diffing it is an ordinary submodule-pointer update that must
/// keep working.
fn is_embedded_repo(repo: &Repository, path: &Path) -> bool {
    let Some(workdir) = repo.workdir() else {
        return false;
    };
    let rel = strip_trailing_slash(path);
    if rel.as_os_str().is_empty() {
        return false;
    }
    // Never let a path escape the worktree (see `save_resolution` for the
    // Windows driveless-root case that `is_absolute()` misses).
    if rel.is_absolute()
        || rel.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return false;
    }
    let full = workdir.join(&rel);
    if !full.is_dir() {
        return false;
    }
    // `Repository::open` does not search parent directories, so a plain
    // subdirectory of the outer repo fails here — only a real nested `.git`
    // (directory or gitfile) succeeds.
    //
    // A repository libgit2 refuses on ownership grounds is still a
    // repository. Reading that refusal as "ordinary directory" would retire
    // this guard on any filesystem that trips the ownership check — a nested
    // repo on a `/mnt/c` mount under WSL — and staging would then write an
    // unresolvable `160000` gitlink, the corruption `embedded_repo.rs` exists
    // to prevent.
    if !ownership::repo_presence(&full).exists() {
        return false;
    }
    !is_registered_submodule(repo, &rel)
}

/// True when `rel` is a submodule the repository actually declares, i.e. it has
/// a `.gitmodules` entry with a URL.
///
/// `find_submodule` alone is not enough: libgit2 also reports a bare `160000`
/// index entry as a submodule, and that bare gitlink is precisely the damage an
/// accidental stage does. Only a `.gitmodules` URL makes the gitlink resolvable
/// by a clone — without one it stays embedded, and the UI should keep saying so
/// until the user either registers or ignores it.
fn is_registered_submodule(repo: &Repository, rel: &Path) -> bool {
    repo.find_submodule(&rel.to_string_lossy())
        .ok()
        .and_then(|sm| sm.url().map(|url| !url.is_empty()))
        .unwrap_or(false)
}

/// True when the index holds at least one entry *beneath* `rel`, i.e. `rel`
/// names a directory that contains tracked files.
///
/// Directories are never index entries themselves, so `discard` needs this to
/// tell an untracked directory (safe to delete) from a tracked one (must be
/// restored, not removed).
/// `is_embedded_repo`, but skipping the filesystem for entries that cannot be one.
///
/// `is_embedded_repo` stats every path it is handed, and `list_all_files`
/// enumerates the ENTIRE worktree (unmodified files included) while `status()`
/// runs after every stage, unstage, discard and hunk/line op — so that is one
/// wasted syscall per ordinary file, on the hottest path in the app.
///
/// An embedded repo reaches a listing in exactly two shapes, and both are
/// recognizable without touching disk:
///
/// * libgit2 would not recurse into it, so it is reported as the directory WITH a
///   trailing slash (`embedded_repo.rs` pins `"vendor/lib/"`).
/// * its gitlink is already in the index — staged by an older build or from the
///   command line — in which case it is reported SLASSHLESS and the index entry
///   carries mode `160000` (`unstage_still_removes_an_already_committed_gitlink`
///   is the test that catches a slash-only check).
///
/// Anything else is an ordinary file. Index lookups are an in-memory search, so
/// this costs no syscall.
///
/// Only for paths that came OUT of a listing. Operations (`stage`, `discard`,
/// `reject_embedded_repo`) must keep calling `is_embedded_repo` directly: their
/// path comes from the caller, which may pass either form — `embedded_repo.rs`
/// exercises both `"vendor/lib/"` and `"vendor/lib"`.
fn listed_entry_is_embedded_repo(
    repo: &Repository,
    index: Option<&git2::Index>,
    path: &str,
) -> bool {
    const GITLINK_MODE: u32 = 0o160_000;
    let could_be = path.ends_with('/')
        || index
            .and_then(|i| i.get_path(Path::new(path), 0))
            .is_some_and(|e| e.mode == GITLINK_MODE);
    if !could_be {
        return false;
    }
    is_embedded_repo(repo, Path::new(path))
}

/// True when a listing entry names a submodule the repository declares (#93).
///
/// Takes the path set built once per listing by
/// `submodule::declared_submodule_paths`, so this is a hash lookup per entry, not a
/// syscall — the same discipline `listed_entry_is_embedded_repo` follows, and for
/// the same reason (`status()` runs after every index op).
///
/// libgit2 reports a submodule directory with a trailing slash in some listings and
/// slashless in others, exactly as it does for an embedded repo, so both forms are
/// normalized here. The result is the exact complement of `embedded`: a declared
/// submodule is excluded from `is_embedded_repo` by `is_registered_submodule`, so
/// the two flags can never both be set on one row.
fn is_listed_submodule(submodule_paths: &std::collections::HashSet<String>, path: &str) -> bool {
    if submodule_paths.is_empty() {
        return false;
    }
    submodule_paths.contains(path.trim_end_matches('/'))
}

/// Whether the index tracks `rel` at ANY stage.
///
/// Stage 0 is the ordinary merged entry, but a **conflicted** path has no stage-0
/// entry at all — only stages 1/2/3 (base/ours/theirs). Testing stage 0 alone
/// therefore reads a conflicted file as untracked, which is how `discard` came to
/// delete a merge in progress instead of restoring it.
fn index_tracks_path(index: &git2::Index, rel: &Path) -> bool {
    (0..=3).any(|stage| index.get_path(rel, stage).is_some())
}

fn index_has_entry_under(index: &git2::Index, rel: &Path) -> bool {
    let prefix = strip_trailing_slash(rel).to_string_lossy().to_string();
    if prefix.is_empty() {
        return false;
    }
    let prefix = format!("{prefix}/");
    index
        .iter()
        .any(|e| String::from_utf8_lossy(&e.path).starts_with(&prefix))
}

/// `Err(AppError::EmbeddedRepo)` when `path` is an embedded repository.
fn reject_embedded_repo(repo: &Repository, path: &Path) -> AppResult<()> {
    if is_embedded_repo(repo, path) {
        return Err(AppError::EmbeddedRepo(path.to_string_lossy().to_string()));
    }
    Ok(())
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
/// `DiffOptions` for a worktree-vs-index diff of one path, matching exactly what
/// `diff()` builds for `DiffKind::WorktreeToIndex`.
///
/// The hunk/line staging ops MUST diff with the same options as the diff the user
/// clicked on, or the hunk index and changed-line indices they were handed
/// address different content. The untracked family is what used to be missing:
/// without it a newly created file produces no delta at all, so
/// `find_delta_index` returned `InvalidPath` and staging a new file's hunks or
/// lines was impossible even though the UI offers it.
fn worktree_index_diff_opts(path: &Path, context_lines: u32) -> DiffOptions {
    let mut opts = DiffOptions::new();
    opts.pathspec(path);
    // The pathspec is one concrete file from the status listing, never a glob.
    // Without this flag libgit2 treats the pathspec as a POST-filter: the diff
    // still readdirs and lstats the whole worktree (and descends every
    // untracked directory, given the untracked family below) only to throw all
    // but one file away. With it, the iterators prune to the path — and a file
    // literally named `*.rs` stops glob-matching its siblings.
    opts.disable_pathspec_match(true);
    opts.context_lines(context_lines);
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    opts
}

/// git's on-disk octal mode for a diff entry.
///
/// `git2::FileMode` is an enum, so casting it to an integer yields the *variant
/// discriminant* (0, 1, 2, …), not a mode — emitting that into a `new file mode`
/// header made git read the entry as a gitlink and reject the patch with "corrupt
/// patch for submodule".
fn octal_file_mode(mode: git2::FileMode) -> u32 {
    match mode {
        git2::FileMode::BlobExecutable => 0o100_755,
        git2::FileMode::Link => 0o120_000,
        git2::FileMode::Commit => 0o160_000,
        git2::FileMode::Tree => 0o040_000,
        // Blob, BlobGroupWritable and Unreadable all become a regular file: a
        // plain blob is the only thing a synthesized text patch can create.
        _ => 0o100_644,
    }
}

/// True when the delta has no pre-image, i.e. the patch creates the file.
fn delta_creates_file(delta: &git2::DiffDelta<'_>) -> bool {
    matches!(
        delta.status(),
        git2::Delta::Added | git2::Delta::Untracked
    )
}

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

/// Create a signed commit and move the branch to it (#61 D6).
///
/// **`repo.commit_signed` only writes the object.** Unlike
/// `repo.commit(Some("HEAD"), …)` and `Commit::amend(Some("HEAD"), …)`, it moves
/// no reference — so this function updates the branch and writes the reflog
/// entry itself. A signed commit left on no branch is indistinguishable from
/// lost work from the user's point of view.
///
/// A signing failure returns an error and leaves HEAD untouched: falling back to
/// an unsigned commit would leave the user believing they had signed it.
fn commit_signed(
    repo: &Repository,
    sig: &git2::Signature<'_>,
    message: &str,
    tree: &git2::Tree<'_>,
    head: Option<&git2::Reference<'_>>,
    amend: bool,
) -> AppResult<String> {
    // Parents: an amend replaces HEAD, so it inherits HEAD's parents rather than
    // chaining onto it.
    let tip = match head {
        Some(h) => Some(h.peel_to_commit()?),
        None => None,
    };
    let parents: Vec<git2::Commit> = if amend {
        let tip = tip.as_ref().ok_or(AppError::Unborn)?;
        tip.parents().collect()
    } else {
        tip.iter().cloned().collect()
    };
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

    let buffer = repo.commit_create_buffer(sig, sig, message, tree, &parent_refs)?;
    let buffer_str = std::str::from_utf8(&buffer)
        .map_err(|e| AppError::Internal(format!("commit buffer is not utf-8: {e}")))?;

    let signature = sign_payload(repo, buffer_str)?;
    let oid = repo.commit_signed(buffer_str, &signature, Some("gpgsig"))?;

    // Move the branch ourselves — commit_signed did not.
    let ref_name = match head {
        Some(h) => h
            .name()
            .ok_or_else(|| AppError::Internal("HEAD has no reference name".into()))?
            .to_string(),
        // Unborn HEAD: create the branch it symbolically points at.
        None => repo
            .find_reference("HEAD")?
            .symbolic_target()
            .ok_or(AppError::Unborn)?
            .to_string(),
    };
    let reflog_msg = if amend {
        format!("commit (amend): {}", message.lines().next().unwrap_or(""))
    } else {
        format!("commit: {}", message.lines().next().unwrap_or(""))
    };
    repo.reference(&ref_name, oid, true, &reflog_msg)?;

    Ok(oid.to_string())
}

/// Create a signed annotated tag and point `refs/tags/<name>` at it (#132).
///
/// `git2` has no `tag_signed` counterpart to `commit_signed`, so this is what
/// git itself does in `builtin/tag.c`: build the tag body, sign it, append the
/// armored signature, write the object. What it does **not** do is re-derive
/// git's object serialization — `tag_annotation_create` writes the canonical
/// unsigned object and `odb.read` hands its bytes back, so the payload is
/// byte-for-byte what libgit2 would have stored, with no hand-written tagger
/// formatting or timezone arithmetic.
///
/// **Same trap as `commit_signed`:** neither `tag_annotation_create` nor
/// `odb.write` moves a reference. The ref is written last, on purpose — a
/// signing failure then leaves no tag at all, rather than an unsigned one the
/// user believes is signed.
///
/// Cost: the unsigned annotation from step one is left unreferenced in the ODB
/// and collected by `git gc` like any other loose object. git writes one object
/// where we write two; that is the whole difference.
fn create_signed_tag(
    repo: &Repository,
    name: &str,
    target: &git2::Object<'_>,
    tagger: &git2::Signature<'_>,
    message: &str,
) -> AppResult<()> {
    // Refuse a name collision BEFORE running the signer. The final
    // `repo.reference(…, force = false)` would catch it too, but only after
    // pinentry had taken the user's GPG passphrase for a tag that then fails
    // with "tag already exists" — and after two objects had been written.
    let refname = format!("refs/tags/{name}");
    if repo.find_reference(&refname).is_ok() {
        return Err(AppError::Git(format!("tag '{name}' already exists")));
    }

    // Normalize BEFORE the object is created: the signature is made over the
    // object's bytes, so normalizing afterwards would sign one body and store
    // another.
    let message = crate::git::tag::normalize_message(message);

    let unsigned = repo.tag_annotation_create(name, target, tagger, &message)?;
    let odb = repo.odb()?;
    let body = odb.read(unsigned)?.data().to_vec();
    let payload = std::str::from_utf8(&body)
        .map_err(|e| AppError::Internal(format!("tag buffer is not utf-8: {e}")))?;

    let signature = sign_payload(repo, payload)?;
    let signed = crate::git::tag::append_signature(&body, &signature);
    let oid = odb.write(git2::ObjectType::Tag, &signed)?;

    // Force is still false: the check above is an early-out for the common case,
    // not a substitute for the atomic one. A ref created between the two must
    // fail here, exactly as it does on the unsigned path (`repo.tag(…, false)`).
    //
    // Empty reflog message because `git tag` writes none — core.logAllRefUpdates
    // does not cover refs/tags.
    repo.reference(&refname, oid, false, "")?;
    Ok(())
}

/// Resolve the signing config and produce a detached signature over `payload`.
///
/// The whole chain in one place — `resolve_signing` → `resolve_key_file` →
/// `signing_args` → `run_signer` — because a commit buffer and an annotated-tag
/// body are the same kind of thing to a signer, and a second copy of these four
/// lines is how the ssh key-path restriction would come to hold for commits and
/// lapse for tags (#132).
fn sign_payload(repo: &Repository, payload: &str) -> AppResult<String> {
    use crate::git::signing::{resolve_key_file, resolve_signing, signing_args};

    let cfg = resolve_signing(repo)?;
    let key_file = resolve_key_file(&cfg)?;
    let args = signing_args(&cfg, key_file.as_deref())?;
    run_signer(&cfg.program, &args, payload)
}

/// Run the signing program over `payload`, returning its signature.
///
/// The payload goes on stdin and the signature comes back on stdout, which is
/// how git itself drives gpg and ssh-keygen.
fn run_signer(program: &str, args: &[String], payload: &str) -> AppResult<String> {
    use std::io::Write as _;

    // `proc::program` and not `proc::git`: the payload goes in on stdin, so the
    // prompt-less policy's closed stdin would be exactly wrong here.
    //
    // Windows caveat, deliberately not resolved by assertion (issue 172): the
    // flag stops gpg/ssh-keygen being given a console of its own, and a gpg key
    // with a passphrase asks for it through PINENTRY — Gpg4win's default is the
    // GUI `pinentry-w32`, which is unaffected, but a curses pinentry would want a
    // terminal this GUI-subsystem process never had one to give it either way.
    let mut child = crate::proc::program(program)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| AppError::Git(format!("could not run {program}: {e}")))?;

    // Feed stdin from a helper thread while the parent drains stdout and stderr.
    // Writing the whole payload up front deadlocks once the child fills a pipe
    // buffer (~64KB) it is waiting for us to read: gpg's `--status-fd=2` chatter
    // goes to stderr, so a long commit message can leave both sides blocked.
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Internal("signer has no stdin".into()))?;
    let buf = payload.as_bytes().to_vec();
    let writer = std::thread::spawn(move || stdin.write_all(&buf));

    let out = child
        .wait_with_output()
        .map_err(|e| AppError::Io(e.to_string()))?;
    // A signer that fails early closes stdin, which surfaces here as a broken
    // pipe. That is not itself the failure — the exit status below is what
    // decides, and it carries the signer's own diagnostics.
    let _ = writer.join();
    if !out.status.success() {
        return Err(AppError::Git(format!(
            "signing failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )));
    }
    let signature = String::from_utf8_lossy(&out.stdout).to_string();
    if signature.trim().is_empty() {
        return Err(AppError::Git(format!(
            "{program} produced an empty signature"
        )));
    }
    Ok(signature)
}

/// Which way the synthesized patch will be applied. It decides which
/// *unselected* changed lines become context: reversal flips the side each line
/// lands on, so the rule for `+` and `-` swaps (#61 D7).
#[derive(Clone, Copy, PartialEq, Eq)]
enum PatchDirection {
    Apply,
    Reverse,
}

/// How many `+`/`-` lines a hunk has — the size of the selection index space.
fn changed_line_count(
    diff: &git2::Diff,
    delta_index: usize,
    hunk_index: usize,
) -> AppResult<usize> {
    let patch = git2::Patch::from_diff(diff, delta_index)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Internal("no patch for delta".into()))?;
    let line_count = patch.num_lines_in_hunk(hunk_index).map_err(AppError::from)?;
    let mut n = 0;
    for i in 0..line_count {
        let line = patch.line_in_hunk(hunk_index, i).map_err(AppError::from)?;
        if matches!(line.origin(), '+' | '-') {
            n += 1;
        }
    }
    Ok(n)
}

/// Build a unified-diff patch containing only the selected changed lines of one
/// hunk (#61 D7).
///
/// `selected` holds indices among the hunk's CHANGED (`+`/`-`) lines, counted
/// in hunk order from 0 — NOT indices into `DiffHunk::lines`, which is built by
/// `diff.print` and also carries header and context entries. The two index
/// spaces differ, so callers must count only changed lines.
///
/// The transformation is the one `git add -p` performs when you hand-edit a
/// hunk. For `Apply`: a selected `-`/`+` is kept, an **unselected `-` becomes
/// context** (we are not removing it, so it exists on both sides), and an
/// **unselected `+` is dropped** (it exists on neither side of this partial
/// patch). For `Reverse` those two rules swap.
fn patch_text_for_lines(
    diff: &git2::Diff,
    delta_index: usize,
    hunk_index: usize,
    selected: &[usize],
    direction: PatchDirection,
) -> AppResult<String> {
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

    if selected.is_empty() {
        return Err(AppError::InvalidArgument("no lines selected".to_string()));
    }

    let delta = diff
        .get_delta(delta_index)
        .ok_or_else(|| AppError::Internal(format!("delta {} missing", delta_index)))?;
    let path_str = delta
        .new_file()
        .path()
        .or_else(|| delta.old_file().path())
        .ok_or_else(|| AppError::Internal("delta has no path".into()))?
        .to_string_lossy()
        .to_string();

    // A file with no pre-image can only be *created* by a patch. Reversing such a
    // patch would mean un-creating it, which a partial line selection cannot
    // express — refuse rather than emit something `git apply` would either reject
    // or misapply. Whole-file `discard` already deletes an untracked path.
    let creates = delta_creates_file(&delta);
    if creates && matches!(direction, PatchDirection::Reverse) {
        return Err(AppError::InvalidArgument(format!(
            "{path_str} is not tracked yet — discard the whole file instead of individual lines"
        )));
    }

    let (hunk_header, _) = patch.hunk(hunk_index).map_err(AppError::from)?;
    let old_start = hunk_header.old_start();
    let new_start = hunk_header.new_start();

    let chosen: std::collections::HashSet<usize> = selected.iter().copied().collect();
    // The unselected side that must survive becomes context; the other is
    // dropped entirely.
    let context_side = match direction {
        PatchDirection::Apply => '-',
        PatchDirection::Reverse => '+',
    };

    let mut body = String::new();
    let mut old_count: u32 = 0;
    let mut new_count: u32 = 0;
    let mut changed_seen: usize = 0;

    let line_count = patch.num_lines_in_hunk(hunk_index).map_err(AppError::from)?;
    for line_i in 0..line_count {
        let line = patch.line_in_hunk(hunk_index, line_i).map_err(AppError::from)?;
        let origin = line.origin();
        if !matches!(origin, '+' | '-' | ' ') {
            continue;
        }
        let content = std::str::from_utf8(line.content())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let marker = if origin == ' ' {
            // Context is on both sides regardless of direction or selection.
            Some(' ')
        } else {
            let idx = changed_seen;
            changed_seen += 1;
            if chosen.contains(&idx) {
                Some(origin)
            } else if origin == context_side {
                Some(' ')
            } else {
                None
            }
        };

        let Some(marker) = marker else { continue };
        match marker {
            ' ' => {
                old_count += 1;
                new_count += 1;
            }
            '-' => old_count += 1,
            '+' => new_count += 1,
            _ => {}
        }
        body.push(marker);
        body.push_str(content);
        if !content.ends_with('\n') {
            body.push('\n');
        }
    }

    if changed_seen == 0 {
        return Err(AppError::InvalidArgument(
            "hunk has no changed lines".to_string(),
        ));
    }
    if let Some(&max) = chosen.iter().max() {
        if max >= changed_seen {
            return Err(AppError::InvalidArgument(format!(
                "line index {} out of range (hunk has {} changed lines)",
                max, changed_seen
            )));
        }
    }

    let mut out = String::new();
    out.push_str(&format!("diff --git a/{p} b/{p}\n", p = path_str));
    if creates {
        // A creation patch must say so: `--- a/<path>` for a file that is not in
        // the pre-image makes `git apply` fail ("does not exist in index"), and
        // the hunk's old_start is 0, which is only valid against /dev/null.
        out.push_str(&format!(
            "new file mode {:o}\n",
            octal_file_mode(delta.new_file().mode())
        ));
        out.push_str("--- /dev/null\n");
    } else {
        out.push_str(&format!("--- a/{}\n", path_str));
    }
    out.push_str(&format!("+++ b/{}\n", path_str));
    // Counts are recomputed from the emitted body. Copying the source hunk's
    // header is the classic way to produce a patch `git apply` rejects.
    out.push_str(&format!(
        "@@ -{},{} +{},{} @@\n",
        old_start, old_count, new_start, new_count
    ));
    out.push_str(&body);
    Ok(out)
}

/// Build a minimal unified-diff patch string for a single hunk within a diff.
///
/// Implemented as "every changed line selected" over `patch_text_for_lines`, so
/// whole-hunk and partial staging share one synthesizer and cannot drift apart.
fn patch_text_for_hunk(diff: &git2::Diff, delta_index: usize, hunk_index: usize) -> AppResult<String> {
    let all: Vec<usize> = (0..changed_line_count(diff, delta_index, hunk_index)?).collect();
    patch_text_for_lines(diff, delta_index, hunk_index, &all, PatchDirection::Apply)
}

/// Per-file added/removed line counts for the working tree vs HEAD, index
/// included, keyed by path. One diff pass + cheap `line_stats()` per delta (no
/// full patch print). Untracked files count their whole content as additions.
/// Keyed by both new and old paths so renames/deletions resolve either way.
/// Per-path `(additions, deletions)` for one diff, in a single pass.
///
/// Uses `Diff::foreach` rather than `Patch::from_diff` per delta: a `Patch`
/// materializes the whole per-file patch (every line, allocated) just to read two
/// counters off it, and `status()` is the hottest path in the app — it runs after
/// every stage, unstage, discard and hunk/line op. The callback form walks the
/// same lines without building any of that.
fn diff_line_stats(diff: &git2::Diff) -> AppResult<HashMap<String, (u32, u32)>> {
    let mut map: HashMap<String, (u32, u32)> = HashMap::new();
    // `foreach`'s line callback reports the file it belongs to, so the delta's
    // paths are resolved per line rather than tracked across callbacks.
    let mut line_cb = |delta: git2::DiffDelta<'_>, _hunk: Option<git2::DiffHunk<'_>>, line: git2::DiffLine<'_>| -> bool {
        let add = match line.origin() {
            '+' => true,
            '-' => false,
            // Context and the various file-header origins are not changes.
            _ => return true,
        };
        for p in [delta.new_file().path(), delta.old_file().path()]
            .into_iter()
            .flatten()
        {
            let e = map.entry(p.to_string_lossy().to_string()).or_insert((0, 0));
            if add {
                e.0 += 1;
            } else {
                e.1 += 1;
            }
            // A rename reports both paths; count it once, under the new name,
            // unless there is no new name (a deletion).
            break;
        }
        true
    };
    diff.foreach(&mut |_, _| true, None, None, Some(&mut line_cb))?;
    Ok(map)
}

/// `(HEAD → index, index → working tree)` line stats, keyed by path.
///
/// Two diffs rather than one combined `diff_tree_to_workdir_with_index`, because
/// a single number per file cannot answer both questions: the composer needs to
/// say what the COMMIT will contain (the staged side), while the unstaged rows
/// need what is not staged yet. Sharing one HEAD→worktree number made the
/// composer overstate the commit whenever a staged file had further unstaged
/// edits, and made a partially staged file show identical counts on both rows.
///
/// The staged diff never touches the filesystem, so the added cost over the old
/// single pass is small; the untracked-content scan lives entirely in the
/// unstaged half, exactly as before.
fn side_line_stats(
    repo: &Repository,
) -> AppResult<(HashMap<String, (u32, u32)>, HashMap<String, (u32, u32)>)> {
    let head_tree = match repo.head() {
        Ok(h) => Some(h.peel_to_tree()?),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
        Err(e) => return Err(e.into()),
    };

    let mut staged_opts = DiffOptions::new();
    staged_opts.include_typechange(true);
    let staged = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut staged_opts))?;

    let mut unstaged_opts = DiffOptions::new();
    unstaged_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true)
        .include_typechange(true)
        // Refresh the index's stat cache while walking, exactly as `git status`
        // does: a file whose stat data went stale (checkout, clock, touch) gets
        // re-hashed ONCE here instead of on every later status/diff. This runs
        // after every stage/unstage/discard, so the difference compounds.
        .update_index(true);
    let unstaged = repo.diff_index_to_workdir(None, Some(&mut unstaged_opts))?;

    Ok((diff_line_stats(&staged)?, diff_line_stats(&unstaged)?))
}

/// Convert a computed `git2::Diff` into per-file `FileDiff`s (path, rename
/// origin, binary flag, add/del counts, hunks). Renames must already be
/// resolved by the caller (`find_similar`). Shared by every tree-to-tree diff
/// op so hunk grouping stays identical.
fn diff_to_file_diffs(diff: &git2::Diff) -> AppResult<Vec<FileDiff>> {
    let num_deltas = diff.deltas().len();
    let mut out: Vec<FileDiff> = Vec::with_capacity(num_deltas);
    // Each delta's new-file path, kept as a Path for the callback to compare
    // against without building a String per printed line.
    let mut paths: Vec<Option<std::path::PathBuf>> = Vec::with_capacity(num_deltas);

    for delta_idx in 0..num_deltas {
        let delta = diff.get_delta(delta_idx).expect("valid delta index");
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.display().to_string())
            .unwrap_or_default();
        let old_path_opt = delta
            .old_file()
            .path()
            .map(|p| p.display().to_string())
            .filter(|p| p != &new_path);
        // `is_binary()` reads a flag libgit2 only sets once it has EXAMINED the
        // blob, and for a workdir-side delta (an untracked file, #131) that has
        // not happened yet when we read it here — the content is loaded during
        // `print` below. So seed from the flags we have and OR in what `print`
        // learns; the callback can only ever turn this true, never back.
        // Without it an untracked PNG came through as N added lines of
        // `from_utf8(...).unwrap_or("")` mojibake instead of "binary file".
        let binary = delta.new_file().is_binary() || delta.old_file().is_binary();
        paths.push(delta.new_file().path().map(|p| p.to_path_buf()));
        out.push(FileDiff {
            path: new_path,
            old_path: old_path_opt,
            binary,
            additions: 0,
            deletions: 0,
            hunks: Vec::new(),
            lfs: None,
        });
    }

    // ONE print pass for the whole diff. `git_diff_print` generates each
    // delta's patch — full blob load + xdiff — as it goes, so printing inside a
    // per-delta loop and filtering by path (the previous shape) generated every
    // file's patch once per file: O(deltas²) blob loads for a commit diff.
    // Deltas are printed in order, so the callback tracks which delta it is in
    // and appends to that entry.
    let mut idx: usize = 0;
    let mut current: Option<DiffHunk> = None;
    diff.print(DiffFormat::Patch, |d, hunk, line| {
        let d_path = d.new_file().path();
        if paths.get(idx).map(|p| p.as_deref()) != Some(d_path) {
            // A new delta begins: flush the previous one's open hunk, then
            // advance to the entry this callback belongs to (a delta that
            // printed nothing is skipped over here).
            if let Some(done) = current.take() {
                out[idx].hunks.push(done);
            }
            while idx < out.len() && paths[idx].as_deref() != d_path {
                idx += 1;
            }
            if idx >= out.len() {
                return true; // not a known delta; nothing to record it against
            }
        }
        if d.flags().contains(git2::DiffFlags::BINARY) {
            out[idx].binary = true;
            return true;
        }
        if let Some(h) = hunk {
            if current
                .as_ref()
                .map(|c| c.old_start != h.old_start() || c.new_start != h.new_start())
                .unwrap_or(true)
            {
                if let Some(done) = current.take() {
                    out[idx].hunks.push(done);
                }
                current = Some(DiffHunk {
                    header: std::str::from_utf8(h.header()).unwrap_or("").to_string(),
                    old_start: h.old_start(),
                    old_lines: h.old_lines(),
                    new_start: h.new_start(),
                    new_lines: h.new_lines(),
                    lines: Vec::new(),
                });
            }
        }
        let kind = match line.origin() {
            '+' => {
                out[idx].additions += 1;
                DiffLineKind::Addition
            }
            '-' => {
                out[idx].deletions += 1;
                DiffLineKind::Deletion
            }
            'H' | 'F' => DiffLineKind::HunkHeader,
            _ => DiffLineKind::Context,
        };
        if let Some(h) = current.as_mut() {
            h.lines.push(DiffLine {
                kind,
                old_lineno: line.old_lineno(),
                new_lineno: line.new_lineno(),
                content: std::str::from_utf8(line.content())
                    .unwrap_or("")
                    .to_string(),
            });
        }
        true
    })?;
    if idx < out.len() {
        if let Some(done) = current.take() {
            out[idx].hunks.push(done);
        }
    }

    for file_diff in &mut out {
        // Derived from the diff just built — no extra I/O (#93). Both commit-diff
        // paths come through here, so they cannot disagree with `diff()` about what
        // an LFS pointer diff is.
        crate::git::lfs::annotate(file_diff);
    }

    Ok(out)
}

/// Run `git apply [extra_args...] -` with `patch_text` piped to stdin.
fn git_apply(repo_path: &Path, extra_args: &[&str], patch_text: &str) -> AppResult<()> {
    use std::io::Write as _;
    let mut child = crate::proc::git(repo_path)
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

/// Untracked handling for `diff_ref_to_workdir`'s two passes (#131).
#[derive(Clone, Copy, PartialEq, Eq)]
enum UntrackedMode {
    /// Tracked changes only — git's own `git diff <ref>` shape.
    Off,
    /// Untracked files listed but their content not read. The counting pass.
    NamesOnly,
    /// Untracked files as all-added with content, like `diff`'s worktree kinds.
    WithContent,
}

/// Ceiling on untracked files in one `diff_ref_to_workdir` (#131). Above it the
/// untracked side is dropped whole and the count is reported, rather than
/// serialising an untracked `dist/` or `.venv/` into one IPC payload. Same order
/// as the compare screen's commit-list cap — a file list this long is not one a
/// reviewer reads either.
const MAX_UNTRACKED_FILES: usize = 200;

/// Per-blob ceiling for the same op. Larger blobs report as binary, which is
/// what libgit2 does for anything over `DiffOptions::max_size` anyway — this
/// just sets it far below the 512MB default, because a 5MB "text" file is a
/// generated artifact, not something anyone diffs in a GUI.
const MAX_WORKDIR_BLOB: i64 = 5 * 1024 * 1024;

/// Every stash entry as `(oid, reflog message)`, newest first (#133).
///
/// Takes an already-borrowed `&mut Repository` rather than a `RepoId` so it can
/// run INSIDE a `with_repo_mut` closure: `Libgit2Backend::stashes` acquires the
/// `repos` mutex itself, and std's `Mutex` is not reentrant, so calling it from
/// inside a closure that holds the lock would deadlock. That constraint is why
/// the verify-then-drop pair can be atomic at all.
fn stash_pairs(repo: &mut Repository) -> AppResult<Vec<(String, String)>> {
    let mut out = Vec::new();
    repo.stash_foreach(|_, message, oid| {
        out.push((oid.to_string(), message.to_string()));
        true
    })?;
    Ok(out)
}

/// The `(oid, message)` of the stash entry at `index`, or `StaleStash` when
/// there is nothing there any more (#133).
fn stash_entry_at(repo: &mut Repository, index: usize) -> AppResult<(String, String)> {
    let mut found = None;
    repo.stash_foreach(|i, message, oid| {
        if i == index {
            found = Some((oid.to_string(), message.to_string()));
            false
        } else {
            true
        }
    })?;
    found.ok_or_else(|| AppError::StaleStash(format!("stash@{{{index}}}")))
}

/// Resolve a revspec (branch, tag, short/full oid, `HEAD~2`, `tag^{}`, …) to
/// its tree, mapping any resolution failure to `InvalidRef` so the UI gets a
/// clean "unknown revision" error rather than a stringified internal one.
/// One side of an image preview, before it has been sniffed (#224).
///
/// `TooLarge` exists as its own arm so the ceiling is applied to the DECLARED
/// size — `metadata().len()` for the worktree, `Blob::size()` for a blob —
/// before any bytes are copied. Reading first and measuring after would defeat
/// the point of having a ceiling.
enum BlobSide {
    /// No blob at this path on this side. An added file's old side.
    Absent,
    TooLarge(u64),
    Bytes(Vec<u8>),
}

/// The worktree copy, with NO fallback to HEAD.
///
/// `read_file_content`'s fallback is right for a single-file view and wrong
/// here: a preview PAIR asks for each side by name, so recovering the HEAD blob
/// would paint the deleted image into the "new" slot and claim nothing changed.
fn read_worktree_side(abs: &Path) -> AppResult<BlobSide> {
    let meta = match std::fs::metadata(abs) {
        Ok(m) => m,
        // Absent, or unreachable through a broken symlink — a state every diff
        // surface already renders as "one side only", not a failure (#146).
        Err(_) => return Ok(BlobSide::Absent),
    };
    if !meta.is_file() {
        return Ok(BlobSide::Absent);
    }
    if meta.len() > image::MAX_PREVIEW_BYTES {
        return Ok(BlobSide::TooLarge(meta.len()));
    }
    Ok(BlobSide::Bytes(std::fs::read(abs)?))
}

/// A blob from the object database, measured before it is copied.
fn read_blob_side(repo: &Repository, oid: git2::Oid) -> AppResult<BlobSide> {
    let Ok(blob) = repo.find_blob(oid) else {
        return Ok(BlobSide::Absent);
    };
    if blob.size() as u64 > image::MAX_PREVIEW_BYTES {
        return Ok(BlobSide::TooLarge(blob.size() as u64));
    }
    Ok(BlobSide::Bytes(blob.content().to_vec()))
}

/// Sniff bytes we already hold and turn them into the answer.
fn describe_bytes(path: String, bytes: &[u8]) -> ImagePreview {
    let size = bytes.len() as u64;
    match image::sniff(bytes) {
        image::Sniffed::Image(media_type) => ImagePreview::Image {
            path,
            media_type: media_type.to_string(),
            size,
            // Base64 HERE rather than in the frontend: it is what a `data:` URL
            // takes, so the string crosses IPC once and is concatenated into an
            // `src` with no decode and no second copy on the other side.
            data: BASE64.encode(bytes),
        },
        image::Sniffed::Svg => ImagePreview::Unsupported {
            path,
            size,
            reason: UnsupportedReason::Svg,
        },
        image::Sniffed::NotAnImage => ImagePreview::Unsupported {
            path,
            size,
            reason: UnsupportedReason::NotAnImage,
        },
    }
}

/// Preview the OBJECT an LFS pointer names, when it is present locally (#224).
///
/// Reads `.git/lfs/objects/aa/bb/<oid>` directly instead of asking the `git lfs`
/// binary: the answer we want is "is this object on this disk", and shelling out
/// would refuse a perfectly readable object on a machine where git-lfs is not
/// installed. It also keeps this reader off `proc.rs` entirely, so a preview
/// never spawns anything.
///
/// `lfs.storage` is honoured because git-lfs honours it; a relative value is
/// relative to the `.git` directory, as git-lfs resolves it.
fn resolve_lfs_object(
    repo: &Repository,
    path: String,
    pointer: &crate::git::types::LfsPointer,
) -> AppResult<ImagePreview> {
    let git_dir = repo.path().to_path_buf();
    let storage = repo
        .config()
        .ok()
        .and_then(|c| c.get_path("lfs.storage").ok())
        .map(|p| if p.is_absolute() { p } else { git_dir.join(p) })
        .unwrap_or_else(|| git_dir.join("lfs"));

    let missing = || ImagePreview::LfsMissing {
        path: path.clone(),
        oid: pointer.oid.clone(),
        size: pointer.size,
    };
    // `lfs_object_path` refuses an oid that is not plain lowercase hex — it came
    // from a pointer file in an untrusted repository.
    let Some(object) = image::lfs_object_path(&storage, &pointer.oid) else {
        return Ok(missing());
    };
    match read_worktree_side(&object)? {
        BlobSide::Absent => Ok(missing()),
        BlobSide::TooLarge(size) => Ok(ImagePreview::TooLarge {
            path,
            size,
            limit: image::MAX_PREVIEW_BYTES,
        }),
        BlobSide::Bytes(bytes) => Ok(describe_bytes(path, &bytes)),
    }
}

fn resolve_tree<'a>(repo: &'a Repository, revspec: &str) -> AppResult<git2::Tree<'a>> {
    repo.revparse_single(revspec)
        .and_then(|obj| obj.peel_to_tree())
        .map_err(|_| AppError::InvalidRef(revspec.to_string()))
}

/// Resolve a revspec to its commit, mapping failure to `InvalidRef`.
fn resolve_commit<'a>(repo: &'a Repository, revspec: &str) -> AppResult<git2::Commit<'a>> {
    repo.revparse_single(revspec)
        .and_then(|obj| obj.peel_to_commit())
        .map_err(|_| AppError::InvalidRef(revspec.to_string()))
}

/// Push the log walk's start commit onto `walk`. `None` starts at HEAD and
/// returns `Ok(false)` ONLY when HEAD is unborn (a fresh repo with no commits;
/// caller returns an empty log). A missing/corrupt HEAD surfaces as an error
/// instead — masking it as an empty log hides a broken repo. `Some(spec)`
/// starts at any revspec (branch, tag, short/full oid) peeled to a commit —
/// `InvalidRef` when it can't be resolved.
///
/// Returns the oids actually pushed; empty means "nothing to walk". The caller
/// needs the oids, not just a flag: a pushed start point that the page's limit
/// stops short of has to survive into the next cursor.
fn push_log_start(
    repo: &Repository,
    walk: &mut git2::Revwalk,
    refspec: Option<&str>,
) -> AppResult<Vec<git2::Oid>> {
    match refspec {
        None => match repo.head() {
            Ok(h) => {
                let oid = h.peel_to_commit()?.id();
                walk.push(oid)?;
                Ok(vec![oid])
            }
            // Fresh repo, HEAD points at a branch with no commits yet → nothing
            // to walk. This is the only "empty log, not an error" case.
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(Vec::new()),
            // NotFound (or anything else) means HEAD itself is missing/corrupt,
            // not an unborn branch — surface it rather than reporting an empty
            // history for a broken repo.
            Err(e) => Err(e.into()),
        },
        // "All branches we know of" — local heads, remote-tracking heads, and
        // HEAD itself (a detached HEAD is under no branch, and dropping it
        // would hide the commits the user is actually sitting on). Tags are
        // deliberately out: this scope is about branches.
        Some(spec) if spec == REFSPEC_ALL => {
            let mut starts = Vec::new();
            let mut push = |oid: git2::Oid, walk: &mut git2::Revwalk| -> AppResult<()> {
                if starts.contains(&oid) {
                    return Ok(());
                }
                walk.push(oid)?;
                starts.push(oid);
                Ok(())
            };
            if let Ok(head) = repo.head() {
                if let Ok(commit) = head.peel_to_commit() {
                    push(commit.id(), walk)?;
                }
            }
            for glob in ["refs/heads/*", "refs/remotes/*/*"] {
                if let Ok(refs) = repo.references_glob(glob) {
                    for r in refs.flatten() {
                        // A head's or remote head's target IS the commit oid —
                        // no peel (an object read per ref, per page) needed.
                        if let Some(oid) = r.target() {
                            push(oid, walk)?;
                        } else if let Ok(commit) = r.peel_to_commit() {
                            // A remote's symbolic HEAD (refs/remotes/origin/HEAD)
                            // peels to a tip already pushed — dedup handles it.
                            push(commit.id(), walk)?;
                        }
                    }
                }
            }
            Ok(starts)
        }
        Some(spec) => {
            let commit = resolve_commit(repo, spec)?;
            walk.push(commit.id())?;
            Ok(vec![commit.id()])
        }
    }
}

/// Accumulates the walk frontier while a page is emitted (#68 G11).
///
/// The frontier is the set of parents seen but not themselves walked — the
/// points the next page resumes from. It must be a SET: at a page boundary
/// several lanes are alive, each awaiting a different parent, so resuming from
/// only the last emitted commit would silently drop every other branch.
///
/// Built incrementally rather than from the finished page, because the
/// filtered walk visits far more commits than it returns and must not retain a
/// `CommitInfo` for each one.
struct FrontierBuilder {
    /// Every oid the walk yielded — matches AND skipped commits.
    visited: std::collections::HashSet<git2::Oid>,
    cand_seen: std::collections::HashSet<git2::Oid>,
    /// First-seen order, so the continuation is pushed newest-lane-first.
    candidates: Vec<git2::Oid>,
}

impl FrontierBuilder {
    fn new(cap: usize) -> Self {
        Self {
            visited: std::collections::HashSet::with_capacity(cap),
            cand_seen: std::collections::HashSet::new(),
            candidates: Vec::new(),
        }
    }

    /// Register the walk's own start points as live lanes.
    ///
    /// A page can stop before reaching every pushed start point — resume from a
    /// two-lane cursor `[A, B]` with a page size of one and only `A` is walked.
    /// `B` is then in neither `visited` nor `candidates` (it is nobody's parent
    /// here), so without this it would be dropped from the next cursor and every
    /// commit reachable only through its lane would vanish from the log.
    fn seed(&mut self, starts: &[git2::Oid]) {
        for &oid in starts {
            if self.cand_seen.insert(oid) {
                self.candidates.push(oid);
            }
        }
    }

    fn visit(&mut self, oid: git2::Oid, parents: impl Iterator<Item = git2::Oid>) {
        self.visited.insert(oid);
        for p in parents {
            if self.cand_seen.insert(p) {
                self.candidates.push(p);
            }
        }
    }

    /// `None` ⟺ end of history: any parent we saw but did not walk IS more
    /// history, so an empty frontier means there is nothing left.
    fn finish(self, repo: &Repository) -> Option<Vec<String>> {
        let mut out = Vec::new();
        for p in self.candidates {
            if self.visited.contains(&p) {
                continue;
            }
            // Absent in a shallow/grafted clone → not a resumable point.
            // odb.exists is an index probe; find_commit parsed the object.
            let exists = repo
                .odb()
                .map(|odb| odb.exists(p))
                .unwrap_or_else(|_| repo.find_commit(p).is_ok());
            if exists {
                out.push(p.to_string());
            }
        }
        if out.is_empty() {
            None
        } else {
            Some(out)
        }
    }
}

/// Seed a revwalk for a page: from the cursor frontier when resuming,
/// otherwise from `refspec`/HEAD. An empty result means "nothing to walk".
///
/// When a cursor is supplied `refspec` is deliberately ignored — the frontier
/// already encodes which walk this continues.
fn push_page_start(
    repo: &Repository,
    walk: &mut git2::Revwalk,
    refspec: Option<&str>,
    cursor: Option<&[String]>,
) -> AppResult<Vec<git2::Oid>> {
    match cursor {
        Some(frontier) if !frontier.is_empty() => {
            let mut pushed = Vec::with_capacity(frontier.len());
            for raw in frontier {
                let oid =
                    git2::Oid::from_str(raw).map_err(|_| AppError::InvalidRef(raw.clone()))?;
                // A frontier oid can be missing in a shallow clone; skip it
                // rather than failing the whole page.
                if repo.find_commit(oid).is_ok() {
                    walk.push(oid)?;
                    pushed.push(oid);
                }
            }
            Ok(pushed)
        }
        _ => push_log_start(repo, walk, refspec),
    }
}

/// Map git2's per-ref lookup by target OID. Scans once per log call.
fn collect_ref_map(repo: &Repository) -> HashMap<git2::Oid, Vec<String>> {
    // A map, not a list: every log walk decorates each of its rows from this,
    // and a linear scan per row was O(refs x rows) with a clone per hit.
    let mut out: HashMap<git2::Oid, Vec<String>> = HashMap::new();
    if let Ok(refs) = repo.references() {
        for r in refs.flatten() {
            let name = match r.shorthand() {
                Some(n) => n.to_string(),
                None => continue,
            };
            // Peel annotated tags to the commit they point at. Only TAGS: a
            // branch or remote ref's target already IS the commit oid, and
            // peeling costs an object read per ref — thousands, on a repo with
            // many remote branches, on every page fetch.
            if r.is_tag() {
                if let Ok(peeled) = r.peel(git2::ObjectType::Commit) {
                    if let Some(c) = peeled.as_commit() {
                        out.entry(c.id()).or_default().push(name);
                        continue;
                    }
                }
            }
            if let Some(oid) = r.target() {
                out.entry(oid).or_default().push(name);
            } else if let Ok(peeled) = r.peel(git2::ObjectType::Commit) {
                // Symbolic refs (origin/HEAD) have no direct target; resolve
                // them the way the old always-peel did so their pill survives.
                if let Some(c) = peeled.as_commit() {
                    out.entry(c.id()).or_default().push(name);
                }
            }
        }
    }
    out
}

fn parse_reflog_op(raw_message: &str) -> (ReflogOp, String) {
    // Reflog messages look like "commit: fix bar", "checkout: moving from X to Y",
    // "reset: moving to HEAD~1", "pull: Fast-forward", etc. If there's no ':' at all
    // we treat the whole string as Other with an empty trailing message.
    let Some((prefix, rest)) = raw_message.split_once(':') else {
        return (ReflogOp::Other(raw_message.trim().to_string()), String::new());
    };
    let prefix = prefix.trim();
    let rest = rest.trim().to_string();
    let op = match prefix {
        "commit" => ReflogOp::Commit,
        "commit (amend)" => ReflogOp::Amend,
        "reset" => ReflogOp::Reset,
        "checkout" => ReflogOp::Checkout,
        "merge" => ReflogOp::Merge,
        "rebase" | "rebase -i" | "rebase (start)" | "rebase (finish)"
        | "rebase (pick)" | "rebase (continue)" => ReflogOp::Rebase,
        "pull" => ReflogOp::Pull,
        "clone" => ReflogOp::Clone,
        other => ReflogOp::Other(other.to_string()),
    };
    (op, rest)
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

/// Best-effort removal of a failed `init`'s `.git`, whatever shape it turned
/// out to be. `std::fs::remove_dir_all` alone isn't enough: it only works when
/// `.git` is a directory. It silently does nothing useful against a plain
/// file — which is exactly what's there when `Repository::init_opts` fails
/// because the target already contains a corrupt/malformed `.git` (not a
/// directory, not a valid gitdir link — `Repository::open` already rejected
/// it as unusable, or `init` would have refused at the top guard instead of
/// getting this far). Checked with `symlink_metadata` so a `.git` that is
/// itself a symlink is removed as the link, not followed into whatever it
/// points at.
fn remove_failed_init_git_dir(path: &Path) {
    let git_path = path.join(".git");
    match std::fs::symlink_metadata(&git_path) {
        Ok(meta) if meta.is_dir() => {
            let _ = std::fs::remove_dir_all(&git_path);
        }
        Ok(_) => {
            // File or symlink.
            let _ = std::fs::remove_file(&git_path);
        }
        Err(_) => {
            // Nothing there to clean up.
        }
    }
}

/// The branch name a fresh repository should start on: the user's
/// `init.defaultBranch` if they set one, otherwise `main`.
///
/// Reads the default config chain (global + system) rather than a repository's
/// config — there is no repository yet when this is called.
pub fn default_branch_name() -> String {
    git2::Config::open_default()
        .ok()
        .and_then(|cfg| cfg.get_string("init.defaultBranch").ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "main".to_string())
}

/// Local branch names tried, in order, when no remote tells us what the
/// default is.
const DEFAULT_BRANCH_CANDIDATES: [&str; 3] = ["main", "master", "trunk"];

/// The default branch of an OPEN repository, as a short branch name (`main`),
/// or `None` when nothing answers.
///
/// Priority, per the #135 spec:
///
/// 1. `refs/remotes/<remote>/HEAD`'s symbolic target — git's own answer, set by
///    `git clone` and `git remote set-head`. `origin` is tried first, then the
///    remaining remotes alphabetically, so a repo with several answers
///    deterministically. A non-symbolic `…/HEAD` names no branch and is skipped.
/// 2. The first of `main`, `master`, `trunk` that exists as a local branch.
/// 3. Nothing.
///
/// Deliberately NOT `init.defaultBranch` (see `default_branch_name` above):
/// that describes branches which do not exist yet and would name `main` in a
/// repository whose default is `master`.
///
/// A remote's `HEAD` is only ACCEPTED when the ref it names still exists.
/// `git fetch --prune` does not rewrite the symref, so a repository cloned when
/// the default was `master` keeps pointing at `refs/remotes/origin/master`
/// forever after upstream renames it — and taking that name on trust would
/// suppress case 2 as well, leaving a perfectly good local `main` unpinned with
/// nothing to explain why.
pub fn detect_default_branch(repo: &Repository) -> Option<String> {
    let mut remotes: Vec<String> = match repo.remotes() {
        Ok(list) => list.iter().flatten().map(String::from).collect(),
        Err(_) => Vec::new(),
    };
    // `false` sorts before `true`, so `origin` leads and the rest follow
    // alphabetically.
    remotes.sort_by(|a, b| (a != "origin", a).cmp(&(b != "origin", b)));

    for remote in &remotes {
        let prefix = format!("refs/remotes/{remote}/");
        let head_ref = format!("{prefix}HEAD");
        let Ok(reference) = repo.find_reference(&head_ref) else {
            continue;
        };
        let Some(target) = reference.symbolic_target() else {
            continue;
        };
        if let Some(name) = target.strip_prefix(&prefix) {
            // A dangling symref answers nothing. Fall through to the next
            // remote and then to the local candidates.
            if !name.is_empty() && name != "HEAD" && repo.find_reference(target).is_ok() {
                return Some(name.to_string());
            }
        }
    }

    DEFAULT_BRANCH_CANDIDATES
        .iter()
        .find(|name| repo.find_branch(name, BranchType::Local).is_ok())
        .map(|name| (*name).to_string())
}

/// Does this branch row carry the repository's default branch?
///
/// A local branch matches by name. A remote branch matches on the part after
/// the FIRST `/`: git forbids `/` in a remote name but allows it in a branch
/// name, so `origin/feature/x` splits as `origin` + `feature/x`. With two
/// remotes both `origin/main` and `upstream/main` match — they are both "the
/// default branch, on a remote", and they sit adjacent at the top of the same
/// section.
fn is_default_branch_name(name: &str, is_remote: bool, default: Option<&str>) -> bool {
    let Some(default) = default else {
        return false;
    };
    if is_remote {
        name.split_once('/').map(|(_, rest)| rest) == Some(default)
    } else {
        name == default
    }
}

// ─── Fast-forwarding a branch that is not checked out (#246) ─────────────────
//
// Every function here takes an ALREADY-BORROWED `&Repository`, exactly like the
// `stash_pairs`/`stash_entry_at` pair above and for the same reason: the
// ancestry check and the ref move have to happen under ONE acquisition of the
// per-repo mutex, and std's `Mutex` is not reentrant, so a helper that took a
// `&RepoId` and re-entered `with_repo` would deadlock — or, if it took the lock
// separately, would be the stash TOCTOU with a different ref.

/// What advancing one branch to its upstream would do.
enum FastForwardKind {
    /// The ref already points at the upstream tip, or past it. Nothing to do —
    /// a state, not a failure, and what `git pull --ff-only` calls "Already up
    /// to date" in both cases.
    UpToDate,
    /// The local tip is an ancestor of the upstream tip: move the ref here.
    Advance(git2::Oid),
    /// Both sides have commits the other lacks — or the histories are unrelated,
    /// which is divergence in every sense that matters to a ref move.
    Diverged,
}

/// The graph question and the reference to act on, from ONE ref lookup.
///
/// Holding the `Reference` rather than re-finding the branch to move it is what
/// keeps "check" and "mutate" reading the same object; the lock makes that
/// atomic against other commands, and one lookup makes it atomic against a
/// `git` CLI writing the ref from outside in the same instant.
struct FastForwardPlan<'r> {
    /// Upstream shorthand, e.g. `origin/main`.
    upstream: String,
    from: git2::Oid,
    kind: FastForwardKind,
    reference: git2::Reference<'r>,
}

fn plan_fast_forward<'r>(repo: &'r Repository, branch: &str) -> AppResult<FastForwardPlan<'r>> {
    let local = repo
        .find_branch(branch, BranchType::Local)
        .map_err(|_| AppError::InvalidRef(branch.to_string()))?;
    let no_upstream =
        || AppError::NoUpstream(format!("{branch} tracks no remote branch — set an upstream first"));
    let upstream = local.upstream().map_err(|_| no_upstream())?;
    let up_name = upstream
        .name()
        .ok()
        .flatten()
        .map(String::from)
        .ok_or_else(no_upstream)?;
    let up_oid = upstream
        .get()
        .target()
        .ok_or_else(|| AppError::InvalidRef(up_name.clone()))?;

    let reference = local.into_reference();
    // A symbolic or unborn branch ref has no oid to compare, so there is no
    // ancestry question to answer.
    let from = reference.target().ok_or(AppError::Unborn)?;

    let kind = if from == up_oid {
        FastForwardKind::UpToDate
    } else {
        match repo.merge_base(from, up_oid) {
            Ok(base) if base == from => FastForwardKind::Advance(up_oid),
            // Strictly ahead: there is nothing to fast-forward TO.
            Ok(base) if base == up_oid => FastForwardKind::UpToDate,
            _ => FastForwardKind::Diverged,
        }
    };

    Ok(FastForwardPlan {
        upstream: up_name,
        from,
        kind,
        reference,
    })
}

/// Carry out a plan. `Diverged` is refused HERE, so no caller can move a ref by
/// forgetting to look at the kind.
fn apply_fast_forward(branch: &str, mut plan: FastForwardPlan<'_>) -> AppResult<FastForward> {
    let done = |to: git2::Oid, moved: bool| FastForward {
        branch: branch.to_string(),
        upstream: plan.upstream.clone(),
        from: plan.from.to_string(),
        to: to.to_string(),
        moved,
    };
    match plan.kind {
        FastForwardKind::UpToDate => Ok(done(plan.from, false)),
        FastForwardKind::Diverged => Err(AppError::NotFastForward(format!(
            "{branch} has diverged from {} — check it out to merge or rebase",
            plan.upstream
        ))),
        FastForwardKind::Advance(to) => {
            // The reflog message is the undo: a ref that moved without one
            // is a ref the user cannot walk back. It names the upstream, the way
            // git's own ff messages do ("merge origin/main: Fast-forward"), so
            // `git reflog main` reads as a history rather than a mystery.
            let msg = format!("fast-forward: moved to {}", plan.upstream);
            plan.reference.set_target(to, &msg)?;
            Ok(done(to, true))
        }
    }
}

/// Where `branch` is checked out, if anywhere — this repository's HEAD or a
/// linked worktree's.
///
/// `head` is `repo.head()`'s shorthand, passed in so a bulk sweep reads it once;
/// `linked` is `worktree::linked_worktree_heads`, for the same reason.
fn checked_out_at(branch: &str, head: Option<&str>, linked: &[(String, String)]) -> Option<String> {
    if head == Some(branch) {
        return Some("this worktree".to_string());
    }
    linked
        .iter()
        .find(|(_, on)| on == branch)
        .map(|(wt, _)| format!("worktree {wt}"))
}

/// The refusal a checked-out branch gets: moving its ref without touching the
/// index or the working tree would leave that checkout showing every incoming
/// change as a deletion. The caller pulls instead, with the user's pull mode.
fn reject_checked_out(repo: &Repository, branch: &str) -> AppResult<()> {
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));
    let linked = crate::git::worktree::linked_worktree_heads(repo);
    match checked_out_at(branch, head.as_deref(), &linked) {
        None => Ok(()),
        Some(where_) => Err(AppError::InvalidArgument(format!(
            "{branch} is checked out in {where_} — pull it there instead of moving its ref"
        ))),
    }
}

/// Local branch names, in listing order.
fn local_branch_names(repo: &Repository) -> AppResult<Vec<String>> {
    let mut names = Vec::new();
    for entry in repo.branches(Some(BranchType::Local))? {
        let (branch, _) = entry?;
        if let Ok(Some(name)) = branch.name() {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

impl GitBackend for Libgit2Backend {
    fn open(&self, path: &Path) -> AppResult<RepoHandle> {
        if !path.exists() {
            return Err(AppError::InvalidPath(path.display().to_string()));
        }
        let repo = Repository::open(path).map_err(|e| ownership::map_open_error(path, &e))?;

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
        // `workdir()` hands back a path WITH a trailing separator. That makes
        // `/repo` and `/repo/` two different strings for anything that keys on
        // the handle's path — repository tabs (#90) dedupe by it, recents store
        // it — so the same repository could open twice under two spellings.
        // Normalize through the SHARED `repo_path_key`, not a local copy: a
        // `pgit <path>` launch reads the same `workdir()` in
        // `cli::resolve_repo_root`, and the two spellings must agree or the
        // frontend opens the repository a second time (#177).
        let workdir = repo
            .workdir()
            .map(super::repo_path_key)
            .unwrap_or_else(|| path.to_path_buf());

        let mut map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        map.insert(id.clone(), Arc::new(Mutex::new(repo)));

        Ok(RepoHandle {
            id,
            path: workdir,
            head,
        })
    }

    fn trust_path(&self, path: &Path) -> AppResult<()> {
        ownership::trust_path(path)
    }

    fn close(&self, repo_id: &RepoId) -> AppResult<()> {
        let mut map = self
            .repos
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        // Dropping the removed Arc<Mutex<Repository>> here releases libgit2's
        // file handles once any in-flight op's clone finishes. An absent id is
        // success on purpose (see the trait doc).
        map.remove(repo_id);
        // `rebases` is deliberately left alone: its entries are bytes, not
        // handles, they are keyed by an id a re-open can never mint again, and
        // an in-progress rebase rehydrates from `.git/platypusgit-rebase.json`
        // — the same path a restarted app takes.
        Ok(())
    }

    fn init(&self, path: &Path, initial_branch: Option<&str>) -> AppResult<RepoHandle> {
        // Serialize the guard → write → cleanup window to prevent two concurrent
        // calls on the same path from interfering. Without this, the pre-init
        // guard and post-write cleanup are not atomic across both calls, so call
        // A's cleanup could delete `.git` that call B created.
        let _guard = self
            .init_lock
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // The frontend builds `path` by joining a user-typed folder name onto
        // a directory picked via a native dialog, with no validation of that
        // name. `Path`'s components never collapse `..`, so a name of ".."
        // makes `path` resolve to the grandparent of the directory the user
        // actually picked. `validate_clone_target` (`commands/create.rs`)
        // already guards clone's equivalent field against exactly this shape;
        // check the same thing here for the same reason, in the backend
        // rather than the store, so it holds for any caller, not just today's
        // one.
        let last_segment_is_clean = match path.components().last() {
            Some(Component::Normal(seg)) => {
                !seg.to_string_lossy().chars().any(|c| c.is_control())
            }
            _ => false,
        };
        if !last_segment_is_clean {
            return Err(AppError::InvalidPath(format!(
                "{} is not a valid repository path",
                path.display()
            )));
        }

        // `Repository::init` on an existing repo silently reopens it. That
        // reads as success while creating nothing, so refuse up front.
        match ownership::repo_presence(path) {
            ownership::RepoPresence::Present => {
                return Err(AppError::InvalidPath(format!(
                    "{} is already a git repository",
                    path.display()
                )));
            }
            // Being unable to open it is not permission to initialise over the
            // top of it — the old `is_ok()` test read this as "no repo yet".
            // Say what is actually wrong so the user can trust it and retry.
            ownership::RepoPresence::Refused => {
                return Err(AppError::DubiousOwnership(ownership::canonical_string(path)));
            }
            ownership::RepoPresence::Absent => {}
        }
        // A file (not a directory) at `path` would otherwise surface as a
        // confusing "File exists (os error 17)" out of `create_dir_all` below.
        if path.exists() && !path.is_dir() {
            return Err(AppError::InvalidPath(format!(
                "{} exists and is not a directory",
                path.display()
            )));
        }
        // A `.git` here is neither a valid, open-able repo (the guard above
        // would have caught that) nor ours to delete or overwrite. It might
        // be corrupt-but-precious data the user cares about recovering, not
        // wreckage from a previous failed `init` — we can't tell those apart,
        // so don't guess: refuse and let the user remove it themselves.
        // `symlink_metadata` (not `exists()`) so a `.git` that is itself a
        // symlink counts as present without following it. Checking this before
        // any write makes the cleanup below safe: if we get past this point,
        // `.git` did not exist a moment ago, so anything `init_opts`/`open`
        // leave behind on failure is ours to clean up, and the `init_lock`
        // serializes concurrent calls so they don't interfere.
        if std::fs::symlink_metadata(path.join(".git")).is_ok() {
            return Err(AppError::InvalidPath(format!(
                "{} already contains a .git that is not a usable repository — remove it before creating a new repository here",
                path.display()
            )));
        }

        let branch = match initial_branch {
            Some(b) if !b.trim().is_empty() => b.trim().to_string(),
            _ => default_branch_name(),
        };
        // Validate BEFORE any disk I/O. `RepositoryInitOptions::initial_head`
        // writes whatever string we hand it straight into HEAD with no
        // validation of its own, and `Repository::init_opts` happily writes
        // the rest of a fully-formed `.git` tree around that bad ref and
        // returns Ok — the failure only surfaces later, inside `self.open`,
        // when it resolves `repo.head()`. By then a half-built `.git` is
        // already on disk, and the "already a git repository" guard above
        // would treat that wreckage as a real repo on every future call,
        // recoverable only by deleting `.git` outside the app. Catching an
        // illegal name here, before `create_dir_all` even runs, means that
        // specific failure mode can never leave anything behind.
        let ref_name = format!("refs/heads/{branch}");
        if !git2::Reference::is_valid_name(&ref_name) {
            return Err(AppError::InvalidPath(format!(
                "'{branch}' is not a valid branch name"
            )));
        }

        std::fs::create_dir_all(path)
            .map_err(|e| AppError::Io(format!("failed to create {}: {e}", path.display())))?;

        let mut opts = git2::RepositoryInitOptions::new();
        opts.initial_head(&branch).mkdir(false);

        // Belt-and-suspenders beyond the branch-name check above: ANY failure
        // from here on (disk error mid-write, a failure inside `self.open`,
        // ...) must not leave `.git` behind either — that would poison `path`
        // the same way, permanently, since the guard at the top can't
        // distinguish "real repo" from "wreckage that merely opens". The guard
        // proved `.git` did not exist moments ago, so anything left behind on
        // failure is wreckage from this call. The `init_lock` serializes
        // concurrent calls so the guard → write → cleanup window is atomic
        // across the entire operation.
        let result = Repository::init_opts(path, &opts)
            // `git_repository_init_ext` opens what it just created, so it can
            // refuse on ownership grounds too — report that as the actionable
            // variant rather than a raw git string. Only that arm: an init
            // failing with NotFound has not learned the path "is not a git
            // repository".
            .map_err(|e| ownership::map_ownership_error(path, e))
            // Go through `open` so the repo lands in the backend's map with a
            // real RepoId — a handle that isn't registered 404s on the next call.
            .and_then(|_| self.open(path));
        if result.is_err() {
            remove_failed_init_git_dir(path);
        }
        result
    }

    fn status(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        self.with_repo(repo_id, |repo| {
            // Per-file line stats for each side separately, so the staged and
            // unstaged rows can report their own numbers. Degrades to empty
            // (→ 0/0 counts) rather than failing status.
            let (staged_stats, unstaged_stats) = side_line_stats(repo).unwrap_or_default();
            let mut opts = StatusOptions::new();
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false)
                // Same-result, cheaper next time: refresh the stat cache the
                // way `git status` itself does (see side_line_stats).
                .update_index(true);
            let statuses = repo.statuses(Some(&mut opts))?;
            // Read once for the whole listing, not per entry: it only feeds the
            // gitlink-mode shortcut in `listed_entry_is_embedded_repo`, so a repo
            // whose index will not open just falls back to the slash check.
            let index = repo.index().ok();
            // Also once for the whole listing, and free when there is no
            // `.gitmodules` — which is why this can sit on the hottest path in the
            // app (see `declared_submodule_paths`).
            let submodule_paths = crate::git::submodule::declared_submodule_paths(repo);
            let mut out = Vec::with_capacity(statuses.len());
            for entry in statuses.iter() {
                let path = entry.path().unwrap_or("").to_string();
                let s = entry.status();
                let (staged_additions, staged_deletions) =
                    staged_stats.get(&path).copied().unwrap_or((0, 0));
                let (unstaged_additions, unstaged_deletions) =
                    unstaged_stats.get(&path).copied().unwrap_or((0, 0));
                let embedded = listed_entry_is_embedded_repo(repo, index.as_ref(), &path);
                let submodule = is_listed_submodule(&submodule_paths, &path);
                out.push(FileStatus {
                    path,
                    worktree: map_status_flag(s, StatusSide::Worktree),
                    index: map_status_flag(s, StatusSide::Index),
                    // Both sides together, for callers that want one number per
                    // file rather than a per-side breakdown.
                    additions: staged_additions + unstaged_additions,
                    deletions: staged_deletions + unstaged_deletions,
                    staged_additions,
                    staged_deletions,
                    unstaged_additions,
                    unstaged_deletions,
                    embedded,
                    submodule,
                });
            }
            Ok(out)
        })
    }

    fn list_all_files(&self, repo_id: &RepoId) -> AppResult<Vec<FileStatus>> {
        self.with_repo(repo_id, |repo| {
            let mut opts = StatusOptions::new();
            opts.include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_unmodified(true)
                .include_ignored(false);
            let statuses = repo.statuses(Some(&mut opts))?;
            // Once for the whole listing — see `status()`. This one matters most:
            // `include_unmodified` means every file in the worktree comes through
            // here, so a per-entry stat would be a syscall per file.
            let index = repo.index().ok();
            let submodule_paths = crate::git::submodule::declared_submodule_paths(repo);
            let mut out = Vec::with_capacity(statuses.len());
            for entry in statuses.iter() {
                let path = entry.path().unwrap_or("").to_string();
                if path.is_empty() {
                    continue;
                }
                let s = entry.status();
                let embedded = listed_entry_is_embedded_repo(repo, index.as_ref(), &path);
                let submodule = is_listed_submodule(&submodule_paths, &path);
                out.push(FileStatus {
                    path,
                    worktree: map_status_flag(s, StatusSide::Worktree),
                    index: map_status_flag(s, StatusSide::Index),
                    // Full-file listing (incl. unmodified) doesn't compute per-file
                    // line stats — the tree shows status marks, not counts.
                    additions: 0,
                    deletions: 0,
                    staged_additions: 0,
                    staged_deletions: 0,
                    unstaged_additions: 0,
                    unstaged_deletions: 0,
                    embedded,
                    submodule,
                });
            }
            Ok(out)
        })
    }

    fn log(
        &self,
        repo_id: &RepoId,
        refspec: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        // One walk implementation: the legacy contract is page one (#68 G11).
        Ok(self.log_page(repo_id, refspec, None, limit)?.commits)
    }

    fn log_page(
        &self,
        repo_id: &RepoId,
        refspec: Option<&str>,
        cursor: Option<&[String]>,
        limit: usize,
    ) -> AppResult<LogPage> {
        self.with_repo(repo_id, |repo| {
            let ref_map = collect_ref_map(repo);
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
            let starts = push_page_start(repo, &mut walk, refspec, cursor)?;
            if starts.is_empty() {
                return Ok(LogPage {
                    commits: Vec::new(),
                    next_cursor: None,
                });
            }

            let mut out = Vec::with_capacity(limit.min(4096));
            let mut frontier = FrontierBuilder::new(limit.min(4096));
            frontier.seed(&starts);
            for oid in walk.by_ref().take(limit) {
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                let refs: Vec<String> = ref_map.get(&oid).cloned().unwrap_or_default();
                let mut info = commit_to_info(&commit);
                info.refs = refs;
                frontier.visit(oid, commit.parent_ids());
                out.push(info);
            }

            Ok(LogPage {
                next_cursor: frontier.finish(repo),
                commits: out,
            })
        })
    }

    fn log_filtered(
        &self,
        repo_id: &RepoId,
        filter: &LogFilter,
        refspec: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        // One walk implementation: the legacy contract is page one (#68 G11).
        Ok(self
            .log_filtered_page(repo_id, filter, refspec, None, limit)?
            .commits)
    }

    fn log_filtered_page(
        &self,
        repo_id: &RepoId,
        filter: &LogFilter,
        refspec: Option<&str>,
        cursor: Option<&[String]>,
        limit: usize,
    ) -> AppResult<LogPage> {
        // No filter set → identical to a plain log walk.
        if filter.is_empty() {
            return self.log_page(repo_id, refspec, cursor, limit);
        }

        // Normalize filter terms once.
        let message_q = filter
            .message
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase);
        let author_q = filter
            .author
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase);
        let sha_q = filter
            .sha_prefix
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_lowercase);
        let path_q = filter
            .path
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(std::path::PathBuf::from);

        // Compiled once, before any walking: a malformed pattern must fail
        // immediately, not per commit.
        let content_m = match filter
            .content
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => None,
            Some(pat) if filter.content_regex => Some(ContentMatcher::Regex(
                regex::Regex::new(pat)
                    .map_err(|e| AppError::InvalidArgument(format!("invalid regex: {e}")))?,
            )),
            Some(pat) => Some(ContentMatcher::Literal(pat.to_string())),
        };

        self.with_repo(repo_id, |repo| {
            let ref_map = collect_ref_map(repo);
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
            let starts = push_page_start(repo, &mut walk, refspec, cursor)?;
            if starts.is_empty() {
                return Ok(LogPage {
                    commits: Vec::new(),
                    next_cursor: None,
                });
            }

            let mut out = Vec::new();
            // The frontier tracks every VISITED commit, not just the matches:
            // resuming from a match's parents would skip the non-matching
            // commits between them and lose their ancestors entirely.
            let mut frontier = FrontierBuilder::new(limit.min(4096));
            frontier.seed(&starts);
            // Pull from the walk ONLY while there is room for another match.
            // `for oid in walk { if out.len() >= limit { break } … }` yields an oid
            // first and discards it on the break, without recording it in the
            // frontier — and a cursor start-point lost that way is in neither
            // `visited` nor `candidates`, so `finish` omits it and every commit
            // reachable only through that lane disappears from the log for good.
            // `log_page` sidesteps this with `walk.by_ref().take(limit)`; the
            // filtered walk cannot, because it decides per commit whether one
            // counts towards the limit.
            let mut walk = walk;
            while out.len() < limit {
                let Some(oid) = walk.next() else { break };
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                frontier.visit(oid, commit.parent_ids());

                // sha prefix — cheap, check first. Compared nibble-by-nibble
                // off the raw bytes: `oid.to_string()` allocated 40 hex chars
                // for EVERY commit the walk visits, matching or not.
                if let Some(ref q) = sha_q {
                    if !oid_has_hex_prefix(&oid, q) {
                        continue;
                    }
                }

                // date range.
                let ts = commit.time().seconds();
                if let Some(since) = filter.since {
                    if ts < since {
                        continue;
                    }
                }
                if let Some(until) = filter.until {
                    if ts > until {
                        continue;
                    }
                }

                // author name or email.
                if let Some(ref q) = author_q {
                    let author = commit.author();
                    let name = author.name().unwrap_or("").to_lowercase();
                    let email = author.email().unwrap_or("").to_lowercase();
                    if !name.contains(q.as_str()) && !email.contains(q.as_str()) {
                        continue;
                    }
                }

                // message (full message: summary + body).
                if let Some(ref q) = message_q {
                    let msg = commit.message().unwrap_or("").to_lowercase();
                    if !msg.contains(q.as_str()) {
                        continue;
                    }
                }

                // path — expensive, check late.
                if let Some(ref p) = path_q {
                    if !commit_touches_path(repo, &commit, p)? {
                        continue;
                    }
                }

                // content — the only filter that costs a full diff scan per
                // commit, so it runs LAST: an author- or path-scoped search
                // only diffs the commits every cheaper filter already accepted.
                if let Some(ref m) = content_m {
                    if !commit_diff_matches_content(repo, &commit, m, path_q.as_deref())? {
                        continue;
                    }
                }

                let refs: Vec<String> = ref_map.get(&oid).cloned().unwrap_or_default();
                let mut info = commit_to_info(&commit);
                info.refs = refs;
                out.push(info);
            }
            Ok(LogPage {
                next_cursor: frontier.finish(repo),
                commits: out,
            })
        })
    }

    fn commits_since(&self, repo_id: &RepoId, base: &str) -> AppResult<Vec<CommitInfo>> {
        self.with_repo(repo_id, |repo| {
            let ref_map = collect_ref_map(repo);

            let head = match repo.head() {
                Ok(h) => h.peel_to_commit()?.id(),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Err(AppError::Unborn),
                Err(e) => return Err(e.into()),
            };

            let base_oid = repo
                .revparse_single(base)
                .map_err(|_| AppError::InvalidRef(base.to_string()))?
                .peel_to_commit()?
                .id();

            if base_oid == head {
                return Ok(Vec::new());
            }
            // A rebase base must be an ancestor of HEAD (HEAD descends from it).
            if !repo.graph_descendant_of(head, base_oid)? {
                return Err(AppError::InvalidRef(format!(
                    "{base} is not an ancestor of HEAD"
                )));
            }

            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
            walk.push(head)?;
            walk.hide(base_oid)?;

            let mut out = Vec::new();
            for oid in walk {
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                let refs: Vec<String> = ref_map.get(&oid).cloned().unwrap_or_default();
                let mut info = commit_to_info(&commit);
                info.refs = refs;
                out.push(info);
            }
            Ok(out)
        })
    }

    fn commits_between(
        &self,
        repo_id: &RepoId,
        base: &str,
        tip: &str,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        self.with_repo(repo_id, |repo| {
            let ref_map = collect_ref_map(repo);
            // `resolve_commit` maps a failure to InvalidRef with the offending
            // spec, so the UI can name the side the user typed wrong.
            let base_oid = resolve_commit(repo, base)?.id();
            let tip_oid = resolve_commit(repo, tip)?.id();

            // No ancestry requirement on purpose — see the trait doc. A pair
            // that has diverged is the whole point.
            let mut walk = repo.revwalk()?;
            walk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL)?;
            walk.push(tip_oid)?;
            walk.hide(base_oid)?;

            let mut out = Vec::new();
            for oid in walk {
                if out.len() >= limit {
                    break;
                }
                let oid = oid?;
                let commit = repo.find_commit(oid)?;
                let refs: Vec<String> = ref_map.get(&oid).cloned().unwrap_or_default();
                let mut info = commit_to_info(&commit);
                info.refs = refs;
                out.push(info);
            }
            Ok(out)
        })
    }

    fn ahead_behind(&self, repo_id: &RepoId, a: &str, b: &str) -> AppResult<AheadBehind> {
        self.with_repo(repo_id, |repo| {
            let a_oid = resolve_commit(repo, a)?.id();
            let b_oid = resolve_commit(repo, b)?.id();

            // git2's argument order is (local, upstream) → (ahead, behind) of
            // LOCAL. Here `b` plays the local role: `ahead` must mean "on b, not
            // on a" (see AheadBehind).
            let (ahead, behind) = repo.graph_ahead_behind(b_oid, a_oid)?;
            // Unrelated histories are a state, not a failure.
            let merge_base = repo.merge_base(a_oid, b_oid).ok().map(|o| o.to_string());

            Ok(AheadBehind {
                ahead,
                behind,
                merge_base,
            })
        })
    }

    fn diff(
        &self,
        repo_id: &RepoId,
        path: &Path,
        kind: DiffKind,
        context_lines: u32,
        ignore_whitespace: bool,
    ) -> AppResult<FileDiff> {
        self.with_repo(repo_id, |repo| {
            // Without this the diff comes back valid but empty — a blank panel
            // with no explanation. See `is_embedded_repo`.
            reject_embedded_repo(repo, path)?;
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            // One concrete path — prune the walk to it instead of post-filtering
            // a whole-worktree diff (see worktree_index_diff_opts).
            opts.disable_pathspec_match(true);
            opts.context_lines(context_lines);
            opts.ignore_whitespace(ignore_whitespace);
            // Include untracked files as if their full content were a new addition
            // so the diff viewer shows file contents for newly created files.
            if matches!(kind, DiffKind::WorktreeToIndex | DiffKind::WorktreeToHead) {
                opts.include_untracked(true)
                    .recurse_untracked_dirs(true)
                    .show_untracked_content(true);
            }

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
                // Paths are read once, on the first callback — building the
                // String on every printed line allocated twice per line for a
                // value that never changes within a single-path diff.
                if current_path.is_none() {
                    current_path = delta
                        .new_file()
                        .path()
                        .map(|p| p.to_string_lossy().to_string());
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
                    // Compare the stored header (newline-stripped) against the
                    // raw header bytes (also stripped) so lines within the same
                    // hunk don't create duplicate DiffHunk entries. Trim the
                    // borrowed bytes in place — collecting them into a fresh
                    // Vec allocated once per printed line.
                    let raw = h.header();
                    let raw_header_trimmed = raw
                        .iter()
                        .rposition(|&b| b != b'\n')
                        .map(|i| &raw[..=i])
                        .unwrap_or(raw);
                    let is_new_hunk = hunks
                        .last()
                        .map(|last| last.header.as_bytes() != raw_header_trimmed)
                        .unwrap_or(true);
                    if is_new_hunk {
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

            let mut file_diff = FileDiff {
                path: current_path.unwrap_or(path_str),
                old_path,
                binary,
                additions,
                deletions,
                hunks,
                lfs: None,
            };
            crate::git::lfs::annotate(&mut file_diff);
            Ok(file_diff)
        })
    }

    fn read_file_content(&self, repo_id: &RepoId, path: &Path) -> AppResult<Option<FileContent>> {
        let rel = path.to_path_buf();
        let path_str = rel.to_string_lossy().into_owned();
        self.with_repo(repo_id, |repo| {
            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::InvalidPath("bare repository has no workdir".into()))?;
            let abs = workdir.join(&rel);
            if abs.is_file() {
                let bytes = std::fs::read(&abs)?;
                let size = bytes.len() as u64;
                // String::from_utf8 MOVES the buffer on success — from_utf8 +
                // to_string held two full copies of every opened file.
                return Ok(Some(match String::from_utf8(bytes) {
                    Ok(s) => FileContent {
                        path: path_str,
                        binary: false,
                        text: Some(s),
                        from_head: false,
                        size,
                    },
                    Err(_) => FileContent {
                        path: path_str,
                        binary: true,
                        text: None,
                        from_head: false,
                        size,
                    },
                }));
            }

            // Fallback: read from HEAD blob (for deleted files).
            let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
            if let Some(tree) = head {
                if let Ok(entry) = tree.get_path(&rel) {
                    // KIND before lookup, as in `read_file_content_at_rev`: a
                    // `160000` gitlink's oid is a commit this repository does not
                    // hold, so `to_object` errored for every click on a clean
                    // submodule row.
                    if entry.kind() == Some(git2::ObjectType::Blob) {
                        let obj = entry.to_object(repo)?;
                        if let Some(blob) = obj.as_blob() {
                            let content = blob.content();
                            let size = content.len() as u64;
                            if blob.is_binary() {
                                return Ok(Some(FileContent {
                                    path: path_str,
                                    binary: true,
                                    text: None,
                                    from_head: true,
                                    size,
                                }));
                            }
                            return Ok(Some(match std::str::from_utf8(content) {
                                Ok(s) => FileContent {
                                    path: path_str,
                                    binary: false,
                                    text: Some(s.to_string()),
                                    from_head: true,
                                    size,
                                },
                                Err(_) => FileContent {
                                    path: path_str,
                                    binary: true,
                                    text: None,
                                    from_head: true,
                                    size,
                                },
                            }));
                        }
                    }
                }
            }

            // Neither the worktree nor HEAD holds text at this path: a submodule
            // or plain directory, or a file that vanished after the status
            // snapshot the caller is rendering. A STATE, not a failure (#146) —
            // see the trait doc.
            Ok(None)
        })
    }

    fn list_files_at_rev(&self, repo_id: &RepoId, revspec: &str) -> AppResult<Vec<FileStatus>> {
        self.with_repo(repo_id, |repo| {
            let tree = resolve_tree(repo, revspec)?;

            let mut out = Vec::new();
            // Walk the tree pre-order, accumulating full paths for blobs only.
            tree.walk(git2::TreeWalkMode::PreOrder, |root, entry| {
                if entry.kind() == Some(git2::ObjectType::Blob) {
                    let name = entry.name().unwrap_or("");
                    let path = if root.is_empty() {
                        name.to_string()
                    } else {
                        format!("{root}{name}")
                    };
                    if !path.is_empty() {
                        out.push(FileStatus {
                            path,
                            worktree: StatusFlag::Unmodified,
                            index: StatusFlag::Unmodified,
                            additions: 0,
                            deletions: 0,
                            staged_additions: 0,
                            staged_deletions: 0,
                            unstaged_additions: 0,
                            unstaged_deletions: 0,
                            // Blobs only — a committed tree never yields a
                            // directory entry, embedded or otherwise. A submodule
                            // is a `160000` gitlink, not a blob, so it is filtered
                            // out by the `Blob` test above for the same reason.
                            embedded: false,
                            submodule: false,
                        });
                    }
                }
                git2::TreeWalkResult::Ok
            })?;
            Ok(out)
        })
    }

    fn read_file_content_at_rev(
        &self,
        repo_id: &RepoId,
        revspec: &str,
        path: &Path,
    ) -> AppResult<Option<FileContent>> {
        let rel = path.to_path_buf();
        let path_str = rel.to_string_lossy().into_owned();
        self.with_repo(repo_id, |repo| {
            let tree = resolve_tree(repo, revspec)?;

            // No text at this path at this revision is a STATE, not a failure
            // (#146). Every diff surface reads the OTHER side of a file it is
            // already rendering, so an ADDED file has no old side and a DELETED
            // one has no new side — the expected case, and the reason seven of
            // these were logged as errors during one commit's syntax prefetch.
            // A non-blob (a directory, or a `160000` submodule gitlink) answers
            // the same way: there is no text to colour either.
            let Ok(entry) = tree.get_path(&rel) else {
                return Ok(None);
            };
            // Test the entry's KIND before looking the object up. A gitlink's oid
            // names a commit in the SUBMODULE's object database, which this
            // repository does not hold, so `to_object` failed with "object not
            // found" and the `as_blob` guard below never got the chance — #151
            // documented the gitlink as answering `Ok(None)` while it actually
            // errored. `kind()` reads the entry's filemode, no ODB lookup.
            if entry.kind() != Some(git2::ObjectType::Blob) {
                return Ok(None);
            }
            let obj = entry.to_object(repo)?;
            let Some(blob) = obj.as_blob() else {
                return Ok(None);
            };
            let content = blob.content();
            let size = content.len() as u64;
            if blob.is_binary() {
                return Ok(Some(FileContent {
                    path: path_str,
                    binary: true,
                    text: None,
                    from_head: true,
                    size,
                }));
            }
            Ok(Some(match std::str::from_utf8(content) {
                Ok(s) => FileContent {
                    path: path_str,
                    binary: false,
                    text: Some(s.to_string()),
                    from_head: true,
                    size,
                },
                Err(_) => FileContent {
                    path: path_str,
                    binary: true,
                    text: None,
                    from_head: true,
                    size,
                },
            }))
        })
    }

    fn read_file_content_at_index(
        &self,
        repo_id: &RepoId,
        path: &Path,
    ) -> AppResult<Option<FileContent>> {
        let rel = path.to_path_buf();
        let path_str = rel.to_string_lossy().into_owned();
        self.with_repo(repo_id, |repo| {
            let index = repo.index()?;
            // Stage 0 is the normal, non-conflicted entry. A conflicted path has
            // stages 1-3 and no 0, so it lands in the same "not in the index"
            // branch as an untracked one — correct either way, because neither
            // has a single index version to colour from. That absence is a
            // STATE, not a failure (#146): the commit panel asks for the index
            // side of every row it renders, and an untracked row genuinely has
            // none.
            let Some(entry) = index.get_path(&rel, 0) else {
                return Ok(None);
            };
            // A `160000` gitlink DOES have a stage-0 entry, so the guard above
            // never fires for a submodule — and its oid names a commit in the
            // SUBMODULE's object database, so `find_blob` failed with "object not
            // found", once per selection of a submodule row in the commit panel.
            // Same answer as the other two readers: a non-blob has no text to
            // colour. (The index holds no tree entries, so a gitlink is the only
            // non-blob mode reachable here.)
            if entry.mode == u32::from(git2::FileMode::Commit) {
                return Ok(None);
            }
            let blob = repo.find_blob(entry.id)?;
            let content = blob.content();
            let size = content.len() as u64;
            if blob.is_binary() {
                return Ok(Some(FileContent {
                    path: path_str,
                    binary: true,
                    text: None,
                    from_head: false,
                    size,
                }));
            }
            Ok(Some(match std::str::from_utf8(content) {
                Ok(s) => FileContent {
                    path: path_str,
                    binary: false,
                    text: Some(s.to_string()),
                    from_head: false,
                    size,
                },
                Err(_) => FileContent {
                    path: path_str,
                    binary: true,
                    text: None,
                    from_head: false,
                    size,
                },
            }))
        })
    }

    fn read_image_preview(
        &self,
        repo_id: &RepoId,
        source: &BlobSource,
        path: &Path,
    ) -> AppResult<Option<ImagePreview>> {
        let rel = path.to_path_buf();
        let path_str = rel.to_string_lossy().into_owned();
        // ONE lock acquisition for the whole answer, including the LFS hop:
        // resolving a pointer needs `repo.path()` and `lfs.storage`, and taking
        // a second acquisition to get them would let the worktree move between
        // the blob we sniffed and the object we opened.
        self.with_repo(repo_id, |repo| {
            let side = match source {
                BlobSource::Worktree => {
                    let workdir = repo.workdir().ok_or_else(|| {
                        AppError::InvalidPath("bare repository has no workdir".into())
                    })?;
                    read_worktree_side(&workdir.join(&rel))?
                }
                BlobSource::Index => {
                    let index = repo.index()?;
                    match index.get_path(&rel, 0) {
                        // A `160000` gitlink HAS a stage-0 entry and its oid is
                        // a commit in the submodule's object database, so
                        // `find_blob` would error — the same guard the other
                        // three readers carry, for the same reason (#151).
                        Some(e) if e.mode != u32::from(git2::FileMode::Commit) => {
                            read_blob_side(repo, e.id)?
                        }
                        _ => BlobSide::Absent,
                    }
                }
                BlobSource::Stage { stage } => {
                    let index = repo.index()?;
                    match index.get_path(&rel, i32::from(*stage)) {
                        Some(e) if e.mode != u32::from(git2::FileMode::Commit) => {
                            read_blob_side(repo, e.id)?
                        }
                        _ => BlobSide::Absent,
                    }
                }
                BlobSource::Rev { revspec } => {
                    let tree = resolve_tree(repo, revspec)?;
                    match tree.get_path(&rel) {
                        // KIND before lookup: a gitlink's oid names a commit
                        // this repository does not hold.
                        Ok(entry) if entry.kind() == Some(git2::ObjectType::Blob) => {
                            read_blob_side(repo, entry.id())?
                        }
                        _ => BlobSide::Absent,
                    }
                }
            };

            let bytes = match side {
                BlobSide::Absent => return Ok(None),
                BlobSide::TooLarge(size) => {
                    return Ok(Some(ImagePreview::TooLarge {
                        path: path_str,
                        size,
                        limit: image::MAX_PREVIEW_BYTES,
                    }))
                }
                BlobSide::Bytes(b) => b,
            };

            // An LFS pointer is a ≤3-line text file, so this costs one length
            // comparison for every real image (#93's reasoning, in bytes).
            if bytes.len() as u64 <= image::MAX_POINTER_BYTES {
                if let Some(pointer) =
                    std::str::from_utf8(&bytes).ok().and_then(crate::git::lfs::parse_pointer)
                {
                    return Ok(Some(resolve_lfs_object(repo, path_str, &pointer)?));
                }
            }
            Ok(Some(describe_bytes(path_str, &bytes)))
        })
    }

    fn diff_commits(
        &self,
        repo_id: &RepoId,
        from_oid: &str,
        to_oid: &str,
        context_lines: u32,
        ignore_whitespace: bool,
    ) -> AppResult<Vec<FileDiff>> {
        self.with_repo(repo_id, |repo| {
            // `resolve_commit`, not a bare `?`: both sides are USER-TYPED
            // revspecs since #131 (the compare screen's pickers accept any), and
            // a typo must answer `InvalidRef(spec)` like every other revspec op
            // rather than a stringified libgit2 message. The compare screen
            // fires four of these in one `Promise.all`, so an inconsistent
            // variant here makes the same typo report differently run to run.
            let from = resolve_commit(repo, from_oid)?.id();
            let to = resolve_commit(repo, to_oid)?.id();
            let from_tree = repo.find_commit(from)?.tree()?;
            let to_tree = repo.find_commit(to)?.tree()?;

            let mut opts = DiffOptions::new();
            opts.context_lines(context_lines);
            opts.ignore_whitespace(ignore_whitespace);
            let mut diff =
                repo.diff_tree_to_tree(Some(&from_tree), Some(&to_tree), Some(&mut opts))?;

            let mut find_opts = DiffFindOptions::new();
            find_opts.renames(true).copies(false);
            diff.find_similar(Some(&mut find_opts)).ok();

            diff_to_file_diffs(&diff)
        })
    }

    fn diff_commit(
        &self,
        repo_id: &RepoId,
        oid: &str,
        context_lines: u32,
        ignore_whitespace: bool,
    ) -> AppResult<Vec<FileDiff>> {
        self.with_repo(repo_id, |repo| {
            let commit = repo.revparse_single(oid)?.peel_to_commit()?;
            let to_tree = commit.tree()?;
            // First parent for merges; None (empty tree) for the root commit.
            let from_tree = match commit.parent(0) {
                Ok(parent) => Some(parent.tree()?),
                Err(_) => None,
            };

            let mut opts = DiffOptions::new();
            opts.context_lines(context_lines);
            opts.ignore_whitespace(ignore_whitespace);
            let mut diff = repo.diff_tree_to_tree(
                from_tree.as_ref(),
                Some(&to_tree),
                Some(&mut opts),
            )?;

            let mut find_opts = DiffFindOptions::new();
            find_opts.renames(true).copies(false);
            diff.find_similar(Some(&mut find_opts)).ok();

            diff_to_file_diffs(&diff)
        })
    }

    fn diff_ref_to_workdir(
        &self,
        repo_id: &RepoId,
        revspec: &str,
        context_lines: u32,
        ignore_whitespace: bool,
        include_untracked: bool,
    ) -> AppResult<WorkdirDiff> {
        self.with_repo(repo_id, |repo| {
            // `resolve_tree` so a tag, a branch, a commit or a tree all work —
            // the same reach `list_files_at_rev` gives the tree browser — and so
            // a bad spec is `InvalidRef`, not a stringified libgit2 message.
            let tree = resolve_tree(repo, revspec)?;

            // One builder, three call shapes, so the knobs cannot drift between
            // the counting pass and the real one.
            let build = |untracked: UntrackedMode| -> AppResult<git2::Diff<'_>> {
                let mut opts = DiffOptions::new();
                opts.context_lines(context_lines);
                opts.ignore_whitespace(ignore_whitespace);
                // This op fans out over the WHOLE tree, unlike `diff`, which
                // pathspecs one file first. Cap per-blob size so a single huge
                // artifact reports as binary instead of being serialised.
                opts.max_size(MAX_WORKDIR_BLOB);
                match untracked {
                    UntrackedMode::Off => {}
                    // `include_ignored` stays off in both, so `.gitignore`d
                    // files never appear either way.
                    UntrackedMode::NamesOnly => {
                        opts.include_untracked(true).recurse_untracked_dirs(true);
                    }
                    UntrackedMode::WithContent => {
                        opts.include_untracked(true)
                            .recurse_untracked_dirs(true)
                            .show_untracked_content(true);
                    }
                }
                // `_with_index`, not the plain tree-to-workdir: without the index
                // a file staged and then reverted in the worktree reads as
                // unchanged.
                Ok(repo.diff_tree_to_workdir_with_index(Some(&tree), Some(&mut opts))?)
            };

            // Decide the untracked side BEFORE any blob is read. The names-only
            // pass is the same directory walk without the content, so this costs
            // a second walk and never a second read of the files we then drop.
            let (mode, untracked_omitted) = if include_untracked {
                let counted = build(UntrackedMode::NamesOnly)?;
                let untracked = counted
                    .deltas()
                    .filter(|d| d.status() == git2::Delta::Untracked)
                    .count();
                if untracked > MAX_UNTRACKED_FILES {
                    (UntrackedMode::Off, untracked)
                } else {
                    (UntrackedMode::WithContent, 0)
                }
            } else {
                (UntrackedMode::Off, 0)
            };

            let mut diff = build(mode)?;

            let mut find_opts = DiffFindOptions::new();
            find_opts.renames(true).copies(false);
            diff.find_similar(Some(&mut find_opts)).ok();

            Ok(WorkdirDiff {
                files: diff_to_file_diffs(&diff)?,
                untracked_omitted,
            })
        })
    }

    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // Embedded repos can't be staged (see `is_embedded_repo`), but a
            // batch must not be all-or-nothing: "Stage all" passes every
            // unstaged path, and rejecting the whole batch would leave the user
            // unable to stage anything until they gitignore the nested repo.
            // Skip them, stage the rest, and only error when nothing is left.
            let (skipped, stageable): (Vec<&PathBuf>, Vec<&PathBuf>) =
                paths.iter().partition(|p| is_embedded_repo(repo, p));
            if stageable.is_empty() {
                return match skipped.first() {
                    Some(p) => Err(AppError::EmbeddedRepo(p.to_string_lossy().to_string())),
                    // Empty batch — nothing asked for, nothing refused.
                    None => Ok(()),
                };
            }
            let mut index = repo.index()?;
            for p in stageable {
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
            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::InvalidPath("bare repository has no workdir".into()))?
                .to_path_buf();

            // Embedded repos take the same batch semantics as `stage`: skip
            // them, act on the rest, error only when nothing is left. Discard
            // now deletes untracked paths, and an embedded repo is untracked —
            // removing one would destroy commits git cannot recover.
            let (skipped, discardable): (Vec<&PathBuf>, Vec<&PathBuf>) =
                paths.iter().partition(|p| is_embedded_repo(repo, p));
            if discardable.is_empty() {
                return match skipped.first() {
                    Some(p) => Err(AppError::EmbeddedRepo(p.to_string_lossy().to_string())),
                    // Empty batch — nothing asked for, nothing refused.
                    None => Ok(()),
                };
            }

            // `checkout_index` can only restore paths that HAVE an index entry.
            // An untracked path has none, so libgit2 finds nothing to check out
            // and returns Ok(()) — which is how discard used to report success
            // while leaving the file untouched. Split the batch: restore what
            // the index knows, delete what it doesn't.
            let index = repo.index()?;
            let mut restore: Vec<&PathBuf> = Vec::new();
            let mut delete: Vec<PathBuf> = Vec::new();
            for p in discardable {
                // Validate before touching disk: `Path::join` silently replaces
                // the base on an absolute path, so an unvalidated frontend
                // string could otherwise name — and delete — any file.
                let abs = safe_workdir_path(&workdir, &p.to_string_lossy())?;
                // A directory is never its own index entry, so "absent from the
                // index" must not be read as "untracked" for one: deleting
                // `src/` because `src` isn't an entry would wipe every tracked
                // file beneath it. Restoring is what `git checkout -- src` does.
                // Any stage counts as tracked, not just stage 0 — a conflicted
                // path lives at stages 1/2/3, and treating it as untracked would
                // delete the user's merge in progress.
                if index_tracks_path(&index, p) || index_has_entry_under(&index, p) {
                    restore.push(p);
                } else if abs.exists() {
                    delete.push(abs);
                } else {
                    return Err(AppError::InvalidPath(format!(
                        "nothing to discard: {} is neither tracked nor present in the worktree",
                        p.display()
                    )));
                }
            }

            for abs in delete {
                if abs.is_dir() {
                    std::fs::remove_dir_all(&abs)
                } else {
                    std::fs::remove_file(&abs)
                }
                .map_err(|e| {
                    AppError::Io(format!("failed to discard {}: {e}", abs.display()))
                })?;
            }

            // Guard the empty case: a `CheckoutBuilder` with no path filter and
            // `force()` checks out the ENTIRE index, clobbering every modified
            // file in the worktree.
            if !restore.is_empty() {
                let mut opts = git2::build::CheckoutBuilder::new();
                opts.force();
                for p in restore {
                    opts.path(p);
                }
                repo.checkout_index(None, Some(&mut opts))?;
            }
            Ok(())
        })
    }

    fn delete_untracked(
        &self,
        repo_id: &RepoId,
        paths: &[PathBuf],
    ) -> AppResult<Vec<DeleteFailure>> {
        self.with_repo(repo_id, |repo| {
            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::InvalidPath("bare repository has no workdir".into()))?
                .to_path_buf();
            let index = repo.index()?;

            // ── Phase 1: validate everything, delete nothing ─────────────────
            //
            // All four refusals below are decidable without touching the disk,
            // so a batch containing one leaves the worktree exactly as it was.
            // That is the point: a crafted path, or a tracked file that slipped
            // into the selection, must not be discoverable by noticing that the
            // three files before it are already gone.
            let mut targets: Vec<(String, PathBuf)> = Vec::with_capacity(paths.len());
            for p in paths {
                let rel = p.to_string_lossy().to_string();
                // The security boundary, and it comes FIRST for two reasons.
                //
                // It is the check that must not be reachable around, and — less
                // obviously — `git2::Index::get_path` PANICS on a path that is
                // absolute or starts with `..` (it unwraps its own
                // `path_to_repo_path`). So the tracked check below is only safe
                // to run on a path already proven relative and contained;
                // `discard` orders itself the same way for the same reason.
                //
                // `resolved_workdir_path` canonicalizes, so unlike the lexical
                // `safe_workdir_path` this also refuses a symlink out of the
                // tree and a path reached THROUGH one.
                let abs = resolved_workdir_path(&workdir, &rel)?;
                // An embedded repository is untracked, and removing one destroys
                // commits git cannot recover. Same refusal `stage`/`discard`
                // make, and it precedes both checks below so the message names
                // the real reason rather than "is a directory".
                reject_embedded_repo(repo, p)?;
                // Any index stage counts as tracked, not just stage 0: a
                // conflicted path lives at 1/2/3, and reading it as untracked
                // would delete a merge in progress. An entry BENEATH the path
                // counts too, so `src` is not "untracked" merely because `src`
                // itself is not an index entry.
                if index_tracks_path(&index, p) || index_has_entry_under(&index, p) {
                    return Err(AppError::InvalidPath(format!(
                        "{rel} is tracked by git — delete only removes untracked files, \
                         and discarding it would restore it from the index instead"
                    )));
                }
                // A real directory is refused: this is the file list's action for
                // untracked FILES, and a recursive directory delete is a
                // different and far more dangerous operation. libgit2 recurses
                // untracked directories in `status()` anyway, so every untracked
                // row the UI shows is a file. Symlinks are NOT caught here —
                // `symlink_metadata` does not follow — and are unlinked as links
                // below, which is what removing a link means.
                if std::fs::symlink_metadata(&abs).is_ok_and(|m| m.is_dir()) {
                    return Err(AppError::InvalidPath(format!(
                        "{rel} is a directory — delete removes files, not directory trees"
                    )));
                }
                targets.push((rel, abs));
            }

            // ── Phase 2: delete, best-effort ─────────────────────────────────
            let mut failed = Vec::new();
            for (rel, abs) in targets {
                let is_link = std::fs::symlink_metadata(&abs).is_ok_and(|m| m.is_symlink());
                let mut result = std::fs::remove_file(&abs);
                // A Windows symlink to a DIRECTORY (or a junction) is a
                // directory entry as far as the OS is concerned, so `unlink`
                // refuses it and `remove_dir` is the call that removes the link
                // without touching its target. Only ever attempted for something
                // we already know is a link — phase 1 refused real directories.
                if result.is_err() && is_link {
                    result = std::fs::remove_dir(&abs);
                }
                if let Err(e) = result {
                    failed.push(DeleteFailure {
                        // The path the CALLER spelled, not the canonicalized
                        // absolute one: the file list has no row for the latter.
                        path: rel,
                        reason: e.to_string(),
                    });
                }
            }
            Ok(failed)
        })
    }

    fn stage_hunk(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        context_lines: u32,
    ) -> AppResult<()> {
        // Returns Some(patch) for a file that is not in the index yet, which has
        // to take the `git apply --cached` route instead: libgit2's
        // `ApplyLocation::Index` needs an existing index entry and fails outright
        // with "index does not contain <path>".
        let creation_patch = self.with_repo(repo_id, |repo| {
            let mut opts = worktree_index_diff_opts(path, context_lines);
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

            let creates = diff
                .get_delta(delta_idx)
                .map(|d| delta_creates_file(&d))
                .unwrap_or(false);
            if creates {
                return patch_text_for_hunk(&diff, delta_idx, hunk_index).map(Some);
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
            Ok(None)
        })?;

        match creation_patch {
            Some(text) => {
                let repo_path = self.repo_path(repo_id)?;
                git_apply(&repo_path, &["--cached"], &text)
            }
            None => Ok(()),
        }
    }

    fn unstage_hunk(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        context_lines: u32,
    ) -> AppResult<()> {
        // Build patch text from the IndexToHead diff, then `git apply --cached --reverse`.
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.disable_pathspec_match(true);
            opts.context_lines(context_lines);
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

    fn discard_hunk(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        context_lines: u32,
    ) -> AppResult<()> {
        // Build patch text from the WorktreeToIndex diff, then `git apply --reverse`.
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = worktree_index_diff_opts(path, context_lines);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_hunk(&diff, delta_index, hunk_index)
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--reverse"], &patch_text)
    }

    fn stage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()> {
        // Unlike stage_hunk, this cannot use libgit2's ApplyOptions
        // hunk_callback: a callback can accept or reject a whole hunk but not a
        // subset of its lines. So it synthesizes a partial patch and pipes it
        // through the same `git apply` path unstage/discard already use.
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = worktree_index_diff_opts(path, context_lines);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_lines(
                &diff,
                delta_index,
                hunk_index,
                selected,
                PatchDirection::Apply,
            )
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--cached"], &patch_text)
    }

    fn unstage_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()> {
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = DiffOptions::new();
            opts.pathspec(path);
            opts.disable_pathspec_match(true);
            opts.context_lines(context_lines);
            let head_tree = match repo.head() {
                Ok(h) => Some(h.peel_to_tree()?),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };
            let diff = repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_lines(
                &diff,
                delta_index,
                hunk_index,
                selected,
                PatchDirection::Reverse,
            )
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--cached", "--reverse"], &patch_text)
    }

    fn discard_lines(
        &self,
        repo_id: &RepoId,
        path: &Path,
        hunk_index: usize,
        selected: &[usize],
        context_lines: u32,
    ) -> AppResult<()> {
        let patch_text = self.with_repo(repo_id, |repo| {
            let mut opts = worktree_index_diff_opts(path, context_lines);
            let diff = repo.diff_index_to_workdir(None, Some(&mut opts))?;
            let delta_index = find_delta_index(&diff, path)?;
            patch_text_for_lines(
                &diff,
                delta_index,
                hunk_index,
                selected,
                PatchDirection::Reverse,
            )
        })?;

        let repo_path = self.repo_path(repo_id)?;
        git_apply(&repo_path, &["--reverse"], &patch_text)
    }

    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> AppResult<CommitResult> {
        use crate::git::hooks;
        use crate::git::signature::{apply_signoff, default_signature};

        /// Run one hook and turn a refusal into the error the frontend renders.
        fn gate(workdir: &std::path::Path, name: &str, args: &[&str]) -> AppResult<()> {
            let out = hooks::run_hook(workdir, name, args)?;
            if out.rejected() {
                return Err(AppError::HookRejected(crate::error::HookRejection {
                    hook: name.to_string(),
                    output: out.output,
                }));
            }
            Ok(())
        }

        let repo_path = self.repo_path(repo_id)?;

        // `pre-commit` runs BEFORE the index is read, and OUTSIDE `with_repo`.
        // Both matter:
        //
        //  - A hook that runs `git add` (the lint-staged shape: reformat, then
        //    restage) mutates the on-disk index, and only a read that happens
        //    afterwards sees it. `tests/hooks.rs` pins this.
        //  - `with_repo` holds the per-repo mutex, and a hook shelling out to
        //    git must not deadlock against us.
        //
        // A refusal here returns before anything is created.
        if !opts.no_verify {
            gate(&repo_path, "pre-commit", &[])?;
        }

        // Sign-off goes on before any hook sees the message, matching
        // `git commit -s` — verified that git has already appended the trailer
        // by the time `commit-msg` reads the file, so a hook validating trailers
        // has to see it here too.
        //
        // This takes the per-repo lock a second time. The stash TOCTOU rule
        // would normally forbid that, but this is a READ of the config identity
        // rather than a verify-then-mutate: the worst a race can do is trail a
        // `Signed-off-by` for the identity the user had a moment ago. It cannot
        // be folded into the commit's own `with_repo` either — sign-off must be
        // applied before the hooks run, and the hooks must run outside the lock.
        let message_in = if opts.signoff {
            let (name, email) = self.with_repo(repo_id, |repo| {
                let c = default_signature(repo)?;
                Ok((
                    c.name().unwrap_or("").to_string(),
                    c.email().unwrap_or("").to_string(),
                ))
            })?;
            apply_signoff(&opts.message, &name, &email)
        } else {
            opts.message.clone()
        };

        // The message hooks negotiate over lives in `$GIT_DIR/COMMIT_EDITMSG`,
        // where git puts it — so a hook that ignores `$1` and hardcodes the path
        // still works.
        let message = if opts.no_verify {
            message_in
        } else {
            let git_dir = self.with_repo(repo_id, |repo| Ok(repo.path().to_path_buf()))?;
            let msg_path = git_dir.join("COMMIT_EDITMSG");
            std::fs::write(&msg_path, &message_in).map_err(|e| AppError::Io(e.to_string()))?;
            let msg_arg = msg_path
                .to_str()
                .ok_or_else(|| AppError::InvalidPath(msg_path.display().to_string()))?;

            // Our source is always `message`, with no third argument — amend
            // INCLUDED. Verified rather than assumed: the source is `commit`
            // (with the object as `$3`) only when the message is taken FROM a
            // commit, as with `-c`/`-C` or a bare `--amend`. We always supply it
            // as text, so git's equivalent is `commit --amend -m <msg>`, which
            // reports `message` and passes two arguments.
            gate(&repo_path, "prepare-commit-msg", &[msg_arg, "message"])?;
            gate(&repo_path, "commit-msg", &[msg_arg])?;

            // Re-read: either hook may have rewritten the file, and what it left
            // there is what git would commit.
            std::fs::read_to_string(&msg_path).map_err(|e| AppError::Io(e.to_string()))?
        };

        let oid = self.with_repo(repo_id, |repo| {
            let sig = match &opts.author_override {
                Some(o) => git2::Signature::now(&o.name, &o.email)?,
                None => default_signature(repo)?,
            };

            // Read the index HERE, after `pre-commit` — see the note above.
            //
            // And `read(false)` is not optional. `with_repo` hands back a CACHED
            // `git2::Repository`, and libgit2 caches its index in memory, so
            // `index()` alone returns the snapshot from before the hook ran — a
            // `pre-commit` that reformats and restages would silently commit the
            // unformatted content. `read(false)` reloads only if the on-disk
            // index actually changed, so it costs a stat in the common case.
            // Pinned by `a_pre_commit_that_restages_is_honoured`.
            let mut index = repo.index()?;
            index.read(false)?;
            let tree_oid = index.write_tree()?;
            let tree = repo.find_tree(tree_oid)?;

            let head = match repo.head() {
                Ok(h) => Some(h),
                Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
                Err(e) => return Err(e.into()),
            };

            // `None` follows commit.gpgsign; `Some` overrides it (#61 D6).
            let wants_sign = opts
                .sign
                .unwrap_or_else(|| crate::git::signing::config_wants_signing(repo));

            if wants_sign {
                return commit_signed(repo, &sig, &message, &tree, head.as_ref(), opts.amend);
            }

            if opts.amend {
                let head_ref = head.ok_or(AppError::Unborn)?;
                let tip = head_ref.peel_to_commit()?;
                let new_oid = tip.amend(
                    Some("HEAD"),
                    Some(&sig),
                    Some(&sig),
                    None,
                    Some(&message),
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
                &message,
                &tree,
                &parent_refs,
            )?;
            Ok(oid.to_string())
        })?;

        // `post-commit` runs after the ref moved, and its exit code is
        // DISCARDED because git discards it. Reporting a commit that exists as
        // failed would send the user hunting for work that already landed.
        if !opts.no_verify {
            let _ = hooks::run_hook(&repo_path, "post-commit", &[]);
        }

        Ok(CommitResult { oid, message })
    }

    fn commit_template(
        &self,
        repo_id: &RepoId,
    ) -> AppResult<crate::git::commit_template::CommitTemplate> {
        // Read every time rather than cached: a template the user has just
        // edited must not keep coming back stale, and this is one small file
        // read per visit to the commit screen.
        self.with_repo(repo_id, crate::git::commit_template::read)
    }

    fn branches(&self, repo_id: &RepoId) -> AppResult<Vec<BranchInfo>> {
        self.with_repo(repo_id, |repo| {
            let head_ref = repo.head().ok();
            let head_name = head_ref.as_ref().and_then(|r| r.shorthand()).map(String::from);

            // Detected once per listing, not per branch: it walks the remotes.
            let default_branch = detect_default_branch(repo);

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

                // FULL oid, not a 7-char prefix. Consumers compare it against
                // CommitInfo.oid (History's HEAD marker, the graph's HEAD ring,
                // the HEAD-ancestry walk that rebase plans are built from) and a
                // truncated value silently never matches — no error, just a
                // feature that quietly does nothing. Display sites shorten it
                // themselves via `shortSha`.
                let tip_oid = branch.get().target();
                let tip = tip_oid.map(|o| o.to_string());
                // Recency for the frontend's ordering (#135). One `find_commit`
                // off the oid just read — same cost class as the
                // `graph_ahead_behind` below. An unresolvable tip yields 0,
                // which sorts last under newest-first.
                let tip_time = tip_oid
                    .and_then(|o| repo.find_commit(o).ok())
                    .map(|c| c.time().seconds())
                    .unwrap_or(0);

                let (upstream, ahead, behind) = if !is_remote {
                    match branch.upstream() {
                        Ok(up) => {
                            let up_name = up.name().ok().flatten().map(String::from);
                            let counts = match (branch.get().target(), up.get().target()) {
                                // In-sync (the common case for most rows) needs
                                // no graph walk — graph_ahead_behind is a
                                // merge-base computation per branch per refresh.
                                (Some(local), Some(remote)) if local == remote => (0, 0),
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

                let is_default =
                    is_default_branch_name(&name, is_remote, default_branch.as_deref());

                out.push(BranchInfo {
                    name,
                    is_head,
                    is_remote,
                    upstream,
                    ahead,
                    behind,
                    tip,
                    tip_time,
                    is_default,
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
                // Peel annotated tags to the commit. Keep the object around:
                // `signed` below reads the same tag object, and looking it up
                // again (the old `find_tag`) was a second ODB read per tag.
                let obj = repo.find_object(oid, None).ok();
                let tip_oid = obj
                    .as_ref()
                    .and_then(|o| o.peel(git2::ObjectType::Commit).ok())
                    .map(|c| c.id())
                    .unwrap_or(oid);
                // Free: a lightweight tag has no tag object, and an annotated
                // one already had to be read to peel it. No subprocess — the
                // VERDICT costs one, which is why verify_tag is separate (#132).
                let signed = obj
                    .as_ref()
                    .and_then(|o| o.as_tag())
                    .and_then(|t| t.message().map(crate::git::tag::has_signature_block))
                    .unwrap_or(false);
                let oid_str = tip_oid.to_string();
                out.push(TagInfo {
                    name,
                    short_oid: oid_str[..7].to_string(),
                    oid: oid_str,
                    signed,
                });
                true
            })?;
            Ok(out)
        })
    }

    fn stashes(&self, repo_id: &RepoId) -> AppResult<Vec<StashInfo>> {
        self.with_repo_mut(repo_id, |repo| {
            // Two passes, not one: `stash_foreach` holds the repository mutably
            // for the duration of the walk, so the closure cannot `find_commit`
            // to read a parent count. Collect the raw triples first, resolve
            // the untracked parent after the walk has released the borrow.
            let mut raw: Vec<(usize, git2::Oid, String)> = Vec::new();
            repo.stash_foreach(|index, message, oid| {
                raw.push((index, *oid, message.to_string()));
                true
            })?;
            let out = raw
                .into_iter()
                .map(|(index, oid, message)| {
                    let oid_str = oid.to_string();
                    StashInfo {
                    index,
                    short_oid: oid_str[..7].to_string(),
                    oid: oid_str,
                    message,
                    // An unreadable entry is reported as carrying no untracked
                    // side rather than taking the whole list down with it —
                    // the list is how a user reaches Drop.
                    untracked: repo
                        .find_commit(oid)
                        .map(|c| c.parent_count() > 2)
                        .unwrap_or(false),
                }})
                .collect();
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
            crate::git::tag::validate_branch_name(name)?;
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
            crate::git::tag::validate_branch_name(to)?;
            let mut branch = repo.find_branch(from, git2::BranchType::Local)?;
            branch.rename(to, false)?;
            Ok(())
        })
    }
    fn set_upstream(
        &self,
        repo_id: &RepoId,
        branch: &str,
        upstream: Option<&str>,
    ) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            // Validate the remote-tracking branch BEFORE touching config, so a
            // typo is a clean InvalidRef instead of a stringified libgit2 error.
            if let Some(up) = upstream {
                repo.find_branch(up, BranchType::Remote)
                    .map_err(|_| AppError::InvalidRef(up.to_string()))?;
            }
            let mut local = repo
                .find_branch(branch, BranchType::Local)
                .map_err(|_| AppError::InvalidRef(branch.to_string()))?;
            local.set_upstream(upstream)?;
            Ok(())
        })
    }

    fn fast_forward_remote(&self, repo_id: &RepoId, branch: &str) -> AppResult<String> {
        self.with_repo(repo_id, |repo| {
            // Both refusals happen before the caller spends a fetch. The
            // upstream one goes FIRST: for a checked-out branch that also tracks
            // nothing, "set an upstream" is the useful sentence and "pull it
            // instead" is advice the user cannot act on.
            let full = format!("refs/heads/{branch}");
            // `branch.<name>.remote`, not `upstream.split('/')[0]`: a remote name
            // may itself contain a slash, and `team/fork/main` would otherwise be
            // fetched from a remote called `team`.
            let remote = repo.branch_upstream_remote(&full).map_err(|_| {
                // Either the branch does not exist or it tracks nothing. Tell
                // those apart so a typo is not reported as a missing upstream.
                match repo.find_branch(branch, BranchType::Local) {
                    Ok(_) => AppError::NoUpstream(format!(
                        "{branch} tracks no remote branch — set an upstream first"
                    )),
                    Err(_) => AppError::InvalidRef(branch.to_string()),
                }
            })?;
            let name = remote.as_str().unwrap_or_default().to_string();
            if name.is_empty() {
                return Err(AppError::NoUpstream(format!(
                    "{branch} tracks no remote branch — set an upstream first"
                )));
            }
            reject_checked_out(repo, branch)?;
            Ok(name)
        })
    }

    fn fast_forward_branch(&self, repo_id: &RepoId, branch: &str) -> AppResult<FastForward> {
        // ONE `with_repo`: the ancestry check and the ref move share a single
        // acquisition of the per-repo mutex. See the trait doc.
        self.with_repo(repo_id, |repo| {
            // Plan first so an unknown branch or a missing upstream is reported
            // as itself; `reject_checked_out` then stops the move. Nothing has
            // been written at either point.
            let plan = plan_fast_forward(repo, branch)?;
            reject_checked_out(repo, branch)?;
            apply_fast_forward(branch, plan)
        })
    }

    fn fast_forward_all(&self, repo_id: &RepoId) -> AppResult<BulkFastForward> {
        // ONE `with_repo` for the WHOLE sweep — the branch listing and every ref
        // move it leads to are one atomic step as far as other commands go.
        self.with_repo(repo_id, |repo| {
            let head = repo
                .head()
                .ok()
                .and_then(|h| h.shorthand().map(String::from));
            // Walked once, not once per branch: each entry costs a repository
            // open.
            let linked = crate::git::worktree::linked_worktree_heads(repo);

            let mut out = BulkFastForward {
                advanced: Vec::new(),
                diverged: Vec::new(),
                checked_out: Vec::new(),
            };
            for name in local_branch_names(repo)? {
                let plan = match plan_fast_forward(repo, &name) {
                    Ok(p) => p,
                    // Nothing to answer for, and nothing the user has to act on.
                    Err(AppError::NoUpstream(_)) | Err(AppError::Unborn) => continue,
                    Err(e) => return Err(e),
                };
                match plan.kind {
                    FastForwardKind::UpToDate => {}
                    // Diverged wins over checked-out: the remedy is a merge or a
                    // rebase either way, and "pull it" would be wrong advice.
                    FastForwardKind::Diverged => out.diverged.push(name),
                    FastForwardKind::Advance(_) => {
                        // Classified only for a branch that WOULD have moved, so
                        // the branch you are standing on is named just when
                        // there is actually something to pull.
                        if checked_out_at(&name, head.as_deref(), &linked).is_some() {
                            out.checked_out.push(name);
                        } else {
                            out.advanced.push(apply_fast_forward(&name, plan)?);
                        }
                    }
                }
            }
            Ok(out)
        })
    }
    fn create_tag(&self, repo_id: &RepoId, name: &str, target: TagTarget) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            crate::git::tag::validate_tag_name(name)?;
            let obj = repo
                .revparse_single(&target.oid)
                .map_err(|_| AppError::InvalidRef(target.oid.clone()))?;
            // `None` follows tag.gpgsign; `Some` overrides it (#132) — the same
            // contract commit signing has with commit.gpgsign.
            let want_sign = target
                .sign
                .unwrap_or_else(|| crate::git::signing::config_wants_tag_signing(repo));
            match target.annotation {
                Some(msg) if want_sign => {
                    let sig = crate::git::signature::default_signature(repo)?;
                    create_signed_tag(repo, name, &obj, &sig, &msg)?;
                }
                Some(msg) => {
                    let sig = crate::git::signature::default_signature(repo)?;
                    // Same normalization the signed path applies, so one dialog
                    // input does not produce two different objects depending on
                    // whether it was signed. `git tag` completes the line too.
                    let msg = crate::git::tag::normalize_message(&msg);
                    repo.tag(name, &obj, &sig, &msg, false)?;
                }
                None => {
                    // Signing implies annotated: a lightweight tag is a ref, and
                    // there is no object to carry a signature. An explicit
                    // request is refused rather than silently not honoured.
                    //
                    // A bare tag.gpgsign, though, does NOT promote the tag to
                    // annotated — real `git tag` fails outright here ("fatal: no
                    // tag message?"), which would make lightweight tags
                    // unreachable in a signing repository. Our create-tag dialog
                    // has an explicit annotation field whose blankness *means*
                    // lightweight, so it wins.
                    if target.sign == Some(true) {
                        return Err(AppError::InvalidArgument(
                            "signing a tag requires an annotation — a lightweight tag has no object to sign"
                                .to_string(),
                        ));
                    }
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
    fn checkout_detached(&self, repo_id: &RepoId, oid: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let parsed = git2::Oid::from_str(oid)
                .map_err(|e| AppError::InvalidRef(e.message().to_string()))?;
            // Verify it's a commit we can reach.
            let _ = repo.find_commit(parsed).map_err(AppError::from)?;
            repo.set_head_detached(parsed).map_err(AppError::from)?;
            let mut co = git2::build::CheckoutBuilder::new();
            co.force();
            repo.checkout_head(Some(&mut co)).map_err(AppError::from)?;
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
    fn stash_drop(&self, repo_id: &RepoId, index: usize, expect_oid: &str) -> AppResult<()> {
        // Verified, and verified in the SAME lock acquisition as the drop —
        // see `stash_drop_at`. A stash index is a reflog position, and dropping
        // whatever moved into it is unrecoverable through the UI.
        self.stash_drop_at(repo_id, index, expect_oid)
    }
    fn stash_branch(&self, repo_id: &RepoId, index: usize, branch: &str) -> AppResult<()> {
        self.with_repo_mut(repo_id, |repo| {
            let stash_oid = {
                let mut found = None;
                repo.stash_foreach(|i, _msg, oid| {
                    if i == index {
                        found = Some(*oid);
                        false
                    } else {
                        true
                    }
                })?;
                found.ok_or_else(|| AppError::Git(format!("stash {index} not found")))?
            };
            // Extract the base commit OID before any mutable borrows so the
            // Commit objects (which hold &repo) are dropped before stash_apply.
            let base_oid = {
                let stash_commit = repo.find_commit(stash_oid)?;
                let base_commit = stash_commit.parent(0)?;
                base_commit.id()
            };
            let base_commit = repo.find_commit(base_oid)?;
            repo.branch(branch, &base_commit, false)?;
            drop(base_commit);

            let refname = format!("refs/heads/{branch}");
            repo.set_head(&refname)?;
            repo.checkout_head(Some(
                git2::build::CheckoutBuilder::new().force(),
            ))?;

            repo.stash_apply(index, None)?;
            repo.stash_drop(index)?;
            Ok(())
        })
    }

    fn stash_save_paths(
        &self,
        repo_id: &RepoId,
        opts: StashSaveOptions,
        paths: &[PathBuf],
    ) -> AppResult<Option<String>> {
        let refs: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
        let args = crate::git::stash::stash_push_args(&opts, &refs)?;
        if let Some(msg) = opts.message.as_deref() {
            crate::git::stash::validate_message(msg)?;
        }
        let workdir = self.repo_path(repo_id)?;

        // git prints "No local changes to save" and exits 0 when the pathspec
        // matches only unchanged files, so the exit status cannot tell us
        // whether an entry was actually created. The ref can: read it either
        // side and compare.
        let before = self.stash_tip(repo_id)?;
        run_git_capture_env(&workdir, &args, &[crate::git::stash::LITERAL_PATHSPECS])
            .map_err(AppError::Git)?;
        let after = self.stash_tip(repo_id)?;
        Ok(if after == before { None } else { after })
    }

    fn stash_rename(
        &self,
        repo_id: &RepoId,
        index: usize,
        expect_oid: &str,
        message: &str,
    ) -> AppResult<()> {
        crate::git::stash::validate_message(message)?;

        let before = self.stashes(repo_id)?;
        let entry = before
            .get(index)
            .ok_or_else(|| AppError::StaleStash(format!("stash@{{{index}}}")))?
            .clone();
        // The index alone is not enough to name an entry: it is a reflog
        // position, so a list the caller read a moment ago may already have
        // shifted. Renaming the wrong stash preserves its content but moves
        // somebody else's entry to the top under a name they did not choose.
        if entry.oid != expect_oid {
            return Err(AppError::StaleStash(format!("stash@{{{index}}}")));
        }
        // Renaming to what it is already called touches nothing. Worth an early
        // exit rather than a no-op round trip: the `store` below would be
        // elided by git (see the comment there) and the verification would then
        // fail on an operation that had nothing to do.
        if entry.message == message {
            return Ok(());
        }

        // Store a FRESH commit, never the existing one.
        //
        // `git stash store <oid>` is a SILENT NO-OP when `refs/stash` already
        // points at `<oid>`: the ref update is value-identical, git elides it,
        // and it still exits 0 having written no reflog entry. That is exactly
        // `stash@{0}` — so storing the old oid and then dropping the original
        // would DESTROY the top stash. A new commit cannot collide with the
        // ref's current value.
        //
        // The new commit keeps the original's tree, parents and BOTH
        // signatures, so the entry keeps its own time and content; the message
        // is the only thing that changes. That also fixes a second-order
        // wrongness — `git stash push` writes the same string as the commit
        // message and as the reflog message, and a store-only rename would
        // leave the commit's own message stale forever.
        let new_oid = self.with_repo(repo_id, |repo| {
            let commit = resolve_commit(repo, &entry.oid)?;
            let tree = commit.tree()?;
            let parents: Vec<git2::Commit<'_>> = commit.parents().collect();
            let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
            let oid = repo.commit(
                // No ref: a dangling commit until `stash store` files it.
                None,
                &commit.author(),
                &commit.committer(),
                message,
                &tree,
                &parent_refs,
            )?;
            Ok(oid.to_string())
        })?;
        if new_oid == entry.oid {
            // Only reachable if the commit already carried this exact message
            // while its reflog entry said something else. Proceeding would hand
            // `store` the elision case this whole design exists to avoid.
            return Err(AppError::Git(
                "stash rename would not change the entry; nothing was modified".into(),
            ));
        }

        let workdir = self.repo_path(repo_id)?;
        let args = crate::git::stash::stash_store_args(message, &new_oid);
        run_git_capture(&workdir, &args).map_err(AppError::Git)?;

        // VERIFY BEFORE DROPPING, and do both under ONE lock. Everything above
        // is additive — a failure so far leaves the original entry exactly
        // where it was. The drop is not, and it is unrecoverable through the
        // UI. See `stash::rename_store_landed` for the three conditions and
        // `stash_finish_rename` for why the read cannot be a separate
        // acquisition from the drop.
        let before_pairs: Vec<(String, String)> = before
            .iter()
            .map(|s| (s.oid.clone(), s.message.clone()))
            .collect();
        self.stash_finish_rename(repo_id, index, &before_pairs, &new_oid, message)
    }

    fn stash_diff(
        &self,
        repo_id: &RepoId,
        oid: &str,
        context_lines: u32,
        ignore_whitespace: bool,
        include_untracked: bool,
    ) -> AppResult<Vec<FileDiff>> {
        self.with_repo(repo_id, |repo| {
            let commit = resolve_commit(repo, oid)?;
            // Parent 0 is the commit the stash was taken on — its own base, not
            // whatever HEAD has become since. Diffing against HEAD (what this
            // used to do) mixes the stash with everything landed after it.
            let base = commit
                .parent(0)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?;

            let mut opts = DiffOptions::new();
            opts.context_lines(context_lines);
            opts.ignore_whitespace(ignore_whitespace);
            // base → stash, so the stashed work reads as ADDITIONS.
            let mut diff = repo.diff_tree_to_tree(
                Some(&base.tree()?),
                Some(&commit.tree()?),
                Some(&mut opts),
            )?;
            let mut find_opts = DiffFindOptions::new();
            find_opts.renames(true).copies(false);
            diff.find_similar(Some(&mut find_opts)).ok();
            let mut files = diff_to_file_diffs(&diff)?;

            // The `git stash -u` payload lives in a THIRD parent, which no
            // tree-level diff of the stash commit can reach. That parent's tree
            // holds nothing but the untracked files, so diffing it against the
            // EMPTY tree yields exactly them, all added — no filtering and no
            // overlap with the tracked side above.
            if include_untracked && commit.parent_count() > 2 {
                let untracked = commit.parent(2)?;
                let mut u_opts = DiffOptions::new();
                u_opts.context_lines(context_lines);
                u_opts.ignore_whitespace(ignore_whitespace);
                let u_diff =
                    repo.diff_tree_to_tree(None, Some(&untracked.tree()?), Some(&mut u_opts))?;
                files.extend(diff_to_file_diffs(&u_diff)?);
            }
            Ok(files)
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
        let output = crate::proc::git(&path)
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

    fn rebase_start(&self, repo_id: &RepoId, plan: Vec<RebaseStep>) -> AppResult<RebaseStatus> {
        // Validate BEFORE touching anything. An unexecutable step used to be
        // discovered mid-replay, with earlier picks already committed and the
        // branch tip already moved.
        self.with_repo(repo_id, |repo| crate::git::rebase_plan::validate(repo, &plan))?;

        // Validated above, so this cannot fail: the plan has at least one
        // non-Drop step. We need its parent as the new base.
        let first_step = plan
            .iter()
            .find(|s| s.action != RebaseAction::Drop)
            .ok_or_else(|| {
                AppError::InvalidRebasePlan("the plan drops every commit".into())
            })?;
        let first_oid_str = first_step.oid.clone();
        let first_step_onto = first_step.onto.clone();

        // Verify worktree is clean, remember the branch and its pre-rebase tip
        // (so an abort can put both back), then DETACH at the base and replay
        // there. The branch ref is moved exactly once, when the plan completes:
        // committing to an attached HEAD advanced the branch step by step,
        // which left it mid-replay whenever a step failed or paused.
        let (orig_head, head_name, onto) = self.with_repo(repo_id, |repo| {
            let statuses = repo.statuses(None)?;
            if statuses.iter().any(|s| {
                let b = s.status();
                b.is_wt_modified()
                    || b.is_index_modified()
                    || b.is_conflicted()
                    || b.is_wt_deleted()
                    || b.is_index_deleted()
                    || b.is_wt_new()
            }) {
                return Err(AppError::DirtyWorktree(
                    "commit or stash before rebasing".into(),
                ));
            }

            let head_ref = repo.head()?;
            let head_name = if repo.head_detached()? {
                None
            } else {
                head_ref.name().map(|s| s.to_string())
            };
            let orig_head = head_ref.peel_to_commit()?.id().to_string();
            // Same escape hatch git leaves before rewriting history:
            // `git reset --hard ORIG_HEAD` undoes this rebase from the CLI.
            crate::git::rebase_state::write_orig_head(repo, &orig_head)?;
            // A new rebase supersedes whatever the last one did, so the retained
            // summary goes now — before the replay can write a new one. This is
            // the clearing the frontend used to have to remember (#47).
            crate::git::rebase_state::clear_summary(repo)?;

            // The run's base: what the first step says it sits on, else that
            // commit's first parent.
            let base = match &first_step_onto {
                Some(onto) => repo
                    .revparse_single(onto)
                    .map_err(|_| AppError::InvalidRef(onto.clone()))?
                    .peel_to_commit()?,
                None => {
                    let first_commit = repo
                        .revparse_single(&first_oid_str)
                        .map_err(|_| AppError::InvalidRef(first_oid_str.clone()))?
                        .peel_to_commit()?;
                    first_commit.parent(0).map_err(|_| {
                        AppError::InvalidRebasePlan(format!(
                            "{} has no parent to rebase onto",
                            crate::git::rebase_plan::short(&first_oid_str)
                        ))
                    })?
                }
            };

            // Detach first, then hard-reset: with HEAD attached, the reset
            // would drag the branch ref along.
            repo.set_head_detached(base.id())?;
            repo.reset(base.as_object(), git2::ResetType::Hard, None)?;
            Ok((orig_head, head_name, base.id().to_string()))
        })?;

        let total = plan.len();
        let mut rebases = self
            .rebases
            .lock()
            .map_err(|e| AppError::Internal(e.to_string()))?;
        rebases.insert(
            repo_id.clone(),
            RebaseState {
                plan: plan.into_iter().collect(),
                total,
                completed: 0,
                pause_reason: None,
                conflict_step: None,
                orig_head,
                head_name,
                onto,
                rewritten: HashMap::new(),
            },
        );
        drop(rebases);

        // Mirror to disk before the first step runs: a crash between here and
        // the first commit must still be recoverable.
        self.persist_rebase(repo_id)?;

        self.advance_rebase(repo_id)
    }

    fn rebase_continue(&self, repo_id: &RepoId) -> AppResult<RebaseStatus> {
        // A rebase started by an earlier session has no in-memory entry; its
        // plan, progress, and rewritten map are all on disk.
        let known = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.contains_key(repo_id)
        };
        if !known && !self.rehydrate_rebase(repo_id)? {
            return Err(AppError::InvalidRef("no rebase in progress".into()));
        }

        // Verify no unresolved conflicts remain.
        self.with_repo(repo_id, |repo| {
            let statuses = repo.statuses(None)?;
            if statuses.iter().any(|s| s.status().is_conflicted()) {
                return Err(AppError::ConflictsDetected(
                    "unresolved conflicts — resolve before continuing rebase".into(),
                ));
            }
            Ok(())
        })?;
        self.advance_rebase(repo_id)
    }

    fn rebase_abort(&self, repo_id: &RepoId) -> AppResult<()> {
        // Drop in-memory state, keeping the branch and pre-rebase tip it
        // recorded.
        let removed = {
            let mut rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.remove(repo_id)
        };
        let (orig_head, head_name) = match removed {
            Some(s) => (Some(s.orig_head), s.head_name),
            None => {
                // Restarted mid-rebase: the state file is all we have.
                match self.with_repo(repo_id, crate::git::rebase_state::load)? {
                    Some(p) => (Some(p.orig_head), p.head_name),
                    None => (None, None),
                }
            }
        };

        self.with_repo(repo_id, |repo| {
            repo.cleanup_state()?;
            crate::git::rebase_state::clear(repo)?;
            // An abort throws the replay away, so there is nothing to report
            // about it — and a summary left from an EARLIER rebase would read as
            // this one's outcome.
            crate::git::rebase_state::clear_summary(repo)?;
            // The replay ran on a detached HEAD, so the branch never moved:
            // abort is "put HEAD back on the branch and throw the replay away".
            // A rebase started from a detached HEAD has no branch to return to,
            // so it goes back to the tip it recorded.
            match (&head_name, &orig_head) {
                (Some(name), _) => {
                    repo.set_head(name)?;
                    let target = repo.head()?.peel_to_commit()?;
                    repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
                }
                (None, Some(oid)) => {
                    let target = repo.revparse_single(oid)?.peel_to_commit()?;
                    repo.set_head_detached(target.id())?;
                    repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
                }
                (None, None) => {
                    let target = repo.head()?.peel_to_commit()?;
                    repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
                }
            }
            Ok(())
        })
    }

    fn rebase_status(&self, repo_id: &RepoId) -> AppResult<RebaseStatus> {
        let in_memory = {
            let rebases = self
                .rebases
                .lock()
                .map_err(|e| AppError::Internal(e.to_string()))?;
            rebases.get(repo_id).map(|state| RebaseStatus {
                in_progress: state.completed < state.total || state.pause_reason.is_some(),
                next_index: state.completed,
                total: state.total,
                pause_reason: state.pause_reason.clone(),
                last_completed: None,
            })
        };

        // ONE repo-lock acquisition for both small file reads (state + summary);
        // this is polled by every refreshStatus, so a second acquisition was a
        // second queue-up behind whatever op the repo is busy with.
        self.with_repo(repo_id, |repo| {
            let mut status = match in_memory {
                Some(status) => status,
                // No in-memory entry: either there is no rebase, or this process
                // did not start it (the app was restarted mid-rebase). The state
                // file is the authority in that case.
                None => match crate::git::rebase_state::load(repo)? {
                    Some(state) => RebaseStatus {
                        in_progress: true,
                        next_index: state.completed,
                        total: state.total,
                        pause_reason: state.pause_reason,
                        last_completed: None,
                    },
                    None => RebaseStatus {
                        in_progress: false,
                        next_index: 0,
                        total: 0,
                        pause_reason: None,
                        last_completed: None,
                    },
                },
            };

            // The completed-rebase summary outlives the rebase it describes, so it
            // is read here rather than derived from state that no longer exists.
            // It is written only on completion and dropped on start/abort/ack, so
            // it is always absent while `in_progress` is true.
            status.last_completed = crate::git::rebase_state::load_summary(repo)?;
            Ok(status)
        })
    }

    fn rebase_acknowledge(&self, repo_id: &RepoId) -> AppResult<()> {
        self.with_repo(repo_id, crate::git::rebase_state::clear_summary)
    }

    fn verify_commit(
        &self,
        repo_id: &RepoId,
        oid: &str,
    ) -> AppResult<crate::git::signing::SignatureStatus> {
        use crate::git::signing::{SigState, SignatureStatus};

        // Validated before it reaches an argv: `git show` would read a value
        // starting with '-' as an option rather than a revision. Every caller
        // passes an oid from our own log walk, so a hex check costs nothing and
        // removes the question.
        if oid.is_empty()
            || oid.len() > 40
            || !oid.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Err(AppError::InvalidRef(oid.to_string()));
        }

        let unsigned = SignatureStatus {
            state: SigState::None,
            signer: None,
            key: None,
        };

        // The common case costs no subprocess (issue 172). Most commits in most
        // repositories are unsigned, `LOOK.None` renders NOTHING, and on Windows
        // a GUI-subsystem release build pays a visible console window per
        // `git show` — so the reported symptom was one console flash per commit
        // selected, for a badge that never appeared. `verify_tag` below has had
        // this pre-check since #132; this is the same shape.
        //
        // Resolving the revision here also does two other jobs: an unknown
        // object is `InvalidRef` before anything is spawned (which is what the
        // hex check above could only approximate), and what reaches argv is a
        // full oid we produced, not caller text — the same reason
        // `bisect::resolve` exists.
        let (full_oid, signed) = self.with_repo(repo_id, |repo| {
            let commit = repo
                .revparse_single(oid)
                .and_then(|obj| obj.peel_to_commit())
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?;
            let id = commit.id();
            // `gpgsig` is the header git writes for every signature FORMAT —
            // openpgp, ssh and x509 all land there. `gpgsig-sha256` is the
            // sha256-object-format spelling, checked so a signed commit in such a
            // repository can never read as unsigned.
            let signed = ["gpgsig", "gpgsig-sha256"]
                .iter()
                .any(|field| repo.extract_signature(&id, Some(field)).is_ok());
            Ok((id.to_string(), signed))
        })?;
        if !signed {
            return Ok(unsigned);
        }

        let repo_path = self.repo_path(repo_id)?;
        // Shells out rather than reimplementing trust evaluation: %G? is git's
        // own verdict, including keyring/allowed-signers lookup.
        let out = crate::proc::git(&repo_path)
            // `proc::git` carries GIT_TERMINAL_PROMPT=0 and a closed stdin:
            // verification must never block on a prompt nobody can see, and
            // `spawn_blocking` offers no cancellation if it did.
            .args([
                "show",
                "--no-patch",
                "--format=%G?%x00%GS%x00%GK",
                &full_oid,
            ])
            .output()
            .map_err(|e| AppError::Io(e.to_string()))?;
        if !out.status.success() {
            // git's own message, not `InvalidRef(oid)`: the object is known to
            // exist (resolved above), so a failure here is git or the signer
            // — a broken gpg install used to be reported as a bad object id.
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            let detail = if stderr.is_empty() {
                String::from_utf8_lossy(&out.stdout).trim().to_string()
            } else {
                stderr
            };
            return Err(AppError::Git(format!("git show --format=%G?: {detail}")));
        }
        Ok(crate::git::signing::parse_verify_output(
            &String::from_utf8_lossy(&out.stdout),
        ))
    }

    fn verify_tag(
        &self,
        repo_id: &RepoId,
        name: &str,
    ) -> AppResult<crate::git::signing::SignatureStatus> {
        use crate::git::signing::{SigState, SignatureStatus};

        // Before it reaches an argv: `git verify-tag` would read a value
        // starting with '-' as an option, and this name comes from a text field.
        crate::git::tag::validate_tag_name(name)?;

        let unsigned = SignatureStatus {
            state: SigState::None,
            signer: None,
            key: None,
        };

        // The common case costs no subprocess. Most tags in most repositories
        // are unsigned or lightweight, and the Branches screen renders all of
        // them; spawning a signer per row is exactly what SignatureBadge's doc
        // comment refuses for commits.
        let signed = self.with_repo(repo_id, |repo| {
            let reference = repo
                .find_reference(&format!("refs/tags/{name}"))
                .map_err(|_| AppError::InvalidRef(name.to_string()))?;
            let Some(oid) = reference.target() else {
                // Symbolic: not a tag object, so nothing signed.
                return Ok(false);
            };
            Ok(repo
                .find_tag(oid)
                .ok()
                .and_then(|t| t.message().map(crate::git::tag::has_signature_block))
                .unwrap_or(false))
        })?;
        if !signed {
            return Ok(unsigned);
        }

        let repo_path = self.repo_path(repo_id)?;
        // Shells out rather than reimplementing trust evaluation — same reason
        // verify_commit does. `%G?` cannot be used here: it is a COMMIT format
        // placeholder, so `git show <tag> --format=%G?` reports the commit's
        // signature, and for-each-ref's %(signature:grade) atom is empty for a
        // tag object. `git verify-tag --raw` is git's own verdict on the tag.
        // No tty: verification must never block on a prompt nobody can see —
        // `proc::git` carries GIT_TERMINAL_PROMPT=0 and a closed stdin.
        let out = crate::proc::git(&repo_path)
            .args(["verify-tag", "--raw", "--"])
            .arg(name)
            .output()
            .map_err(|e| AppError::Io(e.to_string()))?;

        // git writes the verdict to stderr, not stdout.
        let raw = format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        Ok(crate::git::tag::parse_verify_tag(&raw, out.status.success()))
    }

    fn read_reflog(&self, repo_id: &RepoId) -> AppResult<Vec<ReflogEntry>> {
        self.with_repo(repo_id, |repo| {
            let reflog = match repo.reflog("HEAD") {
                Ok(r) => r,
                Err(e) if e.code() == git2::ErrorCode::NotFound => return Ok(Vec::new()),
                Err(e) => return Err(e.into()),
            };
            let mut out = Vec::with_capacity(reflog.len());
            for entry in reflog.iter() {
                let oid = entry.id_new();
                let raw_msg = entry.message().unwrap_or("");
                let (op, message) = parse_reflog_op(raw_msg);
                out.push(ReflogEntry {
                    oid: oid.to_string(),
                    short_oid: oid.to_string()[..7].to_string(),
                    message,
                    op,
                    timestamp: entry.committer().when().seconds(),
                });
            }
            Ok(out)
        })
    }

    fn repo_state(&self, repo_id: &RepoId) -> AppResult<RepoState> {
        self.with_repo(repo_id, |repo| {
            // Our own rebase wins: libgit2 only sees the CHERRY_PICK_HEAD /
            // MERGE_HEAD a paused step leaves behind, which would report the
            // step's mechanism instead of the operation the user started.
            if crate::git::rebase_state::load(repo)?.is_some() {
                return Ok(RepoState::RebaseInteractive);
            }
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

    fn head_info(&self, repo_id: &RepoId) -> AppResult<HeadInfo> {
        self.with_repo(repo_id, |repo| {
            // Same split `WorktreeInfo`'s listing already uses: `head()` errors
            // on an unborn branch (leaving both fields `None`), and a detached
            // HEAD resolves to a reference literally named "HEAD" whose
            // `shorthand()` is "HEAD" itself, not a branch — `is_branch()` is
            // what actually distinguishes the two, not presence of a name.
            let head = repo.head().ok();
            let branch = head
                .as_ref()
                .filter(|h| h.is_branch())
                .and_then(|h| h.shorthand().map(str::to_string));
            let head_oid = head
                .and_then(|h| h.peel_to_commit().ok())
                .map(|c| c.id().to_string());
            Ok(HeadInfo { branch, head_oid })
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

    fn save_resolution(&self, repo_id: &RepoId, path: &Path, content: &str) -> AppResult<()> {
        // Defense-in-depth: this op writes ARBITRARY content, so refuse any
        // path that could escape the workdir before touching the filesystem.
        // Paths are git-derived today, but a write sink should validate anyway.
        // Reject absolute paths and any Prefix/RootDir/ParentDir component: a
        // Windows driveless-rooted path like `\evil` is NOT `is_absolute()`,
        // yet `workdir.join(it)` would replace everything after the drive
        // prefix (PathBuf::push semantics) and escape the tree — the RootDir
        // component catches it.
        if path.is_absolute()
            || path.components().any(|c| {
                matches!(
                    c,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(AppError::InvalidPath(path.display().to_string()));
        }
        self.with_repo(repo_id, |repo| {
            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::InvalidPath("bare repository".into()))?;
            std::fs::write(workdir.join(path), content)
                .map_err(|e| AppError::Io(e.to_string()))?;
            let mut index = repo.index()?;
            // remove_path drops all three conflict stages; add_path re-inserts
            // the just-written worktree version as stage 0 (same dance as
            // mark_resolved).
            let _ = index.remove_path(path);
            index.add_path(path)?;
            index.write()?;
            Ok(())
        })
    }

    fn abort_operation(&self, repo_id: &RepoId) -> AppResult<()> {
        // The operation bar and the palette both land here. When the paused
        // operation is one of our rebases, hand it to the engine that owns it:
        // `rebase_abort` puts HEAD back on the branch and sweeps the state file,
        // while a plain hard reset here would leave both to guesswork — and
        // would leave the on-disk state behind, so `rebase_status` would keep
        // reporting a rebase that is over.
        if self.rebase_in_progress(repo_id)? {
            return self.rebase_abort(repo_id);
        }

        // A rebase GIT owns on disk — `rebase_onto` shells out to `git rebase`,
        // and the user may also have started one in a terminal — is restored by
        // `git rebase --abort`, which puts HEAD back on the pre-rebase branch
        // tip. The reset below cannot: mid-rebase HEAD is wherever the rebase
        // stopped, so it would leave a detached, half-rebased branch.
        if self.cli_rebase_in_progress(repo_id)? {
            return self.run_rebase_flag(repo_id, "--abort");
        }

        self.with_repo(repo_id, |repo| {
            let target = match repo.head() {
                Ok(h) => h.peel_to_commit()?,
                Err(_) => return Err(AppError::Unborn),
            };
            repo.reset(target.as_object(), git2::ResetType::Hard, None)?;
            repo.cleanup_state()?;
            Ok(())
        })
    }

    fn continue_operation(&self, repo_id: &RepoId) -> AppResult<String> {
        // Same convergence as `abort_operation`: committing the resolved tree
        // here would advance nothing and strand the rest of the plan, so a
        // rebase in progress goes to the engine that owns the plan.
        if self.rebase_in_progress(repo_id)? {
            self.rebase_continue(repo_id)?;
            return self.with_repo(repo_id, |repo| {
                Ok(repo.head()?.peel_to_commit()?.id().to_string())
            });
        }

        // Checked before the branch below so both remaining paths refuse with
        // the same variant the frontend narrows on, rather than git's prose for
        // one and ours for the other.
        self.with_repo(repo_id, |repo| {
            let statuses = repo.statuses(None)?;
            if statuses.iter().any(|s| s.status().is_conflicted()) {
                return Err(AppError::ConflictsDetected(
                    "some files still have unresolved conflicts".into(),
                ));
            }
            Ok(())
        })?;

        // A rebase git owns on disk is advanced by `git rebase --continue`,
        // which commits the resolved step and then applies the ones still
        // queued. The generic commit below would finish the current step and
        // throw the rest of the plan away.
        if self.cli_rebase_in_progress(repo_id)? {
            self.run_rebase_flag(repo_id, "--continue")?;
            return self
                .with_repo(repo_id, |repo| Ok(repo.head()?.peel_to_commit()?.id().to_string()));
        }

        self.with_repo(repo_id, |repo| {
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

    fn file_history(
        &self,
        repo_id: &RepoId,
        path: &Path,
        limit: usize,
    ) -> AppResult<Vec<CommitInfo>> {
        self.with_repo(repo_id, |repo| {
            // Without this the walk runs to completion and returns 0 commits —
            // indistinguishable from a file that genuinely has no history.
            reject_embedded_repo(repo, path)?;
            let mut revwalk = repo.revwalk()?;
            revwalk.push_head().or_else(|e| {
                if e.code() == git2::ErrorCode::UnbornBranch {
                    Err(AppError::Unborn)
                } else {
                    Err(e.into())
                }
            })?;
            revwalk.set_sorting(git2::Sort::TIME | git2::Sort::TOPOLOGICAL)?;

            let mut out = Vec::with_capacity(limit);
            for oid_res in revwalk {
                if out.len() >= limit {
                    break;
                }
                let oid = oid_res?;
                let commit = repo.find_commit(oid)?;
                if commit_touches_path(repo, &commit, path)? {
                    out.push(commit_to_info(&commit));
                }
            }
            Ok(out)
        })
    }

    fn append_gitignore(&self, repo_id: &RepoId, pattern: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let workdir = repo
                .workdir()
                .ok_or_else(|| AppError::Git("bare repo has no worktree".into()))?;
            let gitignore = workdir.join(".gitignore");
            let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
            if existing.lines().any(|l| l.trim() == pattern) {
                return Ok(());
            }
            let needs_nl = !existing.is_empty() && !existing.ends_with('\n');
            let mut next = existing;
            if needs_nl {
                next.push('\n');
            }
            next.push_str(pattern);
            next.push('\n');
            std::fs::write(&gitignore, next)?;
            Ok(())
        })
    }

    /// See the trait docs and `git/blame.rs`: libgit2 in the common case, real
    /// git the moment the repository configures an ignore-revs file.
    fn blame_file(
        &self,
        repo_id: &RepoId,
        path: &Path,
        ignore_revs: bool,
    ) -> AppResult<BlameResult> {
        let settings = self.with_repo(repo_id, |repo| {
            // Without this libgit2 answers with a cryptic
            // "path 'vendor' does not exist in the given tree".
            reject_embedded_repo(repo, path)?;
            Ok(crate::git::blame::read_settings(repo))
        })?;

        let mut result = BlameResult {
            lines: Vec::new(),
            ignore_revs_file: settings.ignore_revs_file.clone(),
            ignore_revs_applied: false,
            mark_ignored_lines: settings.mark_ignored_lines,
            mark_unblamable_lines: settings.mark_unblamable_lines,
            ignore_revs_error: None,
        };

        // No ignore-revs file: nothing to ignore, nothing to shell out for.
        // This is the overwhelmingly common case and it must stay in-process.
        let Some(raw) = settings.ignore_revs_file.as_deref() else {
            result.lines = self.blame_with_libgit2(repo_id, path)?;
            return Ok(result);
        };

        let workdir = self.repo_path(repo_id)?;
        let resolved = crate::git::blame::resolve_ignore_revs_path(
            &workdir,
            crate::git::blame::home_dir().as_deref(),
            raw,
        );
        if !resolved.is_file() {
            // `git blame` DIES here ("could not open object name list"), and a
            // missing file is an ordinary state — a config that arrived through
            // an include, a template, or a branch where the file does not exist
            // yet. Losing the whole Blame screen over it would be absurd, so
            // this degrades to the plain blame with the reason attached.
            result.ignore_revs_error = Some(format!(
                "blame.ignoreRevsFile points at {raw}, which is not a readable file —                  ignoring it and blaming normally"
            ));
            result.lines = self.blame_with_libgit2(repo_id, path)?;
            return Ok(result);
        }

        let mut args: Vec<String> = crate::git::blame::blame_args(ignore_revs)
            .into_iter()
            .map(String::from)
            .collect();
        // The one user-supplied value in this argv, and it goes after `--`.
        args.push(path.to_string_lossy().to_string());

        match run_git_capture(&workdir, &args) {
            Ok(stdout) => {
                result.lines = crate::git::blame::parse_porcelain(&stdout);
                result.ignore_revs_applied = ignore_revs;
                Ok(result)
            }
            Err(detail) => {
                // git refuses the whole run for a malformed ignore list or an
                // object name it cannot peel to a commit. Same contract as the
                // missing file: a warning beside a working blame.
                result.ignore_revs_error = Some(detail);
                result.lines = self.blame_with_libgit2(repo_id, path)?;
                Ok(result)
            }
        }
    }

    fn commit_notes(&self, repo_id: &RepoId, oid: &str) -> AppResult<Vec<CommitNote>> {
        self.with_repo(repo_id, |repo| {
            let id = repo
                .revparse_single(oid)
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?
                .peel_to_commit()
                .map_err(|_| AppError::InvalidRef(oid.to_string()))?
                .id();
            crate::git::notes::read(repo, id)
        })
    }

    // ─── Submodules (#93) ─────────────────────────────────────────────────────

    fn submodules(&self, repo_id: &RepoId) -> AppResult<Vec<SubmoduleInfo>> {
        self.with_repo(repo_id, crate::git::submodule::list)
    }

    fn submodule_init(&self, repo_id: &RepoId, path: Option<&str>) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            for mut sm in repo.submodules()? {
                if !submodule_matches(&sm, path) {
                    continue;
                }
                // `overwrite: false` — an existing `submodule.<name>.url` in
                // `.git/config` is a deliberate local override (a mirror, an SSH
                // rewrite), and `git submodule init` leaves it alone too.
                sm.init(false)?;
            }
            Ok(())
        })
    }

    fn submodule_sync(&self, repo_id: &RepoId, path: Option<&str>) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            for mut sm in repo.submodules()? {
                if !submodule_matches(&sm, path) {
                    continue;
                }
                sm.sync()?;
            }
            Ok(())
        })
    }

    fn submodule_update(
        &self,
        repo_id: &RepoId,
        path: Option<&str>,
        recursive: bool,
        init: bool,
    ) -> AppResult<()> {
        let workdir = self.repo_path(repo_id)?;
        let args = crate::git::submodule::update_args(path, recursive, init);
        // Prompt-less, like every other first-attempt network op: no tty here, so
        // an authenticating submodule remote would otherwise hang on an invisible
        // prompt. The failure is classified through the shared auth mapper, so a
        // credential-needing remote raises `Auth` and the command layer's retry
        // (with the askpass shim) is the one that can answer it.
        run_git_capture(&workdir, &args)
            .map(|_| ())
            .map_err(|stderr| crate::commands::net::map_git_failure(&stderr))
    }

    // ─── Linked worktrees (#93) ───────────────────────────────────────────────

    fn worktrees(&self, repo_id: &RepoId) -> AppResult<Vec<WorktreeInfo>> {
        self.with_repo(repo_id, |repo| {
            let current = repo.workdir().map(|p| p.to_path_buf());
            let names = repo.worktrees()?;
            let mut out = Vec::new();
            for name in names.iter().flatten() {
                // One unreadable worktree must not take the whole list with it.
                if let Ok(info) = crate::git::worktree::info(repo, name, current.as_deref()) {
                    out.push(info);
                }
            }
            out.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(out)
        })
    }

    fn worktree_add(
        &self,
        repo_id: &RepoId,
        path: &Path,
        branch: WorktreeBranch,
    ) -> AppResult<WorktreeInfo> {
        let name = crate::git::worktree::name_for_path(path)?;
        if path.exists() {
            return Err(AppError::InvalidArgument(format!(
                "{} already exists",
                path.display()
            )));
        }
        self.with_repo(repo_id, |repo| {
            // The branch is resolved to a real reference in BOTH modes, rather
            // than relying on libgit2's reference-less default: that default
            // creates a branch named after the WORKTREE, which would silently
            // ignore the name the user typed.
            let reference = match &branch {
                WorktreeBranch::New(b) => {
                    let head = repo.head()?.peel_to_commit()?;
                    repo.branch(b, &head, false)
                        .map_err(|e| {
                            AppError::InvalidArgument(format!("branch {b}: {}", e.message()))
                        })?
                        .into_reference()
                }
                WorktreeBranch::Existing(b) => repo
                    .find_branch(b, BranchType::Local)
                    .map_err(|_| AppError::InvalidRef(b.clone()))?
                    .into_reference(),
            };
            let mut opts = git2::WorktreeAddOptions::new();
            opts.reference(Some(&reference));
            repo.worktree(&name, path, Some(&opts))?;
            Ok(())
        })?;
        self.with_repo(repo_id, |repo| {
            let current = repo.workdir().map(|p| p.to_path_buf());
            crate::git::worktree::info(repo, &name, current.as_deref())
        })
    }

    fn worktree_remove(&self, repo_id: &RepoId, name: &str, force: bool) -> AppResult<()> {
        let workdir = self.repo_path(repo_id)?;
        // git takes the PATH, and resolving it here also refuses an unknown name
        // before anything is spawned.
        let target = self.with_repo(repo_id, |repo| {
            Ok(repo
                .find_worktree(name)
                .map_err(|_| AppError::InvalidArgument(format!("no such worktree: {name}")))?
                .path()
                .to_string_lossy()
                .to_string())
        })?;
        let args = crate::git::worktree::remove_args(&target, force);
        run_git_capture(&workdir, &args)
            .map(|_| ())
            .map_err(|stderr| crate::git::worktree::classify_remove_failure(&target, &stderr))
    }

    fn worktree_lock(&self, repo_id: &RepoId, name: &str, reason: Option<&str>) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let wt = repo
                .find_worktree(name)
                .map_err(|_| AppError::InvalidArgument(format!("no such worktree: {name}")))?;
            wt.lock(reason)?;
            Ok(())
        })
    }

    fn worktree_unlock(&self, repo_id: &RepoId, name: &str) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            let wt = repo
                .find_worktree(name)
                .map_err(|_| AppError::InvalidArgument(format!("no such worktree: {name}")))?;
            wt.unlock()?;
            Ok(())
        })
    }

    fn worktree_prune(&self, repo_id: &RepoId) -> AppResult<Vec<String>> {
        self.with_repo(repo_id, |repo| {
            let names = repo.worktrees()?;
            let mut pruned = Vec::new();
            for name in names.iter().flatten() {
                let Ok(wt) = repo.find_worktree(name) else {
                    continue;
                };
                // Default options ARE `git worktree prune`'s: only invalid, only
                // unlocked, and never deleting a working tree. libgit2 reports
                // "not prunable" as an Err carrying the reason, so treat any
                // failure as "leave it alone".
                if wt.is_prunable(None).unwrap_or(false) && wt.prune(None).is_ok() {
                    pruned.push(name.to_string());
                }
            }
            Ok(pruned)
        })
    }

    // ─── git-LFS (#93) ────────────────────────────────────────────────────────

    fn lfs_status(&self, repo_id: &RepoId) -> AppResult<LfsStatus> {
        let (patterns, has_lfs_dir) = self.with_repo(repo_id, |repo| {
            Ok((
                crate::git::lfs::declared_patterns(repo),
                repo.path().join("lfs").is_dir(),
            ))
        })?;
        let workdir = self.repo_path(repo_id)?;
        let version = crate::git::lfs::version(&workdir);
        let installed = version.is_some();
        // A repository with objects already in `.git/lfs` uses LFS even if its
        // attributes live somewhere this scan does not reach (a global
        // `core.attributesFile`, say) — so the panel does not claim "not in use"
        // while sitting on a pile of LFS objects.
        let in_use = !patterns.is_empty() || has_lfs_dir;
        let files = if installed {
            run_git_capture(&workdir, &["lfs".to_string(), "ls-files".to_string()])
                .map(|out| crate::git::lfs::parse_ls_files(&out))
                // A repo whose LFS objects are unreadable still has a valid
                // status; the file list is the optional part.
                .unwrap_or_default()
        } else {
            Vec::new()
        };
        Ok(LfsStatus {
            installed,
            version,
            in_use,
            patterns,
            files,
        })
    }

    fn lfs_checkout(&self, repo_id: &RepoId) -> AppResult<()> {
        let workdir = self.repo_path(repo_id)?;
        crate::git::lfs::require(&workdir)?;
        run_git_capture(&workdir, &["lfs".to_string(), "checkout".to_string()])
            .map(|_| ())
            .map_err(|stderr| AppError::Git(format!("git lfs checkout: {}", stderr.trim())))
    }

    // ─── Bisect (#93) ─────────────────────────────────────────────────────────

    fn bisect_status(&self, repo_id: &RepoId) -> AppResult<BisectStatus> {
        self.with_repo(repo_id, crate::git::bisect::status)
    }

    fn bisect_start(
        &self,
        repo_id: &RepoId,
        bad: &str,
        good: &[String],
    ) -> AppResult<BisectStatus> {
        // Resolve every revspec to a full oid BEFORE it reaches argv: an
        // unresolvable rev becomes `InvalidRef` instead of a git error, and a
        // caller string can never arrive as something git reads as an option.
        let (bad_oid, good_oids) = self.with_repo(repo_id, |repo| {
            let bad_oid = crate::git::bisect::resolve(repo, bad)?;
            let good_oids = good
                .iter()
                .map(|g| crate::git::bisect::resolve(repo, g))
                .collect::<AppResult<Vec<_>>>()?;
            Ok((bad_oid, good_oids))
        })?;
        let workdir = self.repo_path(repo_id)?;
        let mut args = vec!["start".to_string(), bad_oid];
        args.extend(good_oids);
        crate::git::bisect::run(&workdir, &args)?;
        self.bisect_status(repo_id)
    }

    fn bisect_mark(
        &self,
        repo_id: &RepoId,
        mark: BisectMark,
        rev: Option<&str>,
    ) -> AppResult<BisectStatus> {
        let (word, rev_oid) = self.with_repo(repo_id, |repo| {
            if !crate::git::bisect::in_progress(repo) {
                return Err(AppError::NoBisect);
            }
            let (bad_term, good_term) = crate::git::bisect::terms(repo);
            let word = crate::git::bisect::mark_word(mark, &bad_term, &good_term);
            let rev_oid = match rev {
                Some(r) => Some(crate::git::bisect::resolve(repo, r)?),
                None => None,
            };
            Ok((word, rev_oid))
        })?;
        let workdir = self.repo_path(repo_id)?;
        let mut args = vec![word];
        args.extend(rev_oid);
        crate::git::bisect::run(&workdir, &args)?;
        self.bisect_status(repo_id)
    }

    fn bisect_reset(&self, repo_id: &RepoId) -> AppResult<()> {
        self.with_repo(repo_id, |repo| {
            if !crate::git::bisect::in_progress(repo) {
                return Err(AppError::NoBisect);
            }
            Ok(())
        })?;
        let workdir = self.repo_path(repo_id)?;
        crate::git::bisect::run(&workdir, &["reset".to_string()]).map(|_| ())
    }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/// Does this submodule match a `None` ("all") or `Some(path)` selector?
///
/// Path, not name: the frontend addresses submodules by the worktree path it
/// displays, and the two differ whenever `.gitmodules` names a section something
/// other than its path.
fn submodule_matches(sm: &git2::Submodule<'_>, path: Option<&str>) -> bool {
    match path {
        None => true,
        Some(p) => sm.path().to_string_lossy() == p,
    }
}

/// Run `git -C <workdir> <args…>` prompt-less, returning stdout.
///
/// On failure returns whichever stream spoke — git writes some refusals to stdout
/// — so a caller's classifier always has something to match on.
///
/// Sync + `std::process::Command` on purpose: every caller is already inside
/// `spawn_blocking` (commands wrap the whole backend call), which is the same shape
/// `run_rebase_flag` uses.
fn run_git_capture(workdir: &Path, args: &[String]) -> Result<String, String> {
    run_git_capture_env(workdir, args, &[])
}

/// `run_git_capture` with extra environment.
///
/// Split out rather than folded into the shared runner because the only caller
/// that needs it is the pathspec-passing one (`GIT_LITERAL_PATHSPECS`), and
/// turning pathspec magic off globally would change what every OTHER shell-out
/// means without anyone asking for it.
fn run_git_capture_env(
    workdir: &Path,
    args: &[String],
    env: &[(&str, &str)],
) -> Result<String, String> {
    // No tty: `proc::git` supplies GIT_TERMINAL_PROMPT=0 and a closed stdin, so
    // an auth-requiring remote fails fast instead of hanging forever on a prompt
    // nobody can see. The askpass pair is this runner's own addition — a helper
    // that would otherwise pop its own UI must fail instead.
    let mut cmd = crate::proc::git(workdir);
    cmd.args(args);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = cmd
        .env("GIT_ASKPASS", "true")
        .env("SSH_ASKPASS", "true")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        } else {
            stderr
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// Build a `CommitInfo` from a git2 commit. The `refs` field is left empty;
/// callers that need ref labels (e.g. `log`) fill it in separately.
/// Does `oid`'s lowercase hex spelling start with `prefix`? Allocation-free
/// equivalent of `oid.to_string().starts_with(prefix)` for an already
/// lowercased prefix (the filter lowercases its query once, up front).
fn oid_has_hex_prefix(oid: &git2::Oid, prefix: &str) -> bool {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = oid.as_bytes();
    for (i, pc) in prefix.bytes().enumerate() {
        if i / 2 >= bytes.len() {
            return false;
        }
        let b = bytes[i / 2];
        let nibble = if i % 2 == 0 { b >> 4 } else { b & 0xf };
        if pc != HEX[nibble as usize] {
            return false;
        }
    }
    true
}

fn commit_to_info(commit: &git2::Commit<'_>) -> CommitInfo {
    // Runs once per row, 500 rows per page: stringify the oid once and derive
    // `body` from the borrowed message instead of allocating the whole message
    // only to slice it.
    let oid = commit.id().to_string();
    let short_oid = oid[..7].to_string();
    let summary = commit.summary().unwrap_or("").to_string();
    let body = commit
        .message()
        .unwrap_or("")
        .split_once("\n\n")
        .map(|(_, rest)| rest.trim_end().to_string())
        .filter(|s| !s.is_empty());
    let author = commit.author();
    CommitInfo {
        oid,
        short_oid,
        summary,
        body,
        author: author.name().unwrap_or("").to_string(),
        email: author.email().unwrap_or("").to_string(),
        timestamp: commit.time().seconds(),
        parents: commit.parent_ids().map(|p| p.to_string()).collect(),
        refs: Vec::new(),
    }
}

/// Return `true` if `commit` touched `path` relative to any of its parents.
/// For a root commit (no parents) the path simply has to exist in the tree.
/// True if `commit` affected `path`.
///
/// For a root commit (no parents), matches if the path exists in the commit's
/// tree. For a commit with parents, matches if the commit's tree differs from
/// *any* parent for that path. This is broader than `git log -- <path>`'s
/// first-parent simplification: a merge commit matches when it changed the path
/// relative to any of its parents, not just the first. Intentional for a GUI —
/// "did this commit touch the path" is the more useful question here.
/// Compiled content predicate: literal substring or regex (#61 D10).
enum ContentMatcher {
    Literal(String),
    Regex(regex::Regex),
}

impl ContentMatcher {
    fn is_match(&self, line: &str) -> bool {
        match self {
            ContentMatcher::Literal(s) => line.contains(s.as_str()),
            ContentMatcher::Regex(re) => re.is_match(line),
        }
    }
}

/// True when `commit` added or removed a line matching `matcher` — git's `-G`.
///
/// Compared against the FIRST parent only, matching git's default `-G`
/// behaviour on merges; a root commit is compared against an empty tree.
/// `path` restricts the diff via pathspec when a path filter is active, so
/// content and path intersect rather than union.
fn commit_diff_matches_content(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    matcher: &ContentMatcher,
    path: Option<&std::path::Path>,
) -> AppResult<bool> {
    let commit_tree = commit.tree()?;
    let parent_tree = match commit.parent(0) {
        Ok(p) => Some(p.tree()?),
        Err(_) => None,
    };

    let mut opts = git2::DiffOptions::new();
    if let Some(p) = path {
        opts.pathspec(p);
    }
    let diff =
        repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), Some(&mut opts))?;

    let mut hit = false;
    diff.foreach(
        &mut |_, _| true,
        None,
        None,
        Some(&mut |_delta, _hunk, line| {
            // Added / removed lines only — a context line was not touched.
            if matches!(line.origin(), '+' | '-') {
                if let Ok(text) = std::str::from_utf8(line.content()) {
                    if matcher.is_match(text) {
                        hit = true;
                    }
                }
            }
            // Keep walking: `foreach` has no early exit, and returning false
            // aborts the whole diff as an error rather than short-circuiting.
            true
        }),
    )?;
    Ok(hit)
}

fn commit_touches_path(
    repo: &git2::Repository,
    commit: &git2::Commit<'_>,
    path: &std::path::Path,
) -> AppResult<bool> {
    let commit_tree = commit.tree()?;
    if commit.parent_count() == 0 {
        return Ok(commit_tree.get_path(path).is_ok());
    }
    // Fast path for a literal path (no pathspec magic — which is what
    // file_history always passes, and what the History path filter usually
    // holds): look the entry up in each tree and compare (oid, filemode).
    // Exactly equivalent to the diff for a concrete file or directory — a
    // directory's tree oid differs iff anything beneath it differs, and a
    // filemode-only change differs in the mode — but with no per-parent
    // whole-tree diff, which made file_history O(commits × tree size).
    // A trailing slash also takes the slow path: the pathspec's leading-dir
    // rule accepts "src/", tree lookup spells it "src".
    let literal = path
        .to_str()
        .map(|s| !s.contains(['*', '?', '[', '\\']) && !s.ends_with('/'))
        .unwrap_or(false);
    if literal {
        let ours = commit_tree
            .get_path(path)
            .ok()
            .map(|e| (e.id(), e.filemode()));
        for i in 0..commit.parent_count() {
            let parent_tree = commit.parent(i)?.tree()?;
            let theirs = parent_tree
                .get_path(path)
                .ok()
                .map(|e| (e.id(), e.filemode()));
            if ours != theirs {
                return Ok(true);
            }
        }
        return Ok(false);
    }
    for i in 0..commit.parent_count() {
        let parent = commit.parent(i)?;
        let parent_tree = parent.tree()?;
        let mut opts = git2::DiffOptions::new();
        opts.pathspec(path);
        let diff = repo.diff_tree_to_tree(
            Some(&parent_tree),
            Some(&commit_tree),
            Some(&mut opts),
        )?;
        if diff.deltas().len() > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}
