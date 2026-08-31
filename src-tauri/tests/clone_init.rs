mod support;

use platypusgit_lib::commands::create::{clone_args, validate_clone_target};
use platypusgit_lib::error::AppError;
use platypusgit_lib::git::types::CloneOptions;
use platypusgit_lib::git::{libgit2::default_branch_name, libgit2::Libgit2Backend, GitBackend};

use support::{BareTempRepo, TempRepo};

#[test]
fn init_creates_a_repo_on_the_requested_branch() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    let handle = backend.init(&target, Some("trunk")).expect("init");

    // libgit2 canonicalizes the workdir it returns (resolving macOS's
    // /tmp -> /private/tmp symlink). `target` exists on disk by now too, so
    // canonicalizing both sides resolves that prefix identically while still
    // checking the full path, not just the leaf name. (PathBuf equality
    // already ignores a trailing separator — /private was the only real
    // mismatch.)
    assert_eq!(
        handle.path.canonicalize().unwrap(),
        target.canonicalize().unwrap()
    );
    let repo = git2::Repository::open(&target).expect("the new repo opens");
    // HEAD is unborn until the first commit, so read the symbolic target.
    assert_eq!(
        repo.find_reference("HEAD").unwrap().symbolic_target().unwrap().unwrap(),
        "refs/heads/trunk"
    );
}

#[test]
fn init_defaults_to_main_when_no_branch_is_given() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    backend.init(&target, None).expect("init");

    // Assert against the fallback's own result, not a hardcoded "main" —
    // `init` defers to the ambient `init.defaultBranch` config, so a literal
    // here would only pass by coincidence on a machine that hasn't set one
    // (or, as on this machine, has set it to exactly "main").
    let repo = git2::Repository::open(&target).unwrap();
    let expected = format!("refs/heads/{}", default_branch_name());
    assert_eq!(
        repo.find_reference("HEAD").unwrap().symbolic_target().unwrap().unwrap(),
        expected
    );
}

#[test]
fn init_creates_missing_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("a/b/fresh");
    let backend = Libgit2Backend::new();

    backend.init(&target, None).expect("init");

    assert!(target.join(".git").exists());
}

#[test]
fn init_rejects_a_target_whose_last_segment_escapes_the_parent() {
    // The store builds `path` by joining a user-typed folder name onto a
    // directory picked via a native dialog. Path components never collapse
    // "..", so a name of ".." resolves `path` to the grandparent of the
    // directory actually picked — mirrors what `validate_clone_target`
    // already rejects for clone's equivalent field.
    let dir = tempfile::tempdir().unwrap();
    let parent = dir.path().join("picked");
    std::fs::create_dir_all(&parent).unwrap();
    let target = parent.join(".."); // resolves to `dir`, escaping `parent`
    let backend = Libgit2Backend::new();

    let err = backend.init(&target, None).unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
    assert!(
        !dir.path().join(".git").exists(),
        "must not have initialized in the escaped-to grandparent directory"
    );
}

#[test]
fn init_rejects_control_characters_in_the_final_path_segment() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("evil\0name");
    let backend = Libgit2Backend::new();

    let err = backend.init(&target, None).unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
}

#[test]
fn init_refuses_a_directory_that_is_already_a_repo() {
    // Re-initializing silently reuses the existing repo, which looks like
    // success while doing nothing — and would drop the user into a repo they
    // did not think they were creating.
    let tr = TempRepo::with_initial_commit("hello\n");
    let backend = Libgit2Backend::new();

    let err = backend.init(tr.path(), None).unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
}

