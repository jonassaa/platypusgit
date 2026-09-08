//! `amend_head_message` — replace HEAD's commit message and nothing else.
//!
//! The distinguishing property, asserted from several angles below, is that this
//! op does NOT read the index. `commit(amend: true)` writes the index tree and
//! would fold staged changes into the commit being reworded; this one passes
//! `tree: None` to `Commit::amend`, which reuses the original tree. That is what
//! makes it usable with a dirty worktree — the case the rebase engine refuses,
//! and the case rewording HEAD almost always is.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

/// The whole point of the op: the message changes, the tree does not.
#[test]
fn amend_changes_the_message_and_keeps_the_tree() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    let before = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let tree_before = before.tree_id();
    let author_before = before.author().when().seconds();
    let author_name_before = before.author().name().unwrap().to_string();

    let out = backend
        .amend_head_message(&handle.id, &before.id().to_string(), "reworded", false)
        .expect("amend");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "reworded");
    assert_eq!(after.tree_id(), tree_before, "tree must be untouched");
    assert_ne!(after.id(), before.id(), "a reworded commit is a new object");
    assert_eq!(out.oid, after.id().to_string());
    assert_eq!(out.message, "reworded");
    assert_eq!(after.parent_count(), before.parent_count());

    // Author is PRESERVED and only the committer is refreshed, which is what
    // git's own `--amend` does. Note this deliberately differs from
    // `commit(amend: true)`, which passes the current signature as the author
    // too.
    assert_eq!(after.author().when().seconds(), author_before);
    assert_eq!(after.author().name().unwrap(), author_name_before);
}

/// The reason the op takes `expected_oid` at all: HEAD can move between a
/// context menu opening and its click landing.
#[test]
fn amend_refuses_when_head_has_moved() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let stale = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    tr.add_commit("other.txt", "x\n", "a second commit");

    let err = backend
        .amend_head_message(&handle.id, &stale, "reworded", false)
        .expect_err("must refuse a stale oid");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");

    // And it changed nothing.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.message().unwrap(), "a second commit");
}

/// A dirty worktree is exactly the case the rebase engine cannot serve
/// (`rebase_start_with_progress` bails on any wt/index modification), so this op
/// must serve it — and must leave the dirt alone.
#[test]
fn amend_works_with_a_dirty_worktree_and_does_not_consume_it() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "README.md", "hello, edited\n");
    write_file(tr.path(), "untracked.txt", "new\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let tree_before = head.tree_id();

    backend
        .amend_head_message(&handle.id, &head.id().to_string(), "reworded", false)
        .expect("amend with a dirty worktree");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "reworded");
    assert_eq!(after.tree_id(), tree_before, "the edit must NOT be committed");
    assert_eq!(
        support::fs::read_file(tr.path(), "README.md"),
        "hello, edited\n",
        "the working tree must be left as it was"
    );
    assert_eq!(
        support::fs::read_file(tr.path(), "untracked.txt"),
        "new\n",
        "an untracked file must survive too"
    );
}

/// The index is the other half of that guarantee, and the sharper half: this is
/// the assertion that fails if the op is ever reimplemented on top of
/// `commit(amend: true)`.
#[test]
fn amend_ignores_staged_changes() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_file(tr.path(), "staged.txt", "staged\n");
    {
        let mut index = tr.repo.index().unwrap();
        index.add_path(std::path::Path::new("staged.txt")).unwrap();
        index.write().unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();

    backend
        .amend_head_message(&handle.id, &head.id().to_string(), "reworded", false)
        .expect("amend");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.tree_id(), head.tree_id());
    assert!(
        after.tree().unwrap().get_name("staged.txt").is_none(),
        "the staged file must not be in the reworded commit"
    );

    // Still staged afterwards — the reword neither consumed nor cleared it.
    let idx = tr.repo.index().unwrap();
    assert!(
        idx.get_path(std::path::Path::new("staged.txt"), 0).is_some(),
        "the file must still be staged after the reword"
    );
}

/// An empty message is refused on this side of the IPC boundary, as `commit`
/// does — every caller of this method is a caller that meant to write history.
#[test]
fn amend_refuses_an_empty_message() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    let err = backend
        .amend_head_message(&handle.id, &head, "   \n ", false)
        .expect_err("must refuse a whitespace-only message");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "initial", "nothing may change");
}

