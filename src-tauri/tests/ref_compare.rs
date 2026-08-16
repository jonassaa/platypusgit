// Branch compare (#131): the three additive ops behind the compare screen —
// `diff_ref_to_workdir`, `ahead_behind` and `commits_between`.
//
// `diff_ref_to_workdir` is deliberately a GENERAL primitive (arbitrary revspec
// vs the working tree, with the same context / ignore-whitespace knobs as every
// other diff op), because #133 inherits it for stash comparisons.

mod support;

use std::path::PathBuf;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::TagTarget;
use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

/// `main` and `feature` diverged: 2 commits only on `main`, 3 only on `feature`.
/// Returns the repo; the caller opens its own backend.
fn diverged() -> TempRepo {
    let tr = TempRepo::with_initial_commit("base\n");
    {
        let (backend, handle) = tr.open_with_backend();
        backend.create_branch(&handle.id, "feature", None).unwrap();

        // 2 commits on main.
        for i in 0..2 {
            write_file(tr.path(), "main.txt", &format!("main {i}\n"));
            tr.commit_all(&format!("main {i}"));
        }

        // 3 commits on feature.
        backend.checkout_branch(&handle.id, "feature").unwrap();
        for i in 0..3 {
            write_file(tr.path(), "feature.txt", &format!("feature {i}\n"));
            tr.commit_all(&format!("feature {i}"));
        }
        backend.checkout_branch(&handle.id, "main").unwrap();
    }
    tr
}

// --- diff_ref_to_workdir ---------------------------------------------------

#[test]
fn ref_to_workdir_sees_staged_unstaged_and_untracked() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    // Baseline commit with two tracked files, so "staged" and "unstaged" are
    // separable below.
    write_file(tr.path(), "staged.txt", "one\n");
    write_file(tr.path(), "unstaged.txt", "one\n");
    write_file(tr.path(), ".gitignore", "ignored.txt\n");
    tr.commit_all("baseline");

    // A staged edit, an unstaged edit, a new untracked file, an ignored file.
    write_file(tr.path(), "staged.txt", "one\ntwo\n");
    backend
        .stage(&handle.id, &[PathBuf::from("staged.txt")])
        .unwrap();
    write_file(tr.path(), "unstaged.txt", "one\ntwo\n");
    write_file(tr.path(), "untracked.txt", "brand new\n");
    write_file(tr.path(), "ignored.txt", "noise\n");

    let with_untracked = backend
        .diff_ref_to_workdir(&handle.id, "HEAD", 3, false, true)
        .unwrap()
        .files;
    let paths: Vec<&str> = with_untracked.iter().map(|d| d.path.as_str()).collect();
    assert!(paths.contains(&"staged.txt"), "staged edit missing: {paths:?}");
    assert!(
        paths.contains(&"unstaged.txt"),
        "unstaged edit missing: {paths:?}"
    );
    assert!(
        paths.contains(&"untracked.txt"),
        "untracked file missing: {paths:?}"
    );
    assert!(
        !paths.contains(&"ignored.txt"),
        "gitignored file must never show: {paths:?}"
    );

    // The untracked file's content is readable, not just its name — that is why
    // the flag turns on `show_untracked_content`.
    let untracked = with_untracked
        .iter()
        .find(|d| d.path == "untracked.txt")
        .unwrap();
    assert!(untracked.additions > 0, "untracked file has no added lines");

    let without = backend
        .diff_ref_to_workdir(&handle.id, "HEAD", 3, false, false)
        .unwrap()
        .files;
    let paths: Vec<&str> = without.iter().map(|d| d.path.as_str()).collect();
    assert!(paths.contains(&"staged.txt"));
    assert!(paths.contains(&"unstaged.txt"));
    assert!(
        !paths.contains(&"untracked.txt"),
        "include_untracked=false must drop it: {paths:?}"
    );
    assert!(!paths.contains(&"ignored.txt"));
}

#[test]
fn ref_to_workdir_accepts_branch_and_tag_revspecs() {
    let tr = diverged();
    let (backend, handle) = tr.open_with_backend();
    let head = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();
    backend
        .create_tag(
            &handle.id,
            "v1",
            TagTarget {
                oid: head,
                annotation: None,
            },
        )
        .unwrap();

    // On `main`, with a dirty worktree, compared against `feature`.
    write_file(tr.path(), "main.txt", "dirty\n");

    let by_branch = backend
        .diff_ref_to_workdir(&handle.id, "feature", 3, false, false)
        .unwrap()
        .files;
    let paths: Vec<&str> = by_branch.iter().map(|d| d.path.as_str()).collect();
    // `feature.txt` exists on feature and not in the worktree → a deletion.
    assert!(paths.contains(&"feature.txt"), "{paths:?}");
    assert!(paths.contains(&"main.txt"), "{paths:?}");

    // A tag resolves through the same peel — an annotated/lightweight tag is a
    // legal left side of a comparison.
    let by_tag = backend
        .diff_ref_to_workdir(&handle.id, "v1", 3, false, false)
        .unwrap()
        .files;
    let paths: Vec<&str> = by_tag.iter().map(|d| d.path.as_str()).collect();
    assert!(paths.contains(&"main.txt"), "{paths:?}");
}