#[test]
fn init_rejects_an_invalid_branch_name_without_poisoning_the_directory() {
    // A space is illegal in a ref name. `RepositoryInitOptions::initial_head`
    // doesn't validate it, so a naive implementation writes a half-built
    // `.git` (bad HEAD, everything else fine) and only fails later when it
    // tries to resolve that HEAD — leaving wreckage that the "already a git
    // repository" guard then refuses on every subsequent `init` forever.
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    let err = backend.init(&target, Some("my branch")).unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
    assert!(
        !target.join(".git").exists(),
        ".git must not be left behind after a failed init"
    );

    // The self-lock assertion: a later init with a VALID name on the exact
    // same path must still succeed. If the failed attempt above had poisoned
    // the directory, this would fail with "already a git repository".
    let handle = backend
        .init(&target, Some("trunk"))
        .expect("init should succeed on the same path after the earlier failure");

    let repo = git2::Repository::open(&target).unwrap();
    assert_eq!(
        repo.find_reference("HEAD").unwrap().symbolic_target().unwrap().unwrap(),
        "refs/heads/trunk"
    );
    assert!(backend.status(&handle.id).is_ok());
}

#[test]
fn init_refuses_a_preexisting_dot_git_without_deleting_it() {
    // A target directory can already contain something at `.git` that is
    // neither a valid, open-able repository (so the "already a git
    // repository" guard doesn't fire) nor something `init` is entitled to
    // delete or overwrite on the user's behalf — it might be corrupt-but-
    // precious data the user cares about recovering, not wreckage `init`
    // itself created. `init` must refuse up front, before any write, and
    // must leave the pre-existing `.git` completely untouched — byte for
    // byte, not just "still exists".
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    std::fs::create_dir_all(&target).unwrap();
    let original_contents: &[u8] = b"not a real gitdir link";
    std::fs::write(target.join(".git"), original_contents).unwrap();
    let backend = Libgit2Backend::new();

    let err = backend.init(&target, Some("trunk")).unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
    let message = err.to_string();
    assert!(
        message.contains(&target.display().to_string()),
        "error should name the offending path: {message}"
    );

    assert!(
        target.join(".git").exists(),
        "the pre-existing .git must not be deleted"
    );
    let contents_after = std::fs::read(target.join(".git")).unwrap();
    assert_eq!(
        contents_after, original_contents,
        "the pre-existing .git's bytes must be unchanged"
    );
}

#[test]
fn the_handle_init_returns_is_usable() {
    let dir = tempfile::tempdir().unwrap();
    let target = dir.path().join("fresh");
    let backend = Libgit2Backend::new();

    let handle = backend.init(&target, None).expect("init");

    // The handle must be registered in the backend's repo map, not just
    // returned — otherwise the very next call 404s with UnknownRepo.
    assert!(backend.status(&handle.id).is_ok());
}

#[test]
fn concurrent_init_calls_on_the_same_path_are_serialized() {
    use std::sync::{Arc, Mutex as StdMutex};

    let dir = tempfile::tempdir().unwrap();
    let target = Arc::new(dir.path().join("fresh"));
    let backend = Arc::new(Libgit2Backend::new());
    let outcomes = Arc::new(StdMutex::new(Vec::new()));

    std::thread::scope(|s| {
        let (t1_backend, t1_target, t1_outcomes) =
            (backend.clone(), target.clone(), outcomes.clone());
        let t1 = s.spawn(move || {
            let result = t1_backend.init(&t1_target, Some("main"));
            t1_outcomes.lock().unwrap().push(("thread1", result));
        });

        let (t2_backend, t2_target, t2_outcomes) =
            (backend.clone(), target.clone(), outcomes.clone());
        let t2 = s.spawn(move || {
            let result = t2_backend.init(&t2_target, Some("main"));
            t2_outcomes.lock().unwrap().push(("thread2", result));
        });

        t1.join().unwrap();
        t2.join().unwrap();
    });

    let outcomes = outcomes.lock().unwrap();
    let successes = outcomes.iter().filter(|(_, r)| r.is_ok()).count();
    let failures = outcomes.iter().filter(|(_, r)| r.is_err()).count();
    assert_eq!(
        successes, 1,
        "exactly one concurrent init should succeed; got {outcomes:?}"
    );
    assert_eq!(
        failures, 1,
        "exactly one concurrent init should fail; got {outcomes:?}"
    );

    // Verify the error from the losing call is the "already a git repository"
    // refusal, not a panic or poisoned-lock Internal error.
    let failed_result = outcomes
        .iter()
        .find(|(_, r)| r.is_err())
        .map(|(_, r)| r.as_ref().unwrap_err());
    assert!(
        failed_result.map_or(false, |e| {
            matches!(e, AppError::InvalidPath(_)) && e.to_string().contains("already a git repository")
        }),
        "losing call should fail with InvalidPath about 'already a git repository', got {failed_result:?}"
    );

    // Verify the winner's repository is intact and can be opened.
    let repo = git2::Repository::open(target.as_path())
        .expect("the winner's repository should be openable");
    assert_eq!(
        repo.find_reference("HEAD")
            .unwrap()
            .symbolic_target()
            .unwrap()
            .unwrap(),
        "refs/heads/main",
        "the winner's repository should have the requested branch"
    );
}

