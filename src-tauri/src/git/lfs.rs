//! git-LFS support (#93).
//!
//! libgit2 has no LFS at all — this is the case `CliBackend`'s doc comment names,
//! and everything that talks to LFS here is the real `git lfs` binary. Two things
//! are deliberately NOT delegated to it:
//!
//! * **"does this repository use LFS"** is answered from the `.gitattributes`
//!   files, because it has to be answerable with the binary MISSING — which is
//!   exactly the situation where the user needs to be told the repository needs it.
//! * **"is this diff a pointer diff"** is answered from the diff we already
//!   produced. A pointer is a ≤3-line text file, so the whole thing is inside the
//!   diff's own lines and no subprocess or extra read is needed.

use std::path::Path;

use git2::Repository;

use crate::error::{AppError, AppResult};
use crate::git::types::{DiffLineKind, FileDiff, LfsDiff, LfsFile, LfsPointer};

/// First line of every LFS pointer file.
const POINTER_VERSION_PREFIX: &str = "version https://git-lfs.github.com/spec/v1";

/// A pointer file is three short lines. Anything longer is a real file, and
/// scanning it would be wasted work on every diff in the app.
const MAX_POINTER_LINES: usize = 8;

/// Parse an LFS pointer file's text.
///
/// Requires the version line first (the spec mandates it) and both `oid` and
/// `size`; anything else returns `None`, so an ordinary text file that happens to
/// mention the spec URL is not mistaken for a pointer.
pub fn parse_pointer(text: &str) -> Option<LfsPointer> {
    let mut lines = text.lines().filter(|l| !l.trim().is_empty());
    if !lines.next()?.trim_end().starts_with(POINTER_VERSION_PREFIX) {
        return None;
    }
    let mut oid = None;
    let mut size = None;
    for line in lines {
        let line = line.trim_end();
        if let Some(rest) = line.strip_prefix("oid ") {
            // `sha256:` today; keep any future hash prefix off the displayed oid.
            oid = Some(
                rest.split_once(':')
                    .map(|(_, hex)| hex.to_string())
                    .unwrap_or_else(|| rest.to_string()),
            );
        } else if let Some(rest) = line.strip_prefix("size ") {
            size = rest.trim().parse::<u64>().ok();
        }
    }
    Some(LfsPointer {
        oid: oid?,
        size: size?,
    })
}

/// Reconstruct one side of a diff as text: context lines plus that side's own
/// changed lines, in hunk order. Correct for the whole-file single-hunk diff a
/// three-line pointer always produces.
fn side_text(diff: &FileDiff, additions: bool) -> String {
    let mut out = String::new();
    for hunk in &diff.hunks {
        for line in &hunk.lines {
            let keep = match line.kind {
                DiffLineKind::Context => true,
                DiffLineKind::Addition => additions,
                DiffLineKind::Deletion => !additions,
                DiffLineKind::HunkHeader => false,
            };
            if keep {
                out.push_str(&line.content);
                if !line.content.ends_with('\n') {
                    out.push('\n');
                }
            }
        }
    }
    out
}

/// `Some` when either side of this diff is an LFS pointer.
///
/// Pure, and derived entirely from `diff`, so annotating a diff costs nothing but
/// a walk over lines it already holds.
pub fn lfs_diff_of(diff: &FileDiff) -> Option<LfsDiff> {
    if diff.binary {
        return None;
    }
    let total: usize = diff.hunks.iter().map(|h| h.lines.len()).sum();
    // `+ hunks.len()` because each hunk contributes a header line that is not
    // part of the file.
    if total == 0 || total > MAX_POINTER_LINES + diff.hunks.len() {
        return None;
    }
    let old = parse_pointer(&side_text(diff, false));
    let new = parse_pointer(&side_text(diff, true));
    if old.is_none() && new.is_none() {
        return None;
    }
    Some(LfsDiff { old, new })
}

/// Annotate a diff in place. One helper so `diff`, `diff_commit` and
/// `diff_commits` cannot disagree about what counts as a pointer diff.
pub fn annotate(diff: &mut FileDiff) {
    diff.lfs = lfs_diff_of(diff);
}

/// The `filter=lfs` patterns declared by one `.gitattributes` file's text.
pub fn patterns_from_attributes(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(pattern) = parts.next() else { continue };
        if parts.any(|t| t == "filter=lfs") {
            out.push(pattern.to_string());
        }
    }
    out
}

