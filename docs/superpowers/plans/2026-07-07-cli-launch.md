# CLI Launch Capability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pgit [subcommand] [path]` launches PlatypusGit with the right repo open and the right screen showing; a second invocation forwards to the running instance instead of spawning a new one.

**Architecture:** The app binary itself parses argv into a `LaunchIntent` (pure Rust module, unit-tested). First launch stashes the intent in managed state; the webview pulls it once via a `take_launch_intent` command. Later invocations are intercepted by `tauri-plugin-single-instance`, which forwards argv+cwd to the running process; it emits a `cli-launch` event to the webview and focuses the window. A Settings section installs `pgit` as a symlink to the current executable.

**Tech Stack:** Rust (tauri 2, tauri-plugin-single-instance 2, git2), React/TS, Zustand, vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-07-cli-launch-design.md`

## Global Constraints

- Branch `feat/cli-launch`; never commit to `main`; Conventional Commits.
- Every IPC-crossing Rust fn returns `AppResult<T>`; no unwrap/panic in commands.
- No new `AppError` variants needed (shim-install permission failure is a structured outcome, not an error).
- Serde structs crossing IPC use `#[serde(rename_all = "camelCase")]`; TS types in `src/lib/types.ts` mirror them exactly.
- Frontend never calls `invoke()` directly — wrappers in `src/lib/tauri.ts`.
- Prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` to every `pnpm`/`cargo` command.
- Screen ids are the frontend `ScreenId` strings: `commit`, `history`, `branches`.
- Shim name is `pgit`; locations: macOS `/usr/local/bin/pgit`, Linux `~/.local/bin/pgit`, Windows unsupported.
- Env var `PLATYPUSGIT_NO_SINGLE_INSTANCE=1` must skip the single-instance plugin (e2e + parallel dev instances).

---

### Task 1: Rust CLI arg parsing (`src-tauri/src/cli.rs`)

**Files:**
- Create: `src-tauri/src/cli.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod cli;` only)
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/cli.rs`

**Interfaces:**
- Produces: `cli::LaunchIntent { path: Option<PathBuf>, screen: Option<String> }` (Serialize, camelCase), `cli::Parsed { Help, Launch(Option<LaunchIntent>) }`, `cli::parse_args(args: &[String], cwd: &Path) -> Parsed`, `cli::resolve_repo_root(intent: LaunchIntent) -> LaunchIntent`, `cli::USAGE: &str`. Tasks 3 consumes all of these.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/cli.rs` with the test module first (types/fns referenced but unimplemented won't compile — that's the TDD "red" for Rust; write the minimal type/fn signatures with `todo!()` bodies so tests compile, then watch them fail):

```rust
use std::path::{Path, PathBuf};

use serde::Serialize;

/// What a CLI invocation asked for. `path` is absolute (resolved against the
/// invoking shell's cwd); `screen` is a frontend ScreenId string.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchIntent {
    pub path: Option<PathBuf>,
    pub screen: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Parsed {
    Help,
    /// `None` = plain app launch (no CLI args at all).
    Launch(Option<LaunchIntent>),
}

pub const USAGE: &str = "\
PlatypusGit

Usage: pgit [subcommand] [path]

Subcommands:
  commit | status    open the Commit panel
  log | history      open the History screen
  branches           open the Branches screen

With a path and no subcommand, opens the repo containing that path.
With a subcommand and no path, uses the current directory.
With no arguments, performs a plain app launch.
";

pub fn parse_args(args: &[String], cwd: &Path) -> Parsed {
    todo!()
}

