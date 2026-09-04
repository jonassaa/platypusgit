//! Filesystem watching, so the working copy is live rather than stale (#239).
//!
//! You save a file in your editor, tab back, and the status is already right.
//! Before this the app was only correct if you remembered to refresh: the sole
//! self-starting refresh was the auto-fetch timer, which is a *network* fetch on
//! a minutes-scale interval and does not run at all when auto-fetch is off.
//!
//! ## The shape
//!
//! One watcher at a time, on the ACTIVE repository, started by `watch_repo` and
//! replaced (not stacked) by the next call. Events are debounced, classified,
//! filtered against the repository's ignore rules, and emitted as a single
//! [`FsChange`] carrying the `repoId` they came from.
//!
//! Both halves of the multi-repo guard are in place on purpose, because they
//! fail differently: watching only the active repo keeps N-1 watchers off the
//! filesystem, and tagging the event lets the frontend drop one that arrives
//! after a tab switch — a race a single-slot watcher alone cannot close, since
//! an event can already be in flight when the slot is swapped.
//!
//! ## Why the ignore check does not take the per-repo mutex
//!
//! The issue asked for `spawn_blocking` behind the shared mutex, and the
//! constraint it was protecting — `git2::Repository` is `Send` but not `Sync` —
//! is real. This module satisfies it differently: the watcher owns its OWN
//! `Repository`, opened once on the debouncer's thread and never shared, so the
//! handle never crosses threads and the `Sync` question never arises.
//!
//! Taking the shared mutex would have been worse for the case that matters
//! most. A rebase or a merge holds that mutex while producing exactly the event
//! storm this module has to filter, so the watcher would queue behind the
//! operation, wake up when it finished, and do its work twice — once for the
//! storm and once for the completion refresh the operation already triggers.
//! Worse, on a slow filesystem (a `/mnt/c` repository under WSL) it would add
//! ignore-rule reads to a mutex that is already the bottleneck. Two independent
//! libgit2 handles on one repository are ordinary — git is built for concurrent
//! processes — and this one only ever asks read-only questions.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};

/// The event the frontend listens for. Named like `net://progress` and
/// `rebase://progress`, and subscribed the same way: once, app-global, with the
/// payload's `repoId` deciding whether it applies.
pub const FS_CHANGED_EVENT: &str = "fs://changed";

/// How long the debouncer coalesces before reporting.
///
/// Long enough that `git checkout` on a large tree reports once rather than per
/// file, short enough that saving in an editor feels immediate. The number is a
/// judgement, but the ORDER matters: below ~100ms a single `git status` run
/// produces multiple batches, and above ~1s the feature stops feeling live.
const DEBOUNCE: Duration = Duration::from_millis(400);

/// How many paths one batch will run ignore checks on.
///
/// A `cargo build` or an `npm install` can touch tens of thousands of files. We
/// only need to know WHETHER anything relevant changed, so the check stops at
/// the first path that is not ignored; this cap bounds the opposite case, where
/// everything IS ignored and the honest answer costs one `is_path_ignored` per
/// file. Past the cap the batch is treated as relevant — a spurious refresh is
/// cheap, a stalled watcher thread is not.
const MAX_IGNORE_CHECKS: usize = 512;

/// What one changed path means for the UI.
///
/// The distinction that earns its keep is `Ref` vs `Worktree`: a status refresh
/// is cheap and a log refresh is not, so a file save must not repaint history.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathKind {
    /// Inside the gitdir and not interesting — refresh nothing.
    Noise,
    /// A ref moved: `HEAD`, `refs/**`, `packed-refs`. The graph and the HEAD
    /// marks are now wrong.
    Ref,
    /// Repository state changed without a ref moving: the index, or an
    /// in-progress merge/rebase/cherry-pick marker.
    State,
    /// An ordinary working-copy file.
    Worktree,
}

