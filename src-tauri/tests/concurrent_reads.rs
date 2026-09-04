//! Read-only ops run concurrently and still agree with themselves (#400).
//!
//! The unit tests in `git/repo_locks.rs` prove the lock overlaps readers and
//! excludes writers, with a fake handle and no libgit2. What they cannot prove
//! is that the handles this backend mints are the RIGHT handles — which is the
//! whole risk in reopening a repository from its gitdir rather than reusing
//! one cached object.

mod support;

use std::sync::{Arc, Barrier};

use platypusgit_lib::git::{libgit2::Libgit2Backend, GitBackend};
use support::{fs::write_file, TempRepo};

/// The eleven-read fan-out, issued together, must answer exactly what it
/// answers one at a time.
#[test]
fn a_concurrent_fan_out_agrees_with_a_serial_one() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "untracked.txt", "x\n");
    let backend = Arc::new(Libgit2Backend::new());
    let h = backend.open(tr.path()).expect("open");

    // Serially first, so there is something to compare against.
    let want_status = backend.status(&h.id).expect("status").len();
    let want_branches = backend.branches(&h.id).expect("branches").len();
    let want_log = backend.log(&h.id, None, 10).expect("log").len();
    let want_head = backend.head_info(&h.id).expect("head_info");

    // Then all at once, with a barrier so they really are simultaneous rather
    // than merely spawned.
    const N: usize = 8;
    let start = Arc::new(Barrier::new(N));
    let mut threads = Vec::new();
    for i in 0..N {
        let backend = Arc::clone(&backend);
        let id = h.id.clone();
        let start = Arc::clone(&start);
        let want_head_branch = want_head.branch.clone();
        threads.push(std::thread::spawn(move || {
            start.wait();
            match i % 4 {
                0 => assert_eq!(
                    backend.status(&id).expect("status").len(),
                    want_status,
                    "concurrent status disagreed",
                ),
                1 => assert_eq!(
                    backend.branches(&id).expect("branches").len(),
                    want_branches,
                    "concurrent branches disagreed",
                ),
                2 => assert_eq!(
                    backend.log(&id, None, 10).expect("log").len(),
                    want_log,
                    "concurrent log disagreed",
                ),
                _ => assert_eq!(
                    backend.head_info(&id).expect("head_info").branch,
                    want_head_branch,
                    "concurrent head_info disagreed",
                ),
            }
        }));
    }
    for t in threads {
        t.join().expect("a concurrent read panicked");
    }

    // And the other reads in the fan-out at least answer without error, on
    // their own private handles.
    backend.tags(&h.id).expect("tags");
    backend.stashes(&h.id).expect("stashes");
    backend.remotes(&h.id).expect("remotes");
    backend.repo_state(&h.id).expect("repo_state");
    backend.rebase_status(&h.id).expect("rebase_status");
    backend.shallow_info(&h.id).expect("shallow_info");
    backend.worktrees(&h.id).expect("worktrees");
}

/// A read on a LINKED WORKTREE must read that worktree, not the main one.
///
/// A newly opened handle has to land on the same repository the cached one
/// describes, and a linked worktree is where that is least obvious: its gitdir
/// is `<main>/.git/worktrees/<name>/` while its workdir holds only a `.git`
/// FILE pointing there. Get the reopen path wrong — reuse the main
/// repository's, or reach for `repo.workdir()` on something that has none —
/// and reads silently answer about a different checkout. The dirty file exists
/// only in the worktree, so a leak is visible rather than theoretical.
///
/// What this does NOT prove is that the gitdir specifically is required.
/// Opening the workdir path was tried and also passes, because libgit2 follows
/// the `.git` file — see `open_read_handle`, which explains why the gitdir is
/// still the better of two working choices. Claiming more than that here would
/// be claiming more than the test checks.
#[test]
fn a_read_on_a_linked_worktree_reads_that_worktree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let wt_dir = tr.dir.path().join("wt");
    tr.repo
        .worktree("side", &wt_dir, None)
        .expect("add worktree");
    write_file(&wt_dir, "only-in-the-worktree.txt", "x\n");

    let backend = Libgit2Backend::new();
    let h = backend.open(&wt_dir).expect("open worktree");

    let status = backend.status(&h.id).expect("status");
    assert!(
        status.iter().any(|s| s.path == "only-in-the-worktree.txt"),
        "a read on the linked worktree must see its own untracked file, got {:?}",
        status.iter().map(|s| &s.path).collect::<Vec<_>>(),
    );

    // The main checkout does not have that file, and a handle opened for the
    // worktree must not start answering about it.
    let main = backend.open(tr.path()).expect("open main");
    let main_status = backend.status(&main.id).expect("main status");
    assert!(
        !main_status
            .iter()
            .any(|s| s.path == "only-in-the-worktree.txt"),
        "the worktree's untracked file leaked into the main checkout's status: {:?}",
        main_status.iter().map(|s| &s.path).collect::<Vec<_>>(),
    );
}