/// Every `.gitattributes` text that could declare an LFS filter.
///
/// Sourced from the INDEX rather than a filesystem walk: every tracked
/// `.gitattributes` is an index entry, so finding them is an in-memory scan
/// instead of a recursive `read_dir` over the worktree. `.git/info/attributes` is
/// untracked by definition and is read from disk.
fn attribute_texts(repo: &Repository) -> Vec<String> {
    let mut texts = Vec::new();
    let workdir = repo.workdir();

    if let Ok(index) = repo.index() {
        for entry in index.iter() {
            let path = String::from_utf8_lossy(&entry.path).to_string();
            if !(path == ".gitattributes" || path.ends_with("/.gitattributes")) {
                continue;
            }
            // Prefer the worktree copy (what git actually applies), fall back to
            // the staged blob when the file is not checked out.
            let from_disk = workdir
                .map(|w| w.join(&path))
                .and_then(|p| std::fs::read_to_string(p).ok());
            match from_disk {
                Some(t) => texts.push(t),
                None => {
                    if let Ok(blob) = repo.find_blob(entry.id) {
                        if let Ok(t) = std::str::from_utf8(blob.content()) {
                            texts.push(t.to_string());
                        }
                    }
                }
            }
        }
    }

    if let Ok(t) = std::fs::read_to_string(repo.path().join("info").join("attributes")) {
        texts.push(t);
    }
    texts
}

/// All `filter=lfs` patterns this repository declares, deduplicated in first-seen
/// order.
pub fn declared_patterns(repo: &Repository) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for text in attribute_texts(repo) {
        for p in patterns_from_attributes(&text) {
            if !out.contains(&p) {
                out.push(p);
            }
        }
    }
    out
}

