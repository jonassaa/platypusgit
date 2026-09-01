//! The structural half of issue 172: **no raw process spawn outside
//! `src/proc.rs`**.
//!
//! The Windows console flash was not one bug, it was 19 spawn sites and one that
//! remembered the flag. A one-time sweep of the other 19 would regress the first
//! time someone adds a twentieth, silently, in a build nobody runs on Windows —
//! which is exactly how it shipped. So the flag lives in constructors and this
//! test fails if a `Command::new` appears anywhere else.
//!
//! Same shape as `test/docs.test.ts`, which reads the `invoke_handler!` registry
//! and fails when a command is undocumented: the guard is a test over the source
//! text, because the property is about what the source *may contain*.
//!
//! Limits, stated honestly: this greps. It catches `Command::new` in every
//! spelling in use (`std::process::`, `tokio::process::`, imported bare), and it
//! catches a hand-rolled `creation_flags`. It would not catch someone building a
//! `Command` by other means. That is a deliberate act, not an oversight, and the
//! reviewer of such a change has this file to read.

use std::path::{Path, PathBuf};

/// Files allowed to contain raw `Command::new`, with the count expected and the
/// reason. A new spawn in one of these files fails the count, so an exception
/// covers what it was granted for and nothing more.
const RAW_SPAWN_ALLOWED: &[(&str, usize, &str)] = &[
    (
        "src/proc.rs",
        5,
        "The module that OWNS spawning. Four are its constructors: `program`, \
         `program_async`, and the two `*_keeping_console` exceptions. The fifth \
         is `probe_login_path`'s login shell (issue 232) — the one child that \
         must NOT be handed the environment we are trying to replace, which is \
         why it cannot go through a constructor. It is `#[cfg(not(windows))]`, \
         so it creates no Windows console either.",
    ),
    (
        "src/detach.rs",
        1,
        "`spawn_detached` is `#[cfg(unix)]` — it re-execs the app under `setsid` \
         to hand a terminal back on a `pgit …` launch (#163). Windows is \
         deliberately untouched there (see its `#[cfg(not(unix))]` sibling), so \
         no Windows console can be created by it.",
    ),
];

/// Call sites of the constructors that deliberately KEEP a child's console, with
/// the reason each is an exception. Adding a third means editing this list, which
/// is the point: `CREATE_NO_WINDOW` on an interactive terminal program leaves an
/// invisible process holding a file open, so the exceptions must be argued, not
/// inherited.
const CONSOLE_KEEPING_CALLERS: &[(&str, &str, &str)] = &[
    (
        "src/commands/conflict.rs",
        "crate::proc::git_async_keeping_console(",
        "`git mergetool` launches the tool the USER configured. A console \
         mergetool (vimdiff) needs its console; silencing it would leave an \
         invisible process holding the conflicted file with `status().await` \
         never returning and no cancel button in the UI. A GUI mergetool is \
         unaffected either way — the flag does not apply to non-console apps.",
    ),
    (
        "src/commands/diff.rs",
        "crate::proc::git_async_keeping_console(",
        "`git difftool` (#235), for the identical reason to `git mergetool` \
         directly above: it launches the tool the USER configured, and a console \
         difftool (`vimdiff`, `nvimdiff`) is a terminal program that needs the \
         console it is given. The asymmetry is the same one — silencing costs a \
         GUI tool nothing (the flag does not apply to it) and costs a console \
         tool the window it renders in, leaving an invisible process holding \
         the file with no way to stop it.",
    ),
    (
        "src/commands/repo.rs",
        "crate::proc::program_async_keeping_console(",
        "`$VISUAL`/`$EDITOR`. `EDITOR=vim` names a console program, and hiding \
         its console makes the editor invisible while it holds the file — the \
         user's next move would be Task Manager. The cosmetic flash a batch-file \
         shim (`code.cmd`) would avoid does not outweigh that.",
    ),
];

fn src_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).expect("read src dir") {
        let path = entry.expect("dir entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

/// Every `.rs` file under `src/`, as (path relative to the crate root, contents).
fn sources() -> Vec<(String, String)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = Vec::new();
    rust_files(&src_root(), &mut files);
    files.sort();
    files
        .into_iter()
        .map(|p| {
            let rel = p
                .strip_prefix(root)
                .expect("under the crate root")
                .to_string_lossy()
                // So the allow-list reads the same on Windows.
                .replace('\\', "/");
            (rel, std::fs::read_to_string(&p).expect("read source"))
        })
        .collect()
}

/// Comment lines are not code. Without this the module doc in `proc.rs`, which
/// explains the rule, would count as breaking it.
fn is_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*')
}

fn count_code_occurrences(body: &str, needle: &str) -> usize {
    body.lines()
        .filter(|l| !is_comment(l))
        .map(|l| l.matches(needle).count())
        .sum()
}

