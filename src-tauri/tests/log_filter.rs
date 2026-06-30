mod support;

use std::path::Path;

use git2::Signature;
use platypusgit_lib::git::types::LogFilter;
use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

/// Commit `filename`=`contents` with a specific author + message + time.
fn commit_as(tr: &TempRepo, filename: &str, contents: &str, msg: &str, name: &str, email: &str, when: i64) {
    write_file(tr.path(), filename, contents);
    let mut index = tr.repo.index().unwrap();
    index.add_path(Path::new(filename)).unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    let tree = tr.repo.find_tree(tree_oid).unwrap();
    let sig = Signature::new(name, email, &git2::Time::new(when, 0)).unwrap();
    let parents: Vec<git2::Commit> = tr
        .repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .into_iter()
        .collect();
    let parent_refs: Vec<&git2::Commit> = parents.iter().collect();
    tr.repo
        .commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
        .unwrap();
}

/// Seed a repo with four distinct commits across authors/messages/paths/times.
fn seeded() -> TempRepo {
    let tr = TempRepo::fresh();
    // t=1000 — alice, touches a.txt
    commit_as(&tr, "a.txt", "1\n", "add feature alpha", "Alice", "alice@example.com", 1000);
    // t=2000 — bob, touches b.txt
    commit_as(&tr, "b.txt", "1\n", "fix bug in parser", "Bob", "bob@example.com", 2000);
    // t=3000 — alice, touches a.txt again
    commit_as(&tr, "a.txt", "2\n", "refactor alpha module", "Alice", "alice@example.com", 3000);
    // t=4000 — carol, touches c.txt
    commit_as(&tr, "c.txt", "1\n", "docs: update readme", "Carol", "carol@example.com", 4000);
    tr
}

fn summaries(commits: &[platypusgit_lib::git::types::CommitInfo]) -> Vec<String> {
    commits.iter().map(|c| c.summary.clone()).collect()
}

#[test]
fn empty_filter_returns_all_newest_first() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    let out = backend
        .log_filtered(&handle.id, &LogFilter::default(), 100)
        .unwrap();
    assert_eq!(
        summaries(&out),
        vec![
            "docs: update readme",
            "refactor alpha module",
            "fix bug in parser",
            "add feature alpha",
        ]
    );
}

#[test]
fn filter_by_message_substring() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    let filter = LogFilter {
        message: Some("alpha".into()),
        ..Default::default()
    };
    let out = backend.log_filtered(&handle.id, &filter, 100).unwrap();
    assert_eq!(
        summaries(&out),
        vec!["refactor alpha module", "add feature alpha"]
    );
}

#[test]
fn filter_by_message_is_case_insensitive() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    let filter = LogFilter {
        message: Some("BUG".into()),
        ..Default::default()
    };
    let out = backend.log_filtered(&handle.id, &filter, 100).unwrap();
    assert_eq!(summaries(&out), vec!["fix bug in parser"]);
}

#[test]
fn filter_by_author_name_or_email() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();

    let by_name = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                author: Some("alice".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(
        summaries(&by_name),
        vec!["refactor alpha module", "add feature alpha"]
    );

    let by_email = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                author: Some("bob@example.com".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(summaries(&by_email), vec!["fix bug in parser"]);
}

#[test]
fn filter_by_sha_prefix() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    // Grab a real oid from a plain walk.
    let all = backend
        .log_filtered(&handle.id, &LogFilter::default(), 100)
        .unwrap();
    let target = &all[1]; // "refactor alpha module"
    let prefix = &target.oid[..8];
    let out = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                sha_prefix: Some(prefix.to_string()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(out.len(), 1);
    assert_eq!(out[0].oid, target.oid);
}

#[test]
fn filter_by_date_range() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    // since=2000, until=3000 → bob + second alice commit.
    let out = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                since: Some(2000),
                until: Some(3000),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(
        summaries(&out),
        vec!["refactor alpha module", "fix bug in parser"]
    );
}

#[test]
fn filter_by_path() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    let out = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                path: Some("a.txt".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(
        summaries(&out),
        vec!["refactor alpha module", "add feature alpha"]
    );
}

#[test]
fn filters_are_anded_together() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    // author=alice AND message contains "refactor" → only one.
    let out = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                author: Some("alice".into()),
                message: Some("refactor".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(summaries(&out), vec!["refactor alpha module"]);
}

