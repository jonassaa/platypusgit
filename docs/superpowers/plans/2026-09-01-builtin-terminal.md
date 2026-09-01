# Built-in Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resizable terminal panel running a real pty, one shell per repository tab, already `cd`-ed to that repository's working directory.

**Architecture:** `proc.rs` gains one function that owns the entire pty spawn, so the existing "no spawning outside `proc.rs`" guard keeps its meaning against a crate that spawns through its own builder. A Tauri-free `terminal.rs` holds the live sessions keyed by `RepoId` and pushes output through an injected event sink — which is what makes it testable without an `AppHandle`. Four thin commands wrap it. The frontend mounts one xterm.js instance per repository, sized by measurement rather than `ResizeObserver`.

**Tech Stack:** Rust + `portable-pty` 0.9, Tauri 2, React 19 + `@xterm/xterm` 6, Zustand, vitest, WebdriverIO.

**Spec:** `docs/superpowers/specs/2026-09-01-builtin-terminal-spec.md`

## Global Constraints

- **Toolchain:** Node 22 + pnpm, Rust stable. The assistant's Bash tool does not inherit the interactive shell rc — prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to every `pnpm` and `cargo` invocation.
- **Never `Command::new` outside `src-tauri/src/proc.rs`.** Extended by this work to `CommandBuilder::new`, `openpty(` and `spawn_command(`.
- **Every IPC-crossing fn returns `AppResult<T>`.** Add `AppError` variants, never stringify. The TS `AppError` union stays 1:1 with the Rust enum **in the same commit** — `test/appErrors.test.ts` fails the build otherwise.
- **Never call `invoke` directly from a component.** Typed wrappers in `src/lib/tauri.ts` only.
- **Design system is `src/design/`, imported from `@/design`.** Never hardcode the accent hue — CSS variables and theme tokens only. Do not create `src/components/ui/`.
- **No native `<select>`/`<option>` in shipped `src/`** — `PGSelect`. Never `window.confirm`/`window.prompt` — `pgConfirm`/`pgPrompt`.
- **`useRepoStore` holds exactly ONE repository's state.** The terminal deliberately does not put per-repo state there — see Task 5.
- **Measure viewports with `lib/useViewportH`/`useElementSize`** (read first, observe second). WebKitGTK has no `ResizeObserver`.
- **No telemetry, no account** is a build gate. `test/privacy.test.ts` + `src-tauri/tests/no_telemetry.rs`. Neither new dependency may add a network call or a hostname.
- **Commit style:** `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …`, imperative subject under 72 chars, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Branch:** `feat/builtin-terminal`, already created off `origin/main` in the worktree `.claude/worktrees/builtin-terminal`. Never commit to `main`.
- **Run e2e only when done, in Docker only:** `pnpm test:e2e:docker build` then `pnpm test:e2e:docker run --spec e2e/specs/terminal.e2e.ts`.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src-tauri/src/terminal.rs` | Session registry. Owns every live pty and its reader thread. Tauri-free. Contains **no logging macro** — see Task 2. |
| `src-tauri/src/commands/terminal.rs` | Four thin handlers. Resolves the workdir through the backend, supplies the event sink, logs lifecycle. |
| `src-tauri/tests/terminal.rs` | Integration tests against real ptys. |
| `src-tauri/tests/terminal_privacy.rs` | Guard: no logging of pty traffic. |
| `src/features/terminal/useTerminalStore.ts` | Panel open/height + per-repo session status. |
| `src/features/terminal/TerminalPanel.tsx` | The docked pane, its resize handle, its header. |
| `src/features/terminal/TerminalView.tsx` | One xterm.js instance for one repository. |
| `src/features/terminal/shellLabel.ts` | Pure: display name for a shell path. |
| `src/features/terminal/index.ts` | Feature barrel. |
| `src/features/terminal/useTerminalStore.test.ts` | Store logic. |
| `src/features/terminal/TerminalView.test.tsx` | View against a mocked xterm. |
| `src/features/terminal/shellLabel.test.ts` | Pure tests. |
| `e2e/specs/terminal.e2e.ts` | One end-to-end spec. |

**Modified**

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | `portable-pty = "0.9"`, `base64` if not already present |
| `src-tauri/src/proc.rs` | `PtySession`, `spawn_pty_shell`, `default_shell` |
| `src-tauri/src/lib.rs` | `pub mod terminal;`, `.manage(TerminalState::default())`, four `invoke_handler!` entries |
| `src-tauri/src/commands/mod.rs` | `pub mod terminal;` |
| `src-tauri/src/error.rs` | `TerminalUnavailable(String)` |
| `src-tauri/tests/spawn_no_window.rs` | pty-API allow-list |
| `package.json` | `@xterm/xterm` |
| `src/lib/types.ts` | `TermData`, `TermExit`, `TermSize` |
| `src/lib/tauri.ts` | `termOpen`, `termWrite`, `termResize`, `termClose` |
| `src/lib/errors.ts` | `TerminalUnavailable` union member + `appErrorDetail` prose |
| `src/features/settings/useSettingsStore.ts` | `terminalShell: string` |
| `src/screens/Settings.tsx` | Terminal section |
| `src/features/keymap/actions.ts` | `terminal.toggle` |
| `src/features/keymap/presets.ts` | Default chord `Ctrl+\`` |
| `src/features/repo/useTabsStore.ts` | `close()` also closes the terminal session |
| `src/AppShell.tsx` | Dock `TerminalPanel` in `AppBody` |
| `docs/dev/architecture.md` | Backend + feature tree entries (**gates the build**) |
| `docs/dev/backend.md` | The pty carve-out and the no-logging rule |
| `docs/dev/frontend.md` | The panel, the measured fit, the focus rule |
| `CLAUDE.md` | The near-identical filename pairs list goes from three to four |

---

### Task 1: The pty spawn carve-out in `proc.rs`

The whole pty spawn lives in `proc.rs` so the `Command::new` guard cannot be walked past by a crate that spawns through `CommandBuilder`. Nothing else in the tree may touch `portable_pty`'s spawn API.

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/proc.rs` (append after `git_dir`/the last constructor)
- Modify: `src-tauri/tests/spawn_no_window.rs:24-45` (`RAW_SPAWN_ALLOWED`) and append a new test
- Test: `src-tauri/tests/terminal.rs` (created here, grown in Task 2)

**Interfaces:**
- Consumes: `crate::proc::child_path()` — the existing login-`PATH` merge.
- Produces:
  - `pub struct PtySession { pub master: Box<dyn portable_pty::MasterPty + Send>, pub child: Box<dyn portable_pty::Child + Send + Sync> }`
  - `pub fn spawn_pty_shell(shell: &std::ffi::OsStr, workdir: &Path, rows: u16, cols: u16) -> std::io::Result<PtySession>`
  - `pub fn default_shell() -> std::ffi::OsString`

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`:

```toml
portable-pty = "0.9"
```

Check whether `base64` is already a dependency (`grep '^base64' src-tauri/Cargo.toml`). If not, add `base64 = "0.22"`.

- [ ] **Step 2: Write the failing test**

Create `src-tauri/tests/terminal.rs`:

```rust
//! The built-in terminal (#243), tested against real ptys.

use std::io::{Read, Write};
use std::time::{Duration, Instant};

/// Read from `reader` until `marker` appears or the deadline passes.
///
/// A pty delivers in chunks whose boundaries are not ours to choose, so every
/// assertion here is "the marker eventually appears", never "this read equals".
fn read_until(reader: &mut (dyn Read + Send), marker: &str, secs: u64) -> String {
    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut acc = String::new();
    let mut buf = [0u8; 4096];
    while Instant::now() < deadline {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                acc.push_str(&String::from_utf8_lossy(&buf[..n]));
                if acc.contains(marker) {
                    return acc;
                }
            }
            Err(_) => break,
        }
    }
    acc
}

#[test]
fn spawn_pty_shell_runs_in_the_given_workdir() {
    let dir = tempfile::tempdir().expect("tempdir");
    // Canonicalise: macOS hands out /var/folders/… which is a symlink to
    // /private/var/folders/…, and the shell reports the resolved one.
    let workdir = dir.path().canonicalize().expect("canonicalize");

    let session = platypusgit_lib::proc::spawn_pty_shell(
        &platypusgit_lib::proc::default_shell(),
        &workdir,
        24,
        80,
    )
    .expect("spawn a shell");

    let mut reader = session.master.try_clone_reader().expect("reader");
    let mut writer = session.master.take_writer().expect("writer");

    writeln!(writer, "printf 'PGIT[%s]END\\n' \"$PWD\"").expect("write");
    writer.flush().expect("flush");

    let out = read_until(&mut *reader, "END", 10);
    assert!(
        out.contains(&format!("PGIT[{}]END", workdir.display())),
        "the shell's cwd should be the workdir. saw: {out}"
    );
}

#[test]
fn spawn_pty_shell_rejects_a_shell_that_does_not_exist() {
    let dir = tempfile::tempdir().expect("tempdir");
    let err = platypusgit_lib::proc::spawn_pty_shell(
        std::ffi::OsStr::new("/nonexistent/pgit-not-a-shell"),
        dir.path(),
        24,
        80,
    );
    assert!(err.is_err(), "a missing shell must not silently succeed");
}
```

Confirm the crate's lib name — run `grep -n 'name' src-tauri/Cargo.toml | head` and check `[lib] name`. If it is not `platypusgit_lib`, use whatever the other integration tests import (`grep -rn '^use platypusgit' src-tauri/tests/ | head -1`) and fix the paths above.

- [ ] **Step 3: Run it to make sure it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test terminal
```

Expected: FAIL to compile — `no function named spawn_pty_shell`.

- [ ] **Step 4: Implement in `proc.rs`**

Append to `src-tauri/src/proc.rs`:

```rust
/// A live pty and the shell running on it.
///
/// Returned by [`spawn_pty_shell`], owned by `crate::terminal`. The master is
/// what resizes and what is read/written; the child is what gets killed.
pub struct PtySession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// The shell to run when the user has not named one.
///
/// `$SHELL` is what the user's own terminal runs, which is the whole point —
/// the built-in terminal should not be a different shell from the one outside
/// the app. `/bin/sh` exists on every unix and is the honest last resort.
#[cfg(not(windows))]
pub fn default_shell() -> std::ffi::OsString {
    std::env::var_os("SHELL")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::ffi::OsString::from("/bin/sh"))
}

