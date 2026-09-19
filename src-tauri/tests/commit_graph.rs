//! Commit-graph maintenance (#483).
//!
//! The file itself is what makes `git rev-list --date-order` affordable — 188 ms
//! against 10,123 ms on `torvalds/linux` — so these tests are about the two
//! things that would quietly cost the user: writing when they asked us not to,
//! and paying the full rewrite on every open.

mod support;

use platypusgit_lib::git::commit_graph;
use support::{git_in, TempRepo};

/// Where git puts a split commit-graph, and where it puts a plain one.
fn graph_exists(tr: &TempRepo) -> bool {
    tr.path().join(".git/objects/info/commit-graphs").exists()
        || tr.path().join(".git/objects/info/commit-graph").exists()
}

#[test]
fn writes_one_and_is_cheap_the_second_time() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 20);

    assert!(commit_graph::should_write(&tr.repo));
    assert!(!graph_exists(&tr), "fixture starts without one");

    assert!(commit_graph::write_split(tr.path()));
    assert!(graph_exists(&tr), "a commit-graph must exist afterwards");

    // Idempotent. On the kernel this is the difference between 60 ms and
    // 14.3 s, which is why `--split` is not a preference.
    assert!(commit_graph::write_split(tr.path()));
}

#[test]
fn git_actually_reads_what_we_wrote() {
    // A file git ignores would pass the test above while buying nothing.
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 20);
    commit_graph::write_split(tr.path());

    let verified = git_in(tr.path(), &["commit-graph", "verify"]);
    assert!(
        !verified.contains("error"),
        "git rejected the graph we wrote: {verified}",
    );
}

#[test]
fn respects_core_commitgraph_false() {
    let tr = TempRepo::with_initial_commit("root\n");
    git_in(tr.path(), &["config", "core.commitGraph", "false"]);
    assert!(
        !commit_graph::should_write(&tr.repo),
        "a user who turned git's commit-graph off must not get one anyway",
    );
}

#[test]
fn defaults_to_writing_when_the_config_is_absent() {
    // The default is git's own, and it is the one that makes the log fast —
    // an absent key must not read as "no".
    let tr = TempRepo::with_initial_commit("root\n");
    assert!(commit_graph::should_write(&tr.repo));
}

#[test]
fn refresh_honours_the_opt_out() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 5);
    git_in(tr.path(), &["config", "core.commitGraph", "false"]);

    commit_graph::refresh(tr.path());
    assert!(
        !graph_exists(&tr),
        "refresh wrote a commit-graph into a repository that opted out",
    );
}

#[test]
fn refresh_writes_when_allowed() {
    let tr = TempRepo::with_initial_commit("root\n");
    support::linear_history(&tr, 5);

    commit_graph::refresh(tr.path());
    assert!(graph_exists(&tr));
}
