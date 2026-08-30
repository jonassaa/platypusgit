//! Stash helpers that need no repository (#133).
//!
//! The two argv builders live here rather than inline in `libgit2.rs` for the
//! same reason `forge/checkout.rs` splits its own: every rule that matters
//! about these command lines is a rule about ARGUMENT ORDER, and order is
//! testable without a repository, a temp dir, or a subprocess.
//!
//! Both commands are LOCAL. They contact no remote, so they run on
//! `run_git_capture`'s prompt-less path and never on
//! `commands::net::run_git_authenticated`.

use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::git::types::StashSaveOptions;

/// The env `stash push` needs on top of the prompt-less defaults.
///
/// A path reaching us is data from `git status`, but git reads a leading `:`
/// as pathspec MAGIC — a file honestly named `:(exclude)x` would otherwise
/// select a different set than the row the user right-clicked. This is the
/// pathspec-shaped member of the same family as the `--` rule.
///
/// Defined here and reused: `commands::diff::open_in_difftool` (#235) is the
/// second shell-out in the app that passes a pathspec, and it needs exactly
/// this. A second copy of the pair would be a second one to forget.
pub const LITERAL_PATHSPECS: (&str, &str) = ("GIT_LITERAL_PATHSPECS", "1");

/// `git stash push …` for a pathspec-scoped stash.
///
/// The `--` separator is mandatory, not stylistic: a file named `-f` is
/// otherwise parsed as an option. Everything after it is a path.
///
/// `--include-untracked` is DERIVED by the caller rather than offered as a
/// choice — `git stash push -- <untracked path>` fails outright without it
/// ("did not match any file(s) known to git").
pub fn stash_push_args(opts: &StashSaveOptions, paths: &[&Path]) -> AppResult<Vec<String>> {
    if paths.is_empty() {
        // An empty pathspec is not "stash everything" here: `git stash push --`
        // with no paths stashes the whole worktree, which is a different and
        // far more destructive command than the one the caller asked for.
        return Err(AppError::InvalidArgument(
            "no paths given to stash".into(),
        ));
    }
    let mut args = vec!["stash".to_string(), "push".to_string()];
    if opts.include_untracked {
        args.push("--include-untracked".into());
    }
    if opts.keep_index {
        args.push("--keep-index".into());
    }
    if let Some(msg) = opts.message.as_deref() {
        // `-m <value>`: parse-options consumes the next argv as the value
        // whatever it starts with, so a message beginning with `-` is safe
        // here and does not need (and cannot have) the separator in front.
        args.push("-m".into());
        args.push(msg.to_string());
    }
    args.push("--".into());
    for p in paths {
        args.push(p.to_string_lossy().to_string());
    }
    Ok(args)
}

/// `git stash store -m <message> -- <oid>` — the only supported writer of the
/// `refs/stash` reflog, and therefore the only way to change what a stash is
/// called.
///
/// `--` is accepted by this subcommand (verified against git 2.50) and the oid
/// goes after it, per the end-of-options convention.
pub fn stash_store_args(message: &str, oid: &str) -> Vec<String> {
    vec![
        "stash".into(),
        "store".into(),
        "-m".into(),
        message.to_string(),
        "--".into(),
        oid.to_string(),
    ]
}

/// Did the store half of a rename land EXACTLY as intended?
///
/// This is the gate on the drop, and it is the only thing standing between a
/// failed rename and a destroyed stash. The rename is additive up to this
/// point — a failure anywhere above leaves the original entry where it was —
/// but the drop is neither additive nor recoverable through the UI. So the drop
/// runs only when all three of these hold:
///
/// - the list grew by exactly one,
/// - the new entry is at the top with the oid and message we stored, and
/// - the ORIGINAL entry is still intact, one position lower than it was.
///
/// The failure it exists for is the `git stash store` elision (see
/// `stash_store_args`): a no-op store leaves `after == before`, the first check
/// fails, and nothing is dropped. The worst outcome of refusing is a duplicate
/// entry the user can drop; the worst outcome of not refusing is an entry that
/// no longer exists.
pub fn rename_store_landed(
    before: &[(String, String)],
    after: &[(String, String)],
    index: usize,
    new_oid: &str,
    new_message: &str,
) -> bool {
    let Some((old_oid, old_message)) = before.get(index) else {
        return false;
    };
    let grew_by_one = after.len() == before.len() + 1;
    let stored_on_top = after
        .first()
        .is_some_and(|(oid, msg)| oid == new_oid && msg == new_message);
    let original_intact = after
        .get(index + 1)
        .is_some_and(|(oid, msg)| oid == old_oid && msg == old_message);
    grew_by_one && stored_on_top && original_intact
}

