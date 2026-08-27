//! `commit.template` and `core.commentChar` (#252).
//!
//! git's own mechanism for seeding a commit message: a repository sets
//! `commit.template`, the CLI opens the editor on that file, and every line
//! starting with the comment character is stripped back out before the commit
//! object is written. We honoured neither half until this issue, so a
//! repository that ships a template got a blank box.
//!
//! Both halves are read together on purpose. A template without its comment
//! prefix is a commit message with the repository's instructions still inside
//! it — which is exactly the bug the issue names.
//!
//! `commit.cleanup` rides along for the same reason. It is what decides whether
//! the comment prefix is USED at all, and reading the template without it would
//! leave the frontend guessing at the one config value that governs the answer.
//!
//! What is NOT here is the stripping. That lives in the composer
//! (`src/features/commits/message/cleanup.ts`) so the box can show the user
//! what will be removed *before* they press Commit, and so one implementation
//! serves both the display and the commit. This module answers only "what text,
//! and which prefix".
//!
//! Path and comment-character resolution are free functions over plain values —
//! no repository, no home directory — for the same reason `signing.rs` keeps its
//! decisions pure: they are the part with the edge cases, and they are the part
//! worth testing exhaustively.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppResult;

/// git's default comment character, used when `core.commentChar` is unset.
pub const DEFAULT_COMMENT_PREFIX: &str = "#";

/// What `core.commentChar = auto` chooses from, in git's order
/// (`builtin/commit.c::adjust_comment_line_char`).
const AUTO_CANDIDATES: &str = "#;@!$%^&|:";

/// `commit.cleanup`, git's five modes.
///
/// Serialised in git's OWN spelling rather than this codebase's usual bare
/// PascalCase (`ResetMode`): these are config values a user types into
/// `.gitconfig`, so round-tripping them unchanged means the TypeScript union is
/// literally the documented set and neither side has a translation table to get
/// wrong.
///
/// `Default` is deliberately kept as a value rather than resolved here. It means
/// "`strip` if the message is to be EDITED, `whitespace` otherwise", and only
/// the composer knows which of those the box it is holding is — see
/// `features/commits/message/cleanup.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CleanupMode {
    Default,
    Verbatim,
    Whitespace,
    Strip,
    Scissors,
}

/// A repository's commit-message template plus the two config values that
/// govern how the text in the box is cleaned up on the way to a commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTemplate {
    /// Where `commit.template` resolved to, when it is set at all. Reported
    /// even when the file could not be read, so the UI can name the path
    /// instead of saying "something went wrong".
    pub path: Option<String>,
    /// The template's contents, comments and all — exactly what git would put
    /// in the editor. `None` when no template is configured, or when the
    /// configured one could not be read.
    pub body: Option<String>,
    /// `commit.template` is set but the file behind it could not be read —
    /// missing, unreadable, or not UTF-8.
    ///
    /// git *dies* here. Refusing to open the commit screen over a stale config
    /// line would be worse than useless, so this comes back as a fact the
    /// composer puts on screen rather than as an error. Deliberately a flag and
    /// not a stringified `io::Error`: the command still succeeded, and `AppError`
    /// exists so nobody invents a second error channel.
    pub unreadable: bool,
    /// The comment prefix for THIS repository: `core.commentChar`, defaulting to
    /// `#`, with `auto` resolved the way git resolves it. Never empty.
    pub comment_prefix: String,
    /// `commit.cleanup`. `Default` when unset — or when set to something git
    /// would reject, since a hand-typed `commit.cleanup = strp` must not decide
    /// on its own that nothing gets cleaned up.
    pub cleanup: CleanupMode,
}

impl CommitTemplate {
    /// No template configured, comments governed by `prefix`.
    fn none(prefix: String, cleanup: CleanupMode) -> Self {
        CommitTemplate {
            path: None,
            body: None,
            unreadable: false,
            comment_prefix: prefix,
            cleanup,
        }
    }
}

/// Read `commit.template` (resolving and loading the file) and `core.commentChar`.
///
/// Never fails over the template itself — only over a config read that libgit2
/// refuses outright.
pub fn read(repo: &git2::Repository) -> AppResult<CommitTemplate> {
    let cfg = repo.config()?;
    let get = |k: &str| cfg.get_string(k).ok().filter(|s| !s.trim().is_empty());
    let comment_char = get("core.commentChar");
    let cleanup = resolve_cleanup(get("commit.cleanup").as_deref());

    let Some(configured) = get("commit.template") else {
        // `auto` with nothing to inspect is `#`, which is also what git lands
        // on for an empty editor buffer.
        return Ok(CommitTemplate::none(
            resolve_comment_prefix(comment_char.as_deref(), ""),
            cleanup,
        ));
    };

    let resolved = resolve_template_path(&configured, repo.workdir(), home_dir().as_deref());
    let body = resolved
        .as_deref()
        .and_then(|p| std::fs::read_to_string(p).ok());

    Ok(CommitTemplate {
        path: resolved.map(|p| p.to_string_lossy().into_owned()),
        comment_prefix: resolve_comment_prefix(comment_char.as_deref(), body.as_deref().unwrap_or("")),
        unreadable: body.is_none(),
        body,
        cleanup,
    })
}

