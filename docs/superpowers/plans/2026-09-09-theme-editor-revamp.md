# Theme Editor Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make theme and settings export/import actually write and read files on
every platform (#435), and rebuild theme creation around a visual gallery and an
editor with a live preview, a guided start and contrast warnings.

**Architecture:** A new pair of thin Rust commands (`read_user_file`,
`write_user_file`) behind one frontend helper (`lib/userFile.ts`) replaces the
`<a download>` blob click and the hidden `<input type="file">` at all five call
sites. On the frontend, `themeVars(theme)` is extracted out of `applyTheme` so a
single `ThemePreview` component can paint any theme into its own subtree —
serving both the new gallery cards and the editor's preview pane. The editor's
draft moves from local React state into a small Zustand store so Escape can
reach it through `app.closeOverlay` and closing can restore the pre-draft theme.

**Tech Stack:** Tauri 2 (Rust) + React 19/TypeScript, Zustand, Vitest
(projects `unit` in jsdom and `docs` in node), `cargo test`, WebdriverIO e2e.

**Spec:** `docs/superpowers/specs/2026-09-09-theme-editor-revamp-spec.md`

## Global Constraints

- **Toolchain paths.** This session's Bash tool does not inherit the
  interactive shell rc, and an isolated worktree refuses
  `export PATH="$HOME/..."`. Call the binaries directly:
  `~/Library/pnpm/pnpm` and `~/.cargo/bin/cargo`.
- **Every IPC-crossing fn returns `AppResult<T>`.** Use the existing
  `AppError::Io` and `AppError::InvalidPath`. **Add no new `AppError` variant** —
  the TS union in `src/lib/errors.ts` must stay 1:1 with the Rust enum and
  `test/appErrors.test.ts` fails the build for a mismatch.
- **Never call `invoke` directly** from a feature. Add a typed wrapper to
  `src/lib/tauri.ts` and call that.
- **Never `Command::new` outside `src-tauri/src/proc.rs`.** Nothing in this plan
  spawns a process; if you reach for one, you are off-plan.
- **No native `<select>`/`<option>` in `src/`** — use `PGSelect` from `@/design`.
  A guard test enforces it.
- **No `window.confirm`/`window.prompt`** — `pgConfirm`/`pgPrompt` from
  `@/design`. Every one reads a dismissal as "no answer", never as a choice.
- **Design system is `src/design/`, imported from `@/design`.** Do not add
  `src/components/ui/`. Never hardcode the accent hue — CSS vars only.
- **Icons are `lucide-react` behind `PGIcon`.** `src/design/icons.tsx` is the
  only file that may import lucide, and every `name` you pass must already be
  declared in the `IconName` union or `test/iconSet.test.ts` fails the build.
- **`@/` is the path alias for `src/`.** Use it.
- **Commit style:** `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …`,
  imperative subject under 72 chars, optional body with `**Why:**`, trailing
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
  **Pass the message with `git commit -F <file>`, never `-m`** — the Bash tool
  evals the command, so a backtick in a `-m` body executes and hangs forever.
- **New settings copy is user-facing prose.** A user never reads an enum name or
  a token id in a banner or a hint.
- **File-size cap:** `MAX_USER_FILE_BYTES = 4 * 1024 * 1024` (4 MiB), used
  verbatim in Task 1 and cited in the docs in Task 12.

---

### Task 1: Backend file read/write commands

**Files:**
- Create: `src-tauri/src/commands/userfile.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add `pub mod userfile;`, alphabetical — between `update` and `watch`)
- Modify: `src-tauri/src/lib.rs` (add two entries to `tauri::generate_handler![…]`, after the `commands::update::…` block)
- Test: `src-tauri/tests/user_file.rs`

**Interfaces:**
- Consumes: `crate::error::{AppError, AppResult}` (both already exist).
- Produces:
  - `platypusgit_lib::commands::userfile::write_user_file(path: String, contents: String) -> AppResult<()>` (async)
  - `platypusgit_lib::commands::userfile::read_user_file(path: String) -> AppResult<String>` (async)
  - `platypusgit_lib::commands::userfile::MAX_USER_FILE_BYTES: u64`
  - Tauri command names as seen from the frontend: `write_user_file`, `read_user_file`

- [ ] **Step 1: Write the failing test**

Create `src-tauri/tests/user_file.rs`:

```rust
//! Reading and writing a file the USER picked in a native dialog (#435).
//!
//! Theme and settings export used to write its file with a blob URL and an
//! `<a download>` click, which WebKitGTK ignores — so on Linux the button did
//! nothing at all. These commands are the native replacement, and the property
//! worth asserting is that they are boring: an exact round trip, and a refusal
//! rather than a surprise for every input that is not a writable file.

use platypusgit_lib::commands::userfile::{read_user_file, write_user_file, MAX_USER_FILE_BYTES};
use platypusgit_lib::error::AppError;

#[tokio::test]
async fn round_trips_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("my-theme.pgtheme.json");
    let body = "{\n  \"name\": \"My theme\"\n}\n";

    write_user_file(path.to_string_lossy().to_string(), body.to_string())
        .await
        .expect("write should succeed");

    let read = read_user_file(path.to_string_lossy().to_string())
        .await
        .expect("read should succeed");
    assert_eq!(read, body);
}

#[tokio::test]
async fn write_truncates_an_existing_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("theme.json");
    let p = path.to_string_lossy().to_string();

    write_user_file(p.clone(), "a-much-longer-first-write".to_string())
        .await
        .unwrap();
    write_user_file(p.clone(), "short".to_string()).await.unwrap();

    assert_eq!(read_user_file(p).await.unwrap(), "short");
}

#[tokio::test]
async fn read_reports_a_missing_file_as_io() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nope.json");
    match read_user_file(path.to_string_lossy().to_string()).await {
        Err(AppError::Io(_)) => {}
        other => panic!("expected Io for a missing file, got {other:?}"),
    }
}

#[tokio::test]
async fn read_refuses_a_directory() {
    let dir = tempfile::tempdir().unwrap();
    match read_user_file(dir.path().to_string_lossy().to_string()).await {
        Err(AppError::InvalidPath(_)) => {}
        other => panic!("expected InvalidPath for a directory, got {other:?}"),
    }
}

#[tokio::test]
async fn read_refuses_an_oversized_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("huge.json");
    // One byte over the cap is enough: the check is on metadata, so the test
    // does not need to write a realistic 4 MiB of JSON to prove the refusal.
    let big = vec![b'x'; (MAX_USER_FILE_BYTES + 1) as usize];
    std::fs::write(&path, big).unwrap();

    match read_user_file(path.to_string_lossy().to_string()).await {
        Err(AppError::InvalidPath(m)) => assert!(
            m.contains("too large"),
            "the refusal should say why: {m}"
        ),
        other => panic!("expected InvalidPath for an oversized file, got {other:?}"),
    }
}

#[tokio::test]
async fn write_refuses_an_empty_path() {
    match write_user_file(String::new(), "x".to_string()).await {
        Err(AppError::InvalidPath(_)) => {}
        other => panic!("expected InvalidPath for an empty path, got {other:?}"),
    }
}

#[tokio::test]
async fn write_does_not_create_parent_directories() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("no-such-dir").join("theme.json");
    match write_user_file(path.to_string_lossy().to_string(), "x".to_string()).await {
        Err(AppError::Io(_)) => {}
        other => panic!("expected Io when the parent is missing, got {other:?}"),
    }
    assert!(
        !dir.path().join("no-such-dir").exists(),
        "a webview string must not be able to mkdir"
    );
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test user_file`
Expected: FAIL to compile — `unresolved import platypusgit_lib::commands::userfile`.

- [ ] **Step 3: Write the implementation**

Create `src-tauri/src/commands/userfile.rs`:

```rust
//! Reading and writing one file the user picked in a native dialog (#435).
//!
//! Export used to be a browser trick: a `Blob`, an `<a download>` and a
//! synthetic click. WebKitGTK ignores the `download` attribute on a blob URL,
//! so on Linux "Export theme" did nothing — no file, no error, no log line. A
//! webview is not a browser, and nothing about `<a download>` is contracted to
//! work in one, so the fix is a real native path rather than a patch to the
//! click.
//!
//! **The trust model, stated plainly:** these take an absolute path the USER
//! chose in a native save or open dialog (`@tauri-apps/plugin-dialog`, behind
//! `src/lib/userFile.ts`). Nothing in the frontend may synthesise a path for
//! them. That is why `write_user_file` refuses to create parent directories:
//! a dialog's path always has a parent that exists, so a request to invent one
//! is a request that did not come from a dialog.

use crate::error::{AppError, AppResult};

/// The largest file `read_user_file` will hand to the webview.
///
/// A settings bundle with every custom theme is a few tens of kilobytes. The cap
/// exists because the path comes from a file picker and a mis-picked disk image
/// should be a refusal, not a webview that swallows a gigabyte of bytes.
pub const MAX_USER_FILE_BYTES: u64 = 4 * 1024 * 1024;

/// Write `contents` to `path`, creating or truncating it.
#[tauri::command]
pub async fn write_user_file(path: String, contents: String) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("no file was chosen".into()));
    }
    // libgit2 is not involved here, but the reason for spawn_blocking is the
    // same: std::fs is sync, and blocking the async runtime's worker on a slow
    // network volume would stall every other command with it.
    tokio::task::spawn_blocking(move || {
        std::fs::write(&path, contents.as_bytes())
            .map_err(|e| AppError::Io(format!("cannot write {path}: {e}")))
    })
    .await
    .map_err(|e| AppError::Internal(format!("write task failed: {e}")))?
}

/// Read `path` as UTF-8 text, refusing anything that is not a file we can hand
/// to the webview whole.
#[tauri::command]
pub async fn read_user_file(path: String) -> AppResult<String> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidPath("no file was chosen".into()));
    }
    tokio::task::spawn_blocking(move || {
        let meta = std::fs::metadata(&path)
            .map_err(|e| AppError::Io(format!("cannot read {path}: {e}")))?;
        if meta.is_dir() {
            return Err(AppError::InvalidPath(format!("{path} is a folder, not a file")));
        }
        if meta.len() > MAX_USER_FILE_BYTES {
            return Err(AppError::InvalidPath(format!(
                "{path} is too large to read ({} bytes; the limit is {MAX_USER_FILE_BYTES})",
                meta.len()
            )));
        }
        std::fs::read_to_string(&path)
            .map_err(|e| AppError::Io(format!("cannot read {path}: {e}")))
    })
    .await
    .map_err(|e| AppError::Internal(format!("read task failed: {e}")))?
}
```

- [ ] **Step 4: Register the module and the commands**

In `src-tauri/src/commands/mod.rs`, add between `pub mod update;` and `pub mod watch;`:

```rust
pub mod userfile;
```

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![…]`, add after the
last `commands::update::…` entry:

```rust
            commands::userfile::read_user_file,
            commands::userfile::write_user_file,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml --test user_file`
Expected: PASS, 7 tests.

Then confirm nothing else broke:
Run: `~/.cargo/bin/cargo check --manifest-path src-tauri/Cargo.toml --all-targets`
Expected: no errors. (This crate is broadly dirty on warnings already, and CI
runs no clippy or fmt — do **not** `cargo fmt` a focused diff.)

- [ ] **Step 6: Commit**

Write the message to a file first (backticks in a `-m` body hang the tool):

```bash
printf '%s\n' 'feat(userfile): read and write a user-picked file natively' '' 'Why: export wrote its file with a blob URL and an <a download> click, which' 'WebKitGTK ignores -- #435 is that click doing nothing on Linux. A webview is' 'not a browser, so the fix is a native path, not a patch to the click.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src-tauri/src/commands/userfile.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/tests/user_file.rs
git commit -F /tmp/pg-msg.txt
```

---

### Task 2: The frontend file path — `lib/userFile.ts`

**Files:**
- Create: `src/lib/userFile.ts`
- Create: `src/lib/userFile.test.ts`
- Modify: `src/lib/tauri.ts` (two wrappers at the end, beside `revealLogFile`)
- Modify: `src-tauri/capabilities/default.json` (add `dialog:allow-save`)
- Modify: `src/test/dialogMock.ts` (make `save()` settable, like `open()`)

