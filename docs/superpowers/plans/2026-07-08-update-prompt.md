# Update Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prompt the user smoothly when a newer PlatypusGit release exists — self-update in place on Windows `.msi` / Linux AppImage, notify-and-link on macOS (Homebrew) and Linux `.deb`.

**Architecture:** Backend queries GitHub Releases for discovery (drives the prompt only, never installs a binary). A titlebar chip + dismissible panel surface an available update. On self-update-capable platforms the panel's "Install" drives `tauri-plugin-updater`, which verifies a minisign-signed `latest.json` before swapping the binary; other platforms open the release page. Check fires ~2s after launch and on a manual Settings button.

**Tech Stack:** Rust (Tauri 2 commands, `ureq` for the GitHub GET, `tauri-plugin-updater`, `tauri-plugin-process`), React + Zustand frontend, GitHub Actions release workflow.

## Global Constraints

- Backend: every IPC-crossing fn returns `AppResult<T>`; no `unwrap`/`panic` in commands; wrap blocking git2/IO/network in `tokio::task::spawn_blocking`. (`AppError::Network` already exists in `error.rs` and `errors.ts` — reuse it.)
- Frontend never calls `invoke` directly — only via `src/lib/tauri.ts` wrappers. Import UI primitives from `@/design`. Path alias `@/` → `src/`.
- Repo slug is `jonassaa/platypusgit`. Dev builds report version `0.0.0` and must NOT prompt.
- Capability rule (verbatim): `windows` → self-update; `linux` + `APPIMAGE` env set → self-update; everything else (macOS, linux `.deb`, dev) → notify.
- Toolchain: prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before `pnpm`/`cargo`. Node 22 + pnpm.
- Commit style: Conventional Commits, `feat(update): …`, trailing `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- `latest.json` endpoint (verbatim): `https://github.com/jonassaa/platypusgit/releases/latest/download/latest.json`. Updater target keys: `windows-x86_64`, `linux-x86_64` (macOS intentionally absent).

---

### Task 1: Backend update logic module (pure, tested)

Pure helpers with no network/Tauri deps so they unit-test cleanly. The command layer (Task 2) is a thin shell over these.

**Files:**
- Create: `src-tauri/src/update.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod update;` near the other `pub mod` lines, top of file)
- Test: `src-tauri/tests/update.rs`

**Interfaces:**
- Produces:
  - `pub fn is_newer(current: &str, latest: &str) -> bool`
  - `pub fn compute_available(current: &str, latest: &str) -> bool`
  - `pub fn capability(os: &str, is_appimage: bool) -> UpdateCapability`
  - `pub fn parse_release(json: &str) -> AppResult<ReleaseMeta>`
  - `pub fn is_safe_url(url: &str) -> bool`
  - `pub const REPO_SLUG: &str = "jonassaa/platypusgit";`
  - `pub struct UpdateInfo { available, current_version, latest_version, notes, release_url, published_at }` (serde camelCase)
  - `pub enum UpdateCapability { SelfUpdate, Notify }` (serde kebab-case → `"self-update"` / `"notify"`)
  - `pub struct ReleaseMeta { tag, version, notes, url, published_at }`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/update.rs`:

```rust
use platypusgit_lib::update::{
    capability, compute_available, is_newer, is_safe_url, parse_release, UpdateCapability,
};

#[test]
fn is_newer_detects_bumps_and_equality() {
    assert!(is_newer("0.0.5", "0.0.6"));
    assert!(is_newer("0.0.6", "0.1.0"));
    assert!(is_newer("0.9.0", "1.0.0"));
    assert!(!is_newer("0.0.6", "0.0.6"));
    assert!(!is_newer("0.1.0", "0.0.9"));
    // leading-v tolerated on either side
    assert!(is_newer("v0.0.5", "v0.0.6"));
}

#[test]
fn compute_available_suppresses_dev_builds() {
    // 0.0.0 is a dev build — never prompt even though everything is "newer".
    assert!(!compute_available("0.0.0", "0.0.6"));
    assert!(compute_available("0.0.5", "0.0.6"));
    assert!(!compute_available("0.0.6", "0.0.6"));
}

#[test]
fn capability_matches_platform_rule() {
    assert_eq!(capability("windows", false), UpdateCapability::SelfUpdate);
    assert_eq!(capability("linux", true), UpdateCapability::SelfUpdate);
    assert_eq!(capability("linux", false), UpdateCapability::Notify);
    assert_eq!(capability("macos", false), UpdateCapability::Notify);
    assert_eq!(capability("macos", true), UpdateCapability::Notify);
}

#[test]
fn parse_release_maps_github_json() {
    let json = r#"{
        "tag_name": "v0.1.0",
        "name": "0.1.0",
        "body": "rebase fixes\nlogo",
        "html_url": "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
        "published_at": "2026-07-08T10:00:00Z",
        "prerelease": false,
        "draft": false
    }"#;
    let rel = parse_release(json).unwrap();
    assert_eq!(rel.tag, "v0.1.0");
    assert_eq!(rel.version, "0.1.0");
    assert_eq!(rel.notes, "rebase fixes\nlogo");
    assert_eq!(rel.url, "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0");
    assert_eq!(rel.published_at, "2026-07-08T10:00:00Z");
}

