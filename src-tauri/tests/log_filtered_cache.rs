//! The FILTERED log pages out of the same prepared walk (#473).
//!
//! `log_filtered_page` had both of the defects `log_page` had, for the same
//! reason and in the same two lines: a revwalk built per page, and
//! `collect_ref_map` called per page. Commit search is the surface where that
//! hurts most on a large repository, because a search that matches nothing
//! recent walks a long way before it fills a page — and then the next page
//! threw that walk away and started the topological sort again.
//!
//! Same split as `log_walk_cache.rs`, and for the same reason. **Transparency**
//! drains one search warm and cold and compares, which is the pre-change
//! behaviour held against the new one. **Effect** asserts on the counters,
//! because every transparency test here passes just as well against a cache
//! that never hits.

mod support;

use platypusgit_lib::git::libgit2::Libgit2Backend;
use platypusgit_lib::git::types::{LogFilter, LogPage, RepoId};
use platypusgit_lib::git::GitBackend;
use support::{linear_history, TempRepo};

/// Matches `commit 1`, `commit 10`…`commit 19` — 11 of 30, spread across the
/// history rather than bunched at one end, so a page boundary falls inside the
/// matches and the walk has to carry on past commits that do not match.
fn filter() -> LogFilter {
    LogFilter {
        message: Some("commit 1".into()),
        ..Default::default()
    }
}

fn summaries(page: &LogPage) -> Vec<String> {
    page.commits.iter().map(|c| c.summary.clone()).collect()
}

/// Page a search through ONE backend — the cache is hot from page two.
fn search_warm(be: &Libgit2Backend, id: &RepoId, page: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let p = be
            .log_filtered_page(id, &filter(), None, cursor.as_deref(), page)
            .unwrap();
        out.extend(summaries(&p));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(out.len() < 10_000, "pagination did not terminate");
    }
    out
}

/// The same search, on a backend that has never seen this repository — so
/// every page pays for its own walk, exactly as every page used to.
fn search_cold(tr: &TempRepo, page: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let (be, handle) = tr.open_with_backend();
        let p = be
            .log_filtered_page(&handle.id, &filter(), None, cursor.as_deref(), page)
            .unwrap();
        out.extend(summaries(&p));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(out.len() < 10_000, "pagination did not terminate");
    }
    out
}

fn history(n: usize) -> TempRepo {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, n);
    tr
}

/// Transparency: the cache changes the clock and nothing else.
#[test]
fn a_paged_search_returns_the_same_commits_warm_and_cold() {
    let tr = history(30);
    let (be, handle) = tr.open_with_backend();

    let warm = search_warm(&be, &handle.id, 4);
    let cold = search_cold(&tr, 4);

    assert_eq!(warm, cold, "a cached search must return what a cold one does");
    assert_eq!(warm.len(), 11, "got {warm:?}");
}

/// Transparency, at a page size that puts a boundary between two matches.
#[test]
fn a_paged_search_agrees_with_an_unpaged_one() {
    let tr = history(30);
    let (be, handle) = tr.open_with_backend();

    let paged = search_warm(&be, &handle.id, 3);
    let whole: Vec<String> = be
        .log_filtered(&handle.id, &filter(), None, 100)
        .unwrap()
        .iter()
        .map(|c| c.summary.clone())
        .collect();

    assert_eq!(paged, whole, "paging a search must not drop or reorder a match");
}

/// Effect: the walk. THE test for the filtered half of #473 — planting the
/// violation (build a revwalk per filtered page, as it did) makes this one
/// walk per page instead.
#[test]
fn paging_a_search_prepares_one_walk() {
    let tr = history(30);
    let (be, handle) = tr.open_with_backend();

    let found = search_warm(&be, &handle.id, 3);

    assert_eq!(found.len(), 11, "got {found:?}");
    assert_eq!(
        be.log_cache_stats().walks_prepared,
        1,
        "a search paged four deep must prepare ONE walk, not one per page",
    );
}

/// Effect: the ref map. It decorated 500 rows by enumerating and peeling every
/// ref, once per page.
#[test]
fn paging_a_search_builds_one_ref_map() {
    let tr = history(30);
    let (be, handle) = tr.open_with_backend();

    search_warm(&be, &handle.id, 3);

    assert_eq!(
        be.log_cache_stats().ref_maps_built,
        1,
        "a continuation must decorate with the refs its first page saw",
    );
}

/// A search asks the same question of the same graph as the log beside it, so
/// it reads the walk the log already prepared rather than preparing a second.
#[test]
fn a_search_reuses_the_walk_the_log_prepared() {
    let tr = history(30);
    let (be, handle) = tr.open_with_backend();

    be.log_page(&handle.id, None, None, 5).unwrap();
    assert_eq!(be.log_cache_stats().walks_prepared, 1);

    let hits = be
        .log_filtered_page(&handle.id, &filter(), None, None, 100)
        .unwrap();

    assert_eq!(summaries(&hits).len(), 11);
    assert_eq!(
        be.log_cache_stats().walks_prepared,
        1,
        "a search must not re-prepare a walk the log already materialised",
    );
}

/// A commit moves HEAD, so the search's walk is rebuilt rather than served
/// from an order that no longer describes this repository.
#[test]
fn a_moved_head_re_prepares_the_search_walk() {
    let tr = history(30);
    let (be, handle) = tr.open_with_backend();

    be.log_filtered_page(&handle.id, &filter(), None, None, 5)
        .unwrap();
    assert_eq!(be.log_cache_stats().walks_prepared, 1);

    tr.add_commit("late.txt", "late\n", "commit 100");

    let after = be
        .log_filtered_page(&handle.id, &filter(), None, None, 5)
        .unwrap();

    assert_eq!(
        after.commits[0].summary, "commit 100",
        "a moved HEAD must not be searched from the cached order",
    );
    assert_eq!(
        be.log_cache_stats().walks_prepared,
        2,
        "the walk must be re-prepared once HEAD has moved",
    );
}
