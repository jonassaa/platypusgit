//! Commit signing (#61 D6).
//!
//! The load-bearing assertion is that a signed commit is REACHABLE FROM HEAD:
//! `repo.commit_signed` only writes the object, unlike
//! `repo.commit(Some("HEAD"), …)`, so a signed commit that never moves the
//! branch looks to the user exactly like lost work.

mod support;

use platypusgit_lib::git::signing::{config_wants_signing, resolve_signing, SigFormat};
use platypusgit_lib::git::types::CommitOptions;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

fn opts(message: &str, sign: Option<bool>) -> CommitOptions {
    CommitOptions {
        message: message.into(),
        amend: false,
        author_override: None,
        signoff: false,
        sign,
        no_verify: false,
    }
}

// ─── config resolution ───────────────────────────────────────────────────────

#[test]
fn defaults_to_openpgp_with_gpg_and_no_signing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let cfg = resolve_signing(&tr.repo).unwrap();
    assert_eq!(cfg.format, SigFormat::OpenPgp);
    assert_eq!(cfg.program, "gpg");
    assert!(!config_wants_signing(&tr.repo));
}

#[test]
fn reads_ssh_format_and_program_and_key() {
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        c.set_str("user.signingkey", "/keys/id_ed25519").unwrap();
        c.set_bool("commit.gpgsign", true).unwrap();
    }
    let cfg = resolve_signing(&tr.repo).unwrap();
    assert_eq!(cfg.format, SigFormat::Ssh);
    assert_eq!(cfg.program, "ssh-keygen");
    assert_eq!(cfg.key.as_deref(), Some("/keys/id_ed25519"));
    assert!(config_wants_signing(&tr.repo));
}

#[test]
fn honours_an_explicit_gpg_program() {
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.program", "/usr/local/bin/gpg2").unwrap();
    }
    assert_eq!(
        resolve_signing(&tr.repo).unwrap().program,
        "/usr/local/bin/gpg2"
    );
}

// ─── signing ─────────────────────────────────────────────────────────────────

/// Generate an unencrypted ed25519 key in `dir`, returning its private-key path.
/// `None` when ssh-keygen is unavailable, so the test skips rather than fails.
fn make_ssh_key(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let key = dir.join("id_ed25519");
    let out = std::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-C", "test", "-f"])
        .arg(&key)
        .output()
        .ok()?;
    out.status.success().then_some(key)
}

/// Repo configured for ssh signing with its own generated key, plus a staged
/// change ready to commit. `None` when ssh-keygen is unavailable.
fn ssh_signing_repo() -> Option<(TempRepo, tempfile::TempDir)> {
    let tr = TempRepo::with_initial_commit("hello\n");
    let keydir = tempfile::tempdir().unwrap();
    let key = make_ssh_key(keydir.path())?;
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        c.set_str("user.signingkey", key.to_str().unwrap()).unwrap();
    }
    support::fs::write_file(tr.path(), "b.txt", "second\n");
    Some((tr, keydir))
}

#[test]
fn signed_commit_is_reachable_from_head_and_has_a_gpgsig_header() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping signed-commit test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();

    let oid = backend
        .commit(&handle.id, opts("signed", Some(true)))
        .expect("signed commit")
        .oid;

    // THE trap: commit_signed writes the object but does not move HEAD.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), oid, "signed commit must be HEAD");
    assert_eq!(head.parent_count(), 1, "must keep its parent");
    assert_eq!(head.summary().unwrap(), Some("signed"));

    let header = head
        .header_field_bytes("gpgsig")
        .expect("commit should carry a gpgsig header");
    assert!(!header.is_empty(), "signature must not be empty");
}

#[test]
fn signed_commit_writes_a_reflog_entry() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping signed reflog test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();
    backend
        .commit(&handle.id, opts("signed", Some(true)))
        .unwrap();

    let entries = backend.read_reflog(&handle.id).expect("reflog");
    assert!(
        entries.iter().any(|e| e.message.contains("signed")),
        "signed commit must leave a reflog entry, got {:?}",
        entries.iter().map(|e| &e.message).collect::<Vec<_>>()
    );
}

#[test]
fn signed_amend_replaces_head_and_stays_signed() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping signed amend test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();
    backend
        .commit(&handle.id, opts("original", Some(true)))
        .unwrap();
    let parent_before = tr
        .repo
        .head()
        .unwrap()
        .peel_to_commit()
        .unwrap()
        .parent(0)
        .unwrap()
        .id();

    let amended = backend
        .commit(
            &handle.id,
            CommitOptions {
                amend: true,
                ..opts("amended", Some(true))
            },
        )
        .expect("signed amend")
        .oid;

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), amended, "amend must move HEAD");
    assert_eq!(head.summary().unwrap(), Some("amended"));
    assert_eq!(
        head.parent(0).unwrap().id(),
        parent_before,
        "amend must keep the original parent, not chain onto the old commit"
    );
    assert!(head.header_field_bytes("gpgsig").is_ok(), "still signed");
}

#[test]
fn unsigned_commit_path_is_unchanged() {
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "b.txt", "second\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();

    let oid = backend
        .commit(&handle.id, opts("plain", Some(false)))
        .unwrap()
        .oid;

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), oid);
    assert!(
        head.header_field_bytes("gpgsig").is_err(),
        "must not be signed"
    );
}