#[test]
fn parse_release_rejects_json_without_tag() {
    assert!(parse_release(r#"{"message":"Not Found"}"#).is_err());
}

#[test]
fn is_safe_url_requires_https() {
    assert!(is_safe_url("https://github.com/x"));
    assert!(!is_safe_url("http://github.com/x"));
    assert!(!is_safe_url("file:///etc/passwd"));
    assert!(!is_safe_url("javascript:alert(1)"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --test update`
Expected: FAIL — `unresolved import platypusgit_lib::update` (module doesn't exist yet).

- [ ] **Step 3: Write the module**

Create `src-tauri/src/update.rs`:

```rust
//! Update discovery logic: version comparison, per-platform capability, and
//! parsing the GitHub "latest release" payload. Pure + unit-tested; the network
//! fetch and Tauri commands live in `commands/update.rs`.

use serde::Serialize;

use crate::error::{AppError, AppResult};

pub const REPO_SLUG: &str = "jonassaa/platypusgit";

/// Discovery result handed to the frontend.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub notes: String,
    pub release_url: String,
    pub published_at: String,
}

/// Whether this install can swap its own binary or should defer to a package
/// manager. Serializes to `"self-update"` / `"notify"`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateCapability {
    SelfUpdate,
    Notify,
}

/// Subset of a GitHub release we care about.
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseMeta {
    pub tag: String,
    pub version: String,
    pub notes: String,
    pub url: String,
    pub published_at: String,
}

fn parts(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches('v')
        .split('.')
        .map(|p| p.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

/// True when `latest` is strictly greater than `current` (numeric X.Y.Z).
pub fn is_newer(current: &str, latest: &str) -> bool {
    let (c, l) = (parts(current), parts(latest));
    let n = c.len().max(l.len());
    for i in 0..n {
        let cc = c.get(i).copied().unwrap_or(0);
        let ll = l.get(i).copied().unwrap_or(0);
        if ll != cc {
            return ll > cc;
        }
    }
    false
}

/// Whether to prompt: newer AND not a dev build (`0.0.0`).
pub fn compute_available(current: &str, latest: &str) -> bool {
    current != "0.0.0" && is_newer(current, latest)
}

/// Per-platform self-update vs notify decision. See Global Constraints.
pub fn capability(os: &str, is_appimage: bool) -> UpdateCapability {
    match os {
        "windows" => UpdateCapability::SelfUpdate,
        "linux" if is_appimage => UpdateCapability::SelfUpdate,
        _ => UpdateCapability::Notify,
    }
}

/// Parse the JSON body of `GET /repos/:slug/releases/latest`.
pub fn parse_release(json: &str) -> AppResult<ReleaseMeta> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| AppError::Network(format!("parse release json: {e}")))?;
    let tag = v["tag_name"]
        .as_str()
        .ok_or_else(|| AppError::Network("release json missing tag_name".into()))?
        .to_string();
    let version = tag.strip_prefix('v').unwrap_or(&tag).to_string();
    Ok(ReleaseMeta {
        tag,
        version,
        notes: v["body"].as_str().unwrap_or("").to_string(),
        url: v["html_url"].as_str().unwrap_or("").to_string(),
        published_at: v["published_at"].as_str().unwrap_or("").to_string(),
    })
}

/// Guard for `open_url`: only allow https links out.
pub fn is_safe_url(url: &str) -> bool {
    url.starts_with("https://")
}
```

Add the module declaration to `src-tauri/src/lib.rs` — insert `pub mod update;` alongside the existing `pub mod` block near the top:

```rust
pub mod cli;
pub mod commands;
pub mod error;
pub mod git;
pub mod state;
pub mod update;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --test update`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/update.rs src-tauri/src/lib.rs src-tauri/tests/update.rs
git commit -m "feat(update): version-compare + capability + release-parse helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Backend commands (check, capability, open-url)

Thin Tauri commands over Task 1's helpers, plus the `ureq` GitHub fetch.

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `ureq = "2"`)
- Modify: `src-tauri/src/update.rs` (add `fetch_latest_release`)
- Create: `src-tauri/src/commands/update.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod update;`)
- Modify: `src-tauri/src/lib.rs` (register 3 commands)
- Test: `src-tauri/tests/update.rs` (already covers pure logic — no network test)

**Interfaces:**
- Consumes: `update::{compute_available, capability, parse_release, is_safe_url, UpdateInfo, UpdateCapability, REPO_SLUG}`.
- Produces (Tauri commands):
  - `check_for_update() -> AppResult<UpdateInfo>`
  - `get_update_capability() -> AppResult<UpdateCapability>`
  - `open_url(url: String) -> AppResult<()>`
  - `update::fetch_latest_release() -> AppResult<ReleaseMeta>`

- [ ] **Step 1: Add the dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`, add:

```toml
ureq = "2"
```

- [ ] **Step 2: Add the fetch helper**

Append to `src-tauri/src/update.rs`:

```rust
/// Blocking GET of the latest published release from GitHub. Call inside
/// `spawn_blocking`. Unauthenticated (60 req/hr/IP is ample for our cadence).
pub fn fetch_latest_release() -> AppResult<ReleaseMeta> {
    let url = format!("https://api.github.com/repos/{REPO_SLUG}/releases/latest");
    let resp = ureq::get(&url)
        .set("User-Agent", "platypusgit-updater")
        .set("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let body = resp
        .into_string()
        .map_err(|e| AppError::Network(e.to_string()))?;
    parse_release(&body)
}
```

- [ ] **Step 3: Write the command file**

Create `src-tauri/src/commands/update.rs`:

```rust
use crate::{
    error::{AppError, AppResult},
    update::{self, UpdateCapability, UpdateInfo},
};

/// Query GitHub for the latest release and compare to the running version.
/// Drives the update prompt only — never installs anything.
#[tauri::command]
pub async fn check_for_update() -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let rel = tokio::task::spawn_blocking(update::fetch_latest_release)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))??;
    let available = update::compute_available(&current, &rel.version);
    Ok(UpdateInfo {
        available,
        current_version: current,
        latest_version: rel.version,
        notes: rel.notes,
        release_url: rel.url,
        published_at: rel.published_at,
    })
}

/// Whether this install can self-update or should notify + defer to a package
/// manager. Computed from the build's OS + the `APPIMAGE` env var.
#[tauri::command]
pub fn get_update_capability() -> AppResult<UpdateCapability> {
    Ok(update::capability(
        std::env::consts::OS,
        std::env::var("APPIMAGE").is_ok(),
    ))
}

/// Open an https URL in the user's default browser (notify-path "View release").
#[tauri::command]
pub async fn open_url(url: String) -> AppResult<()> {
    if !update::is_safe_url(&url) {
        return Err(AppError::InvalidPath(format!(
            "refusing to open non-https url: {url}"
        )));
    }
    #[cfg(target_os = "macos")]
    let (prog, pre): (&str, Vec<&str>) = ("open", vec![]);
    #[cfg(target_os = "linux")]
    let (prog, pre): (&str, Vec<&str>) = ("xdg-open", vec![]);
    #[cfg(target_os = "windows")]
    let (prog, pre): (&str, Vec<&str>) = ("cmd", vec!["/C", "start", ""]);

    tokio::process::Command::new(prog)
        .args(&pre)
        .arg(&url)
        .status()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}
```

- [ ] **Step 4: Register the module + commands**

In `src-tauri/src/commands/mod.rs` add (keep alphabetical-ish with the others):

```rust
pub mod update;
```

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![…]`, add after the `commands::cli::install_cli_shim,` line:

```rust
            commands::update::check_for_update,
            commands::update::get_update_capability,
            commands::update::open_url,
```

- [ ] **Step 5: Verify it compiles and pure tests still pass**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo test --manifest-path src-tauri/Cargo.toml --test update && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: tests PASS, `cargo check` succeeds (ureq compiles in).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/update.rs src-tauri/src/commands/update.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(update): check_for_update, get_update_capability, open_url commands

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend types + tauri wrappers

**Files:**
- Modify: `src/lib/types.ts` (add `UpdateInfo`, `UpdateCapability`)
- Modify: `src/lib/tauri.ts` (add 3 wrappers + type imports)

**Interfaces:**
- Produces:
  - `type UpdateInfo` (mirrors Rust camelCase struct)
  - `type UpdateCapability = "self-update" | "notify"`
  - `checkForUpdate(): Promise<UpdateInfo>`
  - `getUpdateCapability(): Promise<UpdateCapability>`
  - `openUrl(url: string): Promise<void>`

- [ ] **Step 1: Add the types**

Append to `src/lib/types.ts`:

```ts
export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  notes: string;
  releaseUrl: string;
  publishedAt: string;
}

export type UpdateCapability = "self-update" | "notify";
```

- [ ] **Step 2: Add the wrappers**

In `src/lib/tauri.ts`, add `UpdateCapability,` and `UpdateInfo,` to the `import type { … } from "./types";` block (keep alphabetical), then append these functions at the end of the file:

```ts
export function checkForUpdate(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_update");
}

export function getUpdateCapability(): Promise<UpdateCapability> {
  return invoke<UpdateCapability>("get_update_capability");
}

export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}
```

- [ ] **Step 3: Typecheck**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/lib/tauri.ts
git commit -m "feat(update): UpdateInfo/UpdateCapability types + tauri wrappers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Updater + process plugin infrastructure

Add the plugins, config, permissions, and signing public key so self-update is wired (dormant until the CI keypair exists — Task 8). Notify-only already works after Task 2.

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-updater`, `tauri-plugin-process`)
- Modify: `package.json` (add `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`)
- Modify: `src-tauri/src/lib.rs` (register both plugins)
- Modify: `src-tauri/tauri.conf.json` (add `plugins.updater`, `bundle.createUpdaterArtifacts`)
- Modify: `src-tauri/capabilities/default.json` (add `updater:default`, `process:allow-restart`)

