//! Authentication failure classification and credential hygiene (#61 D5).
//!
//! Network ops run prompt-less on the first attempt, so an authenticated remote
//! fails with git's own stderr. This module turns that stderr into a typed
//! answer — "this is an auth failure, of this kind, for this host" — so the UI
//! can collect a credential and retry, and scrubs credentials out of anything
//! before it reaches an error message or a log.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AuthKind {
    /// HTTPS username + password/token.
    Https,
    /// An encrypted SSH private key needs its passphrase.
    SshPassphrase,
    /// The server rejected the key we offered (or we offered none).
    SshKey,
}

/// Classify a failed git invocation's stderr. `None` means "not an auth
/// failure" — the caller keeps its existing `Network` error.
///
/// Host-key verification is deliberately NOT an auth failure: no credential the
/// user can type will fix an unknown host key, and offering a password prompt
/// for it would be actively misleading.
pub fn classify_auth_failure(stderr: &str) -> Option<AuthKind> {
    let s = stderr.to_lowercase();

    if s.contains("host key verification failed") {
        return None;
    }
    if s.contains("enter passphrase for key") || s.contains("bad passphrase") {
        return Some(AuthKind::SshPassphrase);
    }
    if s.contains("permission denied (publickey)") {
        return Some(AuthKind::SshKey);
    }
    if s.contains("authentication failed")
        || s.contains("invalid username or password")
        || s.contains("could not read username")
        || s.contains("could not read password")
        || s.contains("terminal prompts disabled")
    {
        return Some(AuthKind::Https);
    }
    None
}

/// What the UI needs to prompt for a credential and retry.
///
/// A newtype payload rather than a struct variant on `AppError`: with
/// `#[serde(tag = "kind", content = "message")]` this serializes as
/// `{ kind: "Auth", message: { host, kind } }`, which is unambiguous, whereas a
/// struct variant would put a second field literally named `kind` at a level
/// that reads as if it were the tag.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthChallenge {
    /// Host the credential is for, when git's stderr named one.
    pub host: Option<String>,
    pub kind: AuthKind,
}

/// True for a character that ends a URL's authority component.
fn ends_authority(c: char) -> bool {
    c == '/' || c == '\'' || c == '"' || c.is_whitespace()
}

/// Replace the `user:password@` userinfo of every URL in `text` with `***`.
///
/// git echoes remote URLs in its errors, and a remote configured with an
/// embedded token would otherwise put that token into an error banner or a log
/// file.
pub fn scrub_credentials(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(scheme_at) = rest.find("://") {
        let after = scheme_at + 3;
        let (head, tail) = rest.split_at(after);
        // Userinfo, if any, ends within the authority; beyond that we are into
        // the path and there is nothing to strip.
        let stop = tail.find(ends_authority).unwrap_or(tail.len());
        // rfind, not find: userinfo ends at the LAST '@' of the authority, which
        // is how git and URL parsers read it. Splitting on the first '@' leaves
        // the remainder of a password containing '@' in the scrubbed text.
        match tail[..stop].rfind('@') {
            Some(at) => {
                out.push_str(head);
                out.push_str("***");
                out.push_str(&tail[at..stop]);
            }
            None => {
                out.push_str(head);
                out.push_str(&tail[..stop]);
            }
        }
        rest = &tail[stop..];
    }
    out.push_str(rest);
    out
}

