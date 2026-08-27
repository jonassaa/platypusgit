use std::path::Path;

use platypusgit_lib::opener::{
    contained_in, resolved_workdir_path, safe_url, safe_workdir_path,
};

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

// ─── Containment against the real filesystem (#245) ──────────────────────────
//
// `safe_workdir_path` above is lexical and cannot see symlinks. Anything that
// UNLINKS the result goes through `resolved_workdir_path`, which canonicalizes
// both sides. These are the inputs it has to refuse.

#[test]
fn contained_in_is_component_wise_not_a_string_prefix() {
    let root = Path::new("/repo");
    assert!(contained_in(root, Path::new("/repo/a.txt")));
    assert!(contained_in(root, Path::new("/repo/src/a.txt")));
    // The three ways a string `starts_with` gets this wrong.
    assert!(!contained_in(root, Path::new("/repository/a.txt")));
    assert!(!contained_in(root, Path::new("/repo-backup/a.txt")));
    assert!(!contained_in(root, Path::new("/repoX")));
    // Strictly inside: the root itself is the repository, not a thing in it.
    assert!(!contained_in(root, Path::new("/repo")));
    assert!(!contained_in(root, Path::new("/")));
    assert!(!contained_in(root, Path::new("/elsewhere/a.txt")));
}

/// A repo dir plus a sibling directory outside it, both canonicalized-able.
fn two_trees() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("tempdir");
    let repo = dir.path().join("repo");
    let outside = dir.path().join("outside");
    std::fs::create_dir_all(&repo).unwrap();
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret.txt"), "s").unwrap();
    (dir, repo, outside)
}

#[test]
fn resolved_workdir_path_resolves_a_file_inside_the_worktree() {
    let (_dir, repo, _outside) = two_trees();
    std::fs::create_dir_all(repo.join("src")).unwrap();
    std::fs::write(repo.join("src/a.txt"), "a").unwrap();

    let resolved = resolved_workdir_path(&repo, "src/a.txt").expect("inside the worktree");

    // Canonicalized on BOTH sides: on macOS the tempdir sits under /var, which
    // is a symlink to /private/var, so a raw-workdir comparison refuses
    // everything.
    assert_eq!(resolved, repo.canonicalize().unwrap().join("src").join("a.txt"));
}

#[test]
fn resolved_workdir_path_resolves_a_file_that_does_not_exist() {
    // Only the PARENT is canonicalized, so a path whose entry is already gone
    // still resolves — reporting its absence belongs to the caller, and a
    // delete that answered "escapes the worktree" for a file somebody else
    // removed would be a lie.
    let (_dir, repo, _outside) = two_trees();
    let resolved = resolved_workdir_path(&repo, "vanished.txt").expect("missing but contained");
    assert_eq!(resolved, repo.canonicalize().unwrap().join("vanished.txt"));
}

#[test]
fn resolved_workdir_path_refuses_a_parent_dir_escape() {
    let (_dir, repo, _outside) = two_trees();
    assert!(resolved_workdir_path(&repo, "../outside/secret.txt").is_err());
    assert!(resolved_workdir_path(&repo, "../../../etc/passwd").is_err());
    assert!(resolved_workdir_path(&repo, "src/../../outside/secret.txt").is_err());
}

#[test]
fn resolved_workdir_path_refuses_an_absolute_path_outside_the_worktree() {
    let (_dir, repo, outside) = two_trees();
    let abs = outside.join("secret.txt").to_string_lossy().to_string();
    assert!(resolved_workdir_path(&repo, &abs).is_err());
    assert!(resolved_workdir_path(&repo, "/etc/passwd").is_err());
    assert!(resolved_workdir_path(&repo, "").is_err());
}

#[cfg(unix)]
#[test]
fn resolved_workdir_path_refuses_a_symlink_that_leaves_the_worktree() {
    // The case the lexical check cannot see: no `..`, not absolute, and it
    // still names a file outside the repository.
    let (_dir, repo, outside) = two_trees();
    std::os::unix::fs::symlink(outside.join("secret.txt"), repo.join("escape")).unwrap();

    let err = resolved_workdir_path(&repo, "escape").expect_err("symlink out of the tree");

    assert!(
        format!("{err}").contains("symbolic link"),
        "unexpected error: {err}"
    );
    assert!(repo.join("escape").symlink_metadata().is_ok(), "link removed");
}

#[cfg(unix)]
#[test]
fn resolved_workdir_path_refuses_a_path_through_a_symlinked_directory() {
    // `out/secret.txt` has no `..` in it at all — the escape is one level up.
    let (_dir, repo, outside) = two_trees();
    std::os::unix::fs::symlink(&outside, repo.join("out")).unwrap();

    assert!(resolved_workdir_path(&repo, "out/secret.txt").is_err());
}

#[cfg(unix)]
#[test]
fn resolved_workdir_path_refuses_a_broken_symlink() {
    let (_dir, repo, _outside) = two_trees();
    std::os::unix::fs::symlink(repo.join("nothing-here"), repo.join("dangling")).unwrap();

    assert!(resolved_workdir_path(&repo, "dangling").is_err());
}

#[cfg(unix)]
#[test]
fn resolved_workdir_path_allows_a_symlink_that_stays_inside_the_worktree() {
    let (_dir, repo, _outside) = two_trees();
    std::fs::write(repo.join("real.txt"), "r").unwrap();
    std::os::unix::fs::symlink(repo.join("real.txt"), repo.join("alias")).unwrap();

    assert_eq!(
        resolved_workdir_path(&repo, "alias").expect("contained link"),
        repo.canonicalize().unwrap().join("alias")
    );
}
