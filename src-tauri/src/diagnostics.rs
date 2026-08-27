//! What the log needs to say about the machine it was written on, and how the
//! app hands that log to the person reading it.
//!
//! # Why this module exists
//!
//! A log that records only what the app did is not enough to diagnose a report
//! from someone else's machine. A WSL log and a native-Linux log were byte-for
//! -byte indistinguishable in their headers, so identifying which one a user had
//! pasted meant comparing an incidental detail — the character count of a
//! resolved `PATH` — against a known-good log (#274). That is not a diagnostic
//! procedure, that is a coincidence.
//!
//! So [`environment_line`] writes the facts down once, at startup, in a form
//! that survives being copied into an issue: one `key=value` line, greppable,
//! naming the platform, the kernel, whether this is WSL, and git's version.
//!
//! # Shape
//!
//! Everything that can be decided from data is a pure function over
//! [`HostFacts`] or [`WslFacts`] — [`describe_wsl`], [`environment_line`],
//! [`tail_lines`], [`mount_warning`] — and unit-tested as such.
//! [`read_wsl_facts`] and [`read_host_facts`] are the only parts that touch the
//! host, so the interesting logic is testable without a WSL machine to test it
//! on.
//!
//! The two fact types are split by COST, not by topic: [`WslFacts`] is two file
//! reads and is safe on the repository-open path, while [`HostFacts`] spawns
//! `git --version` and belongs only where a subprocess is already acceptable.

use std::path::Path;

/// Bytes of the log file's tail that [`crate::commands::diagnostics`] will read.
///
/// The log rotates at 5 MB (`lib.rs`), and the whole point of the copy action is
/// that the result gets pasted into an issue — so the cap is about what is
/// useful to read, not what is possible to read. A megabyte is thousands of
/// lines, far past the last launch.
pub const TAIL_CAP_BYTES: u64 = 1024 * 1024;

/// Facts about the machine, as read from the host.
///
/// Deliberately all-owned strings rather than borrowed: the values come from
/// three different places (compile-time constants, `/proc`, a subprocess) with
/// nothing to borrow from in common.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct HostFacts {
    /// `std::env::consts::OS` — `"linux"`, `"macos"`, `"windows"`.
    pub os: String,
    /// `std::env::consts::ARCH` — `"x86_64"`, `"aarch64"`.
    pub arch: String,
    /// The WSL signals, which cost no subprocess. See [`WslFacts`].
    pub wsl: WslFacts,
    /// `git --version`'s version field, or `None` when git could not be run.
    ///
    /// `None` is itself a finding: the `.deb` depends on git, so a missing git
    /// on a packaged install means something is badly wrong with the
    /// environment — and every git operation would fail with a message that
    /// blames the repository rather than the missing binary.
    ///
    /// **This is the one field that costs a process spawn**, which is why it
    /// lives behind [`host_facts`] and not [`wsl_facts`].
    pub git_version: Option<String>,
}

/// Just enough to answer "is this WSL, and is that path a Windows drive?".
///
/// Split out from [`HostFacts`] because it needs **no subprocess** — two reads,
/// one of `/proc` and one of the environment. `open_repo` consults it on every
/// call to decide whether to warn about a `/mnt/<drive>` path, and adding a
/// `git --version` spawn to the repository-open path would be a real cost paid
/// for a field that question does not use. It is also the path e2e exercises
/// within a second of launch, while the login-shell PATH probe still holds the
/// startup thread — so `open_repo` would lose that race and pay for the spawn
/// itself rather than inheriting a warm cache.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WslFacts {
    /// Kernel release, Linux only (`/proc/sys/kernel/osrelease`).
    pub kernel: Option<String>,
    /// `$WSL_DISTRO_NAME`, when WSL set it.
    pub wsl_distro: Option<String>,
}

/// Whether a kernel release string is a WSL kernel.
///
/// Microsoft's WSL2 kernels are tagged `-microsoft-standard-WSL2`; WSL1 reports
/// `-Microsoft`. Both markers are checked case-insensitively because the casing
/// has changed across releases and neither spelling is a promise.
///
/// This is the reliable signal, not `$WSL_DISTRO_NAME`: the environment variable
/// is absent from a process that did not inherit it (a `.desktop` launch through
/// some session managers), while the kernel is the kernel.
pub fn is_wsl_kernel(kernel: &str) -> bool {
    let lower = kernel.to_ascii_lowercase();
    lower.contains("microsoft") || lower.contains("wsl")
}

