//! `git difftool` — handing any diff to the user's own tool (#235).
//!
//! # Why we shell out rather than materialise the sides ourselves
//!
//! An external tool wants two real files on disk. For a commit or an index diff
//! neither side is a file: they are blobs in the object database. `git difftool`
//! already extracts both, names the temp files, honours `diff.guitool` /
//! `diff.tool` / `merge.tool` / `difftool.<tool>.cmd` / `difftool.<tool>.path`,
//! and cleans up afterwards. Writing our own copy of that would be a second,
//! worse version of something git ships — and it would drift the first time git
//! adds a tool.
//!
//! So this module is deliberately small: it decides WHICH TWO SIDES, and builds
//! the argv. Everything about which program runs stays git's.
//!
//! # What we do decide
//!
//! * `--no-prompt`, always. A GUI process has no terminal for git's
//!   `Launch 'vimdiff' [Y/n]?`, so the prompt is a hang with no window.
//! * `--gui` OR `--tool=<name>`, never both — git refuses the pair (`fatal:
//!   options '--gui' and '--tool' cannot be used together`), because they answer
//!   the same question. With no Settings override we pass `--gui`, which puts
//!   `diff.guitool` at the top of git's list and falls back to `diff.tool` when
//!   there is no guitool: a user who split the two (Kaleidoscope for graphical
//!   contexts, `vimdiff` in a terminal) gets the graphical one from a graphical
//!   app, and nobody else notices. With an override we pass `--tool=<name>`,
//!   which has already made that choice.
//!
//! Nothing here decides what to do when no tool resolves: git's own stderr
//! already says `This message is displayed because 'diff.tool' is not
//! configured`, in the user's locale, and pattern-matching that sentence to mint
//! an error variant would only be able to go out of date.
//!
//! # Nothing a caller typed reaches argv
//!
//! Two kinds of caller-supplied text arrive here, and each is neutralised by
//! construction rather than by inspection:
//!
//! * **Revisions** are RESOLVED to hex oids ([`resolve_commit`]). They have to
//!   sit ahead of `--`, where the separator cannot protect them, so a
//!   `--output=…` in a revision slot would be read as an option — resolving
//!   makes that unrepresentable.
//! * **Pathspecs** go after `--`, are checked against the worktree by the caller
//!   (`opener::safe_workdir_path`), and are paired with
//!   `GIT_LITERAL_PATHSPECS=1`.
//!
//! The tool name is the third, and [`normalize_tool`] refuses anything that is
//! not one; it is emitted as a single `--tool=<name>` token besides.

use std::path::PathBuf;

use git2::Repository;

use crate::error::{AppError, AppResult};
use crate::git::types::DiffToolTarget;

/// What `git difftool` needs once the target has been resolved against the
/// repository: whether to look at the index, and the revisions to pass through
/// to `git diff`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffSpec {
    /// `--cached` — compare the index rather than the working tree.
    pub cached: bool,
    /// Zero, one or two revisions, in git's order: old, then new.
    pub revs: Vec<String>,
}

/// Everything the command needs to spawn, decided under one repository lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffToolPlan {
    /// The worktree `git -C` runs in — also what the pathspecs are relative to.
    pub workdir: PathBuf,
    /// Full argv after `git`, including `difftool` itself.
    pub args: Vec<String>,
    /// The override that was applied, or `None` when git decides. Logged, so a
    /// report says which of the two paths was taken.
    pub tool: Option<String>,
}

/// The app-settings override, cleaned up, or `None` for "let git decide".
///
/// PURE. A git tool NAME is a config-key segment — `diff.tool=meld` selects
/// `difftool.meld.cmd` — so it can never legitimately contain whitespace or a
/// control character. The command line belongs in `difftool.<tool>.cmd`, where
/// git wants it, and a field that silently accepted one would look like it
/// worked and then fail inside git with a message about a tool nobody named.
///
/// Empty (the default) is not an error: it is the zero-config case.
pub fn normalize_tool(raw: Option<&str>) -> AppResult<Option<String>> {
    let Some(trimmed) = raw.map(str::trim).filter(|t| !t.is_empty()) else {
        return Ok(None);
    };
    if trimmed
        .chars()
        .any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(AppError::InvalidArgument(format!(
            "not a diff tool name: {trimmed:?}. Name a tool git knows \
             (`meld`, `bc`, `vimdiff`) or one you defined with \
             difftool.<tool>.cmd — the command line belongs in that config key, \
             not here."
        )));
    }
    Ok(Some(trimmed.to_string()))
}

/// The empty tree, as this repository spells it.
///
/// Written rather than hard-coded: `4b825dc642cb6eb9a060e54bf8d69288fbee4904` is
/// the SHA-1 answer only, and a SHA-256 repository has a different one. The
/// object itself is a zero-byte tree — git writes it on any commit of an empty
/// directory — so this is idempotent and costs nothing.
fn empty_tree(repo: &Repository) -> AppResult<String> {
    Ok(repo.treebuilder(None)?.write()?.to_string())
}

