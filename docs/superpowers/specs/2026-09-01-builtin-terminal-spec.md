# A built-in terminal, already cd-ed to the open repository (#243)

Status: approved 2026-09-01.

## Why

`platypusgit` assumes you know git. The person who knows git drops to a shell
for the 5% the GUI does not cover — a `git rebase --onto` with an odd revset, a
`gh` invocation, a `cargo test`. Today that means leaving the app, finding a
terminal, and `cd`-ing to the repository they already had open.

We already ship the other leg: `pgit` takes you terminal → app
(`docs/dev/distribution.md`). This is the return leg.

The issue flagged "use your own terminal" as a defensible answer. It was
considered and rejected: for a dev-first client the shell is not an escape
hatch, it is the other half of the workflow, and the round trip through a
separate app loses the one thing the GUI already knows — which repository you
are in.

## What ships

A real pty. Not a command runner: `vim`, `less`, `ssh`, `git rebase -i`, tab
completion and colour all work, because anything less is a text box that lies
about being a terminal.

- A terminal panel docked below the active screen, toggled with a chord and
  resizable by drag. Closed by default.
- **One shell per repository tab.** Switching tabs switches shells; the cwd is
  that repository's workdir. Hiding the panel leaves the shell running; closing
  the repository tab kills it.
- Shell chosen by auto-detection, overridable in Settings.
- Nothing to build for "refresh after a command" — see *Refresh*, below.

Explicitly **not** in this cut: multiple shells per repository tab, a terminal
tab strip, split terminals, shell profiles, scrollback search. One shell per
repository is what the issue asked for and what the panel can do well.

## Architecture

### Backend

Two new files, in the shape `watcher.rs` + `commands/watch.rs` already
established for "a subsystem holding live OS resources, driven by thin
commands":

- `src-tauri/src/terminal.rs` — the session registry. Owns every live pty.
- `src-tauri/src/commands/terminal.rs` — four thin handlers.

`TerminalState` is `manage`d on the Tauri app alongside `WatchState`. It holds
`Mutex<HashMap<RepoId, Session>>`. A `Session` owns:

| field | for |
|---|---|
| `master: Box<dyn MasterPty + Send>` | `resize` |
| `writer: Box<dyn Write + Send>` | `term_write` |
| `child: Box<dyn Child + Send + Sync>` | `kill` on close |
| `epoch: u64` | fencing a stale reader (below) |

Sessions are keyed by `RepoId`, which is what makes "one shell per repository
tab" a property of the data structure rather than a rule the frontend has to
remember. A second `term_open` for a repository that already has a live session
is a no-op returning the existing dimensions, so a panel re-mount cannot stack
shells.

#### The reader thread

One blocking thread per session, reading the pty master. Each read emits a
`term://data` event carrying `{ repoId, epoch, data }`.

**`data` is base64.** This is the detail most likely to be got wrong: pty output
is arbitrary bytes, and a 4 KiB read splits a multi-byte character at the
boundary about as often as you would expect. Handing Tauri a `String` means
`from_utf8_lossy`, which silently replaces the split character with U+FFFD — the
user sees a `<?>` in the middle of a filename, intermittently, and only for
non-ASCII. Base64 across IPC and `atob` on the frontend feeding xterm's
byte-oriented `write` keeps the stream exact. xterm.js does its own incremental
UTF-8 decoding across chunks, which is the correct place for it.

`epoch` fences the thread. Closing and immediately reopening a repository's
terminal can leave the old thread mid-`read` with a chunk in hand; without a
fence it emits into the new session and the user sees the dead shell's last
line. The frontend drops any event whose epoch is not the one it opened.

When `read` returns 0 the shell has exited: emit `term://exit` with the status,
reap the child, drop the session from the map. The thread then returns — no
leaked thread per tab, which the issue called out.

#### `term_open` / `term_write` / `term_resize` / `term_close`

Thin, in `commands/terminal.rs`. `term_open` takes `repo_id`, `rows`, `cols`
and resolves the workdir **through the backend**, never from a frontend
argument — the same rule `watch_repo` and `run_custom_action` follow, and for
the same reason: a path argument would be a second source of truth for where a
repository lives, and this one is about to become a shell's cwd.

`term_close` is idempotent. Killing an already-exited child is not an error.

### The `proc.rs` carve-out

The rule is *never `Command::new` outside `src-tauri/src/proc.rs`*, enforced by
`src-tauri/tests/spawn_no_window.rs`. `portable-pty` would slip straight past
that guard: it spawns through its own `CommandBuilder`, not
`std::process::Command`, so the grep never fires. Adding the crate without
touching `proc.rs` would create exactly the second spawn path the guard exists
to prevent — invisibly.

So `proc.rs` owns the whole operation, not just the command:

```rust
pub fn spawn_pty_shell(
    shell: &OsStr, workdir: &Path, rows: u16, cols: u16,
) -> io::Result<PtySession>
```

