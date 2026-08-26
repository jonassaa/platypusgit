//! Git hook execution (issue 232).
//!
//! These run **real hook scripts** against real temp repos, because the whole
//! feature is a contract with git and a mocked hook would only assert that our
//! mock works. Every script here is `/bin/sh`, which is what a hook is.
//!
//! Unix-only: the scripts have shebangs and the executable-bit semantics under
//! test do not exist on Windows. The Windows path is `git hook run`'s own `sh`
//! shim, which is precisely the part we deliberately did not reimplement.
#![cfg(unix)]

mod support;

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use platypusgit_lib::git::hooks::{run_direct_for_test, run_hook};
use support::TempRepo;

/// Write an executable hook into `.git/hooks`.
fn write_hook(repo: &Path, name: &str, body: &str) -> std::path::PathBuf {
    let dir = repo.join(".git").join("hooks");
    fs::create_dir_all(&dir).expect("hooks dir");
    let path = dir.join(name);
    fs::write(&path, body).expect("write hook");
    chmod(&path, 0o755);
    path
}

fn chmod(path: &Path, mode: u32) {
    let mut perms = fs::metadata(path).expect("metadata").permissions();
    perms.set_mode(mode);
    fs::set_permissions(path, perms).expect("set_permissions");
}

#[test]
fn a_rejecting_hook_reports_its_output_and_its_exit_code() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(
        tr.path(),
        "pre-commit",
        "#!/bin/sh\necho 'lint failed on a.ts'\nexit 3\n",
    );

    let out = run_hook(tr.path(), "pre-commit", &[]).expect("run_hook");
    assert!(out.ran, "the hook exists and is executable, so it ran");
    assert_eq!(out.code, 3, "the exit code propagates verbatim");
    assert!(out.rejected());
    assert!(
        out.output.contains("lint failed on a.ts"),
        "the hook's stdout must be captured — git hook run sends it to stderr; got {:?}",
        out.output
    );
}

#[test]
fn a_passing_hook_is_not_a_rejection_but_its_output_is_still_captured() {
    // A formatter that reports what it changed is useful output on success.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(
        tr.path(),
        "pre-commit",
        "#!/bin/sh\necho 'reformatted 2 files'\nexit 0\n",
    );

    let out = run_hook(tr.path(), "pre-commit", &[]).expect("run_hook");
    assert!(!out.rejected());
    assert!(out.output.contains("reformatted 2 files"));
}

#[test]
fn a_missing_hook_is_not_an_error_and_not_a_rejection() {
    // The overwhelmingly common case: no hooks at all.
    let tr = TempRepo::with_initial_commit("hello\n");
    let out = run_hook(tr.path(), "commit-msg", &[]).expect("run_hook");
    assert!(!out.ran, "an absent hook did not run");
    assert!(!out.rejected(), "absent is not a refusal");
}

#[test]
fn a_non_executable_hook_is_skipped_the_way_git_skips_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let path = write_hook(tr.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    chmod(&path, 0o644);

    let out = run_hook(tr.path(), "pre-commit", &[]).expect("run_hook");
    assert!(
        !out.rejected(),
        "a hook git would skip must not reject the commit; got {out:?}"
    );
    // THE invariant, pinned where it lives: a skipped hook reports code 0.
    // Reporting non-zero for "I didn't run it" would block every commit in a
    // repository whose hooks were checked out without their executable bit.
    assert_eq!(out.code, 0, "a skipped hook must report success; got {out:?}");
}

#[test]
fn core_hooks_path_wins_over_the_default_location() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let custom = tr.path().join("myhooks");
    fs::create_dir_all(&custom).expect("custom hooks dir");
    let path = custom.join("pre-commit");
    fs::write(&path, "#!/bin/sh\necho 'from myhooks'\nexit 7\n").expect("write");
    chmod(&path, 0o755);
    // The hook in the default location must lose.
    write_hook(
        tr.path(),
        "pre-commit",
        "#!/bin/sh\necho 'from .git/hooks'\nexit 0\n",
    );
    tr.repo
        .config()
        .expect("config")
        .set_str("core.hooksPath", "myhooks")
        .expect("set hooksPath");

    let out = run_hook(tr.path(), "pre-commit", &[]).expect("run_hook");
    assert_eq!(out.code, 7);
    assert!(out.output.contains("from myhooks"));
    assert!(!out.output.contains("from .git/hooks"));
}