**Interfaces:**
- Consumes: `read_user_file` / `write_user_file` from Task 1.
- Produces:
  - `src/lib/tauri.ts`: `readUserFile(path: string): Promise<string>`,
    `writeUserFile(path: string, contents: string): Promise<void>`
  - `src/lib/userFile.ts`:
    - `type FileFilter = { name: string; extensions: string[] }`
    - `saveTextFile(opts: { defaultName: string; contents: string; filters?: FileFilter[] }): Promise<string | null>`
    - `openTextFile(opts?: { filters?: FileFilter[] }): Promise<{ path: string; contents: string } | null>`
    - `THEME_FILE_FILTERS: FileFilter[]`, `SETTINGS_FILE_FILTERS: FileFilter[]`
  - `src/test/dialogMock.ts`: `mockDialogSave(result: string | null): void`

- [ ] **Step 1: Make the dialog mock's `save()` settable**

`src/test/dialogMock.ts` currently hard-codes `save()` to `null`. Replace its
body with:

```ts
// Tauri dialog plugin mock. Each test sets the result `open()` or `save()`
// should return.

type OpenResult = string | string[] | null;

let openResult: OpenResult = null;
let saveResult: string | null = null;
let lastSaveOptions: unknown = null;

export function mockDialogOpen(result: OpenResult): void {
  openResult = result;
}

/** The path the native save dialog should pretend the user chose. */
export function mockDialogSave(result: string | null): void {
  saveResult = result;
}

/** What `save()` was last called with, so a test can assert the default name. */
export function lastDialogSaveOptions(): unknown {
  return lastSaveOptions;
}

export function resetDialogMock(): void {
  openResult = null;
  saveResult = null;
  lastSaveOptions = null;
}

export async function open(): Promise<OpenResult> {
  return openResult;
}

export async function save(options?: unknown): Promise<string | null> {
  lastSaveOptions = options ?? null;
  return saveResult;
}

export async function ask(): Promise<boolean> {
  return false;
}

export async function confirm(): Promise<boolean> {
  return false;
}

export async function message(): Promise<void> {
  return;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/userFile.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { mockDialogOpen, mockDialogSave } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import {
  openTextFile,
  saveTextFile,
  THEME_FILE_FILTERS,
} from "./userFile";

describe("saveTextFile", () => {
  beforeEach(() => {
    mockDialogSave(null);
  });

  it("returns null and writes nothing when the user cancels", async () => {
    mockDialogSave(null);
    const path = await saveTextFile({
      defaultName: "my-theme.pgtheme.json",
      contents: "{}",
    });
    expect(path).toBeNull();
    expect(invokeCalls().some((c) => c.cmd === "write_user_file")).toBe(false);
  });

  it("writes the contents to the chosen path and returns it", async () => {
    mockDialogSave("/home/you/my-theme.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);

    const path = await saveTextFile({
      defaultName: "my-theme.pgtheme.json",
      contents: '{"name":"My theme"}',
      filters: THEME_FILE_FILTERS,
    });

    expect(path).toBe("/home/you/my-theme.pgtheme.json");
    const call = invokeCalls().find((c) => c.cmd === "write_user_file");
    expect(call?.args).toEqual({
      path: "/home/you/my-theme.pgtheme.json",
      contents: '{"name":"My theme"}',
    });
  });
});

describe("openTextFile", () => {
  it("returns null when the user cancels", async () => {
    mockDialogOpen(null);
    expect(await openTextFile()).toBeNull();
  });

  it("reads the chosen file and returns its path and contents", async () => {
    mockDialogOpen("/home/you/theme.pgtheme.json");
    mockInvoke("read_user_file", () => '{"name":"From disk"}');

    const got = await openTextFile({ filters: THEME_FILE_FILTERS });

    expect(got).toEqual({
      path: "/home/you/theme.pgtheme.json",
      contents: '{"name":"From disk"}',
    });
  });

  it("takes the first path when the dialog answers with an array", async () => {
    // `open()` returns string[] when multiple:true. We never ask for multiple,
    // but the plugin's type admits it, and reading `[0]` is cheaper than
    // trusting a cast.
    mockDialogOpen(["/home/you/a.json", "/home/you/b.json"]);
    mockInvoke("read_user_file", () => "{}");

    const got = await openTextFile();
    expect(got?.path).toBe("/home/you/a.json");
  });
});
```

Two things about `src/test/invokeMock.ts`, both verified against the file and
both easy to get wrong: **`mockInvoke`'s second argument is a HANDLER
function**, not a value — `mockInvoke("read_user_file", () => json)`, and an
unregistered command **throws** rather than returning undefined, so every
command a test exercises needs a handler. The call log accessor is
`getInvokeCalls()`.

- [ ] **Step 3: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/lib/userFile.test.ts`
Expected: FAIL — cannot resolve `./userFile`.

- [ ] **Step 4: Add the typed invoke wrappers**

At the end of `src/lib/tauri.ts`, after `revealLogFile`:

```ts
/**
 * Read a file the user picked in a native open dialog.
 *
 * Capped at 4 MiB by the backend, and a folder is a refusal — see
 * `commands/userfile.rs`. Go through `lib/userFile.ts` rather than calling this
 * directly: the path has to come from a dialog.
 */
export async function readUserFile(path: string): Promise<string> {
  return invoke<string>("read_user_file", { path });
}

/** Write a file to the path the user picked in a native save dialog. */
export async function writeUserFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_user_file", { path, contents });
}
```

- [ ] **Step 5: Write the implementation**

Create `src/lib/userFile.ts`:

```ts
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

import { readUserFile, writeUserFile } from "./tauri";

/**
 * The ONE way this app puts a file on disk or reads one back (#435).
 *
 * Export used to be a `Blob`, an `<a download>` and a synthetic click, and
 * import a hidden `<input type="file">`. The download attribute is ignored by
 * WebKitGTK, so on Linux every export button did nothing at all — silently,
 * with no error to report. Both are browser affordances in an app that has
 * native dialogs, so both are gone; `test/fileSave.test.ts` fails the build if
 * either comes back.
 *
 * A cancelled dialog resolves to `null`, never a throw: a dismissal is "no
 * answer", the same reading `pgConfirm` and `pgPrompt` give it. Every save
 * returns the PATH, because "your settings were exported" is useless without
 * saying to what.
 */
export type FileFilter = { name: string; extensions: string[] };

/** Single-theme files. The double extension is what the app has always written. */
export const THEME_FILE_FILTERS: FileFilter[] = [
  { name: "PlatypusGit theme", extensions: ["pgtheme.json", "json"] },
];

/** Whole-settings bundles (#254). */
export const SETTINGS_FILE_FILTERS: FileFilter[] = [
  { name: "PlatypusGit settings", extensions: ["json"] },
];

/**
 * Ask where to put a text file, then write it. Resolves to the chosen path, or
 * `null` when the user cancelled.
 */
export async function saveTextFile(opts: {
  defaultName: string;
  contents: string;
  filters?: FileFilter[];
}): Promise<string | null> {
  const path = await saveDialog({
    defaultPath: opts.defaultName,
    filters: opts.filters,
  });
  if (!path) return null;
  await writeUserFile(path, opts.contents);
  return path;
}

/**
 * Ask for a text file, then read it. Resolves to `null` when the user
 * cancelled.
 */
export async function openTextFile(opts?: {
  filters?: FileFilter[];
}): Promise<{ path: string; contents: string } | null> {
  const picked = await openDialog({
    multiple: false,
    directory: false,
    filters: opts?.filters,
  });
  // `open()`'s type admits string[] (multiple: true). We never ask for it, but
  // reading [0] is cheaper than trusting the cast.
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (!path) return null;
  return { path, contents: await readUserFile(path) };
}
```

- [ ] **Step 6: Grant the save permission**

In `src-tauri/capabilities/default.json`, add `"dialog:allow-save"` to
`permissions`, directly after `"dialog:allow-open"`. Without it the native save
dialog is denied at runtime and the button fails exactly the way #435 describes
— which is the failure this whole task exists to end.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/lib/userFile.test.ts`
Expected: PASS, 5 tests.

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
printf '%s\n' 'feat(files): one native save and open path for every export' '' 'Why: a webview is not a browser -- <a download> and <input type=file> are' 'browser affordances this app had no reason to use, and the first of them is' 'silently ignored by WebKitGTK (#435). Every save returns the path so a' 'surface can name the file instead of guessing at a downloads folder.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/lib/userFile.ts src/lib/userFile.test.ts src/lib/tauri.ts src-tauri/capabilities/default.json src/test/dialogMock.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 3: Move theme + settings export onto the native path

**Files:**
- Create: `src/features/settings/themeFiles.ts`
- Create: `src/features/settings/themeFiles.test.ts`
- Modify: `src/features/settings/useSettingsStore.ts` (delete `downloadTheme` and `downloadSettings` — both the interface declarations near lines 1027-1040 and the implementations near lines 1843 and 1904)
- Modify: `src/features/settings/pages/appearance.tsx` (export/import buttons, drop the `<input type="file">`)
- Modify: `src/features/settings/pages/backup.tsx` (export/import buttons, drop the `<input type="file">`)
- Modify: `src/features/settings/useSettingsStore.export.test.ts` (the `downloadSettings` describe block near line 689)
- Modify: `src/screens/Settings.export.test.tsx` (the file-input import test near line 256, and the `file.text()`→`FileReader` bridge at the top of the file if nothing else needs it)

**Interfaces:**
- Consumes: `saveTextFile`, `openTextFile`, `THEME_FILE_FILTERS`,
  `SETTINGS_FILE_FILTERS` from Task 2; `exportTheme(id)`, `exportSettings(opts)`,
  `importThemeJson(json)`, `importSettings(json)` from the settings store
  (all unchanged, all still pure).
- Produces:
  - `themeFileName(name: string): string` — the slug plus `.pgtheme.json`
  - `exportThemeToFile(id: string): Promise<string | null>`
  - `exportThemeDraftToFile(draft: { name: string; mode: "dark" | "light"; colors: ThemeColors }): Promise<string | null>`
  - `importThemeFromFile(): Promise<ThemeDef | null>`
  - `exportSettingsToFile(opts?: SettingsExportOptions): Promise<string | null>`
  - `importSettingsFromFile(): Promise<SettingsImportReport | null>`

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/themeFiles.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { mockDialogOpen, mockDialogSave, lastDialogSaveOptions } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { useSettingsStore } from "./useSettingsStore";
import {
  exportThemeToFile,
  importThemeFromFile,
  themeFileName,
} from "./themeFiles";

describe("themeFileName", () => {
  it("slugs the theme name and keeps the double extension", () => {
    expect(themeFileName("My Cool Theme")).toBe("my-cool-theme.pgtheme.json");
  });

  it("collapses punctuation and trims the edges", () => {
    expect(themeFileName("  Dark · Cool!!  ")).toBe("dark-cool.pgtheme.json");
  });

  it("falls back to a usable name when the slug empties out", () => {
    expect(themeFileName("···")).toBe("theme.pgtheme.json");
  });
});

describe("exportThemeToFile", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("offers the slugged filename and writes the exported JSON", async () => {
    mockDialogSave("/home/you/dark-cool.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);

    const path = await exportThemeToFile("dark-cool");

    expect(path).toBe("/home/you/dark-cool.pgtheme.json");
    expect(lastDialogSaveOptions()).toMatchObject({
      defaultPath: "dark-cool.pgtheme.json",
    });
    const call = invokeCalls().find((c) => c.cmd === "write_user_file");
    const written = JSON.parse((call?.args as { contents: string }).contents);
    expect(written.name).toBe("Dark · Cool");
    expect(written.colors.accent).toBe("#5aa8e8");
  });

  it("returns null and writes nothing when the user cancels", async () => {
    mockDialogSave(null);
    expect(await exportThemeToFile("dark-cool")).toBeNull();
    expect(invokeCalls().some((c) => c.cmd === "write_user_file")).toBe(false);
  });
});

