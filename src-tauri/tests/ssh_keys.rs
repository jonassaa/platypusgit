//! SSH key discovery and generation (#248).
//!
//! **Nothing here goes anywhere near the real `~/.ssh`.** Every test takes an
//! explicit directory — `ssh::discover`, `ssh::status` and `ssh::generate` all
//! do, precisely so they can be driven against a `tempfile::TempDir` — and the
//! one function that resolves `$HOME/.ssh` (`ssh::ssh_dir`) is called only by
//! the command layer, which is not exercised here.
//!
//! The tests that need `ssh-keygen` say so and skip with a printed note when it
//! is absent, the way `tag_signing_gpg.rs` skips on a missing gpg: a Windows
//! runner without OpenSSH must not fail a suite over a binary this feature
//! reports as unavailable anyway.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use platypusgit_lib::forge::ForgeKind;
use platypusgit_lib::ssh::{
    self, add_key_url, discover, fingerprint, generate, parse_public_key, status, suggested_name,
    GenerateRequest,
};

/// A real ed25519 public key generated for this file. Its private half does not
/// exist anywhere, which is the point: discovery only ever reads the `.pub`.
const SAMPLE_PUB: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMsRg9EEV7W44VBb0PAvOFpgjbAzGNXUPT82Qu4xNiA9 probe@example.com";

fn keygen_present() -> bool {
    ssh::keygen_available()
}

/// Skip-with-a-reason, so an absent OpenSSH reads as a note rather than a
/// failure or — worse — a silently vacuous pass.
macro_rules! require_keygen {
    () => {
        if !keygen_present() {
            eprintln!("ssh-keygen unavailable — skipping");
            return;
        }
    };
}

/// Stage a key pair the way a real one sits on disk: a `.pub` line plus a
/// private file. The private text is a placeholder — nothing under test reads
/// it, which is itself part of the contract.
fn stage_pair(dir: &Path, name: &str, pub_line: &str) {
    std::fs::write(dir.join(format!("{name}.pub")), format!("{pub_line}\n")).unwrap();
    ssh::write_private_fixture(
        &dir.join(name),
        "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n-----END OPENSSH PRIVATE KEY-----\n",
    )
    .unwrap();
}

fn req(name: &str) -> GenerateRequest {
    GenerateRequest {
        name: Some(name.to_string()),
        comment: Some("tester@example.com".to_string()),
        passphrase: None,
    }
}