/// `commit.cleanup`, in git's spelling. Anything unrecognised is `Default`.
///
/// git errors on an unknown value; degrading to the default is the safer answer
/// here, because the alternative readings all silently change what gets
/// committed and the commit screen has to open either way.
pub fn resolve_cleanup(configured: Option<&str>) -> CleanupMode {
    match configured.map(str::trim) {
        Some("verbatim") => CleanupMode::Verbatim,
        Some("whitespace") => CleanupMode::Whitespace,
        Some("strip") => CleanupMode::Strip,
        Some("scissors") => CleanupMode::Scissors,
        _ => CleanupMode::Default,
    }
}

/// Where a configured `commit.template` points.
///
/// - `~` / `~/…` expand against `home` — git does this itself
///   (`expand_user_path`). `~otheruser/…` is left literal: resolving another
///   account's home needs a platform password-database lookup for a case that
///   does not occur in practice, and an unexpanded path is then *reported* as
///   unreadable rather than silently ignored.
/// - An absolute path is taken as given.
/// - A relative path resolves from the WORKTREE ROOT. `git commit` runs after
///   `setup_git_directory()` has chdir'd to the top of the worktree, so that is
///   where the CLI looks — not wherever the user happened to be standing.
pub fn resolve_template_path(
    configured: &str,
    workdir: Option<&Path>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    let raw = configured.trim();
    if raw.is_empty() {
        return None;
    }
    if raw == "~" {
        return home.map(Path::to_path_buf);
    }
    if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        return home.map(|h| h.join(rest));
    }
    let p = Path::new(raw);
    if p.is_absolute() {
        return Some(p.to_path_buf());
    }
    workdir.map(|w| w.join(p))
}

/// `core.commentChar`, with git's defaulting and its `auto` rule.
///
/// git 2.45 widened this from a character to a string, so it is carried as one.
pub fn resolve_comment_prefix(configured: Option<&str>, body: &str) -> String {
    match configured {
        Some("auto") => auto_comment_prefix(body),
        Some(v) if !v.is_empty() => v.to_string(),
        _ => DEFAULT_COMMENT_PREFIX.to_string(),
    }
}

/// git's `auto` rule, verbatim (`adjust_comment_line_char`): if `#` appears
/// nowhere in the buffer it stays; otherwise every candidate that starts a line
/// is struck out and the first survivor wins.
fn auto_comment_prefix(body: &str) -> String {
    if !body.contains('#') {
        return DEFAULT_COMMENT_PREFIX.to_string();
    }
    let mut available: Vec<char> = AUTO_CANDIDATES.chars().collect();
    for line in body.split('\n') {
        if let Some(first) = line.chars().next() {
            available.retain(|c| *c != first);
        }
    }
    // git dies when nothing survives ("unable to select a comment character").
    // Falling back to `#` keeps the commit screen usable, and the composer shows
    // which lines a prefix would remove before anything is committed.
    available
        .first()
        .map(char::to_string)
        .unwrap_or_else(|| DEFAULT_COMMENT_PREFIX.to_string())
}

