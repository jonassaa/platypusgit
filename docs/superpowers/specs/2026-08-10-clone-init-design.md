# Clone & Init repository — design

**Issue:** #61 D3 (Clone repository) + D4 (Init repository), Tier 2.
**Date:** 2026-08-10.
**Status:** approved.

## Problem

platypusgit can only open a repository that already exists on disk. There is no
way to clone one and no way to create one — `GitBackend` has `open` and nothing
else that produces a repository. For a git desktop client that is table stakes:
today the app cannot be the first tool you reach for on a new machine or a new
project, only the second one after the terminal.

## Scope

In scope:

- Clone a repository from a URL to a chosen destination, with live progress.
- Initialize a new repository in a chosen directory.
- Entry points from the Welcome screen, the command palette, and the keymap.
- Opening the resulting repository automatically.

Out of scope, deliberately:

- **Interactive credential entry.** Clone inherits the prompt-less policy every
  existing network op already uses (see "Authentication"). #61 D5 lifts all of
  them together, later.
- **Cancelling a running clone.** See "Deferred: cancel".
- **Shallow clone (`--depth`) and single-branch clone (`--branch`).** A shallow
  repository behaves differently in ways the rest of the app does not model
  (log walks, fetch, push), so surfacing it here would create a class of repo
  the other screens quietly get wrong.
- **Bare clones.** No screen in the app works without a worktree.

## Authentication

Clone follows the same policy as `fetch` / `pull` / `push`: shell out to the
real `git` binary with prompts hard-disabled — `GIT_TERMINAL_PROMPT=0`,
`GIT_ASKPASS=true`, `SSH_ASKPASS=true` (`run_git`, `commands/branches.rs`).

Consequence, stated plainly: **cloning a private repository works if and only
if the user's git already works non-interactively** — via a credential helper
(osxkeychain / libsecret / wincred) or an SSH agent. Without one, the clone
fails and git's own stderr surfaces in the dialog. This is the same behaviour
the user already gets from Fetch and Push today, so clone adds no new failure
mode, and #61 D5 will fix all four ops at once rather than clone diverging with
its own secret handling.

## Architecture

Clone and init have **no `RepoId`** — there is no repository yet — so neither
fits the shape of most `GitBackend` methods. They are split by nature, so each
follows the precedent that already exists for its category rather than fighting
one:

| Op | Home | Precedent it follows |
|----|------|----------------------|
| `init` | `GitBackend` trait | `open` — takes a path, returns a `RepoHandle`, no `repo_id`, already in the trait |
| `clone` | `commands/create.rs`, outside the trait | `fetch` / `pull` / `push` — network ops already bypass the trait and shell out via `run_git` |

Both Tauri commands live in a new `commands/create.rs`, registered in
`invoke_handler!` in `lib.rs`.

### `init`

```rust
fn init(&self, path: &Path, initial_branch: Option<&str>) -> AppResult<RepoHandle>;
```

- `Libgit2Backend`: `Repository::init_opts` with `initial_head` set, wrapped in
  `spawn_blocking` at the command layer like every other libgit2 call.
- `CliBackend`: `NotImplemented` stub, keeping the trait shape exercised.
- Initial branch resolves from the user's `init.defaultBranch`, read via
  `git2::Config::open_default()` so global and system config both count, falling
  back to `main` when unset. Exposed to the frontend as its own command so the
  dialog can show the resolved value and let the user override it.
- Errors with `AppError::InvalidPath` when the target directory is already a
  repository — initializing over an existing repo silently reuses it, which
  would look like success while doing nothing.
- Returns the `RepoHandle` so the frontend can open it without a second round
  trip.

### `clone`

A sibling to `run_git` in `commands/create.rs`:

```rust
async fn run_git_streaming(cwd: &Path, args: &[&str], on_line: impl FnMut(&str)) -> AppResult<()>
```