/// Windows has no `$SHELL`. Preference order is best-to-worst experience:
/// PowerShell 7, then Windows PowerShell, then `cmd`. Resolution is left to
/// `PATH` — `where.exe`-style probing would be a second spawn path.
#[cfg(windows)]
pub fn default_shell() -> std::ffi::OsString {
    std::ffi::OsString::from("powershell.exe")
}

/// Spawn an INTERACTIVE shell on a fresh pty, `cd`-ed to `workdir` (#243).
///
/// # Why the whole spawn lives here rather than in `crate::terminal`
///
/// The rule this module exists to enforce is "no process spawn outside
/// `proc.rs`", and `tests/spawn_no_window.rs` enforces it by grepping for
/// `Command::new`. `portable_pty` spawns through its **own** `CommandBuilder`,
/// so a pty spawned anywhere else would sail straight past that guard — the
/// second spawn path the guard exists to prevent, and invisible. So this
/// function owns `openpty`, the `CommandBuilder` and `spawn_command`, and the
/// guard test allow-lists those three APIs here and nowhere else.
///
/// # What this child gets, and what it deliberately does not
///
/// * [`child_path`] — yes. A Dock-launched app inherits launchd's minimal
///   environment (#232); without this the built-in terminal would be the one
///   terminal on the machine where `node` is missing.
/// * `TERM=xterm-256color` — the terminal we actually render.
/// * `GIT_TERMINAL_PROMPT=0` — **no**, and this inverts the standing
///   [`prompt_less`] policy on purpose. That policy exists because a child of a
///   GUI app has no terminal, so an auth prompt hangs forever behind a window
///   nobody can see. This child *is* a terminal and the user is looking at it;
///   suppressing the prompt would turn a working `git push` into a mysterious
///   failure. Inherited silence would have been the bug.
/// * `CREATE_NO_WINDOW` — not applicable. ConPTY is not `CreateProcess` with an
///   inherited console: `portable_pty` allocates a pseudoconsole and no
///   `conhost` window appears, so #172's flash cannot happen here.
///
/// Nothing from the auth path goes near it — no forge token, no git credential,
/// no askpass environment — exactly as `run_custom_action` does it.
pub fn spawn_pty_shell(
    shell: &OsStr,
    workdir: &Path,
    rows: u16,
    cols: u16,
) -> std::io::Result<PtySession> {
    use portable_pty::{CommandBuilder, PtySize};

    let pty = portable_pty::native_pty_system();
    let pair = pty
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| std::io::Error::other(format!("could not open a pty: {e}")))?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(workdir);
    cmd.env("TERM", "xterm-256color");
    if let Some(p) = child_path() {
        cmd.env("PATH", p);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| std::io::Error::other(format!("could not start `{}`: {e}", shell.to_string_lossy())))?;

    // The slave is the child's end. Holding it open here would mean the reader
    // never sees EOF when the shell exits, so the reader thread would block
    // forever on a dead session — the leaked thread per tab the issue warned
    // about. Dropping it is what makes exit detectable.
    drop(pair.slave);

    Ok(PtySession {
        master: pair.master,
        child,
    })
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test terminal
```

Expected: 2 passed.

- [ ] **Step 6: Extend the spawn guard**

In `src-tauri/tests/spawn_no_window.rs`, append a new test after `the_windows_creation_flag_is_set_in_one_place_only`:

```rust
/// The pty half of the same rule (#243).
///
/// `portable_pty` spawns through its own `CommandBuilder`, not
/// `std::process::Command`, so the `Command::new` guard above cannot see it. A
/// pty opened anywhere but `proc.rs` would therefore be a second spawn path
/// with no guard on it at all — which is the exact failure mode #172 was.
#[test]
fn the_pty_spawn_lives_only_in_the_proc_module() {
    const PTY_APIS: [&str; 3] = ["CommandBuilder::new", "openpty(", "spawn_command("];

    for (rel, body) in sources() {
        for api in PTY_APIS {
            let found = count_code_occurrences(&body, api);
            let expected = if rel == "src/proc.rs" { 1 } else { 0 };
            assert_eq!(
                found, expected,
                "{rel} uses `{api}` {found} time(s), expected {expected}. The \
                 whole pty spawn belongs in src/proc.rs::spawn_pty_shell — a \
                 second one would not be covered by any guard in this file."
            );
        }
    }
}
```

- [ ] **Step 7: Run the guard**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test spawn_no_window
```

Expected: 4 passed. If `no_raw_command_new_outside_the_proc_module` now fails with a count mismatch for `src/proc.rs`, that means the implementation introduced a `Command::new` — it should not have; `CommandBuilder::new` is a different string and the count stays 5.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/proc.rs src-tauri/tests/terminal.rs src-tauri/tests/spawn_no_window.rs
git commit -m "feat(terminal): own the pty spawn in proc.rs (#243)

Why: portable-pty spawns through its own CommandBuilder, so a pty
opened outside proc.rs sails past the Command::new guard — the second
spawn path #172 exists to prevent, and invisible. The guard grows a
pty-API case rather than the rule growing an exception.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The session registry

`terminal.rs` holds the live ptys. It is **Tauri-free**: output leaves through an injected sink, which is both better decomposition and the only reason this is testable without an `AppHandle`.

**Files:**
- Create: `src-tauri/src/terminal.rs`
- Modify: `src-tauri/src/lib.rs:1-17` (module list)
- Test: `src-tauri/tests/terminal.rs` (append)
- Test: `src-tauri/tests/terminal_privacy.rs` (create)

**Interfaces:**
- Consumes: `crate::proc::{spawn_pty_shell, default_shell, PtySession}` from Task 1.
- Produces:
  - `pub enum TermEvent { Data { repo_id: String, epoch: u64, data: String }, Exit { repo_id: String, epoch: u64, code: Option<i32> } }`
  - `pub type EventSink = Arc<dyn Fn(TermEvent) + Send + Sync>`
  - `pub struct TerminalState` (implements `Default`)
  - `pub fn open(&self, sink: EventSink, repo_id: &str, shell: &OsStr, workdir: &Path, rows: u16, cols: u16) -> io::Result<u64>` — returns the epoch
  - `pub fn write(&self, repo_id: &str, data: &[u8]) -> io::Result<()>`
  - `pub fn resize(&self, repo_id: &str, rows: u16, cols: u16) -> io::Result<()>`
  - `pub fn close(&self, repo_id: &str)` — idempotent
  - `pub fn is_open(&self, repo_id: &str) -> bool`

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/tests/terminal.rs`:

```rust
use std::sync::{Arc, Mutex};
use platypusgit_lib::terminal::{EventSink, TermEvent, TerminalState};

/// A sink that records every event, so a test can wait on the stream the
/// frontend would receive rather than on the pty directly.
#[derive(Default, Clone)]
struct Recorder(Arc<Mutex<Vec<TermEvent>>>);

impl Recorder {
    fn sink(&self) -> EventSink {
        let inner = self.0.clone();
        Arc::new(move |ev| inner.lock().expect("sink lock").push(ev))
    }

    /// Everything decoded from `Data` events so far, concatenated.
    fn text(&self) -> String {
        use base64::Engine as _;
        self.0
            .lock()
            .expect("lock")
            .iter()
            .filter_map(|e| match e {
                TermEvent::Data { data, .. } => Some(
                    base64::engine::general_purpose::STANDARD
                        .decode(data)
                        .expect("the payload is base64"),
                ),
                _ => None,
            })
            .flatten()
            .collect::<Vec<u8>>()
            .iter()
            .map(|b| *b as char)
            .collect()
    }

    fn exit(&self) -> Option<Option<i32>> {
        self.0.lock().expect("lock").iter().find_map(|e| match e {
            TermEvent::Exit { code, .. } => Some(*code),
            _ => None,
        })
    }
}

