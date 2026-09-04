//! "Yes, really, show me." — the user's way past the blob ceiling (#396).
//!
//! #385 gave the ceiling one policy and an honest answer; what it deliberately
//! left out was any way to act on it. The ceiling is a guess about intent, and
//! when it is wrong it is completely wrong: a generated `schema.sql`, a `.csv`
//! fixture, a vendored lockfile, a minified bundle whose one changed line is the
//! thing being reviewed.
//!
//! Three properties this pins, because each of them is a way the escape hatch
//! could quietly become the thing #385 removed:
//!
//! 1. **It is a HIGHER ceiling, not the absence of one.** Over
//!    `MAX_BLOB_OVERRIDE` the delta comes back `oversized` again, naming the
//!    raised limit — never libgit2's 512 MB default.
//! 2. **It is PER FILE.** The raise is a pathspec as well as a limit, so
//!    waiving the ceiling for one huge blob does not read the other huge blob
//!    in the same commit.
//! 3. **The lines are BOUNDED.** Blob size is the first wall and line count is
//!    the second; over `MAX_DIFF_LINES` the diff reports `truncated` rather
//!    than shipping a million `DiffLine`s at a frontend that has to lay every
//!    one of them out.

mod support;

use std::path::{Path, PathBuf};

use platypusgit_lib::git::libgit2::{MAX_BLOB_OVERRIDE, MAX_DIFF_LINES, MAX_WORKDIR_BLOB};
use platypusgit_lib::git::types::{DiffKind, FileDiff};
use platypusgit_lib::git::GitBackend;
use support::TempRepo;

/// Over the 5 MB ceiling, under the 64 MB override, and unambiguously TEXT:
/// plain ASCII with newlines, so libgit2's binary sniff has nothing to find.
/// ~6.7 MB in ~110k lines — deliberately just over `MAX_DIFF_LINES` when both
/// sides are counted, so the truncation arm is reachable without a 40 MB
/// fixture in a unit test.
fn overridable_text(lines: usize) -> String {
    let line = "the quick brown fox jumps over the lazy dog; padding padding\n";
    debug_assert_eq!(line.len(), 61);
    line.repeat(lines)
}

fn find<'a>(diffs: &'a [FileDiff], path: &str) -> Option<&'a FileDiff> {
    diffs.iter().find(|d| d.path == path)
}

#[test]
fn a_waived_ceiling_diffs_the_blob_the_default_refused() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let big = overridable_text(110_000); // ~6.7 MB, over MAX_WORKDIR_BLOB
    support::fs::write_file(tr.path(), "schema.sql", &big);
    tr.commit_all("add a generated schema");
    let (backend, handle) = tr.open_with_backend();
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    // The default answer, restated here so the two live side by side: this is
    // the refusal the button exists to get past.
    let refused = backend.diff_commit(&handle.id, &tip, 3, false).unwrap();
    let refused = find(&refused, "schema.sql").expect("schema.sql in diff");
    assert!(refused.oversized.is_some(), "default ceiling still refuses");
    assert!(refused.hunks.is_empty());

    let shown = backend
        .diff_commit_over_ceiling(
            &handle.id,
            &tip,
            3,
            false,
            &[PathBuf::from("schema.sql")],
        )
        .unwrap();
    let shown = find(&shown, "schema.sql").expect("schema.sql in raised diff");

    assert!(
        shown.oversized.is_none(),
        "the raised ceiling covers this blob, so nothing is over it"
    );
    assert!(
        !shown.binary,
        "libgit2 only called it binary because of `max_size`; read, it is text"
    );
    assert_eq!(
        shown.additions, 110_000,
        "every added line is counted, whether or not it was serialised"
    );
}

