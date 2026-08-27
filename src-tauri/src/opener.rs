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

/// Is `candidate` strictly inside `root`?
///
/// PURE — no filesystem access; both sides are compared as already-resolved
/// paths. Component-wise, because a string `starts_with` reads `/repository` as
/// a child of `/repo` and `/repo-backup` as a child of `/repo` too. "Strictly"
/// means the root itself is NOT contained: a caller asking about "the workdir,
/// relative to the workdir" is asking about the repository, not about something
/// inside it, and a destructive caller must never resolve to it.
///
/// Case is compared exactly. Both sides reach here from `fs::canonicalize`,
/// which returns the on-disk spelling, so a case-insensitive filesystem hands
/// us matching prefixes anyway — folding here would instead make `/Repo` and
/// `/repo` interchangeable on a case-SENSITIVE filesystem, where they are two
/// different directories.
pub fn contained_in(root: &Path, candidate: &Path) -> bool {
    match candidate.strip_prefix(root) {
        Ok(rest) => rest.components().next().is_some(),
        Err(_) => false,
    }
}

/// Resolve a repo-relative path against `workdir` and PROVE, against the real
/// filesystem, that it lands inside it (#245).
///
/// [`safe_workdir_path`] is a LEXICAL check: it refuses `..`, absolute paths and
/// Windows prefixes, which is enough for "hand this string to an application".
/// It is not enough for a caller that will unlink the result, because it cannot
/// see symlinks — `repo/out -> /etc` makes `out/passwd` an innocent-looking
/// relative path with no `..` anywhere in it.
///
/// So this canonicalizes both sides and re-checks containment with
/// [`contained_in`]:
///
/// - The **workdir** is canonicalized too, not just the candidate. On macOS a
///   tempdir lives under `/var`, which is itself a symlink to `/private/var`,
///   so comparing a raw workdir against a canonicalized candidate would refuse
///   everything.
/// - The candidate's **parent** is canonicalized and the final component
///   re-joined, rather than canonicalizing the whole path: that resolves every
///   intermediate symlink while leaving the entry itself unfollowed, so a
///   missing file still resolves — its absence is the caller's business to
///   report, and a delete that reported "escapes the worktree" for a file
///   somebody else already removed would be a lie.
/// - A **symlink** as the final component is refused unless its own target
///   canonicalizes inside the workdir. Unlinking a symlink does not touch what
///   it points at, so this is stricter than it has to be, and deliberately: a
///   link is not the file the user is looking at in the list, and "refuse and
///   say so" beats reasoning about link semantics per platform on a
///   destructive path. A link we cannot resolve at all (a broken one) is
///   refused for the same reason.
pub fn resolved_workdir_path(workdir: &Path, relative: &str) -> AppResult<PathBuf> {
    let joined = safe_workdir_path(workdir, relative)?;
    let root = workdir.canonicalize().map_err(|e| {
        AppError::InvalidPath(format!(
            "cannot resolve the repository worktree {}: {e}",
            workdir.display()
        ))
    })?;
    let (parent, name) = match (joined.parent(), joined.file_name()) {
        (Some(parent), Some(name)) => (parent, name),
        // `safe_workdir_path` already refused the empty string and every root /
        // prefix component, and a trailing `..` with it — so this is
        // unreachable in practice. Still an error rather than a panic.
        _ => {
            return Err(AppError::InvalidPath(format!(
                "path names no entry: {relative}"
            )))
        }
    };
    let parent = parent.canonicalize().map_err(|e| {
        AppError::InvalidPath(format!(
            "cannot resolve the directory holding {relative}: {e}"
        ))
    })?;
    let resolved = parent.join(name);
    if !contained_in(&root, &resolved) {
        return Err(AppError::InvalidPath(format!(
            "path escapes the repository worktree: {relative}"
        )));
    }
    if std::fs::symlink_metadata(&resolved).is_ok_and(|m| m.is_symlink()) {
        let target = resolved.canonicalize().map_err(|e| {
            AppError::InvalidPath(format!(
                "refusing to act on a symbolic link whose target cannot be resolved ({e}): {relative}"
            ))
        })?;
        if !contained_in(&root, &target) {
            return Err(AppError::InvalidPath(format!(
                "refusing to act on a symbolic link that leaves the repository worktree: {relative}"
            )));
        }
    }
    Ok(resolved)
}

/// The launcher executable to spawn.
///
/// SECURITY (Windows): `CreateProcess` searches the **current directory before
/// the system directory**, so a bare `rundll32.exe` lookup is a binary-planting
/// hole — a cloned repository containing its own `rundll32.exe` would be run
/// instead of the real one, and the app's cwd *is* the repository whenever it
/// was launched by the `pgit` shim from inside one. Pin the path to
/// `%SystemRoot%\System32` so only the real launcher can ever be spawned.
///
/// Written with a runtime `cfg!` rather than `#[cfg]`-gated bodies so the
/// Windows branch is still type-checked when building on macOS and Linux.
fn opener_program() -> std::ffi::OsString {
    let (prog, _) = OPENER;
    if cfg!(target_os = "windows") {
        let root = std::env::var_os("SystemRoot")
            .unwrap_or_else(|| std::ffi::OsString::from(r"C:\Windows"));
        return Path::new(&root)
            .join("System32")
            .join(prog)
            .into_os_string();
    }
    // On unix `execvp` does not search the working directory, so the PATH
    // lookup that finds `open` / `xdg-open` is not attacker-influenced.
    std::ffi::OsString::from(prog)
}

/// Hand `target` (a validated URL or path) to the OS default handler.
///
/// Checks the child's exit status: `xdg-open` exits 3 when no handler exists,
/// which the previous `let _ = …status()` reported as success while nothing
/// opened.
pub async fn open_with_default_app(target: &OsStr) -> AppResult<()> {
    let (_, pre) = OPENER;
    let prog = opener_program();
    let shown = prog.to_string_lossy().to_string();
    // `rundll32.exe` is GUI-subsystem, so CREATE_NO_WINDOW is documented as
    // ignored for it — routed through `proc` anyway, because "the only sanctioned
    // way to spawn" is worth more than the one site's exemption (issue 172).
    let status = crate::proc::program_async(&prog)
        .args(pre)
        .arg(target)
        .status()
        .await
        .map_err(|e| AppError::Io(format!("failed to run {shown}: {e}")))?;
    if !status.success() {
        return Err(AppError::Io(format!(
            "{shown} exited with {status} while opening {}",
            target.to_string_lossy()
        )));
    }
    Ok(())
}
