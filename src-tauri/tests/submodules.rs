//! Submodule integration tests (#93) — against real temp repos with a real
//! submodule, so the libgit2 status mapping is checked against git's own view.

mod support;

use platypusgit_lib::git::types::SubmoduleState;
use platypusgit_lib::git::GitBackend;
use support::{git_in, with_submodule, SubmoduleFixture};

#[test]
fn lists_a_declared_submodule_with_its_url_and_oids() {
    let fx = with_submodule();
    let (backend, handle) = fx.outer.open_with_backend();

    let subs = backend.submodules(&handle.id).expect("submodules");
    assert_eq!(subs.len(), 1, "one declared submodule");
    let sm = &subs[0];
    assert_eq!(sm.path, SubmoduleFixture::SUB_PATH);
    assert!(
        sm.url.as_deref().is_some_and(|u| !u.is_empty()),
        "a declared submodule has a .gitmodules url, got {:?}",
        sm.url
    );
    let inner_head = git_in(fx.inner.path(), &["rev-parse", "HEAD"]).trim().to_string();
    assert_eq!(sm.head_oid.as_deref(), Some(inner_head.as_str()));
    assert_eq!(sm.workdir_oid.as_deref(), Some(inner_head.as_str()));
    assert_eq!(sm.state, SubmoduleState::UpToDate);
}

#[test]
fn a_deinitialized_submodule_reads_as_uninitialized() {
    let fx = with_submodule();
    fx.deinit();
    let (backend, handle) = fx.outer.open_with_backend();

    let subs = backend.submodules(&handle.id).expect("submodules");
    assert_eq!(subs[0].state, SubmoduleState::Uninitialized);
    // The superproject still records the pointer; only the checkout is gone. If
    // this were None the row could not show what Update would check out.
    assert!(subs[0].head_oid.is_some());
    assert!(subs[0].workdir_oid.is_none());
}

#[test]
fn init_writes_the_url_into_git_config() {
    let fx = with_submodule();
    fx.deinit();
    let (backend, handle) = fx.outer.open_with_backend();

    backend
        .submodule_init(&handle.id, Some(SubmoduleFixture::SUB_PATH))
        .expect("submodule_init");

    let config = std::fs::read_to_string(fx.outer.path().join(".git").join("config"))
        .expect("read .git/config");
    assert!(
        config.contains(&format!("submodule \"{}\"", SubmoduleFixture::SUB_PATH)),
        ".git/config should carry the submodule section after init:\n{config}"
    );
}

#[test]
fn update_checks_out_the_recorded_commit_again() {
    let fx = with_submodule();
    let recorded = git_in(fx.inner.path(), &["rev-parse", "HEAD"]).trim().to_string();
    fx.deinit();
    let (backend, handle) = fx.outer.open_with_backend();
    assert_eq!(
        backend.submodules(&handle.id).unwrap()[0].state,
        SubmoduleState::Uninitialized
    );

    // `init: true` is `git submodule update --init` — the one-shot git itself
    // recommends, and idempotent on an already-initialized submodule.
    backend
        .submodule_update(&handle.id, Some(SubmoduleFixture::SUB_PATH), false, true)
        .expect("submodule_update");

    // Repo truth, not the backend's own report.
    let checked_out = git_in(
        &fx.outer.path().join(SubmoduleFixture::SUB_PATH),
        &["rev-parse", "HEAD"],
    )
    .trim()
    .to_string();
    assert_eq!(checked_out, recorded);

    let subs = backend.submodules(&handle.id).expect("submodules");
    assert_eq!(subs[0].state, SubmoduleState::UpToDate);
}

#[test]
fn a_moved_submodule_pointer_reads_as_out_of_sync() {
    let fx = with_submodule();
    // Advance the inner repo and check the submodule out at the new commit, WITHOUT
    // staging the new gitlink in the superproject — the everyday "submodule is not
    // where the superproject says" state.
    fx.inner.add_commit("second.txt", "second\n", "inner v2");
    let newer = git_in(fx.inner.path(), &["rev-parse", "HEAD"]).trim().to_string();
    let sub_dir = fx.outer.path().join(SubmoduleFixture::SUB_PATH);
    git_in(&sub_dir, &["fetch", "origin"]);
    git_in(&sub_dir, &["checkout", &newer]);

    let (backend, handle) = fx.outer.open_with_backend();
    let subs = backend.submodules(&handle.id).expect("submodules");
    assert_eq!(subs[0].state, SubmoduleState::OutOfSync);
    assert_eq!(subs[0].workdir_oid.as_deref(), Some(newer.as_str()));
    assert_ne!(subs[0].head_oid.as_deref(), Some(newer.as_str()));
}

#[test]
fn a_dirty_submodule_worktree_reads_as_modified() {
    let fx = with_submodule();
    std::fs::write(
        fx.outer
            .path()
            .join(SubmoduleFixture::SUB_PATH)
            .join("README.md"),
        "edited inside the submodule\n",
    )
    .expect("write inside submodule");

    let (backend, handle) = fx.outer.open_with_backend();
    let subs = backend.submodules(&handle.id).expect("submodules");
    assert_eq!(subs[0].state, SubmoduleState::Modified);
}

#[test]
fn sync_rewrites_git_config_from_gitmodules() {
    let fx = with_submodule();
    let (backend, handle) = fx.outer.open_with_backend();

    // Point `.gitmodules` somewhere else, leaving `.git/config` stale — exactly
    // what `git submodule sync` exists to reconcile.
    git_in(
        fx.outer.path(),
        &[
            "config",
            "-f",
            ".gitmodules",
            &format!("submodule.{}.url", SubmoduleFixture::SUB_PATH),
            "https://example.com/moved.git",
        ],
    );
    backend
        .submodule_sync(&handle.id, Some(SubmoduleFixture::SUB_PATH))
        .expect("submodule_sync");

    let config = std::fs::read_to_string(fx.outer.path().join(".git").join("config"))
        .expect("read .git/config");
    assert!(
        config.contains("https://example.com/moved.git"),
        ".git/config should carry the new url after sync:\n{config}"
    );
}

#[test]
fn status_flags_the_gitlink_row_as_a_submodule_and_not_as_embedded() {
    let fx = with_submodule();
    // A dirty submodule makes the gitlink show up in `status` at all.
    std::fs::write(
        fx.outer
            .path()
            .join(SubmoduleFixture::SUB_PATH)
            .join("README.md"),
        "dirty\n",
    )
    .expect("write inside submodule");

    let (backend, handle) = fx.outer.open_with_backend();
    let status = backend.status(&handle.id).expect("status");
    let row = status
        .iter()
        .find(|s| s.path.trim_end_matches('/') == SubmoduleFixture::SUB_PATH)
        .unwrap_or_else(|| panic!("no row for the submodule; got {:?}", status));

    assert!(row.submodule, "the gitlink row must say it is a submodule");
    // The whole point of the flag pair: a REGISTERED submodule is never "embedded",
    // because its gitlink is intentional and staging it is a legal pointer update.
    assert!(
        !row.embedded,
        "a registered submodule must not be reported as an embedded repo"
    );
}

#[test]
fn a_repo_without_gitmodules_never_flags_a_submodule() {
    // The cheap path: `declared_submodule_paths` must return empty without
    // touching disk, and no ordinary file may come back flagged.
    let tr = support::TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "extra.txt", "x\n");
    let (backend, handle) = tr.open_with_backend();

    let files = backend.list_all_files(&handle.id).expect("list_all_files");
    assert!(!files.is_empty());
    assert!(files.iter().all(|f| !f.submodule));
}
