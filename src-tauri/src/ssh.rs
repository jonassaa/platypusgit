//! Finding and making an SSH key (#248).
//!
//! The other half of "clone over SSH failed". `git/auth.rs` can already say
//! *what* went wrong — `Permission denied (publickey)` is
//! `AuthKind::SshKey` — but nothing in the app could help the user fix it:
//! there was no way to see whether they had a key, no way to make one, and no
//! way to get the public half onto GitHub.
//!
//! # What is deliberately NOT claimed here
//!
//! [`discover`] answers "which keys are on this machine", **not** "which key
//! would ssh offer". A `~/.ssh/config` `IdentityFile`, a `Host` block, an
//! agent-only identity and the server's own algorithm preferences all change
//! the second answer, and a confident wrong answer is worse than an honest
//! list — so the keys OpenSSH tries with no configuration at all are *flagged*
//! ([`is_default_identity`]) rather than the list pretending to be ssh's.
//!
//! # Why this is not a `GitBackend` method
//!
//! An SSH key belongs to the machine and the user, not to a repository:
//! nothing here opens a repo, takes a `RepoId` or touches an index. It sits
//! beside `diagnostics.rs`, `update.rs` and `reveal.rs` — a logic module under
//! a thin `commands/ssh.rs`. Putting it on the trait would give a repo-shaped
//! signature to something with no repo in it and force a `NotImplemented` stub
//! in `git/cli.rs` that proves nothing.
//!
//! # The three refusals in [`generate`]
//!
//! Each one is a measured behaviour of `ssh-keygen`, not a defensive habit:
//!
//! 1. **Never overwrite.** `ssh-keygen -f <existing>` prints `already exists.`
//!    and then blocks on an interactive `Overwrite (y/n)?` — against a stdin
//!    nobody is feeding. So the existence check is ours, it covers the `.pub`
//!    as well as the private half, and it happens before anything is spawned.
//! 2. **0600, re-read.** ssh refuses to use a private key with loose
//!    permissions, so a key we created and ssh will not touch is a worse
//!    problem than the one we set out to solve.
//! 3. **A passphrase that did not stick deletes the key.** Measured on
//!    OpenSSH_10.2p1: with no askpass reachable and stdin closed, `ssh-keygen`
//!    prints both passphrase prompts, writes an **unencrypted** key and exits
//!    **0**. Reporting "created, encrypted" over that is the one outcome worse
//!    than failing, so a passphrase run is verified with
//!    `ssh-keygen -y -P ""` — which succeeds only on an unencrypted key — and
//!    both files are removed if the verification says the passphrase was lost.
//!
//! # The passphrase never touches argv
//!
//! `ssh-keygen` has no environment variable for a passphrase and `-N <secret>`
//! would put it in argv, which `ps` shows to every user on the machine. So a
//! requested passphrase goes exactly where a git credential already goes: our
//! own executable as `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, and the secret
//! in `PLATYPUSGIT_ASKPASS_SECRET`. No second auth path and no new shim —
//! `cli::askpass_want` already routes any prompt containing "passphrase" to the
//! secret, which is both of ssh-keygen's ("Enter passphrase (empty for no
//! passphrase): " and "Enter same passphrase again: ").
//!
//! An EMPTY passphrase is not a secret, so that case passes `-N ""` in argv and
//! sets up no askpass at all.

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    cli::{ASKPASS_MODE_ENV, ASKPASS_SECRET_ENV, ASKPASS_USERNAME_ENV},
    error::{AppError, AppResult},
    forge::{remote::builtin_kind, validate_host, ForgeKind},
};

/// The identity files OpenSSH tries with no `IdentityFile` configured, in the
/// order `ssh_config(5)` documents them.
///
/// Used ONLY to flag a key as one ssh would find on its own — see the module
/// doc on what this list does not claim.
pub const DEFAULT_IDENTITIES: &[&str] = &[
    "id_rsa",
    "id_ecdsa",
    "id_ecdsa_sk",
    "id_ed25519",
    "id_ed25519_sk",
    "id_dsa",
];

/// The key type we generate. Ed25519 only: small, fast, no parameter choices to
/// get wrong, and accepted by every host that matters. Offering a menu here
/// would be offering a way to make a worse key.
const KEY_TYPE: &str = "ed25519";

/// Base name for a generated key, matching what `ssh-keygen -t ed25519` would
/// pick itself.
const GENERATED_BASE: &str = "id_ed25519";

/// How many `_2`, `_3`, … suffixes [`suggested_name`] will try before giving up.
/// A user with a hundred ed25519 keys has a naming problem we cannot solve.
const MAX_SUFFIX: u32 = 100;

/// Longest key file name we will write. Comfortably under every filesystem's
/// limit while leaving room for the `.pub` sibling.
const MAX_NAME_LEN: usize = 64;

