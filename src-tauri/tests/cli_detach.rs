//! The detached `pgit` launch (#163) — and, above all, the three things that
//! must NOT detach.
//!
//! `detach::should_detach`'s unit tests cover the decision table. These drive
//! the REAL binary, because the decision is only half of it: the askpass path
//! has to keep answering git on its own stdout, synchronously, and no unit test
//! of a pure function can show that.
//!
//! Two of the tests run the binary with a **real terminal** on its stdout (a
//! pty), which is the condition the detach is gated on — so they fail if the
//! gate ever widens to cover askpass or `--help`.
#![cfg(unix)]

use std::ffi::{CString, OsString};
use std::io::{Read, Write};
use std::os::fd::FromRawFd;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use platypusgit_lib::cli::{ASKPASS_MODE_ENV, ASKPASS_SECRET_ENV, ASKPASS_USERNAME_ENV, USAGE};
use platypusgit_lib::commands::net::{apply_auth_env, Credentials};
use platypusgit_lib::detach::{spawn_detached, DETACHED_ENV};

/// The real app binary — the same file every `pgit` shim points at.
const EXE: &str = env!("CARGO_BIN_EXE_platypusgit");

// ─────────────────────────────────────────────────────────────
// A real terminal on the child's stdout
// ─────────────────────────────────────────────────────────────

struct PtyRun {
    output: String,
    code: Option<i32>,
}

/// Run `cmd` with a freshly allocated pty on its stdout and stderr, so
/// `IsTerminal` inside the child answers *yes*.
///
/// Two traps, both hit while writing this:
///
/// * The master is drained on a **thread**, not after `wait`. A pty buffer holds
///   about a kilobyte, so a child printing `USAGE` could otherwise fill it and
///   block against a parent blocked in `wait`.
/// * The master is **non-blocking**, and the reader stops when the child is
///   gone rather than at end-of-file. macOS does not report EOF on a master whose
///   slaves have all closed — the slave could be reopened — so a read there
///   blocks forever, where Linux raises EIO.
fn run_in_pty(mut cmd: Command) -> PtyRun {
    unsafe {
        let master = libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY);
        assert!(master >= 0, "posix_openpt failed");
        assert_eq!(libc::grantpt(master), 0, "grantpt failed");
        assert_eq!(libc::unlockpt(master), 0, "unlockpt failed");
        let name = libc::ptsname(master);
        assert!(!name.is_null(), "ptsname failed");
        let slave_path = CString::new(std::ffi::CStr::from_ptr(name).to_bytes()).unwrap();
        let slave = libc::open(slave_path.as_ptr(), libc::O_RDWR | libc::O_NOCTTY);
        assert!(slave >= 0, "open slave pty failed");

        let out = libc::dup(slave);
        let err = libc::dup(slave);
        assert!(out >= 0 && err >= 0, "dup slave pty failed");

        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::from_raw_fd(out))
            .stderr(Stdio::from_raw_fd(err))
            .spawn()
            .expect("spawn the app binary");
        // Our own copy must go, or the child is not the only writer left.
        libc::close(slave);
        assert_eq!(
            libc::fcntl(master, libc::F_SETFL, libc::O_NONBLOCK),
            0,
            "set the pty master non-blocking"
        );

        let mut master_file = std::fs::File::from_raw_fd(master);
        let gone = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reader = {
            let gone = gone.clone();
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 4096];
                loop {
                    match master_file.read(&mut chunk) {
                        Ok(0) => break,
                        Ok(n) => buf.extend_from_slice(&chunk[..n]),
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                            // Nothing buffered: done only if the writer is gone.
                            if gone.load(std::sync::atomic::Ordering::SeqCst) {
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                        Err(_) => break,
                    }
                }
                buf
            })
        };
        let status = child.wait().expect("wait for the app binary");
        gone.store(true, std::sync::atomic::Ordering::SeqCst);
        let buf = reader.join().expect("pty reader thread");
        PtyRun {
            // A terminal translates \n into \r\n on the way out.
            output: String::from_utf8_lossy(&buf).replace("\r\n", "\n"),
            code: status.code(),
        }
    }
}

/// A launch would detach here, so every one of these must be cleared: an
/// inherited value would answer the very question the test is asking.
fn clean_env(cmd: &mut Command) {
    cmd.env_remove(ASKPASS_MODE_ENV)
        .env_remove(ASKPASS_USERNAME_ENV)
        .env_remove(ASKPASS_SECRET_ENV)
        .env_remove(DETACHED_ENV);
}