**Interfaces:**
- Produces: JS APIs `@tauri-apps/plugin-updater` (`check`, `downloadAndInstall`) and `@tauri-apps/plugin-process` (`relaunch`) available to Task 5.

- [ ] **Step 1: Generate the updater signing keypair**

Run (writes the private key OUTSIDE the repo — never commit it):

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tauri signer generate -w "$HOME/.platypusgit-updater.key"
```

This prints a **public key** (base64) and writes the password-protected private key to `~/.platypusgit-updater.key`. Copy the public key string for Step 5. **Surface to the user (do not commit):** the private key file path and the chosen password must be added as GitHub repo secrets `TAURI_SIGNING_PRIVATE_KEY` (file contents) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` before self-update works — used in Task 8. Notify-only works without this.

- [ ] **Step 2: Add Rust plugin deps**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 3: Add JS plugin deps**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm add @tauri-apps/plugin-updater @tauri-apps/plugin-process`

- [ ] **Step 4: Register the plugins**

In `src-tauri/src/lib.rs`, extend the plugin chain. After the `.plugin(tauri_plugin_os::init());` line (i.e. add to the `let builder = builder …` chain), register:

```rust
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());
```

(Place these before the `#[cfg(debug_assertions)]` wdio block so ordering matches the existing chain; both are desktop-safe.)

- [ ] **Step 5: Configure the updater**

In `src-tauri/tauri.conf.json`, add a top-level `plugins` key (sibling of `app` / `bundle`) and set `bundle.createUpdaterArtifacts`:

