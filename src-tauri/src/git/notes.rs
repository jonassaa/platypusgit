//! Reading `refs/notes/*` — the commit metadata the history never showed (#253).
//!
//! # Read-only, on purpose
//!
//! Writing a note is a different feature: it needs a ref to pick, a merge
//! strategy for the notes tree, and a push story of its own. Nothing here
//! mutates.
//!
//! # Which refs are shown, and why not `notes.displayRef`
//!
//! git decides what `git log` displays from `core.notesRef` plus the
//! (multi-valued, glob-capable) `notes.displayRef`. We deliberately do not
//! consult either: **every** `refs/notes/*` ref is read, and each note is
//! labelled with the ref it came from.
//!
//! The asymmetry decides it. Showing a note the display config would have
//! hidden costs a labelled extra block in a panel — the ref name is on screen,
//! so nothing is ambiguous. Hiding a note somebody deliberately attached, in a
//! GUI with no "show all notes" affordance, is a fact the user cannot discover
//! at all. A read-only viewer should err towards showing.
//!
//! # Cost
//!
//! Every function here is called for ONE commit — the one selected in the
//! detail panel — never during the log walk. See `GitBackend::commit_notes`.

use git2::{Oid, Repository};

use crate::error::AppResult;
use crate::git::types::CommitNote;

/// git's own default notes ref, and the one that sorts first.
pub const DEFAULT_NOTES_REF: &str = "refs/notes/commits";

const PREFIX: &str = "refs/notes/";

/// The part of a notes ref worth putting on a badge: `refs/notes/ci/results`
/// → `ci/results`. PURE.
pub fn label_for(ref_name: &str) -> &str {
    ref_name.strip_prefix(PREFIX).unwrap_or(ref_name)
}

/// Is this a notes ref with something after the prefix? PURE.
///
/// `refs/notes` itself is not one — a ref of that exact name would produce an
/// empty label and a note nobody can name.
pub fn is_notes_ref(ref_name: &str) -> bool {
    ref_name.len() > PREFIX.len() && ref_name.starts_with(PREFIX)
}

/// Default ref first, everything else alphabetical. PURE.
pub fn sort_refs(refs: &mut [String]) {
    refs.sort_by(|a, b| {
        (a != DEFAULT_NOTES_REF, a.as_str()).cmp(&(b != DEFAULT_NOTES_REF, b.as_str()))
    });
}

/// Every `refs/notes/*` in the repository, sorted by [`sort_refs`].
///
/// Broken individual refs are skipped rather than failing the walk: one
/// unreadable ref must not cost the user the notes on all the others.
pub fn notes_refs(repo: &Repository) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = repo
        .references()?
        .flatten()
        .filter_map(|r| r.name().ok().map(str::to_string))
        .filter(|name| is_notes_ref(name))
        .collect();
    sort_refs(&mut out);
    Ok(out)
}

/// Every note attached to `oid`, one per notes ref that has one.
///
/// **Absence is a state, not an error**, at all three levels: no notes ref in
/// the repository, no note for this commit on a ref that exists, and a note
/// whose message is blank. All three answer with an empty vec, because a
/// commit detail panel that raised a banner for "this commit has no notes"
/// would raise one for nearly every commit in nearly every repository.
pub fn read(repo: &Repository, oid: Oid) -> AppResult<Vec<CommitNote>> {
    let mut out = Vec::new();
    for ref_name in notes_refs(repo)? {
        // `find_note` answers NotFound for a commit this ref has no note for,
        // which is the overwhelmingly common case — not a failure.
        let Ok(note) = repo.find_note(Some(&ref_name), oid) else {
            continue;
        };
        let message = note.message().unwrap_or_default().trim_end().to_string();
        if message.is_empty() {
            continue;
        }
        out.push(CommitNote {
            label: label_for(&ref_name).to_string(),
            ref_name,
            message,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_strip_the_ref_prefix_and_keep_the_rest_of_the_path() {
        assert_eq!(label_for("refs/notes/commits"), "commits");
        assert_eq!(label_for("refs/notes/ci/results"), "ci/results");
        // Nothing else should ever reach here, but a label is better than a panic.
        assert_eq!(label_for("refs/heads/main"), "refs/heads/main");
    }

    #[test]
    fn only_refs_with_something_after_the_prefix_count() {
        assert!(is_notes_ref("refs/notes/commits"));
        assert!(!is_notes_ref("refs/notes/"));
        assert!(!is_notes_ref("refs/notesy/x"));
        assert!(!is_notes_ref("refs/heads/notes"));
    }

    #[test]
    fn the_default_ref_sorts_first_and_the_rest_alphabetically() {
        let mut refs = vec![
            "refs/notes/review".to_string(),
            "refs/notes/commits".to_string(),
            "refs/notes/ci/results".to_string(),
        ];
        sort_refs(&mut refs);
        assert_eq!(
            refs,
            vec![
                "refs/notes/commits",
                "refs/notes/ci/results",
                "refs/notes/review"
            ]
        );
    }
}