/// `--recurse-submodules` only, the way the dialog's default clone asks for it.
fn submodules_only() -> CloneOptions {
    CloneOptions {
        recurse_submodules: true,
        ..CloneOptions::default()
    }
}

#[test]
fn clone_args_are_shell_free_and_option_terminated() {
    let args = clone_args("https://example.com/repo.git", "repo", &submodules_only());
    assert_eq!(
        args,
        vec![
            "-c".to_string(),
            "protocol.ext.allow=never".to_string(),
            "clone".to_string(),
            "--progress".to_string(),
            "--recurse-submodules".to_string(),
            "--".to_string(),
            "https://example.com/repo.git".to_string(),
            "repo".to_string(),
        ]
    );

    let plain = clone_args(
        "https://example.com/repo.git",
        "repo",
        &CloneOptions::default(),
    );
    assert!(!plain.contains(&"--recurse-submodules".to_string()));
    // The `-c` override must land before the `clone` subcommand, or it's just
    // another positional argument to git rather than a global option.
    assert_eq!(plain[0], "-c");
    assert_eq!(plain[1], "protocol.ext.allow=never");
    let clone_idx = plain.iter().position(|a| a == "clone").unwrap();
    assert!(clone_idx > 1, "-c protocol.ext.allow=never must precede `clone`");
    // `--` must come immediately before the URL, so a URL starting with a dash
    // can never be read as a flag.
    let dashdash = plain.iter().position(|a| a == "--").unwrap();
    assert_eq!(plain[dashdash + 1], "https://example.com/repo.git");
}

#[test]
fn clone_args_disallows_the_ext_remote_helper_regardless_of_ambient_config() {
    // protocol.ext.allow defaults to "never" already, but that default lives
    // in the user's own git config and can be overridden
    // (protocol.ext.allow=always turns `ext::sh -c '...'` URLs into arbitrary
    // command execution with no credential prompt needed). Pin it here so a
    // directly-spawned `git clone` is safe independent of ambient config.
    let args = clone_args(
        "https://example.com/repo.git",
        "repo",
        &CloneOptions::default(),
    );
    let c_idx = args.iter().position(|a| a == "-c").expect("must set -c");
    assert_eq!(args[c_idx + 1], "protocol.ext.allow=never");
}

#[test]
fn validate_clone_target_accepts_an_absent_destination() {
    let dir = tempfile::tempdir().unwrap();
    let target = validate_clone_target(dir.path(), "repo").expect("absent target is fine");
    assert_eq!(target, dir.path().join("repo"));
}

#[test]
fn validate_clone_target_accepts_an_existing_empty_directory() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("repo")).unwrap();
    assert!(validate_clone_target(dir.path(), "repo").is_ok());
}

#[test]
fn validate_clone_target_rejects_a_non_empty_destination() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("repo")).unwrap();
    std::fs::write(dir.path().join("repo/keep.txt"), "mine\n").unwrap();

    let err = validate_clone_target(dir.path(), "repo").unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
}

#[test]
fn validate_clone_target_rejects_names_that_escape_the_parent() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["../escape", "/absolute", "", "a/b"] {
        let err = validate_clone_target(dir.path(), name).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)), "{name} should be rejected");
    }
}