/// Poll `f` until it is true or the deadline passes. A pty is asynchronous and
/// a fixed sleep is either flaky or slow; this is neither.
fn wait_for(secs: u64, mut f: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_secs(secs);
    while Instant::now() < deadline {
        if f() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    false
}

fn open_in_tempdir(state: &TerminalState, rec: &Recorder, id: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    state
        .open(
            rec.sink(),
            id,
            &platypusgit_lib::proc::default_shell(),
            dir.path(),
            24,
            80,
        )
        .expect("open a session");
    dir
}

#[test]
fn output_reaches_the_sink_as_base64() {
    let state = TerminalState::default();
    let rec = Recorder::default();
    let _dir = open_in_tempdir(&state, &rec, "repo-a");

    state.write("repo-a", b"echo pgit-ok\n").expect("write");

    assert!(
        wait_for(10, || rec.text().contains("pgit-ok")),
        "the marker should reach the sink. saw: {}",
        rec.text()
    );
    state.close("repo-a");
}

#[test]
fn two_repositories_get_two_independent_sessions() {
    let state = TerminalState::default();
    let a = Recorder::default();
    let b = Recorder::default();
    let _da = open_in_tempdir(&state, &a, "repo-a");
    let _db = open_in_tempdir(&state, &b, "repo-b");

    state.write("repo-a", b"echo only-a\n").expect("write a");
    assert!(wait_for(10, || a.text().contains("only-a")));

    // Closing one must not touch the other.
    state.close("repo-a");
    assert!(!state.is_open("repo-a"));
    assert!(state.is_open("repo-b"));

    state.write("repo-b", b"echo still-b\n").expect("write b");
    assert!(
        wait_for(10, || b.text().contains("still-b")),
        "repo-b should still be alive. saw: {}",
        b.text()
    );
    assert!(
        !a.text().contains("still-b"),
        "sessions must not cross sinks"
    );
    state.close("repo-b");
}

#[test]
fn a_shell_that_exits_reports_and_is_reaped() {
    let state = TerminalState::default();
    let rec = Recorder::default();
    let _dir = open_in_tempdir(&state, &rec, "repo-x");

    state.write("repo-x", b"exit 3\n").expect("write");

    assert!(
        wait_for(10, || rec.exit().is_some()),
        "an exiting shell must produce an Exit event"
    );
    assert!(
        wait_for(5, || !state.is_open("repo-x")),
        "the session must drop itself once the shell is gone — no zombie, no \
         leaked reader thread"
    );
}

#[test]
fn opening_twice_yields_one_session() {
    let state = TerminalState::default();
    let rec = Recorder::default();
    let dir = open_in_tempdir(&state, &rec, "repo-a");

    // A panel re-mount must not stack shells.
    let again = state
        .open(
            rec.sink(),
            "repo-a",
            &platypusgit_lib::proc::default_shell(),
            dir.path(),
            24,
            80,
        )
        .expect("second open is a no-op");

    state.write("repo-a", b"echo once\n").expect("write");
    assert!(wait_for(10, || rec.text().contains("once")));

    // One close is enough because there is one session.
    state.close("repo-a");
    assert!(!state.is_open("repo-a"));
    let _ = again;
}

#[test]
fn closing_an_unknown_session_is_not_an_error() {
    let state = TerminalState::default();
    state.close("never-opened");
    state.close("never-opened");
    assert!(!state.is_open("never-opened"));
}

#[test]
fn writing_to_a_closed_session_errors_rather_than_panicking() {
    let state = TerminalState::default();
    assert!(state.write("nope", b"x").is_err());
    assert!(state.resize("nope", 10, 10).is_err());
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test terminal
```

Expected: FAIL to compile — `unresolved import platypusgit_lib::terminal`.

- [ ] **Step 3: Implement `terminal.rs`**

Create `src-tauri/src/terminal.rs`:

```rust
//! Live pty sessions for the built-in terminal (#243).
//!
//! Shape borrowed from `watcher.rs`: a `Default`-constructed state object is
//! `manage`d on the Tauri app, the handlers in `commands/terminal.rs` stay
//! thin, and all the lifetime management lives here.
//!
//! # Why this module knows nothing about Tauri
//!
//! Output leaves through an injected [`EventSink`] rather than an `AppHandle`.
//! Two reasons, in order of importance: an integration test can supply a
//! recording sink and assert on the exact stream the frontend would see, which
//! an `AppHandle` makes impossible outside a running app; and the reader thread
//! then has one dependency instead of the whole Tauri runtime.
//!
//! # Why there is not a single logging call in this file
//!
//! A terminal is where secrets get typed — a `sudo` password, a token pasted at
//! a prompt. The property we want is that bytes read from the pty reach exactly
//! one destination, the sink, and nothing else. That is easy to state and hard
//! to keep by care alone, so it is kept structurally: this module logs nothing
//! at all, `tests/terminal_privacy.rs` fails the build if it starts to, and the
//! lifecycle logging worth having lives in `commands/terminal.rs`, which sees
//! ids and exit codes and never a byte of traffic.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use base64::Engine as _;

/// What a session tells the frontend.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TermEvent {
    /// A chunk of pty output. `data` is **base64**.
    ///
    /// Not a `String`: pty output is arbitrary bytes and a 4 KiB read splits a
    /// multi-byte character at the boundary about as often as you would expect.
    /// `from_utf8_lossy` would replace the split character with U+FFFD, so the
    /// user would see a replacement glyph inside a filename — intermittently,
    /// and only for non-ASCII, which is the worst kind of bug to be told about.
    /// xterm.js decodes UTF-8 incrementally across chunks, which is the correct
    /// place for it.
    Data {
        repo_id: String,
        epoch: u64,
        data: String,
    },
    /// The shell exited. `code` is `None` when it was signalled.
    Exit {
        repo_id: String,
        epoch: u64,
        code: Option<i32>,
    },
}

/// Where a session's events go. `commands/terminal.rs` supplies one that emits
/// on the Tauri app; tests supply one that records.
pub type EventSink = Arc<dyn Fn(TermEvent) + Send + Sync>;

struct Session {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    epoch: u64,
}

/// Every live pty, keyed by repository.
///
/// Keying by `RepoId` is what makes "one shell per repository tab" a property
/// of the data structure rather than a rule the frontend has to remember.
#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, Session>>,
    next_epoch: AtomicU64,
}

impl TerminalState {
    /// Start a shell for `repo_id`, or return the existing session's epoch.
    ///
    /// Idempotent on purpose: a panel re-mount, a fast double toggle and a tab
    /// re-activation all reach here, and none of them should stack a shell.
    pub fn open(
        &self,
        sink: EventSink,
        repo_id: &str,
        shell: &OsStr,
        workdir: &Path,
        rows: u16,
        cols: u16,
    ) -> std::io::Result<u64> {
        let mut sessions = self.sessions.lock().expect("terminal sessions lock");
        if let Some(existing) = sessions.get(repo_id) {
            return Ok(existing.epoch);
        }

        let session = crate::proc::spawn_pty_shell(shell, workdir, rows, cols)?;
        let epoch = self.next_epoch.fetch_add(1, Ordering::Relaxed);

        let reader = session.master.try_clone_reader()?;
        let writer = session.master.take_writer()?;

        spawn_reader(sink, repo_id.to_string(), epoch, reader);

        sessions.insert(
            repo_id.to_string(),
            Session {
                master: session.master,
                writer,
                child: session.child,
                epoch,
            },
        );
        Ok(epoch)
    }

    pub fn write(&self, repo_id: &str, data: &[u8]) -> std::io::Result<()> {
        let mut sessions = self.sessions.lock().expect("terminal sessions lock");
        let session = sessions
            .get_mut(repo_id)
            .ok_or_else(|| std::io::Error::other("no terminal session for this repository"))?;
        session.writer.write_all(data)?;
        session.writer.flush()
    }

    pub fn resize(&self, repo_id: &str, rows: u16, cols: u16) -> std::io::Result<()> {
        let sessions = self.sessions.lock().expect("terminal sessions lock");
        let session = sessions
            .get(repo_id)
            .ok_or_else(|| std::io::Error::other("no terminal session for this repository"))?;
        session
            .master
            .resize(portable_pty::PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| std::io::Error::other(format!("could not resize the pty: {e}")))
    }

    /// Kill the shell and forget the session. Idempotent — killing a child that
    /// has already exited is not an error, and neither is closing nothing.
    pub fn close(&self, repo_id: &str) {
        let session = self
            .sessions
            .lock()
            .expect("terminal sessions lock")
            .remove(repo_id);
        if let Some(mut session) = session {
            let _ = session.child.kill();
            // Reap, so the exiting shell does not become a zombie. The reader
            // thread ends on its own when the master's last reader sees EOF.
            let _ = session.child.wait();
        }
    }

    pub fn is_open(&self, repo_id: &str) -> bool {
        self.sessions
            .lock()
            .expect("terminal sessions lock")
            .contains_key(repo_id)
    }

    /// Close everything. Called on app exit so no child outlives the window.
    pub fn close_all(&self) {
        let ids: Vec<String> = self
            .sessions
            .lock()
            .expect("terminal sessions lock")
            .keys()
            .cloned()
            .collect();
        for id in ids {
            self.close(&id);
        }
    }

    /// Drop the session `epoch` belongs to, if it is still the current one.
    ///
    /// The epoch check is the fence: a reader that reaches EOF just after the
    /// user closed and reopened the terminal would otherwise remove the NEW
    /// session, killing a shell the user is looking at.
    fn retire(&self, repo_id: &str, epoch: u64) -> Option<Option<i32>> {
        let mut sessions = self.sessions.lock().expect("terminal sessions lock");
        match sessions.get(repo_id) {
            Some(s) if s.epoch == epoch => {}
            _ => return None,
        }
        let mut session = sessions.remove(repo_id)?;
        drop(sessions);
        let code = session.child.wait().ok().map(|s| s.exit_code() as i32);
        Some(code)
    }
}

impl Drop for TerminalState {
    fn drop(&mut self) {
        // Belt and braces next to the explicit close_all on window destroy: a
        // panic elsewhere must not leave a shell running with no window.
        let ids: Vec<String> = self
            .sessions
            .lock()
            .map(|s| s.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            self.close(&id);
        }
    }
}

/// One blocking reader thread per session.
///
/// A free function rather than a method so it cannot accidentally capture the
/// state's mutex: it holds only the sink, and the `Arc<TerminalState>` it needs
/// for retirement is passed in by the caller in `commands/terminal.rs`. Reading
/// under the sessions lock would serialise every terminal in the app behind the
/// slowest one and deadlock the first `write` during a read.
fn spawn_reader(sink: EventSink, repo_id: String, epoch: u64, mut reader: Box<dyn Read + Send>) {
    std::thread::Builder::new()
        .name(format!("pty-reader-{epoch}"))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        sink(TermEvent::Data {
                            repo_id: repo_id.clone(),
                            epoch,
                            data: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
                        });
                    }
                }
            }
            sink(TermEvent::Exit {
                repo_id,
                epoch,
                code: None,
            });
        })
        .expect("spawn a pty reader thread");
}
```

Then in `src-tauri/src/lib.rs`, add `pub mod terminal;` to the module list (alphabetical, between `state` and `update`).

- [ ] **Step 4: Reconcile the exit code**

The reader emits `Exit { code: None }` because it does not own the child. `TerminalState::retire` is what learns the real code. Wire them: in `commands/terminal.rs` (Task 3) the sink closure intercepts `TermEvent::Exit`, calls `state.retire(&repo_id, epoch)` and re-emits with the real code. Leave `retire` `pub(crate)` for now and let Task 3 finish the loop; the test `a_shell_that_exits_reports_and_is_reaped` asserts only that *an* Exit arrives and the session is gone, so make the sink in the test drive retirement too:

In the test file's `Recorder::sink`, after pushing, nothing else is needed — but `a_shell_that_exits_reports_and_is_reaped` asserts `!state.is_open(...)`. So the reader must retire the session itself. Change `spawn_reader` to take an `Arc<TerminalState>` and do it:

```rust
fn spawn_reader(
    state: Arc<TerminalState>,
    sink: EventSink,
    repo_id: String,
    epoch: u64,
    mut reader: Box<dyn Read + Send>,
) {
    std::thread::Builder::new()
        .name(format!("pty-reader-{epoch}"))
        .spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => sink(TermEvent::Data {
                        repo_id: repo_id.clone(),
                        epoch,
                        data: base64::engine::general_purpose::STANDARD.encode(&buf[..n]),
                    }),
                }
            }
            // EOF means the shell is gone. Retire under the epoch fence, then
            // report — in that order, so `is_open` is already false by the time
            // the frontend reacts to the exit.
            let code = state.retire(&repo_id, epoch).flatten();
            sink(TermEvent::Exit { repo_id, epoch, code });
        })
        .expect("spawn a pty reader thread");
}
```

This makes `TerminalState` need to be behind an `Arc`. Change `open` to an associated function taking `self: &Arc<Self>`:

```rust
pub fn open(
    self: &Arc<Self>,
    sink: EventSink,
    repo_id: &str,
    /* … */
) -> std::io::Result<u64> {
    /* … */
    spawn_reader(Arc::clone(self), sink, repo_id.to_string(), epoch, reader);
    /* … */
}
```

and make the tests construct `Arc<TerminalState>`:

```rust
let state = Arc::new(TerminalState::default());
```

Update every `TerminalState::default()` in the tests to `Arc::new(TerminalState::default())`. Tauri's `manage` stores the value itself, so `commands/terminal.rs` manages `Arc<TerminalState>` and reads it with `State<'_, Arc<TerminalState>>`.

