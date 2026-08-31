//! The committer identity on a machine that has none (#212).
//!
//! Every other test in this suite gets a repo-local `user.name` / `user.email`
//! from `support::TempRepo::fresh` — deliberately, "so commit() works without
//! global config leaking in". That is why the fresh-machine path went
//! unexercised: the state a brand-new user is actually in was the one state no
//! test could reach.
//!
//! **One test function on purpose.** libgit2's config search paths and `HOME`
//! are process-global, and this file redirects both at a tempdir so it can
//! create and rewrite a *global* git config without touching the developer's
//! own. Splitting the story across `#[test]` functions would run them
//! concurrently against that one shared file.

mod support;

use std::path::PathBuf;

use git2::ConfigLevel;
use platypusgit_lib::{
    error::AppError,
    git::{
        signature::{IdentityScope, GitIdentity},
        types::CommitOptions,
        GitBackend,
    },
};
use support::TempRepo;

/// Point libgit2's global, XDG and system config lookups — and `HOME`, which
/// `signature::global_config_path` falls back to — at throwaway directories.
///
/// Without the XDG and system redirects this test would find the developer's
/// real `~/.config/git/config` or `/etc/gitconfig`, and `set_global_identity`
/// would then WRITE to it.
fn isolate_config(home: &std::path::Path) {
    let xdg = home.join("xdg");
    let system = home.join("system");
    std::fs::create_dir_all(&xdg).unwrap();
    std::fs::create_dir_all(&system).unwrap();
    unsafe {
        git2::opts::set_search_path(ConfigLevel::Global, home.to_str().unwrap()).unwrap();
        git2::opts::set_search_path(ConfigLevel::XDG, xdg.to_str().unwrap()).unwrap();
        git2::opts::set_search_path(ConfigLevel::System, system.to_str().unwrap()).unwrap();
    }
    std::env::set_var("HOME", home);
    std::env::set_var("USERPROFILE", home);
    std::env::set_var("XDG_CONFIG_HOME", &xdg);
}

/// Strip the repo-local identity `TempRepo` installs, so the repository is in
/// the state a real clone on a fresh machine is in.
fn strip_local_identity(repo_path: &std::path::Path) {
    let mut cfg = git2::Config::open(&repo_path.join(".git").join("config")).unwrap();
    cfg.remove("user.name").unwrap();
    cfg.remove("user.email").unwrap();
}

fn value_of(v: &Option<platypusgit_lib::git::signature::ConfiguredValue>) -> Option<&str> {
    v.as_ref().map(|c| c.value.as_str())
}

fn scope_of(v: &Option<platypusgit_lib::git::signature::ConfiguredValue>) -> Option<IdentityScope> {
    v.as_ref().map(|c| c.scope)
}

