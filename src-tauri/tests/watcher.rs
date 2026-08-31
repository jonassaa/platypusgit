//! Which filesystem events are worth waking the UI for (#239).
//!
//! The watcher's whole value is in what it DROPS. A watcher that reports every
//! event is worse than no watcher on a large repository: `cargo build` and
//! `npm install` each touch tens of thousands of ignored files, and every one
//! of them would be a `git status`. So most of this file is negative
//! assertions.
//!
//! The classification is pure, which is why it is tested here rather than
//! through a real watcher: an OS-level watch is timing-dependent, differs per
//! platform, and would test `notify` rather than our rules.

use std::path::{Path, PathBuf};

use platypusgit_lib::watcher::{classify, classify_git_entry, summarize, PathKind};

/// An ordinary repository: gitdir and common dir are the same directory.
const GITDIR: &str = "/repo/.git";

fn kind(abs: &str) -> PathKind {
    classify(Path::new(abs), Path::new(GITDIR), Path::new(GITDIR))
}

fn entry(rel: &str) -> PathKind {
    classify_git_entry(Path::new(rel))
}

// ───────────────────────────────────────────────────────────────────────────
// A ref moved — the log and the HEAD marks are now wrong
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn a_branch_switch_or_a_commit_in_a_terminal_is_a_ref_move() {
    // `git checkout` rewrites HEAD; `git commit` rewrites refs/heads/<branch>.
    // Both have to move the graph, which is the expensive refresh — so these
    // are the only paths allowed to ask for it.
    assert_eq!(entry("HEAD"), PathKind::Ref);
    assert_eq!(entry("refs/heads/main"), PathKind::Ref);
    assert_eq!(entry("refs/remotes/origin/main"), PathKind::Ref);
    assert_eq!(entry("refs/tags/v1.0.0"), PathKind::Ref);
    // `git gc` / `git pack-refs` collapses loose refs into one file. Missing
    // this would leave the graph stale after a gc with no other signal.
    assert_eq!(entry("packed-refs"), PathKind::Ref);
}

// ───────────────────────────────────────────────────────────────────────────
// State changed without a ref moving
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn staging_from_a_terminal_is_a_state_change_not_a_ref_move() {
    // `git add` rewrites the index and nothing else. The file list is wrong,
    // the graph is not — and repainting history on every `git add` is exactly
    // the cost this distinction exists to avoid.
    assert_eq!(entry("index"), PathKind::State);
}

#[test]
fn an_operation_in_progress_is_a_state_change() {
    // These are what make the app show "merging" / "rebasing". A user who
    // starts a rebase in a terminal must not see a tab that still says clean.
    assert_eq!(entry("MERGE_HEAD"), PathKind::State);
    assert_eq!(entry("CHERRY_PICK_HEAD"), PathKind::State);
    assert_eq!(entry("REVERT_HEAD"), PathKind::State);
    assert_eq!(entry("REBASE_HEAD"), PathKind::State);
    assert_eq!(entry("BISECT_LOG"), PathKind::State);
    assert_eq!(entry("MERGE_MSG"), PathKind::State);
    assert_eq!(entry("rebase-merge/done"), PathKind::State);
    assert_eq!(entry("rebase-apply/next"), PathKind::State);
    assert_eq!(entry("sequencer/todo"), PathKind::State);
}

// ───────────────────────────────────────────────────────────────────────────
// Noise — the part that makes the feature usable
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn a_lock_file_is_git_starting_work_not_finishing_it() {
    // `index.lock` appears at the START of nearly every git command and is
    // removed moments later. Honouring it would double every event AND fire
    // the first one while the index is still being written — a refresh reading
    // a half-written index is worse than a late one.
    assert_eq!(entry("index.lock"), PathKind::Noise);
    assert_eq!(entry("HEAD.lock"), PathKind::Noise);
    assert_eq!(entry("refs/heads/main.lock"), PathKind::Noise);
    assert_eq!(entry("packed-refs.lock"), PathKind::Noise);
}

#[test]
fn the_object_database_and_the_reflog_are_noise() {
    // Objects are written before the ref that points at them, so acting on
    // them would refresh to a state no ref names yet. The reflog moves with
    // every ref, so `refs/` already covers everything it would tell us —
    // counting it too would just double the work.
    assert_eq!(entry("objects/ab/cdef0123456789"), PathKind::Noise);
    assert_eq!(entry("objects/pack/pack-abc.pack"), PathKind::Noise);
    assert_eq!(entry("logs/HEAD"), PathKind::Noise);
    assert_eq!(entry("logs/refs/heads/main"), PathKind::Noise);
}

#[test]
fn the_editor_scratch_files_are_noise() {
    // COMMIT_EDITMSG changes on every commit attempt, including abandoned
    // ones. FETCH_HEAD changes on every fetch, which is a network op that
    // already refreshes on completion.
    assert_eq!(entry("COMMIT_EDITMSG"), PathKind::Noise);
    assert_eq!(entry("FETCH_HEAD"), PathKind::Noise);
    assert_eq!(entry("ORIG_HEAD"), PathKind::Noise);
    assert_eq!(entry("config"), PathKind::Noise);
    assert_eq!(entry("hooks/pre-commit.sample"), PathKind::Noise);
}

// ───────────────────────────────────────────────────────────────────────────
// Inside the gitdir vs outside it
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn a_working_copy_file_is_a_worktree_change() {
    assert_eq!(kind("/repo/src/main.rs"), PathKind::Worktree);
    assert_eq!(kind("/repo/README.md"), PathKind::Worktree);
    // A file whose NAME resembles a git one but lives in the worktree is still
    // an ordinary file — the classifier keys on location, not spelling.
    assert_eq!(kind("/repo/HEAD"), PathKind::Worktree);
    assert_eq!(kind("/repo/docs/index"), PathKind::Worktree);
}

