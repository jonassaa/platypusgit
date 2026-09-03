//! The forge API token: a secret type that cannot leak by accident, and storage
//! delegated to the user's own git credential helper (#92).
//!
//! # A forge token is NOT a git-transport credential
//!
//! `commands::net::Credentials` exists to answer git's askpass prompt for one
//! `fetch`/`push`. This is an HTTP `Authorization` header for a host's API, kept
//! until removed. Nothing here derives from, extends, or writes through that
//! struct — #92 says so explicitly, and there is a concrete failure behind it:
//!
//! # Why the host key is namespaced
//!
//! git credential helpers key on `protocol` + `host` (+ `username` when the
//! request sets one). GitLab's API and its git transport **share one host**
//! (`gitlab.com/api/v4`), and so does GitHub Enterprise
//! (`ghe.example.com/api/v3`). Storing an API token under the bare host would
//! therefore overwrite the credential the user pushes with — the exact
//! overloading #92 forbids, reached through the back door.
//!
//! So the key is `<host>.platypusgit-forge.invalid`. `.invalid` is reserved by
//! RFC 6761 §6.4 and is guaranteed never to resolve, so no git remote can ever
//! ask for it. `CREDENTIAL_USERNAME` is a second layer, and makes the entry
//! self-describing in Keychain / Credential Manager.
//!
//! A custom `protocol=` was considered and rejected: `git-credential-osxkeychain`
//! silently `exit(0)`s on a protocol it does not recognise, so the token would
//! vanish with no error at all.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::AsyncWriteExt;

use crate::error::{AppError, AppResult};

/// A token. Deliberately not a `String`.
///
/// * No `Display` and no `Serialize`, so it cannot be formatted into an error,
///   a log line, an event payload, or an IPC response.
/// * `Debug` prints `Secret(***)`, so `{:?}` on any enclosing struct is safe.
/// * The value is reachable only through [`Secret::expose`], called at exactly
///   two sites: the API auth header, and the credential-protocol writer below.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Secret(value.into())
    }

    /// Hand the raw token to something that genuinely needs it. Grep for this.
    pub fn expose(&self) -> &str {
        &self.0
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

/// Remove every literal occurrence of `secret` from `text`.
///
/// Belt and braces: `Secret`'s missing `Display`/`Serialize` should already make
/// this unreachable, but a forge that echoes the token back inside an error body
/// would otherwise put it in an error banner and the log file — one of the three
/// bug shapes the #61 D5 security review found.
///
/// An empty secret is the identity: an empty needle would otherwise splatter
/// `***` between every character.
pub fn redact(text: &str, secret: &Secret) -> String {
    if secret.is_empty() {
        return text.to_string();
    }
    text.replace(secret.expose(), "***")
}

/// Username every forge-token credential entry is stored under.
///
/// For the pre-#233 slot this is the whole username. A named account appends
/// its slot id — see [`credential_username`].
pub const CREDENTIAL_USERNAME: &str = "platypusgit-forge";

/// The `username=` one host's account is stored against.
///
/// # Why the username, and not the host, carries the account (#233)
///
/// git credential helpers key on `protocol` + `host` + `username`. The host key
/// is already load-bearing (see the module docs: it is what keeps an API token
/// off the git-transport credential for the same host), so a second account on
/// the same forge has to differ somewhere else — and the username is the only
/// remaining part of the key.
///
/// `None` is the slot a pre-#233 build wrote under: the bare
/// `platypusgit-forge`. It MUST stay byte-identical, or every already-signed-in
/// user comes back signed out of a host they never left. An empty id means the
/// same thing — `undefined`, `null` and `""` all reach here as "unspecified"
/// from the frontend, and letting `""` mint a third distinct slot would strand a
/// token in it.
///
/// The id is deliberately opaque rather than the login: a forge login can be
/// renamed while the token stays valid, and a login-keyed entry would orphan the
/// token on a rename.
pub fn credential_username(account: Option<&str>) -> String {
    match account.filter(|a| !a.is_empty()) {
        None => CREDENTIAL_USERNAME.to_string(),
        Some(id) => format!("{CREDENTIAL_USERNAME}:{id}"),
    }
}

/// The `host=` a forge token for `host` is stored against. See the module docs.
pub fn credential_host(host: &str) -> String {
    format!("{host}.platypusgit-forge.invalid")
}

/// True when a value is safe to write into git's line-based credential protocol.
///
/// git's protocol is `key=value` per line, so a value containing a newline would
/// inject further keys — a token carrying `"x\nhost=evil.example"` would store
/// itself against a different host. Values cannot legitimately contain newlines,
/// so refuse rather than escape. Same call the D5 review's second finding made.
pub fn credential_line_safe(value: &str) -> bool {
    !value.contains('\n') && !value.contains('\r') && !value.contains('\0')
}

/// Where `git credential` runs.
///
/// The OS temp dir, so config resolution is global + system only: whichever
/// repository happens to be open cannot redirect where a token is stored or read
/// from via a repo-local `credential.helper`. `git credential` needs no
/// repository of its own.
fn credential_cwd() -> PathBuf {
    std::env::temp_dir()
}

/// Build the credential-protocol payload for one host + account slot, with or
/// without the password. `None` token is a `fill`/`reject` query; `Some` is an
/// `approve` write.
fn credential_input(host: &str, account: Option<&str>, token: Option<&Secret>) -> AppResult<String> {
    let key_host = credential_host(host);
    // The username now carries the account slot, so it is user-influenced the
    // same way the host is: check the value that actually goes on the wire.
    let key_user = credential_username(account);
    if !credential_line_safe(&key_host) || !credential_line_safe(&key_user) {
        return Err(AppError::InvalidArgument(
            "the host or account contains a newline, which git's credential protocol cannot carry"
                .into(),
        ));
    }
    let mut input = format!("protocol=https\nhost={key_host}\nusername={key_user}\n");
    if let Some(t) = token {
        if !credential_line_safe(t.expose()) {
            return Err(AppError::InvalidArgument(
                "token contains a newline, which git's credential protocol cannot carry".into(),
            ));
        }
        // The only Secret::expose site besides the auth header.
        input.push_str(&format!("password={}\n", t.expose()));
    }
    input.push('\n');
    Ok(input)
}

/// Run `git credential <verb>`, feeding it `input` on stdin.
///
/// Prompts are hard-disabled and the askpass is a program that FAILS, not one
/// that answers with an empty string: `GIT_ASKPASS=true` would hand git an empty
/// password, which `fill` would then report as a stored empty token.
async fn run_credential(verb: &str, input: &str, want_stdout: bool) -> AppResult<Option<String>> {
    // `proc::git_async` supplies GIT_TERMINAL_PROMPT=0 and CREATE_NO_WINDOW; the
    // askpass below is this runner's own, and deliberately not the shared one.
    let mut cmd = crate::proc::git_async(&credential_cwd());
    cmd.args(["credential", verb])
        // `false` exits non-zero on unix; on Windows there is no such builtin,
        // so name a path that cannot exist — git treats a failed askpass the
        // same way, and falls through to the (disabled) terminal prompt.
        .env(
            "GIT_ASKPASS",
            if cfg!(target_os = "windows") {
                "platypusgit-no-askpass"
            } else {
                "false"
            },
        )
        // Overrides the constructor's closed stdin: the protocol goes in here.
        .stdin(Stdio::piped())
        .stderr(Stdio::null());
    cmd.stdout(if want_stdout {
        Stdio::piped()
    } else {
        Stdio::null()
    });

    let mut child = cmd.spawn().map_err(|e| {
        AppError::Io(format!("could not run `git credential {verb}`: {e}"))
    })?;
    if let Some(stdin) = child.stdin.as_mut() {
        // A helper that never reads stdin closes the pipe; that is not an error.
        let _ = stdin.write_all(input.as_bytes()).await;
        let _ = stdin.shutdown().await;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Io(format!("`git credential {verb}` failed: {e}")))?;

    if !out.status.success() {
        // A missing/empty credential is the expected `fill` outcome when nothing
        // is stored, so this is not reported as an error. NOTHING from the
        // child's output is included: it could contain the credential.
        return Ok(None);
    }
    if !want_stdout {
        return Ok(Some(String::new()));
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).to_string()))
}

