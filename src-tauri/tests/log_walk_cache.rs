//! The paged log's walk cache (#473).
//!
//! `log_page` used to prepare a fresh revwalk per page, and in libgit2 a
//! topologically sorted walk materialises its COMPLETE ordered list before it
//! yields anything — so every page paid for sorting all of history. Ten pages
//! into `torvalds/linux` cost two minutes and thirty-eight seconds, ten times
//! what one page cost. The walk is now prepared once and paged from.
//!
//! Two kinds of test here, and the split is the point.
//!
//! **Transparency.** Everything the cache holds is derivable from the
//! repository, so turning it off must change nothing but the clock. Each of
//! these drains the same history twice — once through one backend, where the
//! cache is hot, and once through a fresh backend per page, where it can never
//! hit — and compares the two. That is the pre-change behaviour, byte for
//! byte, held against the new one.
//!
//! **Effect.** Every transparency test above passes just as well against a
//! cache that never hits, which would make them worthless on their own. So the
//! rest assert on `log_cache_stats`: how many walks a drain prepared, and that
//! a moved ref makes the next one prepare another. Those are the tests that go
//! red when the cache stops working — and the ones to plant a violation
//! against before trusting an edit here.

mod support;

use platypusgit_lib::git::libgit2::Libgit2Backend;
use platypusgit_lib::git::types::{RefKind, RepoId};
use platypusgit_lib::git::GitBackend;
use support::{linear_history, TempRepo};

/// One row as the UI sees it: the commit, and the pills stamped on it.
type Row = (String, Vec<(String, RefKind)>);

fn rows(page: &platypusgit_lib::git::types::LogPage) -> Vec<Row> {
    page.commits
        .iter()
        .map(|c| {
            (
                c.oid.clone(),
                c.refs.iter().map(|r| (r.name.clone(), r.kind)).collect(),
            )
        })
        .collect()
}

/// Walk all of history through ONE backend — the cache is hot from page two.
fn drain_warm(be: &Libgit2Backend, id: &RepoId, refspec: Option<&str>, page: usize) -> Vec<Row> {
    let mut out = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let p = be.log_page(id, refspec, cursor.as_deref(), page).unwrap();
        out.extend(rows(&p));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(out.len() < 10_000, "pagination did not terminate");
    }
    out
}

/// Walk all of history through a FRESH backend per page, so no page is ever
/// served from a cache. This is what the code did before #473.
fn drain_cold(tr: &TempRepo, refspec: Option<&str>, page: usize) -> Vec<Row> {
    let mut out = Vec::new();
    let mut cursor: Option<Vec<String>> = None;
    loop {
        let (be, handle) = tr.open_with_backend();
        let p = be
            .log_page(&handle.id, refspec, cursor.as_deref(), page)
            .unwrap();
        out.extend(rows(&p));
        match p.next_cursor {
            Some(c) => cursor = Some(c),
            None => break,
        }
        assert!(out.len() < 10_000, "pagination did not terminate");
    }
    out
}

fn checkout(tr: &TempRepo, branch: &str) {
    tr.repo.set_head(&format!("refs/heads/{branch}")).unwrap();
    let mut co = git2::build::CheckoutBuilder::new();
    co.force();
    tr.repo.checkout_head(Some(&mut co)).unwrap();
}

/// A commit on HEAD at an EXACT time, because the walk's order depends on it.
///
/// libgit2 sorts the topological queue by commit time, and `git_pqueue` is a
/// binary heap whose comparator is not stable — so among commits sharing a
/// second, which one comes out first depends on the order they were inserted.
/// A fixture built with `Signature::now` makes every commit in the same second
/// and leaves the order of two live lanes genuinely ambiguous, which no test
/// can then pin. Every multi-lane fixture below therefore spaces its commits
/// out — `merged_history(3600)` — and the one case that deliberately does not,
/// `merged_history(0)`, asserts only what a tie can still promise.
fn commit_at(tr: &TempRepo, file: &str, message: &str, when: i64) -> git2::Oid {
    support::fs::write_file(tr.path(), file, message);
    let mut index = tr.repo.index().unwrap();
    index.add_path(std::path::Path::new(file)).unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    let tree = tr.repo.find_tree(tree_oid).unwrap();
    let sig =
        git2::Signature::new("Test", "test@example.com", &git2::Time::new(when, 0)).unwrap();
    let head = tr.repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = head.iter().collect();
    tr.repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .unwrap()
}

