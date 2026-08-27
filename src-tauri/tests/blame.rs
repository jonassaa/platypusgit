mod support;

use std::path::Path;

use git2::Signature;
use platypusgit_lib::git::GitBackend;
use support::fs::write_file;
use support::TempRepo;

/// Commit everything in the worktree as `who`, so a test can tell "the person
/// who wrote the line" apart from "the person who ran the formatter".
fn commit_as(tr: &TempRepo, who: &str, msg: &str) -> git2::Oid {
    let repo = git2::Repository::open(tr.path()).unwrap();
    let mut index = repo.index().unwrap();
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    let tree = repo.find_tree(tree_oid).unwrap();
    let sig = Signature::now(who, &format!("{who}@example.com")).unwrap();
    let head = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|o| repo.find_commit(o).unwrap());
    let parents: Vec<&git2::Commit> = head.as_ref().map(|c| vec![c]).unwrap_or_default();
    repo.commit(Some("HEAD"), &sig, &sig, msg, &tree, &parents)
        .unwrap()
}

fn set_config(tr: &TempRepo, key: &str, value: &str) {
    let repo = git2::Repository::open(tr.path()).unwrap();
    repo.config().unwrap().set_str(key, value).unwrap();
}

/// A repo where `Formatter` reindented every line that `Author` wrote, with the
/// formatting commit listed in `.git-blame-ignore-revs` (not yet configured).
fn reformatted_repo() -> TempRepo {
    let tr = TempRepo::fresh();
    write_file(tr.path(), "src.txt", "alpha\nbeta\n");
    commit_as(&tr, "Author", "write the lines");
    write_file(tr.path(), "src.txt", "    alpha\n    beta\n");
    let fmt = commit_as(&tr, "Formatter", "reindent everything");
    write_file(tr.path(), ".git-blame-ignore-revs", &format!("{fmt}\n"));
    commit_as(&tr, "Author", "record the formatting commit");
    tr
}

#[test]
fn blame_attributes_each_line_to_the_commit_that_last_changed_it() {
    let tr = TempRepo::with_initial_commit("line-a\nline-b\n");
    let (backend, handle) = tr.open_with_backend();

    // second commit modifies line 2 only
    write_file(tr.path(), "README.md", "line-a\nline-b-edited\n");
    let commit2 = tr.commit_all("edit line 2");
    let initial = backend.log(&handle.id, None, 10).unwrap().last().unwrap().oid.clone();

    let result = backend
        .blame_file(&handle.id, Path::new("README.md"), true)
        .unwrap();
    let lines = result.lines;

    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0].line_no, 1);
    assert_eq!(lines[0].oid, initial);
    assert_eq!(lines[1].line_no, 2);
    assert_eq!(lines[1].oid, commit2.to_string());
    assert_eq!(lines[1].content, "line-b-edited");

    // No `blame.ignoreRevsFile` anywhere: nothing to ignore, nothing to offer.
    assert_eq!(result.ignore_revs_file, None);
    assert!(!result.ignore_revs_applied);
    assert_eq!(result.ignore_revs_error, None);
    assert!(lines.iter().all(|l| !l.ignored && !l.unblamable));
}

#[test]
fn an_ignore_revs_file_attributes_the_line_to_the_original_author() {
    let tr = reformatted_repo();
    set_config(&tr, "blame.ignoreRevsFile", ".git-blame-ignore-revs");
    let (backend, handle) = tr.open_with_backend();

    let result = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();

    assert_eq!(
        result.ignore_revs_file.as_deref(),
        Some(".git-blame-ignore-revs")
    );
    assert!(result.ignore_revs_applied, "{result:?}");
    assert_eq!(result.ignore_revs_error, None);
    let authors: Vec<&str> = result.lines.iter().map(|l| l.author.as_str()).collect();
    assert_eq!(
        authors,
        vec!["Author", "Author"],
        "the formatter must not own the lines it only reindented"
    );
    // The content still comes from the blamed revision, not the pre-format one.
    assert_eq!(result.lines[0].content, "    alpha");
}

#[test]
fn the_un_ignored_view_gives_the_lines_back_to_the_formatting_commit() {
    // The toggle's whole job: the same file, same engine, ignore-revs off.
    let tr = reformatted_repo();
    set_config(&tr, "blame.ignoreRevsFile", ".git-blame-ignore-revs");
    let (backend, handle) = tr.open_with_backend();

    let result = backend
        .blame_file(&handle.id, Path::new("src.txt"), false)
        .unwrap();

    assert_eq!(
        result.ignore_revs_file.as_deref(),
        Some(".git-blame-ignore-revs"),
        "the toggle must still know the file exists, or it cannot be turned back on"
    );
    assert!(!result.ignore_revs_applied);
    let authors: Vec<&str> = result.lines.iter().map(|l| l.author.as_str()).collect();
    assert_eq!(authors, vec!["Formatter", "Formatter"]);
}