#[test]
fn limit_caps_matching_commits() {
    let tr = seeded();
    let (backend, handle) = tr.open_with_backend();
    let out = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                author: Some("alice".into()),
                ..Default::default()
            },
            1,
        )
        .unwrap();
    assert_eq!(summaries(&out), vec!["refactor alpha module"]);
}

// --- path filter on root / merge commits ---

/// Seed a repo whose first commit (root, no parents) creates `root.txt`,
/// then a second ordinary commit touching `b.txt`. The root commit is the
/// `parent_count() == 0` branch of `commit_touches_path`.
#[test]
fn path_filter_matches_root_commit() {
    let tr = TempRepo::fresh();
    commit_as(&tr, "root.txt", "1\n", "root commit", "Alice", "alice@example.com", 1000);
    commit_as(&tr, "b.txt", "1\n", "second commit", "Bob", "bob@example.com", 2000);
    let (backend, handle) = tr.open_with_backend();

    // Matching path on the root commit.
    let hit = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                path: Some("root.txt".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(summaries(&hit), vec!["root commit"]);

    // Non-matching path: present in no commit's tree change set.
    let miss = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                path: Some("nope.txt".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert!(miss.is_empty());
}

/// Build a merge commit whose tree differs from one parent (added `merged.txt`)
/// but matches neither parent for an unrelated path. Exercises the
/// OR-over-parents branch of `commit_touches_path`.
fn seeded_with_merge() -> TempRepo {
    let tr = TempRepo::fresh();

    // All borrows of `tr.repo` are confined to this block so they drop before
    // `tr` is returned/moved.
    {
        let repo = &tr.repo;
        let sig = Signature::new("Mona", "mona@example.com", &git2::Time::new(1000, 0)).unwrap();

        // Stage `files` into the index and write a commit with `parents`.
        let stage_commit = |files: &[(&str, &str)], msg: &str, parents: &[git2::Oid]| -> git2::Oid {
            for (name, body) in files {
                write_file(tr.path(), name, body);
            }
            let mut index = repo.index().unwrap();
            for (name, _) in files {
                index.add_path(Path::new(name)).unwrap();
            }
            index.write().unwrap();
            let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
            let parent_commits: Vec<git2::Commit> =
                parents.iter().map(|o| repo.find_commit(*o).unwrap()).collect();
            let parent_refs: Vec<&git2::Commit> = parent_commits.iter().collect();
            repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parent_refs)
                .unwrap()
        };

        // Root commit on main: base.txt
        let base = stage_commit(&[("base.txt", "base\n")], "base", &[]);

        // Feature branch off base: adds feature.txt
        let base_commit = repo.find_commit(base).unwrap();
        repo.branch("feature", &base_commit, false).unwrap();
        drop(base_commit);
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        let feat = stage_commit(&[("feature.txt", "feat\n")], "feature", &[base]);

        // Back to main, add main.txt
        repo.set_head("refs/heads/main").unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .unwrap();
        let main = stage_commit(&[("main.txt", "main\n")], "main work", &[base]);

        // Merge feature into main; merge commit also introduces merged.txt.
        // Tree = base + main.txt + feature.txt + merged.txt.
        stage_commit(
            &[("main.txt", "main\n"), ("feature.txt", "feat\n"), ("merged.txt", "merged\n")],
            "merge feature",
            &[main, feat],
        );
    }

    tr
}

#[test]
fn path_filter_matches_merge_commit() {
    let tr = seeded_with_merge();
    let (backend, handle) = tr.open_with_backend();

    // merged.txt was introduced by the merge commit itself — differs from
    // BOTH parents, so it matches.
    let merged = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                path: Some("merged.txt".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(summaries(&merged), vec!["merge feature"]);

    // feature.txt: the merge's tree matches the feature parent but differs
    // from the main parent → OR-over-parents matches the merge commit too.
    let feat = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                path: Some("feature.txt".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert_eq!(summaries(&feat), vec!["merge feature", "feature"]);

    // Non-matching path: never present anywhere → no commit matches.
    let miss = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                path: Some("ghost.txt".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert!(miss.is_empty());
}

#[test]
fn unborn_head_returns_empty() {
    let tr = TempRepo::fresh();
    let (backend, handle) = tr.open_with_backend();
    let out = backend
        .log_filtered(
            &handle.id,
            &LogFilter {
                message: Some("anything".into()),
                ..Default::default()
            },
            100,
        )
        .unwrap();
    assert!(out.is_empty());
}
