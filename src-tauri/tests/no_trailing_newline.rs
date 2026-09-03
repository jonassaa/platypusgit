//! A file whose last line has no trailing newline, staged/unstaged/discarded by
//! hunk or by line.
//!
//! `patch_text_for_lines` synthesizes patch text that is piped to a real
//! `git apply`, and git spells "this side's last line has no newline" with a
//! `\ No newline at end of file` marker line. git2 hands that marker back as a
//! line of its own — origin `=` (CONTEXT_EOFNL), `>` (ADD_EOFNL) or `<`
//! (DEL_EOFNL) — after the record whose bytes lack the `\n`.
//!
//! Every assertion here is on real BYTES: the index blob against the worktree
//! file, or the worktree file itself. A patch that fabricates the newline can
//! still make `git apply --cached` exit 0 — and then the file the user just
//! staged reappears as modified, because the blob in the index is one byte
//! longer than the file on disk.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::git::types::{DiffKind, DiffLineKind};
use platypusgit_lib::git::GitBackend;

use support::{fs::write_file, TempRepo};

// ─── helpers ─────────────────────────────────────────────────────────────────

/// The staged (index) blob for `path`, as raw bytes.
fn staged_bytes(tr: &TempRepo, path: &str) -> Vec<u8> {
    let repo = git2::Repository::open(tr.path()).unwrap();
    let index = repo.index().unwrap();
    let entry = index
        .get_path(Path::new(path), 0)
        .expect("path is in the index");
    let blob = repo.find_blob(entry.id).unwrap();
    blob.content().to_vec()
}

/// The worktree file's raw bytes.
fn worktree_bytes(tr: &TempRepo, path: &str) -> Vec<u8> {
    std::fs::read(tr.path().join(path)).expect("read worktree file")
}

/// Commit `body` at `path` verbatim — `TempRepo::with_initial_commit` is fixed
/// to README.md, and these fixtures need the committed side to keep (or lack) a
/// trailing newline exactly as written.
fn commit_verbatim(tr: &TempRepo, path: &str, body: &str) {
    write_file(tr.path(), path, body);
    let mut index = tr.repo.index().unwrap();
    index.add_path(Path::new(path)).unwrap();
    index.write().unwrap();
    let tree_oid = index.write_tree().unwrap();
    let tree = tr.repo.find_tree(tree_oid).unwrap();
    let sig = git2::Signature::now("Test User", "test@example.com").unwrap();
    let parent = tr.repo.head().ok().and_then(|h| h.peel_to_commit().ok());
    let parents: Vec<&git2::Commit> = parent.as_ref().map(|c| vec![c]).unwrap_or_default();
    tr.repo
        .commit(Some("HEAD"), &sig, &sig, "fixture", &tree, &parents)
        .unwrap();
}

/// After staging, the index blob and the worktree file must be byte-identical —
/// which is the same thing as "the row leaves the unstaged list".
fn assert_index_matches_worktree(
    tr: &TempRepo,
    backend: &platypusgit_lib::git::libgit2::Libgit2Backend,
    handle: &platypusgit_lib::git::types::RepoHandle,
    path: &str,
) {
    let staged = staged_bytes(tr, path);
    let wt = worktree_bytes(tr, path);
    assert_eq!(
        String::from_utf8_lossy(&staged),
        String::from_utf8_lossy(&wt),
        "index blob and worktree must be byte-identical after staging \
         (staged {} bytes, worktree {} bytes)",
        staged.len(),
        wt.len()
    );

    let wt_diff = backend
        .diff(&handle.id, &PathBuf::from(path), DiffKind::WorktreeToIndex, 3, false)
        .expect("worktree diff");
    assert!(
        wt_diff.hunks.is_empty(),
        "the file must not reappear as modified right after being staged: {:?}",
        wt_diff.hunks
    );
}

// ─── the untracked-creation route through stage_hunk ─────────────────────────

