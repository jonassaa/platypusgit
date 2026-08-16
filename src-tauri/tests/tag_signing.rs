//! Tag signing (#132).
//!
//! Two assertions carry this file. First, that a signed tag is a **tag object
//! reachable through `refs/tags/<name>`** — `tag_annotation_create` and
//! `odb.write` move no reference, the same trap `commit_signed` has, and a
//! signed tag object nothing points at is invisible. Second, that **git itself
//! accepts what we wrote**: we hand-roll the object, so `git tag -v` passing is
//! the only thing that proves the body and its appended signature are the shape
//! git expects, rather than merely the shape we expect.
//!
//! Every test that needs a real signature is gated on `ssh-keygen` being
//! available and skips with a printed note otherwise, matching `signing.rs`.

mod support;

use platypusgit_lib::error::AppError;
use platypusgit_lib::git::signing::SigState;
use platypusgit_lib::git::types::TagTarget;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

fn annotated(oid: &str, msg: &str, sign: Option<bool>) -> TagTarget {
    TagTarget {
        oid: oid.to_string(),
        annotation: Some(msg.to_string()),
        sign,
    }
}

fn lightweight(oid: &str, sign: Option<bool>) -> TagTarget {
    TagTarget {
        oid: oid.to_string(),
        annotation: None,
        sign,
    }
}

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

/// A repo configured for ssh signing with its own generated key, and an
/// allowed-signers file naming it, so `git tag -v` can reach a `Good` verdict
/// rather than only "signature present". `None` when ssh-keygen is unavailable.
fn ssh_signing_repo() -> Option<(TempRepo, tempfile::TempDir)> {
    let tr = TempRepo::with_initial_commit("hello\n");
    let keydir = tempfile::tempdir().unwrap();
    let key = make_ssh_key(keydir.path())?;

    // "<principal> <keytype> <base64>" — the principal must match the tagger
    // email TempRepo commits with, or ssh-keygen finds no principal and git
    // grades the signature U instead of G.
    let pubkey = std::fs::read_to_string(key.with_extension("pub")).ok()?;
    let mut fields = pubkey.split_whitespace();
    let (kind, blob) = (fields.next()?, fields.next()?);
    let email = {
        let cfg = tr.repo.config().unwrap();
        cfg.get_string("user.email").unwrap_or_default()
    };
    let allowed = keydir.path().join("allowed_signers");
    std::fs::write(&allowed, format!("{email} {kind} {blob}\n")).ok()?;

    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        c.set_str("user.signingkey", key.to_str().unwrap()).unwrap();
        c.set_str("gpg.ssh.allowedSignersFile", allowed.to_str().unwrap())
            .unwrap();
    }
    Some((tr, keydir))
}

fn head_oid(tr: &TempRepo) -> String {
    tr.repo.head().unwrap().target().unwrap().to_string()
}

// ─── writing ─────────────────────────────────────────────────────────────────

#[test]
fn a_signed_tag_is_reachable_and_carries_a_signature_block() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping signed-tag test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release 1.0.0", Some(true)))
        .expect("signed tag");

    // THE trap: tag_annotation_create and odb.write move no reference.
    let reference = tr
        .repo
        .find_reference("refs/tags/v1.0.0")
        .expect("refs/tags/v1.0.0 must exist");
    let tag = tr
        .repo
        .find_tag(reference.target().unwrap())
        .expect("must be an annotated tag OBJECT, not a lightweight ref");

    assert_eq!(tag.name(), Some("v1.0.0"));
    assert_eq!(
        tag.target_id().to_string(),
        oid,
        "must point at the commit it was asked to tag"
    );
    let message = tag.message().unwrap_or("");
    assert!(
        message.starts_with("release 1.0.0\n"),
        "the message must survive intact: {message:?}"
    );
    assert!(
        message.contains("-----BEGIN SSH SIGNATURE-----"),
        "signature block missing: {message:?}"
    );
}

#[test]
fn git_itself_verifies_the_tag_we_wrote() {
    // The interop assertion. We hand-roll the object, so our own parser agreeing
    // with us proves nothing — git has to accept it.
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping git tag -v interop test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);
    backend
        .create_tag(&handle.id, "v2.0.0", annotated(&oid, "release 2.0.0", Some(true)))
        .expect("signed tag");

    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(tr.path())
        .args(["verify-tag", "--raw", "--", "v2.0.0"])
        .output()
        .expect("git verify-tag");
    assert!(
        out.status.success(),
        "git rejected our tag object: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn a_signing_failure_creates_no_tag() {
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        // A program that does not exist: signing cannot succeed.
        c.set_str("gpg.ssh.program", "definitely-not-a-real-program")
            .unwrap();
        c.set_str("user.signingkey", "/nonexistent/key").unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    let err = backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "nope", Some(true)))
        .expect_err("a signing failure must fail the tag");

    // Falling back to an unsigned tag would leave the user believing they had
    // signed it — the same rule commit_signed follows.
    assert!(
        tr.repo.find_reference("refs/tags/v1.0.0").is_err(),
        "no ref may survive a signing failure: {err:?}"
    );
    assert!(
        backend.tags(&handle.id).unwrap().is_empty(),
        "no tag may be listed after a signing failure"
    );
}