/// What the frontend is told. One event per debounce batch, never per file.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsChange {
    /// Which repository this is about. The frontend drops anything that is not
    /// the active tab's — see the module note on the two-part guard.
    pub repo_id: String,
    /// Whether a ref moved, so the log and branch list need re-reading too.
    /// `false` means a status refresh is enough.
    pub refs_moved: bool,
}

/// Classify a path inside a gitdir, given the path relative to that gitdir.
///
/// Everything not named here is `Noise`, and that direction is deliberate:
/// `objects/`, `logs/`, `COMMIT_EDITMSG`, `FETCH_HEAD` and the rest change
/// constantly and tell the UI nothing it does not already learn from `refs/`
/// or the index.
pub fn classify_git_entry(rel: &Path) -> PathKind {
    let s = rel.to_string_lossy().replace('\\', "/");

    // A `.lock` file is git STARTING to work, not git having worked — and it is
    // removed again a moment later, so honouring it would double every event
    // and fire the first one while the index is mid-write.
    if s.ends_with(".lock") {
        return PathKind::Noise;
    }

    if s == "HEAD" || s == "packed-refs" || s.starts_with("refs/") {
        return PathKind::Ref;
    }

    if s == "index" {
        return PathKind::State;
    }

    // An operation is in progress or has just ended. The working copy and the
    // repository's state both changed even though no ref has moved yet.
    const STATE_FILES: [&str; 6] = [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "REBASE_HEAD",
        "BISECT_LOG",
        "MERGE_MSG",
    ];
    if STATE_FILES.contains(&s.as_str())
        || s.starts_with("rebase-merge/")
        || s.starts_with("rebase-apply/")
        || s.starts_with("sequencer/")
    {
        return PathKind::State;
    }

    PathKind::Noise
}

/// Classify an absolute path against a repository's gitdir and common dir.
///
/// Both, because they differ in a linked worktree: `HEAD` and `index` live in
/// the worktree's own gitdir while `refs/` lives in the shared common dir. A
/// classifier that knew only one of them would miss half the ref moves in every
/// worktree — and this app creates worktrees, so that is not a hypothetical.
pub fn classify(path: &Path, gitdir: &Path, commondir: &Path) -> PathKind {
    if let Ok(rel) = path.strip_prefix(gitdir) {
        return classify_git_entry(rel);
    }
    if let Ok(rel) = path.strip_prefix(commondir) {
        return classify_git_entry(rel);
    }
    PathKind::Worktree
}

/// Fold a batch of classified paths into the one event to emit, or `None` when
/// nothing in the batch was worth waking the UI for.
pub fn summarize(repo_id: &str, kinds: &[PathKind]) -> Option<FsChange> {
    let mut relevant = false;
    let mut refs_moved = false;
    for kind in kinds {
        match kind {
            PathKind::Noise => {}
            PathKind::Ref => {
                relevant = true;
                refs_moved = true;
            }
            PathKind::State | PathKind::Worktree => relevant = true,
        }
    }
    relevant.then(|| FsChange {
        repo_id: repo_id.to_string(),
        refs_moved,
    })
}

/// The live watchers — **one slot per window** (#256).
///
/// Only the active tab's repository is watched, so within a window a second
/// `watch_repo` REPLACES rather than adds, and dropping the previous
/// `Debouncer` is what unregisters it from the OS. That was a single global
/// slot until multiple windows existed, at which point it became a bug you
/// could not see: window B's `watch_repo` evicted window A's watcher, and A
/// went quietly back to being stale — the exact failure this module was written
/// to remove, restored by the second window.
///
/// Keyed by window LABEL rather than by `RepoId` because the invariant is
/// per-window ("the active tab's repository"), and because a window that goes
/// away has to be able to stop its watch without knowing which repository it
/// ended up on (`windows::on_window_destroyed`).
///
/// The `FsChange` payload is unchanged: it still carries the `repoId` it came
/// from, and events are still app-global, so the frontend's "drop an event that
/// arrived after a tab switch" filter keeps working per window without knowing
/// this map exists.
#[derive(Default)]
pub struct WatchState {
    active: Mutex<HashMap<String, Active>>,
}