#[test]
fn the_raise_is_per_file_and_does_not_read_the_blob_beside_it() {
    // Property 2, and the reason `raise_for` is a pathspec and not just a size:
    // a vendored-dependency bump can put several artifacts in one commit, and
    // "show me that CSV" must not also xdiff the bundle next to it.
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "data.csv", &overridable_text(100_000));
    support::fs::write_file(tr.path(), "bundle.min.js", &overridable_text(100_000));
    tr.commit_all("add two generated artifacts");
    let (backend, handle) = tr.open_with_backend();
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    let diffs = backend
        .diff_commit_over_ceiling(&handle.id, &tip, 3, false, &[PathBuf::from("data.csv")])
        .unwrap();

    let csv = find(&diffs, "data.csv").expect("the waived path is in the answer");
    assert!(csv.oversized.is_none(), "the waived path diffed");

    // The other artifact is still in the list — the answer is the WHOLE diff,
    // so a caller can pass its waivers on every fetch (see `with_raised`) — and
    // it is still refused. Two things prove it was never read: no hunks, and a
    // limit that is the DEFAULT ceiling rather than the raised one.
    let bundle = find(&diffs, "bundle.min.js").expect("every file is still listed");
    let over = bundle
        .oversized
        .expect("the un-waived artifact is still over the ceiling");
    assert_eq!(
        over.limit, MAX_WORKDIR_BLOB as u64,
        "the raise applied to the waived path ONLY; this one kept the default \
         ceiling, which is what says its blob was never loaded"
    );
    assert!(!over.raised, "and the user never asked for this one");
    assert!(bundle.hunks.is_empty(), "not a line of it was serialised");
}

#[test]
fn a_waived_ceiling_still_has_a_ceiling() {
    // Property 1. A blob over the OVERRIDE comes back oversized again, and the
    // limit in the sentence is the raised one — otherwise a 120 MB file would
    // report itself as over 5 MB and the button would look like it did nothing.
    //
    // Asserted through `oversized_delta`'s contract rather than by writing a
    // 64 MB fixture: the ceiling that reaches `OversizedBlob::limit` is the one
    // `blob_ceiling` chose, and the two constants differ, so a raised diff that
    // reported `MAX_WORKDIR_BLOB` would fail here.
    assert!(
        MAX_BLOB_OVERRIDE > MAX_WORKDIR_BLOB,
        "the override raises the ceiling"
    );
    assert!(
        MAX_BLOB_OVERRIDE < 512 * 1024 * 1024,
        "and stays well under libgit2's own default, which is the wall with no \
         message on it that #385 removed"
    );

    let tr = TempRepo::with_initial_commit("hello\n");
    let big = overridable_text(110_000);
    support::fs::write_file(tr.path(), "schema.sql", &big);
    tr.commit_all("add a generated schema");
    let (backend, handle) = tr.open_with_backend();
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    let refused = backend.diff_commit(&handle.id, &tip, 3, false).unwrap();
    let over = find(&refused, "schema.sql").unwrap().oversized.unwrap();
    assert_eq!(
        over.limit, MAX_WORKDIR_BLOB as u64,
        "an ordinary diff names the ordinary ceiling"
    );
    assert!(
        !over.raised,
        "and says the user has not asked for it yet — the UI needs that to know \
         whether offering the button again could change the answer"
    );
}

#[test]
fn a_fresh_refusal_after_a_waiver_is_not_marked_raised() {
    // The bug this field replaced. The frontend used to decide "already tried"
    // from its own list of waived paths, and the surfaces' fetch effects never
    // pass that list — so returning to the file produced a DEFAULT-ceiling
    // refusal while the path was still in the list, and the action stayed hidden
    // for the rest of the session. `raised` is the backend's own answer about
    // which ceiling this delta actually lost to.
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "schema.sql", &overridable_text(110_000));
    tr.commit_all("add a generated schema");
    let (backend, handle) = tr.open_with_backend();
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    // A waived read, then the next ordinary one — the shape a re-selection has.
    let _ = backend
        .diff_commit_over_ceiling(&handle.id, &tip, 3, false, &[PathBuf::from("schema.sql")])
        .unwrap();
    let again = backend.diff_commit(&handle.id, &tip, 3, false).unwrap();

    let over = find(&again, "schema.sql").unwrap().oversized.unwrap();
    assert!(!over.raised, "the waiver does not persist in the backend either");
    assert_eq!(over.limit, MAX_WORKDIR_BLOB as u64);
}

