//! The terminal never logs its traffic (#243).
//!
//! A terminal is where secrets get typed: a `sudo` password, a token pasted at
//! a prompt, an SSH passphrase. The property we want is that bytes read from
//! the pty reach exactly one destination — the event sink — and bytes written
//! to it reach exactly one destination, the pty.
//!
//! Stated that way it is a property about what the source may CONTAIN, so it is
//! a test over the source text, in the same shape as `spawn_no_window.rs` and
//! `test/docs.test.ts`. The alternative — keeping it by care — is how these
//! things get lost in the third refactor.
//!
//! The rule is deliberately blunt: `src/terminal.rs` contains no logging macro
//! AT ALL. That is enforceable in four lines, whereas "no logging macro that
//! mentions the buffer" is a judgement a grep cannot make. It costs nothing,
//! because the lifecycle events worth logging (opened, exited, closed) are
//! logged from `commands/terminal.rs`, which handles ids and exit codes and
//! never sees a byte of traffic. That split is the whole design.

use std::path::{Path, PathBuf};

fn path(rel: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)
}

fn read(rel: &str) -> String {
    let p = path(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

/// Comment lines are not code — without this, the module doc explaining the
/// rule would count as breaking it. Same filter `spawn_no_window.rs` needs.
fn is_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*')
}

fn code_lines(body: &str) -> impl Iterator<Item = &str> {
    body.lines().filter(|l| !is_comment(l))
}

#[test]
fn the_session_registry_logs_nothing() {
    const LOGGERS: [&str; 7] = [
        "log::",
        "tracing::",
        "println!",
        "eprintln!",
        "dbg!",
        "info!",
        "warn!",
    ];
    let body = read("src/terminal.rs");
    for logger in LOGGERS {
        let hits: Vec<&str> = code_lines(&body).filter(|l| l.contains(logger)).collect();
        assert!(
            hits.is_empty(),
            "src/terminal.rs uses `{logger}`, and this module handles pty \
             traffic — a password typed at a sudo prompt goes through it. \
             Lifecycle logging belongs in commands/terminal.rs, which never \
             sees a byte. Offending line(s): {hits:?}"
        );
    }
}

#[test]
fn the_traffic_never_reaches_a_file_or_the_network() {
    const EXFIL: [&str; 6] = [
        "File::create",
        "OpenOptions",
        "fs::write",
        "ureq",
        "reqwest",
        "TcpStream",
    ];
    let body = read("src/terminal.rs");
    for needle in EXFIL {
        assert!(
            !code_lines(&body).any(|l| l.contains(needle)),
            "src/terminal.rs mentions `{needle}`; pty traffic has exactly one \
             destination and it is the event sink"
        );
    }
}

#[test]
fn the_handlers_do_not_log_what_the_user_typed() {
    // `term_write`'s payload travels TOWARD the shell — a sudo password goes
    // this way. The handler may log that a write happened, never its content.
    let rel = "src/commands/terminal.rs";
    let body = read(rel);
    let logging = |l: &&str| {
        l.contains("log::") || l.contains("println!") || l.contains("tracing::")
    };
    for line in code_lines(&body).filter(logging) {
        assert!(
            !line.contains("data"),
            "a log line in {rel} mentions `data`, which is what the user \
             typed: {line}"
        );
    }
}
