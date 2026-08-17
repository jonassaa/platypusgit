//! GPG-side tag signing (#132).
//!
//! `tests/tag_signing.rs` covers the SSH format end to end, because `ssh-keygen`
//! can mint a throwaway key in a temp dir. The OpenPGP verdict mapping was, until
//! this file, backed only by hand-written fixtures in `git/tag.rs` — which is
//! exactly how `ERRSIG`'s positional tail came to be rendered as a signer name.
//!
//! Two layers here, deliberately:
//!
//! 1. **Stub-`gpg.program` tests** (need only `/bin/sh`, so they always run).
//!    Everything except the cryptography is real: our `create_signed_tag` with
//!    the real OpenPGP `signing_args` argv, a real tag object, a real
//!    `git verify-tag --raw`, and the real `parse_verify_tag`. This is what pins
//!    the two facts the parser depends on and no unit test can establish — that
//!    git relays gpg's status lines **with** the `[GNUPG:] ` prefix, and that it
//!    writes them to **stderr**.
//! 2. **A real-gpg test**, gated on the binary being present and run against an
//!    **ephemeral `GNUPGHOME`** in a temp dir, so it never touches the user's
//!    keyring. Skips with a printed note when gpg is unavailable.

mod support;

use platypusgit_lib::git::signing::SigState;
use platypusgit_lib::git::types::TagTarget;
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

fn annotated(oid: &str, msg: &str) -> TagTarget {
    TagTarget {
        oid: oid.to_string(),
        annotation: Some(msg.to_string()),
        sign: Some(true),
    }
}

fn head_oid(tr: &TempRepo) -> String {
    tr.repo.head().unwrap().target().unwrap().to_string()
}

/// A temp dir with a short path.
///
/// `std::env::temp_dir()` on macOS is `/var/folders/…/T/`, long enough that a
/// gpg-agent socket under it can exceed `sun_path`'s 108 bytes. `/tmp` keeps the
/// real-gpg fixture below that.
fn short_tempdir() -> tempfile::TempDir {
    let base = std::path::Path::new("/tmp");
    let mut b = tempfile::Builder::new();
    let b = b.prefix("pgt");
    if base.is_dir() {
        b.tempdir_in(base).unwrap()
    } else {
        b.tempdir().unwrap()
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 1 — the pipeline, with a stubbed signer
// ═══════════════════════════════════════════════════════════════════════════

/// Write an executable stub that answers as gpg does for the two invocations git
/// and we actually make.
///
/// git calls `gpg.program` two ways (recorded from git 2.50.1):
///   sign:   `--status-fd=2 -bsau <key>`, payload on stdin, armor on stdout
///   verify: `--keyid-format=long --status-fd=1 --verify <sigfile> -`
///
/// `verify_status` is emitted on the status fd for the verify call; signing
/// always succeeds, so every test starts from a real signed tag object.
#[cfg(unix)]
fn write_stub_gpg(
    dir: &std::path::Path,
    verify_status: &str,
    verify_exit: i32,
) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt as _;

    assert!(
        !verify_status.contains('\''),
        "the stub embeds this in a single-quoted sh string"
    );
    let path = dir.join("fakegpg");
    let script = format!(
        "#!/bin/sh\n\
         for a in \"$@\"; do\n\
         \x20 if [ \"$a\" = \"--verify\" ]; then\n\
         \x20   cat >/dev/null\n\
         \x20   printf '%s' '{verify_status}'\n\
         \x20   exit {verify_exit}\n\
         \x20 fi\n\
         done\n\
         cat >/dev/null\n\
         printf -- '-----BEGIN PGP SIGNATURE-----\\n\\nZmFrZXNpZw==\\n-----END PGP SIGNATURE-----\\n'\n\
         exit 0\n"
    );
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// A repo whose OpenPGP signer is the stub above.
#[cfg(unix)]
fn stub_gpg_repo(verify_status: &str, verify_exit: i32) -> (TempRepo, tempfile::TempDir) {
    let tr = TempRepo::with_initial_commit("hello\n");
    let dir = short_tempdir();
    let program = write_stub_gpg(dir.path(), verify_status, verify_exit);
    {
        let mut c = tr.repo.config().unwrap();
        // gpg.format left at its default (openpgp) on purpose — this is the
        // format the SSH tests cannot reach.
        c.set_str("gpg.program", program.to_str().unwrap()).unwrap();
        c.set_str("user.signingkey", "DEADBEEFCAFE1234").unwrap();
    }
    (tr, dir)
}

#[cfg(unix)]
const GOOD_STATUS: &str = "[GNUPG:] NEWSIG\n\
                           [GNUPG:] GOODSIG DEADBEEFCAFE1234 Ada Lovelace <ada@example.com>\n\
                           [GNUPG:] VALIDSIG ABCDEF 2026-08-16\n\
                           [GNUPG:] TRUST_ULTIMATE 0 pgp\n";

#[cfg(unix)]
#[test]
fn an_openpgp_signed_tag_round_trips_through_real_git_verify_tag() {
    // The load-bearing one: it proves `git verify-tag --raw` hands us gpg's
    // status lines WITH the `[GNUPG:] ` prefix and on STDERR. `parse_verify_tag`
    // requires the prefix and reads both streams; a unit test cannot establish
    // either, because both are git's behaviour, not ours.
    let (tr, _dir) = stub_gpg_repo(GOOD_STATUS, 0);
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release 1.0.0"))
        .expect("signed tag");

    // The object really is an annotated tag carrying PGP armor.
    let tags = backend.tags(&handle.id).unwrap();
    assert!(tags.iter().any(|t| t.name == "v1.0.0" && t.signed));

    let status = backend.verify_tag(&handle.id, "v1.0.0").expect("verify");
    assert_eq!(status.state, SigState::Good);
    assert_eq!(status.key.as_deref(), Some("DEADBEEFCAFE1234"));
    assert_eq!(
        status.signer.as_deref(),
        Some("Ada Lovelace <ada@example.com>")
    );
}

#[cfg(unix)]
#[test]
fn an_openpgp_bad_signature_reaches_the_ui_as_bad() {
    let (tr, _dir) = stub_gpg_repo(
        "[GNUPG:] NEWSIG\n[GNUPG:] BADSIG DEADBEEFCAFE1234 Ada Lovelace <ada@example.com>\n",
        1,
    );
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);
    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release"))
        .unwrap();

    assert_eq!(
        backend.verify_tag(&handle.id, "v1.0.0").unwrap().state,
        SigState::Bad
    );
}

#[cfg(unix)]
#[test]
fn an_unavailable_openpgp_key_yields_unknown_key_with_no_signer() {
    // ERRSIG's tail is gpg's positional fields, not a name. Rendering it put
    // "1 8 00 1755302400 9 -" where the badge tooltip shows the signer — the
    // concrete bug hand-written fixtures missed, because the unit test asserted
    // only the key.
    let (tr, _dir) = stub_gpg_repo(
        "[GNUPG:] ERRSIG DEADBEEFCAFE1234 1 8 00 1755302400 9 -\n\
         [GNUPG:] NO_PUBKEY DEADBEEFCAFE1234\n",
        1,
    );
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);
    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release"))
        .unwrap();

    let status = backend.verify_tag(&handle.id, "v1.0.0").unwrap();
    assert_eq!(status.state, SigState::UnknownKey);
    assert_eq!(status.key.as_deref(), Some("DEADBEEFCAFE1234"));
    assert!(
        status.signer.is_none(),
        "ERRSIG carries no signer, got {:?}",
        status.signer
    );
}

