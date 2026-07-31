use std::path::Path;

use platypusgit_lib::opener::{safe_url, safe_workdir_path};

#[test]
fn safe_url_accepts_a_normal_github_release_url() {
    let url = "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0";
    assert_eq!(safe_url(url).unwrap(), url);
}

#[test]
fn safe_url_rejects_quote_injection() {
    // The exact `cmd /C start "" <url>` break-out this guard exists for: cmd
    // reads Rust's `\"` escaping as backslash + quote toggle, so the tail
    // `&calc.exe&` became a command.
    assert!(safe_url("https://example.com/\"&calc.exe&\"").is_err());
    assert!(safe_url("https://example.com/'&calc.exe&'").is_err());
    assert!(safe_url("https://example.com/`calc.exe`").is_err());
}

#[test]
fn safe_url_rejects_non_https() {
    assert!(safe_url("http://github.com/x").is_err());
    assert!(safe_url("file:///etc/passwd").is_err());
    assert!(safe_url("javascript:alert(1)").is_err());
    assert!(safe_url("not a url at all").is_err());
    // https with no host. Note the WHATWG parser rejects this itself ("empty
    // host") for special schemes, and it *normalizes* `https:///x` to host `x`
    // rather than leaving an empty host — so `has_host()` is a belt-and-braces
    // invariant, not the thing catching this case.
    assert!(safe_url("https://").is_err());
}

#[test]
fn safe_url_rejects_control_characters() {
    assert!(safe_url("https://example.com/\nX").is_err());
    assert!(safe_url("https://example.com/\r\nX").is_err());
    assert!(safe_url("https://example.com/\0").is_err());
}

#[test]
fn safe_url_returns_the_parsed_serialization() {
    // The value handed to the OS is what the parser produced, not the raw
    // input — a bare host gains its path, and reserved characters end up
    // percent-encoded.
    assert_eq!(safe_url("https://example.com").unwrap(), "https://example.com/");
    assert_eq!(
        safe_url("https://example.com/a b").unwrap(),
        "https://example.com/a%20b"
    );
}

#[test]
fn safe_workdir_path_joins_relative_paths() {
    let wd = Path::new("/repo");
    assert_eq!(
        safe_workdir_path(wd, "src/main.rs").unwrap(),
        Path::new("/repo/src/main.rs")
    );
    // A quote in a filename is fine — it is passed as one argv entry, and no
    // shell ever sees it.
    assert_eq!(
        safe_workdir_path(wd, "x\"&calc&\".txt").unwrap(),
        Path::new("/repo/x\"&calc&\".txt")
    );
}

#[test]
fn safe_workdir_path_refuses_to_escape_the_worktree() {
    let wd = Path::new("/repo");
    // Path::join REPLACES the base for an absolute path — so an unvalidated
    // frontend string could name any file on disk.
    assert!(safe_workdir_path(wd, "/etc/passwd").is_err());
    assert!(safe_workdir_path(wd, "../../etc/passwd").is_err());
    assert!(safe_workdir_path(wd, "src/../../etc/passwd").is_err());
    assert!(safe_workdir_path(wd, "").is_err());
}