#[test]
fn signing_a_lightweight_tag_is_refused_not_silently_dropped() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    let err = backend
        .create_tag(&handle.id, "v1.0.0", lightweight(&oid, Some(true)))
        .expect_err("a lightweight tag has no object to sign");
    assert!(matches!(err, AppError::InvalidArgument(_)), "got {err:?}");
    assert!(tr.repo.find_reference("refs/tags/v1.0.0").is_err());
}

#[test]
fn tag_gpgsign_does_not_promote_a_lightweight_tag() {
    // Real `git tag v1` fails outright here ("fatal: no tag message?"), which
    // would make lightweight tags unreachable in a signing repository. Our
    // annotation field's blankness MEANS lightweight, so it wins.
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_bool("tag.gpgsign", true).unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", lightweight(&oid, None))
        .expect("a lightweight tag stays reachable in a signing repo");

    let tags = backend.tags(&handle.id).unwrap();
    let tag = tags.iter().find(|t| t.name == "v1.0.0").expect("tag listed");
    assert!(!tag.signed);
    assert!(
        tr.repo
            .find_tag(tr.repo.find_reference("refs/tags/v1.0.0").unwrap().target().unwrap())
            .is_err(),
        "must stay lightweight — no tag object"
    );
}

#[test]
fn tag_gpgsign_is_the_default_for_an_annotated_tag() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping tag.gpgsign default test");
        return;
    };
    {
        let mut c = tr.repo.config().unwrap();
        c.set_bool("tag.gpgsign", true).unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    // sign: None follows the config…
    backend
        .create_tag(&handle.id, "from-config", annotated(&oid, "cfg", None))
        .expect("tag");
    // …and Some(false) overrides it for this tag only.
    backend
        .create_tag(&handle.id, "overridden", annotated(&oid, "off", Some(false)))
        .expect("tag");

    let tags = backend.tags(&handle.id).unwrap();
    let signed = |n: &str| tags.iter().find(|t| t.name == n).expect(n).signed;
    assert!(signed("from-config"), "tag.gpgsign must be the default");
    assert!(!signed("overridden"), "a per-tag override must win");
}

#[test]
fn commit_gpgsign_does_not_sign_tags() {
    // Separate keys in git, separate keys here: a repository that signs every
    // commit has not thereby asked for signed tags.
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping commit.gpgsign isolation test");
        return;
    };
    {
        let mut c = tr.repo.config().unwrap();
        c.set_bool("commit.gpgsign", true).unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "plain", None))
        .expect("tag");
    assert!(!backend.tags(&handle.id).unwrap()[0].signed);
}

// ─── listing ─────────────────────────────────────────────────────────────────

#[test]
fn tag_info_reports_signed_only_for_a_signed_annotated_tag() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping TagInfo.signed test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "signed", annotated(&oid, "s", Some(true)))
        .unwrap();
    backend
        .create_tag(&handle.id, "annotated", annotated(&oid, "a", Some(false)))
        .unwrap();
    backend
        .create_tag(&handle.id, "light", lightweight(&oid, None))
        .unwrap();

    let tags = backend.tags(&handle.id).unwrap();
    let signed = |n: &str| tags.iter().find(|t| t.name == n).expect(n).signed;
    assert!(signed("signed"));
    assert!(!signed("annotated"));
    assert!(!signed("light"));
}

// ─── verifying ───────────────────────────────────────────────────────────────

#[test]
fn verify_tag_grades_our_own_signature_good() {
    let Some((tr, _keydir)) = ssh_signing_repo() else {
        eprintln!("ssh-keygen unavailable — skipping verify_tag good test");
        return;
    };
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);
    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release", Some(true)))
        .unwrap();

    let status = backend.verify_tag(&handle.id, "v1.0.0").expect("verify");
    assert_eq!(
        status.state,
        SigState::Good,
        "signer={:?} key={:?}",
        status.signer,
        status.key
    );
}

#[test]
fn verify_tag_reports_unsigned_tags_as_none() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);
    backend
        .create_tag(&handle.id, "annotated", annotated(&oid, "a", Some(false)))
        .unwrap();
    backend
        .create_tag(&handle.id, "light", lightweight(&oid, None))
        .unwrap();

    // Both answered from the object, with no subprocess at all.
    assert_eq!(
        backend.verify_tag(&handle.id, "annotated").unwrap().state,
        SigState::None
    );
    assert_eq!(
        backend.verify_tag(&handle.id, "light").unwrap().state,
        SigState::None
    );
}

#[test]
fn verify_tag_refuses_a_name_that_would_read_as_an_option() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();

    for bad in ["--help", "", "v1 0", "a..b", "v1^"] {
        let err = backend
            .verify_tag(&handle.id, bad)
            .expect_err("should refuse an unusable tag name");
        assert!(
            matches!(err, AppError::InvalidRef(_)),
            "expected InvalidRef for {bad:?}, got {err:?}"
        );
    }
}

#[test]
fn verify_tag_reports_a_missing_tag_as_an_invalid_ref() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let err = backend
        .verify_tag(&handle.id, "nope")
        .expect_err("no such tag");
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
}

#[test]
fn create_tag_refuses_an_unusable_name_before_touching_the_repo() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    let err = backend
        .create_tag(&handle.id, "-rf", lightweight(&oid, None))
        .expect_err("a tag name cannot start with '-'");
    assert!(matches!(err, AppError::InvalidRef(_)), "got {err:?}");
    assert!(backend.tags(&handle.id).unwrap().is_empty());
}