struct Active {
    repo_id: String,
    /// Held only to keep the watch alive; dropping it stops the watcher.
    _debouncer: Debouncer<RecommendedWatcher>,
}

impl WatchState {
    /// Which repository `label` is watching, if any. For tests and diagnostics.
    pub fn watching(&self, label: &str) -> Option<String> {
        self.active
            .lock()
            .ok()
            .and_then(|g| g.get(label).map(|a| a.repo_id.clone()))
    }

    /// How many windows are watching. Tests and diagnostics.
    pub fn watch_count(&self) -> usize {
        self.active.lock().map(|g| g.len()).unwrap_or(0)
    }

    /// Stop `label`'s watch. Idempotent — the frontend calls this on a setting
    /// change without knowing whether anything was running, and
    /// `windows::on_window_destroyed` calls it for a window that may never have
    /// watched anything.
    pub fn stop(&self, label: &str) {
        if let Ok(mut guard) = self.active.lock() {
            guard.remove(label);
        }
    }

    /// Watch `workdir` for `label`, replacing that window's existing watch.
    ///
    /// The previous watcher is dropped BEFORE the new one is registered, so one
    /// window never holds the same directory twice — on macOS that would double
    /// every event for as long as both lived. Two DIFFERENT windows watching one
    /// directory is a separate matter and is allowed: each needs its own events,
    /// and each filters them by its own `repoId`.
    pub fn start(
        &self,
        app: AppHandle,
        label: String,
        repo_id: String,
        workdir: PathBuf,
    ) -> AppResult<()> {
        let repo = git2::Repository::open(&workdir)?;
        let gitdir = repo.path().to_path_buf();
        let commondir = repo.commondir().to_path_buf();

        let mut guard = self
            .active
            .lock()
            .map_err(|_| AppError::Internal("watch state poisoned".to_string()))?;
        // Drop this window's old one first — see the doc comment.
        guard.remove(&label);

        let handler = Handler {
            app,
            repo_id: repo_id.clone(),
            workdir: workdir.clone(),
            gitdir,
            commondir,
            repo: Some(repo),
        };
        let mut debouncer = new_debouncer(DEBOUNCE, handler)
            .map_err(|e| AppError::Io(format!("could not start a filesystem watcher: {e}")))?;
        debouncer
            .watcher()
            .watch(&workdir, RecursiveMode::Recursive)
            .map_err(|e| AppError::Io(format!("could not watch {}: {e}", workdir.display())))?;

        guard.insert(
            label,
            Active {
                repo_id,
                _debouncer: debouncer,
            },
        );
        Ok(())
    }
}

/// The debounce callback's state.
///
/// Lives on the debouncer's own thread for the life of the watch, which is what
/// makes holding a `git2::Repository` here sound — see the module note. It is
/// `Option` so a repository that disappears out from under the watcher (deleted,
/// moved, unmounted) degrades to "assume relevant" instead of panicking: the
/// next refresh will surface the real error, with a real message.
struct Handler {
    app: AppHandle,
    repo_id: String,
    workdir: PathBuf,
    gitdir: PathBuf,
    commondir: PathBuf,
    repo: Option<git2::Repository>,
}

impl Handler {
    /// Whether a working-copy path is ignored. Errs toward NOT ignored: a
    /// spurious refresh is a wasted `git status`, a wrongly-suppressed one is
    /// the stale working copy this whole module exists to remove.
    fn is_ignored(&self, path: &Path) -> bool {
        let Some(repo) = self.repo.as_ref() else {
            return false;
        };
        let rel = path.strip_prefix(&self.workdir).unwrap_or(path);
        repo.is_path_ignored(rel).unwrap_or(false)
    }