#[test]
fn ref_to_workdir_rejects_an_unresolvable_revspec() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .diff_ref_to_workdir(&handle.id, "no-such-ref", 3, false, false)
        .unwrap_err();
    assert!(
        matches!(err, AppError::InvalidRef(ref s) if s == "no-such-ref"),
        "expected InvalidRef, got {err:?}"
    );
}

#[test]
fn ref_to_workdir_drops_the_untracked_side_wholesale_past_the_ceiling() {
    // The defect this guards: `diff` pathspecs ONE file before turning untracked
    // content on, so it can never fan out. This op walks the whole tree, so an
    // untracked `dist/` nobody gitignored would otherwise be serialised entire.
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    // MAX_UNTRACKED_FILES is 200; go one over so the ceiling, not the count, is
    // what the assertion is about.
    for i in 0..201 {
        write_file(tr.path(), &format!("dist/chunk-{i}.js"), "console.log(1)\n");
    }

    let over = backend
        .diff_ref_to_workdir(&handle.id, "HEAD", 3, false, true)
        .unwrap();
    assert_eq!(
        over.untracked_omitted, 201,
        "the count must be reported, not silently truncated"
    );
    assert!(
        over.files.is_empty(),
        "nothing tracked changed, so the untracked side being dropped leaves nothing: {:?}",
        over.files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );

    // One under the ceiling and every file comes through with its content.
    std::fs::remove_file(tr.path().join("dist/chunk-200.js")).unwrap();
    let under = backend
        .diff_ref_to_workdir(&handle.id, "HEAD", 3, false, true)
        .unwrap();
    assert_eq!(under.untracked_omitted, 0);
    assert_eq!(under.files.len(), 200);
    assert!(under.files.iter().all(|f| f.additions > 0));
}

#[test]
fn ref_to_workdir_never_omits_when_untracked_are_not_requested() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();
    for i in 0..250 {
        write_file(tr.path(), &format!("dist/chunk-{i}.js"), "x\n");
    }

    let out = backend
        .diff_ref_to_workdir(&handle.id, "HEAD", 3, false, false)
        .unwrap();
    assert_eq!(out.untracked_omitted, 0, "nothing was asked for, nothing omitted");
    assert!(out.files.is_empty());
}

#[test]
fn an_untracked_binary_reads_as_binary_not_as_mojibake_lines() {
    // `diff_to_file_diffs` samples `is_binary()` BEFORE `diff.print` runs, and
    // for a workdir-side delta libgit2 has not examined the blob by then. Left
    // alone, a new PNG came through as added lines of
    // `from_utf8(...).unwrap_or("")` — i.e. blank ones.
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    // A PNG header plus NULs — binary by git's own NUL-in-first-8k rule.
    let mut bytes: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    bytes.extend_from_slice(&[0u8; 64]);
    std::fs::write(tr.path().join("logo.png"), &bytes).unwrap();

    let out = backend
        .diff_ref_to_workdir(&handle.id, "HEAD", 3, false, true)
        .unwrap();
    let png = out
        .files
        .iter()
        .find(|f| f.path == "logo.png")
        .expect("untracked binary should still be listed");
    assert!(png.binary, "untracked PNG must be flagged binary");
    assert_eq!(png.additions, 0, "a binary file has no added LINES");
    assert!(png.hunks.is_empty());
}

// --- ahead_behind ----------------------------------------------------------

#[test]
fn ahead_behind_counts_a_diverged_pair_both_ways() {
    let tr = diverged();
    let (backend, handle) = tr.open_with_backend();

    let ab = backend.ahead_behind(&handle.id, "main", "feature").unwrap();
    // `ahead` is "on b, not on a" — 3 feature commits.
    assert_eq!(ab.ahead, 3, "{ab:?}");
    assert_eq!(ab.behind, 2, "{ab:?}");
    let base = ab.merge_base.clone().expect("shared history has a base");

    let mirrored = backend.ahead_behind(&handle.id, "feature", "main").unwrap();
    assert_eq!(mirrored.ahead, 2);
    assert_eq!(mirrored.behind, 3);
    assert_eq!(mirrored.merge_base.as_deref(), Some(base.as_str()));

    // The base is the initial commit — the fork point, not either tip.
    let initial = backend
        .log(&handle.id, None, 50)
        .unwrap()
        .last()
        .unwrap()
        .oid
        .clone();
    assert_eq!(base, initial);
}

