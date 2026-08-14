//! Resumable log pagination (#68 G11).
//!
//! The cursor is the walk FRONTIER — the set of every awaited parent — not a
//! single oid. `a_merge_keeps_both_branches_alive_across_a_page_boundary` is
//! the test that fails for a scalar cursor: at a page boundary several lanes
//! are alive, and resuming from only the last emitted commit silently drops
//! every other branch.

mod support;

use platypusgit_lib::git::types::{CommitInfo, LogFilter, RepoId};
use platypusgit_lib::git::GitBackend;
use support::{linear_history, TempRepo};

fn checkout(tr: &TempRepo, branch: &str) {
    tr.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
    let mut co = git2::build::CheckoutBuilder::new();
    co.force();
    tr.repo.checkout_head(Some(&mut co)).unwrap();
}

/// initial → (main 1, main 2) and (feat 1, feat 2) → a REAL merge commit with
/// two parents, so the walk genuinely has two live lanes. Six commits.
fn merged_history() -> TempRepo {
    let tr = TempRepo::with_initial_commit("hi\n");
    {
        let base = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.branch("feature", &base, false).unwrap();
    }
    tr.add_commit("m1.txt", "m1\n", "main 1");
    tr.add_commit("m2.txt", "m2\n", "main 2");
    checkout(&tr, "feature");
    tr.add_commit("f1.txt", "f1\n", "feat 1");
    tr.add_commit("f2.txt", "f2\n", "feat 2");
    checkout(&tr, "main");
    {
        let main_tip = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let feat_tip = tr
            .repo
            .find_branch("feature", git2::BranchType::Local)
            .unwrap()
            .get()
            .peel_to_commit()
            .unwrap();
        // Reuse main's tree: this test is about walk topology, not content.
        let tree = main_tip.tree().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        tr.repo
            .commit(
                Some("HEAD"),
                &sig,
                &sig,
                "merge feature",
                &tree,
                &[&main_tip, &feat_tip],
            )
            .unwrap();
    }
    tr
}

/// Walk the whole history one small page at a time.
fn drain(be: &impl GitBackend, id: &RepoId, page: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let p = be.log_page(id, None, cursor.as_deref(), page).unwrap();
        out.extend(p.commits.iter().map(|c| c.oid.clone()));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(out.len() < 10_000, "pagination did not terminate");
    }
    out
}

fn oids(commits: &[CommitInfo]) -> Vec<String> {
    commits.iter().map(|c| c.oid.clone()).collect()
}

#[test]
fn pages_cover_linear_history_exactly_once() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 9); // 10 commits total
    let (be, h) = tr.open_with_backend();

    let all = be.log(&h.id, None, 1000).unwrap();
    let paged = drain(&be, &h.id, 3);

    assert_eq!(paged, oids(&all), "paged walk must equal the single-shot walk");
}

#[test]
fn no_commit_is_emitted_twice_across_pages() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 9);
    let (be, h) = tr.open_with_backend();

    let paged = drain(&be, &h.id, 2);
    let mut sorted = paged.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), paged.len(), "pages overlapped");
}

#[test]
fn a_merge_keeps_both_branches_alive_across_a_page_boundary() {
    // THE test a scalar cursor fails: page 1 ends with two lanes awaiting
    // different parents, and resuming from only the last emitted commit drops
    // one side of the merge entirely.
    //
    // Asserts the SET, not the sequence. Across a page boundary the exact
    // interleaving of two parallel branches is not reproducible when their
    // commits share a commit-time second: `Sort::TIME` breaks that tie using
    // the walk's seed set, and a resumed walk is seeded from the frontier
    // rather than from the merge. Every guarantee that matters — completeness,
    // no duplicates, children before parents — is asserted below and holds.
    let tr = merged_history();
    let (be, h) = tr.open_with_backend();

    let all = be.log(&h.id, None, 1000).unwrap();
    let paged = drain(&be, &h.id, 2);

    let mut want = oids(&all);
    let mut got = paged.clone();
    want.sort();
    got.sort();
    assert_eq!(got, want, "a branch was dropped at a page boundary");
    assert_eq!(paged.len(), all.len(), "duplicate or missing commits");
}

#[test]
fn a_page_smaller_than_the_live_lane_count_keeps_every_lane() {
    // Page size 2 above is >= the number of lanes, so every pushed start point
    // gets walked. A page of ONE cannot: resuming from a two-lane cursor walks
    // one lane and stops, leaving the other pushed-but-unvisited. It is nobody's
    // parent in that page, so unless the frontier also carries its own start
    // points forward, that lane is silently dropped and its commits never appear.
    let tr = merged_history();
    let (be, h) = tr.open_with_backend();

    let all = be.log(&h.id, None, 1000).unwrap();
    let paged = drain(&be, &h.id, 1);

    let mut want = oids(&all);
    let mut got = paged.clone();
    want.sort();
    got.sort();
    assert_eq!(got, want, "a lane was dropped by a single-commit page");
    assert_eq!(paged.len(), all.len(), "duplicate or missing commits");
}