/// Best-effort host from git/ssh stderr: `https://host/…` or `git@host:`.
pub fn host_from_stderr(stderr: &str) -> Option<String> {
    if let Some(at) = stderr.find("://") {
        let tail = &stderr[at + 3..];
        let stop = tail.find(ends_authority).unwrap_or(tail.len());
        let authority = &tail[..stop];
        // Drop any userinfo before the host.
        let host = authority.rsplit('@').next().unwrap_or(authority);
        // Strip a port, if present.
        let host = host.split(':').next().unwrap_or(host);
        if !host.is_empty() {
            return Some(host.to_string());
        }
    }
    // `git@host: Permission denied` — take the token before the first ": ".
    if let Some(colon) = stderr.find(": ") {
        let head = &stderr[..colon];
        if let Some(at) = head.rfind('@') {
            let host = &head[at + 1..];
            if !host.is_empty() && host.contains('.') {
                return Some(host.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_auth_failure_is_https() {
        for s in [
            "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/x/y.git/'",
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        ] {
            assert_eq!(classify_auth_failure(s), Some(AuthKind::Https), "{s}");
        }
    }

    #[test]
    fn ssh_passphrase_prompt_is_passphrase() {
        let s = "Enter passphrase for key '/home/u/.ssh/id_ed25519': \nfatal: Could not read from remote repository.";
        assert_eq!(classify_auth_failure(s), Some(AuthKind::SshPassphrase));
    }

    #[test]
    fn publickey_denied_is_ssh_key() {
        let s = "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
        assert_eq!(classify_auth_failure(s), Some(AuthKind::SshKey));
    }

    #[test]
    fn host_key_verification_is_not_an_auth_failure() {
        // Prompting for a password cannot fix an unknown host key, and offering
        // to would be actively misleading.
        let s = "Host key verification failed.\nfatal: Could not read from remote repository.";
        assert_eq!(classify_auth_failure(s), None);
    }

    #[test]
    fn ordinary_network_errors_are_not_auth_failures() {
        for s in [
            "fatal: unable to access 'https://x/y': Could not resolve host: x",
            "fatal: repository 'https://x/y' not found",
            "error: failed to push some refs to 'origin'",
        ] {
            assert_eq!(classify_auth_failure(s), None, "{s}");
        }
    }

    #[test]
    fn scrub_removes_userinfo_from_urls() {
        assert_eq!(
            scrub_credentials(
                "fatal: unable to access 'https://user:ghp_secret@github.com/x/y.git/'"
            ),
            "fatal: unable to access 'https://***@github.com/x/y.git/'"
        );
    }

    #[test]
    fn scrub_leaves_credential_free_text_alone() {
        let s = "fatal: Authentication failed for 'https://github.com/x/y.git/'";
        assert_eq!(scrub_credentials(s), s);
    }

    #[test]
    fn scrub_handles_several_urls() {
        let out = scrub_credentials("a https://u:p@h1/x b https://u2:p2@h2/y");
        assert!(!out.contains("p@"), "{out}");
        assert!(!out.contains("p2@"), "{out}");
        assert!(out.contains("h1/x"), "{out}");
        assert!(out.contains("h2/y"), "{out}");
    }

    #[test]
    fn scrub_is_lossless_when_there_is_no_scheme() {
        let s = "no urls here at all";
        assert_eq!(scrub_credentials(s), s);
    }

    #[test]
    fn scrub_removes_a_password_containing_an_at_sign() {
        // Userinfo ends at the LAST '@' of the authority, which is how git and
        // URL parsers read it. Splitting on the first '@' would leave the rest
        // of the password in the message.
        let out = scrub_credentials("fatal: unable to access 'https://user:p@ssw0rd@github.com/x/y'");
        assert!(!out.contains("ssw0rd"), "password leaked: {out}");
        assert_eq!(
            out,
            "fatal: unable to access 'https://***@github.com/x/y'"
        );
    }

    #[test]
    fn scrub_keeps_a_port_after_stripping_userinfo() {
        let out = scrub_credentials("https://u:p@example.com:8443/x");
        assert_eq!(out, "https://***@example.com:8443/x");
    }

    #[test]
    fn host_is_extracted_from_https_and_ssh_forms() {
        assert_eq!(
            host_from_stderr("fatal: Authentication failed for 'https://github.com/x/y.git/'"),
            Some("github.com".to_string())
        );
        assert_eq!(
            host_from_stderr("git@gitlab.com: Permission denied (publickey)."),
            Some("gitlab.com".to_string())
        );
        assert_eq!(host_from_stderr("something unrelated"), None);
    }

    #[test]
    fn host_extraction_drops_userinfo_and_port() {
        assert_eq!(
            host_from_stderr("fatal: unable to access 'https://u:p@example.com:8443/x'"),
            Some("example.com".to_string())
        );
    }
}