/// An askpass that answers every prompt with `$PLATYPUSGIT_ASKPASS_SECRET` —
/// the same contract the real shim in `lib.rs::run` implements.
///
/// The reason `ssh::generate` takes the askpass as a PARAMETER: this test
/// binary is not the app binary, so `current_exe()` here is not an askpass, and
/// without the parameter the passphrase path would have no test at all.
#[cfg(unix)]
fn write_askpass(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("askpass.sh");
    std::fs::write(&path, "#!/bin/sh\nprintf '%s' \"$PLATYPUSGIT_ASKPASS_SECRET\"\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// An askpass that prints nothing and fails — what a broken or absent askpass
/// looks like from ssh-keygen's side.
#[cfg(unix)]
fn write_silent_askpass(dir: &Path) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let path = dir.join("silent.sh");
    std::fs::write(&path, "#!/bin/sh\nexit 1\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

/// Placeholder for the askpass on a run that asks for no passphrase — it is
/// never consulted, and passing a path that does not exist proves it.
fn unused_askpass() -> PathBuf {
    PathBuf::from("/nonexistent/askpass")
}

// ─── discovery ───────────────────────────────────────────────────────────────

#[test]
fn discovers_a_pair_and_reads_its_algorithm_comment_and_fingerprint() {
    let dir = tempfile::tempdir().unwrap();
    stage_pair(dir.path(), "id_ed25519", SAMPLE_PUB);

    let keys = discover(dir.path());
    assert_eq!(keys.len(), 1);
    let k = &keys[0];
    assert_eq!(k.algorithm, "ssh-ed25519");
    assert_eq!(k.comment, "probe@example.com");
    assert_eq!(k.public_key, SAMPLE_PUB);
    assert!(k.is_default_identity, "id_ed25519 is one ssh tries by itself");
    let (_, blob, _) = parse_public_key(SAMPLE_PUB).unwrap();
    assert_eq!(k.fingerprint, fingerprint(&blob).unwrap());
    assert!(k.path.ends_with("id_ed25519"));
    assert!(k.public_path.ends_with("id_ed25519.pub"));
}

#[test]
fn a_public_key_with_no_private_sibling_is_not_a_key_you_can_authenticate_with() {
    // What is left after someone moved the private half to another machine.
    // Listing it would tell the user they have a key when they cannot use it.
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("id_ed25519.pub"), SAMPLE_PUB).unwrap();
    assert!(discover(dir.path()).is_empty());
}

#[test]
fn junk_in_the_ssh_directory_does_not_break_discovery() {
    let dir = tempfile::tempdir().unwrap();
    stage_pair(dir.path(), "id_ed25519", SAMPLE_PUB);
    // known_hosts, config, an agent socket's leftovers, a `.pub` that is not one.
    std::fs::write(dir.path().join("known_hosts"), "github.com ssh-ed25519 AAAA\n").unwrap();
    std::fs::write(dir.path().join("config"), "Host *\n  AddKeysToAgent yes\n").unwrap();
    std::fs::write(dir.path().join("garbage.pub"), "not a key at all\n").unwrap();
    std::fs::write(dir.path().join("garbage"), "x\n").unwrap();

    let keys = discover(dir.path());
    assert_eq!(keys.len(), 1, "only the real pair: {keys:?}");
    assert_eq!(keys[0].algorithm, "ssh-ed25519");
}

#[test]
fn a_private_key_is_never_mistaken_for_a_public_one() {
    // `-----BEGIN OPENSSH PRIVATE KEY-----` splits into three whitespace fields
    // of dashes and capitals, so a charset-only parser reads it as
    // `<algo> <blob> <comment>`. Nothing about this feature may ever put private
    // key material into a payload.
    let dir = tempfile::tempdir().unwrap();
    let private = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA\n-----END OPENSSH PRIVATE KEY-----\n";
    std::fs::write(dir.path().join("id_ed25519.pub"), private).unwrap();
    ssh::write_private_fixture(&dir.path().join("id_ed25519"), private).unwrap();
    assert!(discover(dir.path()).is_empty());
}

#[test]
fn default_identities_sort_ahead_of_the_rest() {
    let dir = tempfile::tempdir().unwrap();
    stage_pair(dir.path(), "zz_custom", SAMPLE_PUB);
    stage_pair(dir.path(), "id_ed25519", SAMPLE_PUB);
    stage_pair(dir.path(), "aa_custom", SAMPLE_PUB);

    let names: Vec<String> = discover(dir.path())
        .iter()
        .map(|k| {
            Path::new(&k.path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(names, vec!["id_ed25519", "aa_custom", "zz_custom"]);
    let flags: Vec<bool> = discover(dir.path())
        .iter()
        .map(|k| k.is_default_identity)
        .collect();
    assert_eq!(flags, vec![true, false, false]);
}

#[test]
fn status_reports_the_directory_it_looked_in_and_a_free_name() {
    let dir = tempfile::tempdir().unwrap();
    stage_pair(dir.path(), "id_ed25519", SAMPLE_PUB);

    let s = status(dir.path(), Some("github.com"), None);
    assert_eq!(s.dir, dir.path().to_string_lossy());
    assert!(s.dir_exists);
    assert_eq!(s.keys.len(), 1);
    assert_eq!(s.host.as_deref(), Some("github.com"));
    assert_eq!(
        s.add_key_url.as_deref(),
        Some("https://github.com/settings/ssh/new")
    );
    // The conventional name is taken, so the suggestion must not be it.
    assert_eq!(s.suggested_name, "id_ed25519_github");
    assert!(!s.suggested_comment.is_empty());
}

#[test]
fn status_on_a_machine_with_no_ssh_directory_is_a_state_not_a_failure() {
    let dir = tempfile::tempdir().unwrap();
    let missing = dir.path().join("never-created");
    let s = status(&missing, None, None);
    assert!(!s.dir_exists);
    assert!(s.keys.is_empty());
    assert_eq!(s.suggested_name, "id_ed25519");
    assert_eq!(s.add_key_url, None, "no host named, nothing to link to");
}

// ─── generation ──────────────────────────────────────────────────────────────

#[test]
fn generates_a_usable_pair_and_returns_only_the_public_half() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();

    let key = generate(dir.path(), &req("id_ed25519"), &unused_askpass()).unwrap();

    assert_eq!(key.algorithm, "ssh-ed25519");
    assert_eq!(key.comment, "tester@example.com");
    assert!(key.fingerprint.starts_with("SHA256:"));
    assert!(key.is_default_identity);
    assert!(Path::new(&key.path).is_file());
    assert!(Path::new(&key.public_path).is_file());

    // THE contract: the private key never crosses IPC. Asserted on the wire
    // format, not on the struct's fields, because a field added later would
    // pass a field-by-field check and still ship the key.
    let wire = serde_json::to_string(&key).unwrap();
    for forbidden in ["PRIVATE KEY", "BEGIN OPENSSH"] {
        assert!(
            !wire.contains(forbidden),
            "the payload carries private key material: {wire}"
        );
    }
    let private_text = std::fs::read_to_string(&key.path).unwrap();
    assert!(private_text.contains("PRIVATE KEY"), "sanity: it is a private key");
    assert!(!wire.contains(private_text.trim()));
}

#[test]
fn the_generated_private_key_is_0600_and_its_directory_0700() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    // A directory that does not exist yet, so `ensure_dir` is the thing under
    // test as well: a `~/.ssh` we created world-readable is one ssh complains
    // about on every connection.
    let ssh_dir = dir.path().join(".ssh");

    let key = generate(&ssh_dir, &req("id_ed25519"), &unused_askpass()).unwrap();

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
        assert_eq!(
            mode(Path::new(&key.path)),
            0o600,
            "ssh refuses a private key with looser permissions"
        );
        assert_eq!(mode(&ssh_dir), 0o700);
    }
    #[cfg(not(unix))]
    {
        // Modes are not a thing here; the assertion is only that it worked.
        assert!(Path::new(&key.path).is_file());
    }
}

#[test]
fn refuses_to_overwrite_an_existing_private_key() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    let first = generate(dir.path(), &req("id_ed25519"), &unused_askpass()).unwrap();
    let before = std::fs::read_to_string(&first.path).unwrap();

    let err = generate(dir.path(), &req("id_ed25519"), &unused_askpass()).unwrap_err();
    let wire = serde_json::to_value(&err).unwrap();
    assert_eq!(wire["kind"], "SshKeyExists", "{wire}");

    // The rule is not "report and continue" — the key on disk must be untouched.
    assert_eq!(std::fs::read_to_string(&first.path).unwrap(), before);
}

#[test]
fn refuses_when_only_the_public_half_is_in_the_way() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("id_ed25519.pub"), SAMPLE_PUB).unwrap();

    let err = generate(dir.path(), &req("id_ed25519"), &unused_askpass()).unwrap_err();
    let wire = serde_json::to_value(&err).unwrap();
    assert_eq!(wire["kind"], "SshKeyExists", "{wire}");
    // Untouched: ssh-keygen would have clobbered it without asking, since its
    // own overwrite prompt only guards the PRIVATE path.
    assert_eq!(
        std::fs::read_to_string(dir.path().join("id_ed25519.pub")).unwrap(),
        SAMPLE_PUB
    );
    assert!(!dir.path().join("id_ed25519").exists());
}

