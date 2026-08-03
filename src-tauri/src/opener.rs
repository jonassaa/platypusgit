//! Handing a URL or a file path to the OS's default handler.
//!
//! SECURITY: no shell interpreter is ever involved.
//!
//! The Windows path used to be `cmd /C start "" <target>` with the target
//! passed via `Command::arg`. That is exploitable: `cmd.exe` does not parse its
//! command line with the MSVCRT `argv` rules that Rust escapes for, so the `\"`
//! Rust emits for an embedded quote is read by cmd as a literal backslash plus
//! a quote *toggle*. A URL like `https://example.com/"&calc.exe&"` therefore
//! satisfied a `starts_with("https://")` check and then executed `calc.exe`;
//! `%VAR%` also expanded inside the quotes. The same hole existed for a repo
//! file named `x"&calc&".txt` via `open_in_editor`.
//!
//! Both paths now go through `open_with_default_app`, which spawns
//! `rundll32 url.dll,FileProtocolHandler <target>` on Windows — a plain
//! process, no metacharacters, no environment expansion — and always checks
//! the child's exit status.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

use url::Url;

use crate::error::{AppError, AppResult};

/// `(program, leading args)` for the platform's default-handler launcher.
#[cfg(target_os = "macos")]
const OPENER: (&str, &[&str]) = ("open", &[]);
#[cfg(target_os = "windows")]
const OPENER: (&str, &[&str]) = ("rundll32.exe", &["url.dll,FileProtocolHandler"]);
/// Linux and every other unix: freedesktop's opener.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const OPENER: (&str, &[&str]) = ("xdg-open", &[]);

/// Parse + validate a URL we are willing to hand to the OS.
///
/// Requires `https` and a host, and rejects quotes / backticks / control
/// characters outright — defense in depth, since a quote in a release URL is
/// never legitimate. Returns the URL's *serialization*, so whatever the parser
/// normalizes or percent-encodes is what actually reaches the OS.
pub fn safe_url(raw: &str) -> AppResult<String> {
    if raw
        .chars()
        .any(|c| c.is_control() || c == '"' || c == '\'' || c == '`')
    {
        return Err(AppError::InvalidUrl(format!(
            "url contains a quote or control character: {raw}"
        )));
    }
    let parsed = Url::parse(raw)
        .map_err(|e| AppError::InvalidUrl(format!("unparseable url ({e}): {raw}")))?;
    if parsed.scheme() != "https" {
        return Err(AppError::InvalidUrl(format!(
            "refusing to open a non-https url: {raw}"
        )));
    }
    if !parsed.has_host() {
        return Err(AppError::InvalidUrl(format!("url has no host: {raw}")));
    }
    Ok(parsed.to_string())
}

/// Resolve a repo-relative path against `workdir`, refusing anything that
/// escapes it. `Path::join` silently *replaces* the base when given an absolute
/// path, so an unvalidated frontend string could otherwise name any file on
/// disk and have the OS launch it.
pub fn safe_workdir_path(workdir: &Path, relative: &str) -> AppResult<PathBuf> {
    let rel = Path::new(relative);
    let escapes = rel.components().any(|c| {
        matches!(
            c,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if relative.is_empty() || escapes {
        return Err(AppError::InvalidPath(format!(
            "path escapes the repository worktree: {relative}"
        )));
    }
    Ok(workdir.join(rel))
}

/// Hand `target` (a validated URL or path) to the OS default handler.
///
/// Checks the child's exit status: `xdg-open` exits 3 when no handler exists,
/// which the previous `let _ = …status()` reported as success while nothing
/// opened.
pub async fn open_with_default_app(target: &OsStr) -> AppResult<()> {
    let (prog, pre) = OPENER;
    let status = tokio::process::Command::new(prog)
        .args(pre)
        .arg(target)
        .status()
        .await
        .map_err(|e| AppError::Io(format!("failed to run {prog}: {e}")))?;
    if !status.success() {
        return Err(AppError::Io(format!(
            "{prog} exited with {status} while opening {}",
            target.to_string_lossy()
        )));
    }
    Ok(())
}