/// Longest comment we will put in a key. The comment is cosmetic; a megabyte of
/// it is not.
const MAX_COMMENT_LEN: usize = 200;

/// One key pair found on this machine.
///
/// **There is no field for the private key, and there must not be.** The only
/// things the backend ever does with the private half are `chmod` it and ask
/// `ssh-keygen` whether it is encrypted; `tests/ssh_keys.rs` serialises this
/// struct and asserts the JSON carries no private key material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyInfo {
    /// Absolute path to the private key.
    pub path: String,
    /// Absolute path to its `.pub` sibling.
    pub public_path: String,
    /// The key's algorithm as the `.pub` file spells it (`ssh-ed25519`).
    pub algorithm: String,
    /// Trailing comment from the `.pub` line; empty when there is none.
    pub comment: String,
    /// `SHA256:…`, the form GitHub and GitLab show beside a registered key —
    /// which is what makes "is this one registered?" answerable by eye.
    pub fingerprint: String,
    /// The whole `.pub` line, which is exactly what a host's add-key form wants.
    pub public_key: String,
    /// True when ssh would try this key with no configuration at all.
    pub is_default_identity: bool,
}

/// What the credential dialog needs to say something useful about SSH.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshKeyStatus {
    /// The directory we looked in, shown verbatim — if `HOME` is not what the
    /// user expects, seeing the path is how they find that out.
    pub dir: String,
    /// Whether that directory exists yet.
    pub dir_exists: bool,
    /// Default identities first, then the rest by name.
    pub keys: Vec<SshKeyInfo>,
    /// Whether `ssh-keygen` is runnable. A STATE, like `LfsUnavailable`: the
    /// button disables and explains rather than the panel erroring.
    pub can_generate: bool,
    /// A free file name for a new key — never one that already exists.
    pub suggested_name: String,
    /// `user.email` from the global git config, else `user@host`.
    pub suggested_comment: String,
    /// The host's "add a new SSH key" page, when we know the forge.
    pub add_key_url: Option<String>,
    /// The host this status was resolved for, echoed back so the UI can name it.
    pub host: Option<String>,
}

/// What the frontend asks for when generating.
///
/// `passphrase` is `Option<String>` and never appears in any response, any log
/// line or any argv — see the module doc.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenerateRequest {
    /// File NAME inside the ssh directory, not a path. Restricting this to a
    /// name is what makes traversal impossible rather than merely checked-for.
    pub name: Option<String>,
    pub comment: Option<String>,
    pub passphrase: Option<String>,
}

// ── pure ─────────────────────────────────────────────────────────────────────

/// Would ssh try a key with this file name without being told to?
pub fn is_default_identity(name: &str) -> bool {
    DEFAULT_IDENTITIES.contains(&name)
}

/// Split a `.pub` line into `(algorithm, base64 blob, comment)`.
///
/// The format is `<algorithm> <base64> [comment]`, and the comment may contain
/// spaces (`ada@Ada's MacBook`), so it is everything after the second field
/// rather than the third field.
pub fn parse_public_key(line: &str) -> Option<(String, String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let mut parts = line.splitn(3, char::is_whitespace);
    let algorithm = parts.next()?.trim();
    let blob = parts.next()?.trim();
    let comment = parts.next().unwrap_or("").trim();
    if algorithm.is_empty() || blob.is_empty() {
        return None;
    }
    // Every algorithm OpenSSH puts in a `.pub` file starts with one of these
    // three: `ssh-rsa` / `ssh-ed25519` / `ssh-dss`, `ecdsa-sha2-nistp256`, and
    // the FIDO forms `sk-ssh-ed25519@openssh.com` / `sk-ecdsa-…`.
    //
    // A prefix test rather than a charset test, because a charset test is what
    // let `-----BEGIN OPENSSH PRIVATE KEY-----` through: split on whitespace it
    // is three fields of dashes and capitals, which is a perfectly good
    // `<word> <word> <rest>`. Reading a PRIVATE key as a public one is the one
    // mistake this parser must not make.
    const ALGORITHM_PREFIXES: [&str; 3] = ["ssh-", "ecdsa-", "sk-"];
    if !ALGORITHM_PREFIXES
        .iter()
        .any(|p| algorithm.starts_with(p))
    {
        return None;
    }
    if !algorithm
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '@' || c == '.')
    {
        return None;
    }
    Some((
        algorithm.to_string(),
        blob.to_string(),
        comment.to_string(),
    ))
}

/// OpenSSH's `SHA256:` fingerprint of a public key blob.
///
/// `SHA256:` + base64 of the SHA-256 of the DECODED blob, with the `=` padding
/// stripped. Probed byte-identical against `ssh-keygen -lf` rather than trusted
/// from the docs, and pinned by a test with a literal key.
///
/// Computed in-process on purpose: listing N keys would otherwise be N
/// subprocesses, and on Windows N console windows to suppress.
pub fn fingerprint(blob_b64: &str) -> Option<String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(blob_b64.as_bytes())
        .ok()?;
    let digest = Sha256::digest(&raw);
    let encoded = base64::engine::general_purpose::STANDARD.encode(digest);
    Some(format!("SHA256:{}", encoded.trim_end_matches('=')))
}