pub fn resolve_repo_root(intent: LaunchIntent) -> LaunchIntent {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn bare_launch_has_no_intent() {
        assert_eq!(parse_args(&[], Path::new("/w")), Parsed::Launch(None));
    }

    #[test]
    fn help_flag_wins() {
        assert_eq!(parse_args(&s(&["--help"]), Path::new("/w")), Parsed::Help);
        assert_eq!(parse_args(&s(&["commit", "-h"]), Path::new("/w")), Parsed::Help);
    }

    #[test]
    fn path_only_opens_repo_without_screen() {
        assert_eq!(
            parse_args(&s(&["/abs/repo"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/abs/repo")),
                screen: None,
            }))
        );
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        assert_eq!(
            parse_args(&s(&["sub/dir"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/w/sub/dir")),
                screen: None,
            }))
        );
    }

    #[test]
    fn subcommand_without_path_uses_cwd() {
        for (cmd, screen) in [
            ("commit", "commit"),
            ("status", "commit"),
            ("log", "history"),
            ("history", "history"),
            ("branches", "branches"),
        ] {
            assert_eq!(
                parse_args(&s(&[cmd]), Path::new("/w")),
                Parsed::Launch(Some(LaunchIntent {
                    path: Some(PathBuf::from("/w")),
                    screen: Some(screen.to_string()),
                })),
                "subcommand {cmd}"
            );
        }
    }

    #[test]
    fn subcommand_with_path() {
        assert_eq!(
            parse_args(&s(&["log", "src"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/w/src")),
                screen: Some("history".to_string()),
            }))
        );
    }

    #[test]
    fn unknown_first_token_is_a_path() {
        assert_eq!(
            parse_args(&s(&["foo"]), Path::new("/w")),
            Parsed::Launch(Some(LaunchIntent {
                path: Some(PathBuf::from("/w/foo")),
                screen: None,
            }))
        );
    }

    #[test]
    fn resolve_repo_root_finds_workdir_from_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        git2::Repository::init(&root).unwrap();
        let sub = root.join("a/b");
        std::fs::create_dir_all(&sub).unwrap();
        let out = resolve_repo_root(LaunchIntent {
            path: Some(sub),
            screen: None,
        });
        assert_eq!(out.path, Some(root));
    }

    #[test]
    fn resolve_repo_root_passes_non_repo_through() {
        let tmp = tempfile::tempdir().unwrap();
        let p = tmp.path().join("nowhere");
        let out = resolve_repo_root(LaunchIntent {
            path: Some(p.clone()),
            screen: Some("commit".into()),
        });
        assert_eq!(out.path, Some(p));
        assert_eq!(out.screen, Some("commit".to_string()));
    }
}
```

Add `pub mod cli;` to the module list at the top of `src-tauri/src/lib.rs`.

Note: `tempfile = "3"` is already in `[dev-dependencies]`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml cli::`
Expected: FAIL — panics with `not yet implemented` (the `todo!()`s).

- [ ] **Step 3: Implement**

Replace the two `todo!()` bodies:

```rust
fn screen_for(token: &str) -> Option<&'static str> {
    match token {
        "commit" | "status" => Some("commit"),
        "log" | "history" => Some("history"),
        "branches" => Some("branches"),
        _ => None,
    }
}

fn resolve_path(arg: &str, cwd: &Path) -> PathBuf {
    let p = PathBuf::from(arg);
    if p.is_absolute() {
        p
    } else {
        cwd.join(p)
    }
}

/// Parse CLI args (argv without the binary name). Pure — no filesystem
/// access; relative paths resolve against `cwd`.
pub fn parse_args(args: &[String], cwd: &Path) -> Parsed {
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return Parsed::Help;
    }
    let mut screen: Option<String> = None;
    let mut path: Option<PathBuf> = None;
    for (i, arg) in args.iter().enumerate() {
        if i == 0 {
            if let Some(s) = screen_for(arg) {
                screen = Some(s.to_string());
                continue;
            }
        }
        if path.is_none() {
            path = Some(resolve_path(arg, cwd));
        }
    }
    if screen.is_some() && path.is_none() {
        path = Some(cwd.to_path_buf());
    }
    match (path, &screen) {
        (None, None) => Parsed::Launch(None),
        (path, _) => Parsed::Launch(Some(LaunchIntent { path, screen })),
    }
}

/// Widen a CLI path to its repo workdir root (backend `open` requires the
/// root, CLI users sit in subdirectories). Non-repo paths pass through so
/// the normal open_repo error path reports NotARepo.
pub fn resolve_repo_root(intent: LaunchIntent) -> LaunchIntent {
    let path = intent.path.map(|p| {
        git2::Repository::discover(&p)
            .ok()
            .and_then(|r| r.workdir().map(PathBuf::from))
            .unwrap_or(p)
    });
    LaunchIntent { path, ..intent }
}
```