/// Reads keep working when the repository has no worktree at all.
#[test]
fn reads_work_on_a_bare_repository() {
    let dir = tempfile::tempdir().expect("tempdir");
    git2::Repository::init_bare(dir.path()).expect("init bare");

    let backend = Libgit2Backend::new();
    let h = backend.open(dir.path()).expect("open bare");

    // No commits and no workdir, but the reads must answer rather than panic
    // or resolve to some other repository.
    assert!(backend.branches(&h.id).expect("branches").is_empty());
    assert!(backend.tags(&h.id).expect("tags").is_empty());
    backend.repo_state(&h.id).expect("repo_state");
    backend.head_info(&h.id).expect("head_info");
}

/// `status` stays coherent while a stream of `stage` writes runs beside it.
///
/// `stage` read-modify-writes the WHOLE index, so this is the shape most
/// likely to show a reader something incoherent, and 200 reads against 20
/// writes gives the interleaving plenty of chances.
///
/// **It does not prove the gate earns its keep, and it was checked rather than
/// assumed.** Removing the gate from `shared_mut` entirely leaves this test
/// green: libgit2 writes the index to `.git/index.lock` and renames it into
/// place, so a reader on its own handle sees the whole old index or the whole
/// new one and never a half-written file. Git's on-disk atomicity is doing
/// that work, not `RepoLock`.
///
/// What pins the gate is `shared_and_exclusive_never_overlap` in
/// `git/repo_locks.rs`, which fails immediately without it. The gate is there
/// for the IN-PROCESS ordering guarantees — the stash TOCTOU pair, the
/// fast-forward ancestry check — where the invariant spans several git calls
/// inside one closure and no single rename makes it atomic.
#[test]
fn status_stays_coherent_beside_a_write_stream() {
    let tr = TempRepo::with_initial_commit("hello\n");
    const FILES: usize = 20;
    for i in 0..FILES {
        write_file(tr.path(), &format!("f{i}.txt"), "x\n");
    }
    let backend = Arc::new(Libgit2Backend::new());
    let h = backend.open(tr.path()).expect("open");

    let writer = {
        let backend = Arc::clone(&backend);
        let id = h.id.clone();
        std::thread::spawn(move || {
            for i in 0..FILES {
                let p = std::path::PathBuf::from(format!("f{i}.txt"));
                backend.stage(&id, &[p]).expect("stage");
            }
        })
    };

    let reader = {
        let backend = Arc::clone(&backend);
        let id = h.id.clone();
        std::thread::spawn(move || {
            for _ in 0..200 {
                // Every path is either staged or not, so the TOTAL never
                // changes while the writer works through them. A torn read
                // would lose one or double-count it.
                let status = backend.status(&id).expect("status");
                assert_eq!(
                    status.len(),
                    FILES,
                    "status saw {} of {FILES} paths — an incoherent read",
                    status.len(),
                );
            }
        })
    };

    writer.join().expect("writer panicked");
    reader.join().expect("reader panicked");
}
