//! The one place a forge API request leaves the process (#92).
//!
//! Same shape `update.rs` established for outbound HTTPS: a `ureq` agent with a
//! real timeout and `https_only`. Two additions that matter for an authenticated
//! API rather than a public release feed:
//!
//! * **Response size cap.** A forge list endpoint is paginated, but a
//!   compromised or misconfigured host must not be able to stream gigabytes into
//!   a `String`.
//! * **Status → typed error.** 401/403 becomes `ForgeAuth(host)` so the UI routes
//!   to Settings rather than popping the git-transport credential dialog.
//!
//! This module never sees a `ForgeRepo`, never builds a URL, and never sees a
//! `Secret` — the caller hands it a finished header pair. That is what keeps the
//! forge-specific surface (URL builders + parsers) pure and testable with no
//! network.

use std::io::Read;
use std::time::Duration;

use url::Url;

use crate::error::{AppError, AppResult};
use crate::git::auth::scrub_credentials;

/// Total budget for one API call. `ureq` 2.x defaults every timeout to `None`,
/// so a host that completes the TLS handshake and then stalls would pin the
/// `spawn_blocking` thread forever with no cancel.
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Largest body we will read. A 50-item PR page is a few hundred KB at worst.
const MAX_BODY: u64 = 4 * 1024 * 1024;

fn agent() -> ureq::Agent {
    // `https_only` matters beyond the initial request: the agent follows up to 5
    // redirects by default, and without it a redirect could downgrade an
    // authenticated API call to plaintext http — with the token in the header.
    ureq::AgentBuilder::new()
        .timeout(HTTP_TIMEOUT)
        .https_only(true)
        .redirects(5)
        .build()
}

/// Host of `url`, for an error that must name where authentication failed
/// without echoing the (possibly long, possibly odd) full URL.
fn host_of(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
        .unwrap_or_else(|| "the forge".to_string())
}

/// Read a response body, capped.
fn read_capped(resp: ureq::Response) -> AppResult<String> {
    let mut buf = String::new();
    resp.into_reader()
        .take(MAX_BODY)
        .read_to_string(&mut buf)
        .map_err(|e| AppError::Network(scrub_credentials(&e.to_string())))?;
    Ok(buf)
}

/// Turn a non-2xx response into a typed error.
///
/// The body is read (capped) so the forge's own `message` / `error` field can be
/// shown — that is the difference between "forge error: 422" and "forge error: A
/// pull request already exists for owner:branch". Everything shown goes through
/// `scrub_credentials`; the CALLER additionally applies `token::redact`, so a
/// forge that echoes the token cannot put it in a banner.
fn error_for(url: &str, code: u16, resp: ureq::Response) -> AppError {
    if code == 401 || code == 403 {
        return AppError::ForgeAuth(host_of(url));
    }
    let body = read_capped(resp).unwrap_or_default();
    let detail = message_from_body(&body).unwrap_or_else(|| format!("HTTP {code}"));
    let detail = scrub_credentials(&detail);
    if code == 404 {
        return AppError::Forge(format!(
            "the forge returned 404 — check the repository path and the token's scopes ({detail})"
        ));
    }
    AppError::Forge(format!("HTTP {code}: {detail}"))
}

/// Best-effort human message out of an API error body.
///
/// GitHub uses `{"message": …, "errors": [{"message": …}]}`; GitLab uses
/// `{"message": …}` or `{"error": …}`, and sometimes a map of field → messages.
fn message_from_body(body: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    if let Some(m) = v.get("message").and_then(|m| m.as_str()) {
        // GitHub's per-field errors carry the actionable half.
        if let Some(extra) = v
            .get("errors")
            .and_then(|e| e.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|e| e.get("message").and_then(|m| m.as_str()))
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .filter(|s| !s.is_empty())
        {
            return Some(format!("{m}: {extra}"));
        }
        return Some(m.to_string());
    }
    if let Some(e) = v.get("error").and_then(|e| e.as_str()) {
        return Some(e.to_string());
    }
    // GitLab validation errors: {"message": {"base": ["..."]}} handled above;
    // a bare array of strings is the other shape.
    if let Some(arr) = v.get("message").and_then(|m| m.as_array()) {
        let joined = arr
            .iter()
            .filter_map(|x| x.as_str())
            .collect::<Vec<_>>()
            .join("; ");
        if !joined.is_empty() {
            return Some(joined);
        }
    }
    None
}

/// Map a `ureq` transport failure (DNS, TLS, timeout) to `Network`.
fn transport_error(e: ureq::Transport) -> AppError {
    AppError::Network(scrub_credentials(&e.to_string()))
}

/// Blocking authenticated GET. Call inside `spawn_blocking`.
pub fn get_json(url: &str, header: (&str, &str)) -> AppResult<String> {
    let (name, value) = header;
    match agent()
        .get(url)
        .set(name, value)
        .set("User-Agent", "platypusgit")
        .set("Accept", "application/json")
        .call()
    {
        Ok(resp) => read_capped(resp),
        Err(ureq::Error::Status(code, resp)) => Err(error_for(url, code, resp)),
        Err(ureq::Error::Transport(t)) => Err(transport_error(t)),
    }
}

/// Blocking authenticated POST of a JSON body. Call inside `spawn_blocking`.
///
/// Serializes and sends as a string rather than via `ureq`'s `send_json`, which
/// lives behind the crate's `json` feature — we already depend on `serde_json`
/// directly, so enabling a second copy of the same capability buys nothing.
pub fn post_json(
    url: &str,
    header: (&str, &str),
    body: &serde_json::Value,
) -> AppResult<String> {
    let (name, value) = header;
    let payload = serde_json::to_string(body)
        .map_err(|e| AppError::Internal(format!("could not encode the request body: {e}")))?;
    match agent()
        .post(url)
        .set(name, value)
        .set("User-Agent", "platypusgit")
        .set("Accept", "application/json")
        .set("Content-Type", "application/json")
        .send_string(&payload)
    {
        Ok(resp) => read_capped(resp),
        Err(ureq::Error::Status(code, resp)) => Err(error_for(url, code, resp)),
        Err(ureq::Error::Transport(t)) => Err(transport_error(t)),
    }
}
