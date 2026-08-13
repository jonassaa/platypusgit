# Issue #61 Tier 2, PR 3 — credentials and commit signing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make authenticated remotes work (D5) and let commits be signed and verified (D6).

**Architecture:** D5 keeps the first attempt prompt-less exactly as today, classifies an auth failure out of git's stderr, and **retries** with an askpass that already knows the answer — the askpass being our own binary re-invoked through a new `--askpass` intent, reading its answer from the environment. Storage is delegated entirely to `git credential`, so we hold no secrets. D6 replaces `repo.commit` with `commit_create_buffer` → sign → `commit_signed` on the signed path only, and must move HEAD itself because `commit_signed` does not.

**Tech Stack:** Rust + git2 0.20 + `git` / `gpg` / `ssh-keygen` subprocesses; React 19 + TypeScript + Zustand; vitest; `cargo test`.

**Spec:** `docs/superpowers/specs/2026-08-13-issue-61-tier2-design.md`

## Global Constraints

- **Toolchain PATH.** Prefix every `pnpm`/`cargo` command with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Errors:** IPC-crossing fns return `AppResult<T>`; new `AppError` variant updates `src/lib/errors.ts` the same commit.
- **Frontend never calls `invoke()` directly** — only typed wrappers in `src/lib/tauri.ts`.
- **git2 work from a command goes through `tokio::task::spawn_blocking`.**
- **`CliBackend` gets a `NotImplemented` stub for every new trait method.**
- **Dialogs:** `pgConfirm` / `pgPrompt` from `@/design`; a screen rendered in isolation in tests needs `WithDialogs`.
- **Import UI primitives from `@/design`.**
- **Never hardcode the accent hue.**
- **E2E only via `pnpm test:e2e:docker`**, only affected specs.
- **Commit style:** Conventional Commits, `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Security constraints — these are requirements, not suggestions

The bar here is set by `opener.rs`, which already refuses to hand anything to a shell.

1. **Secrets travel in the environment, never in argv.** Argv is world-readable via `ps` on macOS and Linux; another user cannot read a process's environment on either. No credential may ever appear in a command line, including a `credential.helper=!f() { echo ... }` inline helper.
2. **The shim prints only the requested value.** No logging, no diagnostics on stdout, and a non-zero exit with no output when it does not recognize the prompt or the env var is absent.
3. **Credentials never enter `AppError` messages, log output, or event payloads.**
4. **git stderr is scrubbed before being surfaced or logged** — git echoes remote URLs, which can carry embedded credentials (`https://user:token@host/…`).
5. **Nothing is persisted by us.** "Remember" hands the credential to `git credential approve`; without a helper it lives in memory for the session only.

## Facts established by reading the code — do not re-derive

- The prompt-less env policy is duplicated at **two** files: `commands/branches.rs` (`run_git`, used by fetch/fetch_all/pull/push and the tag/branch push helpers) and `commands/create.rs` (`run_clone`, which additionally streams progress from stderr and sets `stdin(null)` + `kill_on_drop`). Clone's output handling must be preserved; only the env and the failure classification are shared.
- `cli.rs` already owns arg parsing: `LaunchIntent { path, screen }`, `Parsed::{Help, Launch}`, `parse_args`, plus `USAGE`. The shim adds a third `Parsed` variant.
- **`CommitOptions` is built as a struct literal in 7 places** — `src-tauri/tests/{discard_reset,cherry_pick_revert,reflog,branches_tags,stage_commit}.rs`, `src-tauri/tests/support/mod.rs`, and `src-tauri/src/commands/commits.rs`. Adding a field breaks all of them; Task 5 updates every site in one commit.
- `commit()` today handles amend via `Commit::amend(Some("HEAD"), …)` and normal commits via `repo.commit(Some("HEAD"), …)`. Both move HEAD for us. `commit_signed` does not — that is the trap in Task 6.

---

### Task 1: Classify auth failures out of git stderr

Pure functions first, because they are the whole safety argument and need no repo.

**Files:**
- Create: `src-tauri/src/git/auth.rs`
- Modify: `src-tauri/src/git/mod.rs` (add `pub mod auth;`)
- Modify: `src-tauri/src/error.rs` + `src/lib/errors.ts` (the `Auth` variant)

**Interfaces:**
- Produces:
  ```rust
  pub enum AuthKind { Https, SshPassphrase, SshKey }
  /// Classify a failed git invocation's stderr. None = not an auth failure.
  pub fn classify_auth_failure(stderr: &str) -> Option<AuthKind>;
  /// Remove credentials embedded in any URL in `text`, in place of the userinfo.
  pub fn scrub_credentials(text: &str) -> String;
  /// Host from git's stderr, when it names one.
  pub fn host_from_stderr(stderr: &str) -> Option<String>;
  ```
  and `AppError::Auth { host: Option<String>, kind: AuthKind }`.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/git/auth.rs` with only the test module at first (so the file compiles as a module and the tests name what does not exist yet):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn https_auth_failure_is_https() {
        for s in [
            "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/x/y.git/'",
            "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
        ] {
            assert_eq!(classify_auth_failure(s), Some(AuthKind::Https), "{s}");
        }
    }

    #[test]
    fn ssh_passphrase_prompt_is_passphrase() {
        let s = "Enter passphrase for key '/home/u/.ssh/id_ed25519': \nfatal: Could not read from remote repository.";
        assert_eq!(classify_auth_failure(s), Some(AuthKind::SshPassphrase));
    }

    #[test]
    fn publickey_denied_is_ssh_key() {
        let s = "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.";
        assert_eq!(classify_auth_failure(s), Some(AuthKind::SshKey));
    }

    #[test]
    fn host_key_verification_is_not_an_auth_failure() {
        // Prompting for a password cannot fix an unknown host key, and offering
        // to would be actively misleading.
        let s = "Host key verification failed.\nfatal: Could not read from remote repository.";
        assert_eq!(classify_auth_failure(s), None);
    }

    #[test]
    fn ordinary_network_errors_are_not_auth_failures() {
        for s in [
            "fatal: unable to access 'https://x/y': Could not resolve host: x",
            "fatal: repository 'https://x/y' not found",
            "error: failed to push some refs to 'origin'",
        ] {
            assert_eq!(classify_auth_failure(s), None, "{s}");
        }
    }

    #[test]
    fn scrub_removes_userinfo_from_urls() {
        assert_eq!(
            scrub_credentials("fatal: unable to access 'https://user:ghp_secret@github.com/x/y.git/'"),
            "fatal: unable to access 'https://***@github.com/x/y.git/'"
        );
    }

    #[test]
    fn scrub_leaves_credential_free_text_alone() {
        let s = "fatal: Authentication failed for 'https://github.com/x/y.git/'";
        assert_eq!(scrub_credentials(s), s);
    }

    #[test]
    fn scrub_handles_several_urls() {
        let out = scrub_credentials("a https://u:p@h1/x b https://u2:p2@h2/y");
        assert!(!out.contains("p@"), "{out}");
        assert!(!out.contains("p2@"), "{out}");
    }

    #[test]
    fn host_is_extracted_from_https_and_ssh_forms() {
        assert_eq!(
            host_from_stderr("fatal: Authentication failed for 'https://github.com/x/y.git/'"),
            Some("github.com".to_string())
        );
        assert_eq!(
            host_from_stderr("git@gitlab.com: Permission denied (publickey)."),
            Some("gitlab.com".to_string())
        );
        assert_eq!(host_from_stderr("something unrelated"), None);
    }
}
```