#[test]
fn refuses_a_name_that_is_a_path() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    let outside = dir.path().parent().unwrap().join("escaped");

    for name in ["../escaped", "sub/key", "-oProxyCommand=x", ".hidden"] {
        let mut r = req("unused");
        r.name = Some(name.to_string());
        let err = generate(dir.path(), &r, &unused_askpass()).unwrap_err();
        let wire = serde_json::to_value(&err).unwrap();
        assert_eq!(wire["kind"], "InvalidArgument", "{name:?} → {wire}");
    }
    assert!(!outside.exists(), "nothing was written outside the directory");
}

#[test]
fn refuses_a_comment_carrying_a_newline() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    let mut r = req("id_ed25519");
    // A newline would split the one-line `.pub` format in two.
    r.comment = Some("ada@example.com\nssh-ed25519 AAAA attacker".into());

    let err = generate(dir.path(), &r, &unused_askpass()).unwrap_err();
    let wire = serde_json::to_value(&err).unwrap();
    assert_eq!(wire["kind"], "InvalidArgument", "{wire}");
    assert!(!dir.path().join("id_ed25519").exists());
}

#[test]
fn an_omitted_name_falls_back_to_a_free_one() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    let mut r = req("unused");
    r.name = None;
    let first = generate(dir.path(), &r, &unused_askpass()).unwrap();
    assert!(first.path.ends_with("id_ed25519"));

    // And a second call does not collide with the first.
    let mut r2 = req("unused");
    r2.name = None;
    let second = generate(dir.path(), &r2, &unused_askpass()).unwrap();
    assert!(second.path.ends_with("id_ed25519_2"), "{}", second.path);
    let existing: BTreeSet<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_ne!(suggested_name(&existing, None), "id_ed25519");
}

// ─── the passphrase ──────────────────────────────────────────────────────────