/// Accept a key file NAME, or say why not.
///
/// A name, never a path: the private key path is built as `<ssh dir>/<name>`,
/// so refusing separators here means a traversal cannot be *expressed*, rather
/// than being expressed and then checked for. The leading-`-` refusal is the
/// argv rule — `ssh-keygen` has no `--`, and the absolute path we build never
/// starts with `-`, but a name that does would be a trap for any future caller
/// that passes it somewhere else.
pub fn validate_key_name(name: &str) -> AppResult<()> {
    let bad = |why: &str| {
        Err(AppError::InvalidArgument(format!(
            "refusing to use {name:?} as an SSH key file name: {why}"
        )))
    };
    if name.is_empty() {
        return bad("empty");
    }
    if name.len() > MAX_NAME_LEN {
        return bad("too long");
    }
    if name.starts_with('-') {
        return bad("starts with a dash");
    }
    if name.starts_with('.') {
        return bad("starts with a dot");
    }
    if name.ends_with(".pub") {
        return bad("names the public half; give the private key's name");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return bad("contains a character outside [A-Za-z0-9._-]");
    }
    Ok(())
}

/// Accept a key comment, or say why not.
///
/// A newline would break the one-line `.pub` format outright; other control
/// characters would travel into whatever the user pastes the key into.
pub fn validate_comment(comment: &str) -> AppResult<()> {
    if comment.len() > MAX_COMMENT_LEN {
        return Err(AppError::InvalidArgument(
            "the key comment is too long".into(),
        ));
    }
    if comment.chars().any(|c| c.is_control()) {
        return Err(AppError::InvalidArgument(
            "the key comment contains a control character".into(),
        ));
    }
    Ok(())
}

/// The first DNS label of `host`, reduced to characters legal in a file name.
///
/// `github.com` → `github`, `git.corp.example.com:2222` → `git`. Empty when
/// nothing usable survives, which callers read as "no host-specific name".
pub fn host_label(host: &str) -> String {
    host.split(':')
        .next()
        .unwrap_or(host)
        .split('.')
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect::<String>()
        .to_ascii_lowercase()
}

/// A key file name that does not exist yet.
///
/// `id_ed25519` first, because that is what `ssh-keygen` itself would pick and
/// what every tutorial names. Then `id_ed25519_<host>`, which is the convention
/// people actually use for a second key. Then numbered suffixes.
///
/// PURE — `existing` is the set of names already in the directory, so this is
/// table-testable without a filesystem.
pub fn suggested_name(existing: &BTreeSet<String>, host: Option<&str>) -> String {
    let free = |name: &str| !existing.contains(name);
    if free(GENERATED_BASE) {
        return GENERATED_BASE.to_string();
    }
    if let Some(h) = host {
        let label = host_label(h);
        if !label.is_empty() {
            let candidate = format!("{GENERATED_BASE}_{label}");
            if candidate.len() <= MAX_NAME_LEN && free(&candidate) {
                return candidate;
            }
        }
    }
    for n in 2..=MAX_SUFFIX {
        let candidate = format!("{GENERATED_BASE}_{n}");
        if free(&candidate) {
            return candidate;
        }
    }
    // Every candidate is taken. Answering with the base name is honest: the
    // generate call will refuse with `SshKeyExists` naming the path, which is a
    // better message than one invented here.
    GENERATED_BASE.to_string()
}

/// The host's "add a new SSH key" page, or `None` when we do not know the forge.
///
/// Built here rather than on the frontend so the host stays a RUNTIME value:
/// `format!("https://{host}/…")` is what both privacy guards
/// (`test/privacy.test.ts`, `tests/no_telemetry.rs`) read as a user-supplied
/// host rather than a baked-in destination, so this adds no allow-list entry and
/// bakes no hostname into `src/`. The frontend renders the string and hands it
/// to `open_url`, which validates it again.
///
/// Both paths are the same on a self-hosted instance as on the public one,
/// which is why the HOST is a parameter and only the PATH is a literal.
pub fn add_key_url(host: &str, kind: Option<ForgeKind>) -> Option<String> {
    if validate_host(host).is_err() {
        return None;
    }
    // `validate_host` allows a label starting with `-` (it only refuses a
    // leading or trailing DOT), and `-x.com` is not a hostname — RFC 1123
    // labels may not begin or end with a hyphen. Refused HERE rather than by
    // tightening the forge validator, whose callers are API URLs with their own
    // regression tests; a wrong answer there is a different blast radius.
    let name = host.split(':').next().unwrap_or(host);
    if name
        .split('.')
        .any(|label| label.is_empty() || label.starts_with('-') || label.ends_with('-'))
    {
        return None;
    }
    let kind = kind.or_else(|| builtin_kind(host))?;
    let path = match kind {
        ForgeKind::GitHub => "settings/ssh/new",
        ForgeKind::GitLab => "-/user_settings/ssh_keys",
    };
    Some(format!("https://{host}/{path}"))
}