#[cfg(unix)]
#[test]
fn a_failing_openpgp_signer_creates_no_tag() {
    // The stub's signing branch is bypassed by pointing at a program that is not
    // there at all — the rule is the same one commit_signed follows.
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.program", "definitely-not-a-real-gpg").unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "nope"))
        .expect_err("a signing failure must fail the tag");
    assert!(tr.repo.find_reference("refs/tags/v1.0.0").is_err());
}

#[cfg(unix)]
#[test]
fn a_name_collision_is_refused_before_the_signer_runs() {
    // With a passphrase-protected key the old ordering popped pinentry, took the
    // passphrase, and only then failed with "tag already exists". The stub logs
    // nothing, so the assertion is the cheaper one: the tag that already exists
    // is untouched, and the error names the collision.
    let (tr, _dir) = stub_gpg_repo(GOOD_STATUS, 0);
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "first"))
        .unwrap();
    let first = tr
        .repo
        .find_reference("refs/tags/v1.0.0")
        .unwrap()
        .target()
        .unwrap();

    let err = backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "second"))
        .expect_err("a duplicate tag name must be refused");
    assert!(
        format!("{err:?}").contains("already exists"),
        "expected a collision error, got {err:?}"
    );

    let after = tr
        .repo
        .find_reference("refs/tags/v1.0.0")
        .unwrap()
        .target()
        .unwrap();
    assert_eq!(first, after, "the existing tag must be untouched");
}

// ═══════════════════════════════════════════════════════════════════════════
// Layer 2 — real gpg, ephemeral keyring
// ═══════════════════════════════════════════════════════════════════════════

/// A real gpg keyring in a temp `GNUPGHOME`, plus a wrapper that injects it.
///
/// The wrapper exists so the home never leaks into the process environment:
/// `std::env::set_var` is global and this test binary runs its tests in
/// parallel, so a second test could pick up this keyring. Pointing
/// `gpg.program` at a script is race-free and reaches BOTH callers — our
/// `run_signer` and git's own verify.
#[cfg(unix)]
struct GpgFixture {
    dir: tempfile::TempDir,
    program: std::path::PathBuf,
    fingerprint: String,
}

#[cfg(unix)]
impl Drop for GpgFixture {
    fn drop(&mut self) {
        // gpg-agent daemonizes against the ephemeral home; leave none behind.
        let _ = std::process::Command::new("gpgconf")
            .args(["--homedir".as_ref(), self.dir.path().as_os_str()])
            .arg("--kill")
            .arg("gpg-agent")
            .output();
    }
}

