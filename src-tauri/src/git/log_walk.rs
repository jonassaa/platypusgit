//! The commit ORDER, taken from git rather than from libgit2 (#483).
//!
//! # Why this exists
//!
//! `build_walk_order` needs an order in which every parent follows its
//! children, because that is what the graph's lane assignment is computed
//! against. In libgit2 1.9.7 — what `git2 0.21` vendors — producing one is not
//! incremental in any sense:
//!
//! * `git_revwalk_sorting` ends with
//!   `if (walk->sorting != GIT_SORT_NONE) walk->limited = 1;`
//! * so `prepare_walk` runs `limit_list` over the WHOLE reachable graph,
//! * then `sort_in_topological_order` materialises the COMPLETE ordered list,
//! * all before the first oid comes out.
//!
//! Measured on `torvalds/linux`: the first oid costs 16,568.3 ms and two
//! thousand oids cost 16,568.5 ms — the same number, because the traversal has
//! already finished by the time one comes back.
//!
//! git answers the same question in 188 ms, because it prunes with the
//! generation numbers in the commit-graph file. libgit2 parses those numbers
//! (`commit_list.c` fills `commit->generation` from the graph) and then never
//! reads them in `revwalk.c` — across all of libgit2's `src/`, `->generation`
//! is read in exactly two places, `graph.c` and `merge.c`. So there is no
//! in-process fix available through the revwalk API, and the order comes from
//! a subprocess instead. `git/commit_graph.rs` is what keeps that subprocess
//! fast; without a commit-graph git is no better than we are (10,085 ms).
//!
//! # Only oids cross over
//!
//! Commit metadata still comes from libgit2 via `repo.find_commit`. That keeps
//! the seam one function wide: no `--format` string to keep in sync with
//! `CommitInfo`, no encoding questions, no second definition of what a commit
//! is, and no change to anything downstream of `WalkOrder`.
//!
//! # `--date-order`, and never `--topo-order`
//!
//! `Sort::TIME | Sort::TOPOLOGICAL` is Kahn's algorithm over a time-priority
//! queue, which is exactly git's `--date-order`. `--topo-order` answers a
//! different question — it additionally refuses to intermix independent lines
//! of history — and on the kernel the two share only 1,627 of the first 2,000
//! oids. It does not reorder the same commits, it returns different ones.
//! `tests/log_walk_ordering.rs` pins this in both directions.

use std::path::Path;

use git2::Oid;

/// Parse `rev-list` output into oids.
///
/// `None` when anything at all is not an oid. That is deliberately strict:
/// this is a cache-shaped optimisation, and a caller that cannot trust the
/// output must fall back rather than guess at a partial order.
///
/// **A full-length id is required, and `Oid::from_str` is not enough to
/// enforce it.** libgit2 accepts an ABBREVIATED hex string and zero-pads it,
/// so `abc123` parses happily into a valid-looking oid that names nothing.
/// Output truncated mid-line — a killed subprocess, a full pipe — would then
/// become a plausible order with one wrong entry rather than an obvious
/// failure, so the length is checked first.
pub fn parse_oid_lines(stdout: &str, cap: usize) -> Option<Vec<Oid>> {
    /// SHA-1 and SHA-256 object ids, as hex.
    const HEX_LENS: [usize; 2] = [40, 64];

    let mut out = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if out.len() >= cap {
            break;
        }
        if !HEX_LENS.contains(&line.len()) || !line.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        out.push(Oid::from_str(line).ok()?);
    }
    Some(out)
}

/// The order git would walk from `starts`, or `None` to use the libgit2 walk.
///
/// Every `None` here means a SLOW page, never a failed one — git missing, git
/// failing, and output this cannot read all mean the same thing to the caller.
pub fn rev_list_order(workdir: &Path, starts: &[Oid], cap: usize) -> Option<Vec<Oid>> {
    if starts.is_empty() {
        return Some(Vec::new());
    }

    let mut cmd = crate::proc::git(workdir);
    cmd.arg("rev-list")
        .arg("--date-order")
        .arg(format!("--max-count={cap}"));
    for oid in starts {
        cmd.arg(oid.to_string());
    }
    // The start points are hex this backend resolved itself and never user
    // text, but option parsing ends before them anyway — the same rule every
    // other shell-out here follows.
    cmd.arg("--");

    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_oid_lines(std::str::from_utf8(&out.stdout).ok()?, cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(c: char) -> String {
        std::iter::repeat(c).take(40).collect()
    }

    #[test]
    fn parses_one_oid_per_line() {
        let out = format!("{}\n{}\n", oid('0'), oid('1'));
        let got = parse_oid_lines(&out, 10).expect("parses");
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].to_string(), oid('0'));
        assert_eq!(got[1].to_string(), oid('1'));
    }

    #[test]
    fn rejects_output_that_is_not_oids() {
        // A git that printed a warning, an advice block, anything at all.
        assert!(parse_oid_lines("fatal: bad revision\n", 10).is_none());
        // A line that is hex but too short — see the next test for why this
        // one cannot be left to `Oid::from_str`.
        assert!(parse_oid_lines("abc123\n", 10).is_none());
        // A full-length line that is not hex.
        assert!(parse_oid_lines(&"z".repeat(40), 10).is_none());
        // One good line and one truncated one: all or nothing, because a
        // partially-parsed order is worse than no order.
        assert!(parse_oid_lines(&format!("{}\nabc123\n", oid('a')), 10).is_none());
    }

    #[test]
    fn oid_from_str_alone_would_accept_an_abbreviated_id() {
        // The reason `parse_oid_lines` checks the length itself. libgit2
        // zero-pads a short hex string, so truncated output would otherwise
        // parse into a plausible order naming an object that does not exist.
        let short = Oid::from_str("abc123").expect("libgit2 accepts this");
        assert_eq!(short.to_string(), "abc1230000000000000000000000000000000000");
    }

    #[test]
    fn empty_output_is_valid_and_not_a_failure() {
        // An empty range is a real answer: no commits, not a broken git.
        assert_eq!(parse_oid_lines("", 10).expect("empty is valid").len(), 0);
    }

    #[test]
    fn tolerates_a_trailing_newline() {
        assert_eq!(parse_oid_lines(&format!("{}\n", oid('a')), 10).unwrap().len(), 1);
    }

    #[test]
    fn stops_at_the_cap() {
        let out = format!("{}\n", oid('a')).repeat(5);
        assert_eq!(parse_oid_lines(&out, 3).unwrap().len(), 3);
    }

    #[test]
    fn no_starts_is_an_empty_order_without_spawning_git() {
        // Not `None`: "nothing to walk" is an answer, and falling back to
        // libgit2 to rediscover it would cost a full prepare on a big repo.
        let got = rev_list_order(Path::new("/nonexistent"), &[], 10);
        assert_eq!(got, Some(Vec::new()));
    }
}