#[test]
fn ahead_behind_is_zero_on_one_side_for_an_ancestor() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();
    let initial = backend.log(&handle.id, None, 10).unwrap()[0].oid.clone();
    write_file(tr.path(), "a.txt", "a\n");
    tr.commit_all("second");

    let ab = backend.ahead_behind(&handle.id, &initial, "HEAD").unwrap();
    assert_eq!(ab.ahead, 1);
    assert_eq!(ab.behind, 0);
    assert_eq!(ab.merge_base.as_deref(), Some(initial.as_str()));
}

#[test]
fn ahead_behind_reports_no_merge_base_for_unrelated_histories() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    // An orphan root: a second commit with no parents, on its own ref.
    {
        let repo = git2::Repository::open(tr.path()).unwrap();
        write_file(tr.path(), "orphan.txt", "orphan\n");
        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("orphan.txt"))
            .unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();
        let sig = git2::Signature::now("Test", "test@example.com").unwrap();
        repo.commit(Some("refs/heads/orphan"), &sig, &sig, "orphan root", &tree, &[])
            .unwrap();
    }

    let ab = backend.ahead_behind(&handle.id, "main", "orphan").unwrap();
    assert_eq!(ab.merge_base, None, "unrelated histories share no base");
    assert!(ab.ahead >= 1 && ab.behind >= 1, "{ab:?}");
}

#[test]
fn ahead_behind_rejects_an_unresolvable_revspec() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .ahead_behind(&handle.id, "HEAD", "no-such-ref")
        .unwrap_err();
    assert!(
        matches!(err, AppError::InvalidRef(ref s) if s == "no-such-ref"),
        "expected InvalidRef, got {err:?}"
    );
}

// --- commits_between -------------------------------------------------------

#[test]
fn commits_between_walks_a_diverged_pair_in_both_directions() {
    let tr = diverged();
    let (backend, handle) = tr.open_with_backend();

    // `main..feature` — the 3 commits only on feature, newest-first. Crucially
    // neither ref is an ancestor of the other, which is exactly what
    // `commits_since` refuses; this op must not.
    let ahead = backend
        .commits_between(&handle.id, "main", "feature", 50)
        .unwrap();
    let subjects: Vec<&str> = ahead.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(subjects, vec!["feature 2", "feature 1", "feature 0"]);

    let behind = backend
        .commits_between(&handle.id, "feature", "main", 50)
        .unwrap();
    let subjects: Vec<&str> = behind.iter().map(|c| c.summary.as_str()).collect();
    assert_eq!(subjects, vec!["main 1", "main 0"]);
}

#[test]
fn commits_between_honours_the_limit_and_is_empty_for_an_ancestor() {
    let tr = diverged();
    let (backend, handle) = tr.open_with_backend();

    let capped = backend
        .commits_between(&handle.id, "main", "feature", 1)
        .unwrap();
    assert_eq!(capped.len(), 1);
    assert_eq!(capped[0].summary, "feature 2");

    // Nothing is reachable from a tip that is not already reachable from itself.
    let none = backend
        .commits_between(&handle.id, "feature", "feature", 50)
        .unwrap();
    assert!(none.is_empty());
}

// --- diff_commits now takes user-typed revspecs too ------------------------

#[test]
fn diff_commits_rejects_an_unresolvable_revspec_as_invalid_ref() {
    // The compare screen fires `ahead_behind`, two `commits_between` and this
    // one in a single `Promise.all`, and the rejection the user sees is
    // whichever lands first. A bare `?` here made the SAME typo report either
    // `InvalidRef` or a stringified libgit2 message depending on the race.
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    for (from, to) in [("zzz", "HEAD"), ("HEAD", "zzz")] {
        let err = backend
            .diff_commits(&handle.id, from, to, 3, false)
            .unwrap_err();
        assert!(
            matches!(err, AppError::InvalidRef(ref s) if s == "zzz"),
            "expected InvalidRef(\"zzz\") for {from}..{to}, got {err:?}"
        );
    }
}

#[test]
fn commits_between_rejects_an_unresolvable_revspec() {
    let tr = TempRepo::with_initial_commit("base\n");
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .commits_between(&handle.id, "no-such-ref", "HEAD", 10)
        .unwrap_err();
    assert!(
        matches!(err, AppError::InvalidRef(ref s) if s == "no-such-ref"),
        "expected InvalidRef, got {err:?}"
    );
}