- [ ] **Step 2: Run to verify failure**

Add `pub mod auth;` to `src-tauri/src/git/mod.rs`, then:

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --lib auth 2>&1 | tail -20
```
Expected: compile errors for `classify_auth_failure`, `AuthKind`, `scrub_credentials`, `host_from_stderr`.

- [ ] **Step 3: Implement the module**

Above the test module in `src-tauri/src/git/auth.rs`:

```rust
//! Authentication failure classification and credential hygiene (#61 D5).
//!
//! Network ops run prompt-less on the first attempt, so an authenticated
//! remote fails with git's own stderr. This module turns that stderr into a
//! typed answer — "this is an auth failure, of this kind, for this host" — so
//! the UI can collect a credential and retry, and scrubs credentials out of
//! anything before it reaches an error message or a log.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum AuthKind {
    /// HTTPS username + password/token.
    Https,
    /// An encrypted SSH private key needs its passphrase.
    SshPassphrase,
    /// The server rejected the key we offered (or we offered none).
    SshKey,
}

/// Classify a failed git invocation's stderr. `None` means "not an auth
/// failure" — the caller keeps its existing `Network` error.
///
/// Host-key verification is deliberately NOT an auth failure: no credential
/// the user can type will fix an unknown host key.
pub fn classify_auth_failure(stderr: &str) -> Option<AuthKind> {
    let s = stderr.to_lowercase();

    if s.contains("host key verification failed") {
        return None;
    }
    if s.contains("enter passphrase for key") || s.contains("bad passphrase") {
        return Some(AuthKind::SshPassphrase);
    }
    if s.contains("permission denied (publickey)") {
        return Some(AuthKind::SshKey);
    }
    if s.contains("authentication failed")
        || s.contains("invalid username or password")
        || s.contains("could not read username")
        || s.contains("could not read password")
        || s.contains("terminal prompts disabled")
    {
        return Some(AuthKind::Https);
    }
    None
}