#[test]
fn validate_clone_target_rejects_a_windows_drive_prefixed_name() {
    // `Path::push`/`join` replaces the base whenever the pushed path has a
    // "prefix" component but no root — on Windows, `parent.join("C:evil")`
    // is just `C:evil`, not `parent/C:evil`, so git would write outside the
    // directory the user picked at a path that doesn't match what the
    // command reports back to the frontend. `:` is invalid in a folder name
    // on every platform this app targets, so reject it as plain text — this
    // must hold on whatever OS runs the check, not only on a real Windows
    // build where `Component::Prefix` would also catch it.
    let dir = tempfile::tempdir().unwrap();
    for name in ["C:", "C:evil", "c:\\Windows"] {
        let err = validate_clone_target(dir.path(), name).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)), "{name} should be rejected");
    }
}

#[test]
fn validate_clone_target_rejects_control_characters_in_the_name() {
    let dir = tempfile::tempdir().unwrap();
    for name in ["repo\0evil", "repo\nevil", "repo\tevil"] {
        let err = validate_clone_target(dir.path(), name).unwrap_err();
        assert!(matches!(err, AppError::InvalidPath(_)), "{name:?} should be rejected");
    }
}

#[test]
fn validate_clone_target_rejects_a_symlinked_destination() {
    // `exists()`/`is_dir()`/`read_dir()` all follow symlinks, so a
    // pre-planted `parent/repo` -> elsewhere would otherwise be accepted and
    // the clone would land outside `parent`, wherever the link points.
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(elsewhere.path(), dir.path().join("repo")).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(elsewhere.path(), dir.path().join("repo")).unwrap();

    let err = validate_clone_target(dir.path(), "repo").unwrap_err();
    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
}

#[test]
fn validate_clone_target_refuses_a_parent_that_is_a_repo_working_tree_root() {
    // Spec requires this: cloning straight into an existing repo's own
    // working tree nests a clone inside it with no .gitmodules entry — the
    // same embedded-repo state commit 1dddff3 had to teach `get_status` to
    // detect after the fact, because libgit2 won't recurse across a nested
    // .git. This check is deliberately bounded to `parent` itself (see
    // clone_into_a_deep_subdirectory_of_a_repo_is_allowed below for why it
    // must NOT walk up ancestors).
    let repo = TempRepo::with_initial_commit("hello\n");

    let err = validate_clone_target(repo.path(), "nested-clone").unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
    // Actionable message, not just a refusal: name the repo, say what to do
    // next — same principle `embeddedRepoMenuItems` documents in
    // context-menu.tsx for embedded repos.
    let message = err.to_string();
    assert!(
        message.contains("already a git repository") && message.contains("different folder"),
        "expected an actionable message naming the repo and the remedy, got: {message}"
    );
}

#[test]
fn clone_into_a_deep_subdirectory_of_a_repo_is_allowed() {
    // Regression guard for the over-broad first cut of this check, which
    // used git2::Repository::discover (walks up to the filesystem root with
    // no ceiling). That refused ANY parent nested under ANY ancestor
    // repository — including, on a real machine, every directory under a
    // user's $HOME when $HOME is a dotfiles repo (a common real setup),
    // naming the home directory in an error that reads as nonsense. The
    // check must only look at `parent` itself, so a parent that is merely
    // *inside* a repo several levels down must be accepted here. (The
    // resulting clone does land inside another repo's working tree and that
    // outer repo will then report it as an embedded repo — an
    // already-handled, deliberate app state per commit 1dddff3, not
    // corruption — but that's a different concern from this validation.)
    let repo = TempRepo::with_initial_commit("hello\n");
    let subdir = repo.path().join("some/nested/dir");
    std::fs::create_dir_all(&subdir).unwrap();

    let target = validate_clone_target(&subdir, "nested-clone")
        .expect("a parent several levels inside a repo, but not itself a repo root, is fine");

    assert_eq!(target, subdir.join("nested-clone"));
}