/// One revision, as a commit this repository actually has.
///
/// **Every** revision that reaches argv goes through here, and that is the whole
/// point of it existing rather than each arm calling `revparse_single` itself.
///
/// A revspec crosses IPC as a caller-supplied string, and `git difftool` needs
/// its revisions **before** `--` — so the separator that protects the pathspecs
/// cannot protect these. A value like `--output=/tmp/x` would sit in an option
/// position and be read as one. Resolving rather than validating means what
/// lands in argv is a **hex oid by construction**, which is the same guarantee
/// the app makes everywhere else user text meets git's argv
/// (`git/tag.rs::validate_ref_component`, `forge/mod.rs::validate_ref_name`,
/// `ssh.rs`) — and a stronger one, because it cannot be satisfied by a string
/// that merely looks safe.
///
/// It is also the better error. A ref that does not exist fails HERE as
/// `InvalidRef` carrying git's own message, instead of after the spawn as
/// whatever `git difftool` chooses to print.
///
/// Peeled to a commit, matching what "diff these two revisions" means
/// everywhere else in the app; an annotated tag peels through, and a revspec
/// naming a tree or a blob is refused rather than silently diffing something
/// else.
fn resolve_commit<'r>(repo: &'r Repository, rev: &str) -> AppResult<git2::Commit<'r>> {
    let object = repo
        .revparse_single(rev)
        .map_err(|e| AppError::InvalidRef(format!("{rev}: {}", e.message())))?;
    object
        .peel_to_commit()
        .map_err(|e| AppError::InvalidRef(format!("{rev}: {}", e.message())))
}

/// Resolve a target against the repository.
///
/// The only impure function here, and it does two jobs: it turns every revision
/// into a real oid (see [`resolve_commit`] — nothing a caller typed reaches
/// argv), and it resolves a commit's PARENT, because neither `<oid>^` nor
/// `<oid>^!` can be used for that. See [`DiffToolTarget`].
pub fn spec_for(repo: &Repository, target: &DiffToolTarget) -> AppResult<DiffSpec> {
    match target {
        DiffToolTarget::Worktree => Ok(DiffSpec {
            cached: false,
            revs: Vec::new(),
        }),
        DiffToolTarget::Staged => Ok(DiffSpec {
            cached: true,
            revs: Vec::new(),
        }),
        DiffToolTarget::Commit { oid } => {
            let commit = resolve_commit(repo, oid)?;
            let old = match commit.parent_id(0) {
                Ok(parent) => parent.to_string(),
                // A root commit. Its "old side" is the empty tree, which is the
                // pair `git show` uses and the only one that does not quietly
                // become a diff against the working tree.
                Err(_) => empty_tree(repo)?,
            };
            Ok(DiffSpec {
                cached: false,
                revs: vec![old, commit.id().to_string()],
            })
        }
        DiffToolTarget::Range { from, to } => Ok(DiffSpec {
            cached: false,
            revs: vec![
                resolve_commit(repo, from)?.id().to_string(),
                resolve_commit(repo, to)?.id().to_string(),
            ],
        }),
        DiffToolTarget::RevToWorktree { rev } => Ok(DiffSpec {
            cached: false,
            revs: vec![resolve_commit(repo, rev)?.id().to_string()],
        }),
    }
}