Drop the `impl Drop for TerminalState` — with the state behind an `Arc` held by a reader thread, `Drop` runs at an unpredictable time. Task 3 calls `close_all()` explicitly on window destroy instead, which is the deterministic point.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test terminal
```

Expected: 8 passed. If `a_shell_that_exits_reports_and_is_reaped` is flaky, raise only its `wait_for` budget — never add a fixed `sleep`.

- [ ] **Step 6: Write the privacy guard**

Create `src-tauri/tests/terminal_privacy.rs`:

```rust
//! The terminal never logs its traffic (#243).
//!
//! A terminal is where secrets get typed: a `sudo` password, a token pasted at
//! a prompt, a passphrase. The property we want is that bytes read from the pty
//! reach exactly one destination — the event sink — and bytes written to it
//! reach exactly one destination, the pty.
//!
//! Stated that way it is a property about what the source may CONTAIN, so it is
//! a test over the source text, in the same shape as `spawn_no_window.rs` and
//! `test/docs.test.ts`. The alternative — keeping it by care — is how these
//! things get lost in the third refactor.
//!
//! The rule is deliberately blunt: `src/terminal.rs` contains no logging macro
//! AT ALL. That is enforceable in four lines, whereas "no logging macro that
//! mentions the buffer" is a judgement call a grep cannot make. It costs
//! nothing, because the lifecycle events worth logging (opened, exited, closed)
//! are logged from `commands/terminal.rs`, which handles ids and exit codes and
//! never sees a byte of traffic.

use std::path::Path;

fn read(rel: &str) -> String {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join(rel);
    std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
}

fn is_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*')
}

fn code_lines(body: &str) -> impl Iterator<Item = &str> {
    body.lines().filter(|l| !is_comment(l))
}