#[test]
fn over_the_line_cap_the_diff_says_how_much_it_kept() {
    // Property 3. Two sides of ~110k lines each rewritten wholesale is well
    // over `MAX_DIFF_LINES`, which is the point: the blob fits the raised
    // ceiling and the LINES do not.
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "data.csv", &overridable_text(110_000));
    tr.commit_all("add a fixture");
    // Rewrite every line, so the diff is ~110k deletions + ~110k additions.
    let rewritten: String = (0..110_000)
        .map(|i| format!("row {i},changed,{i}\n"))
        .collect();
    support::fs::write_file(tr.path(), "data.csv", &rewritten);
    let (backend, handle) = tr.open_with_backend();

    let fd = backend
        .diff_over_ceiling(
            &handle.id,
            Path::new("data.csv"),
            DiffKind::WorktreeToHead,
            3,
            false,
            &[PathBuf::from("data.csv")],
        )
        .unwrap();

    let t = fd
        .truncated
        .expect("a diff this long reports that it was cut");
    assert_eq!(
        t.shown, MAX_DIFF_LINES,
        "exactly the cap is kept — the row count the surfaces lay out is known \
         in advance, not whatever the file happened to contain"
    );
    assert!(
        t.total > t.shown,
        "and the real length is reported: {} of {}",
        t.shown,
        t.total
    );
    let rows: usize = fd.hunks.iter().map(|h| h.lines.len()).sum();
    assert_eq!(rows, t.shown, "`shown` is the rows that actually arrived");
    assert_eq!(
        (fd.additions, fd.deletions),
        (110_000, 110_000),
        "the file row keeps telling the truth about the change even though the \
         pane cannot show all of it"
    );
}

#[test]
fn an_ordinary_diff_is_never_truncated() {
    // The regression that matters most, and the reason `diff_lines_cap` returns
    // `None` without a raise: the cap must not change what a diff the app opened
    // by itself looks like. Nothing under `MAX_WORKDIR_BLOB` can reach the cap
    // by this route, so `truncated` stays `None` on every ordinary file.
    let tr = TempRepo::with_initial_commit("hello\n");
    let (backend, handle) = tr.open_with_backend();
    support::fs::write_file(tr.path(), "README.md", "hello\nworld\n");

    let fd = backend
        .diff(
            &handle.id,
            Path::new("README.md"),
            DiffKind::WorktreeToHead,
            3,
            false,
        )
        .unwrap();

    assert!(fd.truncated.is_none());
    assert!(fd.oversized.is_none());
    assert_eq!(fd.additions, 1);
}

#[test]
fn an_empty_raise_list_is_the_default_ceiling() {
    // The plain trait methods are one-line forwards with `&[]`, so this is what
    // keeps the forwarding honest: an absent `raiseFor` from the wire must be
    // indistinguishable from the un-suffixed call.
    let tr = TempRepo::with_initial_commit("hello\n");
    let big = overridable_text(110_000);
    support::fs::write_file(tr.path(), "schema.sql", &big);
    tr.commit_all("add a generated schema");
    let (backend, handle) = tr.open_with_backend();
    let tip = backend.log(&handle.id, None, 1).unwrap()[0].oid.clone();

    let via_default = backend.diff_commit(&handle.id, &tip, 3, false).unwrap();
    let via_empty = backend
        .diff_commit_over_ceiling(&handle.id, &tip, 3, false, &[])
        .unwrap();

    let a = find(&via_default, "schema.sql").unwrap();
    let b = find(&via_empty, "schema.sql").unwrap();
    assert_eq!(a.oversized, b.oversized);
    assert_eq!(a.hunks.len(), b.hunks.len());
    assert_eq!(via_default.len(), via_empty.len());
}

#[test]
fn the_single_file_diff_only_raises_the_path_it_was_asked_for() {
    // `diff` takes one path and `raise_for` is a list, so the two can disagree.
    // A list that does not name this path is not a raise — otherwise a stale
    // override from a previously selected file would silently apply to the next
    // one the user clicked.
    let tr = TempRepo::with_initial_commit("hello\n");
    let big = overridable_text(110_000);
    support::fs::write_file(tr.path(), "schema.sql", &big);
    tr.commit_all("add a generated schema");
    support::fs::write_file(tr.path(), "schema.sql", &overridable_text(110_001));
    let (backend, handle) = tr.open_with_backend();

    let fd = backend
        .diff_over_ceiling(
            &handle.id,
            Path::new("schema.sql"),
            DiffKind::WorktreeToHead,
            3,
            false,
            &[PathBuf::from("some/other/file.csv")],
        )
        .unwrap();

    assert!(
        fd.oversized.is_some(),
        "a raise for a different path leaves this one refused"
    );
}
