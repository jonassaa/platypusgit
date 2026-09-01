//! User-defined external commands (#225).
//!
//! The feature that lets a GUI absorb the one git-adjacent command a team runs
//! fifty times a day, without that command having to be something we shipped.
//!
//! ## A user-supplied command string is NOT a shell line
//!
//! This is the whole security design, and it is worth being explicit about
//! because the tempting implementation — hand the string to `sh -c` — is wrong
//! in a way that is invisible until it bites. Under a shell, a branch named
//! `main; rm -rf ~` or a path containing `$(...)` stops being *data* and becomes
//! *code*. Branch names and paths come from the repository, which means they can
//! come from anyone who has ever pushed to it.
//!
//! So:
//!
//! 1. The command string is parsed ONCE, here, into a program plus an argv
//!    vector — quotes group, nothing else is special. No globbing, no variable
//!    expansion, no operators: `|`, `>`, `;`, `&&` are ordinary characters in an
//!    argument, because that is all they can be when nothing interprets them.
//! 2. Placeholders are substituted INTO INDIVIDUAL ARGV ENTRIES, after parsing.
//!    A value can never introduce a new argument, however it is spelled — a path
//!    with a space stays one argument, and a branch name with a `;` stays a
//!    branch name.
//! 3. The result is spawned directly through `proc::program_async`, which is the
//!    only place in this codebase allowed to construct a `Command` (a guard test
//!    fails the build otherwise) and which carries the `CREATE_NO_WINDOW`
//!    treatment from #172, so a custom action never flashes a console on Windows.
//!
//! The one placeholder that legitimately expands to several arguments is
//! `$FILES`, and it does so as whole entries — never by splitting a string.
//!
//! ## No secrets, ever
//!
//! A custom action is a USER program, not a trusted one. Nothing from the auth
//! path goes near it: no forge token, no git credential, no askpass wiring. It
//! inherits the ordinary child environment `proc.rs` builds and nothing else.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// The values a placeholder can take for one invocation.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionContext {
    /// The repository's working directory. Always present.
    pub repo: String,
    /// Selected files, repo-relative. Empty when the action was not invoked on
    /// a file.
    #[serde(default)]
    pub files: Vec<String>,
    /// The selected commit, if any.
    #[serde(default)]
    pub sha: Option<String>,
    /// The current branch, if HEAD is on one.
    #[serde(default)]
    pub branch: Option<String>,
}

/// What a finished action reports back.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutput {
    /// Exit status, or `None` when the process was killed by a signal.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    /// The argv actually spawned, for the output panel — so "what did it run"
    /// is answerable without guessing at how the string was parsed.
    pub argv: Vec<String>,
}

/// How much output is kept.
///
/// A command that prints a gigabyte must not become a gigabyte-sized IPC
/// message and a frozen UI. Truncated with a marker rather than silently, so
/// the panel never implies it showed everything.
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024;

pub fn truncate_output(mut s: String) -> String {
    if s.len() <= MAX_OUTPUT_BYTES {
        return s;
    }
    s.truncate(MAX_OUTPUT_BYTES);
    s.push_str("\n… output truncated");
    s
}

/// Split a command string into program + arguments.
///
/// **Not a shell.** Quotes (single and double) group; a backslash escapes the
/// next character inside double quotes and outside them. Everything else —
/// including `|`, `>`, `;`, `&&`, `$`, `*` — is a literal character in whatever
/// argument it lands in.
///
/// Refuses an empty command rather than spawning something ambiguous.
pub fn parse_command(line: &str) -> AppResult<Vec<String>> {
    let mut argv: Vec<String> = Vec::new();
    let mut cur = String::new();
    let mut has_cur = false;
    let mut chars = line.chars().peekable();
    let mut quote: Option<char> = None;

    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                // An escape is literal inside single quotes, the way a shell
                // treats it — otherwise a Windows path in single quotes would
                // lose its separators.
                if quote == Some('\'') {
                    cur.push(c);
                    has_cur = true;
                } else if let Some(next) = chars.next() {
                    cur.push(next);
                    has_cur = true;
                } else {
                    return Err(AppError::InvalidArgument(
                        "the command ends with a trailing backslash".to_string(),
                    ));
                }
            }
            '\'' | '"' => match quote {
                Some(q) if q == c => {
                    quote = None;
                    // An empty quoted string IS an argument: `foo ""` is two.
                    has_cur = true;
                }
                Some(_) => {
                    cur.push(c);
                    has_cur = true;
                }
                None => {
                    quote = Some(c);
                    has_cur = true;
                }
            },
            c if c.is_whitespace() && quote.is_none() => {
                if has_cur {
                    argv.push(std::mem::take(&mut cur));
                    has_cur = false;
                }
            }
            c => {
                cur.push(c);
                has_cur = true;
            }
        }
    }

    if quote.is_some() {
        return Err(AppError::InvalidArgument(
            "the command has an unclosed quote".to_string(),
        ));
    }
    if has_cur {
        argv.push(cur);
    }
    if argv.is_empty() {
        return Err(AppError::InvalidArgument(
            "the command is empty".to_string(),
        ));
    }
    Ok(argv)
}

