//! Forge (GitHub / GitLab) integration — PR / MR listing, creation, checkout
//! and CI status (#92, #61 D11).
//!
//! # Layout
//!
//! * [`remote`] — remote URL → host/owner/name. Pure.
//! * [`token`] — the per-host API token: a `Secret` newtype, redaction, and
//!   storage delegated to the user's own git credential helper under a host key
//!   that CANNOT collide with a git-transport credential.
//! * [`http`] — the only impure file: one `ureq` agent, https-only, timed out,
//!   size-capped.
//! * [`github`] / [`gitlab`] — per-forge URL builders and response parsers. Pure.
//!
//! # Why the trait is shaped this way
//!
//! [`Forge`] does not expose `list_pull_requests(&self) -> Result<Vec<_>>`.
//! Every operation is split into a URL builder and a response parser, so the
//! whole forge-specific surface is pure and unit-testable against recorded JSON
//! — no network, no injected HTTP client, no mock server. `http` never sees a
//! `ForgeRepo` and never builds a URL; the command layer joins the two.
//!
//! # Security invariants
//!
//! * A token is a [`token::Secret`]: no `Display`, no `Serialize`, and a `Debug`
//!   that prints `Secret(***)`. It reaches a `&str` only via `expose()`, which
//!   is called at exactly two sites (the auth header, and the credential-protocol
//!   writer).
//! * Nothing user-influenced reaches a URL unvalidated: [`validate_host`],
//!   [`encode_segment`], [`validate_sha`], [`validate_ref_name`].

pub mod checkout;
pub mod github;
pub mod gitlab;
pub mod http;
pub mod remote;
pub mod token;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use token::Secret;

/// Which forge's API to speak. Serializes bare (`"GitHub"`), matching the
/// `PullMode` / `ResetMode` precedent in `git/types.rs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ForgeKind {
    GitHub,
    GitLab,
}

impl ForgeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ForgeKind::GitHub => "GitHub",
            ForgeKind::GitLab => "GitLab",
        }
    }
}

/// A repository on a forge whose kind is known — everything an API call needs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeRepo {
    /// Host as it appears in the remote, lowercased. May carry `:port` for a
    /// self-hosted instance served on a non-standard HTTPS port.
    pub host: String,
    /// Owner / namespace. May contain `/` for a GitLab subgroup.
    pub owner: String,
    /// Repository name, without `.git`.
    pub name: String,
    pub kind: ForgeKind,
}

/// What was found on the repository's remotes.
///
/// `kind` is `None` for a self-hosted host we cannot classify from its URL — a
/// *prompt* ("which forge is git.example.com?"), not a failure. A repository
/// with no parseable remote produces no `ForgeDetection` at all.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeDetection {
    /// Which remote it came from, so the checkout can fetch from the same one.
    pub remote: String,
    pub host: String,
    pub owner: String,
    pub name: String,
    pub kind: Option<ForgeKind>,
}

/// One open pull request / merge request — the union of what both APIs give
/// cheaply in a single list call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    /// GitHub's `number`, GitLab's `iid` — the per-project number, which is
    /// also what the fetchable head ref is keyed by.
    pub number: u64,
    pub title: String,
    pub author: String,
    pub source_branch: String,
    pub target_branch: String,
    /// The forge's own web page. Always handed to `open_url`, which re-validates.
    pub url: String,
    pub draft: bool,
    /// The source branch lives in a fork, so its name must not be reused
    /// locally — a fork's `main` must never land on yours.
    pub cross_repo: bool,
    /// Head commit, when the payload carries one. Drives the checks lookup.
    pub sha: Option<String>,
    pub updated_at: String,
}

/// Normalised CI verdict, so the UI has one tone mapping for both forges.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ChecksState {
    Success,
    Pending,
    Failure,
    /// No checks ran (or the forge reported none).
    None,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksSummary {
    pub state: ChecksState,
    /// How many checks/statuses the forge counted, when it says.
    pub total: u64,
    /// The forge's own word (`"success"`, `"running"`, …) for display.
    pub label: String,
}

/// A PR/MR to create.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPullRequest {
    pub title: String,
    pub body: String,
    pub source_branch: String,
    pub target_branch: String,
    pub draft: bool,
}

/// Who the stored token authenticates as. The whole point of "signed in as X".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeIdentity {
    pub login: String,
    pub name: Option<String>,
}

/// Whether a host has a token, and who it belongs to. **Never** the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeTokenStatus {
    pub host: String,
    pub signed_in: bool,
    /// Only ever populated by a fresh identity probe; presence checks leave it
    /// `None` so `forge_token_status` can stay off the network.
    pub login: Option<String>,
}

/// One forge's API dialect. See the module docs for why every method is pure.
pub trait Forge: Send + Sync {
    fn kind(&self) -> ForgeKind;

    /// Header name the token travels in.
    fn auth_header(&self) -> &'static str;
    /// Header value for `token`. One of the two `Secret::expose` sites.
    fn auth_value(&self, token: &Secret) -> String;

    fn identity_url(&self, host: &str) -> AppResult<String>;
    fn parse_identity(&self, json: &str) -> AppResult<ForgeIdentity>;

