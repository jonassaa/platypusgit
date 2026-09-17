//! `file_history` — what it finds, and what stops it looking (#474).
//!
//! The walk has two ceilings and it has to say which one ended it, because the
//! three outcomes look identical on screen and mean completely different
//! things. Before #474 there was only the MATCH ceiling, so a file with fewer
//! changes than the limit had nothing to stop on and the walk ran to the root
//! of history — measured at 135 s and 1,482,923 tree comparisons on
//! `torvalds/linux` for one click (`docs/dev/performance.md`), with the
//! exclusive repository lock held for all of it.

mod support;

use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::HistoryStop;
use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

/// Never cancelled — the ordinary case, spelled once.
fn live() -> impl Fn() -> bool {
    || false
}

#[test]
fn file_history_returns_commits_that_touched_the_path() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    // Commit 2: touch foo.txt
    write_file(tr.path(), "foo.txt", "a\n");
    tr.commit_all("add foo");

    // Commit 3: touch bar.txt (should not appear in foo.txt history)
    write_file(tr.path(), "bar.txt", "b\n");
    tr.commit_all("add bar");

    // Commit 4: modify foo.txt
    write_file(tr.path(), "foo.txt", "a\nb\n");
    tr.commit_all("edit foo");

    let history = backend
        .file_history(&handle.id, Path::new("foo.txt"), 100, None, &live())
        .unwrap();

    let summaries: Vec<&str> = history.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(summaries, vec!["edit foo", "add foo"]);
}

/// The whole-answer case: history ran out, so the list is everything.
#[test]
fn a_walk_that_reaches_the_end_of_history_says_exhausted() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "foo.txt", "a\n");
    tr.commit_all("add foo");

    let history = backend
        .file_history(&handle.id, Path::new("foo.txt"), 100, None, &live())
        .unwrap();

    assert_eq!(history.stopped_at, HistoryStop::Exhausted);
    assert_eq!(history.commits.len(), 1);
    assert_eq!(history.visited, 2, "both commits were examined");
}

/// **The regression test for the issue.** A file with fewer changes than the
/// match limit gives the walk nothing to stop on; the visit cap is what stops
/// it, and the count it stopped at is what the notice says out loud.
///
/// The match is in the OLDEST commit on purpose: the walk starts at HEAD, so a
/// cap that works necessarily misses it. Finding it here would mean the cap did
/// not apply.
#[test]
fn the_visit_cap_stops_the_walk_short_of_the_end() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "old.txt", "a\n");
    tr.commit_all("add old");
    for i in 0..8 {
        write_file(tr.path(), "other.txt", &format!("{i}\n"));
        tr.commit_all(&format!("unrelated {i}"));
    }

    let capped = backend
        .file_history(&handle.id, Path::new("old.txt"), 100, Some(3), &live())
        .unwrap();

    assert_eq!(capped.stopped_at, HistoryStop::VisitLimit);
    assert_eq!(capped.visited, 3, "exactly the cap, not one more");
    assert!(
        capped.commits.is_empty(),
        "the only change to old.txt is older than the cap reached",
    );

    // Uncapped — which is what the notice's "search all of history" asks for —
    // finds it. Same repository, same path, so the cap is the only difference.
    let all = backend
        .file_history(&handle.id, Path::new("old.txt"), 100, None, &live())
        .unwrap();
    assert_eq!(all.stopped_at, HistoryStop::Exhausted);
    assert_eq!(all.commits.len(), 1);
    assert_eq!(all.visited, 10);
}

/// The off-by-one that would make the notice lie about every ordinary
/// repository: a cap reached exactly as history ends is not a truncation, and
/// must not claim there might be more.
#[test]
fn a_cap_that_lands_exactly_on_the_end_of_history_is_not_a_truncation() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_file(tr.path(), "foo.txt", "a\n");
    tr.commit_all("add foo");

    let history = backend
        .file_history(&handle.id, Path::new("foo.txt"), 100, Some(2), &live())
        .unwrap();

    assert_eq!(
        history.stopped_at,
        HistoryStop::Exhausted,
        "two commits examined under a cap of two is the whole history, not a cap hit",
    );
    assert_eq!(history.visited, 2);
}

/// The other ceiling, reported as itself. It says "the list is full", which is
/// a different sentence from "the search stopped" and carries no offer to
/// search further — more searching would find more matches and the list would
/// still hold `limit` of them.
#[test]
fn filling_the_match_limit_is_reported_separately_from_the_visit_cap() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    for i in 0..4 {
        write_file(tr.path(), "foo.txt", &format!("{i}\n"));
        tr.commit_all(&format!("edit foo {i}"));
    }

    let history = backend
        .file_history(&handle.id, Path::new("foo.txt"), 2, None, &live())
        .unwrap();

    assert_eq!(history.stopped_at, HistoryStop::MatchLimit);
    assert_eq!(history.commits.len(), 2);
    let summaries: Vec<&str> = history.commits.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(
        summaries,
        vec!["edit foo 3", "edit foo 2"],
        "newest first — the limit takes from the OLD end",
    );
}