#[test]
fn stage_hunk_on_an_untracked_file_with_no_trailing_newline_stages_the_exact_bytes() {
    // stage_hunk's creation route builds patch text by hand (libgit2's
    // ApplyLocation::Index cannot take a file the index has never heard of) and
    // pipes it to `git apply --cached`. A fabricated trailing newline puts a
    // blob in the index that is one byte longer than the file on disk.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "base.txt", "base\n");
    write_file(tr.path(), "new.txt", "a\nb\nc");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_hunk(&handle.id, Path::new("new.txt"), 0, 3)
        .expect("stage_hunk on an untracked file with no trailing newline");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "new.txt")).unwrap(),
        "a\nb\nc",
        "the staged blob must not gain a trailing newline the file never had"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "new.txt");
}

#[test]
fn stage_lines_on_an_untracked_file_keeps_the_last_selected_line_unterminated() {
    // Selecting a prefix of the lines: the last line that reaches the index is
    // "b\n", which DOES end in a newline — so no marker belongs on this patch at
    // all, and the blob keeps its newline.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "base.txt", "base\n");
    write_file(tr.path(), "new.txt", "a\nb\nc");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("new.txt"), 0, &[0, 1], 3)
        .expect("stage_lines on an untracked file");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "new.txt")).unwrap(),
        "a\nb\n"
    );
}

#[test]
fn stage_lines_on_an_untracked_file_with_every_index_stages_the_exact_bytes() {
    // Selecting every changed line of a creation hunk must equal staging the
    // whole file — including the last line's missing newline.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "base.txt", "base\n");
    write_file(tr.path(), "new.txt", "a\nb\nc");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("new.txt"), 0, &[0, 1, 2], 3)
        .expect("stage_lines with every index");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "new.txt")).unwrap(),
        "a\nb\nc"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "new.txt");
}

// ─── tracked files: one test per EOFNL origin ────────────────────────────────

#[test]
fn stage_lines_adding_an_unterminated_last_line() {
    // git2 origin `<` (DEL_EOFNL): the marker follows the `+` line, because the
    // NEW side is the one that ends without a newline.
    //   old: "one\ntwo\nthree\n"      new: "one\ntwo\nthree\nfour"
    //   ...  -three / \ No newline?  no: three keeps its newline, four does not.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree\n");
    write_file(tr.path(), "f.txt", "one\ntwo\nthree\nfour");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0], 3)
        .expect("stage_lines on the unterminated added line");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nthree\nfour",
        "the added last line must reach the index without a newline"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}

#[test]
fn stage_lines_deleting_an_unterminated_last_line() {
    // git2 origin `>` (ADD_EOFNL): the marker follows the `-` line, because the
    // OLD side is the one that ends without a newline. Fabricating the newline
    // there makes `git apply --cached` reject the patch outright — the index has
    // no "last\n" to remove.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nlast");
    write_file(tr.path(), "f.txt", "one\ntwo\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0], 3)
        .expect("stage_lines on the unterminated deleted line");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\n"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}

#[test]
fn stage_lines_with_an_unterminated_context_line() {
    // git2 origin `=` (CONTEXT_EOFNL): BOTH sides end without a newline, so the
    // marker follows a context line. The change is above it, so the marker is
    // the only thing that tells `git apply` the file it is patching does not end
    // in a newline.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree");
    write_file(tr.path(), "f.txt", "one\nTWO\nthree");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0, 1], 3)
        .expect("stage_lines under an unterminated context line");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\nTWO\nthree"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}

#[test]
fn stage_lines_when_both_sides_end_unterminated_on_the_changed_line() {
    // Both `>` and `<` in one hunk: the last line changes and neither side ends
    // in a newline, so git emits a marker after the `-` AND after the `+`.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree");
    write_file(tr.path(), "f.txt", "one\ntwo\nTHREE");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0, 1], 3)
        .expect("stage_lines across both markers");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nTHREE"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}

#[test]
fn stage_hunk_on_a_tracked_file_that_ends_without_a_newline() {
    // The whole-hunk route is `patch_text_for_lines` with everything selected,
    // so it shares the defect and has to share the fix.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree");
    write_file(tr.path(), "f.txt", "one\ntwo\nTHREE");
    let (backend, handle) = tr.open_with_backend();

    // Tracked + non-creating, so stage_hunk applies via libgit2 rather than the
    // synthesized patch. Unstaging it again is what runs the synthesizer.
    backend
        .stage_hunk(&handle.id, Path::new("f.txt"), 0, 3)
        .expect("stage_hunk");
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");

    backend
        .unstage_hunk(&handle.id, Path::new("f.txt"), 0, 3)
        .expect("unstage_hunk on a file with no trailing newline");
    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nthree",
        "unstaging must put the committed bytes back, newline-less last line included"
    );
}

