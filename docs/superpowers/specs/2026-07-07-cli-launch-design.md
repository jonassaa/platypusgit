# CLI launch capability — design

**Date:** 2026-07-07
**Source:** GitHub issue #25, item 1 — "CLI launchability `platypus .` or `platypus commit`, `pgit` or something. Takes you to UI with expected page open."
**Status:** Approved (assistant-driven, autonomous session; decisions documented below)

## Goal

Launch PlatypusGit from a terminal with the repo and screen you meant:

```
pgit .                 # open repo containing cwd
pgit ~/dev/foo         # open repo containing that path
pgit commit            # open cwd repo, land on Commit panel
pgit log src/          # open repo containing src/, land on History
```

If the app is already running, a second `pgit …` invocation must not spawn a
second app instance — it forwards the request to the running window, focuses
it, and navigates there.

## CLI grammar

```
pgit [subcommand] [path]
pgit --help | -h
```

- **Bare `pgit` (no args)** — indistinguishable from a GUI launch (Finder/
  Explorer also pass zero args), so it is treated as a plain app launch: last
  persisted repo/screen state, no CLI intent. Use `pgit .` to open cwd.
- **`pgit <path>`** — open the repo containing `<path>`. No screen change
  (keep last persisted screen).
- **`pgit <subcommand> [path]`** — open repo (path defaults to cwd), then
  switch screen:

  | subcommand | screen |
  |---|---|
  | `commit`, `status` | `commit` (Commit panel) |
  | `log`, `history` | `history` |
  | `branches` | `branches` |

- An argument that is not a known subcommand is treated as a path.
- `--help`/`-h` prints usage to stdout and exits before the GUI starts.
- Relative paths resolve against the invoking shell's cwd (first launch:
  process cwd; forwarded launch: the cwd reported by the single-instance
  plugin).
- Repo root discovery: the raw path is resolved with
  `git2::Repository::discover` at intent-build time (backend `open` uses
  `Repository::open`, which requires the root — CLI users will be deep in
  subdirectories). If discovery fails, pass the raw path through and let the
  normal `open_repo` error path surface `NotARepo` in the error banner.

## Approaches considered

1. **App binary parses argv + `tauri-plugin-single-instance`** *(chosen)* —
   `pgit` is just a symlink/shim to the app binary. First instance stashes a
   `LaunchIntent`; later invocations are forwarded (argv + cwd) by the
   single-instance plugin to the running instance, which emits an event to the
   webview and focuses the window. One binary, no IPC protocol to invent.
2. Separate thin CLI binary talking to the app over a socket/deep link — more
   moving parts, custom protocol, packaging work. YAGNI.
3. Custom URL scheme (`pgit://…`) — doesn't give the shell UX the issue asks
   for; still needs a shim to be typable.

## Architecture

### Rust

- **`src-tauri/src/cli.rs`** (new): pure, unit-tested parsing.
  - `LaunchIntent { path: Option<PathBuf>, screen: Option<String> }`
    (serde-serializable; screen values are the frontend `ScreenId` strings).
  - `parse_args(args: &[String], cwd: &Path) -> Parsed` where
    `Parsed = Help | Launch(Option<LaunchIntent>)`. Takes argv *without* the
    binary name. Pure — no filesystem access.
  - `resolve_repo_root(intent) -> LaunchIntent` — applies
    `Repository::discover`; separate from parsing so parsing stays pure.
- **`lib.rs` `run()`**:
  - Parse `std::env::args` first; `--help` prints usage and returns without
    building the app.
  - Register `tauri-plugin-single-instance` as the **first** plugin (its
    requirement). Callback receives `(app, argv, cwd)`: parse, resolve, emit
    `cli-launch` event with the intent payload, focus + unminimize the main
    window.
  - Skip the plugin entirely when `PLATYPUSGIT_NO_SINGLE_INSTANCE=1` — e2e
    runs and parallel dev instances must not forward-and-exit into each other.
  - Managed state `CliLaunch(Mutex<Option<LaunchIntent>>)` holding the
    first-launch intent.