/// initial → (main 1, main 2) and (feat 1, feat 2) → a real merge commit, so
/// the walk has two live lanes and a page boundary can land between them.
fn merged_history(spacing: i64) -> TempRepo {
    let tr = TempRepo::fresh();
    commit_at(&tr, "README.md", "initial", 1_700_000_000);
    {
        let base = tr.repo.head().unwrap().peel_to_commit().unwrap();
        tr.repo.branch("feature", &base, false).unwrap();
    }
    commit_at(&tr, "m1.txt", "main 1", 1_700_000_000 + spacing);
    commit_at(&tr, "m2.txt", "main 2", 1_700_000_000 + 2 * spacing);
    checkout(&tr, "feature");
    commit_at(&tr, "f1.txt", "feat 1", 1_700_000_000 + 3 * spacing);
    commit_at(&tr, "f2.txt", "feat 2", 1_700_000_000 + 4 * spacing);
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
        let tree = main_tip.tree().unwrap();
        let sig = git2::Signature::new(
            "Test",
            "test@example.com",
            &git2::Time::new(1_700_000_000 + 5 * spacing, 0),
        )
        .unwrap();
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

/// Every parent that appears in `rows` appears AFTER its child — the promise
/// the whole topological sort exists to make, and the one that survives a tie.
fn is_topological(tr: &TempRepo, rows: &[Row]) -> Result<(), String> {
    let at: std::collections::HashMap<&str, usize> = rows
        .iter()
        .enumerate()
        .map(|(i, (oid, _))| (oid.as_str(), i))
        .collect();
    for (i, (oid, _)) in rows.iter().enumerate() {
        let commit = tr
            .repo
            .find_commit(git2::Oid::from_str(oid).unwrap())
            .unwrap();
        for parent in commit.parent_ids() {
            if let Some(&j) = at.get(parent.to_string().as_str()) {
                if j <= i {
                    return Err(format!("{oid} at {i} has parent {parent} at {j}"));
                }
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- transparency

/// The property everything else rests on: cached and uncached produce the same
/// history, page size by page size. Sizes that do and do not divide the 21
/// commits, so a page boundary lands everywhere it can.
#[test]
fn a_cached_walk_pages_exactly_like_an_uncached_one() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 20);
    let (be, handle) = tr.open_with_backend();

    for page in [1, 2, 3, 5, 7, 21, 500] {
        let warm = drain_warm(&be, &handle.id, None, page);
        let cold = drain_cold(&tr, None, page);
        assert_eq!(warm, cold, "page size {page}");
        assert_eq!(warm.len(), 21, "page size {page}");
    }
}

/// The same, where a page boundary can fall between two live lanes — the case
/// the frontier cursor exists for, and the one an off-by-one in the resume
/// offset would corrupt without changing the commit COUNT.
#[test]
fn a_merge_pages_the_same_cached_and_uncached() {
    let tr = merged_history(3600);
    let (be, handle) = tr.open_with_backend();

    for page in [1, 2, 3, 6, 500] {
        let warm = drain_warm(&be, &handle.id, None, page);
        let cold = drain_cold(&tr, None, page);
        assert_eq!(warm, cold, "page size {page}");
        assert_eq!(warm.len(), 6, "page size {page}");
    }
}

/// Every branch tip is a start point, so `--all` is the walk with the most
/// lanes and the most seeding to get wrong.
#[test]
fn the_all_scope_pages_the_same_cached_and_uncached() {
    let tr = merged_history(3600);
    let (be, handle) = tr.open_with_backend();

    for page in [1, 2, 4, 500] {
        let warm = drain_warm(&be, &handle.id, Some("--all"), page);
        let cold = drain_cold(&tr, Some("--all"), page);
        assert_eq!(warm, cold, "page size {page}");
    }
}

/// When two lanes share a commit SECOND, which of them comes first is not
/// something either walk promises: libgit2 orders the topological queue by
/// time through a binary heap with an unstable comparator, so the answer
/// depends on insertion order — and a walk restarted from a cursor inserts in
/// a different order than one that ran straight through. That was true of the
/// walk-per-page version too; it is simply now visible, because one prepared
/// walk is self-consistent where ten of them were not.
///
/// What must hold regardless, and is the actual contract of a paged log: every
/// commit exactly once, and no parent before its child.
#[test]
fn a_tie_in_commit_time_still_pages_every_commit_exactly_once() {
    let tr = merged_history(0);
    let (be, handle) = tr.open_with_backend();

    for page in [1, 2, 3, 6, 500] {
        let warm = drain_warm(&be, &handle.id, None, page);
        let cold = drain_cold(&tr, None, page);

        let seen: std::collections::BTreeSet<&String> = warm.iter().map(|(o, _)| o).collect();
        assert_eq!(seen.len(), warm.len(), "page size {page}: a commit repeated");
        assert_eq!(
            seen,
            cold.iter().map(|(o, _)| o).collect(),
            "page size {page}: a different set of commits",
        );
        is_topological(&tr, &warm).unwrap_or_else(|e| panic!("page size {page}: {e}"));
    }
}

/// Ref decorations travel with the row, and they come from the cached ref map.
/// A map that went stale would drop the tag from the second read.
#[test]
fn a_tag_made_after_the_first_page_shows_up_on_the_next_one() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    let (be, handle) = tr.open_with_backend();

    let before = be.log_page(&handle.id, None, None, 10).unwrap();
    assert!(
        before.commits[0].refs.iter().all(|r| r.name != "v1"),
        "the tag does not exist yet",
    );

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo
        .tag_lightweight("v1", head.as_object(), false)
        .unwrap();

    let after = be.log_page(&handle.id, None, None, 10).unwrap();
    let pills: Vec<&str> = after.commits[0]
        .refs
        .iter()
        .map(|r| r.name.as_str())
        .collect();
    assert!(pills.contains(&"v1"), "got {pills:?}");
}

/// An annotated tag is the expensive half of `collect_ref_map` — it is the one
/// that has to be peeled — so it is the one most worth proving still arrives
/// after the map has been cached once.
#[test]
fn an_annotated_tag_made_later_shows_up_too() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    let (be, handle) = tr.open_with_backend();
    be.log_page(&handle.id, None, None, 10).unwrap();

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let sig = git2::Signature::now("Test", "test@example.com").unwrap();
    tr.repo
        .tag("v2", head.as_object(), &sig, "release two", false)
        .unwrap();

    let after = be.log_page(&handle.id, None, None, 10).unwrap();
    let tagged = after.commits[0]
        .refs
        .iter()
        .any(|r| r.name == "v2" && r.kind == RefKind::Tag);
    assert!(tagged, "got {:?}", after.commits[0].refs);
}

/// A continuation decorates with the refs its FIRST page saw, and the next
/// first page picks the new one up.
///
/// This is the one place the cache is visible from outside, and it is a
/// deliberate trade measured on the `refs` fixture: validating the
/// decorations costs 113 ms of a 117 ms page there, because enumerating 7,001
/// loose refs is the whole expense. Once per refresh is proportionate — the
/// `branches` and `tags` reads beside it in the same fan-out pay 187 ms and
/// 149 ms for the same enumeration — and once per scroll is not. A scroll
/// therefore shows one coherent snapshot of the decorations rather than a
/// different one per page.
#[test]
fn a_continuation_keeps_the_decorations_its_first_page_saw() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 5);
    let (be, handle) = tr.open_with_backend();

    let first = be.log_page(&handle.id, None, None, 2).unwrap();
    let cursor = first.next_cursor.clone().expect("more history");

    // Tag a commit the NEXT page will contain.
    let target = tr
        .repo
        .find_commit(git2::Oid::from_str(&cursor[0]).unwrap())
        .unwrap();
    tr.repo
        .tag_lightweight("mid-scroll", target.as_object(), false)
        .unwrap();

    let next = be
        .log_page(&handle.id, None, Some(&cursor), 2)
        .unwrap();
    assert!(
        next.commits[0].refs.iter().all(|r| r.name != "mid-scroll"),
        "a continuation does not re-read the refs: {:?}",
        next.commits[0].refs,
    );

    // …and a refresh — which is always a first page — does pick it up.
    let refreshed = be.log_page(&handle.id, None, None, 500).unwrap();
    let tagged = refreshed
        .commits
        .iter()
        .any(|c| c.refs.iter().any(|r| r.name == "mid-scroll"));
    assert!(tagged, "a first page must validate the decorations");
}