It calls `native_pty_system().openpty(...)`, builds the `CommandBuilder`, and
calls `slave.spawn_command(...)`, returning the master and the child.
`terminal.rs` never touches `portable_pty`'s spawn API. This matches the
module's own stated philosophy — the treatment is applied *by the only functions
that hand out a command at all* — rather than bolting a fourth thing onto it.

What it applies, and why each is a deliberate choice:

- **`child_path()`** — yes. The login-`PATH` merge from #232. A Dock-launched
  app inherits launchd's minimal environment; without this the built-in
  terminal would be the one terminal on the machine where `node` is missing.
- **`TERM=xterm-256color`** — the terminal we actually render.
- **cwd = the repository workdir** — the entire point of the feature.
- **`GIT_TERMINAL_PROMPT=0`** — *no*, and this inversion of `proc.rs`'s standing
  policy must be argued rather than inherited. `prompt_less` exists because a
  child of a GUI app has no terminal, so an auth prompt hangs forever behind a
  window nobody can see. This child **is** a terminal, on purpose, and the user
  is looking at it. Suppressing the prompt here would turn a working `git push`
  into a mysterious failure.
- **`CREATE_NO_WINDOW`** — not applicable. ConPTY is not `CreateProcess` with an
  inherited console; `portable-pty` allocates a pseudoconsole and no `conhost`
  window appears. The issue's "must not flash a console" requirement is
  satisfied by the mechanism, not by a flag. Verified on Windows before merge.

The guard test grows a third case: `CommandBuilder::new`, `openpty(` and
`spawn_command(` may appear only in `src/proc.rs`, count 1 each. A future second
pty path then fails the build the way a second `Command::new` does.

### No logging of pty traffic, ever

A terminal is where secrets get typed. The property we want is that bytes read
from the pty reach exactly one destination — the `term://data` emit — and
nothing else.

Enforced structurally rather than by care: `src/terminal.rs` contains **no
logging macro at all**, asserted by a new `src-tauri/tests/terminal_privacy.rs`.
Session lifecycle worth logging (opened, exited, closed) is logged from
`commands/terminal.rs`, which handles ids and exit codes and never sees a byte
of traffic. That split is what makes the test cheap and total.

The same test asserts the module never writes the buffer to a file or a command,
and that `term_write`'s payload is not logged either — a password typed at a
`sudo` prompt travels that direction.

Nothing from the auth path goes near the shell: no forge token, no git
credential, no askpass environment. It gets the ordinary child environment
`proc.rs` builds, exactly as `run_custom_action` does.

### A new `AppError` variant

`TerminalUnavailable(String)` — the shell binary is missing or not runnable.
This is the shape `LfsUnavailable` and `SshKeygenUnavailable` already use: a
**state**, not a failure. The panel disables itself and says which shell it
tried, because the remedy is one field in Settings. Raising `Io` instead would
put "No such file or directory" in an error banner without saying which file.

The TS union in `src/lib/errors.ts` gains the matching member in the same
commit, with prose in `appErrorDetail` naming the Settings field.
`test/appErrors.test.ts` fails the build for either half alone.

### Frontend

`src/features/terminal/`:

- `useTerminalStore.ts` — panel `open`, `heightPx`, and per-repo session status.
- `TerminalPanel.tsx` — the docked pane and its resize handle.
- `TerminalView.tsx` — one xterm.js instance, mounted per repository.
- `shellLabel.ts` — pure: the display name for the configured or auto shell.

**Why a separate store and not `RepoSlice`.** `useRepoStore` holds exactly one
repository's state, and a new per-repo field must join `RepoSlice`/`emptySlice`
or tab switches leak it. The terminal's per-repo state is *session liveness for
every open tab at once*, which is the shape `useTabsStore` has, not the shape
`RepoSlice` has — putting it in `RepoSlice` would destroy the sessions of every
inactive tab on each switch, the opposite of what we want. Panel open and height
are a global UI preference, persisted like a pane size.

**Sizing does not use `ResizeObserver`.** xterm's `FitAddon` is normally driven
by one, and WebKitGTK does not have it — the Linux build would render an 80×24
terminal in a 200-column pane forever. The panel measures with
`lib/useElementSize` (read first, observe second, per the frontend rules) and
computes cols/rows from the measured cell size, calling the fit and
`term_resize` together so the pty and the renderer never disagree.

**Theme.** xterm's theme object is built from the design-system CSS variables at
mount and rebuilt on theme change. No hardcoded accent — the rule holds here as
everywhere.

**Keyboard.** A `terminal.toggle` action joins `features/keymap/actions.ts`
(default `Ctrl+\``). The panel is a `PGPane` so spatial navigation can reach it.
While xterm holds focus the global chord handler stands down except for the
toggle itself and the pane-escape chord: a terminal that swallows `Ctrl+C` into
a command palette instead of the foreground process is worse than no terminal.

**Lifecycle.**