/// The argv after `git`. PURE.
///
/// Order is not stylistic: `git difftool` parses its own options first and hands
/// the rest to `git diff`, so options precede revisions and `--` precedes the
/// pathspecs. The separator is mandatory for the same reason it is in
/// `stash.rs` — a file honestly named `-f` must not be read as a flag — and the
/// caller pairs it with `GIT_LITERAL_PATHSPECS=1` so a file named `a[b].c`
/// selects itself.
///
/// `paths` is a LIST because a rename has two of them: scoped to the new path
/// alone, git would report a renamed file as a whole file added, which is the
/// same dead end this feature exists to remove.
pub fn difftool_args(spec: &DiffSpec, tool: Option<&str>, paths: &[String]) -> Vec<String> {
    let mut args = vec!["difftool".to_string(), "--no-prompt".to_string()];
    if spec.cached {
        args.push("--cached".to_string());
    }
    match tool {
        // One argv token, so a name that begins with `-` cannot be read as an
        // option even before `normalize_tool` has refused it.
        //
        // And NO `--gui` beside it: git refuses the pair outright — `fatal:
        // options '--gui' and '--tool' cannot be used together`. That is not a
        // limitation to work around, it is git saying the two answer the same
        // question. `--gui` means "pick from the guitool list"; naming a tool
        // has already picked.
        Some(tool) => args.push(format!("--tool={tool}")),
        None => args.push("--gui".to_string()),
    }
    args.extend(spec.revs.iter().cloned());
    args.push("--".to_string());
    args.extend(paths.iter().cloned());
    args
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(cached: bool, revs: &[&str]) -> DiffSpec {
        DiffSpec {
            cached,
            revs: revs.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn paths(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_worktree_form_passes_no_revisions() {
        assert_eq!(
            difftool_args(&spec(false, &[]), None, &paths(&["src/a.rs"])),
            vec!["difftool", "--no-prompt", "--gui", "--", "src/a.rs"]
        );
    }

    #[test]
    fn the_staged_form_is_cached_and_still_revisionless() {
        assert_eq!(
            difftool_args(&spec(true, &[]), None, &paths(&["src/a.rs"])),
            vec!["difftool", "--no-prompt", "--cached", "--gui", "--", "src/a.rs"]
        );
    }

    #[test]
    fn a_range_keeps_gits_own_old_then_new_order() {
        assert_eq!(
            difftool_args(&spec(false, &["main", "feature"]), None, &paths(&["a"])),
            vec!["difftool", "--no-prompt", "--gui", "main", "feature", "--", "a"]
        );
    }

    #[test]
    fn the_tool_override_lands_before_the_revisions() {
        // git difftool parses its own options first; a `--tool` after a revision
        // is a pathspec-looking argument to `git diff`.
        assert_eq!(
            difftool_args(&spec(false, &["a1", "b2"]), Some("meld"), &paths(&["x"])),
            vec!["difftool", "--no-prompt", "--tool=meld", "a1", "b2", "--", "x"]
        );
    }

    #[test]
    fn gui_and_tool_are_never_passed_together() {
        // git REFUSES the pair — `fatal: options '--gui' and '--tool' cannot be
        // used together` — so this is the difference between the feature working
        // and every override failing. Found by the end-to-end test, pinned here.
        for spec in [spec(false, &[]), spec(true, &[]), spec(false, &["a", "b"])] {
            let with_tool = difftool_args(&spec, Some("bc"), &paths(&["p"]));
            assert!(
                !with_tool.contains(&"--gui".to_string()),
                "{with_tool:?}"
            );
            let without = difftool_args(&spec, None, &paths(&["p"]));
            assert!(without.contains(&"--gui".to_string()), "{without:?}");
            assert!(
                !without.iter().any(|a| a.starts_with("--tool")),
                "{without:?}"
            );
        }
    }

    #[test]
    fn a_rename_passes_both_paths() {
        let args = difftool_args(&spec(false, &["a1", "b2"]), None, &paths(&["old", "new"]));
        let sep = args.iter().position(|a| a == "--").expect("separator");
        assert_eq!(&args[sep + 1..], ["old", "new"]);
    }

    #[test]
    fn every_path_lands_after_the_separator() {
        // The one property that must hold for every shape: a file named `-f` is
        // a file. Asserted over the whole matrix rather than per case, because a
        // new variant would otherwise be the one that forgot.
        for spec in [
            spec(false, &[]),
            spec(true, &[]),
            spec(false, &["r"]),
            spec(false, &["a", "b"]),
        ] {
            for tool in [None, Some("bc")] {
                let args = difftool_args(&spec, tool, &paths(&["-f", "--cached"]));
                let sep = args.iter().position(|a| a == "--").expect("separator");
                assert_eq!(
                    &args[sep + 1..],
                    ["-f", "--cached"],
                    "spec {spec:?} tool {tool:?}"
                );
                assert!(
                    !args[..sep].contains(&"-f".to_string()),
                    "a pathspec leaked into the option run: {args:?}"
                );
            }
        }
    }

    #[test]
    fn the_prompt_is_off_in_every_shape() {
        // git's prompt is a hang with no window in a GUI process, so this is not
        // a preference — it is the flag that makes the feature work at all.
        for spec in [spec(false, &[]), spec(true, &[]), spec(false, &["a", "b"])] {
            let args = difftool_args(&spec, None, &paths(&["p"]));
            assert!(args.contains(&"--no-prompt".to_string()), "{args:?}");
        }
    }

    #[test]
    fn an_absent_or_blank_override_means_git_decides() {
        assert_eq!(normalize_tool(None).unwrap(), None);
        assert_eq!(normalize_tool(Some("")).unwrap(), None);
        assert_eq!(normalize_tool(Some("   ")).unwrap(), None);
    }

    #[test]
    fn a_tool_name_is_trimmed_not_rejected_for_stray_spacing() {
        assert_eq!(normalize_tool(Some("  meld  ")).unwrap().as_deref(), Some("meld"));
    }

    #[test]
    fn a_command_line_is_refused_rather_than_passed_as_a_tool_name() {
        // The trap this exists for: someone types `bcompare "$LOCAL" "$REMOTE"`
        // into the Settings field. git would look for a tool by that whole name
        // and fail with a message naming a tool nobody configured.
        let err = normalize_tool(Some("bcompare $LOCAL $REMOTE")).unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument(_)), "{err:?}");
    }

    #[test]
    fn a_control_character_is_refused() {
        assert!(normalize_tool(Some("meld\nrm -rf")).is_err());
    }
}