fn allowance(rel: &str) -> Option<(usize, &'static str)> {
    RAW_SPAWN_ALLOWED
        .iter()
        .find(|(f, _, _)| *f == rel)
        .map(|(_, n, why)| (*n, *why))
}

#[test]
fn no_raw_command_new_outside_the_proc_module() {
    let mut offenders: Vec<String> = Vec::new();

    for (rel, body) in sources() {
        let found = count_code_occurrences(&body, "Command::new");
        let allowed = allowance(&rel);
        match allowed {
            None if found > 0 => offenders.push(format!(
                "{rel}: {found} raw `Command::new`. Use a `crate::proc::…` \
                 constructor so the child inherits CREATE_NO_WINDOW on Windows; \
                 if this spawn genuinely must keep its console, add it to \
                 CONSOLE_KEEPING_CALLERS with a reason."
            )),
            Some((expected, why)) if found != expected => offenders.push(format!(
                "{rel}: {found} raw `Command::new`, allow-listed for {expected}. \
                 The exception exists because: {why}"
            )),
            _ => {}
        }
    }

    assert!(
        offenders.is_empty(),
        "raw process spawns outside src/proc.rs (issue 172):\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_console_keeping_exceptions_are_exactly_the_allow_listed_ones() {
    const MARKERS: [&str; 2] = [
        "crate::proc::git_async_keeping_console(",
        "crate::proc::program_async_keeping_console(",
    ];

    let sources = sources();
    let mut total = 0usize;
    let mut unexpected: Vec<String> = Vec::new();

    for (rel, body) in &sources {
        for marker in MARKERS {
            let found = count_code_occurrences(body, marker);
            total += found;
            if found > 0
                && !CONSOLE_KEEPING_CALLERS
                    .iter()
                    .any(|(f, m, _)| f == rel && *m == marker)
            {
                unexpected.push(format!("{rel} calls {marker}"));
            }
        }
    }

    assert!(
        unexpected.is_empty(),
        "a new spawn deliberately keeps its Windows console, which needs a \
         reason in CONSOLE_KEEPING_CALLERS:\n  {}",
        unexpected.join("\n  ")
    );
    assert_eq!(
        total,
        CONSOLE_KEEPING_CALLERS.len(),
        "expected exactly {} console-keeping call site(s); the allow-list and the \
         code have drifted",
        CONSOLE_KEEPING_CALLERS.len()
    );

    // And each allow-listed exception is still there — a dead entry would let a
    // future one be added without argument.
    for (rel, marker, why) in CONSOLE_KEEPING_CALLERS {
        let body = sources
            .iter()
            .find(|(f, _)| f == rel)
            .map(|(_, b)| b)
            .unwrap_or_else(|| panic!("{rel} is allow-listed but does not exist"));
        assert_eq!(
            count_code_occurrences(body, marker),
            1,
            "{rel} should call {marker} exactly once. Reason on record: {why}"
        );
    }
}

/// The pty half of the same rule (#243).
///
/// `portable_pty` spawns through its own `CommandBuilder`, not
/// `std::process::Command`, so the `Command::new` guard above cannot see it at
/// all. A pty opened anywhere but `proc.rs` would therefore be a second spawn
/// path with NO guard on it — precisely the state issue 172 found the tree in,
/// and the reason `spawn_pty_shell` owns the whole operation (openpty, the
/// builder, and the spawn) rather than just handing out a builder.
#[test]
fn the_pty_spawn_lives_only_in_the_proc_module() {
    const PTY_APIS: [&str; 3] = ["CommandBuilder::new", "openpty(", "spawn_command("];

    for (rel, body) in sources() {
        for api in PTY_APIS {
            let found = count_code_occurrences(&body, api);
            let expected = usize::from(rel == "src/proc.rs");
            assert_eq!(
                found, expected,
                "{rel} uses `{api}` {found} time(s), expected {expected}. The \
                 whole pty spawn belongs in src/proc.rs::spawn_pty_shell — a \
                 second one would be covered by no guard in this file."
            );
        }
    }
}

#[test]
fn the_windows_creation_flag_is_set_in_one_place_only() {
    // The pre-172 state was one hand-rolled `creation_flags(0x0800_0000)` in
    // cli.rs and 19 sites without one. A second hand-rolled flag is the start of
    // that again.
    for (rel, body) in sources() {
        if rel == "src/proc.rs" {
            continue;
        }
        for needle in ["creation_flags", "0x0800_0000", "0x08000000"] {
            assert_eq!(
                count_code_occurrences(&body, needle),
                0,
                "{rel} sets the Windows creation flag by hand ({needle}); it \
                 belongs in src/proc.rs so every spawn site inherits it"
            );
        }
    }
}