#[test]
fn arguments_reach_the_hook_and_a_rewrite_of_the_first_survives() {
    // The prepare-commit-msg / commit-msg shape: the hook is handed a file and
    // may rewrite it in place.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(
        tr.path(),
        "prepare-commit-msg",
        "#!/bin/sh\nprintf 'source=%s\\n' \"$2\"\necho 'appended by hook' >> \"$1\"\n",
    );
    let msg = tr.path().join(".git").join("COMMIT_EDITMSG");
    fs::write(&msg, "original\n").expect("seed message");

    let out = run_hook(
        tr.path(),
        "prepare-commit-msg",
        &[msg.to_str().unwrap(), "message"],
    )
    .expect("run_hook");

    assert!(!out.rejected());
    assert!(
        out.output.contains("source=message"),
        "the second argument reached the hook; got {:?}",
        out.output
    );
    let after = fs::read_to_string(&msg).expect("read back");
    assert!(
        after.contains("appended by hook"),
        "the hook's rewrite must persist; got {after:?}"
    );
}

#[test]
fn a_hook_that_refuses_silently_is_still_a_rejection() {
    // Exit 1, print nothing. The commit must still be refused, and the UI has
    // only the hook's NAME to show — which is why the error carries it.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(tr.path(), "commit-msg", "#!/bin/sh\nexit 1\n");

    let out = run_hook(tr.path(), "commit-msg", &[]).expect("run_hook");
    assert!(out.rejected());
    assert!(out.output.is_empty());
}

#[test]
fn the_direct_exec_fallback_matches_git_hook_runs_semantics() {
    // Called directly: `run_hook` reaches the fallback only on a git older than
    // 2.36, which is no machine this test ever runs on. Without this the
    // fallback would be exercised on Ubuntu 22.04 and nowhere else.
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(
        tr.path(),
        "pre-commit",
        "#!/bin/sh\necho 'fallback ran'\nexit 4\n",
    );

    let out = run_direct_for_test(tr.path(), "pre-commit", &[]).expect("fallback");
    assert_eq!(out.code, 4);
    assert!(out.rejected());
    assert!(out.output.contains("fallback ran"));
}

#[test]
fn the_fallback_skips_a_missing_hook_and_a_non_executable_one() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let missing = run_direct_for_test(tr.path(), "pre-commit", &[]).expect("fallback");
    assert!(!missing.ran);

    let path = write_hook(tr.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    chmod(&path, 0o644);
    let not_exec = run_direct_for_test(tr.path(), "pre-commit", &[]).expect("fallback");
    assert!(!not_exec.ran, "the fallback honours the executable bit too");
    assert!(!not_exec.rejected());
    // Same invariant as the `git hook run` path: skipped means code 0.
    assert_eq!(missing.code, 0, "a missing hook must report success");
    assert_eq!(not_exec.code, 0, "a non-executable hook must report success");
}

#[test]
fn the_fallback_honours_core_hooks_path() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let custom = tr.path().join("elsewhere");
    fs::create_dir_all(&custom).expect("dir");
    let path = custom.join("pre-commit");
    fs::write(&path, "#!/bin/sh\nexit 5\n").expect("write");
    chmod(&path, 0o755);
    tr.repo
        .config()
        .expect("config")
        .set_str("core.hooksPath", "elsewhere")
        .expect("set hooksPath");

    let out = run_direct_for_test(tr.path(), "pre-commit", &[]).expect("fallback");
    assert_eq!(out.code, 5);
}

// ---------------------------------------------------------------------------
// The commit sequence (issue 232).
//
// These go through the real backend, because the guarantee under test is about
// what ends up in the object database — not about which functions got called.
// ---------------------------------------------------------------------------

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::{CommitOptions, RepoId};
use platypusgit_lib::git::GitBackend;
use std::path::PathBuf;

/// Stage `name` with the given body and return an options struct for it.
fn stage(backend: &impl GitBackend, id: &RepoId, tr: &TempRepo, name: &str, body: &str) {
    support::fs::write_file(tr.path(), name, body);
    backend.stage(id, &[PathBuf::from(name)]).expect("stage");
}

fn opts(message: &str) -> CommitOptions {
    CommitOptions {
        message: message.into(),
        ..Default::default()
    }
}

fn head_oid(tr: &TempRepo) -> Option<String> {
    let repo = git2::Repository::open(tr.path()).expect("open");
    repo.head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok())
        .map(|c| c.id().to_string())
}