/// How to describe the WSL situation in the header, or `None` when not on WSL.
///
/// The distro name is included when known because "WSL" alone does not say
/// which userland — and a report against Ubuntu 24.04 and one against a
/// hand-rolled Arch install are not the same report.
pub fn describe_wsl(facts: &WslFacts) -> Option<String> {
    let on_wsl = facts.kernel.as_deref().is_some_and(is_wsl_kernel);
    // The env var alone is enough to conclude WSL: nothing else sets it.
    let named = facts.wsl_distro.as_deref().filter(|d| !d.is_empty());
    match (on_wsl, named) {
        (_, Some(distro)) => Some(distro.to_string()),
        (true, None) => Some("yes".to_string()),
        (false, None) => None,
    }
}

/// Extract the version from `git --version`'s stdout.
///
/// git prints `git version 2.43.0`, and on macOS with the Xcode shim
/// `git version 2.39.5 (Apple Git-154)`. The whole trailing remainder is kept —
/// the vendor suffix is a fact worth having — but the fixed `git version`
/// prefix is dropped so the header does not read `git=git version 2.43.0`.
pub fn parse_git_version(stdout: &str) -> Option<String> {
    let line = stdout.lines().next()?.trim();
    let version = line.strip_prefix("git version ").unwrap_or(line).trim();
    (!version.is_empty()).then(|| version.to_string())
}

/// The startup header: one line of `key=value` facts about this machine.
///
/// Absent values are OMITTED rather than written as `unknown`. A header that
/// lists everything it does not know buries the three fields that matter on the
/// platform in question — `kernel` and `wsl` are meaningless on macOS, and a
/// reader scanning for them should see their absence, not a column of noise.
pub fn environment_line(facts: &HostFacts) -> String {
    let mut parts = vec![
        format!("os={}", facts.os),
        format!("arch={}", facts.arch),
    ];
    if let Some(kernel) = facts.wsl.kernel.as_deref().filter(|k| !k.is_empty()) {
        parts.push(format!("kernel={kernel}"));
    }
    if let Some(wsl) = describe_wsl(&facts.wsl) {
        parts.push(format!("wsl={wsl}"));
    }
    match facts.git_version.as_deref() {
        Some(v) => parts.push(format!("git={v}")),
        // Spelled out, unlike the other absences: this one is a fault, not an
        // irrelevance, and it explains every git failure that follows it.
        None => parts.push("git=UNAVAILABLE".to_string()),
    }
    format!("host {}", parts.join(" "))
}

/// A warning about where a repository lives, or `None` when there is nothing to
/// say.
///
/// `/mnt/<drive>` under WSL is a Windows filesystem reached over a VM boundary,
/// where every `stat` costs orders of magnitude more than on ext4. libgit2 stats
/// the entire worktree for a status, so the cost lands on the operations the UI
/// runs on every refresh: a `/mnt/c` repository spent 9.8s on the startup
/// fan-out that a native path completes in well under a second (#274).
///
/// This is logged rather than surfaced as an error because it is not one — the
/// repository works, it is merely slow, and the user may have no choice about
/// where it lives. But an unexplained nine-second launch reads as a broken app,
/// and one line in the log turns it into a known cost with a known cause.
pub fn mount_warning(path: &Path, facts: &WslFacts) -> Option<String> {
    if describe_wsl(facts).is_none() {
        return None;
    }
    let text = path.to_string_lossy();
    // `/mnt/c`, not merely `/mnt`: a user's own bind mount under /mnt is not a
    // drvfs drive, and warning about it would be wrong. WSL maps drives as a
    // single letter.
    let drive = text
        .strip_prefix("/mnt/")
        .and_then(|rest| rest.chars().next())
        .filter(|c| c.is_ascii_alphabetic())
        .filter(|_| {
            let rest = &text["/mnt/".len()..];
            rest.len() == 1 || rest[1..].starts_with('/')
        })?;
    Some(format!(
        "repository is on Windows drive {}: via /mnt — every file operation \
         crosses the WSL filesystem boundary, so status and diff will be slow. \
         A repository inside the Linux filesystem (~/) is dramatically faster.",
        drive.to_ascii_uppercase()
    ))
}

