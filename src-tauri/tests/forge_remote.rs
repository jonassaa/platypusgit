//! Remote URL → forge detection (#92). Pure; no network, no repository.

use std::collections::HashMap;

use platypusgit_lib::forge::remote::{builtin_kind, detect, parse_remote_url, RemoteTarget};
use platypusgit_lib::forge::ForgeKind;
use platypusgit_lib::git::types::RemoteInfo;

fn t(host: &str, owner: &str, name: &str) -> Option<RemoteTarget> {
    Some(RemoteTarget {
        host: host.into(),
        owner: owner.into(),
        name: name.into(),
    })
}

fn remote(name: &str, url: &str) -> RemoteInfo {
    RemoteInfo {
        name: name.into(),
        url: Some(url.into()),
    }
}

#[test]
fn parses_scp_like_ssh_remotes() {
    assert_eq!(
        parse_remote_url("git@github.com:owner/repo.git"),
        t("github.com", "owner", "repo")
    );
    // No trailing .git.
    assert_eq!(
        parse_remote_url("git@github.com:owner/repo"),
        t("github.com", "owner", "repo")
    );
    // A leading slash in the scp path is legal and means the same thing.
    assert_eq!(
        parse_remote_url("git@gitlab.com:/group/repo.git"),
        t("gitlab.com", "group", "repo")
    );
}

#[test]
fn parses_ssh_scheme_remotes() {
    assert_eq!(
        parse_remote_url("ssh://git@github.com/owner/repo.git"),
        t("github.com", "owner", "repo")
    );
    assert_eq!(
        parse_remote_url("ssh://github.com/owner/repo.git"),
        t("github.com", "owner", "repo")
    );
}

#[test]
fn parses_https_remotes() {
    assert_eq!(
        parse_remote_url("https://github.com/owner/repo.git"),
        t("github.com", "owner", "repo")
    );
    assert_eq!(
        parse_remote_url("https://github.com/owner/repo"),
        t("github.com", "owner", "repo")
    );
    // Trailing slash.
    assert_eq!(
        parse_remote_url("https://github.com/owner/repo/"),
        t("github.com", "owner", "repo")
    );
    // http is a valid remote scheme; the API base is https regardless.
    assert_eq!(
        parse_remote_url("http://git.example.com/o/r.git"),
        t("git.example.com", "o", "r")
    );
    assert_eq!(
        parse_remote_url("git://github.com/owner/repo.git"),
        t("github.com", "owner", "repo")
    );
}

#[test]
fn keeps_an_https_port_but_drops_an_ssh_port() {
    // An HTTPS port IS where the API listens for a self-hosted instance —
    // dropping it would build the wrong base URL.
    assert_eq!(
        parse_remote_url("https://git.example.com:8443/o/r.git"),
        t("git.example.com:8443", "o", "r")
    );
    // An SSH port says where sshd listens and has nothing to do with the API;
    // keeping it would build https://host:2222/api/v4.
    assert_eq!(
        parse_remote_url("ssh://git@git.example.com:2222/o/r.git"),
        t("git.example.com", "o", "r")
    );
    assert_eq!(
        parse_remote_url("git@git.example.com:2222/o/r.git"),
        // scp-like syntax has NO port field — git reads everything after the
        // colon as the path, so `2222` is a namespace segment. Same reading here,
        // deliberately: guessing "that looks like a port" would silently address
        // the wrong project for a namespace that happens to be numeric.
        t("git.example.com", "2222/o", "r")
    );
}

#[test]
fn keeps_gitlab_subgroups_as_the_owner_path() {
    assert_eq!(
        parse_remote_url("https://gitlab.com/group/sub/deeper/repo.git"),
        t("gitlab.com", "group/sub/deeper", "repo")
    );
    assert_eq!(
        parse_remote_url("git@gitlab.com:group/sub/repo.git"),
        t("gitlab.com", "group/sub", "repo")
    );
}

#[test]
fn discards_userinfo_and_never_retains_it() {
    // A remote configured with an embedded token must not leak it into a
    // detection payload that crosses IPC. Userinfo ends at the LAST '@' of the
    // authority — splitting on the first one is the #61 D5 review's finding 1.
    let got = parse_remote_url("https://user:p@ssw0rd@github.com/owner/repo.git").unwrap();
    assert_eq!(got, t("github.com", "owner", "repo").unwrap());
    let debug = format!("{got:?}");
    assert!(!debug.contains("ssw0rd"), "password leaked: {debug}");
    assert!(!debug.contains("user"), "username leaked: {debug}");
}