fn count_commits(tr: &TempRepo) -> usize {
    let repo = git2::Repository::open(tr.path()).expect("open");
    let mut walk = repo.revwalk().expect("revwalk");
    walk.push_head().expect("push head");
    walk.count()
}

fn message_of(tr: &TempRepo, oid: &str) -> String {
    let repo = git2::Repository::open(tr.path()).expect("open");
    let id = git2::Oid::from_str(oid).expect("oid");
    let commit = repo.find_commit(id).expect("find");
    commit.message().unwrap_or("").to_string()
}

fn blob_at(tr: &TempRepo, oid: &str, path: &str) -> String {
    let repo = git2::Repository::open(tr.path()).expect("open");
    let id = git2::Oid::from_str(oid).expect("oid");
    // Each step gets its own binding: chaining off `find_commit(..)` borrows a
    // temporary that drops at the end of the statement.
    let commit = repo.find_commit(id).expect("find");
    let tree = commit.tree().expect("tree");
    let entry = tree.get_path(Path::new(path)).expect("entry");
    let blob = repo.find_blob(entry.id()).expect("blob");
    String::from_utf8_lossy(blob.content()).to_string()
}

#[test]
fn a_rejecting_pre_commit_creates_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(tr.path(), "pre-commit", "#!/bin/sh\necho 'NOPE: lint'\nexit 1\n");
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let before = head_oid(&tr);
    let err = backend
        .commit(&handle.id, opts("subject"))
        .expect_err("the hook refused, so the commit must fail");

    match err {
        AppError::HookRejected(r) => {
            assert_eq!(r.hook, "pre-commit");
            assert!(
                r.output.contains("NOPE: lint"),
                "the hook's own words must reach the user; got {:?}",
                r.output
            );
        }
        other => panic!("expected HookRejected, got {other:?}"),
    }
    assert_eq!(head_oid(&tr), before, "HEAD must not move");
    assert_eq!(count_commits(&tr), 1, "no commit object was created");
}

#[test]
fn a_rejecting_commit_msg_creates_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(tr.path(), "commit-msg", "#!/bin/sh\necho 'bad subject'\nexit 1\n");
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let before = head_oid(&tr);
    let err = backend.commit(&handle.id, opts("nope")).expect_err("refused");
    assert!(
        matches!(&err, AppError::HookRejected(r) if r.hook == "commit-msg"),
        "got {err:?}"
    );
    assert_eq!(head_oid(&tr), before);
    assert_eq!(count_commits(&tr), 1);
}

#[test]
fn a_rejecting_prepare_commit_msg_creates_nothing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(
        tr.path(),
        "prepare-commit-msg",
        "#!/bin/sh\necho 'refusing to prepare'\nexit 1\n",
    );
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let err = backend.commit(&handle.id, opts("subject")).expect_err("refused");
    assert!(
        matches!(&err, AppError::HookRejected(r) if r.hook == "prepare-commit-msg"),
        "got {err:?}"
    );
    assert_eq!(count_commits(&tr), 1);
}

#[test]
fn a_pre_commit_that_restages_is_honoured() {
    // THE ordering test. `lint-staged`'s shape: reformat a file, `git add` it,
    // exit 0 — and the commit must contain the reformatted content. That only
    // works if the index is read AFTER pre-commit. Move the read back to the top
    // of `commit()` and this fails.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(
        tr.path(),
        "pre-commit",
        "#!/bin/sh\nprintf 'fixed\\n' > a.txt\ngit add a.txt\nexit 0\n",
    );
    stage(&backend, &handle.id, &tr, "a.txt", "unfixed\n");

    let res = backend.commit(&handle.id, opts("subject")).expect("commit");
    assert_eq!(
        blob_at(&tr, &res.oid, "a.txt").trim(),
        "fixed",
        "the hook's restaged content must be what landed"
    );
}

#[test]
fn a_rewriting_commit_msg_decides_the_final_message() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(
        tr.path(),
        "commit-msg",
        "#!/bin/sh\nprintf 'REWRITTEN\\n' > \"$1\"\n",
    );
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let res = backend
        .commit(&handle.id, opts("typed by the user"))
        .expect("commit");
    assert_eq!(
        res.message.trim(),
        "REWRITTEN",
        "the RETURNED message is what landed, so the panel can show the truth"
    );
    assert_eq!(
        message_of(&tr, &res.oid).trim(),
        "REWRITTEN",
        "and the object itself agrees"
    );
}