#[test]
fn askpass_answers_on_stdout_even_with_a_terminal_attached() {
    let mut cmd = Command::new(EXE);
    clean_env(&mut cmd);
    cmd.arg("Password for 'https://example.invalid': ")
        .env(ASKPASS_MODE_ENV, "1")
        .env(ASKPASS_SECRET_ENV, "s3cr3t-through-a-pty");

    let run = run_in_pty(cmd);

    assert_eq!(run.code, Some(0), "askpass output was: {:?}", run.output);
    assert_eq!(
        run.output.trim_end(),
        "s3cr3t-through-a-pty",
        "git reads the credential from this stdout, synchronously — a detached \
         askpass writes nothing and every authenticated fetch/pull/push fails"
    );
}

#[test]
fn a_username_prompt_is_answered_too_with_a_terminal_attached() {
    let mut cmd = Command::new(EXE);
    clean_env(&mut cmd);
    cmd.arg("Username for 'https://example.invalid': ")
        .env(ASKPASS_MODE_ENV, "1")
        .env(ASKPASS_USERNAME_ENV, "ada")
        .env(ASKPASS_SECRET_ENV, "s3cr3t-through-a-pty");

    let run = run_in_pty(cmd);

    assert_eq!(run.code, Some(0));
    assert_eq!(run.output.trim_end(), "ada");
}

#[test]
fn an_unrecognised_prompt_still_exits_nonzero_with_no_output() {
    // The pre-existing contract: never print an empty string, which git would
    // take as a real credential. A detach would have exited 0 with no output.
    let mut cmd = Command::new(EXE);
    clean_env(&mut cmd);
    cmd.arg("Some prompt we do not understand: ")
        .env(ASKPASS_MODE_ENV, "1")
        .env(ASKPASS_SECRET_ENV, "s3cr3t-through-a-pty");

    let run = run_in_pty(cmd);

    assert_eq!(run.code, Some(1));
    assert_eq!(run.output.trim(), "");
}

#[test]
fn help_prints_usage_and_exits_even_with_a_terminal_attached() {
    let mut cmd = Command::new(EXE);
    clean_env(&mut cmd);
    cmd.arg("--help");

    let run = run_in_pty(cmd);

    assert_eq!(run.code, Some(0));
    assert_eq!(
        run.output, USAGE,
        "USAGE must reach the terminal that asked for it, not a detached \
         child's /dev/null"
    );
}

// ─────────────────────────────────────────────────────────────
// The credentialed regression test: real git → the real binary
// ─────────────────────────────────────────────────────────────

/// `git credential fill` is git's own credential machinery, offline: with no
/// helper to answer it, it prompts through `GIT_ASKPASS` exactly as a 401'd
/// fetch/pull/push does, and reads the answer from the child's stdout —
/// synchronously, one line per prompt.
///
/// The environment comes from the production `apply_auth_env`, so this is the
/// real policy and not a hand-rolled imitation of it. `GIT_ASKPASS` is the one
/// value overridden: `apply_auth_env` points it at `current_exe()`, which under
/// `cargo test` is the test harness, and the point here is to drive the app
/// binary.
#[test]
fn a_credentialed_git_prompt_is_answered_by_the_real_binary() {
    let git_available = std::process::Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !git_available {
        eprintln!("SKIP: git not on PATH");
        return;
    }
    let home = tempfile::tempdir().expect("tempdir");

    let creds = Credentials {
        username: Some("ada".into()),
        secret: "ghp_supersecret".into(),
    };
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("-c")
        // Belt to the isolated config's brace: a helper would answer without
        // ever consulting the askpass, and the test would pass for nothing.
        .arg("credential.helper=")
        .args(["credential", "fill"]);
    apply_auth_env(&mut cmd, Some(&creds));
    cmd.env("GIT_ASKPASS", EXE)
        .env("SSH_ASKPASS", EXE)
        // No system, global or repo config, and a cwd that is not a repository.
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("HOME", home.path())
        .current_dir(home.path());

    let mut child = cmd
        .into_std()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn git credential fill");
    child
        .stdin
        .take()
        .expect("stdin")
        .write_all(b"protocol=https\nhost=example.invalid\n\n")
        .expect("write the credential request");
    let out = child.wait_with_output().expect("git credential fill");

    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        out.status.success(),
        "git credential fill failed: {stderr}\n{stdout}"
    );
    // GIT_TERMINAL_PROMPT=0 is part of the same policy, so these two lines can
    // only have come from the askpass shim.
    assert!(
        stdout.contains("username=ada"),
        "git did not get the username from the askpass shim: {stdout}"
    );
    assert!(
        stdout.contains("password=ghp_supersecret"),
        "git did not get the password from the askpass shim: {stdout}"
    );
}