/// The placeholders and their values, LONGEST NAME FIRST.
///
/// The order is load-bearing: `$FILE` is a prefix of `$FILES`, so a scan that
/// tried them in any other order would match `$FILE` inside `$FILES` and leave
/// a stray `S` behind. Sorting by descending length makes that structural
/// rather than something the next placeholder has to remember.
fn placeholders(ctx: &ActionContext) -> Vec<(&'static str, String)> {
    let mut v: Vec<(&'static str, String)> = vec![
        ("$REPO", ctx.repo.clone()),
        // Every selected file, space-joined. Only reached when `$FILES` appears
        // INSIDE a larger argument — a bare `$FILES` entry expands to one
        // argument per file, which a string substitution cannot express.
        ("$FILES", ctx.files.join(" ")),
        // The FIRST selected file, which is what `$FILE` means on a
        // single-select surface. Empty rather than absent when nothing is
        // selected: an action invoked without a file should get an empty
        // argument, not the four literal characters `$FILE`, which look like a
        // real argument and fail somewhere further away.
        ("$FILE", ctx.files.first().cloned().unwrap_or_default()),
        ("$SHA", ctx.sha.clone().unwrap_or_default()),
        ("$BRANCH", ctx.branch.clone().unwrap_or_default()),
    ];
    v.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    v
}

/// Expand placeholders in ONE pass, left to right.
///
/// A single pass is the point. Chained `str::replace` calls re-scan text that
/// an earlier call just substituted, so a file literally named `$SHA` would
/// pull in the commit sha — the substituted value would be treated as another
/// template. Values are DATA. Emitting each expansion straight into the output
/// and never looking at it again is what makes that true by construction.
fn expand(entry: &str, vars: &[(&'static str, String)]) -> String {
    let mut out = String::new();
    let mut rest = entry;
    'outer: while !rest.is_empty() {
        if rest.starts_with('$') {
            for (name, value) in vars {
                if let Some(tail) = rest.strip_prefix(name) {
                    out.push_str(value);
                    rest = tail;
                    continue 'outer;
                }
            }
        }
        // Not a placeholder — copy one character and move on. Char-wise rather
        // than byte-wise so a multi-byte character is never split.
        let c = rest.chars().next().expect("rest is non-empty");
        out.push(c);
        rest = &rest[c.len_utf8()..];
    }
    out
}

/// Substitute placeholders into already-parsed argv entries.
///
/// The security property: a substituted value can never introduce a new
/// argument. `$BRANCH` holding `main; rm -rf ~` produces ONE argument
/// containing that text, because splitting already happened in `parse_command`
/// and nothing re-splits afterwards.
///
/// An entry that is exactly `$FILES` expands to one argument per selected file
/// — as whole entries, never by splitting a joined string. An entry that merely
/// CONTAINS `$FILES` gets the files space-joined, because there is no sensible
/// way to expand `--files=$FILES` into several arguments and joining is the
/// least surprising reading.
pub fn substitute(argv: &[String], ctx: &ActionContext) -> Vec<String> {
    let vars = placeholders(ctx);
    let mut out: Vec<String> = Vec::new();
    for entry in argv {
        // The one placeholder that changes the NUMBER of arguments, and it only
        // does so when it is the whole entry. Handled before `expand` because a
        // string substitution cannot express "become N arguments".
        if entry == "$FILES" {
            out.extend(ctx.files.iter().cloned());
            continue;
        }
        out.push(expand(entry, &vars));
    }
    out
}

/// Parse and substitute in one step — the whole argv pipeline.
pub fn build_argv(command: &str, ctx: &ActionContext) -> AppResult<Vec<String>> {
    let parsed = parse_command(command)?;
    let argv = substitute(&parsed, ctx);
    // Substitution can empty the program name (`$FILE` as the program with no
    // file selected). Spawning "" is a confusing OS error; this is a clear one.
    if argv.first().map(String::is_empty).unwrap_or(true) {
        return Err(AppError::InvalidArgument(
            "the command's program name is empty after substitution".to_string(),
        ));
    }
    Ok(argv)
}