#[test]
fn a_machine_with_no_identity_can_be_told_who_it_is() {
    let home = tempfile::tempdir().expect("fake home");
    isolate_config(home.path());

    let tr = TempRepo::fresh();
    strip_local_identity(tr.path());
    let (backend, handle) = tr.open_with_backend();
    support::fs::write_file(tr.path(), "README.md", "hello\n");
    backend
        .stage(&handle.id, &[PathBuf::from("README.md")])
        .expect("stage");

    // --- 1. Nothing configured anywhere: the identity reads as absent, and the
    // path a fix would be written to is named even though no such file exists.
    let identity: GitIdentity = backend.identity(Some(&handle.id)).expect("identity");
    assert_eq!(value_of(&identity.name), None);
    assert_eq!(value_of(&identity.email), None);
    assert!(!identity.usable());
    let global_path = PathBuf::from(
        identity
            .global_config_path
            .as_deref()
            .expect("a global config path to write to"),
    );
    assert!(
        !global_path.exists(),
        "the fresh machine must not already have a global config: {}",
        global_path.display()
    );

    // --- 2. Committing raises NoSignature, NOT a stringified libgit2 error —
    // and creates nothing, so HEAD is still unborn afterwards.
    let err = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "initial".to_string(),
                amend: false,
                author_override: None,
                signoff: false,
                sign: None,
                no_verify: false,
            },
        )
        .expect_err("a commit with no identity must fail");
    assert!(
        matches!(err, AppError::NoSignature),
        "expected NoSignature, got {:?}",
        err
    );
    assert!(
        git2::Repository::open(tr.path()).unwrap().head().is_err(),
        "the refused commit must have created nothing"
    );

    // --- 3. Refusals validate before touching the filesystem: a rejected
    // identity leaves the machine exactly as it was, with no config file.
    for (name, email) in [
        ("", "ada@example.com"),
        ("   ", "ada@example.com"),
        ("Ada Lovelace", ""),
        ("Ada <Lovelace>", "ada@example.com"),
        ("Ada Lovelace", "ada@exa<mple.com"),
        ("Ada\nLovelace", "ada@example.com"),
    ] {
        let err = backend
            .set_global_identity(name, email)
            .expect_err("expected a refusal");
        assert!(
            matches!(err, AppError::InvalidArgument(_)),
            "expected InvalidArgument for ({name:?}, {email:?}), got {err:?}"
        );
    }
    assert!(
        !global_path.exists(),
        "a refused identity must not have created a config file"
    );

    // --- 4. Setting it creates the global config and the commit goes through,
    // attributed to what was typed. Surrounding whitespace is trimmed, the way
    // git trims it.
    backend
        .set_global_identity("  Ada Lovelace  ", " ada@example.com ")
        .expect("set identity");
    assert!(
        global_path.exists(),
        "the global config should have been created at {}",
        global_path.display()
    );

    let identity = backend.identity(Some(&handle.id)).expect("identity");
    assert_eq!(value_of(&identity.name), Some("Ada Lovelace"));
    assert_eq!(value_of(&identity.email), Some("ada@example.com"));
    assert_eq!(scope_of(&identity.name), Some(IdentityScope::Global));
    assert!(identity.usable());

    let result = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "initial".to_string(),
                amend: false,
                author_override: None,
                signoff: false,
                sign: None,
                no_verify: false,
            },
        )
        .expect("commit after the identity is set");
    let repo = git2::Repository::open(tr.path()).unwrap();
    let commit = repo
        .find_commit(git2::Oid::from_str(&result.oid).unwrap())
        .unwrap();
    assert_eq!(commit.author().name().ok(), Some("Ada Lovelace"));
    assert_eq!(commit.author().email().ok(), Some("ada@example.com"));

    // --- 5. Rewriting it overwrites rather than appending a second pair — a
    // duplicated key in a git config is legal and the LAST one wins, so an
    // append-only writer would look correct here and diverge the moment
    // anything read the file with `--get`.
    backend
        .set_global_identity("Grace Hopper", "grace@example.com")
        .expect("rewrite identity");
    let text = std::fs::read_to_string(&global_path).unwrap();
    assert_eq!(
        text.matches("email").count(),
        1,
        "user.email should appear once, not once per save:\n{text}"
    );
    let identity = backend.identity(Some(&handle.id)).expect("identity");
    assert_eq!(value_of(&identity.email), Some("grace@example.com"));

    // --- 6. A repo-local identity wins, and says so, so the UI can explain why
    // changing the global one changed nothing.
    {
        let mut cfg = git2::Config::open(&tr.path().join(".git").join("config")).unwrap();
        cfg.set_str("user.name", "Repo Local").unwrap();
        cfg.set_str("user.email", "local@example.com").unwrap();
    }
    let identity = backend.identity(Some(&handle.id)).expect("identity");
    assert_eq!(value_of(&identity.name), Some("Repo Local"));
    assert_eq!(scope_of(&identity.name), Some(IdentityScope::Repository));
    assert_eq!(scope_of(&identity.email), Some(IdentityScope::Repository));

    // --- 7. With no repository open at all, the global chain is still the
    // answer — this is what Settings reads before a repo is opened.
    let identity = backend.identity(None).expect("identity with no repo");
    assert_eq!(value_of(&identity.name), Some("Grace Hopper"));
    assert_eq!(scope_of(&identity.name), Some(IdentityScope::Global));

    // --- 8. A configured-but-BLANK identity is `NoSignature` too, not a raw
    // "failed to parse signature" from libgit2: the remedy is identical, and
    // the value is reported back verbatim so the user can see the empty line
    // rather than hunt for a missing one.
    {
        let mut cfg = git2::Config::open(&tr.path().join(".git").join("config")).unwrap();
        cfg.set_str("user.email", "   ").unwrap();
    }
    support::fs::write_file(tr.path(), "second.md", "more\n");
    backend
        .stage(&handle.id, &[PathBuf::from("second.md")])
        .expect("stage");
    let err = backend
        .commit(
            &handle.id,
            CommitOptions {
                message: "second".to_string(),
                amend: false,
                author_override: None,
                signoff: false,
                sign: None,
                no_verify: false,
            },
        )
        .expect_err("a blank email must fail");
    assert!(
        matches!(err, AppError::NoSignature),
        "expected NoSignature for a blank email, got {:?}",
        err
    );
    let identity = backend.identity(Some(&handle.id)).expect("identity");
    assert_eq!(value_of(&identity.email), Some("   "));
    assert!(!identity.usable(), "a blank email is not a usable identity");
}