Gotcha: the `resolve_repo_root_finds_workdir_from_subdir` test canonicalizes the tempdir (macOS `/tmp` → `/private/tmp` symlink) and asserts against `workdir()` — `Repository::discover` returns the canonical path, and `workdir()` returns a trailing-slash-free `PathBuf`. If the assertion fails on a trailing slash, canonicalize both sides in the test rather than changing the production code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml cli::`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cli.rs src-tauri/src/lib.rs
git commit -m "feat(cli): parse pgit argv into launch intents"
```

---

### Task 2: Shim install + status logic (pure part of `cli.rs`)

**Files:**
- Modify: `src-tauri/src/cli.rs` (append)
- Test: same inline `tests` module

**Interfaces:**
- Produces: `cli::CliShimStatus { installed: bool, shim_path: String, target: String }` (Serialize, camelCase), `cli::CliInstallOutcome { installed: bool, path: String, manual_command: Option<String> }` (Serialize, camelCase), `cli::shim_status() -> CliShimStatus`, `cli::install_shim() -> CliInstallOutcome`, plus dir-parameterized internals `install_shim_at(dir, exe)` / `shim_installed_at(dir, exe)`. Task 3 wraps the two public fns in commands.

- [ ] **Step 1: Write the failing tests**

Append to the `tests` module in `src-tauri/src/cli.rs`:

```rust
    #[cfg(unix)]
    #[test]
    fn install_shim_creates_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("platypusgit");
        std::fs::write(&exe, b"#!/bin/sh\n").unwrap();
        let link = install_shim_at(dir.path(), &exe).unwrap();
        assert_eq!(link, dir.path().join("pgit"));
        assert_eq!(std::fs::read_link(&link).unwrap(), exe);
        assert!(shim_installed_at(dir.path(), &exe));
    }

    #[cfg(unix)]
    #[test]
    fn install_shim_replaces_stale_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old-exe");
        let new = dir.path().join("new-exe");
        std::fs::write(&old, b"x").unwrap();
        std::fs::write(&new, b"x").unwrap();
        install_shim_at(dir.path(), &old).unwrap();
        assert!(!shim_installed_at(dir.path(), &new));
        install_shim_at(dir.path(), &new).unwrap();
        assert_eq!(std::fs::read_link(dir.path().join("pgit")).unwrap(), new);
        assert!(shim_installed_at(dir.path(), &new));
    }

    #[cfg(unix)]
    #[test]
    fn shim_not_installed_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!shim_installed_at(dir.path(), Path::new("/x")));
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml cli::`
Expected: compile error — `install_shim_at` / `shim_installed_at` not found.

- [ ] **Step 3: Implement**

