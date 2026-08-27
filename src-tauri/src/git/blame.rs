//! `blame.ignoreRevsFile` support — the pure half (#253).
//!
//! # Why blame leaves libgit2 at all
//!
//! `.git-blame-ignore-revs` is how a repository says "the reformat commit is
//! not the author of these lines", and it is committed in a great many
//! repositories. **libgit2 has no equivalent**: `git_blame_options` carries
//! whitespace, first-parent and range flags and nothing that takes a list of
//! revisions to pass through, so there is no in-process way to answer the
//! question at all. Where libgit2 falls short, this codebase shells out to real
//! git — the same trade `merge_branch`, `rebase_onto` and `worktree remove`
//! already make.
//!
//! # The shell-out is opt-in by the repository, not global
//!
//! A repo with no `blame.ignoreRevsFile` still gets the in-process libgit2
//! blame, exactly as before: no subprocess, no parsing, no behaviour change.
//! Only a repo that configured one pays for git, and only then are BOTH toggle
//! states served by git — comparing a libgit2 blame against a git blame would
//! let unrelated engine differences masquerade as the effect of the toggle.
//!
//! # The configured path never reaches argv
//!
//! `git blame` reads `blame.ignoreRevsFile` from the repository's own config,
//! so the ignore-revs view needs no `--ignore-revs-file=<path>` at all — the
//! user-supplied path is never assembled into a command line, never has to be
//! quoted, and can never be read as an option because it is not an argument.
//! The un-ignored view passes the fixed literal `--ignore-revs-file=`, whose
//! empty value is git's documented "clear the list" (including entries the
//! config contributed). The only user-supplied argv value left is the path
//! being blamed, and it goes after `--`.
//!
//! # `--line-porcelain`, not the default format
//!
//! The default output packs author, date and line number into a
//! column-aligned parenthesised field around content that may contain any of
//! those characters. `--line-porcelain` is the stable, documented,
//! machine-readable form: one header line, `key value` lines, then the content
//! prefixed with a TAB. It also carries the `ignored` / `unblamable` keys, so
//! `blame.markIgnoredLines` needs no second run to observe.

use std::path::{Path, PathBuf};

use git2::Repository;

use crate::git::types::BlameLine;

/// The three `blame.*` settings this feature reads.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BlameSettings {
    /// `blame.ignoreRevsFile`, verbatim. `None` when unset or empty — git
    /// treats an empty value as "reset the list", which for a single-valued
    /// read is indistinguishable from unset.
    pub ignore_revs_file: Option<String>,
    pub mark_ignored_lines: bool,
    pub mark_unblamable_lines: bool,
}

/// Read the `blame.*` settings from the repository's effective config
/// (system + global + local, exactly as git resolves them).
pub fn read_settings(repo: &Repository) -> BlameSettings {
    let cfg = match repo.config() {
        Ok(c) => c,
        // No readable config is the same answer as no settings.
        Err(_) => return BlameSettings::default(),
    };
    BlameSettings {
        ignore_revs_file: cfg
            .get_string("blame.ignoreRevsFile")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        mark_ignored_lines: cfg.get_bool("blame.markIgnoredLines").unwrap_or(false),
        mark_unblamable_lines: cfg.get_bool("blame.markUnblamableLines").unwrap_or(false),
    }
}

/// Where a configured `blame.ignoreRevsFile` actually lives. PURE.
///
/// Mirrors git: `~` is expanded (git runs the value through
/// `git_config_pathname`), and a relative path resolves against the top of the
/// working tree — which is where git itself is standing, because `proc::git`
/// runs it as `git -C <workdir>`.
///
/// Used ONLY to decide whether the file is there. The resolved path is never
/// handed to git; see the module docs.
pub fn resolve_ignore_revs_path(workdir: &Path, home: Option<&Path>, raw: &str) -> PathBuf {
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| {
        // A bare `~` is the home directory itself.
        (raw == "~").then_some("")
    }) {
        if let Some(home) = home {
            return home.join(rest);
        }
    }
    let p = Path::new(raw);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        workdir.join(p)
    }
}