#[test]
fn paging_never_places_a_parent_before_its_child() {
    // The ordering guarantee that survives resumption, and the one the graph
    // layout actually depends on.
    let tr = merged_history();
    let (be, h) = tr.open_with_backend();

    let all = be.log(&h.id, None, 1000).unwrap();
    let parents: std::collections::HashMap<String, Vec<String>> = all
        .iter()
        .map(|c| (c.oid.clone(), c.parents.clone()))
        .collect();

    let paged = drain(&be, &h.id, 2);
    let pos: std::collections::HashMap<&String, usize> =
        paged.iter().enumerate().map(|(i, o)| (o, i)).collect();

    for (i, oid) in paged.iter().enumerate() {
        for p in parents.get(oid).into_iter().flatten() {
            if let Some(&j) = pos.get(p) {
                assert!(
                    j > i,
                    "parent {p} appeared before its child {oid} ({j} <= {i})",
                );
            }
        }
    }
}

#[test]
fn the_frontier_holds_both_parents_of_a_merge() {
    // Page 1 is the merge commit alone, so the frontier must name BOTH sides.
    let tr = merged_history();
    let (be, h) = tr.open_with_backend();

    let p = be.log_page(&h.id, None, None, 1).unwrap();
    assert_eq!(p.commits.len(), 1);
    let cursor = p.next_cursor.expect("more history exists");
    assert_eq!(cursor.len(), 2, "a merge's frontier must keep both lanes");
}

#[test]
fn the_last_page_reports_no_cursor() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 2);
    let (be, h) = tr.open_with_backend();

    let p = be.log_page(&h.id, None, None, 1000).unwrap();
    assert!(p.next_cursor.is_none(), "end of history must not offer a cursor");
}

#[test]
fn a_full_page_at_the_exact_end_still_reports_no_cursor() {
    // limit == remaining commits: the walk is exhausted, so there is no
    // frontier even though the page came back full.
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 2); // 3 commits
    let (be, h) = tr.open_with_backend();

    let p = be.log_page(&h.id, None, None, 3).unwrap();
    assert_eq!(p.commits.len(), 3);
    assert!(p.next_cursor.is_none());
}

#[test]
fn an_unborn_head_pages_to_nothing() {
    let tr = TempRepo::fresh();
    let (be, h) = tr.open_with_backend();
    let p = be.log_page(&h.id, None, None, 10).unwrap();
    assert!(p.commits.is_empty());
    assert!(p.next_cursor.is_none());
}

#[test]
fn log_still_matches_the_first_page() {
    // `log` is now a wrapper over `log_page` — the old contract must not move.
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 5);
    let (be, h) = tr.open_with_backend();

    let legacy = be.log(&h.id, None, 3).unwrap();
    let page = be.log_page(&h.id, None, None, 3).unwrap();
    assert_eq!(oids(&legacy), oids(&page.commits));
}

#[test]
fn filtered_pages_cover_every_match_exactly_once() {
    let tr = TempRepo::with_initial_commit("hi\n");
    // Only the even-numbered commits say "keep".
    for i in 0..10 {
        let msg = if i % 2 == 0 {
            format!("keep {i}")
        } else {
            format!("skip {i}")
        };
        tr.add_commit(&format!("f{i}.txt"), "x\n", &msg);
    }
    let (be, h) = tr.open_with_backend();
    let filter = LogFilter {
        message: Some("keep".into()),
        ..Default::default()
    };

    let all = be.log_filtered(&h.id, &filter, None, 1000).unwrap();
    assert_eq!(all.len(), 5, "fixture should yield five matches");

    let mut paged = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let p = be
            .log_filtered_page(&h.id, &filter, None, cursor.as_deref(), 2)
            .unwrap();
        paged.extend(p.commits.iter().map(|c| c.oid.clone()));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(paged.len() < 1_000, "filtered pagination did not terminate");
    }

    assert_eq!(paged, oids(&all));
}

#[test]
fn filtered_pages_keep_both_lanes_of_a_merge_alive() {
    // The linear-history test above cannot catch an over-consumed revwalk: the
    // dropped oid is the previous commit's parent, so it survives in the frontier
    // as a candidate anyway. A merge is what exposes it — a cursor START point
    // pulled off the walk and discarded without being recorded is in neither
    // `visited` nor `candidates`, so its whole lane vanishes from the log.
    let tr = merged_history();
    let (be, h) = tr.open_with_backend();
    // Non-empty so this takes the filtered path (an empty filter delegates to
    // log_page), and matches every commit in the fixture.
    let filter = LogFilter {
        author: Some("test@example.com".into()),
        ..Default::default()
    };

    let all = be.log_filtered(&h.id, &filter, None, 1000).unwrap();
    assert_eq!(all.len(), 6, "fixture should yield six commits");

    // Small pages force several boundaries, each a chance to drop a lane.
    for page in [1usize, 2, 3] {
        let mut paged = Vec::new();
        let mut cursor: Option<Vec<String>> = None;
        loop {
            let p = be
                .log_filtered_page(&h.id, &filter, None, cursor.as_deref(), page)
                .unwrap();
            paged.extend(p.commits.iter().map(|c| c.oid.clone()));
            match p.next_cursor {
                Some(c) => cursor = Some(c),
                None => break,
            }
            assert!(paged.len() < 1_000, "filtered pagination did not terminate");
        }
        paged.sort();
        let mut want = oids(&all);
        want.sort();
        assert_eq!(
            paged, want,
            "page size {page} lost or duplicated commits across a merge boundary"
        );
    }
}