/// The last `n` lines of `content`.
///
/// `content` may begin mid-line, because the caller seeks to a byte offset
/// rather than reading a whole multi-megabyte file. A partial first line is
/// therefore dropped whenever anything was truncated — a half-timestamp at the
/// top of a pasted log invites the reader to draw a conclusion from a record
/// that was never written that way.
pub fn tail_lines(content: &str, n: usize, truncated: bool) -> String {
    let mut lines: Vec<&str> = content.lines().collect();
    if truncated && !lines.is_empty() {
        lines.remove(0);
    }
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

/// The WSL signals, read once per process. **Spawns nothing.**
///
/// This is what `open_repo` calls. Kept deliberately separate from
/// [`host_facts`] so the repository-open path never waits on a process, and
/// never blocks behind a [`host_facts`] initialisation that is mid-`git
/// --version` on another thread.
pub fn wsl_facts() -> &'static WslFacts {
    static FACTS: std::sync::OnceLock<WslFacts> = std::sync::OnceLock::new();
    FACTS.get_or_init(read_wsl_facts)
}

/// The full facts including git's version, read once per process.
///
/// [`read_host_facts`] spawns `git --version`, so this is for the two callers
/// that actually want it — the startup header and the Settings report — both of
/// which are already off the main thread and neither of which is on a hot path.
pub fn host_facts() -> &'static HostFacts {
    static FACTS: std::sync::OnceLock<HostFacts> = std::sync::OnceLock::new();
    FACTS.get_or_init(read_host_facts)
}

/// Read the WSL signals: one `/proc` read and one environment read.
pub fn read_wsl_facts() -> WslFacts {
    WslFacts {
        kernel: read_kernel(),
        wsl_distro: std::env::var("WSL_DISTRO_NAME").ok(),
    }
}

/// Read the host's facts. Spawns git; not pure.
pub fn read_host_facts() -> HostFacts {
    HostFacts {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        // Reuses the cheap cache rather than re-reading /proc.
        wsl: wsl_facts().clone(),
        git_version: read_git_version(),
    }
}

