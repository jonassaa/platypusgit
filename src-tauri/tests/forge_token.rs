//! Forge token hygiene (#92).
//!
//! Only the pure half is unit-tested. The `git credential` subprocess half is
//! deliberately not: it would test the developer's own keychain, and a test that
//! writes a real credential entry is worse than no test. The round trip is
//! verified manually and reported in the PR body.

use platypusgit_lib::forge::token::{
    credential_host, credential_line_safe, redact, Secret, CREDENTIAL_USERNAME,
};

#[test]
fn debug_never_prints_the_token() {
    // Secret has no Display and no Serialize, so this Debug impl is the only way
    // it can reach a string by accident — and it must not.
    let s = Secret::new("ghp_supersecretvalue");
    let shown = format!("{s:?}");
    assert_eq!(shown, "Secret(***)");
    assert!(!shown.contains("ghp_"), "{shown}");
    assert!(!shown.contains("supersecret"), "{shown}");
}

#[test]
fn debug_of_an_enclosing_struct_is_also_safe() {
    #[derive(Debug)]
    #[allow(dead_code)]
    struct Holder {
        host: String,
        token: Secret,
    }
    let shown = format!(
        "{:?}",
        Holder {
            host: "github.com".into(),
            token: Secret::new("glpat-abc123"),
        }
    );
    assert!(shown.contains("github.com"));
    assert!(!shown.contains("glpat-"), "{shown}");
}

#[test]
fn expose_is_the_only_way_out() {
    assert_eq!(Secret::new("abc").expose(), "abc");
    assert!(Secret::new("").is_empty());
    assert!(!Secret::new("x").is_empty());
}

#[test]
fn redact_removes_every_occurrence_of_the_token() {
    let token = Secret::new("glpat-XYZ");
    let body = "401 unauthorized: token glpat-XYZ rejected\nretry with glpat-XYZ later";
    let out = redact(body, &token);
    assert!(!out.contains("glpat-XYZ"), "token leaked: {out}");
    assert_eq!(out.matches("***").count(), 2, "{out}");
    assert!(out.contains("401 unauthorized"), "{out}");
}

#[test]
fn redact_leaves_token_free_text_byte_identical() {
    let token = Secret::new("ghp_secret");
    let body = "HTTP 422: A pull request already exists for owner:branch";
    assert_eq!(redact(body, &token), body);
}

#[test]
fn redact_with_an_empty_secret_is_the_identity() {
    // An empty needle would otherwise splatter *** between every character —
    // String::replace("") inserts at every boundary.
    let body = "nothing secret here";
    assert_eq!(redact(body, &Secret::new("")), body);
}

#[test]
fn the_credential_host_cannot_collide_with_a_transport_host() {
    // This is the whole point. GitLab's API and its git transport share one host
    // (gitlab.com/api/v4), so keying an API token on the bare host would
    // overwrite the credential the user pushes with — the overloading #92
    // forbids. `.invalid` is reserved by RFC 6761 §6.4 and can never resolve, so
    // no git remote can ever ask for this host.
    for host in ["github.com", "gitlab.com", "ghe.example.com", "git.example.com:8443"] {
        let key = credential_host(host);
        assert_ne!(key, host, "namespacing lost for {host}");
        assert!(key.ends_with(".platypusgit-forge.invalid"), "{key}");
        assert!(key.starts_with(host), "{key}");
    }
    // And the reserved username is a second layer of separation.
    assert_eq!(CREDENTIAL_USERNAME, "platypusgit-forge");
}

#[test]
fn credential_values_with_a_newline_are_refused_not_escaped() {
    // git's credential protocol is line-based `key=value`, so a value carrying a
    // newline injects further keys: a token of "x\nhost=evil.example" would store
    // itself against a different host. This is the #61 D5 review's finding 2.
    assert!(!credential_line_safe("x\nhost=evil.example"));
    assert!(!credential_line_safe("x\rhost=evil.example"));
    assert!(!credential_line_safe("x\0y"));
    assert!(credential_line_safe("ghp_ordinary-token_123=="));
    assert!(credential_line_safe("github.com.platypusgit-forge.invalid"));
}