/// An unborn HEAD has no commit to reword.
#[test]
fn amend_refuses_on_an_unborn_head() {
    let tr = TempRepo::fresh();
    let (backend, handle) = tr.open_with_backend();

    let err = backend
        .amend_head_message(&handle.id, &"0".repeat(40), "x", false)
        .expect_err("must refuse on an unborn HEAD");
    assert!(matches!(err, AppError::Unborn), "got {err:?}");
}

/// The reflog says what git says for an amend, so `Mod+Z` and the reflog screen
/// both describe it recognisably.
#[test]
fn amend_leaves_a_reflog_entry() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    backend
        .amend_head_message(&handle.id, &head, "reworded", false)
        .expect("amend");

    let entries = backend.read_reflog(&handle.id).expect("reflog");
    assert!(
        entries.iter().any(|e| e.message.contains("reworded")),
        "expected a reflog entry naming the new message, got {:?}",
        entries.iter().map(|e| &e.message).collect::<Vec<_>>()
    );
}

/// `commit-msg` gets to refuse a reword — that hook validates message format,
/// which is exactly what a reword changes.
#[test]
fn a_commit_msg_hook_can_refuse_the_reword() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(tr.path(), "commit-msg", "#!/bin/sh\necho 'bad subject'\nexit 1\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    let err = backend
        .amend_head_message(&handle.id, &head, "nope", false)
        .expect_err("the hook must be able to refuse");
    assert!(matches!(err, AppError::HookRejected(_)), "got {err:?}");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(
        after.message().unwrap(),
        "initial",
        "a refused reword must create nothing"
    );
}

/// A `commit-msg` hook that REWRITES the message is honoured, as in `commit`.
#[test]
fn a_commit_msg_hook_can_rewrite_the_message() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(
        tr.path(),
        "commit-msg",
        "#!/bin/sh\nprintf 'rewritten by the hook\\n' > \"$1\"\n",
    );
    let (backend, handle) = tr.open_with_backend();
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    let out = backend
        .amend_head_message(&handle.id, &head, "what I typed", false)
        .expect("amend");

    assert_eq!(out.message, "rewritten by the hook\n");
    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "rewritten by the hook\n");
}

/// `pre-commit` is deliberately NOT run: this op cannot change the tree, so a
/// hook that lints content has nothing to inspect. A documented deviation from
/// `git commit --amend --only`, which runs it.
#[test]
fn pre_commit_does_not_run_because_the_tree_cannot_change() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let marker = tr.path().join("pre-commit-ran");
    write_hook(
        tr.path(),
        "pre-commit",
        &format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
    );
    let (backend, handle) = tr.open_with_backend();
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    backend
        .amend_head_message(&handle.id, &head, "reworded", false)
        .expect("amend");

    assert!(
        !marker.exists(),
        "pre-commit must not run for a message-only amend"
    );
}

/// `no_verify` skips the message hooks, matching `commit`'s own option.
#[test]
fn no_verify_skips_the_message_hooks() {
    let tr = TempRepo::with_initial_commit("hello\n");
    write_hook(tr.path(), "commit-msg", "#!/bin/sh\nexit 1\n");
    let (backend, handle) = tr.open_with_backend();
    let head = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .id()
        .to_string();

    backend
        .amend_head_message(&handle.id, &head, "reworded", true)
        .expect("no_verify must skip the refusing hook");

    let after = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(after.message().unwrap(), "reworded");
}

/// A refused reword must not have run the message hook at all — the stale-oid
/// check happens before them, so nobody's hook fires for an operation that was
/// always going to be refused.
#[test]
fn a_stale_oid_is_refused_before_any_hook_runs() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let marker = tr.path().join("commit-msg-ran");
    write_hook(
        tr.path(),
        "commit-msg",
        &format!("#!/bin/sh\ntouch '{}'\n", marker.display()),
    );
    let (backend, handle) = tr.open_with_backend();
    let stale = "0".repeat(40);

    backend
        .amend_head_message(&handle.id, &stale, "reworded", false)
        .expect_err("must refuse");

    assert!(
        !marker.exists(),
        "no hook may run for a reword that is refused outright"
    );
}

/// Write an executable hook into the repo's `.git/hooks`.
fn write_hook(root: &std::path::Path, name: &str, body: &str) {
    let dir = root.join(".git").join("hooks");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    std::fs::write(&path, body).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}