/// Order for the key list: default identities first, in OpenSSH's own order,
/// then everything else by name.
///
/// PURE, taking the name rather than the struct, so the ordering rule is
/// testable on its own.
fn sort_rank(name: &str) -> (usize, String) {
    match DEFAULT_IDENTITIES.iter().position(|d| *d == name) {
        Some(i) => (i, name.to_string()),
        None => (DEFAULT_IDENTITIES.len(), name.to_string()),
    }
}

// ── impure ───────────────────────────────────────────────────────────────────

/// `~/.ssh`, wherever this platform's home is.
pub fn ssh_dir() -> AppResult<PathBuf> {
    let home = home_dir().ok_or_else(|| {
        AppError::Io("cannot resolve your home directory, so there is nowhere to look for SSH keys".into())
    })?;
    Ok(home.join(".ssh"))
}

/// The user's home directory.
///
/// `std::env::home_dir` was deprecated for years over its Windows behaviour, so
/// this reads the variables directly: `HOME` everywhere, `USERPROFILE` (then
/// the `HOMEDRIVE`+`HOMEPATH` pair) on Windows. `HOME` is checked first on
/// Windows too — Git for Windows sets it, and it is where an `.ssh` directory
/// created by git's own tooling ends up.
fn home_dir() -> Option<PathBuf> {
    if let Some(h) = std::env::var_os("HOME").filter(|h| !h.is_empty()) {
        return Some(PathBuf::from(h));
    }
    #[cfg(windows)]
    {
        if let Some(p) = std::env::var_os("USERPROFILE").filter(|p| !p.is_empty()) {
            return Some(PathBuf::from(p));
        }
        let drive = std::env::var_os("HOMEDRIVE")?;
        let path = std::env::var_os("HOMEPATH")?;
        let mut joined = std::ffi::OsString::from(drive);
        joined.push(path);
        return Some(PathBuf::from(joined));
    }
    #[cfg(not(windows))]
    None
}