Append to `src-tauri/src/cli.rs` (above the tests module):

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliShimStatus {
    pub installed: bool,
    pub shim_path: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallOutcome {
    pub installed: bool,
    pub path: String,
    /// Set when we couldn't write the symlink (permissions): the command the
    /// user should run themselves. Not an error — Settings renders it.
    pub manual_command: Option<String>,
}

/// Where the `pgit` shim goes. None on unsupported platforms (Windows).
pub fn default_shim_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        Some(PathBuf::from("/usr/local/bin"))
    }
    #[cfg(target_os = "linux")]
    {
        std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/bin"))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

#[cfg(unix)]
pub fn install_shim_at(dir: &Path, exe: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let link = dir.join("pgit");
    if link.symlink_metadata().is_ok() {
        std::fs::remove_file(&link)?;
    }
    std::os::unix::fs::symlink(exe, &link)?;
    Ok(link)
}

#[cfg(unix)]
pub fn shim_installed_at(dir: &Path, exe: &Path) -> bool {
    std::fs::read_link(dir.join("pgit"))
        .map(|target| target == exe)
        .unwrap_or(false)
}

pub fn shim_status() -> CliShimStatus {
    let exe = std::env::current_exe().unwrap_or_default();
    let dir = default_shim_dir();
    let shim_path = dir
        .as_deref()
        .map(|d| d.join("pgit").display().to_string())
        .unwrap_or_default();
    #[cfg(unix)]
    let installed = dir.as_deref().is_some_and(|d| shim_installed_at(d, &exe));
    #[cfg(not(unix))]
    let installed = false;
    CliShimStatus {
        installed,
        shim_path,
        target: exe.display().to_string(),
    }
}

pub fn install_shim() -> CliInstallOutcome {
    let exe = std::env::current_exe().unwrap_or_default();
    let Some(dir) = default_shim_dir() else {
        return CliInstallOutcome {
            installed: false,
            path: String::new(),
            manual_command: None,
        };
    };
    let link_display = dir.join("pgit").display().to_string();
    #[cfg(unix)]
    {
        match install_shim_at(&dir, &exe) {
            Ok(link) => CliInstallOutcome {
                installed: true,
                path: link.display().to_string(),
                manual_command: None,
            },
            Err(_) => CliInstallOutcome {
                installed: false,
                path: link_display.clone(),
                manual_command: Some(format!(
                    "sudo ln -sf \"{}\" \"{}\"",
                    exe.display(),
                    link_display
                )),
            },
        }
    }
    #[cfg(not(unix))]
    {
        CliInstallOutcome {
            installed: false,
            path: link_display,
            manual_command: None,
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml cli::`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cli.rs
git commit -m "feat(cli): pgit shim install and status detection"
```

---

### Task 3: Wire into the app — single-instance plugin, managed state, commands

**Files:**
- Modify: `src-tauri/Cargo.toml` (via `cargo add`)
- Create: `src-tauri/src/commands/cli.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod cli;`)
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: everything `cli::` from Tasks 1–2.
- Produces: Tauri commands `take_launch_intent() -> Option<LaunchIntent>`, `cli_shim_status() -> CliShimStatus`, `install_cli_shim() -> CliInstallOutcome`; Tauri event `cli-launch` with `LaunchIntent` payload (camelCase: `{ path, screen }`). Task 4's TS wrappers call these by exactly these names.

- [ ] **Step 1: Add the plugin dependency**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo add tauri-plugin-single-instance --manifest-path src-tauri/Cargo.toml
```

No JS package and no capability change needed: the plugin has no frontend API, Rust-side `emit` needs no permission, and webview `listen` is covered by `core:default`.

- [ ] **Step 2: Command handlers**

Create `src-tauri/src/commands/cli.rs`:

```rust
use std::sync::Mutex;

use tauri::State;

use crate::{
    cli::{self, CliInstallOutcome, CliShimStatus, LaunchIntent},
    error::{AppError, AppResult},
};

/// First-launch CLI intent, stashed by `run()` before the webview exists.
/// Take-once: a webview reload must not replay it.
pub struct CliLaunchState(pub Mutex<Option<LaunchIntent>>);

#[tauri::command]
pub fn take_launch_intent(
    state: State<'_, CliLaunchState>,
) -> AppResult<Option<LaunchIntent>> {
    Ok(state
        .0
        .lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .take())
}

#[tauri::command]
pub async fn cli_shim_status() -> AppResult<CliShimStatus> {
    tokio::task::spawn_blocking(cli::shim_status)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}

#[tauri::command]
pub async fn install_cli_shim() -> AppResult<CliInstallOutcome> {
    tokio::task::spawn_blocking(cli::install_shim)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))
}
```

Add `pub mod cli;` to `src-tauri/src/commands/mod.rs`.

- [ ] **Step 3: Wire `run()` in `src-tauri/src/lib.rs`**

At the top of `run()` (before building the backend), parse argv and handle `--help`; register the single-instance plugin FIRST (its documented requirement); manage the intent state; register the three commands.

```rust
pub fn run() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    let initial_intent = match cli::parse_args(&args, &cwd) {
        cli::Parsed::Help => {
            print!("{}", cli::USAGE);
            return;
        }
        cli::Parsed::Launch(intent) => intent.map(cli::resolve_repo_root),
    };

    let backend = Arc::new(Libgit2Backend::new());

    let mut builder = tauri::Builder::default();

    // Single-instance must be the first registered plugin. A later `pgit …`
    // invocation lands here in the ALREADY-RUNNING process: forward the
    // parsed intent to the webview and surface the window. Opt-out env var
    // for e2e runs and parallel dev instances, which must not
    // forward-and-exit into each other.
    if std::env::var("PLATYPUSGIT_NO_SINGLE_INSTANCE").is_err() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            use tauri::{Emitter, Manager};
            let args: Vec<String> = argv.into_iter().skip(1).collect();
            if let cli::Parsed::Launch(Some(intent)) =
                cli::parse_args(&args, std::path::Path::new(&cwd))
            {
                let intent = cli::resolve_repo_root(intent);
                if let Err(e) = app.emit("cli-launch", &intent) {
                    log::error!("failed to emit cli-launch: {e}");
                }
            }
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }));
    }

    let builder = builder
        .plugin(
            tauri_plugin_log::Builder::new()
                // …existing log plugin config unchanged…
```

Then in the chain below, add alongside the existing `.manage(AppState::new(backend))`:

```rust
        .manage(commands::cli::CliLaunchState(Mutex::new(initial_intent)))
```

(`use std::sync::Mutex;` at the top of lib.rs.) And register in `invoke_handler!`:

```rust
            commands::cli::take_launch_intent,
            commands::cli::cli_shim_status,
            commands::cli::install_cli_shim,
```

- [ ] **Step 4: Verify**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`
Expected: clean check, all existing tests + 12 cli tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/cli.rs
git commit -m "feat(cli): single-instance forwarding, launch-intent state, shim commands"
```

---

### Task 4: Frontend — types, wrappers, `useCliLaunch` hook

**Files:**
- Modify: `src/lib/types.ts`, `src/lib/tauri.ts`
- Create: `src/features/cli/useCliLaunch.ts`
- Create: `src/test/eventMock.ts`; Modify: `src/test/setup.ts`
- Modify: `src/AppShell.tsx` (mount hook)
- Test: `src/features/cli/useCliLaunch.test.tsx`

**Interfaces:**
- Consumes: commands from Task 3 (`take_launch_intent`, event `cli-launch` with payload `{ path: string | null, screen: string | null }`).
- Produces: `useCliLaunch()` hook (mounted once in AppShell); `LaunchIntent`, `CliShimStatus`, `CliInstallOutcome` TS types; `takeLaunchIntent()`, `cliShimStatus()`, `installCliShim()` wrappers; test helpers `emitMockEvent(event, payload)` / `resetEventMock()`. Task 5 consumes the types + wrappers.

- [ ] **Step 1: Event mock for tests**

Create `src/test/eventMock.ts`:

```ts
// Per-test mock of @tauri-apps/api/event. Register listeners via the mocked
// listen(); fire them from tests with emitMockEvent(). Reset in setup.ts.

type Handler = (event: { payload: unknown }) => void;

const listeners = new Map<string, Set<Handler>>();

export async function listen(
  event: string,
  handler: Handler,
): Promise<() => void> {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler);
  return () => {
    set.delete(handler);
  };
}

