//! Reading git's own progress reporting off a child's stderr (#296).
//!
//! Clone had this first and kept it private; fetch, pull and push now need the
//! identical thing, so the parser and the byte-splitter live here rather than
//! being copied. Both callers keep their own `tokio::select!` loop — the cancel
//! arms differ (a cancelled clone deletes its destination, a cancelled fetch
//! does not), and that difference is not worth a callback to abstract over.
//!
//! What is shared is everything below the read: how a chunk of bytes becomes
//! lines, which lines are progress, and what is kept for the failure message.

use crate::git::types::CloneProgress;

/// How many non-progress stderr lines a reader keeps by default.
///
/// The tail is what a failed op reports, and git puts its `fatal:` last, so
/// keeping the END of the stream is what matters — not the start. Twenty covers
/// git's own multi-line advice blocks (`! [rejected]` + the hint paragraph)
/// without letting a chatty `remote:` banner become the error message.
pub const DEFAULT_TAIL_LINES: usize = 20;

/// Parse one stderr line from a git command run with `--progress`.
///
/// Git writes progress as `Receiving objects:  62% (620/1000)`, separated by
/// carriage returns rather than newlines, and interleaves non-progress chatter
/// ("Cloning into 'foo'...", "remote: Enumerating objects: 1000, done.").
/// Unrecognized lines return `None` — a guess here would render a bogus bar.
pub fn parse_progress(line: &str) -> Option<CloneProgress> {
    let line = line.trim();
    let (phase, rest) = line.split_once(':')?;
    let phase = phase.trim();
    if phase.is_empty() {
        return None;
    }
    // Strip "remote:" prefix and parse the actual phase underneath.
    if phase == "remote" {
        return parse_progress(rest.trim());
    }
    // Reject non-progress lines that happen to have a colon.
    if phase == "fatal" || phase == "warning" || phase == "error" || phase == "hint" {
        return None;
    }
    // Require an actual '%' character — split always yields at least one item,
    // but we need to verify the delimiter was found.
    let mut parts = rest.trim().splitn(2, '%');
    let percent_token = parts.next()?.trim();
    parts.next()?; // only Some when a '%' was actually present
    let percent: u8 = percent_token.parse().ok()?;
    if percent > 100 {
        return None;
    }
    Some(CloneProgress {
        phase: phase.to_string(),
        percent,
    })
}

/// Turns raw stderr chunks into progress ticks plus a failure-message tail.
///
/// Git redraws each progress line with a bare `\r`; `\n` only shows up once, at
/// the end of a phase ("...done."). Reading by `\n` alone (as
/// `BufReader::read_until` did) buffers an entire phase — e.g. all of
/// "Receiving objects" — and only releases it as one burst right before the
/// next phase starts, which is not streaming: the bar freezes, then jumps. So
/// callers read raw bytes as they arrive off the pipe and hand them here, and
/// this splits on both `\r` and `\n`, carrying any trailing partial line across
/// reads.
pub struct ProgressReader {
    pending: Vec<u8>,
    tail: Vec<String>,
    max_tail: usize,
}

/// Bounds `pending` against a line that never gets a delimiter (a malformed or
/// adversarial sideband stream) — `read_until` had no such bound and would have
/// grown forever.
const MAX_PENDING: usize = 4096;

impl ProgressReader {
    pub fn new(max_tail: usize) -> Self {
        Self {
            pending: Vec::new(),
            tail: Vec::new(),
            max_tail,
        }
    }