// ─────────────────────────────────────────────────────────────
// The detach mechanism itself
// ─────────────────────────────────────────────────────────────

/// A probe standing in for the app: it records what a detached child actually
/// inherits, then writes it to a **relative** path — the same thing
/// `pgit ../other-repo` depends on.
///
/// Every value is read before the output redirect, since a command substitution
/// would replace fd 1 with a pipe and the stdout answers would describe that
/// pipe instead of what was inherited.
const PROBE: &str = r#"#!/bin/sh
out=$1
delay=$2
if [ -t 1 ]; then stdout_tty=yes; else stdout_tty=no; fi
if [ -c /dev/fd/1 ]; then stdout_chardev=yes; else stdout_chardev=no; fi
if [ -t 0 ]; then stdin_tty=yes; else stdin_tty=no; fi
pgid=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
cwd=$(pwd)
sleep "$delay"
printf 'cwd=%s\nstdout_tty=%s\nstdout_chardev=%s\nstdin_tty=%s\npgid=%s\n' \
  "$cwd" "$stdout_tty" "$stdout_chardev" "$stdin_tty" "$pgid" > "$out"
"#;

fn field(text: &str, key: &str) -> String {
    text.lines()
        .find_map(|l| l.strip_prefix(&format!("{key}=")))
        .unwrap_or_else(|| panic!("no {key} in probe output:\n{text}"))
        .to_string()
}

fn wait_for(path: &Path) -> String {
    for _ in 0..200 {
        if let Ok(text) = std::fs::read_to_string(path) {
            if text.contains("pgid=") {
                return text;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    panic!("the detached child never wrote {}", path.display());
}

#[test]
fn a_detached_child_keeps_the_cwd_and_loses_the_terminal() {
    let dir = tempfile::tempdir().expect("tempdir");
    // getcwd() answers with the physical path, and on macOS a tempdir's
    // /var/folders/… is a symlink to /private/var/folders/….
    let cwd = dir.path().canonicalize().expect("canonicalize tempdir");
    let script = cwd.join("probe.sh");
    std::fs::write(&script, PROBE).expect("write the probe");

    let args: Vec<OsString> = vec![
        script.clone().into(),
        // Relative: only resolvable if the child's cwd is what we asked for.
        OsString::from("probe.txt"),
        OsString::from("1"),
    ];
    spawn_detached(Path::new("/bin/sh"), &args, &cwd).expect("spawn_detached");

    let out: PathBuf = cwd.join("probe.txt");
    assert!(
        !out.exists(),
        "spawn_detached returned only after the child finished — it must hand \
         the prompt back immediately"
    );

    let text = wait_for(&out);
    assert_eq!(
        field(&text, "cwd"),
        cwd.to_string_lossy(),
        "the child must inherit the invoking shell's directory"
    );
    assert_eq!(field(&text, "stdout_tty"), "no", "stdout still a terminal");
    assert_eq!(field(&text, "stdin_tty"), "no", "stdin still a terminal");
    assert_eq!(
        field(&text, "stdout_chardev"),
        "yes",
        "a char device that is no terminal is /dev/null; a pipe or a file is not"
    );

    // setsid: a new session, so closing the terminal cannot SIGHUP the app and
    // Ctrl+C in it cannot reach it.
    let pgid = field(&text, "pgid");
    if pgid.is_empty() {
        eprintln!("SKIP session check: `ps -o pgid=` produced nothing");
    } else {
        let ours = unsafe { libc::getpgrp() };
        assert_ne!(
            pgid,
            ours.to_string(),
            "the detached child stayed in our process group"
        );
    }
}

#[test]
fn an_unlaunchable_child_is_an_error_not_a_silent_orphan() {
    // What makes the caller able to fall back to a foreground launch instead of
    // exiting 0 with nothing running.
    let dir = tempfile::tempdir().expect("tempdir");
    let err = spawn_detached(
        Path::new("/nonexistent/platypusgit-detach-probe"),
        &[],
        dir.path(),
    );
    assert!(err.is_err(), "a failed exec must be reported");
}