#[test]
fn the_session_registry_logs_nothing() {
    const LOGGERS: [&str; 6] = [
        "log::", "tracing::", "println!", "eprintln!", "dbg!", "info!",
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
fn the_traffic_never_reaches_a_file_or_a_child_process() {
    const EXFIL: [&str; 5] = [
        "File::create",
        "OpenOptions",
        "write_all(&buf",
        "Command",
        "reqwest",
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
    // `term_write`'s payload travels toward the shell — a sudo password goes
    // this way. The handler may log THAT a write happened, never its content.
    let body = read("src/commands/terminal.rs");
    for line in code_lines(&body).filter(|l| {
        l.contains("log::") || l.contains("println!") || l.contains("tracing::")
    }) {
        assert!(
            !line.contains("data"),
            "a log line in commands/terminal.rs mentions `data`, which is what \
             the user typed: {line}"
        );
    }
}
```

- [ ] **Step 7: Run it**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test terminal_privacy
```

Expected: the first two pass; `the_handlers_do_not_log_what_the_user_typed` FAILS because `src/commands/terminal.rs` does not exist yet. That is correct — Task 3 creates it. To keep the suite green between tasks, guard that one test with an early return:

```rust
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/terminal.rs");
    if !p.exists() {
        return; // Task 3 creates it; the other two guards already have teeth.
    }
```

Remove the early return at the end of Task 3 once the file exists.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/terminal.rs src-tauri/src/lib.rs src-tauri/tests/terminal.rs src-tauri/tests/terminal_privacy.rs
git commit -m "feat(terminal): pty session registry, one shell per repository (#243)

Why: sessions keyed by RepoId make \"one shell per repo tab\" a property
of the data structure, not a rule the frontend must remember. Output
leaves through an injected sink rather than an AppHandle so the stream
the frontend sees is testable, and so the module can log nothing at all
— a terminal is where passwords get typed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Commands, the error variant, and the TS bridge

**Files:**
- Create: `src-tauri/src/commands/terminal.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/error.rs` (after `LfsUnavailable`)
- Modify: `src-tauri/src/lib.rs` (`manage` + `invoke_handler!` + window-destroy hook)
- Modify: `src/lib/types.ts`, `src/lib/tauri.ts`, `src/lib/errors.ts`
- Modify: `src-tauri/tests/terminal_privacy.rs` (drop the early return)
- Test: `test/appErrors.test.ts` (existing — it gates this)

**Interfaces:**
- Consumes: `TerminalState` from Task 2.
- Produces:
  - Rust: `AppError::TerminalUnavailable(String)`; commands `term_open`, `term_write`, `term_resize`, `term_close`.
  - TS: `termOpen(repoId, rows, cols): Promise<number>`, `termWrite(repoId, data): Promise<void>`, `termResize(repoId, rows, cols): Promise<void>`, `termClose(repoId): Promise<void>`; types `TermData { repoId, epoch, data }`, `TermExit { repoId, epoch, code }`.

- [ ] **Step 1: Add the error variant**

In `src-tauri/src/error.rs`, after the `LfsUnavailable` variant:

```rust
    /// The shell the built-in terminal tried to run is missing or not runnable
    /// (#243). A **state**, not a failure — the same shape `LfsUnavailable` and
    /// `SshKeygenUnavailable` use: the panel disables itself and says which
    /// shell it tried, because the remedy is one field in Settings. `Io` would
    /// put "No such file or directory" in a banner without naming the file.
    #[error("no usable shell: {0}")]
    TerminalUnavailable(String),
```

- [ ] **Step 2: Mirror it in TypeScript**

In `src/lib/errors.ts`, add to the `AppError` union (next to `SshKeygenUnavailable`):

```ts
  /**
   * The shell the built-in terminal tried to run is missing or not runnable
   * (#243). A state the panel disables on, in the shape `LfsUnavailable`
   * already uses — the message names the shell, `appErrorDetail` names the
   * remedy.
   */
  | { kind: "TerminalUnavailable"; message: string }
```

And in `appErrorDetail`, a case:

```ts
    case "TerminalUnavailable":
      return (
        `Could not start ${typeof message === "string" && message ? message : "a shell"}. ` +
        "Set a shell in Settings ▸ Terminal, or leave it blank to use $SHELL."
      );
```

Match the surrounding cases' exact style — read three neighbours before writing this.

- [ ] **Step 3: Run the error gate to verify both halves are in step**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- appErrors
```

Expected: PASS. If it fails saying the union and the enum have drifted, one of the two edits above is missing or misspelled.

- [ ] **Step 4: Write the handlers**

Create `src-tauri/src/commands/terminal.rs`:

```rust
//! The built-in terminal's four handlers (#243).
//!
//! Thin, in the shape of `commands/watch.rs`: `crate::terminal::TerminalState`
//! owns every live pty and all of the lifetime management; this file resolves
//! the workdir, picks the shell, supplies the event sink, and logs the
//! lifecycle.
//!
//! The logging lives HERE and not in `terminal.rs` on purpose. This file sees
//! repository ids, sizes and exit codes; `terminal.rs` sees the bytes. A
//! terminal is where passwords get typed, so the module that handles traffic
//! logs nothing at all and `tests/terminal_privacy.rs` fails the build if that
//! stops being true.

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::{
    error::{AppError, AppResult},
    git::types::RepoId,
    state::AppState,
    terminal::{TermEvent, TerminalState},
};

/// The event a `TermEvent::Data` is delivered on.
pub const TERM_DATA_EVENT: &str = "term://data";
/// The event a `TermEvent::Exit` is delivered on.
pub const TERM_EXIT_EVENT: &str = "term://exit";

/// Start a shell for `repo_id`, or adopt the one already running.
///
/// The workdir is resolved through the backend rather than taken from the
/// frontend: a path argument would be a second source of truth for where a
/// repository lives, and this one is about to become a shell's cwd.
#[tauri::command]
pub async fn term_open(
    app: AppHandle,
    state: State<'_, AppState>,
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
    rows: u16,
    cols: u16,
    shell: Option<String>,
) -> AppResult<u64> {
    let backend = state.backend.clone();
    let id = RepoId(repo_id.clone());
    let workdir = tokio::task::spawn_blocking(move || backend.repo_path(&id))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;

    // A blank setting means "use the default" — the Settings field is a text
    // box, and an empty text box is not a shell named "".
    let shell = shell
        .filter(|s| !s.trim().is_empty())
        .map(std::ffi::OsString::from)
        .unwrap_or_else(crate::proc::default_shell);

    let sink = {
        let app = app.clone();
        Arc::new(move |ev: TermEvent| {
            let name = match &ev {
                TermEvent::Data { .. } => TERM_DATA_EVENT,
                TermEvent::Exit { .. } => TERM_EXIT_EVENT,
            };
            // Nothing is logged here: `ev` carries traffic.
            let _ = app.emit(name, ev);
        })
    };

    let terminals = terminals.inner().clone();
    let shell_name = shell.to_string_lossy().to_string();
    let epoch = terminals
        .open(sink, &repo_id, &shell, &workdir, rows, cols)
        .map_err(|e| AppError::TerminalUnavailable(format!("{shell_name}: {e}")))?;

    log::info!("terminal: session {epoch} open for {repo_id} ({shell_name})");
    Ok(epoch)
}

/// Send input to the shell. `data` is what the user typed — never logged.
#[tauri::command]
pub async fn term_write(
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
    data: String,
) -> AppResult<()> {
    terminals
        .write(&repo_id, data.as_bytes())
        .map_err(|e| AppError::Io(e.to_string()))
}

#[tauri::command]
pub async fn term_resize(
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
    rows: u16,
    cols: u16,
) -> AppResult<()> {
    terminals
        .resize(&repo_id, rows, cols)
        .map_err(|e| AppError::Io(e.to_string()))
}

/// Kill this repository's shell. Idempotent.
#[tauri::command]
pub async fn term_close(
    terminals: State<'_, Arc<TerminalState>>,
    repo_id: String,
) -> AppResult<()> {
    terminals.close(&repo_id);
    log::info!("terminal: session closed for {repo_id}");
    Ok(())
}
```

Add `pub mod terminal;` to `src-tauri/src/commands/mod.rs` (alphabetical).

- [ ] **Step 5: Register**

In `src-tauri/src/lib.rs`:

1. Next to `.manage(watcher::WatchState::default())`:

```rust
        .manage(std::sync::Arc::new(terminal::TerminalState::default()))
```

2. In `tauri::generate_handler![…]`, after the `commands::watch::*` entries:

```rust
            commands::terminal::term_open,
            commands::terminal::term_write,
            commands::terminal::term_resize,
            commands::terminal::term_close,
```

3. Kill every shell when the window goes away. Find the existing `.on_window_event` / `RunEvent` handling (`grep -n 'on_window_event\|RunEvent' src-tauri/src/lib.rs`) and add a `Destroyed`/`ExitRequested` arm:

```rust
        // A shell must not outlive the window that hosts it. `close_all` is
        // called explicitly here rather than left to a Drop: the state is
        // behind an Arc held by every reader thread, so its Drop runs at a time
        // nobody controls.
        if let Some(terminals) = app.try_state::<std::sync::Arc<terminal::TerminalState>>() {
            terminals.close_all();
        }
```

Adapt to whatever shape the existing handler has — if there is none, add
`.on_window_event(|window, event| { if matches!(event, tauri::WindowEvent::Destroyed) { … } })`
using `window.app_handle()`.

- [ ] **Step 6: Compile and run the Rust suite**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: clean check, all tests pass.

- [ ] **Step 7: Remove the privacy guard's early return**

In `src-tauri/tests/terminal_privacy.rs`, delete the `if !p.exists() { return; }` block added in Task 2 Step 7 and use `read("src/commands/terminal.rs")` directly. Re-run:

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test terminal_privacy
```

Expected: 3 passed.

- [ ] **Step 8: The TypeScript bridge**

In `src/lib/types.ts`:

```ts
/**
 * A chunk of terminal output (#243). `data` is base64 — pty output is
 * arbitrary bytes and a read can split a multi-byte character, which a string
 * payload would turn into U+FFFD.
 */
export interface TermData {
  repoId: string;
  epoch: number;
  data: string;
}

/** The shell exited. `code` is null when it was signalled. */
export interface TermExit {
  repoId: string;
  epoch: number;
  code: number | null;
}
```

In `src/lib/tauri.ts`, next to the `watchRepo`/`watchStop` pair:

```ts
/**
 * Start a shell for this repository, or adopt the one already running (#243).
 * Returns the session's epoch — every `term://data` event carries one, and a
 * view must drop the events that are not its own or a re-opened terminal shows
 * the dead shell's last line.
 *
 * `shell` blank or omitted means the backend's default ($SHELL, then /bin/sh).
 */
export function termOpen(
  repoId: string,
  rows: number,
  cols: number,
  shell?: string,
): Promise<number> {
  return invoke<number>("term_open", { repoId, rows, cols, shell: shell ?? null });
}

/** Send input to the shell. This is what the user typed — never log it. */
export function termWrite(repoId: string, data: string): Promise<void> {
  return invoke<void>("term_write", { repoId, data });
}

export function termResize(repoId: string, rows: number, cols: number): Promise<void> {
  return invoke<void>("term_resize", { repoId, rows, cols });
}

/** Kill this repository's shell. Idempotent. */
export function termClose(repoId: string): Promise<void> {
  return invoke<void>("term_close", { repoId });
}
```

- [ ] **Step 9: Type-check and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test -- appErrors
git add src-tauri/src/commands/terminal.rs src-tauri/src/commands/mod.rs src-tauri/src/error.rs src-tauri/src/lib.rs src-tauri/tests/terminal_privacy.rs src/lib/types.ts src/lib/tauri.ts src/lib/errors.ts
git commit -m "feat(terminal): four commands and the TerminalUnavailable state (#243)

Why: a missing shell is a state, not a failure — the shape
LfsUnavailable already uses. The panel says which shell it tried,
because the remedy is one field in Settings.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The Settings field

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts`
- Modify: `src/screens/Settings.tsx`
- Test: `src/screens/Settings.terminal.test.tsx` (create)

**Interfaces:**
- Produces: `useSettingsStore` field `terminalShell: string` (default `""`) and setter `setTerminalShell(v: string)`.

- [ ] **Step 1: Write the failing test**

Create `src/screens/Settings.terminal.test.tsx`. Model it on the existing `Settings.difftool.test.tsx` — read that file first and copy its render harness and mocks exactly; it is the closest sibling (a text field in Settings that names an external program).

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsScreen } from "./Settings";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

describe("Settings ▸ Terminal", () => {
  it("defaults to blank, meaning the backend picks the shell", () => {
    expect(useSettingsStore.getState().terminalShell).toBe("");
  });

  it("stores the shell the user names", async () => {
    render(<SettingsScreen />);
    const field = await screen.findByLabelText(/shell/i);
    await userEvent.clear(field);
    await userEvent.type(field, "/opt/homebrew/bin/fish");
    await waitFor(() =>
      expect(useSettingsStore.getState().terminalShell).toBe(
        "/opt/homebrew/bin/fish",
      ),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- Settings.terminal
```

Expected: FAIL — `terminalShell` is undefined.

- [ ] **Step 3: Add the field**

In `src/features/settings/useSettingsStore.ts`, next to `watchFilesystem` in the interface:

```ts
  /**
   * The shell the built-in terminal runs (#243). Blank means the backend
   * decides: `$SHELL` then `/bin/sh` on unix, PowerShell on Windows.
   *
   * A free text field rather than a picker of installed shells: enumerating
   * them would mean probing the filesystem for a list that is never complete,
   * and the people who want `nu` know where it lives.
   */
  terminalShell: string;
```

In the defaults object (near `watchFilesystem: true`): `terminalShell: "",`.

Add the setter following the file's existing setter convention — read two neighbouring setters and match them exactly, including whether they persist.

- [ ] **Step 4: Render it**

In `src/screens/Settings.tsx`, add a **Terminal** section after the section that holds `watchFilesystem`. Match the surrounding section markup exactly (heading component, description paragraph, field wrapper). The field is a plain labelled text input with placeholder `$SHELL` and helper text:

> Leave blank to use `$SHELL`. The terminal opens in the active repository's working directory.

- [ ] **Step 5: Run the test**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- Settings.terminal
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/useSettingsStore.ts src/screens/Settings.tsx src/screens/Settings.terminal.test.tsx
git commit -m "feat(terminal): a Settings field for the shell to run (#243)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The store, the view and the panel

**Files:**
- Create: `src/features/terminal/{useTerminalStore.ts,TerminalView.tsx,TerminalPanel.tsx,shellLabel.ts,index.ts}`
- Create: `src/features/terminal/{useTerminalStore.test.ts,TerminalView.test.tsx,shellLabel.test.ts}`
- Modify: `package.json`

**Interfaces:**
- Consumes: `termOpen/termWrite/termResize/termClose` (Task 3), `useElementSize` from `@/lib/useElementSize`, `PGResizeHandle`/`usePaneSize` from `@/design`.
- Produces:
  - `useTerminalStore` — `{ open: boolean, heightPx: number, epochs: Record<string, number>, toggle(), setOpen(b), setHeight(px), noteEpoch(repoId, epoch), forget(repoId) }`
  - `<TerminalPanel />` — self-contained, reads the active repo itself.
  - `<TerminalView repoId={string} />`
  - `shellLabel(path: string): string`

- [ ] **Step 1: Install xterm**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm add @xterm/xterm
```

Pin it the way the other deps are pinned — check whether `package.json` uses `^` for runtime deps (it does for most) and match.

- [ ] **Step 2: Write the pure tests first**

`src/features/terminal/shellLabel.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shellLabel } from "./shellLabel";

describe("shellLabel", () => {
  it("is the basename of a path", () => {
    expect(shellLabel("/opt/homebrew/bin/fish")).toBe("fish");
    expect(shellLabel("/bin/zsh")).toBe("zsh");
  });

  it("handles a Windows path", () => {
    expect(shellLabel("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("pwsh.exe");
  });

  it("says what blank means rather than showing nothing", () => {
    expect(shellLabel("")).toBe("default shell");
  });
});
```

`src/features/terminal/useTerminalStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { useTerminalStore } from "./useTerminalStore";

const reset = () =>
  useTerminalStore.setState({ open: false, heightPx: 240, epochs: {} });

describe("useTerminalStore", () => {
  beforeEach(reset);

  it("starts closed — a terminal nobody asked for should not spawn a shell", () => {
    expect(useTerminalStore.getState().open).toBe(false);
  });

  it("toggles", () => {
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(true);
    useTerminalStore.getState().toggle();
    expect(useTerminalStore.getState().open).toBe(false);
  });

  it("clamps the height to something a terminal can render in", () => {
    useTerminalStore.getState().setHeight(10);
    expect(useTerminalStore.getState().heightPx).toBeGreaterThanOrEqual(80);
    useTerminalStore.getState().setHeight(100_000);
    expect(useTerminalStore.getState().heightPx).toBeLessThanOrEqual(2000);
  });

  it("tracks an epoch per repository, not one for the app", () => {
    useTerminalStore.getState().noteEpoch("a", 1);
    useTerminalStore.getState().noteEpoch("b", 2);
    expect(useTerminalStore.getState().epochs).toEqual({ a: 1, b: 2 });
  });

  it("forgets one repository without disturbing the others", () => {
    useTerminalStore.getState().noteEpoch("a", 1);
    useTerminalStore.getState().noteEpoch("b", 2);
    useTerminalStore.getState().forget("a");
    expect(useTerminalStore.getState().epochs).toEqual({ b: 2 });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- features/terminal
```

Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `shellLabel.ts` and `useTerminalStore.ts`**

```ts
// shellLabel.ts
/** The name to show for a configured shell path. Blank means "the default". */
export function shellLabel(shell: string): string {
  if (!shell.trim()) return "default shell";
  const parts = shell.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? shell;
}
```

```ts
// useTerminalStore.ts
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Below this the terminal cannot show a prompt and a line of output. */
const MIN_HEIGHT = 80;
/** Above this the panel has eaten the app; the drag handle stops here. */
const MAX_HEIGHT = 2000;

export const clampHeight = (px: number) =>
  Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(px)));

interface TerminalState {
  /** Whether the panel is showing. Closed by default: a terminal nobody asked
   *  for should not spawn a shell for every repository they open. */
  open: boolean;
  heightPx: number;
  /**
   * The live session epoch per repository.
   *
   * Per-repo state lives HERE and not in `useRepoStore`. `RepoSlice` holds
   * exactly one repository's state and is cleared on every tab switch — which
   * is right for a diff and catastrophic for a session handle, because it would
   * orphan the shells of every inactive tab. This is the shape `useTabsStore`
   * has: all open repositories at once.
   */
  epochs: Record<string, number>;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  setHeight: (px: number) => void;
  noteEpoch: (repoId: string, epoch: number) => void;
  forget: (repoId: string) => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set) => ({
      open: false,
      heightPx: 240,
      epochs: {},
      toggle: () => set((s) => ({ open: !s.open })),
      setOpen: (open) => set({ open }),
      setHeight: (px) => set({ heightPx: clampHeight(px) }),
      noteEpoch: (repoId, epoch) =>
        set((s) => ({ epochs: { ...s.epochs, [repoId]: epoch } })),
      forget: (repoId) =>
        set((s) => {
          const next = { ...s.epochs };
          delete next[repoId];
          return { epochs: next };
        }),
    }),
    {
      name: "pg.terminal",
      // Sessions do not survive a reload — the shells are gone with the
      // process — so only the UI preference is persisted.
      partialize: (s) => ({ open: s.open, heightPx: s.heightPx }),
    },
  ),
);
```

Check how the other stores persist (`grep -n 'persist(' src/features/*/use*.ts | head`) and match the convention; if the codebase persists through its own helper rather than zustand's `persist`, use that instead.

- [ ] **Step 5: Run the pure tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- features/terminal
```

Expected: `shellLabel` and `useTerminalStore` pass.

- [ ] **Step 6: Write the view test**

`src/features/terminal/TerminalView.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const onDataHandlers: Array<(s: string) => void> = [];
const write = vi.fn();
const dispose = vi.fn();

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    element: HTMLElement | null = null;
    open(el: HTMLElement) {
      this.element = el;
    }
    onData(cb: (s: string) => void) {
      onDataHandlers.push(cb);
      return { dispose: vi.fn() };
    }
    write = write;
    resize = vi.fn();
    focus = vi.fn();
    dispose = dispose;
    loadAddon = vi.fn();
  },
}));

const termOpen = vi.fn().mockResolvedValue(7);
const termWrite = vi.fn().mockResolvedValue(undefined);
const termResize = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/tauri", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  termOpen: (...a: unknown[]) => termOpen(...a),
  termWrite: (...a: unknown[]) => termWrite(...a),
  termResize: (...a: unknown[]) => termResize(...a),
  termClose: vi.fn().mockResolvedValue(undefined),
}));