#[test]
fn a_rewriting_prepare_commit_msg_also_reaches_the_object() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(
        tr.path(),
        "prepare-commit-msg",
        "#!/bin/sh\nprintf '\\nRefs: #232\\n' >> \"$1\"\n",
    );
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let res = backend.commit(&handle.id, opts("subject")).expect("commit");
    assert!(
        res.message.contains("Refs: #232"),
        "prepare-commit-msg's addition must survive; got {:?}",
        res.message
    );
    assert!(message_of(&tr, &res.oid).contains("Refs: #232"));
}

#[test]
fn commit_msg_sees_the_signoff_trailer_already_applied() {
    // Matches `git commit -s`, verified against real git: the trailer is in the
    // file before commit-msg reads it, so a hook validating trailers passes.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(
        tr.path(),
        "commit-msg",
        "#!/bin/sh\ngrep -q 'Signed-off-by:' \"$1\" || { echo 'no trailer'; exit 1; }\n",
    );
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let res = backend
        .commit(
            &handle.id,
            CommitOptions {
                signoff: true,
                ..opts("subject")
            },
        )
        .expect("the trailer must already be there when commit-msg runs");
    assert!(res.message.contains("Signed-off-by:"));
}

#[test]
fn no_verify_skips_a_rejecting_hook_and_a_rewriting_one() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(tr.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    write_hook(
        tr.path(),
        "commit-msg",
        "#!/bin/sh\nprintf 'REWRITTEN\\n' > \"$1\"\n",
    );
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let res = backend
        .commit(
            &handle.id,
            CommitOptions {
                no_verify: true,
                ..opts("verbatim subject")
            },
        )
        .expect("no_verify must get past a rejecting hook");
    assert_eq!(
        res.message.trim(),
        "verbatim subject",
        "no hook touched the message"
    );
    assert_eq!(count_commits(&tr), 2);
}

#[test]
fn a_failing_post_commit_does_not_fail_the_commit() {
    // git ignores post-commit's exit code, and so must we: reporting a commit
    // that EXISTS as failed sends the user hunting for work that already landed.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(tr.path(), "post-commit", "#!/bin/sh\necho 'boom'\nexit 9\n");
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let res = backend
        .commit(&handle.id, opts("subject"))
        .expect("post-commit must not be able to fail the commit");
    assert_eq!(count_commits(&tr), 2);
    assert_eq!(head_oid(&tr).as_deref(), Some(res.oid.as_str()));
}

#[test]
fn a_repo_with_no_hooks_commits_exactly_as_before() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let res = backend
        .commit(&handle.id, opts("plain subject"))
        .expect("commit");
    assert_eq!(res.message.trim(), "plain subject");
    assert_eq!(count_commits(&tr), 2);
}

#[test]
fn a_rejecting_pre_commit_with_signing_on_signs_nothing() {
    // Both guarantees at once: the hook creates nothing, and the signing chain
    // is never reached — so there is no signed-but-unreferenced object either.
    // Signing is left to fail on purpose (no key configured); the point is that
    // we never get that far.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    write_hook(tr.path(), "pre-commit", "#!/bin/sh\nexit 1\n");
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");

    let before = head_oid(&tr);
    let err = backend
        .commit(
            &handle.id,
            CommitOptions {
                sign: Some(true),
                ..opts("subject")
            },
        )
        .expect_err("refused");
    assert!(
        matches!(&err, AppError::HookRejected(r) if r.hook == "pre-commit"),
        "the hook must refuse BEFORE signing is attempted; got {err:?}"
    );
    assert_eq!(head_oid(&tr), before);
    assert_eq!(count_commits(&tr), 1);
}

#[test]
fn an_amend_runs_the_hooks_too() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    stage(&backend, &handle.id, &tr, "a.txt", "a\n");
    backend.commit(&handle.id, opts("original")).expect("commit");

    write_hook(
        tr.path(),
        "commit-msg",
        "#!/bin/sh\nprintf 'AMEND REWRITTEN\\n' > \"$1\"\n",
    );
    let res = backend
        .commit(
            &handle.id,
            CommitOptions {
                amend: true,
                ..opts("amended by the user")
            },
        )
        .expect("amend");

    assert_eq!(res.message.trim(), "AMEND REWRITTEN");
    assert_eq!(count_commits(&tr), 2, "an amend replaces, it does not add");
}