    fn list_url(&self, repo: &ForgeRepo) -> AppResult<String>;
    fn parse_list(&self, json: &str) -> AppResult<Vec<PullRequest>>;

    fn checks_url(&self, repo: &ForgeRepo, sha: &str) -> AppResult<String>;
    fn parse_checks(&self, json: &str) -> AppResult<ChecksSummary>;

    fn create_url(&self, repo: &ForgeRepo) -> AppResult<String>;
    fn create_body(&self, req: &NewPullRequest) -> serde_json::Value;
    fn parse_created(&self, json: &str) -> AppResult<PullRequest>;

    /// The ref the forge synthesises **on the base repository** for a PR's head.
    ///
    /// This is why checking out a fork PR needs no knowledge of the fork: the
    /// base repo carries `refs/pull/N/head` (GitHub) /
    /// `refs/merge-requests/N/head` (GitLab) for every open request.
    fn head_ref(&self, number: u64) -> String;
}

pub fn forge_for(kind: ForgeKind) -> &'static dyn Forge {
    match kind {
        ForgeKind::GitHub => &github::GitHub,
        ForgeKind::GitLab => &gitlab::GitLab,
    }
}

// ── validation ───────────────────────────────────────────────────────────────

/// Longest host we will build a URL from. Bounded so a pathological remote
/// cannot produce a multi-kilobyte request line.
const MAX_HOST_LEN: usize = 253;

/// Accept only a hostname (plus an optional numeric port) we are willing to
/// interpolate into an API URL.
///
/// SECURITY: the host comes from a remote URL, i.e. from repository config,
/// which is attacker-controlled for a repository you cloned. A host containing
/// `/`, `?`, `#`, `@` or whitespace would let that config rewrite the API path
/// (`evil.com/x?` → `https://evil.com/x?/api/v4/...`) or smuggle userinfo.
/// Charset-allowlist rather than escape: nothing legitimate needs more.
pub fn validate_host(host: &str) -> AppResult<()> {
    let bad = |why: &str| {
        Err(AppError::InvalidUrl(format!(
            "refusing to build a forge API url for host {host:?}: {why}"
        )))
    };
    if host.is_empty() {
        return bad("empty");
    }
    if host.len() > MAX_HOST_LEN {
        return bad("too long");
    }
    let (name, port) = match host.split_once(':') {
        Some((n, p)) => (n, Some(p)),
        None => (host, None),
    };
    if name.is_empty() || name.starts_with('.') || name.ends_with('.') {
        return bad("malformed hostname");
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        return bad("hostname contains a character that is not [A-Za-z0-9.-]");
    }
    if let Some(p) = port {
        if p.is_empty() || !p.chars().all(|c| c.is_ascii_digit()) {
            return bad("port is not numeric");
        }
    }
    Ok(())
}

/// Percent-encode one URL path segment, keeping only RFC 3986 unreserved
/// characters.
///
/// SECURITY: `owner` and `name` also come from repository config. `..` must not
/// traverse the API path and `?`/`#` must not start a query or fragment, so
/// `/` is encoded too — a GitLab subgroup path is encoded whole (`a%2Fb`),
/// which is exactly the form GitLab's `:id` parameter wants.
pub fn encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// A commit id we are willing to interpolate into a URL.
///
/// SECURITY, and the direct descendant of the D5 review's third finding (an oid
/// passed straight to a git subcommand where a leading `-` reads as an option):
/// a sha arriving from the frontend is only ever hex.
pub fn validate_sha(sha: &str) -> AppResult<()> {
    if sha.len() < 7 || sha.len() > 64 || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::InvalidArgument(format!(
            "not a commit id: {sha:?}"
        )));
    }
    Ok(())
}

/// A branch name we are willing to pass to `git checkout -b`.
///
/// SECURITY: a leading `-` would be read as an option, and git's own ref rules
/// forbid the rest anyway — so refuse instead of quoting, and keep the `--`
/// separators at the call sites as well.
pub fn validate_ref_name(name: &str) -> AppResult<()> {
    let bad = |why: &str| {
        Err(AppError::InvalidArgument(format!(
            "invalid branch name {name:?}: {why}"
        )))
    };
    if name.is_empty() {
        return bad("empty");
    }
    if name.len() > 255 {
        return bad("too long");
    }
    if name.starts_with('-') {
        return bad("a leading dash would be read as a command-line option");
    }
    if name.starts_with('/') || name.ends_with('/') || name.ends_with(".lock") {
        return bad("not a legal ref name");
    }
    if name.contains("..") || name.contains("//") || name.contains("@{") {
        return bad("not a legal ref name");
    }
    if name.chars().any(|c| {
        c.is_control() || c.is_whitespace() || matches!(c, '~' | '^' | ':' | '?' | '*' | '[' | '\\')
    }) {
        return bad("contains a character git forbids in a ref name");
    }
    Ok(())
}

/// Parse a JSON body, turning a parse failure into a describable forge error
/// rather than a panic. Every parser starts here.
pub(crate) fn json_of(body: &str) -> AppResult<serde_json::Value> {
    serde_json::from_str(body)
        .map_err(|e| AppError::Forge(format!("could not parse the forge's response: {e}")))
}

pub(crate) fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

pub(crate) fn opt_str_field(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}