/// `$HOME` for [`resolve_ignore_revs_path`], the same way `cli.rs` finds it.
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// argv for `git -C <workdir> …`, everything except the path. PURE.
///
/// `HEAD` is explicit so this asks the SAME question libgit2's blame does —
/// the file as of HEAD, not the working tree. Without it git would blame the
/// worktree and attribute uncommitted lines to the all-zero oid, so the line
/// COUNT would change depending on whether the repository happens to have an
/// ignore-revs file. `--` ends option parsing before the caller appends the
/// path.
pub fn blame_args(ignore_revs: bool) -> Vec<&'static str> {
    let mut args = vec!["blame", "--line-porcelain"];
    if !ignore_revs {
        // git's documented "clear the list of revs from previously processed
        // files", which includes the ones `blame.ignoreRevsFile` contributed.
        args.push("--ignore-revs-file=");
    }
    args.push("HEAD");
    args.push("--");
    args
}

/// A partly-read porcelain entry.
#[derive(Default)]
struct Partial {
    oid: String,
    line_no: u32,
    author: String,
    email: String,
    timestamp: i64,
    summary: String,
    ignored: bool,
    unblamable: bool,
}

/// Is this a porcelain header line (`<sha> <orig-lno> <final-lno> [<count>]`)?
///
/// Distinguishable from a `key value` line because the first token of a header
/// is all hex and at least a full oid long, and no porcelain key is.
fn parse_header(line: &str) -> Option<Partial> {
    let mut it = line.split(' ');
    let sha = it.next()?;
    if sha.len() < 40 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let _orig_lno: u32 = it.next()?.parse().ok()?;
    let line_no: u32 = it.next()?.parse().ok()?;
    Some(Partial {
        oid: sha.to_string(),
        line_no,
        ..Default::default()
    })
}

impl Partial {
    fn key(&mut self, line: &str) {
        let (key, value) = match line.split_once(' ') {
            Some((k, v)) => (k, v),
            None => (line, ""),
        };
        match key {
            "author" => self.author = value.to_string(),
            // Porcelain wraps the address in angle brackets; the rest of the
            // app stores bare addresses.
            "author-mail" => {
                self.email = value
                    .trim()
                    .trim_start_matches('<')
                    .trim_end_matches('>')
                    .to_string()
            }
            "author-time" => self.timestamp = value.trim().parse().unwrap_or(0),
            "summary" => self.summary = value.to_string(),
            "ignored" => self.ignored = true,
            "unblamable" => self.unblamable = true,
            _ => {}
        }
    }

    fn finish(self, content: &str) -> BlameLine {
        let short_oid = self.oid.chars().take(7).collect();
        BlameLine {
            line_no: self.line_no,
            short_oid,
            oid: self.oid,
            author: self.author,
            email: self.email,
            timestamp: self.timestamp,
            summary: self.summary,
            content: content.to_string(),
            ignored: self.ignored,
            unblamable: self.unblamable,
        }
    }
}