| event | effect |
|---|---|
| panel opened, no session for the active repo | `term_open` |
| repository tab activated | show that repo's view; open a session if none |
| panel hidden | container hidden; every view stays mounted |
| repository tab closed | `term_close` for that repo, then drop its view |
| shell exits (`term://exit`) | print the status in place; no auto-respawn |
| app exits | `close_all` on window destroy kills every child |

No auto-respawn on exit: the user typed `exit` and meant it, and a shell that
comes back is a shell you cannot get rid of.

**Views are hidden, never unmounted** — amended during implementation, where the
first cut returned `null` on collapse. Unmounting disposes the xterm instance
and takes the scrollback with it: the shell survives, so "hiding leaves the
shell running" is technically kept, but the user reopens the panel to a blank
pane and the build output they were reading is gone. Every repository with a
live session therefore keeps its view mounted, and only the active one is
visible. Nothing mounts before the panel is first opened, so "closed by default,
no shell nobody asked for" is unaffected.

### Settings

One field, `terminalShell` (blank = auto), in a new **Terminal** section.
Auto-detection is `$SHELL` then `/bin/sh` on unix; `pwsh.exe` then
`powershell.exe` then `cmd.exe` on Windows.

### Tauri permissions

None. The four commands are ordinary `#[tauri::command]`s reached through the
existing invoke bridge, and the two events go over the standard event channel —
neither needs a capability entry. Nothing is added to `default.json` and no new
scoped capability file is created. Recorded here because the issue asked.

## Refresh

The issue asked for a repository refresh when the shell goes idle after a
command. **That work is already done.** #239 landed the filesystem watcher, it
defaults on (`watchFilesystem: true`), and `watcher.rs` classifies paths against
`gitdir` and `commondir` — so a `git commit` typed into the pane writes refs,
the watcher debounces, and the graph moves. No shell-idle detection, no command
parsing, no second refresh path.

The honest gap: a user who has turned the watcher off gets no automatic refresh
from the terminal either. That is documented, not worked around. Adding a
terminal-specific refresh would be a second mechanism for a job the first one
does, and it would fire on `ls`.

## Dependencies

- `portable-pty` (Rust) — the maintained cross-platform pty crate with ConPTY
  support; wezterm's, and the same one angkorgit uses.
- `@xterm/xterm` (npm) — the terminal renderer. No addons: `FitAddon` is
  replaced by our own measured fit (above), and we need nothing else.

Both are clean against the privacy gates. Neither reaches the network, so
`ALLOWED_HOSTS` in `test/privacy.test.ts` is untouched; `no_telemetry.rs`'s
dependency scan is re-run against the new lockfile as part of the work.

## Testing

**Rust** (`src-tauri/tests/terminal.rs`) — against a real pty:

- open a session on a temp repo, write `echo pgit-ok\n`, read until the marker
  appears; the cwd the shell reports is the repository's workdir
- two repositories get two independent sessions; closing one leaves the other
  running
- `exit\n` produces an exit status and reaps the child — no zombie
- `term_close` on an already-exited session succeeds
- `term_open` twice for one repository yields one child, not two

**Rust guards** — `spawn_no_window.rs` gains the pty-API allow-list;
`terminal_privacy.rs` is new.

**Frontend** (`vitest`) — store logic (session keying, height clamp, epoch
fencing) as pure tests; `TerminalView` against a mocked xterm asserting
`term_write` on input, `term_resize` on a measured size change, and listener
teardown on unmount.

**Docs invariant** — `docs/dev/architecture.md` gains `terminal.rs`,
`commands/terminal.rs` and `features/terminal/`; `test/docs.test.ts` fails the
build otherwise. `docs/dev/backend.md` gains the pty carve-out and the
no-logging rule; `docs/dev/frontend.md` gains the panel and the
no-`ResizeObserver` fit.

**E2E** (`e2e/specs/terminal.e2e.ts`) — one spec, deliberately small: toggle the
panel, wait for a prompt, type a command with a unique marker, assert the marker
appears in the scrollback, toggle it away. Everything finer-grained is cheaper
and less flaky at the layers above.

## Risks

- **xterm in the headless container.** The e2e stack renders in a real
  WebKit-family view, so xterm's DOM renderer should work, but this is the first
  canvas-adjacent thing we test. Mitigation: the spec asserts on the DOM
  renderer's text rows, and if the renderer proves unstable headlessly the e2e
  spec drops to a panel-opens smoke test and the behaviour stays covered by the
  Rust and vitest layers. The feature does not ship worse for it.
- **Windows ConPTY.** The claim that no console flashes is reasoned, not yet
  measured. Verified on Windows before merge; if a flash appears the fix is in
  `spawn_pty_shell` and nowhere else, which is the reason for the carve-out.
- **Shell startup cost.** A slow `.zshrc` makes the first paint of the panel
  slow. Not worked around: it is the user's own shell and the same wait their
  own terminal has. The panel shows a "starting <shell>…" line so the delay is
  attributed correctly.