Spawns with `Stdio::piped()` and reads stderr line by line, keeping `run_git`'s
env exactly (`GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`, `SSH_ASKPASS=true`)
and its error mapping (non-zero exit → `AppError::Network(stderr)`).

The command runs `git clone --progress [--recurse-submodules] -- <url> <name>`
with `cwd` set to the **destination's parent directory**, so `<name>` is the
folder git creates. `--progress` forces machine-readable progress even though
stderr is not a TTY, and `--` terminates option parsing before the URL.

**Progress.** Lines like `Receiving objects:  62% (620/1000)` parse into
`{ phase, percent }` and emit on the `clone://progress` channel. Parsing is a
**pure function** — `parse_progress(line) -> Option<CloneProgress>` — so it is
unit-testable without a child process. Unrecognized lines are ignored rather
than guessed at.

**Validation before spawning:**

- URL is non-empty and does not start with `-`. A leading dash would otherwise
  be read by `git` as a flag rather than a URL.
- The destination is absent, or an existing empty directory.
- The destination is not inside an existing repository.

**Failure leaves nothing behind.** `git clone` removes the destination
directory it created when the clone fails, so a failed attempt leaves no
partial repository. The frontend only calls `openRepo` on success, so a failure
never opens a half-written repo — and because the destination must have been
absent or empty, git's cleanup cannot take anything the user already had.

**Security.** The URL is passed as an argv element to a directly-spawned `git`
— never through a shell, matching the discipline in `opener.rs`. There is no
`sh -c`, no `cmd /C`, and no interpolation of user input into a command string.

### Errors