#[tokio::test]
async fn clone_from_a_local_bare_repo_lands_the_files() {
    // No network, no credentials: a local bare repo exercises the whole real
    // path — spawn, stream stderr, exit status, destination handling.
    let bare = BareTempRepo::new();
    let source = TempRepo::with_initial_commit("hello\n");
    std::process::Command::new("git")
        .args(["remote", "add", "origin", bare.path.to_str().unwrap()])
        .current_dir(source.path())
        .status()
        .unwrap();
    std::process::Command::new("git")
        .args(["push", "origin", "HEAD:refs/heads/main"])
        .current_dir(source.path())
        .status()
        .unwrap();
    // BareTempRepo already pins HEAD at refs/heads/main (see its
    // constructor), so a real `git clone` checks out a non-empty working
    // tree regardless of the host's init.defaultBranch config.

    let dest_parent = tempfile::tempdir().unwrap();
    // No progress assertion here: a repo this small can legitimately finish
    // without git emitting a single progress line. Parsing is covered by the
    // parse_progress unit tests; this test is about the files landing.
    let dest = platypusgit_lib::commands::create::run_clone(
        bare.path.to_str().unwrap(),
        dest_parent.path(),
        "cloned",
        &CloneOptions::default(),
        None,
        |_| {},
    )
    .await
    .expect("clone from a local bare repo");

    assert_eq!(dest, dest_parent.path().join("cloned"));
    assert_eq!(std::fs::read_to_string(dest.join("README.md")).unwrap(), "hello\n");
    // origin points back at the source
    let cloned = git2::Repository::open(&dest).unwrap();
    assert_eq!(
        cloned.find_remote("origin").unwrap().url().unwrap(),
        bare.path.to_str().unwrap()
    );
}

#[tokio::test]
async fn clone_streams_progress_ticks_as_they_arrive() {
    // The plain path clone above can legitimately finish without emitting a
    // single progress line (a tiny repo over the local hardlink shortcut).
    // Verified by hand before writing this: a `file://` URL makes git use
    // its normal negotiation/transfer path instead of that shortcut, and
    // DOES emit "Enumerating objects" / "Counting objects" / "Receiving
    // objects" progress even for a 3-object repo —
    //   $ git clone --progress -- file:///.../bare dest
    //   remote: Enumerating objects: 3, done.
    //   remote: Counting objects:  33% (1/3) ... 100% (3/3), done.
    //   Receiving objects:  33% (1/3) ... 100% (3/3), done.
    // This is the transport this test exercises, so a real tick sequence —
    // not just a single call — is what proves the streaming rewrite works,
    // per the reviewer's mutation test (deleting the parse/emit block left
    // every test in this file passing before this test existed).
    let bare = BareTempRepo::new();
    let source = TempRepo::with_initial_commit("hello\n");
    std::process::Command::new("git")
        .args(["remote", "add", "origin", bare.path.to_str().unwrap()])
        .current_dir(source.path())
        .status()
        .unwrap();
    std::process::Command::new("git")
        .args(["push", "origin", "HEAD:refs/heads/main"])
        .current_dir(source.path())
        .status()
        .unwrap();
    // BareTempRepo already pins HEAD at refs/heads/main.

    let dest_parent = tempfile::tempdir().unwrap();
    let url = format!("file://{}", bare.path.display());
    let ticks = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let ticks_for_closure = ticks.clone();

    platypusgit_lib::commands::create::run_clone(
        &url,
        dest_parent.path(),
        "cloned",
        &CloneOptions::default(),
        None,
        move |p| ticks_for_closure.lock().unwrap().push(p),
    )
    .await
    .expect("clone over a file:// URL");

    let ticks = ticks.lock().unwrap();
    assert!(
        !ticks.is_empty(),
        "expected at least one clone://progress tick over a non-local transport, got none"
    );
    for tick in ticks.iter() {
        assert!(!tick.phase.is_empty(), "progress tick had an empty phase: {tick:?}");
        assert!(tick.percent <= 100, "progress tick percent out of range: {tick:?}");
    }
}