/// Every key pair in `dir`: a `.pub` file whose private sibling also exists.
///
/// A `.pub` with no private half is not a key you can authenticate with (it is
/// what is left after someone moved the private key to another machine), so it
/// is skipped rather than listed as something ssh could offer. An unreadable or
/// unparseable `.pub` is skipped too — a stray file in `~/.ssh` must not make
/// the whole panel fail.
pub fn discover(dir: &Path) -> Vec<SshKeyInfo> {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        // The directory not existing is the answer "no keys", not a failure:
        // it is exactly the state of a machine that has never made one.
        Err(_) => return Vec::new(),
    };

    let mut keys: Vec<SshKeyInfo> = Vec::new();
    for entry in entries.flatten() {
        let public_path = entry.path();
        let file_name = match public_path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        let name = match file_name.strip_suffix(".pub") {
            Some(n) if !n.is_empty() => n,
            _ => continue,
        };
        let private_path = dir.join(name);
        if !private_path.is_file() {
            continue;
        }
        let line = match std::fs::read_to_string(&public_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let Some((algorithm, blob, comment)) = line.lines().find_map(parse_public_key) else {
            continue;
        };
        let Some(fp) = fingerprint(&blob) else {
            continue;
        };
        keys.push(SshKeyInfo {
            path: private_path.to_string_lossy().into_owned(),
            public_path: public_path.to_string_lossy().into_owned(),
            algorithm,
            comment,
            fingerprint: fp,
            // Reassembled rather than echoing the file: a `.pub` may carry
            // trailing whitespace or a stray second line, and what we hand to a
            // clipboard should be the one canonical line.
            public_key: line.lines().find(|l| parse_public_key(l).is_some())
                .unwrap_or_default()
                .trim()
                .to_string(),
            is_default_identity: is_default_identity(name),
        });
    }

    keys.sort_by_key(|k| {
        let name = Path::new(&k.path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        sort_rank(&name)
    });
    keys
}

/// Is `ssh-keygen` runnable at all?
///
/// Answered by running it, because "is it on PATH" and "does it execute" differ
/// on exactly the installs where this matters. `-A` would touch the system's
/// host keys and `--help` is not a flag it has, so this uses the flagless
/// `ssh-keygen -l -f <a path that does not exist>`: it fails, but it fails
/// having STARTED, which is the only thing being asked.
///
/// Cached: the panel opens more than once per session and the answer cannot
/// change without the app restarting.
pub fn keygen_available() -> bool {
    static AVAILABLE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *AVAILABLE.get_or_init(|| {
        crate::proc::program("ssh-keygen")
            .arg("-l")
            .arg("-f")
            .arg("")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
    })
}

/// A default comment for a new key: the git identity, else `user@host`.
///
/// `Config::open_default()` reads the GLOBAL and system config, which is the
/// right scope — an SSH key is not per-repository, so a repo-local `user.email`
/// would be the wrong answer even where one exists.
pub fn default_comment() -> String {
    if let Ok(cfg) = git2::Config::open_default() {
        if let Ok(email) = cfg.get_string("user.email") {
            let email = email.trim().to_string();
            if !email.is_empty() && validate_comment(&email).is_ok() {
                return email;
            }
        }
    }
    let user = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".into());
    let host = hostname().unwrap_or_else(|| "localhost".into());
    let fallback = format!("{user}@{host}");
    if validate_comment(&fallback).is_ok() {
        fallback
    } else {
        "platypusgit".into()
    }
}

/// This machine's name, best-effort. Never fails the caller: a comment is
/// cosmetic.
fn hostname() -> Option<String> {
    // No `gethostname` in std and no reason to take a crate for a comment
    // string. These are what the platforms already set.
    for var in ["HOSTNAME", "COMPUTERNAME", "HOST"] {
        if let Ok(v) = std::env::var(var) {
            let v = v.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}

/// Everything the credential dialog needs, for `dir`.
pub fn status(dir: &Path, host: Option<&str>, kind: Option<ForgeKind>) -> SshKeyStatus {
    let keys = discover(dir);
    let existing: BTreeSet<String> = std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|e| e.file_name().to_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    SshKeyStatus {
        dir: dir.to_string_lossy().into_owned(),
        dir_exists: dir.is_dir(),
        keys,
        can_generate: keygen_available(),
        suggested_name: suggested_name(&existing, host),
        suggested_comment: default_comment(),
        add_key_url: host.and_then(|h| add_key_url(h, kind)),
        host: host.map(str::to_string),
    }
}

/// Create `dir` if it is missing, `0700` on unix.
///
/// ssh refuses to use keys out of a world-readable `~/.ssh`, so creating one
/// with the process umask would be creating a directory ssh will complain
/// about.
fn ensure_dir(dir: &Path) -> AppResult<()> {
    if dir.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(dir).map_err(|e| {
        AppError::Io(format!("cannot create {}: {e}", dir.display()))
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700)).map_err(|e| {
            AppError::Io(format!(
                "cannot set 0700 on {}: {e}",
                dir.display()
            ))
        })?;
    }
    Ok(())
}

/// The askpass executable a passphrase generation should use: our own binary,
/// which answers in `lib.rs::run` through `cli::askpass_answer`.
///
/// Separated from [`generate`] so an integration test can pass its own script:
/// a test binary is not the askpass shim, so without this the passphrase path
/// could not be tested at all.
pub fn askpass_exe() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("platypusgit"))
}