- **`commands/cli.rs`** (new):
  - `take_launch_intent() -> AppResult<Option<LaunchIntent>>` — returns and
    clears the stashed intent (take-once semantics; a webview reload must not
    replay it).
  - `cli_shim_status() -> AppResult<CliShimStatus>` —
    `{ installed: bool, shim_path: String, target: String }`; installed means
    the shim exists and points at the current executable.
  - `install_cli_shim() -> AppResult<CliInstallOutcome>` —
    `{ installed: bool, path: String, manualCommand: String | null }`.
    Success → `installed: true`. Permission failure is NOT an error: returns
    `installed: false` + the manual command to run (e.g.
    `sudo ln -sf <exe> /usr/local/bin/pgit`). No new `AppError` variants.
  - Shim locations: macOS `/usr/local/bin/pgit`; Linux `~/.local/bin/pgit`.
    Windows: install unsupported for now — UI shows a note instead of the
    button. Core install logic factored as `install_shim_at(dir, exe)` so
    tests can point it at a temp dir.

### Frontend

- `src/lib/types.ts`: `LaunchIntent`, `CliShimStatus`, `CliInstallOutcome`.
- `src/lib/tauri.ts`: `takeLaunchIntent()`, `cliShimStatus()`,
  `installCliShim()` wrappers.
- **`src/features/cli/useCliLaunch.ts`** (new): hook mounted once in
  `AppShell`.
  - On mount: `takeLaunchIntent()`; if present, handle it.
  - Subscribes to the `cli-launch` Tauri event for forwarded invocations.
  - Handling: if `path` → await `useRepoStore.getState().openRepo(path)`,
    then if `screen` → `useNavStore` `switch-screen` intent (which `AppShell`
    already routes). Both always apply: a failed open shows the error banner
    and the screen switch is harmless alongside it.
- **Settings screen**: new "Command line" `Section`:
  - Shows shim status (installed at `<path>` / not installed).
  - Install button → `installCliShim()`; on `manualCommand` outcome, shows the
    command to copy-run instead. Windows: explanatory note, no button.

### Event flow

```
terminal: pgit commit src/
  └─ new process → single-instance plugin → running instance
       callback: parse(argv, cwd) → discover root → emit "cli-launch" {path, screen}
                 focus + unminimize main window
frontend: useCliLaunch listener → openRepo(path) → nav intent switch-screen("commit")
```

First launch is identical except the intent travels via managed state +
`take_launch_intent` instead of the event (the webview isn't up yet when
argv is parsed).

## Error handling

- Non-repo path → normal `open_repo` `NotARepo` error banner; app still opens.
- Nonexistent path → same (`InvalidPath` from backend).
- Unknown subcommand is a path candidate, not an error (e.g. `pgit foo` where
  `foo/` is a directory).
- Shim install permission failure → structured outcome with manual command,
  rendered in Settings; never a thrown error.

## Testing

- **Rust unit (`cli.rs`)**: table-driven `parse_args` tests — bare, path-only,
  each subcommand, subcommand+path, unknown-token-as-path, relative-path
  resolution against cwd, `--help`.
- **Rust unit**: `install_shim_at` against a temp dir — fresh install,
  reinstall over stale symlink, status detection.
- **Frontend component test**: `useCliLaunch` — mock `take_launch_intent` via
  `mockInvoke`, assert `open_repo` invoked with the path and nav intent set;
  mock the event module to assert forwarded events are handled too.
- **E2E**: launching the binary with CLI args isn't reachable through the
  wdio tauri-service harness — out of scope. The full existing suite must
  stay green; wdio config gets `PLATYPUSGIT_NO_SINGLE_INSTANCE=1` in the
  launch env so the plugin can't interfere with test runs.

## Out of scope

- Windows shim install (PATH manipulation / installer work).
- `pgit diff <file>`, opening individual files, blame from CLI.
- Man page, shell completions.
- Deep links / URL scheme.