```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/jonassaa/platypusgit/releases/latest/download/latest.json"
      ],
      "pubkey": "<PASTE PUBLIC KEY FROM STEP 1>"
    }
  },
```

And inside the existing `"bundle": { … }` object add:

```json
    "createUpdaterArtifacts": true,
```

- [ ] **Step 6: Add permissions**

In `src-tauri/capabilities/default.json`, add to the `permissions` array:

```json
    "updater:default",
    "process:allow-restart",
```

- [ ] **Step 7: Verify it builds**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && cargo check --manifest-path src-tauri/Cargo.toml && pnpm tsc --noEmit`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock package.json pnpm-lock.yaml src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(update): wire tauri-plugin-updater + process (self-update infra)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: useUpdateStore (Zustand)

Owns all update state + actions. Discovery via `checkForUpdate`; install via the updater plugin; notify via `openUrl`; dismiss persisted to `localStorage`.

**Files:**
- Create: `src/features/update/useUpdateStore.ts`
- Test: `src/features/update/useUpdateStore.test.ts`

**Interfaces:**
- Consumes: `checkForUpdate`, `getUpdateCapability`, `openUrl` from `@/lib/tauri`; `UpdateInfo`, `UpdateCapability` from `@/lib/types`; `appErrorMessage` from `@/lib/errors`; plugin APIs from Task 4.
- Produces: `useUpdateStore` with state `{ status, info, capability, dismissedVersion, progress, error, panelOpen }` and actions `check(manual)`, `install()`, `openReleasePage()`, `openPanel()`, `closePanel()`, `dismiss()`; plus selector `export function shouldNag(s): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/features/update/useUpdateStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockInvoke, resetInvokeMock } from "@/test/invokeMock";
import { useUpdateStore } from "./useUpdateStore";
import type { UpdateInfo } from "@/lib/types";

const AVAILABLE: UpdateInfo = {
  available: true,
  currentVersion: "0.0.5",
  latestVersion: "0.1.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
  publishedAt: "2026-07-08T10:00:00Z",
};

function reset() {
  resetInvokeMock();
  localStorage.clear();
  useUpdateStore.setState({
    status: "idle",
    info: null,
    capability: null,
    dismissedVersion: null,
    progress: null,
    error: null,
    panelOpen: false,
  });
}

describe("useUpdateStore.check", () => {
  beforeEach(reset);

  it("marks available and auto-opens the panel on a fresh update", async () => {
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => AVAILABLE);
    await useUpdateStore.getState().check(false);
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available");
    expect(s.capability).toBe("notify");
    expect(s.panelOpen).toBe(true);
  });

  it("does not auto-open the panel for a dismissed version", async () => {
    localStorage.setItem("pg-update-dismissed", "0.1.0");
    useUpdateStore.setState({ dismissedVersion: "0.1.0" });
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => AVAILABLE);
    await useUpdateStore.getState().check(false);
    const s = useUpdateStore.getState();
    expect(s.status).toBe("available"); // chip still shows
    expect(s.panelOpen).toBe(false); // but no nag
  });

  it("swallows errors on a startup (non-manual) check", async () => {
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => {
      throw { kind: "Network", message: "offline" };
    });
    await useUpdateStore.getState().check(false);
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().error).toBeNull();
  });

  it("surfaces errors on a manual check", async () => {
    mockInvoke("get_update_capability", () => "notify");
    mockInvoke("check_for_update", () => {
      throw { kind: "Network", message: "offline" };
    });
    await useUpdateStore.getState().check(true);
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().error).toBe("offline");
  });
});