/// A commit made after a page was cached must appear in the next first page —
/// the invalidation that matters most, because it happens every time the user
/// commits.
#[test]
fn a_new_commit_appears_in_the_next_first_page() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    let (be, handle) = tr.open_with_backend();

    let before = be.log_page(&handle.id, None, None, 10).unwrap();
    assert_eq!(before.commits.len(), 4);

    tr.add_commit("new.txt", "new\n", "brand new");

    let after = be.log_page(&handle.id, None, None, 10).unwrap();
    assert_eq!(after.commits.len(), 5, "the new commit is missing");
    assert_eq!(after.commits[0].summary, "brand new");
}

/// Two scopes over one repository are two different walks. Asking for one
/// right after the other must not hand back the other one's history.
#[test]
fn two_scopes_do_not_share_a_walk() {
    let tr = merged_history(3600);
    let (be, handle) = tr.open_with_backend();

    let head_only = be.log_page(&handle.id, None, None, 500).unwrap();
    let feature = be
        .log_page(&handle.id, Some("feature"), None, 500)
        .unwrap();
    let head_again = be.log_page(&handle.id, None, None, 500).unwrap();

    assert_eq!(head_only.commits.len(), 6, "HEAD sees the merge");
    assert_eq!(feature.commits.len(), 3, "feature does not");
    assert_eq!(
        head_only.commits.iter().map(|c| &c.oid).collect::<Vec<_>>(),
        head_again.commits.iter().map(|c| &c.oid).collect::<Vec<_>>(),
        "the second read of HEAD came back as something else",
    );
}