#[test]
fn a_configured_ignore_revs_file_that_does_not_exist_degrades_to_a_plain_blame() {
    // `git blame` itself dies with "could not open object name list" here, and
    // a missing file is the normal state of a fresh clone whose config came
    // from an include or a shared template. Blame must still render.
    let tr = reformatted_repo();
    set_config(&tr, "blame.ignoreRevsFile", ".no-such-file");
    let (backend, handle) = tr.open_with_backend();

    let result = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();

    assert!(!result.lines.is_empty(), "blame still rendered");
    assert!(!result.ignore_revs_applied);
    let err = result.ignore_revs_error.expect("a reason was reported");
    assert!(err.contains(".no-such-file"), "{err}");
}

#[test]
fn an_unreadable_ignore_revs_file_degrades_rather_than_failing_blame() {
    // Same contract one level down: the file exists, so we hand the run to git,
    // and git refuses it (an object name that is not a commit). The result is a
    // warning beside a working blame, never an error screen.
    let tr = reformatted_repo();
    write_file(tr.path(), ".git-blame-ignore-revs", "not-a-sha\n");
    commit_as(&tr, "Author", "corrupt the ignore list");
    set_config(&tr, "blame.ignoreRevsFile", ".git-blame-ignore-revs");
    let (backend, handle) = tr.open_with_backend();

    let result = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();

    assert!(!result.lines.is_empty(), "blame still rendered");
    assert!(!result.ignore_revs_applied);
    assert!(result.ignore_revs_error.is_some());
}

#[test]
fn mark_ignored_lines_is_reflected_on_the_lines_it_marks() {
    let tr = reformatted_repo();
    set_config(&tr, "blame.ignoreRevsFile", ".git-blame-ignore-revs");
    let (backend, handle) = tr.open_with_backend();

    let unmarked = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();
    assert!(!unmarked.mark_ignored_lines);
    assert!(
        unmarked.lines.iter().all(|l| !l.ignored),
        "git only marks when asked, and so do we"
    );

    set_config(&tr, "blame.markIgnoredLines", "true");
    let marked = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();

    assert!(marked.mark_ignored_lines);
    assert!(
        marked.lines.iter().any(|l| l.ignored),
        "a line re-attributed past an ignored commit carries git's `?`: {:?}",
        marked.lines
    );
}

#[test]
fn mark_unblamable_lines_is_reflected_too() {
    // A line the ignored commit ADDED has no earlier commit to fall back to —
    // git's `*`, a different verdict from `?` and worth keeping distinct.
    let tr = TempRepo::fresh();
    write_file(tr.path(), "src.txt", "alpha\n");
    commit_as(&tr, "Author", "one line");
    write_file(tr.path(), "src.txt", "alpha\nbrand new\n");
    let fmt = commit_as(&tr, "Formatter", "add a line");
    write_file(tr.path(), ".git-blame-ignore-revs", &format!("{fmt}\n"));
    commit_as(&tr, "Author", "record it");
    set_config(&tr, "blame.ignoreRevsFile", ".git-blame-ignore-revs");
    set_config(&tr, "blame.markUnblamableLines", "true");

    let (backend, handle) = tr.open_with_backend();
    let result = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();

    assert!(result.mark_unblamable_lines);
    assert!(
        result.lines.iter().any(|l| l.unblamable),
        "{:?}",
        result.lines
    );
}

#[test]
fn the_shelled_out_blame_answers_the_same_question_as_the_libgit2_one() {
    // Two engines, so they must be asked the same thing: the file as of HEAD,
    // not the working tree. Otherwise a user with an uncommitted edit sees a
    // different line COUNT depending on whether their repo has an ignore-revs
    // file — and the toggle would appear to add and remove lines.
    let tr = reformatted_repo();
    let (backend, handle) = tr.open_with_backend();
    let without_config = backend
        .blame_file(&handle.id, Path::new("src.txt"), true)
        .unwrap();

    write_file(tr.path(), "src.txt", "    alpha\n    beta\n    uncommitted\n");
    set_config(&tr, "blame.ignoreRevsFile", ".git-blame-ignore-revs");
    let with_config = backend
        .blame_file(&handle.id, Path::new("src.txt"), false)
        .unwrap();

    assert_eq!(
        with_config.lines.len(),
        without_config.lines.len(),
        "both engines blame HEAD, so an uncommitted line is in neither"
    );
}
