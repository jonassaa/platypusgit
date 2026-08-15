//! Checking out a pull request's head against a REAL repository (#92).
//!
//! This is the part of the feature most likely to be silently wrong, so it is
//! tested end to end on disk rather than only as argument strings: a fork
//! request's source branch exists on no remote we have, and is reachable only
//! through the ref the forge synthesises on the BASE repository. The fixture
//! reproduces exactly that — a bare "origin" carrying `refs/pull/1/head` at a
//! commit that is on no branch at all, which is what GitHub publishes for a fork
//! PR.
//!
//! No network: `origin` is a local bare repository, and the argument vectors under
//! test are the ones `commands::forge` hands to git.

use std::path::Path;
use std::process::Command;

use platypusgit_lib::forge::checkout::{branch_exists, checkout_args, fetch_args};
use platypusgit_lib::forge::{forge_for, ForgeKind};

fn git(cwd: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_AUTHOR_NAME", "T")
        .env("GIT_AUTHOR_EMAIL", "t@e.test")
        .env("GIT_COMMITTER_NAME", "T")
        .env("GIT_COMMITTER_EMAIL", "t@e.test")
        .output()
        .expect("run git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn git_ok(cwd: &Path, args: &[&str]) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .expect("run git")
        .status
        .success()
}

struct Fixture {
    _dir: tempfile::TempDir,
    /// A work repository with `origin` pointing at the bare one.
    work: std::path::PathBuf,
    /// The commit `refs/pull/1/head` points at, on no branch.
    pr_tip: String,
}

/// A base repo + a clone, with a fork-style PR head published on the base.
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("tempdir");
    let base = dir.path().join("base.git");
    let seed = dir.path().join("seed");
    let work = dir.path().join("work");

    // Seed: one commit on main, then a second commit that lives ONLY under
    // refs/pull/1/head — the shape a fork PR takes on the base repository.
    std::fs::create_dir_all(&seed).unwrap();
    git(&seed, &["init", "-q", "-b", "main", "."]);
    std::fs::write(seed.join("a.txt"), "alpha\n").unwrap();
    git(&seed, &["add", "a.txt"]);
    git(&seed, &["commit", "-qm", "base"]);

    git(&seed, &["checkout", "-q", "-b", "contribution"]);
    std::fs::write(seed.join("b.txt"), "from the fork\n").unwrap();
    git(&seed, &["add", "b.txt"]);
    git(&seed, &["commit", "-qm", "fork work"]);
    let pr_tip = git(&seed, &["rev-parse", "HEAD"]);
    // Publish it the way each forge does, then delete the branch so the ONLY way
    // to reach that commit is a synthesised ref.
    git(&seed, &["update-ref", "refs/pull/1/head", &pr_tip]);
    git(&seed, &["update-ref", "refs/merge-requests/1/head", &pr_tip]);
    git(&seed, &["checkout", "-q", "main"]);
    git(&seed, &["branch", "-qD", "contribution"]);

    // Bare "remote" that keeps refs/pull/* — a plain clone would drop it, so mirror.
    git(
        dir.path(),
        &["clone", "-q", "--mirror", seed.to_str().unwrap(), base.to_str().unwrap()],
    );
    // `file://`, NOT a plain path: a local-path clone HARDLINKS the whole object
    // database, so the PR tip would already be present and the fetch under test
    // would be trivially satisfiable. The file:// transport runs the real
    // pack-negotiation path, so only objects reachable from advertised refs
    // (refs/heads/*, refs/tags/*) come across.
    let base_url = format!("file://{}", base.to_str().unwrap());
    git(
        dir.path(),
        &["clone", "-q", &base_url, work.to_str().unwrap()],
    );

    Fixture {
        _dir: dir,
        work,
        pr_tip,
    }
}

#[test]
fn a_fork_requests_head_is_fetchable_without_the_forks_url() {
    let f = fixture();

    // The commit is genuinely unreachable to start with — otherwise the test
    // would pass without the synthesised ref doing any work.
    assert!(
        !git_ok(&f.work, &["cat-file", "-e", &format!("{}^{{commit}}", f.pr_tip)]),
        "the PR tip should not be in the clone yet"
    );

    let head_ref = forge_for(ForgeKind::GitHub).head_ref(1);
    assert_eq!(head_ref, "refs/pull/1/head");
    git(&f.work, &fetch_args("origin", &head_ref));

    // Landed in FETCH_HEAD, and — deliberately — nowhere under refs/.
    assert_eq!(git(&f.work, &["rev-parse", "FETCH_HEAD"]), f.pr_tip);
    assert!(
        !git_ok(&f.work, &["rev-parse", "--verify", "--quiet", "refs/heads/pr-1"]),
        "the fetch must not create a branch"
    );
}