#[test]
fn lowercases_the_host() {
    assert_eq!(
        parse_remote_url("https://GitHub.COM/Owner/Repo.git"),
        // Only the host is case-normalised: owner/repo are case-sensitive on
        // both forges' APIs.
        t("github.com", "Owner", "Repo")
    );
}

#[test]
fn rejects_everything_that_is_not_a_forge_remote() {
    for url in [
        "",
        "   ",
        "not a url",
        "/local/path/repo.git",
        "./relative/repo",
        "file:///srv/repo.git",
        // No owner/name pair.
        "https://github.com",
        "https://github.com/",
        "https://github.com/only-one-segment",
        "git@github.com:",
        "git@github.com:repo.git",
        // Empty authority.
        "https:///owner/repo.git",
        // A control character has no place in a remote URL.
        "https://git\nhub.com/o/r",
    ] {
        assert_eq!(parse_remote_url(url), None, "should not parse: {url:?}");
    }
}

#[test]
fn builtin_kinds_are_recognised_without_configuration() {
    assert_eq!(builtin_kind("github.com"), Some(ForgeKind::GitHub));
    assert_eq!(builtin_kind("gitlab.com"), Some(ForgeKind::GitLab));
    assert_eq!(builtin_kind("git.example.com"), None);
}

#[test]
fn detect_prefers_origin_then_upstream_then_the_first_parseable() {
    let kinds = HashMap::new();

    let d = detect(
        &[
            remote("fork", "git@github.com:me/repo.git"),
            remote("upstream", "git@github.com:them/repo.git"),
            remote("origin", "git@github.com:mine/repo.git"),
        ],
        &kinds,
    )
    .unwrap();
    assert_eq!(d.remote, "origin");
    assert_eq!(d.owner, "mine");

    let d = detect(
        &[
            remote("fork", "git@github.com:me/repo.git"),
            remote("upstream", "git@github.com:them/repo.git"),
        ],
        &kinds,
    )
    .unwrap();
    assert_eq!(d.remote, "upstream");
    assert_eq!(d.owner, "them");

    let d = detect(&[remote("fork", "git@github.com:me/repo.git")], &kinds).unwrap();
    assert_eq!(d.remote, "fork");
}

#[test]
fn detect_skips_unparseable_remotes_instead_of_failing() {
    let kinds = HashMap::new();
    // A local-path remote sitting in front of a real one must not hide it.
    let d = detect(
        &[
            remote("local", "/srv/mirrors/repo.git"),
            remote("gh", "https://github.com/o/r.git"),
        ],
        &kinds,
    )
    .unwrap();
    assert_eq!(d.host, "github.com");
    assert_eq!(d.kind, Some(ForgeKind::GitHub));
}

#[test]
fn detect_returns_none_when_no_remote_is_a_forge() {
    // "No forge here" is a STATE the UI renders, not an error — nothing about
    // this path may fail.
    let kinds = HashMap::new();
    assert!(detect(&[], &kinds).is_none());
    assert!(detect(&[remote("local", "/srv/repo.git")], &kinds).is_none());
    assert!(detect(&[RemoteInfo { name: "no-url".into(), url: None }], &kinds).is_none());
}

#[test]
fn a_self_hosted_host_is_reported_with_an_unknown_kind() {
    // The URL cannot tell GitHub Enterprise from GitLab, so detection reports
    // the host and leaves kind None — a prompt, not a failure.
    let d = detect(
        &[remote("origin", "git@git.example.com:team/svc.git")],
        &HashMap::new(),
    )
    .unwrap();
    assert_eq!(d.host, "git.example.com");
    assert_eq!(d.owner, "team");
    assert_eq!(d.name, "svc");
    assert_eq!(d.kind, None);
}

#[test]
fn a_configured_host_kind_resolves_case_insensitively() {
    let mut kinds = HashMap::new();
    // The user typed the host with capitals in Settings; the remote parsed to
    // lowercase.
    kinds.insert("Git.Example.COM".to_string(), ForgeKind::GitLab);
    let d = detect(
        &[remote("origin", "https://git.example.com/team/svc.git")],
        &kinds,
    )
    .unwrap();
    assert_eq!(d.kind, Some(ForgeKind::GitLab));
}

#[test]
fn a_builtin_host_wins_over_a_bogus_override() {
    let mut kinds = HashMap::new();
    kinds.insert("github.com".to_string(), ForgeKind::GitLab);
    let d = detect(
        &[remote("origin", "https://github.com/o/r.git")],
        &kinds,
    )
    .unwrap();
    assert_eq!(d.kind, Some(ForgeKind::GitHub));
}