/// The home directory `~` expands against — `$HOME`, as git uses, with
/// `%USERPROFILE%` behind it for a Windows shell that sets no `HOME`.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORKDIR: &str = if cfg!(windows) { r"C:\repo" } else { "/repo" };
    const HOME: &str = if cfg!(windows) { r"C:\Users\ada" } else { "/home/ada" };

    fn resolve(configured: &str) -> Option<PathBuf> {
        resolve_template_path(configured, Some(Path::new(WORKDIR)), Some(Path::new(HOME)))
    }

    #[test]
    fn a_relative_path_hangs_off_the_worktree_root() {
        assert_eq!(resolve(".gitmessage"), Some(Path::new(WORKDIR).join(".gitmessage")));
        assert_eq!(
            resolve(".config/commit.txt"),
            Some(Path::new(WORKDIR).join(".config/commit.txt"))
        );
    }

    #[test]
    fn an_absolute_path_is_left_alone() {
        let abs = Path::new(HOME).join("house-style.txt");
        assert_eq!(resolve(abs.to_str().unwrap()), Some(abs));
    }

    #[test]
    fn a_tilde_path_expands_against_home() {
        assert_eq!(resolve("~/.gitmessage"), Some(Path::new(HOME).join(".gitmessage")));
        assert_eq!(resolve("~"), Some(PathBuf::from(HOME)));
    }

    #[test]
    fn surrounding_whitespace_does_not_defeat_the_lookup() {
        assert_eq!(resolve("  .gitmessage  "), Some(Path::new(WORKDIR).join(".gitmessage")));
    }

    #[test]
    fn an_empty_setting_resolves_to_nothing() {
        assert_eq!(resolve(""), None);
        assert_eq!(resolve("   "), None);
    }

    #[test]
    fn another_users_home_is_not_guessed_at() {
        // Left literal, so it lands as a (missing) worktree-relative path and is
        // REPORTED — rather than quietly resolving to the wrong person's file.
        assert_eq!(
            resolve("~bob/.gitmessage"),
            Some(Path::new(WORKDIR).join("~bob/.gitmessage"))
        );
    }

    #[test]
    fn a_relative_path_in_a_bare_repo_resolves_to_nothing() {
        assert_eq!(
            resolve_template_path(".gitmessage", None, Some(Path::new(HOME))),
            None
        );
    }

    #[test]
    fn a_tilde_path_with_no_home_resolves_to_nothing() {
        assert_eq!(
            resolve_template_path("~/.gitmessage", Some(Path::new(WORKDIR)), None),
            None
        );
    }

    #[test]
    fn cleanup_reads_gits_own_spellings() {
        assert_eq!(resolve_cleanup(Some("verbatim")), CleanupMode::Verbatim);
        assert_eq!(resolve_cleanup(Some("whitespace")), CleanupMode::Whitespace);
        assert_eq!(resolve_cleanup(Some("strip")), CleanupMode::Strip);
        assert_eq!(resolve_cleanup(Some("scissors")), CleanupMode::Scissors);
        assert_eq!(resolve_cleanup(Some("default")), CleanupMode::Default);
    }

    #[test]
    fn cleanup_defaults_when_absent_or_unreadable() {
        assert_eq!(resolve_cleanup(None), CleanupMode::Default);
        // git errors on this; we degrade, because every other reading silently
        // changes what gets committed.
        assert_eq!(resolve_cleanup(Some("strp")), CleanupMode::Default);
        assert_eq!(resolve_cleanup(Some("")), CleanupMode::Default);
        // Case-sensitive, as git's own parser is.
        assert_eq!(resolve_cleanup(Some("Strip")), CleanupMode::Default);
    }

    #[test]
    fn cleanup_serialises_in_gits_spelling() {
        // The TypeScript union is literally the documented set, so a rename on
        // either side has to be deliberate.
        assert_eq!(
            serde_json::to_string(&CleanupMode::Whitespace).unwrap(),
            "\"whitespace\""
        );
        assert_eq!(
            serde_json::to_string(&CleanupMode::Default).unwrap(),
            "\"default\""
        );
    }

    #[test]
    fn the_comment_prefix_defaults_to_hash() {
        assert_eq!(resolve_comment_prefix(None, ""), "#");
        assert_eq!(resolve_comment_prefix(Some(""), ""), "#");
    }

    #[test]
    fn a_configured_comment_char_wins() {
        assert_eq!(resolve_comment_prefix(Some(";"), "# not a comment here"), ";");
        // git 2.45 widened this from one character to a string.
        assert_eq!(resolve_comment_prefix(Some("//"), ""), "//");
    }

    #[test]
    fn auto_keeps_hash_when_the_body_has_none() {
        assert_eq!(resolve_comment_prefix(Some("auto"), "subject\n\nbody\n"), "#");
        assert_eq!(resolve_comment_prefix(Some("auto"), ""), "#");
    }

    #[test]
    fn auto_steps_aside_when_a_line_starts_with_hash() {
        assert_eq!(resolve_comment_prefix(Some("auto"), "#123 an issue ref\n"), ";");
    }

    #[test]
    fn auto_steps_aside_again_when_the_next_candidate_is_taken_too() {
        assert_eq!(
            resolve_comment_prefix(Some("auto"), "#123 an issue\n; a note\n"),
            "@"
        );
    }

    #[test]
    fn auto_only_looks_at_the_first_character_of_a_line() {
        // A `#` in the MIDDLE of a line makes git leave `#` alone only if it is
        // nowhere at all — it is somewhere here, so the elimination pass runs,
        // and no line STARTS with a candidate, so `#` survives it.
        assert_eq!(resolve_comment_prefix(Some("auto"), "fixes issue #7\n"), "#");
    }
}