#[test]
fn discard_hunk_on_a_file_that_ends_without_a_newline() {
    // `patch_text_for_hunk` is `patch_text_for_lines` with everything selected,
    // so whole-hunk discard runs the same synthesizer — and this one rewrites the
    // user's worktree, so a rejected patch is a Discard button that does nothing.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree");
    write_file(tr.path(), "f.txt", "one\ntwo\nTHREE");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard_hunk(&handle.id, Path::new("f.txt"), 0, 3)
        .expect("discard_hunk on a file with no trailing newline");

    assert_eq!(
        String::from_utf8(worktree_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nthree",
        "the committed bytes must come back exactly, newline-less last line included"
    );
}

// ─── unstage_lines / discard_lines ───────────────────────────────────────────
//
// These run the synthesizer in `Reverse`, where the two markers swap roles: the
// patch's NEW side is the file being changed, so a `<` on a `+` line describes
// what is on disk and a `>` on a `-` line describes what it is going back to.
//
// The fixture keeps the newline-less change in a hunk of its OWN, away from the
// edit further up. `patch_text_for_lines` emits in hunk order, and a hunk that
// mixes a selected `-` with an unselected `+` re-inserts the removed line above
// the kept one — a real property of the transformation, unrelated to newlines,
// which would otherwise be what these assertions were measuring.

/// 20 numbered lines, the last of them with no trailing newline. `last` is the
/// text of line 20 and `third` the text of line 3, so a caller can move exactly
/// those two and get two hunks at context 3.
fn twenty_lines(third: &str, last: &str) -> String {
    let mut s = String::new();
    for i in 1..=19 {
        if i == 3 {
            s.push_str(third);
            s.push('\n');
        } else {
            s.push_str(&format!("line {i}\n"));
        }
    }
    s.push_str(last);
    s
}

#[test]
fn unstage_lines_on_a_file_that_ends_without_a_newline() {
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", &twenty_lines("line 3", "line 20"));
    write_file(tr.path(), "f.txt", &twenty_lines("LINE 3", "LINE 20"));
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage(&handle.id, &[PathBuf::from("f.txt")])
        .expect("stage the whole file");
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");

    // Hunk 1 is the last-line rewrite: -line 20 (0) / +LINE 20 (1), and it is the
    // one carrying both `\ No newline at end of file` markers.
    backend
        .unstage_lines(&handle.id, &PathBuf::from("f.txt"), 1, &[0, 1], 3)
        .expect("unstage_lines across the newline markers");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        twenty_lines("LINE 3", "line 20"),
        "only the last line should have been unstaged, and it keeps no newline"
    );
}

#[test]
fn discard_lines_on_a_file_that_ends_without_a_newline() {
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", &twenty_lines("line 3", "line 20"));
    write_file(tr.path(), "f.txt", &twenty_lines("LINE 3", "LINE 20"));
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard_lines(&handle.id, &PathBuf::from("f.txt"), 1, &[0, 1], 3)
        .expect("discard_lines across the newline markers");

    assert_eq!(
        String::from_utf8(worktree_bytes(&tr, "f.txt")).unwrap(),
        twenty_lines("LINE 3", "line 20"),
        "the discarded last line must come back without a trailing newline"
    );
}

#[test]
fn discarding_only_the_removal_moves_the_marker_to_the_line_that_stays() {
    // Both sides end without a newline and the last line was rewritten:
    //   -three (no newline) / +THREE (no newline).
    // Discarding ONLY the removal restores "three" while keeping "THREE", so the
    // file being written ends on "THREE" — and "three" is no longer last, so it
    // needs a real newline. Get that backwards and the marker claims the file
    // ends at "three"; `git apply` then rejects the patch or writes the wrong
    // bytes. This is the case the three EOFNL origins exist to distinguish.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree");
    write_file(tr.path(), "f.txt", "one\ntwo\nTHREE");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0], 3)
        .expect("discard only the removal");

    assert_eq!(
        String::from_utf8(worktree_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nthree\nTHREE",
        "the restored line gains the newline it now needs; only the last line lacks one"
    );
}