    fn kinds_for(&self, paths: &[PathBuf]) -> Vec<PathKind> {
        let mut out = Vec::with_capacity(paths.len());
        let mut checked = 0usize;
        for path in paths {
            let kind = classify(path, &self.gitdir, &self.commondir);
            if kind == PathKind::Worktree {
                // Past the cap, stop asking and assume it matters. See
                // MAX_IGNORE_CHECKS.
                if checked < MAX_IGNORE_CHECKS {
                    checked += 1;
                    if self.is_ignored(path) {
                        out.push(PathKind::Noise);
                        continue;
                    }
                }
            }
            out.push(kind);
        }
        out
    }
}

impl notify_debouncer_mini::DebounceEventHandler for Handler {
    fn handle_event(&mut self, result: DebounceEventResult) {
        let events = match result {
            Ok(events) => events,
            Err(e) => {
                // A watch error is not worth a banner — the app is still
                // correct, just no longer live — but it must not be silent
                // either, or "why did it stop updating" has no answer in the log.
                log::warn!("filesystem watcher: {e}");
                return;
            }
        };
        let paths: Vec<PathBuf> = events.into_iter().map(|e| e.path).collect();
        let kinds = self.kinds_for(&paths);
        if let Some(change) = summarize(&self.repo_id, &kinds) {
            let _ = self.app.emit(FS_CHANGED_EVENT, &change);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real `Debouncer` that watches nothing. Cheap, and it keeps `Active`'s
    /// shape honest — the point of these tests is the MAP, and a fake slot type
    /// would stop testing the thing that broke.
    fn idle_active(repo_id: &str) -> Active {
        Active {
            repo_id: repo_id.to_string(),
            _debouncer: new_debouncer(DEBOUNCE, |_: DebounceEventResult| {})
                .expect("a debouncer that watches nothing"),
        }
    }

    fn watching_of(state: &WatchState, label: &str, repo_id: &str) {
        state
            .active
            .lock()
            .unwrap()
            .insert(label.to_string(), idle_active(repo_id));
    }

    #[test]
    fn a_second_window_does_not_evict_the_first_windows_watch() {
        // The bug this map exists for, and one you could not see: with a single
        // global slot, window B's `watch_repo` dropped window A's watcher and A
        // went quietly back to being stale — the exact failure #239 removed,
        // restored by the second window.
        let state = WatchState::default();
        watching_of(&state, "main", "r-api");
        watching_of(&state, "pg-1", "r-web");

        assert_eq!(state.watching("main").as_deref(), Some("r-api"));
        assert_eq!(state.watching("pg-1").as_deref(), Some("r-web"));
        assert_eq!(state.watch_count(), 2);
    }

    #[test]
    fn one_window_still_replaces_its_own_watch_rather_than_stacking() {
        // Within a window the invariant is unchanged: only the ACTIVE tab's
        // repository is watched, so a tab switch needs no matching stop.
        let state = WatchState::default();
        watching_of(&state, "main", "r-api");
        watching_of(&state, "main", "r-web");
        assert_eq!(state.watching("main").as_deref(), Some("r-web"));
        assert_eq!(state.watch_count(), 1);
    }

    #[test]
    fn stopping_one_window_leaves_the_others_watching() {
        let state = WatchState::default();
        watching_of(&state, "main", "r-api");
        watching_of(&state, "pg-1", "r-web");

        state.stop("pg-1");

        assert_eq!(state.watching("pg-1"), None);
        assert_eq!(state.watching("main").as_deref(), Some("r-api"));
    }

    #[test]
    fn stopping_a_window_that_never_watched_anything_is_a_no_op() {
        // `windows::on_window_destroyed` calls this for every window it tears
        // down, and the frontend calls it on a setting change without knowing
        // whether anything was running.
        let state = WatchState::default();
        state.stop("pg-4");
        assert_eq!(state.watch_count(), 0);
    }
}