    /// Feed the bytes of one read. Complete lines are classified immediately;
    /// an unterminated remainder waits for the next chunk.
    pub fn push(&mut self, bytes: &[u8], on_progress: &mut (impl FnMut(CloneProgress) + ?Sized)) {
        self.pending.extend_from_slice(bytes);
        while let Some(idx) = self.pending.iter().position(|&b| b == b'\r' || b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=idx).collect();
            self.classify(&line[..line.len() - 1], on_progress);
        }
        if self.pending.len() > MAX_PENDING {
            let overflow = std::mem::take(&mut self.pending);
            self.classify(&overflow, on_progress);
        }
    }

    /// Flush the final undelimited line at EOF — git's last error message does
    /// not always end in a newline, and it would otherwise be lost.
    pub fn finish(&mut self, on_progress: &mut (impl FnMut(CloneProgress) + ?Sized)) {
        if !self.pending.is_empty() {
            let pending = std::mem::take(&mut self.pending);
            self.classify(&pending, on_progress);
        }
    }

    /// Everything that was not a progress tick, newest last.
    pub fn into_tail(self) -> Vec<String> {
        self.tail
    }

    /// Classify one stderr segment (already split on `\r`/`\n`): feed progress
    /// lines to `on_progress`, keep everything else as context for a failure
    /// message. `parse_progress`'s contract is a single trimmed line — it must
    /// not see the delimiter itself.
    fn classify(&mut self, bytes: &[u8], on_progress: &mut (impl FnMut(CloneProgress) + ?Sized)) {
        let line = String::from_utf8_lossy(bytes);
        let line = line.trim();
        if line.is_empty() {
            return;
        }
        match parse_progress(line) {
            Some(p) => on_progress(p),
            // Keep non-progress lines: git's failure message is in here, and the
            // exit status alone would say nothing useful.
            None => {
                self.tail.push(line.to_string());
                if self.tail.len() > self.max_tail {
                    self.tail.remove(0);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(chunks: &[&[u8]]) -> (Vec<CloneProgress>, Vec<String>) {
        let mut reader = ProgressReader::new(DEFAULT_TAIL_LINES);
        let mut seen = Vec::new();
        for chunk in chunks {
            reader.push(chunk, &mut |p| seen.push(p));
        }
        reader.finish(&mut |p| seen.push(p));
        (seen, reader.into_tail())
    }

    #[test]
    fn parses_a_receiving_objects_line() {
        assert_eq!(
            parse_progress("Receiving objects:  62% (620/1000)"),
            Some(CloneProgress {
                phase: "Receiving objects".into(),
                percent: 62
            })
        );
    }

    #[test]
    fn parses_every_phase_git_reports() {
        for (line, phase, pct) in [
            ("Counting objects: 100% (10/10), done.", "Counting objects", 100),
            ("Compressing objects:   5% (1/20)", "Compressing objects", 5),
            ("Resolving deltas: 100% (3/3), done.", "Resolving deltas", 100),
            ("remote: Compressing objects:  45% (9/20)", "Compressing objects", 45),
            // Push-side phases, which clone never sees.
            ("Writing objects:  33% (1/3)", "Writing objects", 33),
            ("Enumerating objects:  10% (1/10)", "Enumerating objects", 10),
        ] {
            assert_eq!(
                parse_progress(line),
                Some(CloneProgress {
                    phase: phase.into(),
                    percent: pct
                }),
                "failed on {line}"
            );
        }
    }

    #[test]
    fn ignores_lines_that_are_not_progress() {
        for line in [
            "Cloning into 'foo'...",
            "remote: Enumerating objects: 1000, done.",
            "",
            "warning: redirecting to https://example.com/repo.git/",
            "fatal: repository 'https://example.com/nope.git/' not found",
            // Push's rejection advice is a colon-bearing multi-line block that
            // must reach the failure message rather than be eaten as progress.
            "hint: Updates were rejected because the tip of your current branch is behind",
            "error: failed to push some refs to 'origin'",
        ] {
            assert_eq!(parse_progress(line), None, "should ignore {line}");
        }
    }

    #[test]
    fn rejects_a_percentless_number_instead_of_guessing() {
        // `split('%')` yields the whole string when the delimiter is absent, so
        // this used to parse as a confident 6%. Git delimits progress with \r,
        // so a truncated read really can hand us this.
        assert_eq!(parse_progress("Receiving objects: 6"), None);
    }

    #[test]
    fn splits_on_carriage_returns_so_a_phase_streams() {
        // The whole point: one read carrying four redraws must yield four ticks,
        // not one burst at the end of the phase.
        let (seen, tail) = drain(&[
            b"Receiving objects:  10% (1/10)\rReceiving objects:  50% (5/10)\r",
            b"Receiving objects: 100% (10/10), done.\n",
        ]);
        assert_eq!(
            seen.iter().map(|p| p.percent).collect::<Vec<_>>(),
            [10, 50, 100]
        );
        assert!(tail.is_empty());
    }

    #[test]
    fn carries_a_partial_line_across_reads() {
        // A pipe read splits wherever it likes, including mid-percentage.
        let (seen, _) = drain(&[b"Receiving objec", b"ts:  62% (620/1000)\r"]);
        assert_eq!(seen.len(), 1);
        assert_eq!(seen[0].percent, 62);
    }

    #[test]
    fn keeps_non_progress_lines_for_the_failure_message() {
        let (seen, tail) = drain(&[
            b"Receiving objects: 100% (10/10)\r",
            b"fatal: could not read Username for 'https://example.com'\n",
        ]);
        assert_eq!(seen.len(), 1);
        assert_eq!(
            tail,
            ["fatal: could not read Username for 'https://example.com'"]
        );
    }

    #[test]
    fn a_final_line_without_a_newline_is_not_lost() {
        // Git's last error message does not always end in a delimiter, and it is
        // the one line the user most needs to see.
        let (_, tail) = drain(&[b"fatal: repository not found"]);
        assert_eq!(tail, ["fatal: repository not found"]);
    }

    #[test]
    fn the_tail_keeps_the_newest_lines_not_the_oldest() {
        // The fatal is last. A cap that dropped from the end would throw away
        // the only line worth reporting.
        let mut reader = ProgressReader::new(2);
        for line in ["remote: one\n", "remote: two\n", "fatal: three\n"] {
            reader.push(line.as_bytes(), &mut |_| {});
        }
        assert_eq!(reader.into_tail(), ["remote: two", "fatal: three"]);
    }

    #[test]
    fn an_undelimited_flood_is_bounded_rather_than_buffered_forever() {
        let mut reader = ProgressReader::new(DEFAULT_TAIL_LINES);
        let flood = vec![b'x'; MAX_PENDING * 3];
        reader.push(&flood, &mut |_| {});
        // Forced out in MAX_PENDING-sized pieces rather than held in `pending`.
        assert!(!reader.into_tail().is_empty());
    }
}