#[test]
fn sign_none_follows_commit_gpgsign_being_off() {
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "b.txt", "second\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();

    // No commit.gpgsign set → unsigned, and crucially no attempt to run gpg.
    let oid = backend.commit(&handle.id, opts("plain", None)).unwrap().oid;
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), oid);
    assert!(head.header_field_bytes("gpgsig").is_err());
}

#[test]
fn verify_commit_rejects_a_non_hex_revision() {
    // `git show` would read a leading '-' as an option; every real caller passes
    // an oid from the log walk, so anything else is refused before the subprocess.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    for bad in ["--help", "HEAD", "", "zzzz"] {
        let err = backend
            .verify_commit(&handle.id, bad)
            .expect_err("should refuse a non-hex revision");
        assert!(
            matches!(err, platypusgit_lib::error::AppError::InvalidRef(_)),
            "expected InvalidRef for {bad:?}, got {err:?}"
        );
    }
}

#[test]
fn verify_commit_reports_an_unsigned_commit_as_none() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let oid = tr.repo.head().unwrap().target().unwrap().to_string();

    let status = backend.verify_commit(&handle.id, &oid).expect("verify");
    assert_eq!(
        status.state,
        platypusgit_lib::git::signing::SigState::None,
        "an unsigned commit must read as None"
    );
}

/// `ssh_signing_repo`, plus an allowed-signers file naming the generated key, so
/// `%G?` can reach a `Good` verdict rather than only "signature present" — git
/// grades an ssh signature it cannot attribute as `U` or refuses it outright.
/// Mirrors `tag_signing.rs`'s fixture.
fn ssh_signing_repo_with_allowed_signers() -> Option<(TempRepo, tempfile::TempDir)> {
    let (tr, keydir) = ssh_signing_repo()?;
    let key = keydir.path().join("id_ed25519");

    // "<principal> <keytype> <base64>" — the principal must match the committer
    // email TempRepo uses, or ssh-keygen finds no principal for it.
    let pubkey = std::fs::read_to_string(key.with_extension("pub")).ok()?;
    let mut fields = pubkey.split_whitespace();
    let (kind, blob) = (fields.next()?, fields.next()?);
    let email = tr
        .repo
        .config()
        .unwrap()
        .get_string("user.email")
        .unwrap_or_default();
    let allowed = keydir.path().join("allowed_signers");
    std::fs::write(&allowed, format!("{email} {kind} {blob}\n")).ok()?;
    tr.repo
        .config()
        .unwrap()
        .set_str("gpg.ssh.allowedSignersFile", allowed.to_str().unwrap())
        .unwrap();
    Some((tr, keydir))
}

/// The other half of the issue-172 pre-check: skipping the subprocess for
/// unsigned commits must not skip it for signed ones. `verify_commit` still
/// shells out to `git show --format=%G?` and still reports git's own verdict.
#[test]
fn verify_commit_grades_our_own_signature_good() {
    let Some((tr, _keydir)) = ssh_signing_repo_with_allowed_signers() else {
        eprintln!("ssh-keygen unavailable — skipping verify_commit good test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();
    let oid = backend
        .commit(&handle.id, opts("signed", Some(true)))
        .expect("signed commit")
        .oid;

    let status = backend.verify_commit(&handle.id, &oid).expect("verify");
    assert_eq!(
        status.state,
        platypusgit_lib::git::signing::SigState::Good,
        "signer={:?} key={:?}",
        status.signer,
        status.key
    );
}

/// The pre-check reads the commit HEADER, not the signature's validity: a commit
/// carrying `gpgsig` must reach git even when what it carries is nonsense, or a
/// tampered signature would silently read as "unsigned" instead of `Bad`.
#[test]
fn verify_commit_does_not_report_a_broken_signature_as_unsigned() {
    let Some((tr, _keydir)) = ssh_signing_repo_with_allowed_signers() else {
        eprintln!("ssh-keygen unavailable — skipping broken-signature test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();

    // A commit object whose gpgsig header holds garbage.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    let buf = tr
        .repo
        .commit_create_buffer(
            &head.author(),
            &head.committer(),
            "tampered",
            &head.tree().unwrap(),
            &[&head],
        )
        .unwrap();
    let oid = tr
        .repo
        .commit_signed(
            std::str::from_utf8(&buf).unwrap(),
            "-----BEGIN SSH SIGNATURE-----\ngarbage\n-----END SSH SIGNATURE-----\n",
            None,
        )
        .unwrap()
        .to_string();

    let state = backend.verify_commit(&handle.id, &oid).expect("verify").state;
    assert_ne!(
        state,
        platypusgit_lib::git::signing::SigState::None,
        "a commit carrying a gpgsig header must never grade as unsigned"
    );
}

#[test]
fn a_signing_failure_fails_the_commit_instead_of_committing_unsigned() {
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        // A program that does not exist: signing cannot succeed.
        c.set_str("gpg.ssh.program", "definitely-not-a-real-program").unwrap();
        c.set_str("user.signingkey", "/nonexistent/key").unwrap();
    }
    support::fs::write_file(tr.path(), "b.txt", "second\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();

    let head_before = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    let err = backend
        .commit(&handle.id, opts("should fail", Some(true)))
        .expect_err("a signing failure must fail the commit");

    // Falling back to an unsigned commit would leave the user believing they
    // had signed it.
    let head_after = tr.repo.head().unwrap().peel_to_commit().unwrap().id();
    assert_eq!(head_before, head_after, "HEAD must not move: {err:?}");
}