#[tokio::test]
async fn run_clone_trims_whitespace_from_the_name_and_matches_disk() {
    // Reproduces the final reviewer's repro: a folder name with a trailing
    // space (easy to paste) used to be trimmed for validation but not for the
    // argv element git actually received, so git created "cloned " on disk
    // while this function returned "cloned" — a path that doesn't exist, so
    // the frontend's subsequent openRepo call fails after the dialog already
    // closed.
    let bare = BareTempRepo::new();
    let source = TempRepo::with_initial_commit("hello\n");
    std::process::Command::new("git")
        .args(["remote", "add", "origin", bare.path.to_str().unwrap()])
        .current_dir(source.path())
        .status()
        .unwrap();
    std::process::Command::new("git")
        .args(["push", "origin", "HEAD:refs/heads/main"])
        .current_dir(source.path())
        .status()
        .unwrap();

    let dest_parent = tempfile::tempdir().unwrap();

    let dest = platypusgit_lib::commands::create::run_clone(
        bare.path.to_str().unwrap(),
        dest_parent.path(),
        "cloned ", // trailing space, exactly the reviewer's repro
        &CloneOptions::default(),
        None,
        |_| {},
    )
    .await
    .expect("clone with a whitespace-padded name");

    assert_eq!(
        dest,
        dest_parent.path().join("cloned"),
        "returned destination must be the trimmed name"
    );
    assert!(
        dest.is_dir(),
        "the trimmed destination must actually exist on disk"
    );
    assert!(
        !dest_parent.path().join("cloned ").exists(),
        "git must not have created the untrimmed, space-suffixed path"
    );
}

#[tokio::test]
async fn run_clone_reports_a_missing_parent_directory_by_name() {
    // A missing parent used to surface only once `Command::spawn` tried (and
    // failed) to set that directory as the child's cwd, yielding a bare
    // "No such file or directory (os error 2)" that reads as "git isn't
    // installed" rather than naming the actual problem.
    let dest_parent = tempfile::tempdir().unwrap();
    let missing_parent = dest_parent.path().join("does-not-exist");

    let err = platypusgit_lib::commands::create::run_clone(
        "https://example.com/repo.git",
        &missing_parent,
        "cloned",
        &CloneOptions::default(),
        None,
        |_| {},
    )
    .await
    .unwrap_err();

    assert!(matches!(err, AppError::InvalidPath(_)), "got {err:?}");
    let message = err.to_string();
    assert!(
        message.contains(&missing_parent.display().to_string()),
        "error should name the missing directory: {message}"
    );
}

#[tokio::test]
async fn a_failed_clone_reports_git_stderr_and_leaves_nothing_behind() {
    // This pins the "git bails before creating the destination at all" path
    // (source doesn't exist, so nothing is ever written) — it does NOT cover
    // partial-destination cleanup for a failure that happens after git has
    // started writing into an already-existing directory. That distinct
    // scenario (an empty pre-created destination + a mid-transfer failure)
    // was verified by hand for the task-4 report, not by an automated test
    // here: git's own junk-tracking removes only what IT created and leaves
    // a pre-existing directory exactly as found.
    let dest_parent = tempfile::tempdir().unwrap();
    let missing = dest_parent.path().join("no-such-source");

    let err = platypusgit_lib::commands::create::run_clone(
        missing.to_str().unwrap(),
        dest_parent.path(),
        "cloned",
        &CloneOptions::default(),
        None,
        |_| {},
    )
    .await
    .unwrap_err();

    let AppError::Network(message) = &err else {
        panic!("got {err:?}, expected AppError::Network");
    };
    assert!(!message.is_empty(), "expected git's real stderr in the error, got an empty message");
    assert!(
        message.contains("does not exist"),
        "expected git's real 'repository does not exist' text in the message, got: {message}"
    );
    assert!(
        !dest_parent.path().join("cloned").exists(),
        "a failed clone must not leave a partial destination"
    );
}