// ---------------------------------------------------------------------- effect

/// The point of the whole change: N pages, one walk.
///
/// This is the test that fails if `page_plan` stops consulting the cache, and
/// the one the numbers in `docs/dev/performance.md` are downstream of. Twenty
/// one commits in pages of two is eleven pages.
#[test]
fn paging_a_whole_history_prepares_exactly_one_walk() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 20);
    let (be, handle) = tr.open_with_backend();

    let all = drain_warm(&be, &handle.id, None, 2);
    assert_eq!(all.len(), 21);

    let stats = be.log_cache_stats();
    assert_eq!(
        stats.walks_prepared, 1,
        "eleven pages prepared {} walks",
        stats.walks_prepared,
    );
    assert_eq!(stats.hits, 10, "ten of the eleven pages should be slices");
}

/// …and the ref map is built once for those eleven pages, not eleven times.
#[test]
fn paging_a_whole_history_builds_exactly_one_ref_map() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 20);
    let (be, handle) = tr.open_with_backend();

    drain_warm(&be, &handle.id, None, 2);

    assert_eq!(be.log_cache_stats().ref_maps_built, 1);
}

/// A repeated first page — what `refreshAll` issues on every refresh — must
/// not prepare a second walk. On the kernel that one fact is 15.9 seconds per
/// refresh.
#[test]
fn a_repeated_first_page_prepares_no_second_walk() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 10);
    let (be, handle) = tr.open_with_backend();

    for _ in 0..5 {
        be.log_page(&handle.id, None, None, 500).unwrap();
    }

    assert_eq!(be.log_cache_stats().walks_prepared, 1);
}

/// A commit invalidates the walk, because the start oid it is keyed by moved.
/// Without this the cache would be a correctness bug rather than a speed-up,
/// so it is asserted as a COUNT as well as by the commit showing up.
#[test]
fn a_commit_makes_the_next_first_page_prepare_a_new_walk() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    let (be, handle) = tr.open_with_backend();

    be.log_page(&handle.id, None, None, 500).unwrap();
    assert_eq!(be.log_cache_stats().walks_prepared, 1);

    tr.add_commit("new.txt", "new\n", "brand new");
    be.log_page(&handle.id, None, None, 500).unwrap();

    assert_eq!(be.log_cache_stats().walks_prepared, 2);
}