/// Kernel release on Linux; `None` elsewhere, where the file does not exist and
/// the value would not be the WSL signal anyway.
fn read_kernel() -> Option<String> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::fs::read_to_string("/proc/sys/kernel/osrelease")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// `git --version`, via [`crate::proc`] like every other spawn in this codebase.
fn read_git_version() -> Option<String> {
    let out = crate::proc::program("git").arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_git_version(&String::from_utf8_lossy(&out.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_both_wsl_kernel_spellings() {
        assert!(is_wsl_kernel("5.15.153.1-microsoft-standard-WSL2"));
        assert!(is_wsl_kernel("4.4.0-19041-Microsoft"));
        // A real native kernel must not be mistaken for one.
        assert!(!is_wsl_kernel("6.8.0-45-generic"));
        assert!(!is_wsl_kernel("6.6.87.2-hardened"));
    }

    #[test]
    fn names_the_distro_when_wsl_exported_it() {
        let facts = WslFacts {
            kernel: Some("5.15.153.1-microsoft-standard-WSL2".into()),
            wsl_distro: Some("Ubuntu-24.04".into()),
        };
        assert_eq!(describe_wsl(&facts).as_deref(), Some("Ubuntu-24.04"));
    }

    #[test]
    fn still_reports_wsl_when_the_env_var_did_not_survive_the_launch() {
        // The case the env var alone would miss: a `.desktop` launch that did
        // not inherit WSL's environment. The kernel still gives it away, and
        // this is why `describe_wsl` consults it at all.
        let facts = WslFacts {
            kernel: Some("5.15.153.1-microsoft-standard-WSL2".into()),
            wsl_distro: None,
        };
        assert_eq!(describe_wsl(&facts).as_deref(), Some("yes"));
    }

    #[test]
    fn says_nothing_about_wsl_on_a_native_host() {
        let wsl = WslFacts {
            kernel: Some("6.8.0-45-generic".into()),
            wsl_distro: None,
        };
        assert_eq!(describe_wsl(&wsl), None);
        let facts = HostFacts { wsl, ..Default::default() };
        assert!(!environment_line(&facts).contains("wsl="));
    }

    #[test]
    fn parses_git_version_with_and_without_a_vendor_suffix() {
        assert_eq!(parse_git_version("git version 2.43.0\n").as_deref(), Some("2.43.0"));
        assert_eq!(
            parse_git_version("git version 2.39.5 (Apple Git-154)\n").as_deref(),
            Some("2.39.5 (Apple Git-154)")
        );
        assert_eq!(parse_git_version(""), None);
        assert_eq!(parse_git_version("   \n"), None);
    }

    #[test]
    fn header_reads_as_one_greppable_line() {
        let facts = HostFacts {
            os: "linux".into(),
            arch: "x86_64".into(),
            wsl: WslFacts {
                kernel: Some("5.15.153.1-microsoft-standard-WSL2".into()),
                wsl_distro: Some("Ubuntu-24.04".into()),
            },
            git_version: Some("2.43.0".into()),
        };
        assert_eq!(
            environment_line(&facts),
            "host os=linux arch=x86_64 kernel=5.15.153.1-microsoft-standard-WSL2 \
             wsl=Ubuntu-24.04 git=2.43.0"
        );
        assert!(!environment_line(&facts).contains('\n'));
    }

    #[test]
    fn a_missing_git_is_stated_not_omitted() {
        // Every other absent field is dropped; this one must not be, because it
        // pre-explains every git failure in the rest of the log.
        let facts = HostFacts {
            os: "linux".into(),
            arch: "x86_64".into(),
            git_version: None,
            ..Default::default()
        };
        assert!(environment_line(&facts).contains("git=UNAVAILABLE"));
    }

    fn on_wsl() -> WslFacts {
        WslFacts {
            kernel: Some("5.15.153.1-microsoft-standard-WSL2".into()),
            wsl_distro: None,
        }
    }

    #[test]
    fn warns_about_a_repository_on_a_windows_drive() {
        let w = mount_warning(Path::new("/mnt/c/Users/jonas/dev/app"), &on_wsl());
        assert!(w.is_some());
        assert!(w.unwrap().contains("Windows drive C:"));
    }

    #[test]
    fn says_nothing_about_a_repository_in_the_linux_filesystem() {
        assert_eq!(mount_warning(Path::new("/home/jonas/dev/app"), &on_wsl()), None);
    }

    #[test]
    fn does_not_mistake_an_ordinary_mount_for_a_windows_drive() {
        // A multi-character entry under /mnt is somebody's own mount, not a
        // drvfs drive letter. Warning about it would be confidently wrong.
        assert_eq!(mount_warning(Path::new("/mnt/data/repos/app"), &on_wsl()), None);
        assert_eq!(mount_warning(Path::new("/mnt/backup"), &on_wsl()), None);
        // The bare drive root is still a drive.
        assert!(mount_warning(Path::new("/mnt/d"), &on_wsl()).is_some());
    }

    #[test]
    fn never_warns_about_a_mount_path_off_wsl() {
        // `/mnt/c` on a native Linux box is just a directory.
        let native = WslFacts {
            kernel: Some("6.8.0-45-generic".into()),
            wsl_distro: None,
        };
        assert_eq!(mount_warning(Path::new("/mnt/c/repos/app"), &native), None);
    }

    #[test]
    fn tail_returns_the_last_lines_in_order() {
        let content = "a\nb\nc\nd\ne";
        assert_eq!(tail_lines(content, 2, false), "d\ne");
        // Asking for more than there is yields everything, not an error.
        assert_eq!(tail_lines(content, 99, false), content);
        assert_eq!(tail_lines("", 5, false), "");
    }

    #[test]
    fn tail_drops_a_line_the_seek_cut_in_half() {
        // What a mid-file seek actually produces: the first line is a fragment.
        // Keeping it would put a half-written timestamp at the top of a log
        // somebody is about to reason from.
        assert_eq!(tail_lines("53][INFO] half\nb\nc", 5, true), "b\nc");
        // Nothing was truncated, so nothing is dropped.
        assert_eq!(tail_lines("a\nb\nc", 5, false), "a\nb\nc");
    }
}