/// `git lfs version`'s output, or `None` when the binary is missing or fails.
///
/// The probe runs `git lfs version` rather than looking for a `git-lfs`
/// executable: LFS is reached as a git subcommand, so what matters is whether
/// *git* can find it, including a git-lfs installed somewhere only git's exec-path
/// knows about.
pub fn version(cwd: &Path) -> Option<String> {
    let out = crate::proc::git(cwd)
        .args(["lfs", "version"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

/// `Err(LfsUnavailable)` unless git can run `git lfs`. Every LFS op calls this
/// first, so a missing binary is a state the UI disables on rather than git's
/// `'lfs' is not a git command` reaching an error banner.
pub fn require(cwd: &Path) -> AppResult<String> {
    version(cwd).ok_or_else(|| {
        AppError::LfsUnavailable("`git lfs` is not installed or not on PATH".to_string())
    })
}

/// Parse `git lfs ls-files` output: `<oid> <*|-> <path>`.
///
/// `*` means the real object is in the worktree, `-` means the file is still a
/// pointer — which is the whole pointer-vs-materialized question, answered for the
/// entire worktree by one call. `splitn(3)` because a path may contain spaces.
pub fn parse_ls_files(stdout: &str) -> Vec<LfsFile> {
    stdout
        .lines()
        .filter_map(|line| {
            let mut parts = line.trim_end().splitn(3, ' ');
            let oid = parts.next()?.trim();
            let marker = parts.next()?.trim();
            let path = parts.next()?.trim();
            if oid.is_empty() || path.is_empty() {
                return None;
            }
            Some(LfsFile {
                path: path.to_string(),
                oid: oid.to_string(),
                materialized: marker == "*",
            })
        })
        .collect()
}

/// `git lfs fetch [remote]` — downloads objects into `.git/lfs`, leaves the
/// worktree alone.
pub fn fetch_args(remote: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["lfs".into(), "fetch".into()];
    if let Some(r) = remote {
        args.push(r.to_string());
    }
    args
}

/// `git lfs pull [remote]` — fetch plus checkout, i.e. materialize as well.
pub fn pull_args(remote: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["lfs".into(), "pull".into()];
    if let Some(r) = remote {
        args.push(r.to_string());
    }
    args
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::types::{DiffHunk, DiffLine};

    const POINTER: &str = "version https://git-lfs.github.com/spec/v1\n\
                           oid sha256:aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990\n\
                           size 12345\n";

    #[test]
    fn parses_a_pointer() {
        let p = parse_pointer(POINTER).expect("pointer");
        assert_eq!(p.size, 12345);
        assert!(p.oid.starts_with("aaaabbbb"));
        // The hash-algorithm prefix is not part of the displayed oid.
        assert!(!p.oid.contains(':'));
    }

    #[test]
    fn rejects_text_that_merely_mentions_the_spec() {
        assert!(parse_pointer("see version https://git-lfs.github.com/spec/v1\n").is_none());
        // Version line present but no oid/size — not a pointer.
        assert!(parse_pointer("version https://git-lfs.github.com/spec/v1\nhello\n").is_none());
    }

    fn line(kind: DiffLineKind, content: &str) -> DiffLine {
        DiffLine {
            kind,
            old_lineno: None,
            new_lineno: None,
            content: content.to_string(),
        }
    }

    fn diff_with(lines: Vec<DiffLine>) -> FileDiff {
        FileDiff {
            path: "asset.psd".into(),
            old_path: None,
            binary: false,
            additions: 0,
            deletions: 0,
            hunks: vec![DiffHunk {
                header: "@@".into(),
                old_start: 1,
                old_lines: 3,
                new_start: 1,
                new_lines: 3,
                lines,
            }],
            lfs: None,
            oversized: None,
            truncated: None,
        }
    }

    #[test]
    fn detects_a_changed_pointer_where_the_version_line_is_context() {
        // The realistic shape: only oid and size differ, so `version` is CONTEXT
        // and a side reconstructed from -/+ lines alone would not parse.
        let d = diff_with(vec![
            line(DiffLineKind::Context, "version https://git-lfs.github.com/spec/v1\n"),
            line(DiffLineKind::Deletion, "oid sha256:1111\n"),
            line(DiffLineKind::Deletion, "size 10\n"),
            line(DiffLineKind::Addition, "oid sha256:2222\n"),
            line(DiffLineKind::Addition, "size 20\n"),
        ]);
        let lfs = lfs_diff_of(&d).expect("lfs diff");
        assert_eq!(lfs.old.as_ref().unwrap().size, 10);
        assert_eq!(lfs.new.as_ref().unwrap().size, 20);
        assert_eq!(lfs.old.as_ref().unwrap().oid, "1111");
    }

    #[test]
    fn detects_an_added_pointer_with_no_old_side() {
        let d = diff_with(
            POINTER
                .lines()
                .map(|l| line(DiffLineKind::Addition, &format!("{l}\n")))
                .collect(),
        );
        let lfs = lfs_diff_of(&d).expect("lfs diff");
        assert!(lfs.old.is_none());
        assert_eq!(lfs.new.unwrap().size, 12345);
    }

    #[test]
    fn ordinary_text_diffs_are_not_lfs() {
        let d = diff_with(vec![
            line(DiffLineKind::Deletion, "hello\n"),
            line(DiffLineKind::Addition, "world\n"),
        ]);
        assert!(lfs_diff_of(&d).is_none());
    }

    #[test]
    fn a_long_diff_is_never_scanned_as_a_pointer() {
        let many: Vec<DiffLine> = (0..40)
            .map(|i| line(DiffLineKind::Addition, &format!("line {i}\n")))
            .collect();
        assert!(lfs_diff_of(&diff_with(many)).is_none());
    }

    #[test]
    fn reads_lfs_patterns_and_ignores_everything_else() {
        let text = "# comment\n\
                    *.psd filter=lfs diff=lfs merge=lfs -text\n\
                    *.md text\n\
                    assets/**/*.bin filter=lfs -text\n\
                    \n";
        assert_eq!(
            patterns_from_attributes(text),
            ["*.psd", "assets/**/*.bin"]
        );
    }

    #[test]
    fn parses_ls_files_including_paths_with_spaces() {
        let out = "1a2b3c4d * assets/logo.png\n5e6f7a8b - my folder/big file.psd\ngarbage\n";
        let files = parse_ls_files(out);
        assert_eq!(files.len(), 2);
        assert!(files[0].materialized);
        assert!(!files[1].materialized);
        assert_eq!(files[1].path, "my folder/big file.psd");
    }

    #[test]
    fn arg_builders() {
        assert_eq!(fetch_args(None), ["lfs", "fetch"]);
        assert_eq!(fetch_args(Some("origin")), ["lfs", "fetch", "origin"]);
        assert_eq!(pull_args(Some("upstream")), ["lfs", "pull", "upstream"]);
    }
}
