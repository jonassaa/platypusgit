//! How much of a repository is actually here — the PURE half (#255).
//!
//! `--depth` and `--single-branch` both leave a durable trace, and neither one
//! is an error state: a shallow repository works, it just cannot answer
//! questions about commits that were never fetched. Deciding *whether* it is in
//! that state is two small parsing jobs, and both are here so they can be tested
//! without a repository at all — the `reveal.rs` / `git/image.rs` model.
//!
//! The IO half is [`crate::git::libgit2::Libgit2Backend::shallow_info`]:
//! libgit2's `is_shallow()` for the boolean, one file read for the count, and
//! the remote list for the refspecs.

/// How many commits history stops at, given the contents of `.git/shallow`.
///
/// The file is one oid per line. Blank lines are not written by git, but a
/// truncated write or a hand-edited file can produce them and a count that
/// includes them would overstate the boundary — so they are skipped rather than
/// trusted.
pub fn count_shallow_roots(text: &str) -> usize {
    text.lines().filter(|l| !l.trim().is_empty()).count()
}

/// True when the SOURCE side of a fetch refspec names exactly one ref.
///
/// A default clone writes `+refs/heads/*:refs/remotes/origin/*`; a
/// `--single-branch` clone writes `+refs/heads/main:refs/remotes/origin/main`.
/// The difference that matters is the glob, and it matters on the source side:
/// the destination is a local naming choice, and a refspec with a globbed source
/// fetches every matching branch however its destination is spelled.
///
/// A leading `+` (force) is part of neither side and is stripped first. A
/// refspec with no `:` at all is a source with an implicit destination
/// (`git fetch <remote> <src>` shape), so the whole string is the source.
pub fn refspec_is_pinned(refspec: &str) -> bool {
    let spec = refspec.strip_prefix('+').unwrap_or(refspec);
    let src = spec.split_once(':').map(|(s, _)| s).unwrap_or(spec);
    !src.is_empty() && !src.contains('*')
}

/// True when every remote that fetches anything fetches exactly one branch.
///
/// Takes one `Vec` of refspecs per remote. Three cases are deliberately NOT
/// "single branch":
///
/// - no remotes at all (a local-only repository has no branches missing),
/// - a remote with no fetch refspecs (it is configured to fetch nothing, which
///   is a different oddity and not one this notice explains),
/// - any remote with a globbing refspec — one remote fetching everything means
///   the branches are here, whatever the others do.
pub fn single_branch_from_refspecs(per_remote: &[Vec<String>]) -> bool {
    let mut saw_fetching_remote = false;
    for specs in per_remote {
        if specs.is_empty() {
            continue;
        }
        saw_fetching_remote = true;
        if !specs.iter().all(|s| refspec_is_pinned(s)) {
            return false;
        }
    }
    saw_fetching_remote
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_one_boundary_commit_per_line() {
        let text = "0e5b1e6f6c1f0e0e0e0e0e0e0e0e0e0e0e0e0e0e\n\
                    1111111111111111111111111111111111111111\n";
        assert_eq!(count_shallow_roots(text), 2);
    }

    #[test]
    fn ignores_blank_lines_and_a_missing_final_newline() {
        assert_eq!(count_shallow_roots(""), 0);
        assert_eq!(count_shallow_roots("\n\n"), 0);
        assert_eq!(count_shallow_roots("abc"), 1);
        assert_eq!(count_shallow_roots("abc\n\ndef\n"), 2);
    }

    #[test]
    fn a_globbed_source_is_not_pinned() {
        assert!(!refspec_is_pinned("+refs/heads/*:refs/remotes/origin/*"));
        assert!(!refspec_is_pinned("refs/heads/*:refs/remotes/origin/*"));
        // The glob is what decides, on the SOURCE side — a globbed source with
        // a literal destination still fetches every branch.
        assert!(!refspec_is_pinned("+refs/heads/*:refs/remotes/origin/main"));
    }

    #[test]
    fn a_literal_source_is_pinned_however_it_is_spelled() {
        assert!(refspec_is_pinned(
            "+refs/heads/main:refs/remotes/origin/main"
        ));
        assert!(refspec_is_pinned("refs/heads/main:refs/remotes/origin/main"));
        // No `:` — the whole string is the source.
        assert!(refspec_is_pinned("refs/heads/main"));
        // A globbed DESTINATION is a local naming choice and changes nothing
        // about how many branches arrive.
        assert!(refspec_is_pinned("+refs/heads/main:refs/remotes/origin/*x"));
    }

    #[test]
    fn an_empty_source_is_not_pinned() {
        // `:refs/heads/main` is a delete-refspec shape; it names no source and
        // must not be read as "one branch".
        assert!(!refspec_is_pinned(":refs/heads/main"));
        assert!(!refspec_is_pinned(""));
    }

    #[test]
    fn one_remote_fetching_one_branch_is_single_branch() {
        let remotes = vec![vec!["+refs/heads/main:refs/remotes/origin/main".to_string()]];
        assert!(single_branch_from_refspecs(&remotes));
    }

    #[test]
    fn the_default_clone_refspec_is_not_single_branch() {
        let remotes = vec![vec!["+refs/heads/*:refs/remotes/origin/*".to_string()]];
        assert!(!single_branch_from_refspecs(&remotes));
    }

    #[test]
    fn one_remote_fetching_everything_settles_it_for_all_of_them() {
        let remotes = vec![
            vec!["+refs/heads/main:refs/remotes/origin/main".to_string()],
            vec!["+refs/heads/*:refs/remotes/upstream/*".to_string()],
        ];
        assert!(!single_branch_from_refspecs(&remotes));
    }

    #[test]
    fn a_repository_with_no_remotes_is_not_single_branch() {
        // Nothing is missing from a local-only repository, so there is nothing
        // to warn about.
        assert!(!single_branch_from_refspecs(&[]));
        assert!(!single_branch_from_refspecs(&[vec![]]));
    }
}