/// Reject a stash message that would not survive a reflog round trip.
///
/// A reflog is line-based. git does not error on a newline, it silently
/// squashes it to a space — which would leave the stash commit's own message
/// and its reflog message disagreeing about what the entry is called, forever.
/// Refusing is the `credential_approve` precedent: do not escape a value into a
/// line-based protocol, decline it.
pub fn validate_message(message: &str) -> AppResult<()> {
    if message.contains('\n') || message.contains('\r') {
        return Err(AppError::InvalidArgument(
            "a stash message cannot contain a line break".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn opts(message: Option<&str>, untracked: bool, keep_index: bool) -> StashSaveOptions {
        StashSaveOptions {
            message: message.map(str::to_string),
            include_untracked: untracked,
            keep_index,
        }
    }

    #[test]
    fn push_args_put_every_path_after_the_separator() {
        let paths = [PathBuf::from("-f"), PathBuf::from("src/a.rs")];
        let refs: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
        let args = stash_push_args(&opts(Some("wip"), false, false), &refs).unwrap();
        let sep = args.iter().position(|a| a == "--").expect("separator");
        assert_eq!(&args[..2], &["stash".to_string(), "push".to_string()]);
        assert_eq!(&args[sep + 1..], &["-f".to_string(), "src/a.rs".to_string()]);
        // The message is a VALUE of -m, so it precedes the separator.
        assert!(args[..sep].contains(&"wip".to_string()));
    }

    #[test]
    fn push_args_carry_the_untracked_and_keep_index_flags() {
        let paths = [PathBuf::from("new.txt")];
        let refs: Vec<&Path> = paths.iter().map(|p| p.as_path()).collect();
        let args = stash_push_args(&opts(None, true, true), &refs).unwrap();
        assert!(args.contains(&"--include-untracked".to_string()));
        assert!(args.contains(&"--keep-index".to_string()));
        // No message given, so no -m at all rather than an empty one.
        assert!(!args.contains(&"-m".to_string()));
    }

    #[test]
    fn push_args_refuse_an_empty_pathspec() {
        // `git stash push --` with nothing after it stashes the WHOLE worktree.
        assert!(stash_push_args(&opts(Some("x"), false, false), &[]).is_err());
    }

    #[test]
    fn store_args_end_options_before_the_oid() {
        let args = stash_store_args("--not-a-flag", "a1b2c3d");
        assert_eq!(
            args,
            vec!["stash", "store", "-m", "--not-a-flag", "--", "a1b2c3d"]
        );
    }

    fn entries(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(o, m)| (o.to_string(), m.to_string()))
            .collect()
    }

    #[test]
    fn a_landed_store_clears_the_gate() {
        let before = entries(&[("aaa", "top"), ("bbb", "middle"), ("ccc", "bottom")]);
        let after = entries(&[
            ("new", "renamed"),
            ("aaa", "top"),
            ("bbb", "middle"),
            ("ccc", "bottom"),
        ]);
        assert!(rename_store_landed(&before, &after, 1, "new", "renamed"));
    }

    #[test]
    fn an_elided_store_does_not_clear_the_gate() {
        // THE trap: `git stash store` exits 0 having written nothing, so the
        // list is unchanged. Dropping here would delete the entry outright.
        let before = entries(&[("aaa", "top"), ("bbb", "bottom")]);
        let after = before.clone();
        assert!(!rename_store_landed(&before, &after, 0, "aaa", "renamed"));
    }

    #[test]
    fn a_displaced_original_does_not_clear_the_gate() {
        // The list grew and the new entry is on top, but something else moved
        // underneath — so `index + 1` is no longer the entry we meant to retire.
        let before = entries(&[("aaa", "top"), ("bbb", "bottom")]);
        let after = entries(&[("new", "renamed"), ("zzz", "someone else"), ("aaa", "top")]);
        assert!(!rename_store_landed(&before, &after, 0, "new", "renamed"));
    }

    #[test]
    fn a_store_that_landed_under_a_different_message_does_not_clear_the_gate() {
        let before = entries(&[("aaa", "top")]);
        let after = entries(&[("new", "something else"), ("aaa", "top")]);
        assert!(!rename_store_landed(&before, &after, 0, "new", "renamed"));
    }

    #[test]
    fn an_out_of_range_index_does_not_clear_the_gate() {
        let before = entries(&[("aaa", "top")]);
        let after = entries(&[("new", "renamed"), ("aaa", "top")]);
        assert!(!rename_store_landed(&before, &after, 7, "new", "renamed"));
    }

    #[test]
    fn a_message_with_a_line_break_is_refused() {
        assert!(validate_message("one line").is_ok());
        assert!(validate_message("two\nlines").is_err());
        assert!(validate_message("carriage\rreturn").is_err());
    }
}