#[cfg(unix)]
#[test]
fn a_passphrase_reaches_ssh_keygen_through_the_askpass_and_encrypts_the_key() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    let askpass = write_askpass(dir.path());
    let mut r = req("id_ed25519");
    r.passphrase = Some("correct horse battery staple".into());

    let key = generate(dir.path(), &r, &askpass).unwrap();

    // `ssh-keygen -y -P ""` prints the public half of an UNENCRYPTED key and
    // exits 0. Non-zero here is the proof the passphrase took.
    let plain = std::process::Command::new("ssh-keygen")
        .args(["-y", "-P", "", "-f", &key.path])
        .output()
        .unwrap();
    assert!(
        !plain.status.success(),
        "the key is readable with an empty passphrase — it is NOT encrypted"
    );
    let with_pass = std::process::Command::new("ssh-keygen")
        .args(["-y", "-P", "correct horse battery staple", "-f", &key.path])
        .output()
        .unwrap();
    assert!(with_pass.status.success(), "the real passphrase must open it");

    // And the secret is nowhere in the answer.
    let wire = serde_json::to_string(&key).unwrap();
    assert!(!wire.contains("correct horse battery staple"));
}

#[cfg(unix)]
#[test]
fn a_passphrase_that_does_not_stick_leaves_no_key_behind() {
    require_keygen!();
    let dir = tempfile::tempdir().unwrap();
    // An askpass that answers nothing is what an OpenSSH older than 8.4, or a
    // broken shim, looks like — and ssh-keygen's measured behaviour there is to
    // write an UNENCRYPTED key and exit 0. Telling the user "created,
    // encrypted" over that is the one outcome worse than failing.
    let askpass = write_silent_askpass(dir.path());
    let mut r = req("id_ed25519");
    r.passphrase = Some("hunter2".into());

    let err = generate(dir.path(), &r, &askpass).unwrap_err();
    let wire = serde_json::to_value(&err).unwrap();
    assert_ne!(wire["kind"], "SshKeyExists");

    assert!(
        !dir.path().join("id_ed25519").exists(),
        "an unencrypted key was left on disk after a passphrase was requested"
    );
    assert!(!dir.path().join("id_ed25519.pub").exists());

    // The message must not contain the passphrase.
    assert!(!serde_json::to_string(&err).unwrap().contains("hunter2"));

    // …and the name is free again, so the retry is not blocked by our own
    // half-written attempt.
    let ok = generate(dir.path(), &req("id_ed25519"), &unused_askpass());
    assert!(ok.is_ok(), "{ok:?}");
}

// ─── the add-key link ────────────────────────────────────────────────────────

// These assertions spell whole URLs, which is why they live HERE and not in
// `src/ssh.rs`'s inline tests: `tests/no_telemetry.rs` scans every `.rs` under
// `src/` for a baked-in hostname and cannot tell a fixture from a destination,
// so an inline `"https://gitlab.com/…"` would have to be allow-listed —
// widening the set of hosts the binary is permitted to know about in order to
// satisfy a test. The scanner does not read `tests/`, and the shipped module
// bakes in no host at all: the URL is `format!`ed from the caller's.

#[test]
fn the_add_key_link_names_the_two_builtin_forges() {
    assert_eq!(
        add_key_url("github.com", None).as_deref(),
        Some("https://github.com/settings/ssh/new")
    );
    assert_eq!(
        add_key_url("gitlab.com", None).as_deref(),
        Some("https://gitlab.com/-/user_settings/ssh_keys")
    );
}

#[test]
fn the_add_key_link_uses_the_configured_kind_for_a_self_hosted_host() {
    // The path is identical on an Enterprise or self-managed instance; only the
    // host differs, which is exactly why the host is a parameter and the path a
    // literal. A URL cannot tell the two forges apart, so the kind comes from
    // the user's own per-host mapping.
    assert_eq!(
        add_key_url("git.corp.example.com", Some(ForgeKind::GitHub)).as_deref(),
        Some("https://git.corp.example.com/settings/ssh/new")
    );
    assert_eq!(
        add_key_url("git.corp.example.com", Some(ForgeKind::GitLab)).as_deref(),
        Some("https://git.corp.example.com/-/user_settings/ssh_keys")
    );
}

#[test]
fn the_add_key_link_survives_the_opener_that_will_be_handed_it() {
    // The frontend hands this straight to `open_url`, which refuses anything
    // that is not https and re-parses it. A link the panel offers and the
    // opener then rejects would be a dead button.
    for host in ["github.com", "gitlab.com"] {
        let url = add_key_url(host, None).unwrap();
        assert!(platypusgit_lib::opener::safe_url(&url).is_ok(), "{url}");
    }
}