import { TerminalView } from "./TerminalView";

describe("TerminalView", () => {
  beforeEach(() => {
    onDataHandlers.length = 0;
    vi.clearAllMocks();
  });

  it("opens a session for its repository", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() => expect(termOpen).toHaveBeenCalled());
    expect(termOpen.mock.calls[0][0]).toBe("repo-a");
  });

  it("forwards what the user types to the pty", async () => {
    render(<TerminalView repoId="repo-a" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));
    onDataHandlers[0]("ls\r");
    await waitFor(() => expect(termWrite).toHaveBeenCalledWith("repo-a", "ls\r"));
  });

  it("tears its listeners down on unmount", async () => {
    const { unmount } = render(<TerminalView repoId="repo-a" />);
    await waitFor(() => expect(termOpen).toHaveBeenCalled());
    unmount();
    await waitFor(() => expect(dispose).toHaveBeenCalled());
  });
});
```

Read `src/test/setup.ts` first — it already mocks `@tauri-apps/api/event`. If `listen` is mocked there, use that mock to push a `term://data` event and add a fourth test asserting `write` is called with the decoded bytes. If it is not, skip that assertion rather than inventing a second mocking strategy.

- [ ] **Step 7: Implement `TerminalView.tsx`**

```tsx
import { listen } from "@tauri-apps/api/event";
import React from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { termOpen, termResize, termWrite } from "@/lib/tauri";
import type { TermData, TermExit } from "@/lib/types";
import { useElementSize } from "@/lib/useElementSize";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useTerminalStore } from "./useTerminalStore";

/** Approximate cell size for the mono font at the current size. Used only to
 *  turn a measured pixel box into rows/cols; xterm corrects itself on render. */
const CELL_W = 8;
const CELL_H = 17;

/** Build xterm's theme from the design tokens, so the terminal is the same
 *  colour scheme as the app and the accent hue is never hardcoded. */
function themeFromCss(): Record<string, string> {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--bg-0", "#101013"),
    foreground: v("--fg-0", "#e6e6e6"),
    cursor: v("--accent", "#7aa2f7"),
    selectionBackground: v("--selection", "#2d3f63"),
  };
}

/**
 * One xterm instance for one repository.
 *
 * Keyed by `repoId` at the call site, so switching tabs mounts a different
 * instance rather than re-pointing this one — a re-pointed terminal would show
 * the previous repository's scrollback under the new repository's prompt.
 */
export function TerminalView({ repoId }: { repoId: string }) {
  const { ref, width, height } = useElementSize();
  const shell = useSettingsStore((s) => s.terminalShell);
  const noteEpoch = useTerminalStore((s) => s.noteEpoch);

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const termRef = React.useRef<Terminal | null>(null);
  const epochRef = React.useRef<number | null>(null);

  // Mount the terminal and open the session. Runs once per repoId.
  React.useEffect(() => {
    const term = new Terminal({
      fontFamily: "var(--font-mono), monospace",
      fontSize: 12,
      theme: themeFromCss(),
      // A terminal that cannot scroll back is a terminal that loses your build
      // output the moment it finishes.
      scrollback: 5000,
      allowProposedApi: false,
    });
    termRef.current = term;
    if (hostRef.current) term.open(hostRef.current);

    const typed = term.onData((data) => {
      void termWrite(repoId, data).catch(() => {
        /* the session is gone; the exit listener reports it */
      });
    });

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void (async () => {
      const epoch = await termOpen(repoId, term.rows, term.cols, shell);
      if (disposed) return;
      epochRef.current = epoch;
      noteEpoch(repoId, epoch);

      unlisteners.push(
        await listen<TermData>("term://data", (e) => {
          // Drop another repository's traffic, and a dead session's tail — a
          // reader mid-read when the terminal was reopened would otherwise
          // paint the old shell's last line into the new one.
          if (e.payload.repoId !== repoId) return;
          if (epochRef.current !== null && e.payload.epoch !== epochRef.current) return;
          const bytes = Uint8Array.from(atob(e.payload.data), (c) => c.charCodeAt(0));
          term.write(bytes);
        }),
      );
      unlisteners.push(
        await listen<TermExit>("term://exit", (e) => {
          if (e.payload.repoId !== repoId) return;
          if (epochRef.current !== null && e.payload.epoch !== epochRef.current) return;
          const code = e.payload.code;
          term.write(
            `\r\n\x1b[2m[shell exited${code === null ? "" : ` with ${code}`}]\x1b[0m\r\n`,
          );
          epochRef.current = null;
        }),
      );
    })();

    return () => {
      disposed = true;
      typed.dispose();
      for (const un of unlisteners) un();
      term.dispose();
      termRef.current = null;
      // The SESSION is deliberately left running: hiding the panel or switching
      // tabs must not kill the shell. `useTabsStore.close` is what ends it.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  // Fit on measured size, NOT on a ResizeObserver — WebKitGTK does not have one
  // and the Linux build would render 80x24 in a 200-column pane forever.
  // `useElementSize` reads first and observes second, per the frontend rules.
  React.useEffect(() => {
    const term = termRef.current;
    if (!term || width === 0 || height === 0) return;
    const cols = Math.max(20, Math.floor(width / CELL_W));
    const rows = Math.max(4, Math.floor(height / CELL_H));
    if (cols === term.cols && rows === term.rows) return;
    term.resize(cols, rows);
    void termResize(repoId, rows, cols).catch(() => {
      /* no session yet, or it is gone */
    });
  }, [width, height, repoId]);

  return (
    <div
      ref={ref}
      data-testid="terminal-view"
      style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "4px 6px" }}
    >
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
```

`useElementSize` returns `{ ref, width, height }` — confirm the exact shape (`grep -n 'ElementSize' src/lib/useElementSize.ts`) and adjust the destructure if it differs.

- [ ] **Step 8: Implement `TerminalPanel.tsx`**

```tsx
import React from "react";

import { PGIconButton, PGResizeHandle } from "@/design";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useTerminalStore } from "./useTerminalStore";
import { TerminalView } from "./TerminalView";
import { shellLabel } from "./shellLabel";

/**
 * The docked terminal, below the active screen (#243).
 *
 * Renders nothing when closed, and mounts a view only for the ACTIVE
 * repository — the inactive tabs' shells stay alive in the backend without
 * costing a renderer each.
 */
export function TerminalPanel() {
  const open = useTerminalStore((s) => s.open);
  const heightPx = useTerminalStore((s) => s.heightPx);
  const setHeight = useTerminalStore((s) => s.setHeight);
  const setOpen = useTerminalStore((s) => s.setOpen);
  const repo = useRepoStore((s) => s.current);
  const shell = useSettingsStore((s) => s.terminalShell);

  if (!open || !repo) return null;

  return (
    <div
      data-testid="terminal-panel"
      style={{
        height: heightPx,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--border-1)",
        background: "var(--bg-0)",
      }}
    >
      <PGResizeHandle
        orientation="vertical"
        side="top"
        testId="terminal-resize"
        onDrag={(dy) => setHeight(heightPx - dy)}
        onReset={() => setHeight(240)}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "2px 8px",
          fontSize: "var(--fs-11)",
          color: "var(--fg-3)",
        }}
      >
        <span>{shellLabel(shell)}</span>
        <span style={{ flex: 1 }} />
        <PGIconButton
          icon="close"
          size="sm"
          title="Hide terminal"
          onClick={() => setOpen(false)}
        />
      </div>
      {/* Keyed by repository: a switch mounts a new view rather than
          re-pointing this one at a different shell. */}
      <TerminalView key={repo.id} repoId={repo.id} />
    </div>
  );
}
```

Confirm `PGIconButton`'s available `icon` names (`grep -n 'close' src/design/icons.tsx | head`) and use one that exists.

Create `src/features/terminal/index.ts` exporting `TerminalPanel`, `useTerminalStore`, `shellLabel`.

- [ ] **Step 9: Run the tests and the type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- features/terminal
pnpm tsc --noEmit
```

Expected: all pass, no type errors.

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml src/features/terminal
git commit -m "feat(terminal): the panel, the view and its store (#243)

Why: per-repo session state lives in its own store, not RepoSlice —
RepoSlice is cleared on every tab switch, which is right for a diff and
would orphan the shells of every inactive tab. Sizing is measured
rather than observed: WebKitGTK has no ResizeObserver.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Wiring — the chord, the dock, the lifecycle

**Files:**
- Modify: `src/features/keymap/actions.ts`, `src/features/keymap/presets.ts`
- Modify: `src/AppShell.tsx:658-690` (`AppBody`)
- Modify: `src/features/repo/useTabsStore.ts` (`close`)
- Test: `src/features/terminal/TerminalPanel.test.tsx` (create)

**Interfaces:**
- Consumes: `TerminalPanel`, `useTerminalStore` (Task 5); `termClose` (Task 3).
- Produces: `ActionId` gains `"terminal.toggle"`.

- [ ] **Step 1: Write the failing test**

`src/features/terminal/TerminalPanel.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./TerminalView", () => ({
  TerminalView: ({ repoId }: { repoId: string }) => (
    <div data-testid="terminal-view">{repoId}</div>
  ),
}));

