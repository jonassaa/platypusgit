// `commit.template` + `core.commentChar` (#252).
//
// git's own way for a repository to seed a commit message. We ignored it
// entirely until this issue: the CLI honours it, so a repo that ships a
// template got a blank box in the app.
//
// What is pinned here is the RESOLUTION — where the file is looked for, and
// which comment prefix governs stripping it. The stripping itself is the
// composer's job (src/features/commits/message/cleanup.ts) so the user can see
// what will be removed before committing; these tests only assert that the
// backend hands over the two facts that decide it.

mod support;

use platypusgit_lib::git::{commit_template::CleanupMode, GitBackend};
use support::TempRepo;

/// Write a file under the repo and point `commit.template` at `value`.
fn with_template(tr: &TempRepo, value: &str) {
    let mut cfg = tr.repo.config().expect("config");
    cfg.set_str("commit.template", value).unwrap();
}

#[test]
fn no_configured_template_is_not_an_error() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.path, None);
    assert_eq!(t.body, None);
    assert!(!t.unreadable);
    // Even with no template the comment prefix is answered: the composer strips
    // comments from a hand-typed message too, exactly as git's editor does.
    assert_eq!(t.comment_prefix, "#");
    // `Default` reaches the frontend unresolved on purpose: it means "strip if
    // the message is to be EDITED, whitespace otherwise", and only the composer
    // knows which of those the box it holds is.
    assert_eq!(t.cleanup, CleanupMode::Default);
}

#[test]
fn commit_cleanup_is_read_and_reported() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    for (value, want) in [
        ("verbatim", CleanupMode::Verbatim),
        ("whitespace", CleanupMode::Whitespace),
        ("strip", CleanupMode::Strip),
        ("scissors", CleanupMode::Scissors),
        ("default", CleanupMode::Default),
        // git errors on an unknown value; we degrade rather than refuse to open
        // the commit screen.
        ("nonsense", CleanupMode::Default),
    ] {
        tr.repo.config().unwrap().set_str("commit.cleanup", value).unwrap();
        let t = backend.commit_template(&handle.id).expect("commit_template");
        assert_eq!(t.cleanup, want, "commit.cleanup = {value}");
    }
}

#[test]
fn a_repo_relative_path_resolves_from_the_worktree_root() {
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), ".gitmessage", "subject\n\n# a hint\n");
    with_template(&tr, ".gitmessage");

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.body.as_deref(), Some("subject\n\n# a hint\n"));
    assert!(!t.unreadable);
    assert!(
        t.path.as_deref().unwrap().ends_with(".gitmessage"),
        "path was {:?}",
        t.path
    );
}

#[test]
fn a_nested_repo_relative_path_resolves_from_the_worktree_root_too() {
    // `git commit` runs after setup_git_directory() has chdir'd to the top of
    // the worktree, so a relative template is worktree-relative — not relative
    // to wherever the user happened to be standing.
    let tr = TempRepo::with_initial_commit("hello\n");
    std::fs::create_dir_all(tr.path().join(".config")).unwrap();
    support::fs::write_file(tr.path(), ".config/msg.txt", "from a subdirectory\n");
    with_template(&tr, ".config/msg.txt");

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.body.as_deref(), Some("from a subdirectory\n"));
}

#[test]
fn an_absolute_path_is_read_as_given() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let outside = tempfile::tempdir().unwrap();
    let file = outside.path().join("house-style.txt");
    std::fs::write(&file, "house style\n").unwrap();
    with_template(&tr, file.to_str().unwrap());

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.body.as_deref(), Some("house style\n"));
    assert_eq!(t.path.as_deref(), file.to_str());
}

#[test]
fn a_configured_template_that_does_not_exist_is_reported_not_fatal() {
    // Refusing nothing silently: git dies here. The commit screen must still
    // open, so this comes back as a flag the composer can put on screen.
    let tr = TempRepo::with_initial_commit("hello\n");
    with_template(&tr, "nope/not-here.txt");

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert!(t.unreadable, "a missing template must be reported");
    assert_eq!(t.body, None);
    assert!(t.path.is_some(), "the path is reported so the UI can name it");
}

#[test]
fn core_comment_char_is_honoured() {
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), ".gitmessage", "subject\n; a hint\n");
    with_template(&tr, ".gitmessage");
    tr.repo.config().unwrap().set_str("core.commentChar", ";").unwrap();

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.comment_prefix, ";");
}

#[test]
fn comment_char_auto_avoids_a_character_the_template_already_uses() {
    // git resolves `auto` against the buffer it is about to hand the editor —
    // the template — and strikes out every candidate that starts a line.
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), ".gitmessage", "#123 refs an issue\nbody\n");
    with_template(&tr, ".gitmessage");
    tr.repo.config().unwrap().set_str("core.commentChar", "auto").unwrap();

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.comment_prefix, ";");
}

#[test]
fn comment_char_auto_stays_hash_when_the_template_never_uses_one() {
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), ".gitmessage", "subject\n\nbody\n");
    with_template(&tr, ".gitmessage");
    tr.repo.config().unwrap().set_str("core.commentChar", "auto").unwrap();

    let (backend, handle) = tr.open_with_backend();
    let t = backend.commit_template(&handle.id).expect("commit_template");
    assert_eq!(t.comment_prefix, "#");
}

#[test]
fn a_template_is_read_fresh_on_every_call() {
    // The composer asks per repository visit; a cached first read would keep
    // showing a template the user has since edited.
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), ".gitmessage", "first\n");
    with_template(&tr, ".gitmessage");

    let (backend, handle) = tr.open_with_backend();
    assert_eq!(
        backend.commit_template(&handle.id).unwrap().body.as_deref(),
        Some("first\n")
    );
    support::fs::write_file(tr.path(), ".gitmessage", "second\n");
    assert_eq!(
        backend.commit_template(&handle.id).unwrap().body.as_deref(),
        Some("second\n")
    );
}
