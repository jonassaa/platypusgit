//! Remote URL → forge repository. Pure, and the whole of #92's detection story.
//!
//! There is no API call here and no config read: everything is derived from the
//! remotes the app already lists (`list_remotes`). A remote we cannot parse is
//! skipped, and a repository with no parseable remote yields `None` — **not** an
//! error. "This repo has no forge" is a state the UI renders, not a failure it
//! reports.

use std::collections::HashMap;

use super::{ForgeDetection, ForgeKind};
use crate::git::types::RemoteInfo;

/// Host / owner / name pulled out of one remote URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteTarget {
    /// Lowercased. Carries `:port` only for http(s) URLs — see `parse_remote_url`.
    pub host: String,
    /// May contain `/` (a GitLab subgroup path).
    pub owner: String,
    /// Without a trailing `.git`.
    pub name: String,
}

/// Hosts whose forge we know without being told.
pub fn builtin_kind(host: &str) -> Option<ForgeKind> {
    // Compare on the bare hostname: a builtin host never carries a port.
    match host.split(':').next().unwrap_or(host) {
        "github.com" | "www.github.com" => Some(ForgeKind::GitHub),
        "gitlab.com" | "www.gitlab.com" => Some(ForgeKind::GitLab),
        _ => None,
    }
}

/// Parse a git remote URL into host / owner / name, or `None`.
///
/// Handles the four shapes git accepts for a forge remote:
///
/// | Form | Example |
/// |---|---|
/// | scp-like | `git@github.com:owner/repo.git` |
/// | `ssh://` | `ssh://git@host:2222/owner/repo.git` |
/// | `http(s)://` | `https://gitlab.com/group/sub/repo.git` |
/// | `git://` | `git://host/owner/repo.git` |
///
/// # The port asymmetry (deliberate)
///
/// An **SSH** port is dropped: it says where sshd listens, which has nothing to
/// do with the API, and keeping `:2222` would build `https://host:2222/api/v4`.
/// An **HTTPS** port is kept: for a self-hosted instance served on a
/// non-standard port that *is* where the API lives, and dropping it would build
/// the wrong base URL.
///
/// Userinfo (`user:password@`) is discarded and never retained anywhere in the
/// result — a remote with an embedded token must not leak it into a detection
/// payload that crosses IPC.
pub fn parse_remote_url(url: &str) -> Option<RemoteTarget> {
    let url = url.trim();
    if url.is_empty() || url.chars().any(|c| c.is_control()) {
        return None;
    }

    // Anything with an explicit scheme goes down the scheme path; `git@host:x/y`
    // has no `://` and is the scp-like form. `file://` and a bare path have no
    // forge.
    let (authority, path, keep_port) = match url.split_once("://") {
        Some((scheme, rest)) => {
            let keep_port = match scheme.to_ascii_lowercase().as_str() {
                "http" | "https" => true,
                "ssh" | "git" => false,
                // file://, and anything else, is not a forge remote.
                _ => return None,
            };
            let (authority, path) = match rest.split_once('/') {
                Some((a, p)) => (a, p),
                None => return None,
            };
            (authority, path, keep_port)
        }
        None => {
            // scp-like: [user@]host:path — and NOT a Windows drive path
            // (`C:\repo`) or a plain unix path.
            if url.starts_with('/') || url.starts_with('.') {
                return None;
            }
            let (authority, path) = url.split_once(':')?;
            (authority, path, false)
        }
    };

    // Strip userinfo. rsplit on '@': userinfo ends at the LAST '@' of the
    // authority, which is how git and every URL parser read it — the same
    // finding the D5 security review made about splitting on the first one.
    let host_port = authority.rsplit('@').next().unwrap_or(authority);
    if host_port.is_empty() {
        return None;
    }
    let host = if keep_port {
        host_port.to_string()
    } else {
        host_port.split(':').next().unwrap_or(host_port).to_string()
    };
    let host = host.to_ascii_lowercase();
    // A host must at least look like a hostname; the API-URL builders validate
    // it strictly again before it reaches a request.
    if host.starts_with(':') || host.starts_with('.') {
        return None;
    }
    if !host
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
    {
        return None;
    }

    // Path → owner/name. Trailing `.git`, leading and trailing slashes go.
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return None;
    }
    let name = segments.pop()?.to_string();
    let owner = segments.join("/");
    if owner.is_empty() || name.is_empty() {
        return None;
    }

    Some(RemoteTarget { host, owner, name })
}

/// Which remote to believe, in order. `origin` is the clone's own remote;
/// `upstream` is the convention for the repository a fork was made from.
const PREFERRED: [&str; 2] = ["origin", "upstream"];

/// Pick a forge repository out of the repo's remotes.
///
/// `host_kinds` is the user's per-host mapping for self-hosted instances
/// (GitHub Enterprise and GitLab are indistinguishable from a URL). A detected
/// host that neither the builtin map nor `host_kinds` knows comes back with
/// `kind: None` so the UI can ask, rather than pretending no forge exists.
pub fn detect(
    remotes: &[RemoteInfo],
    host_kinds: &HashMap<String, ForgeKind>,
) -> Option<ForgeDetection> {
    let parsed: Vec<(&RemoteInfo, RemoteTarget)> = remotes
        .iter()
        .filter_map(|r| {
            let url = r.url.as_deref()?;
            parse_remote_url(url).map(|t| (r, t))
        })
        .collect();

    let (remote, target) = PREFERRED
        .iter()
        .find_map(|want| parsed.iter().find(|(r, _)| r.name == *want))
        .or_else(|| parsed.first())?;

    let kind = builtin_kind(&target.host).or_else(|| {
        // Case-insensitive: a host typed into Settings may not match the
        // lowercased form parsed out of the remote.
        host_kinds
            .iter()
            .find(|(h, _)| h.eq_ignore_ascii_case(&target.host))
            .map(|(_, k)| *k)
    });

    Some(ForgeDetection {
        remote: remote.name.clone(),
        host: target.host.clone(),
        owner: target.owner.clone(),
        name: target.name.clone(),
        kind,
    })
}
