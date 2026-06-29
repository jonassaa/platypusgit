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
