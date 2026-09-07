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

use std::time::Duration;

use url::Url;

use crate::error::{AppError, AppResult};
use crate::git::auth::scrub_credentials;

/// Total budget for one API call. `ureq` defaults every timeout to `None`, so a
/// host that completes the TLS handshake and then stalls would pin the
/// `spawn_blocking` thread forever with no cancel.
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

/// Largest body we will read. A 50-item PR page is a few hundred KB at worst.
const MAX_BODY: u64 = 4 * 1024 * 1024;

/// What a call hands back. `ureq` 3 responds with the `http` crate's types
/// rather than one of its own, so this names the pair once instead of spelling
/// the generic at four call sites.
type Response = ureq::http::Response<ureq::Body>;

fn agent() -> ureq::Agent {
    // `https_only` matters beyond the initial request: the agent follows
    // redirects, and without it a redirect could downgrade an authenticated API
    // call to plaintext http — with the token in the header. (`ureq` 3 also
    // stops forwarding auth headers across hosts by default, which is a second
    // belt on the same trouser; `https_only` is still the one that decides the
    // scheme.)
    //
    // `http_status_as_error(false)` is what keeps a 4xx READABLE. `ureq` 3
    // turns a non-2xx into `Error::StatusCode(code)` and drops the response
    // with it — but the forge's own `message` field is the whole difference
    // between "forge error: 422" and "a pull request already exists for
    // owner:branch". So a status stays an ordinary response here and
    // `error_for` is what classifies it.
    ureq::Agent::config_builder()
        .timeout_global(Some(HTTP_TIMEOUT))
        .https_only(true)
        .max_redirects(5)
        .http_status_as_error(false)
        .build()
        .new_agent()
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
///
/// A body over the cap is an error rather than a silent truncation — which is
/// what `ureq` 2's `take()` did, and truncated JSON only ever surfaced as an
/// unparseable body somewhere further along.
fn read_capped(mut resp: Response) -> AppResult<String> {
    resp.body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_string()
        .map_err(|e| AppError::Network(scrub_credentials(&e.to_string())))
}

/// Turn a non-2xx response into a typed error.
///
/// The body is read (capped) so the forge's own `message` / `error` field can be
/// shown — that is the difference between "forge error: 422" and "forge error: A
/// pull request already exists for owner:branch". Everything shown goes through
/// `scrub_credentials`; the CALLER additionally applies `token::redact`, so a
/// forge that echoes the token cannot put it in a banner.
fn error_for(url: &str, resp: Response) -> AppError {
    let code = resp.status().as_u16();
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

/// Map a `ureq` failure to `Network`.
///
/// With `http_status_as_error` off, every `Err` out of this module is a
/// transport-level failure — DNS, TLS, timeout, a refused plaintext redirect —
/// so there is no status case left to sort out here. A status arrives as an
/// ordinary response and goes to `error_for`.
fn transport_error(e: ureq::Error) -> AppError {
    AppError::Network(scrub_credentials(&e.to_string()))
}

/// Blocking authenticated GET. Call inside `spawn_blocking`.
pub fn get_json(url: &str, header: (&str, &str)) -> AppResult<String> {
    let (name, value) = header;
    let resp = agent()
        .get(url)
        .header(name, value)
        .header("User-Agent", "platypusgit")
        .header("Accept", "application/json")
        .call()
        .map_err(transport_error)?;
    if resp.status().is_success() {
        read_capped(resp)
    } else {
        Err(error_for(url, resp))
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
    let resp = agent()
        .post(url)
        .header(name, value)
        .header("User-Agent", "platypusgit")
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .send(payload.as_str())
        .map_err(transport_error)?;
    if resp.status().is_success() {
        read_capped(resp)
    } else {
        Err(error_for(url, resp))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a response the way the forge would, so `error_for` is exercised
    /// against a real `Response<Body>` rather than a stand-in.
    fn resp(code: u16, body: &str) -> Response {
        ureq::http::Response::builder()
            .status(code)
            .body(ureq::Body::builder().data(body))
            .expect("build a test response")
    }

    /// The regression this pins: `ureq` 3 collapses a 4xx/5xx into
    /// `Error::StatusCode(code)` BY DEFAULT and drops the response with it. Let
    /// that default back in and `error_for` never runs — a 401 arrives as a
    /// transport failure, becomes `Network`, and the UI pops the git-transport
    /// credential dialog for a forge token that lives in Settings.
    #[test]
    fn a_forge_status_is_a_response_to_read_not_an_error_to_swallow() {
        let cfg = agent().config().clone();
        assert!(
            !cfg.http_status_as_error(),
            "the forge agent must hand a 4xx back as a response; see error_for"
        );
        // The rest of the shape, in the same breath — each one is load-bearing
        // and none of it is observable from the outside without a network.
        assert!(cfg.https_only(), "a redirect must not downgrade to plaintext");
        assert_eq!(cfg.max_redirects(), 5);
        assert_eq!(cfg.timeouts().global, Some(HTTP_TIMEOUT));
    }

    #[test]
    fn unauthorized_and_forbidden_name_the_host_and_route_to_settings() {
        for code in [401, 403] {
            match error_for("https://example.com/api/v4/x", resp(code, "{}")) {
                AppError::ForgeAuth(host) => assert_eq!(host, "example.com"),
                other => panic!("{code} became {other:?}, not ForgeAuth"),
            }
        }
    }

    #[test]
    fn a_url_with_no_host_still_produces_a_readable_auth_error() {
        match error_for("not a url", resp(401, "{}")) {
            AppError::ForgeAuth(host) => assert_eq!(host, "the forge"),
            other => panic!("expected ForgeAuth, got {other:?}"),
        }
    }

    #[test]
    fn a_404_carries_the_scopes_hint_and_the_forges_own_words() {
        let body = r#"{"message":"Not Found"}"#;
        match error_for("https://example.com/repos/o/n", resp(404, body)) {
            AppError::Forge(m) => {
                assert!(m.contains("the token's scopes"), "{m}");
                assert!(m.contains("Not Found"), "{m}");
            }
            other => panic!("expected Forge, got {other:?}"),
        }
    }

    /// The whole reason the body is read at all: "HTTP 422" is not actionable
    /// and "A pull request already exists for o:feat" is.
    #[test]
    fn a_github_validation_error_keeps_its_per_field_message() {
        let body = r#"{"message":"Validation Failed",
                       "errors":[{"message":"A pull request already exists for o:feat."}]}"#;
        match error_for("https://example.com/repos/o/n/pulls", resp(422, body)) {
            AppError::Forge(m) => {
                assert!(m.starts_with("HTTP 422: Validation Failed"), "{m}");
                assert!(m.contains("already exists for o:feat"), "{m}");
            }
            other => panic!("expected Forge, got {other:?}"),
        }
    }

    #[test]
    fn a_gitlab_error_field_is_read_too() {
        match error_for("https://example.com/api/v4/x", resp(400, r#"{"error":"bad ref"}"#)) {
            AppError::Forge(m) => assert!(m.contains("bad ref"), "{m}"),
            other => panic!("expected Forge, got {other:?}"),
        }
    }

    /// A forge that answers with an HTML error page must not lose the status.
    #[test]
    fn an_unparseable_body_falls_back_to_the_status_alone() {
        match error_for("https://example.com/x", resp(502, "<html>bad gateway</html>")) {
            AppError::Forge(m) => assert_eq!(m, "HTTP 502: HTTP 502"),
            other => panic!("expected Forge, got {other:?}"),
        }
    }

    /// The cap is an ERROR now, not `ureq` 2's silent truncation — truncated
    /// JSON only ever surfaced as an unparseable body somewhere further along.
    #[test]
    fn a_body_over_the_cap_is_refused_rather_than_truncated() {
        let huge = "x".repeat(MAX_BODY as usize + 1);
        match read_capped(resp(200, &huge)) {
            Err(AppError::Network(_)) => {}
            Ok(s) => panic!("read {} bytes over the cap instead of failing", s.len()),
            Err(other) => panic!("expected Network, got {other:?}"),
        }
    }

    #[test]
    fn a_body_under_the_cap_reads_whole() {
        assert_eq!(read_capped(resp(200, "{\"ok\":1}")).unwrap(), "{\"ok\":1}");
    }
}