import { TerminalPanel } from "./TerminalPanel";
import { useTerminalStore } from "./useTerminalStore";
import { useRepoStore } from "@/features/repo/useRepoStore";

describe("TerminalPanel", () => {
  beforeEach(() => {
    useTerminalStore.setState({ open: false, heightPx: 240, epochs: {} });
  });

  it("renders nothing when closed", () => {
    useRepoStore.setState({ current: { id: "r1", path: "/tmp/r1" } } as never);
    const { container } = render(<TerminalPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing with no repository open", () => {
    useRepoStore.setState({ current: null } as never);
    useTerminalStore.setState({ open: true });
    const { container } = render(<TerminalPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mounts a view for the active repository when open", () => {
    useRepoStore.setState({ current: { id: "r1", path: "/tmp/r1" } } as never);
    useTerminalStore.setState({ open: true });
    render(<TerminalPanel />);
    expect(screen.getByTestId("terminal-view")).toHaveTextContent("r1");
  });
});
```

Check `useRepoStore`'s `current` shape first (`grep -n 'current:' src/features/repo/useRepoStore.ts | head`) and build the fixture to match — `as never` is a crutch, not the goal; if there is an existing repo fixture helper in `src/test/`, use it.

- [ ] **Step 2: Run to verify it fails, then make it pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- TerminalPanel
```

If Task 5's `TerminalPanel` is correct these pass immediately. That is fine — they are regression cover for the wiring about to happen, not a red-green cycle for code that already exists.

- [ ] **Step 3: Add the keymap action**

In `src/features/keymap/actions.ts`, add `| "terminal.toggle"` to `ActionId`, and to `ACTIONS`:

```ts
  "terminal.toggle": {
    id: "terminal.toggle",
    title: "Toggle terminal",
    category: "View",
    scope: "global",
    run: () => useTerminalStore.getState().toggle(),
  },
```

Import `useTerminalStore` from `@/features/terminal`. Match the `category` string to one that already exists in the file — read the `ACTIONS` entries around `view.zoomIn` and reuse its category verbatim.

In `src/features/keymap/presets.ts`, bind it in each preset. The default is `Ctrl+\``; read how another global chord is spelled in that file and copy the notation exactly.

- [ ] **Step 4: Dock the panel**

In `src/AppShell.tsx`, import `TerminalPanel` from `@/features/terminal` and place it inside `AppBody`'s screen column — the `<div data-pg-screen={screen}>` at line ~685 — as a sibling **after** `{screens[screen]}`:

```tsx
          {screens[screen]}
          <TerminalPanel />
```

That div is already `display: flex; flexDirection: column`, so the panel's fixed height and the screen's `flex: 1` compose without further layout work.

- [ ] **Step 5: Keep the shell's keys out of the global chord handler**

Find where the global key handler decides to ignore an event (`grep -n 'suppressInInput\|isEditable\|tagName' src/features/keymap/useKeymapStore.ts`). Extend that predicate so an event originating inside the terminal is ignored, except for `terminal.toggle` itself and the overlay-escape action:

```ts
  // A terminal that swallows Ctrl+C into the command palette instead of the
  // foreground process is worse than no terminal. Everything typed inside the
  // xterm host belongs to the shell — except the chord that hides the panel,
  // which is the way back out.
  const inTerminal = !!(e.target as HTMLElement | null)?.closest?.(
    "[data-testid='terminal-view']",
  );
  if (inTerminal && id !== "terminal.toggle" && id !== "app.closeOverlay") return;
```

Place it alongside the existing `suppressInInput` check, in the same style. Add a test to the keymap's existing test file asserting a chord bound to a non-terminal action does not fire when the event target is inside `[data-testid='terminal-view']`.

- [ ] **Step 6: Kill the shell when the repository tab closes**

In `src/features/repo/useTabsStore.ts`'s `close`, after the tab is removed:

```ts
    // The shell belongs to the tab. `termClose` is idempotent, so a tab that
    // never opened a terminal costs one no-op invoke.
    void termClose(repoId).catch(() => {});
    useTerminalStore.getState().forget(repoId);
```

`close` takes a `path`, so read how it resolves the path to a `RepoId` in that function and use the same value; if the id is not available there, call `termClose` with whatever the backend keys sessions by and make `term_open` key on the same thing. Verify by reading the `close` implementation before editing.

Add a test to the existing tabs test file asserting `termClose` is called on close (mock `@/lib/tauri` the way that file already does).

- [ ] **Step 7: Run everything and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test
```

Expected: the whole vitest suite green — including `AppShell.navroutes`, which is compile-enforced, and `docs`, which will FAIL until Task 7. Note the docs failure and continue; it is the next task's red.

```bash
git add src/features/keymap src/AppShell.tsx src/features/repo/useTabsStore.ts src/features/terminal
git commit -m "feat(terminal): dock the panel, bind the chord, end the shell with the tab (#243)

Why: keys typed in the terminal belong to the shell, so the global chord
handler stands down inside it — everything except the chord that hides
the panel, which is the way back out.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Documentation — which is a build gate here

`test/docs.test.ts` fails the build when `docs/dev/architecture.md` does not name every backend module and every `src/features/` directory. This task is not optional polish.

**Files:**
- Modify: `docs/dev/architecture.md`, `docs/dev/backend.md`, `docs/dev/frontend.md`, `CLAUDE.md`

- [ ] **Step 1: Run the gate to see exactly what it wants**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- docs
```

Expected: FAIL naming `terminal.rs`, the four `term_*` commands, and `features/terminal`.

- [ ] **Step 2: The backend tree**

In `docs/dev/architecture.md`, in the `src-tauri/src/` tree, after the `state.rs` entry (alphabetical):

```
terminal.rs      Live pty sessions for the built-in terminal (#243). Shape of
                 watcher.rs: a Default state manage-d on the app, thin handlers
                 in commands/terminal.rs. Sessions are keyed by RepoId, which is
                 what makes "one shell per repository tab" a property of the map
                 rather than a rule the frontend remembers; a second open for a
                 live repo returns the existing epoch instead of stacking a
                 shell. Output leaves through an INJECTED EventSink, not an
                 AppHandle — that is what lets tests/terminal.rs assert on the
                 exact stream the frontend sees, and it keeps the reader thread
                 free of the Tauri runtime. Data crosses as BASE64: a 4 KiB read
                 splits a multi-byte character often enough that from_utf8_lossy
                 would put U+FFFD inside filenames. Every event carries an epoch
                 and the frontend drops the ones that are not its own — a reader
                 still mid-read when the user reopened the terminal would else
                 paint the dead shell's tail into the new one. THIS FILE LOGS
                 NOTHING; tests/terminal_privacy.rs fails the build if it starts
                 to, because a terminal is where passwords get typed.
```

And in the `commands/` section, after `submodule.rs`:

```
                 terminal.rs — term_open/term_write/term_resize/term_close
                 (#243). Thin over crate::terminal. term_open resolves the
                 workdir through the backend, never from an argument, and picks
                 the shell (the Settings override, else proc::default_shell).
                 The lifecycle logging lives here rather than in terminal.rs
                 precisely because this file sees ids and exit codes and never a
                 byte of traffic.
```

Match the surrounding entries' indentation and wrapping exactly — the file is a fixed-width tree.

- [ ] **Step 3: The frontend tree**

In the `src/features/` tree, after `submodules/`:

```
── terminal/     The built-in terminal (#243). TerminalPanel docks below the
                 active screen and mounts ONE TerminalView, keyed by the active
                 repository. Per-repo session state lives in useTerminalStore
                 and NOT in RepoSlice: RepoSlice is cleared on every tab switch,
                 which is right for a diff and would orphan the shells of every
                 inactive tab. Sizing is MEASURED (useElementSize) rather than
                 observed — WebKitGTK has no ResizeObserver, so xterm's FitAddon
                 would leave the Linux build at 80x24 forever, which is why the
                 addon is not installed.
```

- [ ] **Step 4: `docs/dev/backend.md`**

Add a section under the process-spawning material:

```markdown
### The pty carve-out (#243)

`portable-pty` spawns through its own `CommandBuilder`, not
`std::process::Command`, so a pty opened outside `proc.rs` would sail straight
past the `Command::new` guard — the second spawn path #172 exists to prevent,
and invisible. `proc::spawn_pty_shell` therefore owns `openpty`, the
`CommandBuilder` and `spawn_command`, and `tests/spawn_no_window.rs` allow-lists
those three APIs in `proc.rs` and nowhere else.

Two things about that child are deliberate inversions worth knowing:

- **`GIT_TERMINAL_PROMPT` is NOT set to 0.** The standing `prompt_less` policy
  exists because a child of a GUI app has no terminal, so an auth prompt hangs
  behind a window nobody can see. This child *is* a terminal and the user is
  looking at it; inheriting the silence would turn a working `git push` into a
  mysterious failure.
- **`CREATE_NO_WINDOW` does not apply.** ConPTY is not `CreateProcess` with an
  inherited console — `portable-pty` allocates a pseudoconsole, so no `conhost`
  window appears and #172's flash cannot happen here.

And one rule with a test behind it: **`src/terminal.rs` contains no logging call
at all.** A terminal is where a `sudo` password gets typed. The bytes read from
the pty have exactly one destination — the event sink — and the lifecycle
logging worth having lives in `commands/terminal.rs`, which handles ids and exit
codes and never sees traffic. `tests/terminal_privacy.rs` enforces the split.
```

- [ ] **Step 5: `docs/dev/frontend.md`**

Add a section near the other pane/layout material:

```markdown
### The terminal panel (#243)

Docked in `AppBody`'s screen column, below the routed screen, height persisted
and drag-resized with the shared `PGResizeHandle`. Closed by default: a terminal
nobody asked for should not spawn a shell for every repository they open.

Three rules that are easy to break:

- **Sizing is measured, never observed.** WebKitGTK has no `ResizeObserver`, so
  xterm's `FitAddon` would leave the Linux build rendering 80×24 in a
  200-column pane forever. The panel uses `lib/useElementSize` (read first,
  observe second) and calls `term.resize` and `term_resize` together, so the
  renderer and the pty never disagree. The addon is deliberately not installed.
- **Per-repo state is NOT in `RepoSlice`.** `useTerminalStore` holds a session
  epoch for every open repository at once — the shape `useTabsStore` has.
  `RepoSlice` is cleared on every tab switch, which would orphan the shells of
  every inactive tab.
- **The global chord handler stands down inside the terminal.** Everything typed
  in the xterm host belongs to the shell, except `terminal.toggle` and the
  overlay escape. A terminal that swallows `Ctrl+C` into the command palette
  instead of the foreground process is worse than no terminal.
```

- [ ] **Step 6: `CLAUDE.md` — the pairs list goes from three to four**

Change the "Three near-identical filename pairs" paragraph to four and add the new pair:

```
**Four near-identical filename pairs do different jobs** — check before
editing: `git/signing.rs` (cryptography) vs `git/signature.rs` (identity/
sign-off); `src-tauri/src/update.rs` (engine) vs `commands/update.rs`
(handlers); `src-tauri/src/cli.rs` (pgit launch) vs `git/cli.rs` (CliBackend);
`src-tauri/src/terminal.rs` (pty sessions) vs `commands/terminal.rs` (handlers).
```

Keep the edit to that paragraph. `CLAUDE.md` is loaded into every session — do not add a section for the terminal; the pointers above carry it.

- [ ] **Step 7: Run the gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test -- docs
```

Expected: PASS. If it still names a `term_*` command, the command list entry in Step 2 is not in a form the expander reads — spell each of the four ids out individually rather than as a slashed group.

- [ ] **Step 8: Commit**

```bash
git add docs/dev CLAUDE.md
git commit -m "docs(terminal): the pty carve-out, the panel, the fourth filename pair (#243)

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The e2e spec, and the full gate

**Files:**
- Create: `e2e/specs/terminal.e2e.ts`

- [ ] **Step 1: Read the e2e skill first**

**REQUIRED:** read `.claude/skills/e2e-testing/SKILL.md` before writing a line of this spec. It carries the selector conventions, the temp-repo fixtures and the timing rules that make the difference between a spec that passes in CI and one that wastes a merge window.

- [ ] **Step 2: Write the spec**

Model it on the smallest existing spec in `e2e/specs/`. Shape:

```ts
// Toggle the panel, run one command, see its output. Everything finer-grained
// is cheaper and less flaky at the vitest and cargo layers — this exists to
// prove the pty reaches a real WebKit view at all.
```

1. Open a temp repository through the standard fixture.
2. Toggle the terminal (use the chord, or click the toggle if the spec harness makes chords awkward — follow whatever the other specs do).
3. Wait for `[data-testid='terminal-view']` to exist and for its text to be non-empty (the prompt).
4. Type `echo pgit-e2e-<unique>` + Enter.
5. Assert the unique marker appears in the panel's text.
6. Toggle it away and assert the panel is gone.

Use a unique marker per run so a stale snapshot cannot produce a false pass.

- [ ] **Step 3: Rebuild the snapshot and run only this spec**

A `src/` and `src-tauri/` change means the snapshot is stale. One cold container build at a time across ALL worktrees.

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/terminal.e2e.ts
```

- [ ] **Step 4: If xterm does not render headlessly**

This is the spec's stated risk. If the view mounts but never paints text, do **not** spend the merge window on it: reduce the spec to the panel-opens smoke test (steps 1-3 and 6, dropping the typing and the marker), leave a comment saying why, and note it in the PR body. The behaviour stays covered by `src-tauri/tests/terminal.rs` and the vitest layer. Do not delete the spec — a panel that fails to mount in a real webview is exactly what it should catch.

- [ ] **Step 5: The full local gate**

Run every layer against the final tree. A green number is only evidence for the tree it ran on, so this must come **after** the last edit.

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

Do **not** run the full vitest suite while a Docker e2e build is running — contention fakes a red.

Expected: all four clean. Confirm `no_telemetry` and `privacy` are among the passes; the two new dependencies are exactly what they exist to catch.

- [ ] **Step 6: Squash and open the PR**

The PR squashes to one commit anyway, so squash locally first for a clean message. Pin `main`'s SHA before the reset — a concurrent PR merging in between would otherwise be reverted by the squash.

```bash
git fetch origin
BASE=$(git rev-parse origin/main)
git reset --soft "$BASE"
git commit -m "feat(terminal): a built-in terminal, cd-ed to the open repository (#243)"
git push -u origin feat/builtin-terminal
gh pr create --title "feat(terminal): a built-in terminal, cd-ed to the open repository (#243)" --body "…"
```

The PR body must state: what shipped, the `proc.rs` carve-out and why the guard grew rather than gained an exception, the base64 decision, that the refresh bullet was satisfied by #239 rather than reimplemented, that Windows ConPTY is reasoned but unmeasured, and whatever happened to the e2e spec in Step 4.

- [ ] **Step 7: Watch CI**

`gh run watch` has lied about exit codes here — read the run's **conclusion**, never the watcher's exit status:

```bash
gh pr checks --watch
gh run list --branch feat/builtin-terminal --limit 3 --json conclusion,name,status
```

`e2e-linux` is the required check and it is a known flake source. Three reds is not proof it is you — a wandering sub-test is the flake tell. Compare per-spec `driver scripts` counts against `main` before assuming the terminal broke something unrelated.

---

## Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| Backend / session registry / reader thread | 2 |
| `term_open`/`write`/`resize`/`close` | 3 |
| The `proc.rs` carve-out + guard | 1 |
| No logging of pty traffic | 2 (guard), 3 (the split) |
| `TerminalUnavailable` | 3 |
| Frontend store / panel / view / theme / measured fit | 5 |
| Keyboard, lifecycle, dock | 6 |
| Settings | 4 |
| Tauri permissions (none) | — nothing to do; recorded in the spec |
| Refresh (already done by #239) | — nothing to do; recorded in the spec |
| Dependencies | 1 (Rust), 5 (npm) |
| Testing: Rust / guards / vitest / docs / e2e | 1, 2, 3, 5, 6, 7, 8 |
| Risks: xterm headless / ConPTY / shell startup | 8 Step 4; 8 Step 6 PR body; 5 (the "starting…" line is the panel header's shell label) |

**Known open thread, deliberately left to the implementer:** Task 6 Step 6 says to verify how `useTabsStore.close` resolves a path to a `RepoId` before wiring `termClose`. The tabs store is keyed by path and the terminal by `RepoId`; if `close` does not have the id in hand, the fix is to key sessions by whatever `close` does have and make `term_open` agree. Both are consistent choices — the plan does not pick one because the answer is three lines of reading away and picking wrong would be worse than looking.

**Type consistency:** `epoch` is `u64` in Rust and `number` in TS throughout; `repo_id`/`repoId` follows Tauri's camelCase serde rename in every payload; `TerminalState::open` returns the epoch in Rust and `termOpen` returns `Promise<number>`; `EventSink` is `Arc<dyn Fn(TermEvent) + Send + Sync>` in Task 2's interface block, its implementation, and the test recorder.