/// Replace the `user:password@` userinfo of every URL in `text` with `***`.
///
/// git echoes remote URLs in its errors, and a remote configured with an
/// embedded token would otherwise put that token into an error banner or a log
/// file.
pub fn scrub_credentials(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(scheme_at) = rest.find("://") {
        let after = scheme_at + 3;
        // Userinfo, if any, ends at the first '@' before the next '/' or
        // whitespace — beyond that we are into the path and there is no
        // userinfo to strip.
        let tail = &rest[after..];
        let stop = tail
            .find(|c: char| c == '/' || c.is_whitespace() || c == '\'' || c == '"')
            .unwrap_or(tail.len());
        match tail[..stop].find('@') {
            Some(at) => {
                out.push_str(&rest[..after]);
                out.push_str("***");
                out.push_str(&tail[at..stop]);
                rest = &tail[stop..];
            }
            None => {
                out.push_str(&rest[..after + stop]);
                rest = &tail[stop..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Best-effort host from git/ssh stderr: `https://host/…` or `git@host:`.
pub fn host_from_stderr(stderr: &str) -> Option<String> {
    if let Some(at) = stderr.find("://") {
        let tail = &stderr[at + 3..];
        let stop = tail
            .find(|c: char| c == '/' || c.is_whitespace() || c == '\'' || c == '"')
            .unwrap_or(tail.len());
        let hostish = &tail[..stop];
        // Drop any userinfo before the host.
        let host = hostish.rsplit('@').next().unwrap_or(hostish);
        if !host.is_empty() {
            return Some(host.to_string());
        }
    }
    // `git@host: Permission denied` — take the token before the first colon.
    if let Some(colon) = stderr.find(": ") {
        let head = &stderr[..colon];
        if let Some(at) = head.rfind('@') {
            let host = &head[at + 1..];
            if !host.is_empty() && host.contains('.') {
                return Some(host.to_string());
            }
        }
    }
    None
}
```

- [ ] **Step 4: Add the error variant on both sides**

`src-tauri/src/error.rs`, after `Network`:

```rust
    #[error("authentication required")]
    Auth {
        host: Option<String>,
        kind: crate::git::auth::AuthKind,
    },
```

> `AppError` is `#[serde(tag = "kind", content = "message")]`, so a struct variant serializes its fields as the `message` object. Check the generated shape against `src/lib/errors.ts` — if the tagged representation fights the struct variant, carry the payload as a single `AuthChallenge` struct instead (`Auth(AuthChallenge)`); the TS side then reads `message.host` / `message.authKind`. Pick whichever compiles and keep the two in step.

`src/lib/errors.ts`:

```typescript
  | {
      kind: "Auth";
      message: { host: string | null; kind: "Https" | "SshPassphrase" | "SshKey" };
    }
```

plus a narrowing helper beside `isEmbeddedRepoError`:

```typescript
export function isAuthError(e: unknown): e is Extract<AppError, { kind: "Auth" }> {
  return isAppError(e) && e.kind === "Auth";
}
```

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --lib auth 2>&1 | tail -15
pnpm tsc --noEmit
```
Expected: 9 tests pass, type-check clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/auth.rs src-tauri/src/git/mod.rs src-tauri/src/error.rs src/lib/errors.ts
git commit -m "feat(auth): classify git auth failures and scrub credentials (#61 D5)

Why host-key verification is deliberately NOT an auth failure: no credential
the user can type fixes an unknown host key, so offering a password prompt
would be actively misleading. scrub_credentials exists because git echoes
remote URLs, which can carry an embedded token into an error banner or log.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The askpass shim

**Files:**
- Modify: `src-tauri/src/cli.rs` (`Parsed`, `parse_args`, `USAGE`, plus the shim answer logic)
- Modify: `src-tauri/src/lib.rs` (handle it before the Tauri app is built)

**Interfaces:**
- Produces:
  ```rust
  // in cli.rs
  pub enum Parsed { Help, Askpass(String), Launch(Option<LaunchIntent>) }
  /// Env var names the parent sets for the shim to read.
  pub const ASKPASS_USERNAME_ENV: &str = "PLATYPUSGIT_ASKPASS_USERNAME";
  pub const ASKPASS_SECRET_ENV: &str = "PLATYPUSGIT_ASKPASS_SECRET";
  /// Which answer a git/ssh prompt is asking for.
  pub enum AskpassWant { Username, Secret }
  pub fn askpass_want(prompt: &str) -> Option<AskpassWant>;
  /// The value to print, or None to exit non-zero silently.
  pub fn askpass_answer(prompt: &str, username: Option<&str>, secret: Option<&str>) -> Option<String>;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `cli.rs`'s existing `#[cfg(test)] mod tests`:

```rust
    #[test]
    fn askpass_prompt_kinds_are_recognized() {
        assert!(matches!(
            askpass_want("Username for 'https://github.com': "),
            Some(AskpassWant::Username)
        ));
        assert!(matches!(
            askpass_want("Password for 'https://u@github.com': "),
            Some(AskpassWant::Secret)
        ));
        assert!(matches!(
            askpass_want("Enter passphrase for key '/home/u/.ssh/id_ed25519': "),
            Some(AskpassWant::Secret)
        ));
        assert!(askpass_want("Are you sure you want to continue connecting?").is_none());
    }

    #[test]
    fn askpass_answers_from_the_matching_env_value() {
        assert_eq!(
            askpass_answer("Username for 'https://github.com': ", Some("ada"), Some("tok")),
            Some("ada".to_string())
        );
        assert_eq!(
            askpass_answer("Password for 'https://ada@github.com': ", Some("ada"), Some("tok")),
            Some("tok".to_string())
        );
    }

    #[test]
    fn askpass_refuses_when_the_value_is_absent() {
        // No env value → print nothing, exit non-zero. Never fall back to
        // an empty string, which git would try to authenticate with.
        assert_eq!(askpass_answer("Password for 'https://x': ", None, None), None);
        assert_eq!(askpass_answer("Username for 'https://x': ", None, Some("tok")), None);
    }

    #[test]
    fn askpass_refuses_an_unrecognized_prompt() {
        assert_eq!(
            askpass_answer("Please confirm the fingerprint", Some("ada"), Some("tok")),
            None
        );
    }

    #[test]
    fn parse_args_recognizes_askpass() {
        let cwd = std::path::Path::new("/tmp");
        assert_eq!(
            parse_args(&["--askpass".to_string(), "Password for 'x': ".to_string()], cwd),
            Parsed::Askpass("Password for 'x': ".to_string())
        );
    }

    #[test]
    fn askpass_without_a_prompt_is_still_askpass_and_answers_nothing() {
        let cwd = std::path::Path::new("/tmp");
        assert_eq!(
            parse_args(&["--askpass".to_string()], cwd),
            Parsed::Askpass(String::new())
        );
        assert_eq!(askpass_answer("", Some("a"), Some("b")), None);
    }
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --lib cli 2>&1 | tail -15
```
Expected: compile errors for the new items.

- [ ] **Step 3: Implement**

In `src-tauri/src/cli.rs`:

```rust
/// Env vars the parent process sets so the askpass shim can answer without any
/// IPC back to the app. Values live in the environment rather than argv: argv
/// is world-readable via `ps`, a process's environment is not (#61 D5).
pub const ASKPASS_USERNAME_ENV: &str = "PLATYPUSGIT_ASKPASS_USERNAME";
pub const ASKPASS_SECRET_ENV: &str = "PLATYPUSGIT_ASKPASS_SECRET";

/// Which answer a git/ssh askpass prompt is asking for.
#[derive(Debug, PartialEq)]
pub enum AskpassWant {
    Username,
    Secret,
}

/// Classify an askpass prompt. `None` for anything unrecognized — the shim
/// must never guess at a prompt it does not understand.
pub fn askpass_want(prompt: &str) -> Option<AskpassWant> {
    let p = prompt.to_lowercase();
    if p.contains("username") {
        return Some(AskpassWant::Username);
    }
    if p.contains("password") || p.contains("passphrase") {
        return Some(AskpassWant::Secret);
    }
    None
}

/// The value the shim should print, or `None` to print nothing and exit
/// non-zero. An absent value is never substituted with an empty string: git
/// would take that as a real (wrong) credential.
pub fn askpass_answer(
    prompt: &str,
    username: Option<&str>,
    secret: Option<&str>,
) -> Option<String> {
    match askpass_want(prompt)? {
        AskpassWant::Username => username.map(str::to_string),
        AskpassWant::Secret => secret.map(str::to_string),
    }
}
```

Add the `Parsed` variant and handle it first in `parse_args` (before `--help`, so a prompt containing "-h" cannot be misread):

```rust
pub enum Parsed {
    Help,
    /// Invoked as GIT_ASKPASS / SSH_ASKPASS with a prompt string (#61 D5).
    Askpass(String),
    Launch(Option<LaunchIntent>),
}
```

```rust
pub fn parse_args(args: &[String], cwd: &Path) -> Parsed {
    // Askpass first: the prompt is arbitrary text from git and must not be
    // scanned for our own flags.
    if args.first().map(String::as_str) == Some("--askpass") {
        return Parsed::Askpass(args.get(1).cloned().unwrap_or_default());
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        return Parsed::Help;
    }
    // …existing body unchanged…
```

`USAGE` gains no `--askpass` line: it is an internal contract between the app and its own subprocesses, not a user-facing flag.

In `src-tauri/src/lib.rs`, handle it **before** anything else in `run()` — before the single-instance plugin, before the Tauri builder, so the shim is a plain fast process that never becomes a second app instance:

```rust
    let initial_intent = match cli::parse_args(&args, &cwd) {
        cli::Parsed::Help => {
            print!("{}", cli::USAGE);
            return;
        }
        // Askpass shim (#61 D5): print exactly the requested value and exit.
        // No window, no single-instance forwarding, no logging — stdout here is
        // read by git, and anything extra would be taken as the credential.
        cli::Parsed::Askpass(prompt) => {
            let username = std::env::var(cli::ASKPASS_USERNAME_ENV).ok();
            let secret = std::env::var(cli::ASKPASS_SECRET_ENV).ok();
            match cli::askpass_answer(&prompt, username.as_deref(), secret.as_deref()) {
                Some(value) => {
                    println!("{value}");
                    return;
                }
                None => std::process::exit(1),
            }
        }
        cli::Parsed::Launch(intent) => intent.map(cli::resolve_repo_root),
    };
```

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --lib cli 2>&1 | tail -15
```
Expected: the 6 new tests pass and every existing `cli` test still passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/cli.rs src-tauri/src/lib.rs
git commit -m "feat(auth): askpass shim as an --askpass invocation of our own binary (#61 D5)

Secrets reach the shim through the environment, never argv: argv is
world-readable via ps, a process's environment is not. The shim prints only the
requested value and exits non-zero with no output on an unrecognized prompt or
a missing value — an empty string would be taken by git as a real credential.
Handled before the Tauri builder so it never becomes a second app instance.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: One authenticated runner for all four network ops

**Files:**
- Create: `src-tauri/src/commands/net.rs` (shared runner)
- Modify: `src-tauri/src/commands/mod.rs` (`pub mod net;`)
- Modify: `src-tauri/src/commands/branches.rs` (`run_git` delegates; commands take credentials)
- Modify: `src-tauri/src/commands/create.rs` (`run_clone` uses the shared env + classification)
- Modify: `src-tauri/src/lib.rs` (no new commands, but `Credentials` must be `Deserialize`)

**Interfaces:**
- Consumes: `git::auth::{classify_auth_failure, scrub_credentials, host_from_stderr}` from Task 1; `cli::{ASKPASS_USERNAME_ENV, ASKPASS_SECRET_ENV}` from Task 2.
- Produces:
  ```rust
  #[derive(Debug, Clone, Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct Credentials { pub username: Option<String>, pub secret: String }

  /// Apply the prompt-less-or-askpass env policy to a command.
  pub fn apply_auth_env(cmd: &mut tokio::process::Command, creds: Option<&Credentials>);
  /// Map a failed invocation's stderr to Auth or Network, scrubbed.
  pub fn map_git_failure(stderr: &str) -> AppError;
  /// Run `git -C cwd <args>`, with credentials when supplied.
  pub async fn run_git_authenticated(
      cwd: &Path, args: &[&str], creds: Option<&Credentials>,
  ) -> AppResult<()>;
  ```
  `fetch` / `fetch_all` / `pull` / `push` / `clone_repo` each gain an optional
  `credentials: Option<Credentials>` parameter. Optional, so an existing caller
  that omits it behaves exactly as today.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/tests/auth_env.rs`:

```rust
mod support;

use platypusgit_lib::commands::net::{map_git_failure, Credentials};
use platypusgit_lib::error::AppError;

#[test]
fn auth_stderr_maps_to_auth_error() {
    let err = map_git_failure(
        "fatal: Authentication failed for 'https://github.com/x/y.git/'",
    );
    match err {
        AppError::Auth { host, .. } => assert_eq!(host.as_deref(), Some("github.com")),
        other => panic!("expected Auth, got {other:?}"),
    }
}

#[test]
fn non_auth_stderr_stays_network() {
    let err = map_git_failure("fatal: unable to access 'https://x/y': Could not resolve host: x");
    assert!(matches!(err, AppError::Network(_)), "got {err:?}");
}

#[test]
fn surfaced_message_never_carries_an_embedded_token() {
    let err = map_git_failure(
        "fatal: unable to access 'https://u:ghp_secret@github.com/x/y': Authentication failed",
    );
    let text = format!("{err:?}");
    assert!(!text.contains("ghp_secret"), "credential leaked: {text}");
}

/// Credentials must never be visible in the child's argv (#61 D5).
#[test]
fn credentials_are_not_passed_in_argv() {
    let creds = Credentials {
        username: Some("ada".into()),
        secret: "ghp_secret".into(),
    };
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("fetch");
    platypusgit_lib::commands::net::apply_auth_env(&mut cmd, Some(&creds));

    let argv = format!("{:?}", cmd.as_std().get_args().collect::<Vec<_>>());
    assert!(!argv.contains("ghp_secret"), "secret in argv: {argv}");

    let envs: Vec<_> = cmd.as_std().get_envs().collect();
    let has_secret = envs.iter().any(|(_, v)| {
        v.map(|v| v.to_string_lossy().contains("ghp_secret")).unwrap_or(false)
    });
    assert!(has_secret, "secret should travel in the environment");
}
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test auth_env 2>&1 | tail -15
```
Expected: unresolved module `commands::net`.

- [ ] **Step 3: Implement the shared runner**

Create `src-tauri/src/commands/net.rs`:

```rust
//! One place for the network-op environment policy and failure mapping (#61 D5).
//!
//! Before this module the policy was duplicated in branches.rs (fetch/pull/push)
//! and create.rs (clone), which is how they could drift.

use std::path::Path;

use serde::Deserialize;

use crate::{
    cli::{ASKPASS_SECRET_ENV, ASKPASS_USERNAME_ENV},
    error::{AppError, AppResult},
    git::auth::{classify_auth_failure, host_from_stderr, scrub_credentials},
};

/// A credential collected from the user for one retry. Never persisted here —
/// "remember" is `git credential approve`, which hands it to the user's own
/// configured helper.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Credentials {
    pub username: Option<String>,
    pub secret: String,
}

/// Apply the environment policy for a git subprocess.
///
/// Without credentials this is the historical prompt-less policy: a subprocess
/// has no terminal, so an auth-requiring remote would otherwise hang forever on
/// an invisible prompt. With credentials, our own binary becomes the askpass and
/// reads the answer from the environment — argv is world-readable via `ps`, a
/// process's environment is not.
pub fn apply_auth_env(cmd: &mut tokio::process::Command, creds: Option<&Credentials>) {
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    match creds {
        None => {
            cmd.env("GIT_ASKPASS", "true").env("SSH_ASKPASS", "true");
        }
        Some(c) => {
            let exe = std::env::current_exe()
                .unwrap_or_else(|_| std::path::PathBuf::from("platypusgit"));
            // `sh -c` is deliberately NOT used: git execs the askpass program
            // directly with the prompt as argv[1], so no shell is involved.
            let askpass = format!("{} --askpass", exe.display());
            cmd.env("GIT_ASKPASS", &askpass)
                .env("SSH_ASKPASS", &askpass)
                // OpenSSH ≥ 8.4 needs this to use SSH_ASKPASS without a DISPLAY.
                .env("SSH_ASKPASS_REQUIRE", "force")
                .env(ASKPASS_SECRET_ENV, &c.secret);
            if let Some(u) = &c.username {
                cmd.env(ASKPASS_USERNAME_ENV, u);
            }
        }
    }
}
```

> **Trap to verify while implementing:** `GIT_ASKPASS` is exec'd, not run through a shell, so `"<exe> --askpass"` as a single string only works if git splits it — which it does **not**. If the test in Step 4 shows git failing to run the askpass, write a tiny wrapper script into the app's cache dir at first use (`exec "<exe>" --askpass "$@"`, mode 0700) and point `GIT_ASKPASS` at that instead. Do not switch to embedding the secret in argv.

```rust
/// Map a failed git invocation to an error, scrubbing credentials first.
pub fn map_git_failure(stderr: &str) -> AppError {
    let clean = scrub_credentials(stderr.trim());
    match classify_auth_failure(&clean) {
        Some(kind) => AppError::Auth {
            host: host_from_stderr(&clean),
            kind,
        },
        None => AppError::Network(clean),
    }
}

/// Run `git -C cwd <args>`, mapping a non-zero exit through `map_git_failure`.
pub async fn run_git_authenticated(
    cwd: &Path,
    args: &[&str],
    creds: Option<&Credentials>,
) -> AppResult<()> {
    let mut cmd = tokio::process::Command::new("git");
    cmd.arg("-C").arg(cwd).args(args);
    apply_auth_env(&mut cmd, creds);
    // Nothing feeds the child stdin, so an unexpected read would block forever.
    cmd.stdin(std::process::Stdio::null());

    let output = cmd
        .output()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    if !output.status.success() {
        return Err(map_git_failure(&String::from_utf8_lossy(&output.stderr)));
    }
    Ok(())
}
```

- [ ] **Step 4: Point the four op sites at it**

In `branches.rs`, replace `run_git`'s body with a delegation so every existing caller is unchanged:

```rust
async fn run_git(cwd: &std::path::Path, args: &[&str]) -> AppResult<()> {
    crate::commands::net::run_git_authenticated(cwd, args, None).await
}
```

Then give `fetch`, `fetch_all`, `pull` and `push` an extra
`credentials: Option<Credentials>` parameter and call
`run_git_authenticated(&path, &arg_refs, credentials.as_ref())`. Leave
`push_tag` / `push_delete_branch` on the credential-less `run_git` for now and
say so in the PR — they are pushes too, and a follow-up should thread
credentials through them.

In `create.rs`'s `run_clone`, replace the three `.env(...)` lines with
`net::apply_auth_env(&mut cmd, creds)` (add a `creds: Option<&Credentials>`
parameter, threaded from `clone_repo`), keep every other builder call exactly as
it is (`stdin(null)`, `stderr(piped())`, `kill_on_drop`), and map its failure
through `net::map_git_failure` instead of constructing `AppError::Network`
directly.

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "test result: FAILED|error\[" | head
cargo test --manifest-path src-tauri/Cargo.toml --test auth_env 2>&1 | tail -10
```
Expected: no failures anywhere; the 4 new tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/net.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/branches.rs src-tauri/src/commands/create.rs src-tauri/tests/auth_env.rs
git commit -m "feat(auth): one authenticated runner for fetch/pull/push/clone (#61 D5)

Collapses the prompt-less env policy that was duplicated across branches.rs
and create.rs, and routes both failure paths through one classifier so an auth
failure is typed rather than a generic Network error. Credentials travel in the
child's environment and are asserted absent from argv.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Credential dialog and retry

**Files:**
- Create: `src/features/auth/useAuthStore.ts`, `src/features/auth/CredentialDialog.tsx`
- Create: `src/features/auth/CredentialDialog.test.tsx`
- Modify: `src/lib/tauri.ts` (credentials parameter on the four wrappers; `gitCredentialFill` / `gitCredentialApprove` if exposed as commands)
- Modify: `src/features/repo/useRepoStore.ts` (network actions raise the challenge and retry)
- Modify: `src/AppShell.tsx` (mount `<CredentialDialog />`)

**Interfaces:**
- Consumes: `isAuthError` from Task 1.
- Produces:
  ```typescript
  interface AuthChallenge {
    host: string | null;
    kind: "Https" | "SshPassphrase" | "SshKey";
    /** Re-runs the failed op with these credentials. */
    retry: (creds: { username?: string; secret: string }, remember: boolean) => Promise<void>;
  }
  useAuthStore: { challenge: AuthChallenge | null; raise(c): void; dismiss(): void }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/features/auth/CredentialDialog.test.tsx`:

```tsx
// Credential entry + retry (#61 D5).

import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CredentialDialog } from "./CredentialDialog";
import { useAuthStore } from "./useAuthStore";

function raise(retry = vi.fn().mockResolvedValue(undefined)) {
  useAuthStore.getState().raise({ host: "github.com", kind: "Https", retry });
  return retry;
}

describe("CredentialDialog", () => {
  beforeEach(() => useAuthStore.setState({ challenge: null }));

  it("renders nothing without a challenge", () => {
    render(<CredentialDialog />);
    expect(screen.queryByTestId("credential-dialog")).toBeNull();
  });

  it("names the host it is authenticating to", () => {
    raise();
    render(<CredentialDialog />);
    expect(screen.getByTestId("credential-dialog").textContent).toContain("github.com");
  });

  it("retries with the entered credentials", async () => {
    const retry = raise();
    render(<CredentialDialog />);
    fireEvent.change(screen.getByTestId("credential-username"), {
      target: { value: "ada" },
    });
    fireEvent.change(screen.getByTestId("credential-secret"), {
      target: { value: "ghp_x" },
    });
    fireEvent.click(screen.getByTestId("credential-submit"));

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith({ username: "ada", secret: "ghp_x" }, false),
    );
  });

  it("passes remember through when checked", async () => {
    const retry = raise();
    render(<CredentialDialog />);
    fireEvent.change(screen.getByTestId("credential-secret"), {
      target: { value: "ghp_x" },
    });
    fireEvent.click(screen.getByTestId("credential-remember"));
    fireEvent.click(screen.getByTestId("credential-submit"));

    await waitFor(() =>
      expect(retry).toHaveBeenCalledWith(expect.anything(), true),
    );
  });

  it("asks only for a passphrase on an SSH challenge", () => {
    useAuthStore.getState().raise({
      host: null,
      kind: "SshPassphrase",
      retry: vi.fn(),
    });
    render(<CredentialDialog />);
    expect(screen.queryByTestId("credential-username")).toBeNull();
    expect(screen.getByTestId("credential-secret")).toBeTruthy();
  });

  it("dismissing clears the challenge without retrying", () => {
    const retry = raise();
    render(<CredentialDialog />);
    fireEvent.click(screen.getByTestId("credential-cancel"));
    expect(retry).not.toHaveBeenCalled();
    expect(useAuthStore.getState().challenge).toBeNull();
  });

  it("does not keep the secret in the store after submitting", async () => {
    raise();
    render(<CredentialDialog />);
    fireEvent.change(screen.getByTestId("credential-secret"), {
      target: { value: "ghp_x" },
    });
    fireEvent.click(screen.getByTestId("credential-submit"));
    await waitFor(() => expect(useAuthStore.getState().challenge).toBeNull());
    expect(JSON.stringify(useAuthStore.getState())).not.toContain("ghp_x");
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/auth/CredentialDialog.test.tsx --run 2>&1 | tail -10
```
Expected: FAIL — modules do not exist.

- [ ] **Step 3: Implement the store and dialog**

`src/features/auth/useAuthStore.ts` — a plain Zustand store holding at most one
challenge. The secret is component state and is **never** put in the store, so
the last test above holds.

`src/features/auth/CredentialDialog.tsx` — a `PGModal` with:
- a username `PGInput` (`data-testid="credential-username"`), rendered only for
  `kind === "Https"`;
- a masked secret `PGInput` (`data-testid="credential-secret"`) with a
  show/hide toggle;
- a "Remember" `PGCheckbox` (`data-testid="credential-remember"`) whose label
  says where it will be stored — git's own credential helper — and says
  "for this session only" when no helper is configured;
- submit / cancel (`credential-submit` / `credential-cancel`).

Submit calls `challenge.retry({ username, secret }, remember)` and then
`dismiss()`. Cancel just dismisses.

- [ ] **Step 4: Raise the challenge from the store's network actions**

In `useRepoStore`, each of `fetch` / `fetchAll` / `pull` / `push` catches its
error and, when `isAuthError(e)`, raises a challenge whose `retry` re-invokes
the same wrapper with credentials instead of setting `error`. On a cancelled
dialog the original error surfaces through the normal banner path — and per the
danger-op convention, `refreshAll()` runs **before** `set({ error })`, because
`refreshAll` starts with `set({ error: null })` and React 18 batches same-tick
sets.

Mount `<CredentialDialog />` in `AppShell` beside `<PGDialogHost />`.

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/features/auth --run 2>&1 | tail -10 && pnpm tsc --noEmit && pnpm test --run 2>&1 | tail -5
```
Expected: 7 new tests pass, type-check clean, whole suite green.

- [ ] **Step 6: Commit**

```bash
git add src/features/auth src/lib/tauri.ts src/features/repo/useRepoStore.ts src/AppShell.tsx
git commit -m "feat(auth): credential dialog and retry for failed network ops (#61 D5)

The secret lives in component state and never enters the store, so it is not
retained after the retry. Cancelling restores the original error through the
normal banner path, refreshing before setting the error per the danger-op rule.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Signing configuration resolution

**Files:**
- Create: `src-tauri/src/git/signing.rs`
- Modify: `src-tauri/src/git/mod.rs` (`pub mod signing;`)
- Modify: `src-tauri/src/git/types.rs` (`CommitOptions.sign`)
- Modify: **all 7 `CommitOptions` literal sites** — `src-tauri/tests/{discard_reset,cherry_pick_revert,reflog,branches_tags,stage_commit}.rs`, `src-tauri/tests/support/mod.rs`, `src-tauri/src/commands/commits.rs`

**Interfaces:**
- Produces:
  ```rust
  pub enum SigFormat { OpenPgp, Ssh, X509 }
  pub struct SigningConfig { pub format: SigFormat, pub program: String, pub key: Option<String> }
  /// Read gpg.format / gpg.program / gpg.ssh.program / user.signingkey.
  pub fn resolve_signing(repo: &git2::Repository) -> AppResult<SigningConfig>;
  /// argv for signing a commit buffer with this config.
  pub fn signing_args(cfg: &SigningConfig, key_file: Option<&Path>) -> AppResult<Vec<String>>;
  /// Whether commit.gpgsign is on.
  pub fn config_wants_signing(repo: &git2::Repository) -> bool;
  ```
  and `CommitOptions.sign: Option<bool>` — `None` follows `commit.gpgsign`.

- [ ] **Step 1: Write the failing tests**

Create the test module inside `src-tauri/src/git/signing.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openpgp_args_use_detached_armored_signing() {
        let cfg = SigningConfig {
            format: SigFormat::OpenPgp,
            program: "gpg".into(),
            key: Some("ABCD1234".into()),
        };
        let args = signing_args(&cfg, None).unwrap();
        assert!(args.contains(&"-bsau".to_string()), "{args:?}");
        assert!(args.contains(&"ABCD1234".to_string()), "{args:?}");
    }

    #[test]
    fn openpgp_without_a_key_lets_gpg_pick_the_default() {
        let cfg = SigningConfig {
            format: SigFormat::OpenPgp,
            program: "gpg".into(),
            key: None,
        };
        let args = signing_args(&cfg, None).unwrap();
        assert!(args.contains(&"-bsa".to_string()), "{args:?}");
    }

    #[test]
    fn ssh_args_sign_with_the_git_namespace() {
        let cfg = SigningConfig {
            format: SigFormat::Ssh,
            program: "ssh-keygen".into(),
            key: Some("/home/u/.ssh/id_ed25519.pub".into()),
        };
        let args = signing_args(&cfg, Some(std::path::Path::new("/tmp/key"))).unwrap();
        assert_eq!(args[0], "-Y");
        assert_eq!(args[1], "sign");
        assert!(args.contains(&"git".to_string()), "namespace: {args:?}");
        assert!(args.contains(&"/tmp/key".to_string()), "key file: {args:?}");
    }

    #[test]
    fn x509_is_a_clean_unsupported_error_not_a_panic() {
        let cfg = SigningConfig {
            format: SigFormat::X509,
            program: "smimesign".into(),
            key: None,
        };
        let err = signing_args(&cfg, None).expect_err("x509 is unsupported");
        assert!(matches!(err, AppError::NotImplemented), "got {err:?}");
    }

    #[test]
    fn ssh_signing_requires_a_key() {
        // ssh-keygen cannot pick a default the way gpg can.
        let cfg = SigningConfig {
            format: SigFormat::Ssh,
            program: "ssh-keygen".into(),
            key: None,
        };
        assert!(signing_args(&cfg, None).is_err());
    }
}
```

Add an integration test in `src-tauri/tests/signing.rs` for config reading:

```rust
mod support;

use platypusgit_lib::git::signing::{config_wants_signing, resolve_signing, SigFormat};
use support::TempRepo;

#[test]
fn defaults_to_openpgp_with_gpg_and_no_signing() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let cfg = resolve_signing(&tr.repo).unwrap();
    assert!(matches!(cfg.format, SigFormat::OpenPgp));
    assert_eq!(cfg.program, "gpg");
    assert!(!config_wants_signing(&tr.repo));
}

#[test]
fn reads_ssh_format_and_program_and_key() {
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        c.set_str("user.signingkey", "/keys/id_ed25519.pub").unwrap();
        c.set_bool("commit.gpgsign", true).unwrap();
    }
    let cfg = resolve_signing(&tr.repo).unwrap();
    assert!(matches!(cfg.format, SigFormat::Ssh));
    assert_eq!(cfg.program, "ssh-keygen");
    assert_eq!(cfg.key.as_deref(), Some("/keys/id_ed25519.pub"));
    assert!(config_wants_signing(&tr.repo));
}

#[test]
fn honours_an_explicit_gpg_program() {
    let tr = TempRepo::with_initial_commit("hello\n");
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.program", "/usr/local/bin/gpg2").unwrap();
    }
    assert_eq!(resolve_signing(&tr.repo).unwrap().program, "/usr/local/bin/gpg2");
}
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml signing 2>&1 | tail -15
```
Expected: unresolved `git::signing`.

- [ ] **Step 3: Implement `signing.rs`**

`resolve_signing` reads `gpg.format` (absent → `OpenPgp`), then the program for
that format (`gpg.program` else `gpg`; `gpg.ssh.program` else `ssh-keygen`), then
`user.signingkey`. `config_wants_signing` reads `commit.gpgsign` as a bool,
defaulting false.

`signing_args`:
- `OpenPgp` → `["-bsau", key]` when a key is set, else `["-bsa"]` (gpg picks its
  default key). `--status-fd=2` is fine to add; keep stdout for the signature.
- `Ssh` → `["-Y", "sign", "-n", "git", "-f", key_file]`. `key_file` is required:
  a `user.signingkey` that is a literal key (`key::ssh-ed25519 …`) must be
  written to a temp file by the caller first, which is why the parameter exists.
- `X509` → `Err(AppError::NotImplemented)`. A signing failure must never fall
  back to an unsigned commit: the user asked for a signature and would have no
  indication they did not get one.

- [ ] **Step 4: Add the `sign` field and fix all 7 literal sites**

In `types.rs`:

```rust
    /// Sign this commit. `None` follows `commit.gpgsign` from git config.
    #[serde(default)]
    pub sign: Option<bool>,
```

Then add `sign: None` to every `CommitOptions { … }` literal in the 7 files
listed under **Files**. `grep -rn "CommitOptions {" src-tauri/` finds them all;
the build will not compile until every one is updated.

- [ ] **Step 5: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "test result: FAILED|error\[" | head
cargo test --manifest-path src-tauri/Cargo.toml signing 2>&1 | tail -12
```
Expected: no failures; the 8 signing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/git/signing.rs src-tauri/src/git/mod.rs src-tauri/src/git/types.rs src-tauri/tests/signing.rs src-tauri/tests src-tauri/src/commands/commits.rs
git commit -m "feat(commit): resolve signing config (gpg.format, program, key) (#61 D6)

x509 is a clean NotImplemented rather than a panic or, worse, a silently
unsigned commit — the user asked for a signature and would have no indication
they did not get one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Sign commits — and keep HEAD correct

**Files:**
- Modify: `src-tauri/src/git/libgit2.rs` (`commit`)
- Test: `src-tauri/tests/signing.rs` (append)

**Interfaces:**
- Consumes: `git::signing::{resolve_signing, signing_args, config_wants_signing}`.

**The trap, stated once:** `repo.commit(Some("HEAD"), …)` and
`Commit::amend(Some("HEAD"), …)` update the reference for you.
`repo.commit_signed(...)` **only writes the object** — it returns an Oid and
moves nothing. A signed commit that never becomes HEAD looks to the user exactly
like lost work. The signed path must therefore update HEAD's target and write a
reflog entry itself, for both the normal and the amend case.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/tests/signing.rs`. It generates its own ssh key, so it
needs no ambient gpg setup, and skips rather than fails when `ssh-keygen` is
absent:

```rust
/// Generate an ed25519 key in `dir`, returning the private key path.
fn make_ssh_key(dir: &std::path::Path) -> Option<std::path::PathBuf> {
    let key = dir.join("id_ed25519");
    let out = std::process::Command::new("ssh-keygen")
        .args(["-t", "ed25519", "-N", "", "-C", "test", "-f"])
        .arg(&key)
        .output()
        .ok()?;
    out.status.success().then_some(key)
}

#[test]
fn signed_commit_is_reachable_from_head_and_has_a_gpgsig_header() {
    let tr = TempRepo::with_initial_commit("hello\n");
    let keydir = tempfile::tempdir().unwrap();
    let Some(key) = make_ssh_key(keydir.path()) else {
        eprintln!("ssh-keygen unavailable — skipping signed-commit test");
        return;
    };
    {
        let mut c = tr.repo.config().unwrap();
        c.set_str("gpg.format", "ssh").unwrap();
        c.set_str("user.signingkey", key.to_str().unwrap()).unwrap();
    }

    support::fs::write_file(tr.path(), "b.txt", "second\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();

    let oid = backend
        .commit(
            &handle.id,
            platypusgit_lib::git::types::CommitOptions {
                message: "signed".into(),
                amend: false,
                author_override: None,
                signoff: false,
                sign: Some(true),
            },
        )
        .expect("signed commit");

    // The trap: commit_signed writes the object but does NOT move HEAD.
    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), oid, "signed commit must be HEAD");
    assert_eq!(head.parent_count(), 1, "must keep its parent");

    let raw = tr.repo.find_commit(head.id()).unwrap();
    let header = raw.header_field_bytes("gpgsig").expect("gpgsig header");
    assert!(!header.is_empty(), "signature must not be empty");
}

#[test]
fn unsigned_commit_path_is_unchanged() {
    let tr = TempRepo::with_initial_commit("hello\n");
    support::fs::write_file(tr.path(), "b.txt", "second\n");
    let (backend, handle) = tr.open_with_backend();
    backend
        .stage(&handle.id, &[std::path::PathBuf::from("b.txt")])
        .unwrap();

    let oid = backend
        .commit(
            &handle.id,
            platypusgit_lib::git::types::CommitOptions {
                message: "plain".into(),
                amend: false,
                author_override: None,
                signoff: false,
                sign: Some(false),
            },
        )
        .unwrap();

    let head = tr.repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.id().to_string(), oid);
    assert!(tr.repo.find_commit(head.id()).unwrap()
        .header_field_bytes("gpgsig").is_err(), "must not be signed");
}
```

- [ ] **Step 2: Run to verify failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test signing 2>&1 | tail -15
```
Expected: the signed test fails (no signing yet — the commit is unsigned, so the
`gpgsig` assertion fails).

- [ ] **Step 3: Implement the signed path**

In `commit()`, after `message` and `tree` are resolved, branch on whether
signing is wanted (`opts.sign.unwrap_or_else(|| config_wants_signing(repo))`).
Unsigned → today's code, untouched. Signed →

1. Build the buffer with `repo.commit_create_buffer(&sig, &sig, &message, &tree, &parent_refs)`.
2. Resolve config, write a temp key file when `user.signingkey` is a literal ssh key.
3. Spawn the program with `signing_args`, buffer on stdin, signature from stdout;
   a non-zero exit is `AppError::Git` with the program's stderr — never a
   fallback to unsigned.
4. `let oid = repo.commit_signed(&buffer_str, &signature, Some("gpgsig"))?;`
5. **Move HEAD yourself:** for a normal commit,
   `repo.reference("HEAD", oid, true, &format!("commit (signed): {summary}"))`
   via the resolved HEAD ref name (use `repo.head()`'s name, or `refs/heads/<default>`
   when unborn); for an amend, the same but with the amend reflog wording. Verify
   with the test's HEAD assertion rather than by inspection.

- [ ] **Step 4: Run the tests**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --test signing 2>&1 | tail -15
cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "test result: FAILED" | head
```
Expected: both signing tests pass; no other failures. In particular
`stage_commit.rs` and `reflog.rs` must still pass — they assert the unsigned
path's HEAD movement and reflog wording.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git/libgit2.rs src-tauri/tests/signing.rs
git commit -m "feat(commit): GPG/SSH commit signing (#61 D6)

Why the extra reference work: commit_signed writes the object but does NOT
move HEAD, unlike repo.commit(Some(\"HEAD\"), …). The signed path therefore
updates the branch ref and writes its own reflog entry, asserted by a test that
checks the signed commit is reachable from HEAD with its parent intact — a
signed commit on no branch reads to the user as lost work.

A signing failure fails the commit rather than falling back to unsigned.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Verify the selected commit, and the UI

**Files:**
- Modify: `src-tauri/src/git/{mod.rs,libgit2.rs,cli.rs,types.rs}` (`verify_commit`)
- Modify: `src-tauri/src/commands/commits.rs` + `src-tauri/src/lib.rs`
- Modify: `src/lib/{types.ts,tauri.ts}`
- Modify: `src/features/diff/CommitDiffPanel.tsx` (status in the header)
- Modify: `src/features/settings/useSettingsStore.ts` + Settings screen (sign toggle)
- Modify: `src/screens/CommitPanel.tsx` (per-commit override)
- Test: `src-tauri/src/git/signing.rs` tests (the `%G?` parser), component test for the badge

**Interfaces:**
- Produces:
  ```rust
  pub struct SignatureStatus { pub state: SigState, pub signer: Option<String>, pub key: Option<String> }
  pub enum SigState { Good, Bad, UnknownKey, Expired, Revoked, None }
  pub fn parse_verify_output(raw: &str) -> SignatureStatus;   // "%G?\0%GS\0%GK"
  fn verify_commit(&self, repo_id: &RepoId, oid: &str) -> AppResult<SignatureStatus>;
  ```

- [ ] **Step 1: Write the failing parser tests**

In `signing.rs`'s test module:

```rust
    #[test]
    fn parses_each_verify_state() {
        for (raw, want) in [
            ("G\0Ada <ada@x>\0ABCD", SigState::Good),
            ("B\0Ada <ada@x>\0ABCD", SigState::Bad),
            ("U\0Ada <ada@x>\0ABCD", SigState::Good), // good, untrusted
            ("X\0Ada <ada@x>\0ABCD", SigState::Expired),
            ("R\0Ada <ada@x>\0ABCD", SigState::Revoked),
            ("E\0\0", SigState::UnknownKey),
            ("N\0\0", SigState::None),
        ] {
            assert_eq!(parse_verify_output(raw).state, want, "{raw}");
        }
    }

    #[test]
    fn parses_signer_and_key() {
        let s = parse_verify_output("G\0Ada Lovelace <ada@x>\0ABCD1234");
        assert_eq!(s.signer.as_deref(), Some("Ada Lovelace <ada@x>"));
        assert_eq!(s.key.as_deref(), Some("ABCD1234"));
    }

    #[test]
    fn an_unsigned_commit_has_no_signer() {
        let s = parse_verify_output("N\0\0");
        assert_eq!(s.state, SigState::None);
        assert!(s.signer.is_none());
    }
```

> `U` is "good signature, untrusted key" — treat it as `Good` and let the signer
> line carry the nuance, rather than inventing a state the UI would have to
> explain.

- [ ] **Step 2: Run to verify failure, then implement**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo test --manifest-path src-tauri/Cargo.toml --lib signing 2>&1 | tail -12
```

`verify_commit` shells to
`git -C <repo> show --no-patch --format=%G?%x00%GS%x00%GK <oid>` and feeds the
output to `parse_verify_output`. It reuses git's own trust evaluation instead of
reimplementing it.

- [ ] **Step 3: Wire the UI**

- Settings: a "Sign commits" control with three states — follow git config
  (default) / always / never — persisted in `useSettingsStore`.
- CommitPanel: a per-commit override beside the existing amend and sign-off
  controls, passed as `CommitOptions.sign`.
- `CommitDiffPanel` header: on selection change, call `verifyCommit(oid)` **for
  that one commit** and show the state. Not a badge per log row: that would mean
  a `gpg`/`ssh-keygen` process per walked commit, which fights #81's pagination
  and #80's windowed list.

- [ ] **Step 4: Verify and commit**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit && pnpm test --run 2>&1 | tail -5 && cargo test --manifest-path src-tauri/Cargo.toml 2>&1 | grep -E "FAILED" | head
```

```bash
git add -A
git commit -m "feat(commit): verify the selected commit's signature (#61 D6)

Verification is lazy and per-selection, reusing git's own trust evaluation via
%G?/%GS/%GK. A badge on every log row would mean one gpg process per walked
commit, which fights the paginated log and the windowed list.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Security review, full gate, PR

- [ ] **Step 1: Run `/security-review` on the branch**

This PR handles credentials and spawns signing subprocesses; the repo already
holds a high bar here (`opener.rs`). Address anything it finds about secret
handling before opening the PR.

- [ ] **Step 2: Re-read the five security constraints at the top of this plan** and confirm each one against the diff. Specifically grep the diff for any credential reaching argv, a log call, or an error string:

```bash
git diff origin/main...HEAD | grep -nE "ASKPASS_SECRET|secret" | head -40
```

- [ ] **Step 3: Full gate**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit \
  && pnpm exec tsc -p e2e/tsconfig.json --noEmit \
  && pnpm test --run \
  && cargo test --manifest-path src-tauri/Cargo.toml \
  && pnpm vite build
```

- [ ] **Step 4: E2E — rebuild the snapshot, run the affected specs**

Auth cannot be exercised against a real remote in e2e; `remote.e2e.ts` covers
the file-remote happy path, and `commit.e2e.ts` covers the commit path that
Task 6 touched.

```bash
pnpm test:e2e:docker build
pnpm test:e2e:docker run --spec e2e/specs/remote.e2e.ts --spec e2e/specs/commit.e2e.ts
```

- [ ] **Step 5: Squash, rebase onto latest main, push, open the PR**

State plainly in the PR body: what is covered, that `push_tag` /
`push_delete_branch` still run credential-less, and that the auth path has no
e2e coverage by design.

---

## Self-review notes

**Spec coverage.** D5 → Tasks 1-4 (classification + scrubbing, the askpass shim, one shared runner across all four op sites, dialog + retry with `git credential` delegation). D6 → Tasks 5-7 (config resolution, the signed commit path including the HEAD trap, lazy verification + UI). Task 8 carries the spec's "worth a security-review pass" note.

**Deliberately deferred, and to be said in the PR:** `push_tag` and `push_delete_branch` remain credential-less; per-remote SSH key selection is out of scope per the spec; the auth path is not e2e-tested because it would need a real authenticated remote.

**Two places the plan tells the implementer to verify rather than assume**, because both are runtime behaviours that cannot be settled by reading: whether `GIT_ASKPASS` accepts `"<exe> --askpass"` as one string or needs a wrapper script (Task 3 Step 3), and the exact serde shape of the `Auth` struct variant under `#[serde(tag, content)]` (Task 1 Step 4). Both carry the fallback to use, and neither fallback weakens the security constraints.