/// Generate an ed25519 key pair in `dir` and return its PUBLIC half.
///
/// See the module doc for the three refusals and for why the passphrase travels
/// in the environment.
pub fn generate(dir: &Path, req: &GenerateRequest, askpass: &Path) -> AppResult<SshKeyInfo> {
    if !keygen_available() {
        return Err(AppError::SshKeygenUnavailable(
            "ssh-keygen was not found. Install OpenSSH (git for Windows ships it) and try again."
                .into(),
        ));
    }

    let name = match req.name.as_deref().map(str::trim) {
        Some(n) if !n.is_empty() => n.to_string(),
        _ => {
            let existing: BTreeSet<String> = std::fs::read_dir(dir)
                .map(|entries| {
                    entries
                        .flatten()
                        .filter_map(|e| e.file_name().to_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            suggested_name(&existing, None)
        }
    };
    validate_key_name(&name)?;

    let comment = req.comment.clone().unwrap_or_default();
    let comment = comment.trim().to_string();
    validate_comment(&comment)?;

    let private_path = dir.join(&name);
    let public_path = dir.join(format!("{name}.pub"));

    // Refusal 1. BOTH halves, and before anything is spawned — see the module
    // doc: ssh-keygen's own check is an interactive prompt against a stdin
    // nobody feeds, and a stale `.pub` beside a missing private key would
    // otherwise be silently clobbered.
    for path in [&private_path, &public_path] {
        // `symlink_metadata`, not `exists()`: a broken symlink is still
        // something at that path, and writing "through" it is precisely what a
        // never-overwrite rule must not do.
        if std::fs::symlink_metadata(path).is_ok() {
            return Err(AppError::SshKeyExists(path.to_string_lossy().into_owned()));
        }
    }

    ensure_dir(dir)?;

    let passphrase = req.passphrase.as_deref().filter(|p| !p.is_empty());

    let mut cmd = crate::proc::program("ssh-keygen");
    cmd.arg("-t")
        .arg(KEY_TYPE)
        .arg("-f")
        .arg(&private_path)
        // Suppress the ASCII-art randomart and the "Your identification has
        // been saved" chatter; we report the outcome ourselves.
        .arg("-q")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Only when there is one: `-C ""` writes an EMPTY comment, whereas omitting
    // the flag lets ssh-keygen apply its own `user@host` default — which is a
    // better answer than a blank field for a caller that supplied nothing.
    //
    // Safe as two argv entries even for a value starting with `-`: getopt
    // consumes the next argument as `-C`'s operand unconditionally. ssh-keygen
    // has no `--`, so that property is the guarantee, not a terminator.
    if !comment.is_empty() {
        cmd.arg("-C").arg(&comment);
    }

    match passphrase {
        // An empty passphrase is not a secret, so `-N ""` in argv is fine — and
        // with `-N` given ssh-keygen never prompts, so no askpass is involved.
        None => {
            cmd.arg("-N").arg("");
            cmd.env_remove(ASKPASS_SECRET_ENV);
            cmd.env_remove(ASKPASS_MODE_ENV);
        }
        Some(secret) => {
            cmd.env("SSH_ASKPASS", askpass)
                // OpenSSH >= 8.4 needs this to consult SSH_ASKPASS with no
                // DISPLAY. Older versions fall back to writing an unencrypted
                // key, which the verification below catches and deletes.
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env(ASKPASS_MODE_ENV, "1")
                .env(ASKPASS_SECRET_ENV, secret)
                // ssh-keygen never asks for a username; clearing it stops an
                // inherited value answering a prompt we did not anticipate.
                .env_remove(ASKPASS_USERNAME_ENV);
        }
    }

    let out = cmd.output().map_err(|e| {
        AppError::SshKeygenUnavailable(format!("could not run ssh-keygen: {e}"))
    })?;
    if !out.status.success() {
        // Best effort: a partial write must not become the "already exists"
        // that blocks the next attempt.
        cleanup(&private_path, &public_path);
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            format!("ssh-keygen exited with {}", out.status)
        } else {
            stderr
        };
        return Err(AppError::Io(format!("could not generate the key: {detail}")));
    }

    // Refusal 2 — before the verification, so a key that ssh would refuse never
    // reaches the caller even if it is correctly encrypted.
    harden(&private_path)?;

    // Refusal 3. Only meaningful when a passphrase was ASKED for; a key we
    // deliberately left unencrypted is not a failure.
    if passphrase.is_some() && !is_encrypted(&private_path) {
        cleanup(&private_path, &public_path);
        return Err(AppError::Io(
            "the passphrase did not reach ssh-keygen, so the key would have been written \
             unencrypted. Nothing was kept. Generate without a passphrase, or add one \
             afterwards with `ssh-keygen -p`."
                .into(),
        ));
    }

    read_back(&private_path, &public_path, &name)
}

/// Delete a half-written pair, ignoring what is not there.
fn cleanup(private_path: &Path, public_path: &Path) {
    let _ = std::fs::remove_file(private_path);
    let _ = std::fs::remove_file(public_path);
}

/// Force `0600` on the private key and prove it took.
///
/// A no-op off unix: NTFS ACLs are not modes, and ssh on Windows does not apply
/// the same check.
fn harden(private_path: &Path) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(private_path, std::fs::Permissions::from_mode(0o600)).map_err(
            |e| {
                AppError::Io(format!(
                    "cannot set 0600 on {}: {e}",
                    private_path.display()
                ))
            },
        )?;
        let mode = std::fs::metadata(private_path)
            .map_err(|e| AppError::Io(format!("cannot read back the key's mode: {e}")))?
            .permissions()
            .mode()
            & 0o777;
        if mode != 0o600 {
            return Err(AppError::Io(format!(
                "the new key is mode {mode:o}, not 0600 — ssh would refuse it"
            )));
        }
    }
    #[cfg(not(unix))]
    {
        let _ = private_path;
    }
    Ok(())
}

/// Is this private key encrypted?
///
/// `ssh-keygen -y -f <key> -P ""` prints the public half of an UNENCRYPTED key
/// and exits 0; on an encrypted one it exits non-zero without prompting
/// (measured: 255 on OpenSSH_10.2p1). The empty string in argv is not a secret.
///
/// A failure to run it at all reads as "encrypted": this gate exists to catch a
/// key that is silently unencrypted, and turning an unrunnable probe into a
/// deleted key would throw away a perfectly good key over a broken PATH.
fn is_encrypted(private_path: &Path) -> bool {
    crate::proc::program("ssh-keygen")
        .arg("-y")
        .arg("-P")
        .arg("")
        .arg("-f")
        .arg(private_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| !s.success())
        .unwrap_or(true)
}