export function emitMockEvent(event: string, payload: unknown): void {
  listeners.get(event)?.forEach((h) => h({ payload }));
}

export function resetEventMock(): void {
  listeners.clear();
}
```

In `src/test/setup.ts` add (next to the other `vi.mock` calls):

```ts
vi.mock("@tauri-apps/api/event", async () => {
  return await import("./eventMock");
});
```

and import + call `resetEventMock()` inside the existing `afterEach` (import at top: `import { resetEventMock } from "./eventMock";`).

- [ ] **Step 2: Types + wrappers**

Append to `src/lib/types.ts`:

```ts
/** CLI launch request (pgit [subcommand] [path]) — mirrors Rust cli::LaunchIntent. */
export interface LaunchIntent {
  path: string | null;
  screen: string | null;
}

export interface CliShimStatus {
  installed: boolean;
  shimPath: string;
  target: string;
}

export interface CliInstallOutcome {
  installed: boolean;
  path: string;
  manualCommand: string | null;
}
```

Append to `src/lib/tauri.ts` (import the three types in the existing type import):

```ts
export async function takeLaunchIntent(): Promise<LaunchIntent | null> {
  return invoke<LaunchIntent | null>("take_launch_intent");
}

export async function cliShimStatus(): Promise<CliShimStatus> {
  return invoke<CliShimStatus>("cli_shim_status");
}