/// A tag moves the ref fingerprint even though it moves no start point, so the
/// ref map is rebuilt and the walk is not. Both halves matter: rebuilding the
/// walk for a tag would throw away the expensive thing for the cheap reason.
#[test]
fn a_tag_rebuilds_the_ref_map_and_not_the_walk() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    let (be, handle) = tr.open_with_backend();

    be.log_page(&handle.id, None, None, 500).unwrap();
    let before = be.log_cache_stats();

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    tr.repo
        .tag_lightweight("v1", head.as_object(), false)
        .unwrap();
    be.log_page(&handle.id, None, None, 500).unwrap();
    let after = be.log_cache_stats();

    assert_eq!(after.ref_maps_built, before.ref_maps_built + 1);
    assert_eq!(
        after.walks_prepared, before.walks_prepared,
        "a tag is not a new walk",
    );
}

/// The two places a ref fingerprint is computed must agree.
///
/// `collect_ref_map` produces one from its own pass and `ref_fingerprint`
/// computes one to validate it, and if the two ever disagree the map built by
/// one is rejected by the other on the very next call. Nothing about that is
/// visible from outside — pagination stays correct, the decorations stay
/// correct, and the cache simply never hits again. So it is asserted through
/// the only door there is: a repository with every shape of ref in it, read
/// twice, must rebuild nothing the second time.
#[test]
fn the_two_fingerprint_paths_agree() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    {
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        tr.repo.branch("topic", &head, false).unwrap();
        tr.repo
            .tag_lightweight("light", head.as_object(), false)
            .unwrap();
        tr.repo
            .tag("heavy", head.as_object(), &sig, "annotated", false)
            .unwrap();
        // A symbolic ref has no direct target, so it takes the other arm of the
        // fingerprint — and of the map.
        tr.repo
            .reference_symbolic("refs/remotes/origin/HEAD", "refs/heads/main", true, "probe")
            .unwrap();
    }
    let (be, handle) = tr.open_with_backend();

    be.log_page(&handle.id, Some("--all"), None, 500).unwrap();
    let first = be.log_cache_stats();
    be.log_page(&handle.id, Some("--all"), None, 500).unwrap();

    assert_eq!(
        be.log_cache_stats().ref_maps_built,
        first.ref_maps_built,
        "the validating fingerprint disagrees with the one the map was built \
         with, so the cache can never hit",
    );
}

/// Nothing changed, so nothing is rebuilt — the case that is true on almost
/// every call, and the one a fingerprint that is not stable would silently
/// ruin.
#[test]
fn an_unchanged_repository_rebuilds_nothing() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 3);
    {
        let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        tr.repo.branch("other", &head, false).unwrap();
        tr.repo
            .tag_lightweight("light", head.as_object(), false)
            .unwrap();
        tr.repo
            .tag("heavy", head.as_object(), &sig, "annotated", false)
            .unwrap();
    }
    let (be, handle) = tr.open_with_backend();

    be.log_page(&handle.id, Some("--all"), None, 500).unwrap();
    let first = be.log_cache_stats();
    for _ in 0..4 {
        be.log_page(&handle.id, Some("--all"), None, 500).unwrap();
    }
    let after = be.log_cache_stats();

    assert_eq!(after.walks_prepared, first.walks_prepared, "walk rebuilt");
    assert_eq!(after.ref_maps_built, first.ref_maps_built, "ref map rebuilt");
    assert_eq!(after.hits, first.hits + 4, "four pages, four slices");
}

/// A cursor from one backend handed to another has nothing to resume against,
/// and must still page correctly — the fallback every page took before #473,
/// and the one a cache eviction drops back to.
#[test]
fn a_cursor_with_no_cache_behind_it_still_pages() {
    let tr = TempRepo::with_initial_commit("hi\n");
    linear_history(&tr, 5);
    let (first, handle) = tr.open_with_backend();

    let page = first.log_page(&handle.id, None, None, 2).unwrap();
    let cursor = page.next_cursor.expect("more history");

    let (second, other) = tr.open_with_backend();
    let resumed = second
        .log_page(&other.id, None, Some(&cursor), 2)
        .unwrap();

    assert_eq!(resumed.commits.len(), 2);
    assert_eq!(
        second.log_cache_stats().walks_prepared,
        1,
        "an unknown cursor has to prepare its own walk",
    );
    let expected = drain_cold(&tr, None, 2);
    assert_eq!(
        resumed.commits.iter().map(|c| &c.oid).collect::<Vec<_>>(),
        expected[2..4].iter().map(|(o, _)| o).collect::<Vec<_>>(),
    );
}