/// Pull `password=` out of `git credential fill` output.
///
/// Split on the FIRST `=` only: a token can contain `=` (GitLab's are
/// base64-ish), and splitting on the last one would truncate it.
fn password_from_fill(stdout: &str) -> Option<Secret> {
    for line in stdout.lines() {
        if let Some((key, value)) = line.split_once('=') {
            if key == "password" && !value.is_empty() {
                return Some(Secret::new(value));
            }
        }
    }
    None
}

/// Read the stored token for `host`'s `account` slot, or `None`.
///
/// An empty `password=` reads as absent: a helper (or a stray `GIT_ASKPASS`)
/// answering with an empty string must not look like a stored empty token.
pub async fn load_token(host: &str, account: Option<&str>) -> AppResult<Option<Secret>> {
    let input = credential_input(host, account, None)?;
    match run_credential("fill", &input, true).await? {
        Some(stdout) => Ok(password_from_fill(&stdout)),
        None => Ok(None),
    }
}

/// Store the token for `host`'s `account` slot, then prove it stuck.
///
/// D5 could treat storage as best-effort — the credential had already worked for
/// the operation the user asked for. A forge token cannot: if it silently
/// vanishes the user typed a secret into a box for nothing. So this round-trips
/// through `fill` and reports `ForgeTokenStore` with the remedy when the token
/// does not come back. The caller keeps it in memory regardless, so the feature
/// still works for this session.
pub async fn store_token(host: &str, account: Option<&str>, token: &Secret) -> AppResult<()> {
    let input = credential_input(host, account, Some(token))?;
    run_credential("approve", &input, false).await?;

    match load_token(host, account).await? {
        Some(stored) if stored == *token => Ok(()),
        _ => Err(AppError::ForgeTokenStore(format!(
            "git did not keep the token for {host}. Configure a credential helper \
             (for example `git config --global credential.helper {}`) and try again — \
             until then the token works for this session only.",
            default_helper_hint()
        ))),
    }
}

/// Forget the token in `host`'s `account` slot. Leaves every other slot alone.
pub async fn erase_token(host: &str, account: Option<&str>) -> AppResult<()> {
    let input = credential_input(host, account, None)?;
    run_credential("reject", &input, false).await?;
    Ok(())
}

/// The helper we would suggest on this platform.
fn default_helper_hint() -> &'static str {
    if cfg!(target_os = "macos") {
        "osxkeychain"
    } else if cfg!(target_os = "windows") {
        "manager"
    } else {
        "libsecret"
    }
}