/// `None` when gpg is unavailable or key generation fails, so the test skips.
#[cfg(unix)]
fn real_gpg() -> Option<GpgFixture> {
    use std::os::unix::fs::PermissionsExt as _;

    // Present at all?
    std::process::Command::new("gpg")
        .arg("--version")
        .output()
        .ok()
        .filter(|o| o.status.success())?;

    let dir = short_tempdir();
    let home = dir.path().join("gnupg");
    std::fs::create_dir_all(&home).ok()?;
    std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).ok()?;

    // A passphrase-less signing key, so nothing ever prompts. `%no-protection`
    // is why: without it gpg-agent would raise pinentry with no tty to draw on.
    let params = "%no-protection\n\
                  Key-Type: eddsa\n\
                  Key-Curve: Ed25519\n\
                  Key-Usage: sign\n\
                  Name-Real: Platypus Test\n\
                  Name-Email: test@example.invalid\n\
                  Expire-Date: 0\n\
                  %commit\n";
    let params_path = dir.path().join("keyparams");
    std::fs::write(&params_path, params).ok()?;

    let gen = std::process::Command::new("gpg")
        .arg("--homedir")
        .arg(&home)
        .args(["--batch", "--no-tty", "--gen-key"])
        .arg(&params_path)
        .output()
        .ok()?;
    if !gen.status.success() {
        eprintln!(
            "gpg key generation failed, skipping: {}",
            String::from_utf8_lossy(&gen.stderr).trim()
        );
        return None;
    }

    // `--with-colons` so the fingerprint is a field, not prose.
    let listed = std::process::Command::new("gpg")
        .arg("--homedir")
        .arg(&home)
        .args(["--batch", "--with-colons", "--list-secret-keys"])
        .output()
        .ok()?;
    let fingerprint = String::from_utf8_lossy(&listed.stdout)
        .lines()
        .find_map(|l| l.strip_prefix("fpr:"))
        .and_then(|rest| rest.split(':').find(|f| !f.is_empty()))
        .map(str::to_string)?;

    let program = dir.path().join("gpgwrap");
    std::fs::write(
        &program,
        format!(
            "#!/bin/sh\nexport GNUPGHOME='{}'\nexec gpg --batch --no-tty \"$@\"\n",
            home.display()
        ),
    )
    .ok()?;
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).ok()?;

    Some(GpgFixture {
        dir,
        program,
        fingerprint,
    })
}

#[cfg(unix)]
#[test]
fn a_real_gpg_signed_tag_verifies_good_and_git_accepts_it() {
    let Some(gpg) = real_gpg() else {
        eprintln!("gpg unavailable — skipping real-gpg tag test");
        return;
    };
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.program", gpg.program.to_str().unwrap())
            .unwrap();
        c.set_str("user.signingkey", &gpg.fingerprint).unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);

    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release 1.0.0"))
        .expect("real gpg signed tag");

    // Interop: our hand-rolled object has to satisfy git, not just us.
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(tr.path())
        .args(["verify-tag", "--raw", "--", "v1.0.0"])
        .output()
        .expect("git verify-tag");
    assert!(
        out.status.success(),
        "git rejected our gpg-signed tag: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let status = backend.verify_tag(&handle.id, "v1.0.0").expect("verify");
    assert_eq!(
        status.state,
        SigState::Good,
        "signer={:?} key={:?}",
        status.signer,
        status.key
    );
    assert!(
        status
            .signer
            .as_deref()
            .is_some_and(|s| s.contains("Platypus Test")),
        "signer should name the key's user id, got {:?}",
        status.signer
    );
}

#[cfg(unix)]
#[test]
fn a_tampered_real_gpg_tag_is_bad() {
    let Some(gpg) = real_gpg() else {
        eprintln!("gpg unavailable — skipping tampered real-gpg tag test");
        return;
    };
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.program", gpg.program.to_str().unwrap())
            .unwrap();
        c.set_str("user.signingkey", &gpg.fingerprint).unwrap();
    }
    let (backend, handle) = tr.open_with_backend();
    let oid = head_oid(&tr);
    backend
        .create_tag(&handle.id, "v1.0.0", annotated(&oid, "release"))
        .unwrap();

    // Rewrite the object with one message byte changed and repoint the ref. The
    // armor is untouched, so it still reads as "signed" — the signature simply
    // no longer covers the payload.
    let tag_oid = tr
        .repo
        .find_reference("refs/tags/v1.0.0")
        .unwrap()
        .target()
        .unwrap();
    let body = tr.repo.odb().unwrap().read(tag_oid).unwrap().data().to_vec();
    let tampered = String::from_utf8(body)
        .unwrap()
        .replacen("release", "relaese", 1)
        .into_bytes();
    let bad = tr
        .repo
        .odb()
        .unwrap()
        .write(git2::ObjectType::Tag, &tampered)
        .unwrap();
    tr.repo
        .reference("refs/tags/v1.0.0", bad, true, "tamper")
        .unwrap();

    assert_eq!(
        backend.verify_tag(&handle.id, "v1.0.0").unwrap().state,
        SigState::Bad,
        "a tampered payload must not read as verified"
    );
}