/// Read the generated pair back off disk into the payload the frontend gets.
///
/// Read back rather than composed from what we asked for: the `.pub` file is
/// the authority on the algorithm and on how ssh-keygen normalised the comment,
/// and a payload built from our own inputs could describe a key that is not the
/// one on disk.
fn read_back(private_path: &Path, public_path: &Path, name: &str) -> AppResult<SshKeyInfo> {
    let line = std::fs::read_to_string(public_path).map_err(|e| {
        AppError::Io(format!(
            "the key was created but {} could not be read: {e}",
            public_path.display()
        ))
    })?;
    let canonical = line
        .lines()
        .find(|l| parse_public_key(l).is_some())
        .ok_or_else(|| {
            AppError::Io(format!(
                "{} is not a public key line",
                public_path.display()
            ))
        })?
        .trim()
        .to_string();
    let (algorithm, blob, comment) = parse_public_key(&canonical).ok_or_else(|| {
        AppError::Io(format!(
            "{} is not a public key line",
            public_path.display()
        ))
    })?;
    let fp = fingerprint(&blob)
        .ok_or_else(|| AppError::Io("the new key's blob is not valid base64".into()))?;
    Ok(SshKeyInfo {
        path: private_path.to_string_lossy().into_owned(),
        public_path: public_path.to_string_lossy().into_owned(),
        algorithm,
        comment,
        fingerprint: fp,
        public_key: canonical,
        is_default_identity: is_default_identity(name),
    })
}