No new `AppError` variants. Clone failures map to `Network` (git's stderr),
validation failures to `InvalidPath`. The TS `AppError` union is unchanged.

## Frontend

### Design system

`ModalShell` is currently private to `ReflogActionDialog`, and `DirtyTreeDialog`
hand-rolls the same `role="dialog"` + fixed-inset backdrop a second time. It is
promoted to `src/design/` as **`PGModal`** (backdrop, Escape, click-outside,
sizing) and re-exported through the barrel. Both existing dialogs adopt it, and
the two new ones use it from the start — three call sites, one shell.

This is the only refactoring in the spec, and it exists because the feature
needs a third and fourth dialog.

### `src/features/create/`

- `useCreateStore` — which dialog is open (`none | clone | init`), form state,
  live progress, last error.
- `CloneDialog.tsx`, `InitDialog.tsx`.

Separate dialogs rather than one tabbed dialog: the two forms share only the
destination field, so a tab strip would mostly hide one form behind another.

### Entry points

All three, so the feature is reachable once a repo is open and the Welcome
screen is gone:

- Two new Welcome buttons, beside "Open repository…".
- Palette commands in `features/palette/commands.ts`.
- Keymap actions in `features/keymap/actions.ts` + `presets.ts`.

### Fields and behaviour

- Destination parent is picked with the existing
  `open({ directory: true })` dialog (already permitted via `dialog:allow-open`).
- The last-used parent directory persists in `useSettingsStore`.
- The folder name auto-derives from the URL — last path segment, `.git`
  stripped — and stays editable.
- The **resolved full destination path renders live** under the fields, so what
  lands on disk is never a guess.
- On success the frontend calls `openRepo(path)`, which already adds to recents
  (`useRepoStore` → `useRecentsStore.addRecent`).

### Error placement

Clone and init errors render **inside the dialog**, not in the global error
banner. A bad URL or a taken destination is a form error, and the user needs
the form still populated to correct it. Destination-exists-and-non-empty is
inline validation that disables the submit button before anything is spawned.

### Deferred: cancel

While a clone runs the dialog stays open showing phase and percentage, and
Escape / backdrop-close are **disabled** — dismissing it would orphan a running
`git` process with no handle to kill it. A slow clone is therefore a modal the
user must wait out.

This is the accepted cost of leaving cancellation out of this spec. Adding it
means storing the child handle in `AppState`, a cancel command that kills the
process, and partial-destination cleanup — child-process lifecycle that
deserves its own change rather than being smuggled in here. Tracked as a
follow-up.

## Testing

**Clone needs no network.** `BareTempRepo` already exists in
`src-tauri/tests/support/`, and `git clone /path/to/bare dest` exercises the
entire real code path offline — no credentials, no flake, no rate limit.

- **Rust** (`cargo test`):
  - `init` — initial branch honored; `init.defaultBranch` respected when set;
    `main` when unset; error when the target is already a repository; the
    returned `RepoHandle` opens.
  - `clone` — from a local bare repo: files land in the destination, `origin`
    is configured, the result opens through the backend.
  - `parse_progress` — pure-function unit tests over real `git clone --progress`
    output lines, including lines that must be ignored.
- **Frontend** (`pnpm test`):
  - `deriveRepoName(url)` unit tests (trailing `.git`, trailing slash, SSH
    `git@host:org/repo.git` form, URL with query/fragment).
  - Component tests per dialog: name derivation into the field, validation
    disabling submit, progress rendering, error rendered in-dialog.
- **E2E** (`e2e/specs/create.e2e.ts`, new):
  - Init into a temp directory, assert the app opens the new repo.
  - Clone from a local bare repo, assert the files land on disk and the repo
    opens.

  Repo truth via `repo.git(...)` / `repo.read(...)` as the acceptance, UI text
  as the wait condition, per the e2e playbook.

## Success criteria

1. A user with no repository open can clone a public repo from the Welcome
   screen and land in it, with visible progress throughout.
2. A user can create a new repository in an empty directory and land in it, on
   their configured default branch.
3. Both are reachable from the command palette and the keymap while a repo is
   already open.
4. A failed clone leaves the form populated with git's own error visible, and
   leaves no half-written repository behind that the app then opens.
5. No new interactive-credential surface, and no new `AppError` variant.

---

## Corrections (post-implementation, Task 12)

This spec is a canonical reference (see `CLAUDE.md`), so the two items below
are errata against what shipped, not a rewrite of the design.

- **Security — leading-dash requirement, superseded.** The paragraph above
  requires the URL "does not start with `-`". The implementation does
  something strictly stronger instead: it passes `--` immediately before the
  URL in argv, so a leading dash can never be read as a flag regardless of
  its value. It also passes `-c protocol.ext.allow=never` before the
  subcommand. *Why:* argv placement alone doesn't close the `ext::` hole —
  an `ext::` URL is remote-code-execution by design, and it's git's own
  transport, not something `--` can neutralize, if a user's own git config
  re-enables that protocol.

- **Destination-inside-a-repo check — bounded, not an ancestor walk.** The
  requirement "the destination is not inside an existing repository" shipped
  in a bounded form: the implementation checks whether the destination's
  *parent* is itself a repository working-tree root, not a full ancestor
  walk up to the filesystem root. *Why:* an ancestor-walking version was
  tried and reverted — a dotfiles-tracking `$HOME` made every destination
  underneath it unusable.

- **Destination-exists-and-non-empty — validated after submit, not before.**
  "Error placement" above (around line 176) describes this as inline
  validation that disables the submit button before anything is spawned.
  What shipped validates it in the backend instead, after the dialog submits.
  The stated intent — nothing spawned, no partial state, on this specific
  failure — still holds, since `validate_clone_target` runs and returns an
  error before `git clone` is ever invoked; only the mechanism differs. The
  submit button itself gates only on the fields being non-empty.

- **"Initialize submodules" defaults to ON, stronger than git's own default.**
  Not listed as a field in "Fields and behaviour" above. The checkbox in the
  Clone dialog starts checked, so a clone recurses into submodules unless the
  user opts out — git's own `clone` defaults to *not* recursing. Deliberate:
  it avoids the common surprise of an empty `vendor/` (or similar) directory
  after a clone that silently didn't fetch its submodules.