/// Cancellation, and that it really stops rather than running to the end and
/// throwing the answer away: the predicate counts its calls.
#[test]
fn a_cancelled_walk_stops_where_it_was_asked_to() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    for i in 0..20 {
        write_file(tr.path(), "foo.txt", &format!("{i}\n"));
        tr.commit_all(&format!("edit foo {i}"));
    }

    let asked = std::sync::atomic::AtomicUsize::new(0);
    let cancel_after_three = || {
        let n = asked.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        n >= 3
    };

    let err = backend
        .file_history(&handle.id, Path::new("foo.txt"), 100, None, &cancel_after_three)
        .unwrap_err();

    assert!(
        matches!(err, AppError::Cancelled),
        "a cancelled walk is Cancelled, not an empty list — an empty list is \
         indistinguishable from a file with no history: {err:?}",
    );
    assert_eq!(
        asked.load(std::sync::atomic::Ordering::SeqCst),
        4,
        "asked three times, stopped on the fourth — it did not keep walking",
    );
}

/// A walk already cancelled before it starts never examines anything.
#[test]
fn a_walk_cancelled_before_it_starts_does_no_work() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .file_history(&handle.id, Path::new("README.md"), 100, None, &|| true)
        .unwrap_err();
    assert!(matches!(err, AppError::Cancelled));
}

/// **It runs on the SHARED lock** (#400/#474) — the half of the issue that is
/// not about speed at all. Holding the exclusive lock for a walk this long
/// queued every other operation on the repository behind it.
///
/// Proved by rendezvous rather than by timing: the `cancelled` predicate is
/// called from inside the walk, with the lock held, so it is a place to stand
/// still and ask whether another read can get in. If `file_history` were
/// exclusive, the `status` below could not start until the walk finished, the
/// bounded wait would expire, and this fails — rather than hanging, and rather
/// than passing slowly.
///
/// Verified by planting the violation: with `with_repo` in place of
/// `with_repo_read` in `file_history`, this test fails on the timeout and the
/// rest of the file still passes.
#[test]
fn the_walk_does_not_exclude_another_read_of_the_same_repository() {
    let tr = TempRepo::with_initial_commit("hello\n");
    for i in 0..10 {
        write_file(tr.path(), "foo.txt", &format!("{i}\n"));
        tr.commit_all(&format!("edit foo {i}"));
    }
    let (backend, handle) = tr.open_with_backend();
    let backend = Arc::new(backend);

    // `(walk is inside the lock, the other read finished)`
    let state = Arc::new((Mutex::new((false, false)), Condvar::new()));

    let reader = {
        let backend = Arc::clone(&backend);
        let id = handle.id.clone();
        let state = Arc::clone(&state);
        std::thread::spawn(move || {
            let (lock, cv) = &*state;
            // Wait until the walk is demonstrably inside its lock.
            let mut seen = lock.lock().unwrap();
            while !seen.0 {
                let (g, t) = cv.wait_timeout(seen, Duration::from_secs(10)).unwrap();
                seen = g;
                assert!(!t.timed_out(), "the walk never reached its first commit");
            }
            drop(seen);

            // The read under test: shared, on the same repository, while the
            // walk holds its lock.
            backend.status(&id).expect("a concurrent read must be served");

            let (lock, cv) = &*state;
            lock.lock().unwrap().1 = true;
            cv.notify_all();
        })
    };

    let inside_the_walk = || {
        let (lock, cv) = &*state;
        let mut s = lock.lock().unwrap();
        if !s.0 {
            s.0 = true;
            cv.notify_all();
        }
        // Stand still until the other read is through. A walk holding an
        // EXCLUSIVE lock would keep it out, and this wait would expire.
        while !s.1 {
            let (g, t) = cv.wait_timeout(s, Duration::from_secs(10)).unwrap();
            s = g;
            assert!(
                !t.timed_out(),
                "a concurrent read could not be served while file_history walked \
                 — it is holding the EXCLUSIVE lock",
            );
        }
        false
    };

    let history = backend
        .file_history(&handle.id, Path::new("foo.txt"), 100, None, &inside_the_walk)
        .expect("the walk itself must still succeed");
    assert_eq!(history.commits.len(), 10);

    reader.join().expect("the concurrent reader panicked");
}