export async function installCliShim(): Promise<CliInstallOutcome> {
  return invoke<CliInstallOutcome>("install_cli_shim");
}
```

- [ ] **Step 3: Write the failing hook test**

Create `src/features/cli/useCliLaunch.test.tsx`:

```tsx
import React from "react";
import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { emitMockEvent } from "@/test/eventMock";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useCliLaunch } from "./useCliLaunch";

function Probe() {
  useCliLaunch();
  return null;
}

// Zustand stores are module singletons: stub openRepo per test, restore after.
const realOpenRepo = useRepoStore.getState().openRepo;
let openRepo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openRepo = vi.fn().mockResolvedValue(undefined);
  useRepoStore.setState({ openRepo: openRepo as never });
  useNavStore.getState().clearIntent();
});

afterEach(() => {
  useRepoStore.setState({ openRepo: realOpenRepo });
});

describe("useCliLaunch", () => {
  it("opens repo and switches screen from the initial intent", async () => {
    mockInvoke("take_launch_intent", () => ({
      path: "/tmp/repo",
      screen: "commit",
    }));
    render(<Probe />);
    await waitFor(() => expect(openRepo).toHaveBeenCalledWith("/tmp/repo"));
    await waitFor(() =>
      expect(useNavStore.getState().intent).toEqual({
        kind: "switch-screen",
        screen: "commit",
      }),
    );
  });

  it("path-only intent opens repo without switching screen", async () => {
    mockInvoke("take_launch_intent", () => ({ path: "/tmp/repo", screen: null }));
    render(<Probe />);
    await waitFor(() => expect(openRepo).toHaveBeenCalledWith("/tmp/repo"));
    expect(useNavStore.getState().intent).toBeNull();
  });

  it("does nothing on a plain launch (null intent)", async () => {
    mockInvoke("take_launch_intent", () => null);
    render(<Probe />);
    // Give the mount effect a tick to resolve.
    await waitFor(() => expect(openRepo).not.toHaveBeenCalled());
    expect(useNavStore.getState().intent).toBeNull();
  });

  it("handles a forwarded cli-launch event from a second invocation", async () => {
    mockInvoke("take_launch_intent", () => null);
    render(<Probe />);
    // Let the mount effect finish registering the listener.
    await waitFor(() => expect(openRepo).not.toHaveBeenCalled());
    emitMockEvent("cli-launch", { path: "/tmp/other", screen: "history" });
    await waitFor(() => expect(openRepo).toHaveBeenCalledWith("/tmp/other"));
    await waitFor(() =>
      expect(useNavStore.getState().intent).toEqual({
        kind: "switch-screen",
        screen: "history",
      }),
    );
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test useCliLaunch`
Expected: FAIL — `./useCliLaunch` module not found.

- [ ] **Step 5: Implement the hook**

Create `src/features/cli/useCliLaunch.ts`:

```ts
import React from "react";
import { listen } from "@tauri-apps/api/event";

import { takeLaunchIntent } from "@/lib/tauri";
import type { LaunchIntent } from "@/lib/types";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";

async function handleIntent(intent: LaunchIntent | null): Promise<void> {
  if (!intent) return;
  if (intent.path) {
    // A failed open surfaces the normal error banner; the screen switch
    // below is harmless alongside it.
    await useRepoStore.getState().openRepo(intent.path);
  }
  if (intent.screen) {
    useNavStore.getState().setIntent({
      kind: "switch-screen",
      screen: intent.screen,
    });
  }
}

/**
 * CLI launch plumbing, mounted once in AppShell. Pulls the first-launch
 * intent (take-once command), then listens for `cli-launch` events forwarded
 * by the single-instance plugin when the user runs `pgit …` again.
 */
export function useCliLaunch(): void {
  React.useEffect(() => {
    void takeLaunchIntent().then(handleIntent);
    const unlisten = listen<LaunchIntent>("cli-launch", (e) => {
      void handleIntent(e.payload);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);
}
```

Mount in `src/AppShell.tsx` — inside `AppShell()`, right after `usePreventBrowserContextMenu();`:

```tsx
  useCliLaunch();
```

with import `import { useCliLaunch } from "@/features/cli/useCliLaunch";`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test useCliLaunch && pnpm tsc --noEmit`
Expected: 4 tests PASS; typecheck clean.

- [ ] **Step 7: Run the whole frontend suite**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test`
Expected: all pass (the new event mock must not break existing tests — none import `@tauri-apps/api/event` today, so no behavior change).

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts src/features/cli/ src/test/eventMock.ts src/test/setup.ts src/AppShell.tsx
git commit -m "feat(cli): frontend launch-intent handling via take-once command + event"
```

---

### Task 5: Settings "Command line" section

**Files:**
- Modify: `src/screens/Settings.tsx`
- Test: `src/screens/Settings.cli.test.tsx`

**Interfaces:**
- Consumes: `cliShimStatus()`, `installCliShim()` from Task 4; existing `Section`/`Row` locals in Settings.tsx; `platform()` from `@tauri-apps/plugin-os` (already mocked to `"macos"` in tests).

- [ ] **Step 1: Write the failing test**

Create `src/screens/Settings.cli.test.tsx`:

```tsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { SettingsScreen } from "./Settings";

function mockShim(installed: boolean) {
  mockInvoke("cli_shim_status", () => ({
    installed,
    shimPath: "/usr/local/bin/pgit",
    target: "/Applications/PlatypusGit.app/Contents/MacOS/platypusgit",
  }));
}

describe("Settings command line section", () => {
  it("shows not-installed status and installs on click", async () => {
    mockShim(false);
    mockInvoke("install_cli_shim", () => ({
      installed: true,
      path: "/usr/local/bin/pgit",
      manualCommand: null,
    }));
    render(<SettingsScreen />);
    expect(await screen.findByText(/not installed/i)).toBeInTheDocument();
    // Status refresh after install reports installed.
    mockShim(true);
    await userEvent.click(
      screen.getByRole("button", { name: /install pgit/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/\/usr\/local\/bin\/pgit/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/not installed/i)).not.toBeInTheDocument();
  });

  it("shows the manual command when install lacks permissions", async () => {
    mockShim(false);
    mockInvoke("install_cli_shim", () => ({
      installed: false,
      path: "/usr/local/bin/pgit",
      manualCommand: 'sudo ln -sf "/app/platypusgit" "/usr/local/bin/pgit"',
    }));
    render(<SettingsScreen />);
    await userEvent.click(
      await screen.findByRole("button", { name: /install pgit/i }),
    );
    expect(
      await screen.findByText(/sudo ln -sf/),
    ).toBeInTheDocument();
  });
});
```

Note: `SettingsScreen` renders other sections that call stores but no invokes on mount today — if rendering trips an unmocked invoke, register that command with `mockInvoke` in the test rather than shrinking the render scope.

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test Settings.cli`
Expected: FAIL — no "not installed" text / no install button.

- [ ] **Step 3: Implement the section**

In `src/screens/Settings.tsx`:

- Imports: add `platform` from `@tauri-apps/plugin-os`; `cliShimStatus, installCliShim` from `@/lib/tauri`; `CliShimStatus` type from `@/lib/types`.
- Render `<CliSection />` after `<KeyboardSection />` in `SettingsScreen`.
- Add the component (near `KeyboardSection`):

```tsx
function CliSection() {
  const isWindows = platform() === "windows";
  const [status, setStatus] = React.useState<CliShimStatus | null>(null);
  const [manual, setManual] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(() => {
    cliShimStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  React.useEffect(() => {
    if (!isWindows) refresh();
  }, [isWindows, refresh]);

  const install = async () => {
    setBusy(true);
    try {
      const out = await installCliShim();
      if (out.installed) {
        setManual(null);
        pgFlash(`pgit installed at ${out.path}`);
        refresh();
      } else if (out.manualCommand) {
        setManual(out.manualCommand);
      }
    } catch {
      setManual(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="Command line"
      subtitle="Launch platypusgit from a terminal: pgit [commit|status|log|history|branches] [path]."
    >
      {isWindows ? (
        <Row
          label="pgit command"
          hint="Not yet supported on Windows. Add the install directory to PATH manually to use platypusgit.exe from a terminal."
          control={<span />}
        />
      ) : (
        <Row
          label="pgit command"
          hint={
            status?.installed ? (
              <>
                Installed at{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>
                  {status.shimPath}
                </code>
              </>
            ) : (
              <>
                Not installed.{" "}
                {manual && (
                  <>
                    Automatic install failed (permissions) — run:{" "}
                    <code
                      style={{
                        fontFamily: "var(--font-mono)",
                        userSelect: "all",
                      }}
                    >
                      {manual}
                    </code>
                  </>
                )}
              </>
            )
          }
          control={
            <PGButton size="sm" onClick={install} disabled={busy}>
              {status?.installed ? "Reinstall pgit" : "Install pgit"}
            </PGButton>
          }
        />
      )}
    </Section>
  );
}
```

(Both button labels match `/install pgit/i`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test Settings.cli && pnpm tsc --noEmit`
Expected: 2 tests PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/screens/Settings.tsx src/screens/Settings.cli.test.tsx
git commit -m "feat(settings): command line section — install pgit shim"
```

---

### Task 6: E2E guard, docs, full verification

**Files:**
- Modify: `e2e/wdio.conf.ts`
- Modify: `README.md`, `implemented-features.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `PLATYPUSGIT_NO_SINGLE_INSTANCE` opt-out from Task 3.

- [ ] **Step 1: Keep single-instance out of e2e runs**

In `e2e/wdio.conf.ts`, right after the imports:

```ts
// The app registers tauri-plugin-single-instance; a test binary starting
// while any platypusgit instance runs would forward-and-exit instead of
// serving WebDriver. The env var (checked in lib.rs run()) disables the
// plugin for children of this process.
process.env.PLATYPUSGIT_NO_SINGLE_INSTANCE = "1";
```

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm exec tsc -p e2e/tsconfig.json --noEmit`
Expected: clean.

- [ ] **Step 2: Docs**

- `README.md`: add a "CLI" section documenting `pgit [subcommand] [path]`, the subcommand→screen table from the spec, single-instance forwarding, and install via Settings → Command line (manual: `sudo ln -sf <app-binary> /usr/local/bin/pgit`).
- `implemented-features.md`: add a CLI launch entry matching the file's existing format.
- `CLAUDE.md`: add `cli.rs` + `commands/cli.rs` to the backend tree, `features/cli/` to the frontend tree, the spec to the "Recent specs/plans" list, and a note in the e2e section that wdio sets `PLATYPUSGIT_NO_SINGLE_INSTANCE=1`.

- [ ] **Step 3: Full verification**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e     # full rebuild — src/ AND src-tauri/ changed
```

Expected: everything green (e2e: 14 files, 50 tests). Close any running `pnpm tauri dev` first (port 4445).

- [ ] **Step 4: Manual smoke test (macOS)**

```bash
# First instance with args:
./e2e/.bin/platypusgit commit .   # from a repo dir → app opens on Commit panel
# Second invocation while it runs (new terminal, some other repo):
./e2e/.bin/platypusgit log ~/dev/fun/platypusgit   # running window focuses, History opens
./e2e/.bin/platypusgit --help                      # prints usage, no window
```

(The e2e snapshot binary embeds the frontend, so it works standalone. It is a debug build — WebDriver on 4445 — so close other instances first.)

- [ ] **Step 5: Commit**

```bash
git add e2e/wdio.conf.ts README.md implemented-features.md CLAUDE.md
git commit -m "test(e2e): disable single-instance in e2e; docs for pgit CLI"
```