#[test]
fn checking_out_lands_the_requests_content_on_a_new_local_branch() {
    let f = fixture();
    let head_ref = forge_for(ForgeKind::GitHub).head_ref(1);
    git(&f.work, &fetch_args("origin", &head_ref));

    assert!(!branch_probe(&f.work, "pr-1"));
    git(&f.work, &checkout_args("pr-1", false));

    assert_eq!(git(&f.work, &["rev-parse", "HEAD"]), f.pr_tip);
    assert_eq!(
        git(&f.work, &["rev-parse", "--abbrev-ref", "HEAD"]),
        "pr-1"
    );
    // The file the fork added is really in the worktree.
    assert_eq!(
        std::fs::read_to_string(f.work.join("b.txt")).unwrap(),
        "from the fork\n"
    );
}

#[test]
fn branch_exists_answers_correctly_for_present_and_absent_branches() {
    // Regression: an earlier version passed `--` to `git rev-parse`, after which
    // everything is read as a PATH rather than a revision — so EVERY branch
    // looked absent, and a real collision surfaced as git's own "branch already
    // exists" failure instead of a clean `BranchExists`.
    let f = fixture();
    assert!(branch_probe(&f.work, "main"), "main should exist");
    assert!(!branch_probe(&f.work, "nope"), "nope should not exist");
    // A slash-containing name is the common real case (feat/x).
    git(&f.work, &["branch", "feat/x"]);
    assert!(branch_probe(&f.work, "feat/x"));
}

#[test]
fn force_resets_an_existing_branch_and_plain_checkout_refuses() {
    let f = fixture();
    let head_ref = forge_for(ForgeKind::GitHub).head_ref(1);
    git(&f.work, &fetch_args("origin", &head_ref));

    // A local branch already sitting on something else.
    git(&f.work, &["branch", "pr-1", "main"]);
    let before = git(&f.work, &["rev-parse", "refs/heads/pr-1"]);
    assert_ne!(before, f.pr_tip);

    // Without the caller's confirmation the command never runs `-B`; prove `-b`
    // would fail rather than silently discard the branch.
    assert!(
        !git_ok(&f.work, &checkout_args("pr-1", false)),
        "`-b` must refuse an existing branch"
    );
    assert_eq!(git(&f.work, &["rev-parse", "refs/heads/pr-1"]), before);

    // With confirmation, `-B` moves it onto the request's head.
    git(&f.work, &checkout_args("pr-1", true));
    assert_eq!(git(&f.work, &["rev-parse", "refs/heads/pr-1"]), f.pr_tip);
}

#[test]
fn a_gitlab_request_uses_the_merge_requests_ref() {
    // The fixture publishes the same tip under GitLab's ref namespace too, so
    // this proves the OTHER head_ref string is fetchable — not just that the
    // format! is spelled right.
    let f = fixture();
    let head_ref = forge_for(ForgeKind::GitLab).head_ref(1);
    assert_eq!(head_ref, "refs/merge-requests/1/head");
    git(&f.work, &fetch_args("origin", &head_ref));
    assert_eq!(git(&f.work, &["rev-parse", "FETCH_HEAD"]), f.pr_tip);
}

#[test]
fn the_fetch_argument_vector_carries_the_separator_and_no_tags() {
    // `--` so neither the remote name nor the refspec can be read as an option;
    // `--no-tags` because a PR fetch has no business importing the remote's tags.
    let args = fetch_args("origin", "refs/pull/1/head");
    assert_eq!(
        args,
        vec!["fetch", "--no-tags", "--", "origin", "refs/pull/1/head"]
    );
    // No destination in the refspec: nothing under refs/ is written.
    assert!(!args.iter().any(|a| a.contains(':')));
}

#[test]
fn the_checkout_argument_vector_picks_b_or_capital_b() {
    assert_eq!(
        checkout_args("pr-1", false),
        vec!["checkout", "-b", "pr-1", "FETCH_HEAD"]
    );
    assert_eq!(
        checkout_args("pr-1", true),
        vec!["checkout", "-B", "pr-1", "FETCH_HEAD"]
    );
}

/// `branch_exists` is async; drive it on a tiny runtime.
fn branch_probe(cwd: &Path, name: &str) -> bool {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(branch_exists(cwd, name))
        .expect("branch probe")
}