/// Parse `git blame --line-porcelain` output into one [`BlameLine`] per line
/// of the file. PURE.
///
/// Content lines are the ones prefixed with a TAB, which is what makes this
/// unambiguous: no header and no key can start with one, and a line of the
/// file that happens to look like a porcelain header is still preceded by its
/// TAB. A trailing `\r` is stripped so a CRLF file matches what the libgit2
/// path produces (`str::lines` drops it there).
pub fn parse_porcelain(stdout: &str) -> Vec<BlameLine> {
    let mut out = Vec::new();
    let mut cur: Option<Partial> = None;
    for raw in stdout.split('\n') {
        if let Some(content) = raw.strip_prefix('\t') {
            if let Some(partial) = cur.take() {
                out.push(partial.finish(content.strip_suffix('\r').unwrap_or(content)));
            }
            continue;
        }
        if let Some(header) = parse_header(raw) {
            cur = Some(header);
            continue;
        }
        if let Some(partial) = cur.as_mut() {
            partial.key(raw);
        }
    }
    out.sort_by_key(|l| l.line_no);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const TWO_LINES: &str = "\
1111111111111111111111111111111111111111 1 1 1
author Ada Lovelace
author-mail <ada@example.com>
author-time 1700000000
author-tz +0000
committer Ada Lovelace
committer-mail <ada@example.com>
committer-time 1700000000
committer-tz +0000
summary write the lines
boundary
filename src.txt
ignored
\t    alpha
2222222222222222222222222222222222222222 2 2 1
author Grace Hopper
author-mail <grace@example.com>
author-time 1700000100
author-tz +0000
committer Grace Hopper
committer-mail <grace@example.com>
committer-time 1700000100
committer-tz +0000
summary add a line
previous 1111111111111111111111111111111111111111 src.txt
filename src.txt
unblamable
\tbrand new
";

    #[test]
    fn parses_one_line_per_file_line_with_its_attribution() {
        let lines = parse_porcelain(TWO_LINES);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].line_no, 1);
        assert_eq!(lines[0].oid, "1".repeat(40));
        assert_eq!(lines[0].short_oid, "1111111");
        assert_eq!(lines[0].author, "Ada Lovelace");
        assert_eq!(lines[0].email, "ada@example.com");
        assert_eq!(lines[0].timestamp, 1_700_000_000);
        assert_eq!(lines[0].summary, "write the lines");
        assert_eq!(lines[0].content, "    alpha");
        assert_eq!(lines[1].author, "Grace Hopper");
        assert_eq!(lines[1].content, "brand new");
    }

    #[test]
    fn carries_gits_ignored_and_unblamable_marks_separately() {
        let lines = parse_porcelain(TWO_LINES);
        assert!(lines[0].ignored && !lines[0].unblamable);
        assert!(lines[1].unblamable && !lines[1].ignored);
    }

    #[test]
    fn a_file_line_that_looks_like_a_porcelain_header_is_still_content() {
        // The failure this guards: blaming a file that CONTAINS blame output.
        // The TAB is what disambiguates, so the parser must key on it.
        let out = format!(
            "{sha} 1 1 1\nauthor A\nauthor-mail <a@b>\nauthor-time 1\nsummary s\nfilename f\n\t{sha} 9 9 9\n",
            sha = "3".repeat(40)
        );
        let lines = parse_porcelain(&out);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].content, format!("{} 9 9 9", "3".repeat(40)));
    }

    #[test]
    fn an_empty_file_line_survives_and_crlf_is_normalised() {
        let sha = "4".repeat(40);
        let out = format!(
            "{sha} 1 1 2\nauthor A\nauthor-time 1\nfilename f\n\t\n{sha} 2 2\nauthor A\nauthor-time 1\nfilename f\n\ttext\r\n"
        );
        let lines = parse_porcelain(&out);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].content, "");
        assert_eq!(lines[1].content, "text");
    }

    #[test]
    fn empty_output_is_an_empty_blame_not_a_panic() {
        assert!(parse_porcelain("").is_empty());
    }

    #[test]
    fn the_ignore_revs_view_passes_no_path_and_the_other_clears_the_list() {
        // The security property in one assertion: neither form carries a
        // user-supplied path, and both end option parsing before the caller
        // appends one.
        assert_eq!(
            blame_args(true),
            vec!["blame", "--line-porcelain", "HEAD", "--"]
        );
        assert_eq!(
            blame_args(false),
            vec![
                "blame",
                "--line-porcelain",
                "--ignore-revs-file=",
                "HEAD",
                "--"
            ]
        );
        for on in [true, false] {
            assert_eq!(*blame_args(on).last().unwrap(), "--");
        }
    }

    #[test]
    fn a_relative_ignore_revs_path_resolves_against_the_worktree_root() {
        assert_eq!(
            resolve_ignore_revs_path(
                Path::new("/repo"),
                Some(Path::new("/home/ada")),
                ".git-blame-ignore-revs"
            ),
            PathBuf::from("/repo/.git-blame-ignore-revs")
        );
    }

    #[test]
    fn absolute_and_tilde_ignore_revs_paths_are_left_where_they_point() {
        assert_eq!(
            resolve_ignore_revs_path(Path::new("/repo"), Some(Path::new("/home/ada")), "/etc/revs"),
            PathBuf::from("/etc/revs")
        );
        assert_eq!(
            resolve_ignore_revs_path(
                Path::new("/repo"),
                Some(Path::new("/home/ada")),
                "~/shared-revs"
            ),
            PathBuf::from("/home/ada/shared-revs")
        );
        // No home to expand against: better a path that fails to stat than a
        // literal "~" directory created inside somebody's repository.
        assert_eq!(
            resolve_ignore_revs_path(Path::new("/repo"), None, "~/shared-revs"),
            PathBuf::from("/repo/~/shared-revs")
        );
    }
}