describe("importThemeFromFile", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("adds the theme in the file to the store and returns it", async () => {
    mockDialogOpen("/home/you/from-disk.pgtheme.json");
    mockInvoke("read_user_file", () =>
      JSON.stringify({
        version: 1,
        name: "From disk",
        mode: "dark",
        colors: { ...useSettingsStore.getState().getActiveTheme().colors },
      }),
    );

    const theme = await importThemeFromFile();

    expect(theme?.name).toBe("From disk");
    expect(
      useSettingsStore.getState().customThemes.some((t) => t.name === "From disk"),
    ).toBe(true);
  });

  it("returns null when the user cancels, leaving the store alone", async () => {
    mockDialogOpen(null);
    expect(await importThemeFromFile()).toBeNull();
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/themeFiles.test.ts`
Expected: FAIL — cannot resolve `./themeFiles`.

- [ ] **Step 3: Write the implementation**

Create `src/features/settings/themeFiles.ts`:

```ts
import {
  SETTINGS_FILE_FILTERS,
  THEME_FILE_FILTERS,
  openTextFile,
  saveTextFile,
} from "@/lib/userFile";

import {
  useSettingsStore,
  type SettingsExportOptions,
  type SettingsImportReport,
  type ThemeColors,
  type ThemeDef,
} from "./useSettingsStore";

/**
 * The side-effecting half of theme and settings export (#435).
 *
 * The store keeps the PURE serialisers — `exportTheme`, `exportSettings` — and
 * this module owns the dialogs and the bytes. Same split `features/report/`
 * makes between `report.ts` and `fileReport.ts`, and for the same reason: a
 * pure function is what the tests can assert on cheaply, and the file path is
 * what changes per platform.
 *
 * `downloadTheme` and `downloadSettings` used to live on the store and wrote
 * their file with an `<a download>` click that WebKitGTK ignores. They are
 * REMOVED rather than kept as aliases: a working export and a broken one under
 * two names is worse than either.
 */

/** `My Cool Theme` → `my-cool-theme.pgtheme.json`. */
export function themeFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "theme"}.pgtheme.json`;
}

/** Export a saved theme. Resolves to the path written, or `null` on cancel. */
export async function exportThemeToFile(id: string): Promise<string | null> {
  const store = useSettingsStore.getState();
  const contents = store.exportTheme(id);
  const theme = [...store.customThemes, ...BUILTIN_LOOKUP()].find((t) => t.id === id);
  return saveTextFile({
    defaultName: themeFileName(theme?.name ?? "theme"),
    contents,
    filters: THEME_FILE_FILTERS,
  });
}

/**
 * Export the editor's UNSAVED draft — the round trip through an external editor
 * that #435's reporter was trying to make.
 */
export async function exportThemeDraftToFile(draft: {
  name: string;
  mode: "dark" | "light";
  colors: ThemeColors;
}): Promise<string | null> {
  const contents = JSON.stringify(
    {
      $schema: "https://platypusgit.dev/theme.schema.json",
      version: 1,
      name: draft.name,
      mode: draft.mode,
      colors: draft.colors,
    },
    null,
    2,
  );
  return saveTextFile({
    defaultName: themeFileName(draft.name),
    contents,
    filters: THEME_FILE_FILTERS,
  });
}

/** Import a theme file into the store. `null` on cancel; throws on bad JSON. */
export async function importThemeFromFile(): Promise<ThemeDef | null> {
  const picked = await openTextFile({ filters: THEME_FILE_FILTERS });
  if (!picked) return null;
  return useSettingsStore.getState().importThemeJson(picked.contents);
}

/** Export the whole settings bundle. `null` on cancel. */
export async function exportSettingsToFile(
  opts?: SettingsExportOptions,
): Promise<string | null> {
  const contents = useSettingsStore.getState().exportSettings(opts);
  const stamp = new Date().toISOString().slice(0, 10);
  return saveTextFile({
    defaultName: `platypusgit-settings-${stamp}.json`,
    contents,
    filters: SETTINGS_FILE_FILTERS,
  });
}

/** Import a settings bundle. `null` on cancel; throws with a readable message. */
export async function importSettingsFromFile(): Promise<SettingsImportReport | null> {
  const picked = await openTextFile({ filters: SETTINGS_FILE_FILTERS });
  if (!picked) return null;
  return useSettingsStore.getState().importSettings(picked.contents);
}
```

Replace the `BUILTIN_LOOKUP()` placeholder with the real lookup: import
`BUILTIN_THEMES` from `./useSettingsStore` and write

```ts
  const theme = [...BUILTIN_THEMES, ...store.customThemes].find((t) => t.id === id);
```

(There is no exported `findTheme` — it is module-private in the store. Do not
export it just for this; the two-array spread is the same thing the Appearance
page already does to build its options.)

- [ ] **Step 4: Delete the broken store methods**

In `src/features/settings/useSettingsStore.ts`:
- Remove `downloadTheme: (id: string) => void;` from the interface.
- Remove `downloadSettings: (opts?: SettingsExportOptions) => string;` and its
  doc comment from the interface.
- Remove both implementations (`downloadTheme(id) { … }` and
  `downloadSettings(opts) { … }`) — every line, including the `Blob`,
  `createObjectURL`, `a.download` and `revokeObjectURL` calls.

Keep `exportTheme` and `exportSettings` exactly as they are.

- [ ] **Step 5: Rewire the Appearance page's export/import**

In `src/features/settings/pages/appearance.tsx`:
- Delete `fileInputRef`, `onImportClick`, `onImportFile` and the
  `<input ref={fileInputRef} type="file" … />` element.
- Import `{ exportThemeToFile, importThemeFromFile } from "@/features/settings/themeFiles"`.
- Replace the two button handlers:

```tsx
        <PGButton
          size="sm"
          variant="default"
          icon="download"
          onClick={() => {
            void (async () => {
              try {
                const path = await exportThemeToFile(active.id);
                if (path) pgFlash(`Exported to ${path}`);
              } catch (err) {
                pgFlash(`Export failed: ${appErrorMessage(err)}`);
              }
            })();
          }}
          title="Write this theme to a .pgtheme.json file"
        >
          Export…
        </PGButton>
        <PGButton
          size="sm"
          variant="default"
          icon="upload"
          onClick={() => {
            void (async () => {
              try {
                const theme = await importThemeFromFile();
                if (theme) pgFlash(`Imported “${theme.name}”`);
              } catch (err) {
                pgFlash(`Import failed: ${appErrorMessage(err)}`);
              }
            })();
          }}
          title="Read a .pgtheme.json file"
        >
          Import…
        </PGButton>
```

`Export` gains an ellipsis because it now opens a dialog, which is what an
ellipsis means everywhere else in this app.

- [ ] **Step 6: Rewire the Backup page's export/import**

In `src/features/settings/pages/backup.tsx`:
- Delete `fileInputRef`, the `onImportFile` handler's file-reading half and the
  `<input … data-testid="settings-import-input" type="file" />` element.
- Import `{ exportSettingsToFile, importSettingsFromFile } from "@/features/settings/themeFiles"`.
- `onExport` becomes async and records the **path** rather than a bare filename;
  the hint's copy changes from "Saved `<name>` to your downloads folder." to
  "Saved to `<path>`." — the old sentence was a guess about a folder the app
  never chose, and now it knows.
- `Import settings…`'s handler calls `importSettingsFromFile()`, keeps the
  existing `report` / `failure` state exactly as it is, and does nothing at all
  when the result is `null` (cancelled).

Keep every `data-testid` that survives (`settings-import-error`), and keep the
`ImportReport` rendering untouched.

- [ ] **Step 7: Update the tests that drove the deleted code**

- `src/features/settings/useSettingsStore.export.test.ts`: delete the
  `describe("downloadSettings", …)` block. The pure `exportSettings` tests above
  it stay — they are the ones that matter, and Task 3's own test file covers the
  file path.
- `src/screens/Settings.export.test.tsx`: the import test drove
  `fireEvent.change` on the hidden input. Rewrite it to drive the button:
  `mockDialogOpen("/tmp/settings.json")`, `mockInvoke("read_user_file", () => json)`,
  click `Import settings…`, then assert the same report text it asserted before.
  If the `file.text()`→`FileReader` bridge at the top of the file has no
  remaining user, delete it — jsdom's missing `Blob.text` stops being this
  suite's problem once no surface reads a `File`.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings src/screens/Settings.export.test.tsx src/lib/userFile.test.ts`
Expected: PASS. Every reference to `downloadTheme`/`downloadSettings` is gone.

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
printf '%s\n' 'fix(settings): export themes and settings through a native save dialog' '' 'Fixes #435.' '' 'Why: downloadTheme and downloadSettings wrote their file with an <a download>' 'click that WebKitGTK ignores, so on Linux both buttons did nothing. They are' 'removed rather than aliased -- a working export and a broken one under two' 'names is worse than either -- and the surfaces now name the path they wrote.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add -A src/features/settings src/screens/Settings.export.test.tsx
git commit -F /tmp/pg-msg.txt
```

---

### Task 4: The guard test

**Files:**
- Create: `test/fileSave.test.ts`

**Interfaces:**
- Consumes: nothing at runtime — it reads the tree from disk, like
  `test/privacy.test.ts`.
- Produces: a build failure for a reintroduced browser download or file input.

- [ ] **Step 1: Write the test**

Create `test/fileSave.test.ts`. It runs in the `docs` vitest project (node env,
`test/**/*.test.ts`), so it may use `node:fs` freely:

```ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One file save/open path (#435).
 *
 * Theme and settings export used to write its file with a `Blob`, an
 * `<a download>` and a synthetic click; import used a hidden
 * `<input type="file">`. WebKitGTK ignores the download attribute, so on Linux
 * every export button did nothing — silently, which is why the bug survived a
 * release. Both are browser affordances in an app that has native dialogs.
 *
 * So this is a guard in the same family as the `Command::new` and native
 * `<select>` guards: the rule is only as good as the test that fails the build
 * for breaking it.
 */

const SRC = join(process.cwd(), "src");

/** Every shipped `.ts`/`.tsx` under `src/`, tests and mocks excluded. */
function shippedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      // `src/test/` is the unit suite's own harness, not shipped code.
      if (entry === "test") continue;
      shippedFiles(path, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(path);
  }
  return out;
}

const FORBIDDEN: { pattern: RegExp; what: string }[] = [
  {
    pattern: /URL\.createObjectURL/,
    what: "a blob URL for a download — WebKitGTK ignores <a download>",
  },
  {
    pattern: /\.download\s*=/,
    what: "an <a download> assignment — use saveTextFile from @/lib/userFile",
  },
  {
    pattern: /type=["']file["']/,
    what: "an <input type=\"file\"> — use openTextFile from @/lib/userFile",
  },
];

describe("one file save/open path", () => {
  const files = shippedFiles(SRC);

  it("finds shipped source to check", () => {
    // A traversal bug that returns [] would make every assertion below pass
    // while asserting nothing.
    expect(files.length).toBeGreaterThan(100);
  });

  for (const { pattern, what } of FORBIDDEN) {
    it(`no shipped file under src/ uses ${what}`, () => {
      const offenders = files.filter((f) => pattern.test(readFileSync(f, "utf8")));
      expect(
        offenders.map((f) => f.slice(process.cwd().length + 1)),
        `Use src/lib/userFile.ts (saveTextFile / openTextFile) instead. See docs/dev/frontend.md.`,
      ).toEqual([]);
    });
  }

  it("lib/userFile.ts is the only module importing the dialog plugin for file bytes", () => {
    const importers = files.filter((f) => {
      const body = readFileSync(f, "utf8");
      return /from ["']@tauri-apps\/plugin-dialog["']/.test(body) && /\bsave\b/.test(body);
    });
    expect(importers.map((f) => f.slice(process.cwd().length + 1))).toEqual([
      "src/lib/userFile.ts",
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it passes on the current tree**

Run: `~/Library/pnpm/pnpm vitest run --project docs test/fileSave.test.ts`
Expected: PASS. If it fails, a caller was missed in Task 3 — fix the caller, not
the test.

- [ ] **Step 3: Plant a violation and confirm the guard catches it**

A passing guard test proves nothing until you have watched it fail. **Commit
Task 4 first** (next step) so `git checkout --` cannot eat uncommitted work,
then:

```bash
printf '%s\n' 'const a = document.createElement("a"); a.download = "x.json";' >> src/lib/revealWindow.tsx
~/Library/pnpm/pnpm vitest run --project docs test/fileSave.test.ts
```

Expected: FAIL, naming `src/lib/revealWindow.tsx`. Then restore:

```bash
git checkout -- src/lib/revealWindow.tsx
```

Re-run to confirm green, and note in the commit trailer or the PR body which
assertion caught it.

- [ ] **Step 4: Commit**

```bash
printf '%s\n' 'test(files): fail the build for a browser download or file input' '' 'Why: the rule is only as good as the test. #435 survived a release because' 'the broken export failed silently, and the same anchor-click pattern is the' 'obvious thing to reach for again. Planted a download assignment to confirm' 'the guard names the offending file.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add test/fileSave.test.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 5: Extract `themeVars` from `applyTheme`

**Files:**
- Modify: `src/features/settings/useSettingsStore.ts` (`applyTheme`, around lines 488-530)
- Create: `src/features/settings/theme/themeVars.test.ts`

**Interfaces:**
- Consumes: `ThemeDef`, `ThemeColors`, `SEMANTIC_TOKENS`, `SELECTION_TOKENS`,
  `SYNTAX_TOKENS`, `LOGO_PRIMARY`, `LOGO_SECONDARY` — all already in the store
  module.
- Produces: `themeVars(theme: ThemeDef): Record<string, string>`, exported from
  `useSettingsStore.ts`. `applyTheme(theme: ThemeDef): void` keeps its exact
  signature and behaviour.

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/themeVars.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  BUILTIN_THEMES,
  THEME_COLOR_FIELDS,
  applyTheme,
  themeVars,
} from "@/features/settings/useSettingsStore";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

describe("themeVars", () => {
  it("carries every editable colour slot", () => {
    const vars = themeVars(dark);
    const values = new Set(Object.values(vars));
    for (const field of THEME_COLOR_FIELDS) {
      expect(
        values.has(dark.colors[field.key]!),
        `no CSS var carries ${field.key}`,
      ).toBe(true);
    }
  });

  it("maps the slots onto the vars the app actually reads", () => {
    const vars = themeVars(dark);
    expect(vars["--bg-0"]).toBe(dark.colors.bg0);
    expect(vars["--bg-titlebar"]).toBe(dark.colors.titlebar);
    expect(vars["--fg-0"]).toBe(dark.colors.fg0);
    expect(vars["--border-1"]).toBe(dark.colors.border1);
    expect(vars["--accent"]).toBe(dark.colors.accent);
    expect(vars["--accent-ink"]).toBe(dark.colors.accentInk);
  });

  it("calibrates the semantic tokens per MODE, not per theme", () => {
    expect(themeVars(dark)["--git-added"]).not.toBe(themeVars(light)["--git-added"]);
    const otherDark = BUILTIN_THEMES.find((t) => t.id === "dark-warm")!;
    expect(themeVars(otherDark)["--git-added"]).toBe(themeVars(dark)["--git-added"]);
  });

  it("fills the logo slots for a theme persisted before they existed", () => {
    const legacy = {
      ...dark,
      colors: { ...dark.colors, logo: undefined, logo2: undefined },
    } as typeof dark;
    const vars = themeVars(legacy);
    expect(vars["--logo"]).toBeTruthy();
    expect(vars["--logo-2"]).toBeTruthy();
  });

  it("is exactly what applyTheme writes to :root", () => {
    // The whole point of the extraction: a preview painted from this map and
    // the live app painted by applyTheme cannot drift, because there is one
    // map. If someone adds a setProperty call to applyTheme without adding it
    // here, this fails.
    document.documentElement.style.cssText = "";
    applyTheme(light);
    const root = document.documentElement.style;
    const vars = themeVars(light);
    expect(Object.keys(vars).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(vars)) {
      expect(root.getPropertyValue(name), `applyTheme did not write ${name}`).toBe(value);
    }
    expect(root.length).toBe(Object.keys(vars).length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/themeVars.test.ts`
Expected: FAIL — `themeVars` is not exported.

- [ ] **Step 3: Write the implementation**

Replace the body of `applyTheme` in `useSettingsStore.ts` with a map builder
plus a writer. Keep `applyTheme`'s doc comment and add one for `themeVars`:

```ts
/**
 * Every CSS var a theme sets, as a plain map.
 *
 * Extracted out of `applyTheme` so a theme can be painted somewhere OTHER than
 * `:root` — a gallery card, the editor's preview pane — without a second copy
 * of the slot-to-var mapping. `themeVars.test.ts` asserts this map is exactly
 * what `applyTheme` writes, so the two cannot drift: a new colour slot or a new
 * derived token lands here and every surface gets it.
 */
export function themeVars(theme: ThemeDef): Record<string, string> {
  const c = theme.colors;
  // Mode-calibrated semantics + accent-derived selection tints. Written on
  // every apply (not only on a mode change) so switching dark → light → dark
  // can't leave a stale calibration behind.
  const mode = theme.mode === "light" ? "light" : "dark";
  return {
    "--bg-0": c.bg0,
    "--bg-1": c.bg1,
    "--bg-2": c.bg2,
    "--bg-3": c.bg3,
    "--bg-4": c.bg4,
    "--bg-titlebar": c.titlebar,
    "--fg-0": c.fg0,
    "--fg-1": c.fg1,
    "--fg-2": c.fg2,
    "--fg-3": c.fg3,
    "--fg-4": c.fg4,
    "--border-0": c.border0,
    "--border-1": c.border1,
    "--border-2": c.border2,
    "--accent": c.accent,
    "--accent-ink": c.accentInk,
    // logo colors fall back to the brand palette for themes persisted before
    // the logo slots existed.
    "--logo": c.logo ?? LOGO_PRIMARY,
    "--logo-2": c.logo2 ?? LOGO_SECONDARY,
    "--ring": `0 0 0 2px ${c.accent}80`,
    ...SEMANTIC_TOKENS[mode],
    ...SELECTION_TOKENS[mode],
    ...SYNTAX_TOKENS[mode],
  };
}

/** Apply theme by writing every CSS var it sets to `:root`. */
export function applyTheme(theme: ThemeDef) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVars(theme))) {
    root.style.setProperty(name, value);
  }
}
```

**Before deleting the old body, diff it against the map.** Read the current
`applyTheme` line by line and confirm every `setProperty` call it makes has a
key above — including anything written after the `SYNTAX_TOKENS` loop that this
plan's excerpt did not show. The final assertion in Step 1 will catch an
omission, but only if you have not also dropped the var from the map.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/themeVars.test.ts src/features/settings`
Expected: PASS, including the existing `themePreference.test.ts` and
`theme.semantics.test.ts` — those two are what prove `applyTheme` still behaves.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'refactor(theme): make a theme paintable somewhere other than :root' '' 'Why: nothing could render a theme except the active one, which is why there' 'has never been a preview or a swatch anywhere. themeVars is the map and' 'applyTheme is one writer of it; a test pins the two together so a gallery' 'card and the live app cannot drift.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings/useSettingsStore.ts src/features/settings/theme/themeVars.test.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 6: Contrast maths

**Files:**
- Create: `src/features/settings/theme/contrast.ts`
- Create: `src/features/settings/theme/contrast.test.ts`

**Interfaces:**
- Consumes: `ThemeColors` from `useSettingsStore`; `normalizeHex` from
  `./ColorEditor`.
- Produces:
  - `contrastRatio(a: string, b: string): number`
  - `type ContrastLevel = "ok" | "low" | "bad"`
  - `type ContrastFinding = { a: keyof ThemeColors; b: keyof ThemeColors; what: string; ratio: number; level: ContrastLevel }`
  - `contrastReport(colors: ThemeColors): ContrastFinding[]` — only findings
    below `ok`, worst first
  - `CONTRAST_PAIRS: { a: keyof ThemeColors; b: keyof ThemeColors; what: string }[]`

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/contrast.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "@/features/settings/useSettingsStore";
import { contrastRatio, contrastReport } from "./contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("is 1 for a colour on itself", () => {
    expect(contrastRatio("#5aa8e8", "#5aa8e8")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1a1d24", "#eef1f5")).toBeCloseTo(
      contrastRatio("#eef1f5", "#1a1d24"),
      5,
    );
  });

  it("matches a known WCAG value", () => {
    // #767676 on white is the canonical 4.54:1 boundary case from the WCAG
    // techniques — if the luminance curve is wrong, this is what shows it.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("accepts short hex and a missing hash", () => {
    expect(contrastRatio("000", "fff")).toBeCloseTo(21, 1);
  });
});

describe("contrastReport", () => {
  it("finds nothing to warn about in the built-in themes", () => {
    // A built-in theme that trips our own warning would mean the thresholds are
    // miscalibrated, not that the theme is bad.
    for (const theme of BUILTIN_THEMES) {
      expect(
        contrastReport(theme.colors).filter((f) => f.level === "bad"),
        `${theme.name} trips a hard contrast warning`,
      ).toEqual([]);
    }
  });

  it("reports primary text that cannot be read on the canvas", () => {
    const base = BUILTIN_THEMES[0].colors;
    const report = contrastReport({ ...base, fg0: base.bg0 });
    const finding = report.find((f) => f.a === "fg0" && f.b === "bg0");
    expect(finding?.level).toBe("bad");
    expect(finding?.ratio).toBeCloseTo(1, 3);
  });

  it("reports unreadable ink on the accent", () => {
    const base = BUILTIN_THEMES[0].colors;
    const report = contrastReport({ ...base, accentInk: base.accent });
    expect(report.some((f) => f.a === "accentInk" && f.b === "accent")).toBe(true);
  });

  it("sorts the worst finding first", () => {
    const base = BUILTIN_THEMES[0].colors;
    const report = contrastReport({
      ...base,
      fg0: base.bg0,          // ratio 1 — the worst
      fg2: base.fg1,          // merely low
    });
    expect(report.length).toBeGreaterThan(1);
    expect(report[0].ratio).toBeLessThanOrEqual(report[1].ratio);
  });

  it("says nothing about a pair it cannot parse", () => {
    const base = BUILTIN_THEMES[0].colors;
    expect(() => contrastReport({ ...base, fg0: "not-a-colour" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/contrast.test.ts`
Expected: FAIL — cannot resolve `./contrast`.

- [ ] **Step 3: Write the implementation**

Create `src/features/settings/theme/contrast.ts`:

```ts
import type { ThemeColors } from "@/features/settings/useSettingsStore";

import { normalizeHex } from "./ColorEditor";

/**
 * WCAG contrast, for the four pairs that decide whether the app is readable.
 *
 * The editor let you build a theme with white text on white and said nothing.
 * That is the worst thing about it: a colour picker with no feedback is a
 * colour picker that lets you break your own app and then wonder why. So the
 * editor warns — and only warns. A deliberately low-contrast theme is the
 * user's call, Save is never disabled by a finding, and nothing here refuses a
 * colour.
 */

/** sRGB channel → linear, per WCAG 2.x relative luminance. */
function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number | null {
  const norm = normalizeHex(hex);
  if (!norm) return null;
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Contrast ratio between two hex colours, 1 to 21. Returns `NaN` when either
 * side cannot be parsed — a half-typed hex is not a finding.
 */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  if (la === null || lb === null) return NaN;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export type ContrastLevel = "ok" | "low" | "bad";

export type ContrastFinding = {
  a: keyof ThemeColors;
  b: keyof ThemeColors;
  /** User-facing prose. A user never reads a colour-slot key. */
  what: string;
  ratio: number;
  level: ContrastLevel;
};

/**
 * The pairs worth checking. Not every combination — a report with twenty
 * findings is a report nobody reads. These four are the ones that make the app
 * unusable when they fail.
 */
export const CONTRAST_PAIRS: { a: keyof ThemeColors; b: keyof ThemeColors; what: string }[] = [
  { a: "fg0", b: "bg0", what: "Primary text on the app canvas" },
  { a: "fg1", b: "bg1", what: "Secondary text on a panel" },
  { a: "fg2", b: "bg1", what: "Muted text on a panel" },
  { a: "accentInk", b: "accent", what: "Button text on the accent" },
];

/** WCAG AA for body text. Below this, warn. */
const AA_TEXT = 4.5;
/** WCAG AA for large text / UI. Below this, warn harder. */
const AA_LARGE = 3;

function level(ratio: number): ContrastLevel {
  if (ratio < AA_LARGE) return "bad";
  if (ratio < AA_TEXT) return "low";
  return "ok";
}

/** Every pair that falls short, worst first. Empty when the theme is fine. */
export function contrastReport(colors: ThemeColors): ContrastFinding[] {
  return CONTRAST_PAIRS.map(({ a, b, what }) => {
    const ratio = contrastRatio(colors[a] ?? "", colors[b] ?? "");
    return { a, b, what, ratio, level: level(ratio) };
  })
    .filter((f) => Number.isFinite(f.ratio) && f.level !== "ok")
    .sort((x, y) => x.ratio - y.ratio);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/contrast.test.ts`
Expected: PASS, 11 tests.

If the "built-in themes trip nothing" case fails, **do not loosen the
thresholds to make it pass** — read which pair fails in which theme and report
it. A built-in theme below 3:1 on primary text is a real bug in that theme, and
the finding is worth surfacing separately.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(theme): measure the contrast pairs that decide readability' '' 'Why: the editor let you put white text on a white canvas and said nothing.' 'Four pairs, advisory only -- a low-contrast theme stays the user choice and' 'Save is never disabled by a finding.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings/theme/contrast.ts src/features/settings/theme/contrast.test.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 7: `deriveTheme` — the guided start's engine

**Files:**
- Create: `src/features/settings/theme/deriveTheme.ts`
- Create: `src/features/settings/theme/deriveTheme.test.ts`

**Interfaces:**
- Consumes: `ThemeDef`, `ThemeColors` from `useSettingsStore`; `normalizeHex`
  from `./ColorEditor`; `contrastRatio` from `./contrast`.
- Produces: `deriveTheme(base: ThemeDef, accent: string): ThemeColors`

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/deriveTheme.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES, THEME_COLOR_FIELDS } from "@/features/settings/useSettingsStore";
import { contrastRatio } from "./contrast";
import { deriveTheme } from "./deriveTheme";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

describe("deriveTheme", () => {
  it("puts the chosen accent in the accent slot", () => {
    expect(deriveTheme(dark, "#ff8800").accent).toBe("#ff8800");
  });

  it("leaves every other slot alone", () => {
    const derived = deriveTheme(dark, "#ff8800");
    for (const field of THEME_COLOR_FIELDS) {
      if (field.key === "accent" || field.key === "accentInk") continue;
      expect(derived[field.key], `${field.key} should be untouched`).toBe(
        dark.colors[field.key],
      );
    }
  });

  it("picks an ink that can actually be read on the accent", () => {
    for (const accent of ["#ffee00", "#0b1020", "#5aa8e8", "#7a7a7a"]) {
      const derived = deriveTheme(dark, accent);
      expect(
        contrastRatio(derived.accentInk, derived.accent),
        `unreadable ink on ${accent}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("flips the ink across the light/dark crossover", () => {
    const onPale = deriveTheme(dark, "#ffee00").accentInk;
    const onDeep = deriveTheme(dark, "#101830").accentInk;
    expect(onPale).not.toBe(onDeep);
    // Pale accent takes the dark ink, deep accent takes the light one.
    expect(contrastRatio(onPale, "#ffee00")).toBeGreaterThan(
      contrastRatio(onDeep, "#ffee00"),
    );
  });

  it("works from a light base too", () => {
    const derived = deriveTheme(light, "#8844cc");
    expect(derived.accent).toBe("#8844cc");
    expect(derived.bg0).toBe(light.colors.bg0);
    expect(contrastRatio(derived.accentInk, derived.accent)).toBeGreaterThanOrEqual(3);
  });

  it("normalizes a short hex and a missing hash", () => {
    expect(deriveTheme(dark, "f80").accent).toBe("#ff8800");
  });

  it("keeps the base accent when the input cannot be parsed", () => {
    expect(deriveTheme(dark, "nonsense").accent).toBe(dark.colors.accent);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/deriveTheme.test.ts`
Expected: FAIL — cannot resolve `./deriveTheme`.

- [ ] **Step 3: Write the implementation**

Create `src/features/settings/theme/deriveTheme.ts`:

```ts
import type { ThemeColors, ThemeDef } from "@/features/settings/useSettingsStore";

import { normalizeHex } from "./ColorEditor";
import { contrastRatio } from "./contrast";

/**
 * The guided start: a base theme plus an accent.
 *
 * Deliberately not a palette generator. Forking a built-in theme and then
 * hunting for the one slot that makes a button look right is the current
 * two-minute task; swapping the accent and fixing the ink is the two-click
 * version of it. Hue-shifting the greys as well would produce palettes the
 * user can neither predict nor correct, and every one of the 18 slots stays
 * editable underneath — so cleverness here buys nothing and costs
 * predictability.
 *
 * `accentInk` is the one slot that CANNOT be left to the user: it is the text
 * drawn on the accent, so a bright accent with the base's dark ink is fine and
 * a bright accent with the base's light ink is an unreadable button. Pick
 * whichever of the base's own extremes reads better.
 */
export function deriveTheme(base: ThemeDef, accent: string): ThemeColors {
  const norm = normalizeHex(accent);
  if (!norm) return { ...base.colors };

  // The base's own lightest and darkest inks, so a derived theme stays in its
  // family instead of jumping to pure black or pure white.
  const lightInk = base.colors.fg0;
  const darkInk = base.colors.bg0;
  const accentInk =
    contrastRatio(lightInk, norm) >= contrastRatio(darkInk, norm) ? lightInk : darkInk;

  return { ...base.colors, accent: norm, accentInk };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/deriveTheme.test.ts`
Expected: PASS, 7 tests.

If "picks an ink that can actually be read" fails for a mid-grey accent
(`#7a7a7a` is the case that bites), the base's own extremes are not far enough
apart. Fall back to pure `#000000`/`#ffffff` for that case only — pick the base
extreme when it clears 4.5:1, else the pure extreme — and add a test naming the
accent that forced it.

- [ ] **Step 5: Commit**

```bash
printf '%s\n' 'feat(theme): derive a theme from a base and an accent' '' 'Why: forking a built-in and hunting for the slot that fixes a button is the' 'current two-minute task. Not a palette generator on purpose -- shifting the' 'greys too would produce palettes nobody can predict, and all 18 slots stay' 'editable underneath.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings/theme/deriveTheme.ts src/features/settings/theme/deriveTheme.test.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 8: `ThemePreview` — one renderer for cards and the editor

**Files:**
- Create: `src/features/settings/theme/ThemePreview.tsx`
- Create: `src/features/settings/theme/ThemePreview.test.tsx`

**Interfaces:**
- Consumes: `themeVars` (Task 5), `ThemeDef` / `ThemeColors`, `PGIcon` from
  `@/design`.
- Produces:
  `ThemePreview(props: { theme: { name?: string; mode: "dark" | "light"; colors: ThemeColors }; size: "card" | "pane"; title?: string }): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/ThemePreview.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "@/features/settings/useSettingsStore";
import { ThemePreview } from "./ThemePreview";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

describe("ThemePreview", () => {
  it("paints from the theme it was handed, not from :root", () => {
    // The whole reason this component exists: a card on a dark page has to be
    // able to show a light theme. If it read :root vars it would show the page.
    document.documentElement.style.setProperty("--bg-0", "#ff00ff");
    const { container } = render(<ThemePreview theme={light} size="card" />);
    const root = container.querySelector("[data-testid='theme-preview']") as HTMLElement;
    expect(root.style.getPropertyValue("--bg-0")).toBe(light.colors.bg0);
    expect(root.style.getPropertyValue("--bg-0")).not.toBe("#ff00ff");
  });

  it("carries the mode-calibrated semantic tokens", () => {
    const { container } = render(<ThemePreview theme={dark} size="card" />);
    const root = container.querySelector("[data-testid='theme-preview']") as HTMLElement;
    expect(root.style.getPropertyValue("--git-added")).toBeTruthy();
    expect(root.style.getPropertyValue("--accent")).toBe(dark.colors.accent);
  });

  it("shows the surfaces a palette is actually judged on", () => {
    render(<ThemePreview theme={dark} size="pane" />);
    expect(screen.getByTestId("theme-preview-titlebar")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-history")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-diff")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-button")).toBeInTheDocument();
  });

  it("renders both sizes from one tree", () => {
    const card = render(<ThemePreview theme={dark} size="card" />);
    expect(card.getByTestId("theme-preview").dataset.size).toBe("card");
    card.unmount();
    const pane = render(<ThemePreview theme={dark} size="pane" />);
    expect(pane.getByTestId("theme-preview").dataset.size).toBe("pane");
  });

  it("survives a theme missing the logo slots", () => {
    const legacy = { ...dark, colors: { ...dark.colors, logo: undefined, logo2: undefined } };
    expect(() =>
      render(<ThemePreview theme={legacy as typeof dark} size="card" />),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/ThemePreview.test.tsx`
Expected: FAIL — cannot resolve `./ThemePreview`.

- [ ] **Step 3: Write the implementation**

Create `src/features/settings/theme/ThemePreview.tsx`. Requirements the test
pins, plus the ones only a human notices:

- The root element carries `data-testid="theme-preview"`,
  `data-size={size}`, and **every entry of `themeVars(theme)` as an inline
  custom property**. Set them with a `style` object — React passes unknown
  `--*` keys straight through, so
  `style={{ ...themeVars(theme) } as React.CSSProperties}` works.
- **Every colour inside comes from `var(--…)`**, never from `props.theme`
  directly. That is what makes the preview honest: it renders through the same
  vars the app does, one scope down.
- The tree, all of it inside the scoped root:
  - `data-testid="theme-preview-titlebar"` — `var(--bg-titlebar)`, the logo
    mark in `var(--logo)`/`var(--logo-2)`, a repo name in `var(--fg-1)`, and
    three window dots in `var(--fg-3)`.
  - `data-testid="theme-preview-sidebar"` — `var(--bg-1)` with a
    `var(--border-0)` right edge, three nav rows, one active in
    `var(--bg-4)` + `var(--accent)` left bar.
  - `data-testid="theme-preview-history"` — two commit rows on `var(--bg-0)`:
    subject in `var(--fg-0)`, meta in `var(--fg-2)`, a graph dot and edge in
    `var(--graph-1)`, and the selected row on `var(--bg-selection)`.
  - `data-testid="theme-preview-diff"` — a `var(--bg-1)` header, one added line
    (`var(--git-added-bg)` background, `var(--git-added)` marker) and one
    removed (`var(--git-removed-bg)` / `var(--git-removed)`), with line numbers
    in `var(--fg-3)` and code text in `var(--fg-1)`.
  - `data-testid="theme-preview-button"` — a primary button, `var(--accent)`
    background and `var(--accent-ink)` text. This is the pair the contrast
    warning is about, so it has to be visible.
- Two sizes, one tree: `size === "card"` uses 9px type, 3px gaps and
  `pointerEvents: "none"`; `size === "pane"` uses 11px type and 6px gaps and
  fills its container (`width: "100%"`, `minHeight: 240`). Scale with a single
  `const s = size === "card" ? { fs: 9, gap: 3, row: 14 } : { fs: 11, gap: 6, row: 20 };`
  rather than two copies of the markup.
- `overflow: "hidden"`, `borderRadius: "var(--r-3)"`, a `1px solid
  var(--border-1)` frame, and **no interactive elements** — it is a picture. Use
  `<div>`s, not `<button>`s, so it never takes focus inside a card that is
  itself a radio.
- Icons through `PGIcon` only, and only names already in the `IconName` union
  (`test/iconSet.test.ts` fails the build for a literal the union lacks). If you
  want a mark and are unsure of the name, use plain shaped `<div>`s instead —
  the preview needs no real icons.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/ThemePreview.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Look at it**

A preview nobody has looked at is a preview that is wrong. Take a screenshot
with the scratch-vite-entry + headless-Chrome route (see the memory note "See
real pixels without a window"): render a row of `ThemePreview size="card"` for
all nine built-ins plus one `size="pane"`, and check that a light theme and a
dark theme are each recognisable at card size. Fix what looks wrong before
committing.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' 'feat(theme): render any theme as a miniature of the real app' '' 'Why: a palette is judged on composed surfaces -- a history row, a diff hunk,' 'a button -- not on 18 swatches. Everything inside paints through var(--..)' 'one scope down, so the preview cannot disagree with the live app.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings/theme/ThemePreview.tsx src/features/settings/theme/ThemePreview.test.tsx
git commit -F /tmp/pg-msg.txt
```

---

### Task 9: The editor store

**Files:**
- Create: `src/features/settings/theme/useThemeEditorStore.ts`
- Create: `src/features/settings/theme/useThemeEditorStore.test.ts`
- Modify: `src/features/keymap/actions.ts` (`app.closeOverlay`, the chain around lines 301-355)
- Modify: `src/features/keymap/actions.test.ts` (one case for the new branch)

**Interfaces:**
- Consumes: `applyTheme`, `useSettingsStore`, `ThemeColors`, `ThemeDef` from the
  settings store; `deriveTheme` (Task 7).
- Produces:
  ```ts
  type ThemeEditorState = {
    /** null when the editor is closed. */
    open: null | { mode: "new" | "edit"; sourceTheme: ThemeDef };
    name: string;
    themeMode: "dark" | "light";
    colors: ThemeColors;
    /** The theme that was live when the editor opened, restored on close. */
    originalTheme: ThemeDef | null;
    baseId: string;
    openNew: (source: ThemeDef) => void;
    openEdit: (theme: ThemeDef) => void;
    /** Dismiss WITHOUT saving, restoring the original theme. */
    close: () => void;
    setName: (name: string) => void;
    setThemeMode: (mode: "dark" | "light") => void;
    patchColors: (patch: Partial<ThemeColors>) => void;
    setColors: (colors: ThemeColors) => void;
    /** Apply the guided start: base theme + accent. */
    applyBase: (baseId: string, accent?: string) => void;
    revert: () => void;
    /** Persist the draft and leave. Returns the saved theme. */
    save: () => ThemeDef | null;
  };
  export const useThemeEditorStore: UseBoundStore<StoreApi<ThemeEditorState>>;
  ```

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/useThemeEditorStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";

import { BUILTIN_THEMES, useSettingsStore } from "@/features/settings/useSettingsStore";
import { useThemeEditorStore } from "./useThemeEditorStore";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

function rootVar(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

describe("useThemeEditorStore", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useThemeEditorStore.getState().close();
  });

  it("opens a new draft seeded from the source theme, with a distinct name", () => {
    useThemeEditorStore.getState().openNew(dark);
    const s = useThemeEditorStore.getState();
    expect(s.open?.mode).toBe("new");
    expect(s.colors).toEqual(dark.colors);
    expect(s.themeMode).toBe("dark");
    expect(s.name).not.toBe(dark.name);
    expect(s.name).toContain(dark.name);
  });

  it("previews the draft on :root as it is edited", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().patchColors({ bg0: "#123456" });
    expect(rootVar("--bg-0")).toBe("#123456");
  });

  it("restores the theme that was live when it opened, on close", () => {
    useSettingsStore.getState().setActiveThemeId("light");
    const before = rootVar("--bg-0");
    useThemeEditorStore.getState().openNew(light);
    useThemeEditorStore.getState().patchColors({ bg0: "#123456" });
    expect(rootVar("--bg-0")).toBe("#123456");

    useThemeEditorStore.getState().close();

    expect(rootVar("--bg-0")).toBe(before);
    expect(useThemeEditorStore.getState().open).toBeNull();
  });

  it("saves a new theme, activates it, and leaves the editor", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().setName("My theme");
    useThemeEditorStore.getState().patchColors({ accent: "#ff8800" });

    const saved = useThemeEditorStore.getState().save();

    expect(saved?.name).toBe("My theme");
    expect(saved?.colors.accent).toBe("#ff8800");
    const store = useSettingsStore.getState();
    expect(store.customThemes.some((t) => t.id === saved!.id)).toBe(true);
    expect(store.getActiveTheme().id).toBe(saved!.id);
    expect(useThemeEditorStore.getState().open).toBeNull();
    // The saved theme stays on screen — close() must NOT restore over a save.
    expect(rootVar("--accent")).toBe("#ff8800");
  });

  it("refuses to save an empty name, staying open", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().setName("   ");
    expect(useThemeEditorStore.getState().save()).toBeNull();
    expect(useThemeEditorStore.getState().open).not.toBeNull();
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("edits an existing custom theme in place rather than adding one", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().setName("Mine");
    const created = useThemeEditorStore.getState().save()!;

    useThemeEditorStore.getState().openEdit(
      useSettingsStore.getState().customThemes.find((t) => t.id === created.id)!,
    );
    useThemeEditorStore.getState().patchColors({ accent: "#00ddaa" });
    useThemeEditorStore.getState().save();

    const customs = useSettingsStore.getState().customThemes;
    expect(customs).toHaveLength(1);
    expect(customs[0].colors.accent).toBe("#00ddaa");
  });

  it("applyBase swaps the whole palette and fixes the ink", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().applyBase("light", "#8844cc");
    const s = useThemeEditorStore.getState();
    expect(s.colors.bg0).toBe(light.colors.bg0);
    expect(s.colors.accent).toBe("#8844cc");
    expect(s.themeMode).toBe("light");
  });

  it("revert returns the draft to the source it opened from", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().patchColors({ bg0: "#123456" });
    useThemeEditorStore.getState().setThemeMode("light");
    useThemeEditorStore.getState().revert();
    const s = useThemeEditorStore.getState();
    expect(s.colors).toEqual(dark.colors);
    expect(s.themeMode).toBe("dark");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/useThemeEditorStore.test.ts`
Expected: FAIL — cannot resolve `./useThemeEditorStore`.

- [ ] **Step 3: Write the implementation**

Create `src/features/settings/theme/useThemeEditorStore.ts` as a Zustand store
matching the interface above. The load-bearing details:

- **`openNew(source)`** seeds `name` as `` `${source.name} (custom)` ``,
  `themeMode` and `colors` from `source`, `baseId` as `source.id`, and captures
  `originalTheme` from `useSettingsStore.getState().getActiveTheme()` — read it
  BEFORE anything is applied.
- **Every mutator re-applies** the draft: `applyTheme({ id: "__draft__", name,
  mode: themeMode, colors })`. That is what makes the live window follow the
  edit, and `"__draft__"` is the id the current dialog already uses.
- **`close()` restores** `originalTheme` via `applyTheme` and clears `open` and
  `originalTheme`. It must be a no-op when `open` is already null so
  `app.closeOverlay` can call it defensively.
- **`save()`** goes through the settings STORE, never `setState` alone:
  - `mode === "new"`: `saveAsNewTheme(trimmed)` to get an id, then patch that
    theme's `name`/`mode`/`colors` via `useSettingsStore.setState`, then
    `useSettingsStore.getState().setActiveThemeId(created.id)`. The
    `setActiveThemeId` call is not optional — the draft's dark/light toggle may
    have flipped the mode the duplicate inherited, and in "follow the system"
    mode that decides WHICH half of the pairing this theme is.
  - `mode === "edit"`: patch `customThemes` for `sourceTheme.id`, then
    `setActiveThemeId(sourceTheme.id)`.
  - Then clear `open` **without restoring** — the saved theme is what should
    stay on screen. Return the saved `ThemeDef`.
  - An empty trimmed name returns `null` and changes nothing. The dialog is what
    flashes the message; the store does not call `pgFlash` (keep it testable
    without the design system).
- **`applyBase(baseId, accent)`** looks the base up in
  `[...BUILTIN_THEMES, ...customThemes]`, sets `themeMode` to the base's mode,
  and sets `colors` to `deriveTheme(base, accent ?? base.colors.accent)`.
- **`revert()`** restores `name`/`themeMode`/`colors` from `open.sourceTheme`.

- [ ] **Step 4: Join the `app.closeOverlay` chain**

In `src/features/keymap/actions.ts`, import `useThemeEditorStore` and add a
branch **after** the `useReportStore` branch and **before** the
`useUpdateStore` one:

```ts
      // Same PGModal base layer as the dialogs above, same rule: it belongs in
      // THIS chain rather than registering its own handler, because a
      // registered handler runs BEFORE the default runner and would take
      // Escape ahead of the credential prompt. `close()` restores the theme
      // that was live when the editor opened — an Escape that only unmounted
      // the dialog would leave an abandoned draft painted on the app.
      if (useThemeEditorStore.getState().open) {
        useThemeEditorStore.getState().close();
        return true;
      }
```

- [ ] **Step 5: Test the chain's order**

Add to `src/features/keymap/actions.test.ts`, beside the existing
`app.closeOverlay` cases:

```ts
  it("app.closeOverlay closes the theme editor, but not before the credential prompt", () => {
    useThemeEditorStore.getState().openNew(BUILTIN_THEMES[0]);
    expect(ACTIONS["app.closeOverlay"].run?.()).toBe(true);
    expect(useThemeEditorStore.getState().open).toBeNull();
  });

  it("app.closeOverlay restores the pre-draft theme rather than only closing", () => {
    useSettingsStore.getState().setActiveThemeId("light");
    const before = document.documentElement.style.getPropertyValue("--bg-0");
    useThemeEditorStore.getState().openNew(BUILTIN_THEMES[0]);
    useThemeEditorStore.getState().patchColors({ bg0: "#123456" });
    ACTIONS["app.closeOverlay"].run?.();
    expect(document.documentElement.style.getPropertyValue("--bg-0")).toBe(before);
  });
```

Match the file's existing setup style for the credential-prompt precedence case
— read the `#212` test above it and mirror how it seeds `useAuthStore`, so the
ordering assertion is the same shape as its neighbour.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme src/features/keymap`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
printf '%s\n' 'feat(theme): move the editor draft into a store so Escape can reach it' '' 'Why: the dialog owned its own keydown listener, which design/modal.tsx names' 'as the anti-pattern #47 was fixed to avoid. closeOverlay reads stores, and' 'closing has to RESTORE the pre-draft theme -- an Escape that only unmounted' 'left the abandoned draft painted on the app.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings/theme/useThemeEditorStore.ts src/features/settings/theme/useThemeEditorStore.test.ts src/features/keymap/actions.ts src/features/keymap/actions.test.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 10: Rebuild the editor dialog

**Files:**
- Modify: `src/features/settings/theme/ThemeEditorDialog.tsx` (a rewrite)
- Modify: `src/features/settings/theme/ColorEditor.tsx` (contrast badge, collapsible groups)
- Create: `src/features/settings/theme/ThemeEditorDialog.test.tsx`

**Interfaces:**
- Consumes: `useThemeEditorStore` (Task 9), `ThemePreview` (Task 8),
  `contrastReport` (Task 6), `deriveTheme` (Task 7),
  `exportThemeDraftToFile` / `importThemeFromFile` (Task 3), `PGModal`,
  `PGButton`, `PGButtonGroup`, `PGInput`, `PGSelect`, `pgFlash`, `pgConfirm`
  from `@/design`.
- Produces: `ThemeEditorDialog()` — **no props**. It reads
  `useThemeEditorStore` for its open state, so the Appearance page mounts it
  unconditionally in Task 11.

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/ThemeEditorDialog.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockDialogSave, lastDialogSaveOptions } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { BUILTIN_THEMES, useSettingsStore } from "@/features/settings/useSettingsStore";
import { useThemeEditorStore } from "./useThemeEditorStore";
import { ThemeEditorDialog } from "./ThemeEditorDialog";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;

describe("ThemeEditorDialog", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useThemeEditorStore.getState().close();
  });

  it("renders nothing while the editor is closed", () => {
    const { container } = render(<ThemeEditorDialog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the draft's preview and repaints it on a colour change", () => {
    useThemeEditorStore.getState().openNew(dark);
    render(<ThemeEditorDialog />);
    const preview = () => screen.getByTestId("theme-preview");
    expect(preview().style.getPropertyValue("--bg-0")).toBe(dark.colors.bg0);

    useThemeEditorStore.getState().patchColors({ bg0: "#123456" });
    expect(preview().style.getPropertyValue("--bg-0")).toBe("#123456");
  });

  it("warns about unreadable text without disabling Save", () => {
    useThemeEditorStore.getState().openNew(dark);
    render(<ThemeEditorDialog />);
    useThemeEditorStore.getState().patchColors({ fg0: dark.colors.bg0 });

    expect(screen.getByTestId("theme-contrast-warnings")).toHaveTextContent(
      /primary text/i,
    );
    // Advisory, never blocking: a low-contrast theme is the user's call.
    expect(screen.getByRole("button", { name: /create theme/i })).toBeEnabled();
  });

  it("says nothing when every checked pair is fine", () => {
    useThemeEditorStore.getState().openNew(dark);
    render(<ThemeEditorDialog />);
    expect(screen.queryByTestId("theme-contrast-warnings")).not.toBeInTheDocument();
  });

  it("exports the unsaved draft to the file the user picked", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().setName("My theme");
    mockDialogSave("/home/you/my-theme.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);
    render(<ThemeEditorDialog />);

    fireEvent.click(screen.getByRole("button", { name: /export/i }));

    return Promise.resolve().then(() => {
      expect(lastDialogSaveOptions()).toMatchObject({
        defaultPath: "my-theme.pgtheme.json",
      });
      const call = invokeCalls().find((c) => c.cmd === "write_user_file");
      const written = JSON.parse((call?.args as { contents: string }).contents);
      expect(written.name).toBe("My theme");
      // The DRAFT, not a saved theme: nothing was created.
      expect(useSettingsStore.getState().customThemes).toEqual([]);
    });
  });

  it("saves the draft as a new theme and closes", () => {
    useThemeEditorStore.getState().openNew(dark);
    useThemeEditorStore.getState().setName("My theme");
    render(<ThemeEditorDialog />);

    fireEvent.click(screen.getByRole("button", { name: /create theme/i }));

    expect(useSettingsStore.getState().customThemes.map((t) => t.name)).toEqual([
      "My theme",
    ]);
    expect(useThemeEditorStore.getState().open).toBeNull();
  });

  it("cancel restores the theme that was live when it opened", () => {
    useThemeEditorStore.getState().openNew(dark);
    render(<ThemeEditorDialog />);
    useThemeEditorStore.getState().patchColors({ bg0: "#123456" });

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(document.documentElement.style.getPropertyValue("--bg-0")).toBe(
      dark.colors.bg0,
    );
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("reveals all 18 colour slots behind the disclosure", () => {
    useThemeEditorStore.getState().openNew(dark);
    render(<ThemeEditorDialog />);
    fireEvent.click(screen.getByRole("button", { name: /all colou?rs/i }));
    expect(screen.getByLabelText(/background · base/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/logo · bill/i)).toBeInTheDocument();
  });
});
```

Use `fireEvent`, not `userEvent` — `userEvent.setup()` replaces
`navigator.clipboard` and detaches spies, and this suite touches the clipboard's
neighbours. That is the house pattern.

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/ThemeEditorDialog.test.tsx`
Expected: FAIL — the dialog still takes props and renders its own overlay.

- [ ] **Step 3: Rewrite the dialog**

Rewrite `ThemeEditorDialog.tsx` to take **no props** and read the store. The
structure, following the approved layout:

- `const ed = useThemeEditorStore();` — return `null` when `ed.open` is null.
- Wrap everything in `<PGModal onCancel={ed.close} width={880}>`. **Delete** the
  hand-rolled `position: fixed` backdrop, the `zIndex: 100`, and the
  `window.addEventListener("keydown", …)` Escape effect — Escape now arrives
  through `app.closeOverlay` (Task 9), and `modal.tsx`'s comment explains why a
  local listener is wrong.
- Header: `PGIcon name="edit"`, the title (`New custom theme` / `Edit custom
  theme`), and a `Revert changes` ghost button wired to `ed.revert`.
- Left column, in order:
  - `Name` — `PGInput` bound to `ed.name` / `ed.setName`.
  - `Mode` — `PGButtonGroup` Dark/Light. **On a flip**, `await pgConfirm({ … })`
    offering to re-base from the matching built-in theme, and on yes call
    `ed.applyBase(<matching builtin id>, ed.colors.accent)`; on no, only
    `ed.setThemeMode(next)`. Copy: title `Re-base the colours for light mode?`,
    body `Dark greys under a light calibration are unreadable. Re-basing keeps
    your accent and takes the rest from the built-in light theme.`, confirm
    label `Re-base colours`. **Skip the prompt** when the draft's colours still
    equal the source theme's — there is nothing to lose, so just re-base.
  - `Start from` — a `PGSelect` of every theme (built-ins then customs) bound to
    `ed.baseId`, plus an accent `ColorField`. Changing either calls
    `ed.applyBase(baseId, accent)`. A one-line hint: `Takes the palette from
    another theme and keeps your accent.`
  - `All colours (18)` — a disclosure `<button>` toggling the existing
    `<ColorEditor colors={ed.colors} onPatch={ed.patchColors} />`. Collapsed by
    default so the guided path is what a first-time user sees.
- Right column: `<ThemePreview theme={{ name: ed.name, mode: ed.themeMode, colors: ed.colors }} size="pane" />`
  and, under it, the warnings block — rendered **only when
  `contrastReport(ed.colors)` is non-empty** — as
  `data-testid="theme-contrast-warnings"`, one row per finding:
  `PGIcon name="warn"` (the union has no `alert-triangle` — `warn` is the
  declared name, verified in `src/design/icons.tsx`), the finding's `what`, and
  `` `${ratio.toFixed(1)}:1` ``. Colour
  `bad` findings `var(--git-removed)` and `low` ones `var(--git-modified)`.
- Footer: `Export…` (`exportThemeDraftToFile({ name: ed.name, mode: ed.themeMode, colors: ed.colors })`,
  flashing the returned path), `Import…` (`importThemeFromFile()`, then
  `ed.setColors(theme.colors)` + `ed.setThemeMode(theme.mode)` — loading a file
  into the DRAFT, which is the round trip #435's reporter wanted), a spacer,
  `Cancel` (`ed.close`), and the primary `Create theme` / `Save changes`
  (`ed.save()`, flashing `Saved "<name>"`, or flashing
  `Theme name can't be empty` when it returns null).

Both async footer handlers wrap in `try`/`catch` and flash
`appErrorMessage(err)`; a `null` return (cancel) flashes nothing.

- [ ] **Step 4: Give `ColorEditor` the contrast badge and the groups**

In `ColorEditor.tsx`:
- Each `ColorField` gets `aria-label={label}` on its hex input so
  `getByLabelText(/background · base/i)` finds it. Wrap the swatch and the input
  in a `<label>` whose text is the field label, or set `aria-label` explicitly —
  either satisfies the test, and the explicit label is clearer.
- `ColorField` accepts an optional `badge?: React.ReactNode` rendered right of
  the hex input. The dialog passes a ratio badge for the four keys in
  `CONTRAST_PAIRS` so the warning is visible where the colour is edited, not
  only in the summary.
- Keep `normalizeHex` exported unchanged — `contrast.ts` and `deriveTheme.ts`
  both import it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme`
Expected: PASS.

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
printf '%s\n' 'feat(theme): rebuild the theme editor around a live preview' '' 'Why: judging a palette meant squinting past a dimmed backdrop at the 10% of' 'the app the dialog did not cover, and nothing warned you when the result was' 'unreadable. Guided start first, all 18 slots behind a disclosure, warnings' 'that advise and never block, and export that writes a file.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings/theme
git commit -F /tmp/pg-msg.txt
```

---

### Task 11: The gallery, on the Appearance page

**Files:**
- Create: `src/features/settings/theme/ThemeGallery.tsx`
- Create: `src/features/settings/theme/ThemeGallery.test.tsx`
- Modify: `src/features/settings/pages/appearance.tsx`

**Interfaces:**
- Consumes: `ThemePreview` (Task 8), `useThemeEditorStore` (Task 9),
  `exportThemeToFile` / `importThemeFromFile` (Task 3), `useSettingsStore`.
- Produces:
  `ThemeGallery(props: { appearance?: "light" | "dark" }): JSX.Element` —
  omitting `appearance` shows every theme and picks the active one; passing it
  filters to that mode and drives that half of the pairing.

- [ ] **Step 1: Write the failing test**

Create `src/features/settings/theme/ThemeGallery.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockDialogSave } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { BUILTIN_THEMES, useSettingsStore } from "@/features/settings/useSettingsStore";
import { useThemeEditorStore } from "./useThemeEditorStore";
import { ThemeGallery } from "./ThemeGallery";

describe("ThemeGallery", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useThemeEditorStore.getState().close();
  });

  it("shows a card per theme, each painted in its own colours", () => {
    render(<ThemeGallery />);
    const cards = screen.getAllByRole("radio");
    expect(cards).toHaveLength(BUILTIN_THEMES.length);
    const light = screen.getByRole("radio", { name: /^Light/ });
    expect(
      within(light).getByTestId("theme-preview").style.getPropertyValue("--bg-0"),
    ).toBe(BUILTIN_THEMES.find((t) => t.id === "light")!.colors.bg0);
  });

  it("marks the active theme as checked", () => {
    useSettingsStore.getState().setActiveThemeId("nord");
    render(<ThemeGallery />);
    expect(screen.getByRole("radio", { name: /^Nord/ })).toBeChecked();
  });

  it("activates the theme on the card you click", () => {
    render(<ThemeGallery />);
    fireEvent.click(screen.getByRole("radio", { name: /^Dracula/ }));
    expect(useSettingsStore.getState().getActiveTheme().id).toBe("dracula");
  });

  it("moves the selection with the arrow keys", () => {
    useSettingsStore.getState().setActiveThemeId("dark-cool");
    render(<ThemeGallery />);
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(useSettingsStore.getState().getActiveTheme().id).toBe("dark-warm");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(useSettingsStore.getState().getActiveTheme().id).toBe("dark-cool");
  });

  it("filters to one mode and drives that half of the pairing", () => {
    useSettingsStore.getState().setThemeFollowMode("system");
    render(<ThemeGallery appearance="light" />);
    for (const card of screen.getAllByRole("radio")) {
      const name = card.getAttribute("aria-label") ?? "";
      const theme = BUILTIN_THEMES.find((t) => name.startsWith(t.name));
      expect(theme?.mode, `${name} is not a light theme`).toBe("light");
    }
    fireEvent.click(screen.getByRole("radio", { name: /^GitHub Light/ }));
    expect(useSettingsStore.getState().themePreference.lightId).toBe("github-light");
  });

  it("offers Duplicate on a built-in card and opens the editor with it", () => {
    render(<ThemeGallery />);
    const card = screen.getByRole("radio", { name: /^Nord/ });
    fireEvent.click(within(card).getByRole("button", { name: /duplicate/i }));
    expect(useThemeEditorStore.getState().open?.mode).toBe("new");
    expect(useThemeEditorStore.getState().open?.sourceTheme.id).toBe("nord");
  });

  it("offers Edit and Delete only on a custom card", () => {
    render(<ThemeGallery />);
    const builtin = screen.getByRole("radio", { name: /^Nord/ });
    expect(within(builtin).queryByRole("button", { name: /^edit/i })).toBeNull();
    expect(within(builtin).queryByRole("button", { name: /delete/i })).toBeNull();

    const created = useSettingsStore.getState().duplicateTheme("nord", "Mine");
    const card = screen.getByRole("radio", { name: /^Mine/ });
    expect(within(card).getByRole("button", { name: /^edit/i })).toBeInTheDocument();
    expect(created.name).toBe("Mine");
  });

  it("exports the theme on the card", () => {
    mockDialogSave("/home/you/nord.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);
    render(<ThemeGallery />);
    const card = screen.getByRole("radio", { name: /^Nord/ });
    fireEvent.click(within(card).getByRole("button", { name: /export/i }));
    return Promise.resolve().then(() => {
      expect(invokeCalls().some((c) => c.cmd === "write_user_file")).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings/theme/ThemeGallery.test.tsx`
Expected: FAIL — cannot resolve `./ThemeGallery`.

- [ ] **Step 3: Write the gallery**

Create `src/features/settings/theme/ThemeGallery.tsx`:

- The container is `role="radiogroup"` with an `aria-label` of
  `Theme` / `Light theme` / `Dark theme`, a CSS grid
  (`repeat(auto-fill, minmax(190px, 1fr))`, gap 10), and an `onKeyDown` handling
  `ArrowRight`/`ArrowDown` (next), `ArrowLeft`/`ArrowUp` (previous),
  `Home`/`End`. Each move **activates** the theme it lands on, which is what
  makes arrow-browsing a live preview rather than a focus walk.
- Each card is `role="radio"`, `aria-checked`, `aria-label={theme.name}`,
  `tabIndex={isActive ? 0 : -1}`, and contains
  `<ThemePreview theme={theme} size="card" />`, the name, a
  `Built-in` / `Custom` chip, and its action buttons. The active card takes a
  `2px solid var(--accent)` ring; the rest `1px solid var(--border-1)`.
- The theme list is `[...BUILTIN_THEMES, ...s.customThemes]`, filtered to
  `appearance` when given. **A half may only name a theme of its own mode** —
  the rule `pairOptions` already enforces, because a pairing whose halves share
  a mode never switches.
- Click / arrow → `s.setActiveThemeId(id)` with no `appearance`, or
  `s.setPairedThemeId(appearance, id)` with one.
- Card actions, all `<button>`s so `within(card).getByRole("button", …)` finds
  them, each with `e.stopPropagation()` so the click does not also re-activate:
  - **Duplicate** (every card) → `useThemeEditorStore.getState().openNew(theme)`.
  - **Edit** (custom only) → `openEdit(theme)`.
  - **Export…** (every card) → `exportThemeToFile(theme.id)`, flashing the path.
  - **Delete** (custom only) → the existing `pgConfirm` copy from
    `appearance.tsx`'s `onDelete`, then `s.deleteTheme(theme.id)`.
- Icons via `PGIcon` with names the `IconName` union already declares (`copy`,
  `edit`, `download`, `trash` — **verify each against `src/design/icons.tsx`**;
  a name the union lacks renders a dashed square and fails
  `test/iconSet.test.ts`).

- [ ] **Step 4: Rewire the Appearance page**

In `src/features/settings/pages/appearance.tsx`:
- Delete the `PGSelect` from the `appearance.theme` row and both `PGSelect`s
  from the `appearance.light` / `appearance.dark` rows, and delete
  `themeOptions` and `pairOptions`.
- Make those rows `stacked` with a `<ThemeGallery />` (fixed mode) or
  `<ThemeGallery appearance="light" />` / `<ThemeGallery appearance="dark" />`
  (follow-system mode) as the control. **Keep the row `id`s exactly** —
  `appearance.theme`, `appearance.light`, `appearance.dark` — or
  `settings.index.test.tsx` fails the build and Settings search stops finding
  the theme picker.
- Delete the whole button strip that held Edit / New / Delete / Export /
  Import — Edit, Duplicate, Export and Delete now live on the cards. Keep a
  single `Import theme…` button (`importThemeFromFile()`), because importing is
  the one action that belongs to no existing card.
- Delete the local `editor` state and the `onDelete` handler (both moved), and
  render `<ThemeEditorDialog />` unconditionally at the end — it reads its own
  open state now.
- In `meta`, extend the keywords: `appearance.theme` gains
  `gallery preview swatch duplicate import export`, and the light/dark rows gain
  `gallery preview`.
- Update the two hints to match reality: the built-in hint becomes
  `Built-in themes are read-only — Duplicate one to start your own.` and the
  custom hint `Custom theme. Edit it on its card.`

- [ ] **Step 5: Run the tests to verify they pass**

Run: `~/Library/pnpm/pnpm vitest run src/features/settings src/screens`
Expected: PASS, including `settings.index.test.tsx`.

Run: `~/Library/pnpm/pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Look at it**

Screenshot the Appearance page in both fixed and follow-system mode, in a light
theme and a dark one, using the headless-Chrome route. Check that nine cards
read as nine distinguishable themes at card size and that the action buttons do
not swamp the card. Fix what looks wrong before committing.

- [ ] **Step 7: Commit**

```bash
printf '%s\n' 'feat(theme): pick a theme by looking at it' '' 'Why: the picker was a dropdown of names with a star in front of the custom' 'ones, so choosing a theme meant applying it to find out. Cards carry a real' 'preview and their own Duplicate/Edit/Export/Delete; the row ids stay put so' 'Settings search keeps finding them.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add src/features/settings
git commit -F /tmp/pg-msg.txt
```

---

### Task 12: Docs, and the whole-suite verification

**Files:**
- Modify: `docs/dev/frontend.md`
- Modify: `docs/dev/backend.md`
- Modify: `docs/dev/architecture.md`
- Modify: `CLAUDE.md`
- Modify: `e2e/specs/settings.e2e.ts`

- [ ] **Step 1: Document the backend command**

In `docs/dev/backend.md`, add a section for `commands/userfile.rs`: the two
commands, `MAX_USER_FILE_BYTES = 4 MiB`, `AppError::Io` vs `InvalidPath`, and
the trust model — **the path comes from a native dialog, the frontend may never
synthesise one, and that is why `write_user_file` refuses to create parent
directories.** Say why the app does not use `tauri-plugin-fs`: two thin commands
match how every other backend capability here is exposed, and the plugin's scope
config would be a second, parallel answer to "may the webview touch this path".

`test/docs.test.ts` gates backend modules by filename mention across `CLAUDE.md`
and every `docs/dev/*.md`, so this section satisfies it — but add the tree entry
in Step 3 anyway, because a command nobody can find is a command that gets
written twice.

- [ ] **Step 2: Document the frontend**

In `docs/dev/frontend.md`, in the theme area (near the "One theme format"
bullet), add:
- **One file save/open path** — `lib/userFile.ts`, why `<a download>` and
  `<input type="file">` are gone (WebKitGTK ignores the download attribute;
  #435 was that silence), that every save returns the path, that a cancel is
  `null` and never a throw, and that `test/fileSave.test.ts` fails the build for
  a relapse.
- **One theme renderer** — `themeVars` is the map, `applyTheme` writes it to
  `:root`, `ThemePreview` writes it to its own subtree and reads no `:root`
  var; `themeVars.test.ts` pins the two together, so a new colour slot lands in
  one place.
- **The editor's draft lives in a store** — because `app.closeOverlay` reads
  stores and a registered per-component handler would take Escape ahead of the
  credential prompt, and because closing has to restore the pre-draft theme.
- **Contrast warnings advise, never block.** Four pairs, Save never disabled.

- [ ] **Step 3: Update the annotated trees**

In `docs/dev/architecture.md`: add `commands/userfile.rs` to the backend tree
with its one-line job, and add `lib/userFile.ts`,
`features/settings/themeFiles.ts` and the new
`features/settings/theme/*` modules (`themeVars` is in the store,
`contrast.ts`, `deriveTheme.ts`, `ThemePreview.tsx`, `ThemeGallery.tsx`,
`useThemeEditorStore.ts`) to the frontend tree.

- [ ] **Step 4: Add the CLAUDE.md bullet**

One bullet in the conventions list, in the established voice:

```markdown
- **One file save/open path — `lib/userFile.ts`.** A webview is not a browser:
  WebKitGTK ignores `<a download>`, so every export in the app silently did
  nothing on Linux (#435). Native `save()`/`open()` plus
  `commands/userfile.rs`; a save returns the PATH so a surface can name the
  file. No `<a download>`, no `<input type="file">`, no `createObjectURL` in
  shipped `src/` — `test/fileSave.test.ts` fails the build.
  (`docs/dev/frontend.md`)
```

Keep it to that. `CLAUDE.md` is loaded into every session and was cut from 2,456
lines once; the deep version belongs in `docs/dev/frontend.md`.

- [ ] **Step 5: Extend the e2e spec**

Read `.claude/skills/e2e-testing/SKILL.md` **before** touching
`e2e/specs/settings.e2e.ts` — it owns the selector and waiting rules, and
`waitForExist` is the stale-proof wait (`isDisplayed` caches `elementId` and
dies on a re-render).

Add one case to `settings.e2e.ts`: open Settings → Appearance, click
**Duplicate** on a built-in card, change one colour in the editor, save, and
assert the gallery shows the new custom theme as the active card.

**Do not try to cover export or import in e2e.** The dialogs are native and out
of WebDriver's reach. The Rust tests in Task 1 and the `saveTextFile`
assertions in Tasks 2, 3, 10 and 11 are what cover the file path — and saying so
here is the point: **a green e2e suite is not evidence that #435 is fixed.**

- [ ] **Step 6: Verify the whole tree, after the last edit**

A green number is only evidence for the tree it ran on, so this runs last.

```bash
~/Library/pnpm/pnpm tsc --noEmit
~/Library/pnpm/pnpm exec tsc -p e2e/tsconfig.json --noEmit
~/Library/pnpm/pnpm test
~/.cargo/bin/cargo test --manifest-path src-tauri/Cargo.toml
```

All four must pass. Notes on reading the results:
- A red `unit` on `ImageDiffView`'s delta test is a known ~1-in-111 flake — re-run
  rather than audit, and `main` being green does not rule it out.
- `test/docs.test.ts`, `test/privacy.test.ts`, `test/appErrors.test.ts`,
  `test/iconSet.test.ts` and `settings.index.test.tsx` are absence-asserting
  guards. If one is red, it is about this change, not a flake.

Then the e2e gate, rebuilding the snapshot first because `src/` and `src-tauri/`
both changed. **One cold container build at a time across all worktrees**, and
never run a full vitest suite alongside a Docker e2e build — contention fakes a
red:

```bash
~/Library/pnpm/pnpm test:e2e:docker build
~/Library/pnpm/pnpm test:e2e:docker run --spec e2e/specs/settings.e2e.ts
```

- [ ] **Step 7: Commit**

```bash
printf '%s\n' 'docs(theme): document the file path, the renderer and the editor store' '' 'Why: "a webview is not a browser" is not something the next session guesses,' 'and #435 survived a release because the failure was silent. The CLAUDE.md' 'bullet earns its line the way the proc.rs and PGSelect rules did -- it is' 'guard-tested.' '' 'Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>' > /tmp/pg-msg.txt
git add CLAUDE.md docs e2e/specs/settings.e2e.ts
git commit -F /tmp/pg-msg.txt
```

---

### Task 13: Manual verification against the real bug

**Files:** none — this is the step that decides whether #435 is actually fixed.

The unit suite mocks the dialog plugin and the Rust tests never touch a webview,
so **nothing automated in this plan proves the button works in the app.** That
is exactly how #435 shipped.

- [ ] **Step 1: Run the real app**

```bash
~/Library/pnpm/pnpm tauri dev
```

- [ ] **Step 2: Walk the flow that was broken**

1. Settings → Appearance. Confirm nine theme cards render, each recognisably its
   own theme.
2. Duplicate a built-in. Confirm the editor opens with a preview that changes as
   you drag a colour.
3. Set primary text to the canvas colour. Confirm a contrast warning appears and
   **Save is still enabled**.
4. `Export…` from the editor footer. **Confirm a native save dialog opens**, pick
   a path, and confirm the file exists on disk with the draft's JSON in it.
5. Edit that file in a text editor, change the name, then `Import…` from the
   editor. Confirm the draft picks up the change. That round trip is what the
   reporter asked for.
6. Save the theme. Confirm it appears as a card and is active.
7. `Export…` from its card, and `Import theme…` from the page.
8. Settings → Backup: `Export settings`, confirm the dialog and the file, then
   `Import settings` and confirm the change report.
9. Press Escape in the editor mid-edit. Confirm the dialog closes **and the app
   returns to the theme it was on** — not the abandoned draft.

- [ ] **Step 3: Note what you could not verify**

The report on this branch must say plainly that the fix was verified on macOS
and that **Linux/WebKitGTK — the platform in the report — was not exercised
directly**. `pnpm test:e2e:docker` runs Linux but cannot drive a native dialog,
so the Linux evidence is the Rust tests plus the fact that no browser download
API is left in the tree (`test/fileSave.test.ts`). Ask the reporter to confirm
on 26.04, or say why that is the right next step.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/theme-editor-revamp
```

Then `gh pr create` with a body written to a file (`--body-file`, never
`--body "<prose>"`). The body should carry: the root cause in two sentences, the
before/after of the file path, the UX changes, **which assertion caught the
planted guard violation** (Task 4), and the platform caveat from Step 3.
Reference `#435` so it auto-closes — then **verify** with
`gh pr view <N> --json closingIssuesReferences` before merging, because a body
that says "does not close #435" still closes it.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: the file path → Tasks 1-3;
the guard → Task 4; `themeVars` → Task 5; contrast → Task 6; `deriveTheme` →
Task 7; `ThemePreview` → Task 8; the editor store and the `closeOverlay` chain →
Task 9; the rebuilt editor → Task 10; the gallery and the Appearance page →
Task 11; docs and the CLAUDE.md bullet → Task 12; the manual walk the spec's
testing section says e2e cannot cover → Task 13.

**Names.** `themeVars`, `contrastReport`, `CONTRAST_PAIRS`, `deriveTheme`,
`ThemePreview`, `ThemeGallery`, `useThemeEditorStore`, `saveTextFile`,
`openTextFile`, `themeFileName`, `exportThemeToFile`,
`exportThemeDraftToFile`, `importThemeFromFile`, `exportSettingsToFile`,
`importSettingsFromFile`, `readUserFile`, `writeUserFile`, `read_user_file`,
`write_user_file`, `MAX_USER_FILE_BYTES`, `mockDialogSave`,
`lastDialogSaveOptions` — each is defined in exactly one task and spelled the
same everywhere it is consumed.

**Verified while writing this plan, so the tasks above spell them correctly:**
`mockInvoke(cmd, handler)` takes a **function** and throws for an unregistered
command; the call log is `getInvokeCalls()`; the icon union declares `warn`
(there is no `alert-triangle`), and `copy`, `edit`, `download` and `trash` all
exist. **Still check every other `PGIcon name=` literal** against
`src/design/icons.tsx` before using it — `name` is typed `IconName | string`,
so a typo type-checks, renders a dashed square, and is caught only by
`test/iconSet.test.ts`.
