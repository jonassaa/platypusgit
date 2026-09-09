//! Forge web URL for one commit. Pure; no network, no repository.
//!
//! These strings are handed to the user's browser and are built from an owner
//! and name that come out of a remote URL the repository controls — so the
//! validation and the encoding are the point, not decoration.

use platypusgit_lib::error::AppError;
use platypusgit_lib::forge::{github, gitlab, ForgeKind, ForgeRepo};

fn repo(host: &str, owner: &str, name: &str, kind: ForgeKind) -> ForgeRepo {
    ForgeRepo {
        host: host.into(),
        owner: owner.into(),
        name: name.into(),
        kind,
    }
}

const SHA: &str = "0123456789abcdef0123456789abcdef01234567";

#[test]
fn github_builds_the_commit_page() {
    let r = repo("github.com", "jonassaa", "platypusgit", ForgeKind::GitHub);
    assert_eq!(
        github::commit_url(&r, SHA).unwrap(),
        format!("https://github.com/jonassaa/platypusgit/commit/{SHA}")
    );
}

/// The API lives on `api.github.com`; the WEB page does not. Sending a reader to
/// the API host would show them JSON.
#[test]
fn github_uses_the_remote_host_not_the_api_host() {
    let r = repo("github.com", "o", "n", ForgeKind::GitHub);
    let url = github::commit_url(&r, SHA).unwrap();
    assert!(!url.contains("api."), "web url must not be the API host: {url}");
}

/// GitHub Enterprise serves both from the same host, with no `/api/v3` on the
/// web route.
#[test]
fn github_enterprise_keeps_its_own_host_and_no_api_path() {
    let r = repo("git.example.com", "o", "n", ForgeKind::GitHub);
    assert_eq!(
        github::commit_url(&r, SHA).unwrap(),
        format!("https://git.example.com/o/n/commit/{SHA}")
    );
}

#[test]
fn gitlab_builds_the_commit_page_with_its_dash_infix() {
    let r = repo("gitlab.com", "group", "proj", ForgeKind::GitLab);
    assert_eq!(
        gitlab::commit_url(&r, SHA).unwrap(),
        format!("https://gitlab.com/group/proj/-/commit/{SHA}")
    );
}

/// THE case that separates the web builder from GitLab's API `:id`: a subgroup
/// path must stay several path SEGMENTS. `project_id` percent-encodes the whole
/// path, slashes included, which is right for the API and wrong here — a URL
/// containing `group%2Fsub%2Fproj` is not a page.
#[test]
fn gitlab_keeps_a_subgroup_path_as_real_segments() {
    let r = repo("gitlab.com", "group/sub", "proj", ForgeKind::GitLab);
    let url = gitlab::commit_url(&r, SHA).unwrap();
    assert_eq!(url, format!("https://gitlab.com/group/sub/proj/-/commit/{SHA}"));
    assert!(!url.contains("%2F"), "namespace must not be escaped whole: {url}");
}

#[test]
fn gitlab_self_hosted_keeps_a_non_standard_https_port() {
    // The remote parser preserves an HTTPS port on purpose; it is where the
    // instance is actually served.
    let r = repo("gitlab.example.com:8443", "o", "n", ForgeKind::GitLab);
    assert_eq!(
        gitlab::commit_url(&r, SHA).unwrap(),
        format!("https://gitlab.example.com:8443/o/n/-/commit/{SHA}")
    );
}

// ─── refusals ────────────────────────────────────────────────────────────────

#[test]
fn a_non_hex_oid_is_refused_by_both() {
    let gh = repo("github.com", "o", "n", ForgeKind::GitHub);
    let gl = repo("gitlab.com", "o", "n", ForgeKind::GitLab);
    for bad in ["not-a-sha", "../../etc/passwd", "HEAD", ""] {
        assert!(
            matches!(github::commit_url(&gh, bad), Err(AppError::InvalidArgument(_))),
            "github accepted {bad:?}"
        );
        assert!(
            matches!(gitlab::commit_url(&gl, bad), Err(AppError::InvalidArgument(_))),
            "gitlab accepted {bad:?}"
        );
    }
}

#[test]
fn a_malformed_host_is_refused_by_both() {
    for bad in ["", ".", "host/../evil", "ho st"] {
        let gh = repo(bad, "o", "n", ForgeKind::GitHub);
        let gl = repo(bad, "o", "n", ForgeKind::GitLab);
        assert!(
            github::commit_url(&gh, SHA).is_err(),
            "github accepted host {bad:?}"
        );
        assert!(
            gitlab::commit_url(&gl, SHA).is_err(),
            "gitlab accepted host {bad:?}"
        );
    }
}

/// A crafted owner or name must not escape its path segment. The remote is
/// repository-controlled, and the result goes to a browser.
#[test]
fn a_crafted_owner_or_name_cannot_traverse_the_path() {
    for (owner, name) in [("../..", "n"), ("o", "../.."), ("o/../..", "n")] {
        let gh = repo("github.com", owner, name, ForgeKind::GitHub);
        let url = github::commit_url(&gh, SHA).unwrap();
        assert!(
            !url.contains("/../"),
            "github url must not contain a traversal: {url}"
        );
        let gl = repo("gitlab.com", owner, name, ForgeKind::GitLab);
        let url = gitlab::commit_url(&gl, SHA).unwrap();
        assert!(
            !url.contains("/../"),
            "gitlab url must not contain a traversal: {url}"
        );
    }
}

/// Every URL these build is https, which is also what `opener::safe_url`
/// enforces as the second gate.
#[test]
fn every_built_url_is_https() {
    let gh = repo("github.com", "o", "n", ForgeKind::GitHub);
    let gl = repo("gitlab.com", "o", "n", ForgeKind::GitLab);
    assert!(github::commit_url(&gh, SHA).unwrap().starts_with("https://"));
    assert!(gitlab::commit_url(&gl, SHA).unwrap().starts_with("https://"));
}

/// A short oid is accepted — `validate_sha` allows 7..=64 hex, and a forge
/// resolves an abbreviated commit id fine.
#[test]
fn a_short_but_valid_oid_is_accepted() {
    let gh = repo("github.com", "o", "n", ForgeKind::GitHub);
    assert_eq!(
        github::commit_url(&gh, "0123456").unwrap(),
        "https://github.com/o/n/commit/0123456"
    );
}