/// Write `text` to `path` with `0600` — the helper the tests use to stage a
/// fixture key the same way [`generate`] would leave one.
#[doc(hidden)]
pub fn write_private_fixture(path: &Path, text: &str) -> std::io::Result<()> {
    let mut f = std::fs::File::create(path)?;
    f.write_all(text.as_bytes())?;
    drop(f);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A real ed25519 public key, generated for this test and never used
    /// anywhere. The fingerprint below came out of `ssh-keygen -lf` on the same
    /// line, which is what makes this a pin on OpenSSH's format rather than on
    /// our own arithmetic.
    const SAMPLE_PUB: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMsRg9EEV7W44VBb0PAvOFpgjbAzGNXUPT82Qu4xNiA9 probe@example.com";
    const SAMPLE_FP: &str = "SHA256:cbltdYGTyWyhcZ7QDKBwALfElUYTPAZZDfwb1Dc08mw";

    #[test]
    fn parses_a_public_key_line() {
        let (algo, blob, comment) = parse_public_key(SAMPLE_PUB).expect("parses");
        assert_eq!(algo, "ssh-ed25519");
        assert!(blob.starts_with("AAAAC3NzaC1lZDI1NTE5"));
        assert_eq!(comment, "probe@example.com");
    }

    #[test]
    fn a_comment_may_contain_spaces() {
        // `ssh-keygen -C "ada@Ada's MacBook"` is legal and common, so the
        // comment is everything after the blob, not the third field.
        let (_, _, comment) =
            parse_public_key("ssh-ed25519 AAAAB3 ada@Ada's MacBook").expect("parses");
        assert_eq!(comment, "ada@Ada's MacBook");
    }

    #[test]
    fn a_key_with_no_comment_parses_with_an_empty_one() {
        let (algo, blob, comment) = parse_public_key("ssh-ed25519 AAAAB3").expect("parses");
        assert_eq!(algo, "ssh-ed25519");
        assert_eq!(blob, "AAAAB3");
        assert_eq!(comment, "");
    }

    #[test]
    fn rejects_lines_that_are_not_public_keys() {
        for line in [
            "",
            "   ",
            "# a comment",
            "ssh-ed25519",
            "-----BEGIN OPENSSH PRIVATE KEY-----",
        ] {
            assert!(parse_public_key(line).is_none(), "{line:?}");
        }
    }

    #[test]
    fn fingerprint_matches_ssh_keygen() {
        // The whole point of computing this in-process instead of spawning
        // `ssh-keygen -lf` per key: it has to agree with it exactly, because
        // the string is compared BY EYE against what GitHub shows.
        let (_, blob, _) = parse_public_key(SAMPLE_PUB).expect("parses");
        assert_eq!(fingerprint(&blob).as_deref(), Some(SAMPLE_FP));
    }

    #[test]
    fn fingerprint_refuses_a_blob_that_is_not_base64() {
        assert_eq!(fingerprint("not base64!!"), None);
    }

    #[test]
    fn default_identities_are_recognised() {
        assert!(is_default_identity("id_ed25519"));
        assert!(is_default_identity("id_rsa"));
        assert!(!is_default_identity("id_ed25519_github"));
        assert!(!is_default_identity("config"));
    }

    #[test]
    fn key_names_are_restricted_to_a_file_name() {
        assert!(validate_key_name("id_ed25519").is_ok());
        assert!(validate_key_name("id_ed25519_work-2").is_ok());
        for bad in [
            "",
            "../evil",
            "sub/dir",
            "-oProxyCommand=x",
            ".hidden",
            "id_ed25519.pub",
            "id ed25519",
            "id_ed25519\n",
        ] {
            assert!(validate_key_name(bad).is_err(), "{bad:?} must be refused");
        }
        // A separator is refused on Windows spelling too, or `..\evil` would be
        // a name on the platform where it matters most.
        assert!(validate_key_name("..\\evil").is_err());
    }

    #[test]
    fn comments_may_not_carry_control_characters() {
        assert!(validate_comment("ada@example.com").is_ok());
        assert!(validate_comment("").is_ok());
        assert!(validate_comment("two\nlines").is_err());
        assert!(validate_comment(&"x".repeat(MAX_COMMENT_LEN + 1)).is_err());
    }

    #[test]
    fn host_label_takes_the_first_dns_label() {
        assert_eq!(host_label("github.com"), "github");
        assert_eq!(host_label("git.corp.example.com:2222"), "git");
        assert_eq!(host_label("GitLab.com"), "gitlab");
        assert_eq!(host_label("..."), "");
    }

    #[test]
    fn suggested_name_prefers_the_conventional_one() {
        let empty = BTreeSet::new();
        assert_eq!(suggested_name(&empty, Some("github.com")), "id_ed25519");
    }

    #[test]
    fn suggested_name_never_returns_a_name_that_exists() {
        let mut taken: BTreeSet<String> = BTreeSet::new();
        taken.insert("id_ed25519".into());
        assert_eq!(
            suggested_name(&taken, Some("github.com")),
            "id_ed25519_github"
        );
        taken.insert("id_ed25519_github".into());
        assert_eq!(suggested_name(&taken, Some("github.com")), "id_ed25519_2");
        taken.insert("id_ed25519_2".into());
        assert_eq!(suggested_name(&taken, Some("github.com")), "id_ed25519_3");
        // The `.pub` half counts too: the directory listing carries both, and a
        // free private name beside a taken public one is not free.
        let mut only_pub: BTreeSet<String> = BTreeSet::new();
        only_pub.insert("id_ed25519".into());
        only_pub.insert("id_ed25519.pub".into());
        assert_ne!(suggested_name(&only_pub, None), "id_ed25519");
    }

    #[test]
    fn suggested_name_falls_back_to_numbers_with_no_host() {
        let mut taken: BTreeSet<String> = BTreeSet::new();
        taken.insert("id_ed25519".into());
        assert_eq!(suggested_name(&taken, None), "id_ed25519_2");
    }

    /// The POSITIVE assertions for [`add_key_url`] — the ones that spell a whole
    /// URL — live in `tests/ssh_keys.rs`, not here.
    ///
    /// Not a stylistic split. `tests/no_telemetry.rs` scans every `.rs` file
    /// under `src/` for a baked-in hostname, inline test modules included, and
    /// a fixture URL is indistinguishable from a destination to a text scanner.
    /// Allow-listing `gitlab.com` to satisfy a test fixture would widen the set
    /// of hosts this binary is *permitted* to know about, for no reason — and
    /// that allow-list is the review checkpoint the whole guard exists to
    /// create. So `src/ssh.rs` bakes in no host at all (the URL is `format!`ed
    /// from the caller's), and the integration test, which the scanner does not
    /// read, holds the literals.
    ///
    /// What stays here is the half with no URL in it: the refusals.
    #[test]
    fn add_key_url_refuses_before_building_anything() {
        // A host we have no forge for gets no link, rather than a guessed path.
        assert_eq!(add_key_url("bitbucket.org", None), None);
        // Nothing that failed `validate_host` may reach a `format!` that builds
        // a URL — this is the guard, not the opener's second check. `-x.com` is
        // the one `validate_host` itself lets through (it refuses a leading DOT,
        // not a leading hyphen), which is why this module refuses it again.
        for bad in ["", "not a host", "evil\"host", "-x.com", "x-.com", "host:notaport"] {
            assert_eq!(add_key_url(bad, Some(ForgeKind::GitHub)), None, "{bad:?}");
        }
    }

    #[test]
    fn sort_puts_default_identities_first_in_openssh_order() {
        let mut names = vec!["zz_key", "id_ed25519", "aa_key", "id_rsa"];
        names.sort_by_key(|n| sort_rank(n));
        assert_eq!(names, vec!["id_rsa", "id_ed25519", "aa_key", "zz_key"]);
    }

    #[test]
    fn discover_answers_an_empty_list_for_a_directory_that_is_not_there() {
        // "No keys" is the state of a machine that never made one, not a
        // failure the panel should report.
        let dir = std::env::temp_dir().join("platypusgit-no-such-ssh-dir-248");
        assert!(discover(&dir).is_empty());
    }
}
