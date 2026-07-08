use platypusgit_lib::update::{
    capability, compute_available, is_newer, is_safe_url, parse_release, UpdateCapability,
};

#[test]
fn is_newer_detects_bumps_and_equality() {
    assert!(is_newer("0.0.5", "0.0.6"));
    assert!(is_newer("0.0.6", "0.1.0"));
    assert!(is_newer("0.9.0", "1.0.0"));
    assert!(!is_newer("0.0.6", "0.0.6"));
    assert!(!is_newer("0.1.0", "0.0.9"));
    // leading-v tolerated on either side
    assert!(is_newer("v0.0.5", "v0.0.6"));
}

#[test]
fn compute_available_suppresses_dev_builds() {
    // 0.0.0 is a dev build — never prompt even though everything is "newer".
    assert!(!compute_available("0.0.0", "0.0.6"));
    assert!(compute_available("0.0.5", "0.0.6"));
    assert!(!compute_available("0.0.6", "0.0.6"));
}

#[test]
fn capability_matches_platform_rule() {
    assert_eq!(capability("windows", false), UpdateCapability::SelfUpdate);
    assert_eq!(capability("linux", true), UpdateCapability::SelfUpdate);
    assert_eq!(capability("linux", false), UpdateCapability::Notify);
    assert_eq!(capability("macos", false), UpdateCapability::Notify);
    assert_eq!(capability("macos", true), UpdateCapability::Notify);
}

#[test]
fn parse_release_maps_github_json() {
    let json = r#"{
        "tag_name": "v0.1.0",
        "name": "0.1.0",
        "body": "rebase fixes\nlogo",
        "html_url": "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
        "published_at": "2026-07-08T10:00:00Z",
        "prerelease": false,
        "draft": false
    }"#;
    let rel = parse_release(json).unwrap();
    assert_eq!(rel.tag, "v0.1.0");
    assert_eq!(rel.version, "0.1.0");
    assert_eq!(rel.notes, "rebase fixes\nlogo");
    assert_eq!(
        rel.url,
        "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0"
    );
    assert_eq!(rel.published_at, "2026-07-08T10:00:00Z");
}

#[test]
fn parse_release_rejects_json_without_tag() {
    assert!(parse_release(r#"{"message":"Not Found"}"#).is_err());
}

#[test]
fn is_safe_url_requires_https() {
    assert!(is_safe_url("https://github.com/x"));
    assert!(!is_safe_url("http://github.com/x"));
    assert!(!is_safe_url("file:///etc/passwd"));
    assert!(!is_safe_url("javascript:alert(1)"));
}