#[test]
fn gitdir_paths_are_recognised_through_the_absolute_form() {
    assert_eq!(kind("/repo/.git/HEAD"), PathKind::Ref);
    assert_eq!(kind("/repo/.git/refs/heads/main"), PathKind::Ref);
    assert_eq!(kind("/repo/.git/index"), PathKind::State);
    assert_eq!(kind("/repo/.git/objects/ab/cd"), PathKind::Noise);
}

#[test]
fn a_linked_worktree_is_classified_against_both_directories() {
    // The trap: in a linked worktree HEAD and index live in the worktree's own
    // gitdir (`.git/worktrees/<name>`) while refs live in the SHARED common
    // dir. A classifier that knew only one would miss half of every ref move —
    // and this app creates worktrees, so it is not hypothetical.
    let gitdir = Path::new("/repo/.git/worktrees/feature");
    let commondir = Path::new("/repo/.git");
    let k = |p: &str| classify(Path::new(p), gitdir, commondir);

    assert_eq!(k("/repo/.git/worktrees/feature/HEAD"), PathKind::Ref);
    assert_eq!(k("/repo/.git/worktrees/feature/index"), PathKind::State);
    assert_eq!(k("/repo/.git/refs/heads/feature"), PathKind::Ref);
    assert_eq!(k("/repo/.git/packed-refs"), PathKind::Ref);
    // ...and an ordinary file in the linked worktree's own checkout.
    assert_eq!(k("/worktrees/feature/src/main.rs"), PathKind::Worktree);
}

#[test]
fn the_gitdir_is_matched_before_the_commondir() {
    // They overlap — the gitdir is INSIDE the common dir for a linked worktree
    // — so order decides. Matching commondir first would make
    // `worktrees/feature/HEAD` a relative path of `worktrees/feature/HEAD`,
    // which is Noise, and every branch switch in a worktree would be missed.
    let gitdir = Path::new("/repo/.git/worktrees/feature");
    let commondir = Path::new("/repo/.git");
    assert_eq!(
        classify(
            Path::new("/repo/.git/worktrees/feature/HEAD"),
            gitdir,
            commondir
        ),
        PathKind::Ref,
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Folding a batch into one event
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn a_batch_of_noise_wakes_nothing() {
    // The npm-install case. Every path ignored or uninteresting means no
    // event at all — not an event saying "nothing happened".
    assert_eq!(summarize("r1", &[]), None);
    assert_eq!(
        summarize("r1", &[PathKind::Noise, PathKind::Noise, PathKind::Noise]),
        None
    );
}

#[test]
fn a_file_save_asks_for_a_status_refresh_only() {
    let change = summarize("r1", &[PathKind::Worktree]).expect("an event");
    assert_eq!(change.repo_id, "r1");
    assert!(
        !change.refs_moved,
        "saving a file must not repaint the graph"
    );
}

#[test]
fn one_ref_move_anywhere_in_the_batch_asks_for_the_log_too() {
    // A `git commit` in a terminal writes the index, the objects and the ref.
    // The batch is mixed, and the expensive refresh has to win.
    let change = summarize(
        "r1",
        &[
            PathKind::Noise,
            PathKind::Worktree,
            PathKind::State,
            PathKind::Ref,
        ],
    )
    .expect("an event");
    assert!(change.refs_moved);
}

#[test]
fn state_alone_is_not_a_ref_move() {
    let change = summarize("r1", &[PathKind::State, PathKind::Noise]).expect("an event");
    assert!(!change.refs_moved);
}

#[test]
fn the_event_carries_the_repository_it_came_from() {
    // Half the multi-repo guard. A watch is swapped on tab switch, but an
    // event can already be in flight when that happens — the frontend needs
    // this field to drop it.
    let change = summarize("repo-7", &[PathKind::Worktree]).expect("an event");
    assert_eq!(change.repo_id, "repo-7");
}

#[test]
fn the_event_serialises_as_the_frontend_spells_it() {
    // 1:1 with the TS `FsChange` in src/lib/types.ts.
    let change = summarize("repo-7", &[PathKind::Ref]).expect("an event");
    let json = serde_json::to_string(&change).unwrap();
    assert!(json.contains("\"repoId\":\"repo-7\""), "{json}");
    assert!(json.contains("\"refsMoved\":true"), "{json}");
}

// ───────────────────────────────────────────────────────────────────────────
// The real thing, against a real repository
// ───────────────────────────────────────────────────────────────────────────

#[test]
fn a_real_repository_reports_its_gitdir_and_commondir() {
    // The classifier is only correct if the two paths it is handed are the
    // ones libgit2 actually reports — including the trailing separator
    // `Repository::path()` returns, which `strip_prefix` handles but a naive
    // string comparison would not.
    let dir = tempfile::tempdir().expect("tempdir");
    let repo = git2::Repository::init(dir.path()).expect("init");
    let gitdir = repo.path().to_path_buf();
    let commondir = repo.commondir().to_path_buf();

    let head: PathBuf = gitdir.join("HEAD");
    assert_eq!(classify(&head, &gitdir, &commondir), PathKind::Ref);

    let file = dir.path().join("src").join("main.rs");
    assert_eq!(classify(&file, &gitdir, &commondir), PathKind::Worktree);
}