describe("useUpdateStore.dismiss / openReleasePage", () => {
  beforeEach(reset);

  it("dismiss persists the version and closes the panel", () => {
    useUpdateStore.setState({ info: AVAILABLE, panelOpen: true });
    useUpdateStore.getState().dismiss();
    expect(useUpdateStore.getState().dismissedVersion).toBe("0.1.0");
    expect(useUpdateStore.getState().panelOpen).toBe(false);
    expect(localStorage.getItem("pg-update-dismissed")).toBe("0.1.0");
  });

  it("openReleasePage invokes open_url with the release url", async () => {
    const seen: string[] = [];
    mockInvoke("open_url", (args) => {
      seen.push((args as { url: string }).url);
      return null;
    });
    useUpdateStore.setState({ info: AVAILABLE });
    await useUpdateStore.getState().openReleasePage();
    expect(seen).toEqual([AVAILABLE.releaseUrl]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test -- src/features/update/useUpdateStore.test.ts`
Expected: FAIL — cannot resolve `./useUpdateStore`.

- [ ] **Step 3: Write the store**

Create `src/features/update/useUpdateStore.ts`:

```ts
import { create } from "zustand";

import { appErrorMessage } from "@/lib/errors";
import { checkForUpdate, getUpdateCapability, openUrl } from "@/lib/tauri";
import type { UpdateCapability, UpdateInfo } from "@/lib/types";

const DISMISS_KEY = "pg-update-dismissed";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "installing"
  | "error";

export interface UpdateState {
  status: UpdateStatus;
  info: UpdateInfo | null;
  capability: UpdateCapability | null;
  dismissedVersion: string | null;
  progress: number | null; // 0..1 during self-update download
  error: string | null;
  panelOpen: boolean;
  check: (manual: boolean) => Promise<void>;
  install: () => Promise<void>;
  openReleasePage: () => Promise<void>;
  openPanel: () => void;
  closePanel: () => void;
  dismiss: () => void;
}

function loadDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/** An update exists that the user hasn't already dismissed. */
export function shouldNag(s: Pick<UpdateState, "info" | "dismissedVersion">): boolean {
  return (
    !!s.info?.available && s.info.latestVersion !== s.dismissedVersion
  );
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  info: null,
  capability: null,
  dismissedVersion: loadDismissed(),
  progress: null,
  error: null,
  panelOpen: false,

  async check(manual) {
    set({ status: "checking", error: null });
    try {
      // Capability is stable per install; fetch once.
      let capability = get().capability;
      if (!capability) {
        capability = await getUpdateCapability();
      }
      const info = await checkForUpdate();
      set({ info, capability });
      if (info.available) {
        set({ status: "available" });
        // Auto-open the panel only for a version the user hasn't dismissed.
        if (shouldNag({ info, dismissedVersion: get().dismissedVersion })) {
          set({ panelOpen: true });
        }
      } else {
        set({ status: "up-to-date" });
      }
    } catch (e) {
      if (manual) {
        set({ status: "error", error: appErrorMessage(e) });
      } else {
        // Startup check stays silent (offline, rate-limited, etc.).
        set({ status: "idle" });
      }
    }
  },

  async install() {
    set({ status: "installing", error: null, progress: 0 });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const { relaunch } = await import("@tauri-apps/plugin-process");
      const update = await check();
      if (!update) {
        set({ status: "up-to-date", progress: null });
        return;
      }
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? 0;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          set({ progress: total ? downloaded / total : null });
        }
      });
      await relaunch();
    } catch (e) {
      set({ status: "error", error: appErrorMessage(e), progress: null });
    }
  },

  async openReleasePage() {
    const url = get().info?.releaseUrl;
    if (url) await openUrl(url);
  },

  openPanel() {
    set({ panelOpen: true });
  },

  closePanel() {
    set({ panelOpen: false });
  },

  dismiss() {
    const v = get().info?.latestVersion ?? null;
    try {
      if (v) localStorage.setItem(DISMISS_KEY, v);
    } catch {
      // non-fatal
    }
    set({ dismissedVersion: v, panelOpen: false });
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test -- src/features/update/useUpdateStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/update/useUpdateStore.ts src/features/update/useUpdateStore.test.ts
git commit -m "feat(update): useUpdateStore — discovery, dismiss memory, install/notify

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: UpdateChip + UpdatePanel components

**Files:**
- Create: `src/features/update/UpdateChip.tsx`
- Create: `src/features/update/UpdatePanel.tsx`
- Test: `src/features/update/UpdatePanel.test.tsx`

**Interfaces:**
- Consumes: `useUpdateStore`, `usePlatform` from `@/lib/platform`, `PGButton`/`PGIconButton`/`PGIcon` from `@/design`.
- Produces: `<UpdateChip />` (titlebar), `<UpdatePanel />` (overlay). Test-ids: `pg-update-chip`, `pg-update-panel`, `pg-update-action`, `pg-update-dismiss`, `pg-update-brew-hint`.

- [ ] **Step 1: Write the failing test**

Create `src/features/update/UpdatePanel.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useUpdateStore } from "./useUpdateStore";
import { UpdatePanel } from "./UpdatePanel";
import { UpdateChip } from "./UpdateChip";
import type { UpdateInfo } from "@/lib/types";

vi.mock("@/lib/platform", () => ({
  usePlatform: () => "macos",
}));

const INFO: UpdateInfo = {
  available: true,
  currentVersion: "0.0.5",
  latestVersion: "0.1.0",
  notes: "rebase fixes",
  releaseUrl: "https://github.com/jonassaa/platypusgit/releases/tag/v0.1.0",
  publishedAt: "2026-07-08T10:00:00Z",
};

function seed(partial: Partial<ReturnType<typeof useUpdateStore.getState>>) {
  useUpdateStore.setState({
    status: "available",
    info: INFO,
    capability: "notify",
    dismissedVersion: null,
    progress: null,
    error: null,
    panelOpen: true,
    ...partial,
  });
}

describe("UpdateChip", () => {
  beforeEach(() => useUpdateStore.setState({ info: null, status: "idle", panelOpen: false }));

  it("is hidden when no update is available", () => {
    render(<UpdateChip />);
    expect(screen.queryByTestId("pg-update-chip")).toBeNull();
  });

  it("shows the latest version and opens the panel on click", async () => {
    seed({ panelOpen: false });
    render(<UpdateChip />);
    const chip = screen.getByTestId("pg-update-chip");
    expect(chip).toHaveTextContent("0.1.0");
    await userEvent.click(chip);
    expect(useUpdateStore.getState().panelOpen).toBe(true);
  });
});

describe("UpdatePanel", () => {
  beforeEach(() => seed({}));

  it("labels the action 'View release' for notify capability and shows brew hint on macOS", () => {
    seed({ capability: "notify" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(/view release/i);
    expect(screen.getByTestId("pg-update-brew-hint")).toHaveTextContent("brew upgrade platypusgit");
  });

  it("labels the action 'Install' for self-update capability", () => {
    seed({ capability: "self-update" });
    render(<UpdatePanel />);
    expect(screen.getByTestId("pg-update-action")).toHaveTextContent(/install/i);
    expect(screen.queryByTestId("pg-update-brew-hint")).toBeNull();
  });

  it("dismiss closes the panel", async () => {
    seed({});
    render(<UpdatePanel />);
    await userEvent.click(screen.getByTestId("pg-update-dismiss"));
    expect(useUpdateStore.getState().panelOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test -- src/features/update/UpdatePanel.test.tsx`
Expected: FAIL — cannot resolve `./UpdatePanel` / `./UpdateChip`.

- [ ] **Step 3: Write UpdateChip**

Create `src/features/update/UpdateChip.tsx`:

```tsx
import { PGIcon } from "@/design";
import { useUpdateStore } from "./useUpdateStore";

/** Titlebar chip shown whenever an update is available (even if dismissed). */
export function UpdateChip() {
  const available = useUpdateStore((s) => s.info?.available ?? false);
  const latest = useUpdateStore((s) => s.info?.latestVersion);
  const openPanel = useUpdateStore((s) => s.openPanel);

  if (!available) return null;

  return (
    <button
      type="button"
      data-testid="pg-update-chip"
      onClick={openPanel}
      title={`Update available: ${latest}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: "var(--fs-11)",
        color: "var(--accent)",
        background: "transparent",
        border: "1px solid var(--accent)",
        borderRadius: "var(--r-2)",
        padding: "1px 7px",
        cursor: "pointer",
      }}
    >
      <PGIcon name="fetch" size={12} />
      {latest}
    </button>
  );
}
```

Note: reuse an existing icon name. Verify a suitable name exists in `src/design/icons.tsx` (e.g. `fetch`, `pull`, `sync`); if none reads as "download/up-arrow", use `sync`. Do NOT invent an icon name.

- [ ] **Step 4: Write UpdatePanel**

Create `src/features/update/UpdatePanel.tsx`:

```tsx
import { PGButton, PGIconButton } from "@/design";
import { usePlatform } from "@/lib/platform";
import { useUpdateStore } from "./useUpdateStore";