#[test]
fn discard_lines_restoring_a_deleted_unterminated_last_line() {
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nlast");
    write_file(tr.path(), "f.txt", "one\ntwo\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .discard_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0], 3)
        .expect("discard_lines restoring the unterminated line");

    assert_eq!(
        String::from_utf8(worktree_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nlast",
        "the restored file must end exactly as it was committed"
    );
}

// ─── partial selections, where the marker's SIDE is what changes ─────────────

#[test]
fn staging_only_the_added_line_keeps_the_old_unterminated_line_intact() {
    // old: "one\ntwo\nthree" (no newline)   new: "one\ntwo\nthree\nfour" (no newline)
    // Appending to a file that did not end in a newline makes git rewrite the
    // previous last line: -three(no newline) +three +four(no newline).
    // Staging ONLY `+four` turns the unselected `-three` into a line that is now
    // last on the OLD side but no longer last on the NEW side — the one shape a
    // plain context line cannot express.
    let tr = TempRepo::fresh();
    commit_verbatim(&tr, "f.txt", "one\ntwo\nthree");
    write_file(tr.path(), "f.txt", "one\ntwo\nthree\nfour");
    let (backend, handle) = tr.open_with_backend();

    // Sanity-check the index space this test depends on.
    let diff = backend
        .diff(&handle.id, &PathBuf::from("f.txt"), DiffKind::WorktreeToIndex, 3, false)
        .expect("diff");
    let changed: Vec<String> = diff.hunks[0]
        .lines
        .iter()
        .filter_map(|l| match l.kind {
            DiffLineKind::Addition => Some(format!("+{}", l.content.trim_end_matches('\n'))),
            DiffLineKind::Deletion => Some(format!("-{}", l.content.trim_end_matches('\n'))),
            _ => None,
        })
        .collect();
    assert_eq!(changed, vec!["-three", "+three", "+four"], "fixture shape");

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[2], 3)
        .expect("stage only the appended line");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\ntwo\nthree\nfour",
        "the kept line needs its newline back, and only the new last line lacks one"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}

// ─── CRLF ────────────────────────────────────────────────────────────────────

#[test]
fn crlf_line_endings_survive_line_staging() {
    // A CRLF record already ends in '\n', so no marker is involved — pin it, so
    // a fix that reaches for `trim_end()` instead of `ends_with('\n')` cannot
    // quietly eat the '\r'.
    let tr = TempRepo::fresh();
    tr.repo.config().unwrap().set_bool("core.autocrlf", false).unwrap();
    commit_verbatim(&tr, "f.txt", "one\r\ntwo\r\nthree\r\n");
    write_file(tr.path(), "f.txt", "one\r\nTWO\r\nthree\r\n");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0, 1], 3)
        .expect("stage_lines on a CRLF file");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\r\nTWO\r\nthree\r\n"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}

#[test]
fn crlf_without_a_final_newline_survives_line_staging() {
    // Both traps at once: CRLF endings AND a last line with no terminator, so
    // the final record is "three" with neither '\r' nor '\n'.
    let tr = TempRepo::fresh();
    tr.repo.config().unwrap().set_bool("core.autocrlf", false).unwrap();
    commit_verbatim(&tr, "f.txt", "one\r\ntwo\r\nthree");
    write_file(tr.path(), "f.txt", "one\r\nTWO\r\nthree");
    let (backend, handle) = tr.open_with_backend();

    backend
        .stage_lines(&handle.id, &PathBuf::from("f.txt"), 0, &[0, 1], 3)
        .expect("stage_lines on a CRLF file with no trailing newline");

    assert_eq!(
        String::from_utf8(staged_bytes(&tr, "f.txt")).unwrap(),
        "one\r\nTWO\r\nthree"
    );
    assert_index_matches_worktree(&tr, &backend, &handle, "f.txt");
}