/** Dismissible panel with version, notes, and the primary update action. */
export function UpdatePanel() {
  const panelOpen = useUpdateStore((s) => s.panelOpen);
  const info = useUpdateStore((s) => s.info);
  const capability = useUpdateStore((s) => s.capability);
  const status = useUpdateStore((s) => s.status);
  const progress = useUpdateStore((s) => s.progress);
  const install = useUpdateStore((s) => s.install);
  const openReleasePage = useUpdateStore((s) => s.openReleasePage);
  const closePanel = useUpdateStore((s) => s.closePanel);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const platform = usePlatform();

  if (!panelOpen || !info) return null;

  const selfUpdate = capability === "self-update";
  const installing = status === "installing";

  return (
    <div
      data-testid="pg-update-panel"
      role="dialog"
      aria-label="Update available"
      style={{
        position: "absolute",
        top: 44,
        right: 12,
        width: 360,
        zIndex: 50,
        background: "var(--bg-1)",
        border: "1px solid var(--border-1)",
        borderRadius: "var(--r-3)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600, color: "var(--fg-0)" }}>
          Update available — {info.latestVersion}
        </span>
        <PGIconButton icon="close" title="Close" onClick={closePanel} />
      </div>

      <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
        You have {info.currentVersion}.
      </div>

      {info.notes && (
        <pre
          style={{
            maxHeight: 160,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            background: "var(--bg-2)",
            borderRadius: "var(--r-2)",
            padding: 8,
            margin: 0,
          }}
        >
          {info.notes}
        </pre>
      )}

      {!selfUpdate && platform === "macos" && (
        <code
          data-testid="pg-update-brew-hint"
          style={{
            fontSize: "var(--fs-11)",
            color: "var(--fg-1)",
            background: "var(--bg-2)",
            borderRadius: "var(--r-2)",
            padding: "4px 8px",
          }}
        >
          brew upgrade platypusgit
        </code>
      )}

      {installing && (
        <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-2)" }}>
          Downloading… {progress != null ? `${Math.round(progress * 100)}%` : ""}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <PGButton size="sm" variant="default" data-testid="pg-update-dismiss" onClick={dismiss}>
          Later
        </PGButton>
        <PGButton
          size="sm"
          variant="primary"
          data-testid="pg-update-action"
          loading={installing}
          onClick={selfUpdate ? install : openReleasePage}
        >
          {selfUpdate ? "Install & restart" : "View release"}
        </PGButton>
      </div>
    </div>
  );
}
```

Note: confirm `PGButton` accepts `variant="primary"` and `data-testid` passthrough (CLAUDE.md says `PGButton` spreads `...rest`), and that `PGIconButton` supports `icon="close"`. If `variant="primary"` isn't a valid variant, use the accent variant used elsewhere (grep `variant=` in `src/design/primitives.tsx`).

- [ ] **Step 5: Run test to verify it passes**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm test -- src/features/update/UpdatePanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/features/update/UpdateChip.tsx src/features/update/UpdatePanel.tsx src/features/update/UpdatePanel.test.tsx
git commit -m "feat(update): titlebar chip + dismissible update panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire into AppShell + Settings

Mount the chip + panel, fire the startup check, and add the Settings Updates section.

**Files:**
- Modify: `src/AppShell.tsx` (import chip/panel/store; render chip in titlebar `rightSlot`; render `<UpdatePanel />`; add 2s startup-check effect)
- Modify: `src/screens/Settings.tsx` (add an Updates section: current version + "Check for updates" button + status)

**Interfaces:**
- Consumes: `UpdateChip`, `UpdatePanel`, `useUpdateStore` from `@/features/update/*`.

- [ ] **Step 1: Mount chip + panel and add startup check in AppShell**

In `src/AppShell.tsx`:

Add imports near the other feature imports:

```tsx
import { UpdateChip } from "@/features/update/UpdateChip";
import { UpdatePanel } from "@/features/update/UpdatePanel";
import { useUpdateStore } from "@/features/update/useUpdateStore";
```

In the top-level `AppShell` component body, add a startup-check effect (co-locate with the other `React.useEffect` calls):

```tsx
  React.useEffect(() => {
    const t = setTimeout(() => {
      void useUpdateStore.getState().check(false);
    }, 2000);
    return () => clearTimeout(t);
  }, []);
```

Render the panel once at shell level. The shell root is already positioned as a flex column; wrap or add `<UpdatePanel />` as a sibling inside the outermost container that establishes positioning (the panel is `position: absolute`, so its container needs `position: relative`). Add `<UpdatePanel />` just after `<AppTitlebar … />` in the returned JSX, and ensure the enclosing container has `position: "relative"` (add it if absent).

In `AppTitlebar`, add the chip into the existing `rightSlot` flex row — as the FIRST child of the `<div style={{ display: "flex", gap: 6, alignItems: "center" }}>`:

```tsx
            <UpdateChip />
```

- [ ] **Step 2: Add the Settings Updates section**

In `src/screens/Settings.tsx`, add a new section. It already imports `platform` from `@tauri-apps/plugin-os`. Get the app version from `@tauri-apps/api/app`:

```tsx
import { getVersion } from "@tauri-apps/api/app";
import { useUpdateStore } from "@/features/update/useUpdateStore";
```

Add local state + handler in the Settings component:

```tsx
  const [appVersion, setAppVersion] = React.useState<string>("");
  React.useEffect(() => {
    void getVersion().then(setAppVersion);
  }, []);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateInfo = useUpdateStore((s) => s.info);
  const updateError = useUpdateStore((s) => s.error);
  const checkUpdate = useUpdateStore((s) => s.check);
```

Render a section (match the existing Settings section markup/classes — mirror a neighbouring section's wrapper):

```tsx
        <section data-testid="settings-updates">
          <h2>Updates</h2>
          <div>Current version: {appVersion || "…"}</div>
          <PGButton
            size="sm"
            variant="default"
            loading={updateStatus === "checking"}
            onClick={() => checkUpdate(true)}
          >
            Check for updates
          </PGButton>
          {updateStatus === "up-to-date" && <span>You're up to date.</span>}
          {updateStatus === "available" && updateInfo && (
            <span>Update available: {updateInfo.latestVersion}</span>
          )}
          {updateStatus === "error" && updateError && (
            <span style={{ color: "var(--git-modified)" }}>{updateError}</span>
          )}
        </section>
```

(Use the same section/heading wrapper classes as the surrounding Settings sections — grep the file for an existing `<section` to copy its exact structure/styling.)

- [ ] **Step 3: Typecheck + run affected unit tests**

Run: `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH" && pnpm tsc --noEmit && pnpm test -- src/features/update`
Expected: typecheck clean, update tests still PASS.

- [ ] **Step 4: Manually verify in the app (notify path)**

Per the `verify` skill: run `pnpm tauri dev`, open Settings → Updates, confirm the current version renders and "Check for updates" runs without crashing (on a dev `0.0.0` build it reports up-to-date; that's expected). Confirm no console errors and the titlebar renders normally.

- [ ] **Step 5: Commit**

```bash
git add src/AppShell.tsx src/screens/Settings.tsx
git commit -m "feat(update): startup check, titlebar chip/panel, Settings updates section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: CI — sign updater artifacts + publish latest.json

Make the release workflow sign the Windows/Linux updater artifacts and publish a `latest.json` manifest so `tauri-plugin-updater` can verify + install.

**Files:**
- Modify: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: repo secrets `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (added by the user, Task 4 Step 1).
- Produces: `.msi`/`.AppImage` `.sig` files + a `latest.json` release asset.

- [ ] **Step 1: Add signing env to the windows + linux build steps**

In the `windows` job, on the `- name: Build app` step, add:

```yaml
      - name: Build app
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: pnpm tauri build
```

In the `linux` job, do the same for its `- name: Build app` step. With signing configured + `createUpdaterArtifacts: true`, the build writes `<bundle>.sig` next to each updater artifact.

- [ ] **Step 2: Export each platform's signature as a job output**

In the `windows` job add an `outputs:` block and a step after "Rename bundle to stable name":

```yaml
    outputs:
      sig: ${{ steps.sig.outputs.sig }}
```

```yaml
      - name: Read updater signature
        id: sig
        shell: bash
        run: |
          set -euo pipefail
          msi_dir="src-tauri/target/release/bundle/msi"
          sig="$(cat "$(ls "$msi_dir"/*.msi.sig | head -n1)")"
          echo "sig=$sig" >> "$GITHUB_OUTPUT"
```

In the `linux` job add:

```yaml
    outputs:
      sig: ${{ steps.sig.outputs.sig }}
```

```yaml
      - name: Read updater signature
        id: sig
        run: |
          set -euo pipefail
          appimage_dir="src-tauri/target/release/bundle/appimage"
          sig="$(cat "$(ls "$appimage_dir"/*.AppImage.sig | head -n1)")"
          echo "sig=$sig" >> "$GITHUB_OUTPUT"
```

(Place each after the existing "Rename bundles to stable names" step so the artifacts exist. The `.sig` filename tracks the ORIGINAL bundle name, not the stable copy — glob `*.msi.sig` / `*.AppImage.sig`.)

- [ ] **Step 3: Add the updater-manifest job**

Append this job to `.github/workflows/release.yml`:

```yaml
  # Publish the updater manifest so tauri-plugin-updater can verify + install.
  # Points at the stable-named release assets. macOS is intentionally omitted
  # (notify-only). Skipped for plain prereleases, same gate as bump-cask.
  updater-manifest:
    needs: [version, windows, linux]
    runs-on: ubuntu-latest
    if: ${{ (github.event_name == 'release' && github.event.release.prerelease == false) || github.event_name == 'workflow_dispatch' }}
    steps:
      - name: Build latest.json
        run: |
          set -euo pipefail
          v="${{ needs.version.outputs.version }}"
          tag="${{ needs.version.outputs.tag }}"
          base="https://github.com/jonassaa/platypusgit/releases/download/${tag}"
          jq -n \
            --arg version "$v" \
            --arg notes "See https://github.com/jonassaa/platypusgit/releases/tag/${tag}" \
            --arg win_sig "${{ needs.windows.outputs.sig }}" \
            --arg win_url "${base}/PlatypusGit_x64.msi" \
            --arg lin_sig "${{ needs.linux.outputs.sig }}" \
            --arg lin_url "${base}/PlatypusGit_amd64.AppImage" \
            '{
              version: $version,
              notes: $notes,
              platforms: {
                "windows-x86_64": { signature: $win_sig, url: $win_url },
                "linux-x86_64": { signature: $lin_sig, url: $lin_url }
              }
            }' > latest.json
          echo "--- latest.json ---"
          cat latest.json

      - name: Attach latest.json to release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ needs.version.outputs.tag }}
          files: latest.json
          fail_on_unmatched_files: true
```

- [ ] **Step 4: Lint the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/release.yml'))" && echo OK`
Expected: `OK` (valid YAML). Note: the manifest job cannot be end-to-end tested without cutting a real signed release — that validation happens on the first release after the user adds the secrets.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(update): sign updater artifacts + publish latest.json manifest

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: E2E — Settings Updates section renders

Minimal, deterministic e2e: assert the Updates section + version + button render. Does NOT click "Check for updates" (real backend would hit the network → flaky) and does NOT exercise self-update (no signed manifest in the test binary).

**Files:**
- Create: `e2e/specs/update.e2e.ts`

- [ ] **Step 1: Read the e2e-testing skill**

Read `.claude/skills/e2e-testing/SKILL.md` before writing the spec — selector conventions, navigation to Settings, rebuild discipline.

- [ ] **Step 2: Write the spec**

Create `e2e/specs/update.e2e.ts`. Follow the existing specs' structure for launching + navigating to Settings (mirror how another spec opens the Settings screen — via the titlebar gear or activity bar). Assert:

```ts
// Pseudocode shape — adapt selectors to the project's e2e helpers (see
// e2e-testing skill + an existing spec such as e2e/specs/settings*.e2e.ts):
// 1. launch app, navigate to Settings
// 2. const section = await $('[data-testid="settings-updates"]')
//    await expect(section).toBeExisting()
// 3. await expect(section).toHaveText(expect.stringContaining("Current version"))
// 4. const btn = section.$('button')  // "Check for updates"
//    await expect(btn).toBeExisting()
// Do NOT click it (network).
```

Write real WebdriverIO assertions matching an existing settings spec's idioms; do not leave pseudocode in the committed file.

- [ ] **Step 3: Rebuild snapshot + run only this spec**

Run:
```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test:e2e:build
pnpm test:e2e:run --spec e2e/specs/update.e2e.ts
```
Expected: the spec passes.

- [ ] **Step 4: Commit**

```bash
git add e2e/specs/update.e2e.ts
git commit -m "test(update): e2e for Settings updates section

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Hybrid split (self-update Win/AppImage; notify macOS/deb) → Task 1 (`capability`), Task 2 (command), Task 5/6 (UI branch). ✓
- Discovery vs secure install separation → Task 2 (`check_for_update` GitHub GET) + Task 4/5 (updater plugin install). ✓
- Capability detection incl. `APPIMAGE` + dev `0.0.0` suppression → Task 1 (`capability`, `compute_available`), tested. ✓
- Startup (2s) + manual check → Task 7 (effect) + Task 7 (Settings button). ✓
- Titlebar chip + dismissible panel + dismiss memory + re-nag on newer → Task 6 (`UpdateChip`/`UpdatePanel`), Task 5 (`dismiss`, `shouldNag`), tested. ✓
- Settings Updates section w/ current version → Task 7. ✓
- CI: signing env + latest.json manifest → Task 8. ✓
- Minisign keypair human step → Task 4 Step 1 (surface secrets to user). ✓
- Security posture (unsigned discovery only toggles UI; install signature-verified; `open_url` https-only guard) → Task 1 (`is_safe_url`), Task 2 (guard), Task 4 (pubkey). ✓
- Testing across Rust/frontend/e2e → Tasks 1, 5, 6, 9. ✓
- YAGNI (no timer, no Homebrew detection, no delta) → honored; nothing added. ✓

**Placeholder scan:** Only intentional human-provided values remain (`<PASTE PUBLIC KEY FROM STEP 1>`, GitHub secrets), documented as human steps. E2E Step 2 ships pseudocode-shaped guidance but explicitly instructs writing real assertions before commit. No stray TODO/TBD.

**Type consistency:** `UpdateInfo`/`UpdateCapability` fields identical across Rust (camelCase serde) and TS. Store action names (`check`, `install`, `openReleasePage`, `openPanel`, `closePanel`, `dismiss`) match component usage in Task 6/7. Command names (`check_for_update`, `get_update_capability`, `open_url`) match `tauri.ts` wrappers and `invoke_handler!` registration. `shouldNag` signature consumed consistently.
