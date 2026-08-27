# Backend deep dives

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`). `test/docs.test.ts` reads this set together with CLAUDE.md.

## Errors

- **Rust:** every IPC-crossing fn returns `AppResult<T> = Result<T, AppError>`;
  no unwrap/panic in commands; add `AppError` variants rather than stringify.
- **TS:** the `AppError` union (`src/lib/errors.ts`) stays 1:1 with the Rust
  enum, updated in the same commit. Wire format `{ kind, message }`
  (serde-tagged); consumers narrow on `kind`.
- Some variants carry an IDENTIFIER, not prose — `Auth` (a struct), `ForgeAuth`
  (a host), `BranchExists` (a name). `appErrorMessage` renders each into a
  sentence; a new variant of that shape needs a case there, or the banner reads
  `github.com`. `ForgeAuth` is deliberately separate from `Auth`: a bad API
  token must not pop the transport-credential dialog.
- **Two formatters, two voices** (#146): `describeError` for the LOG FILE
  (leads with the kind); `appErrorMessage` for a BANNER (never shows the enum
  spelling). `toAppError` (one definition) wraps for the five stores whose
  `error` field is an `AppError`; plain-string stores call `appErrorMessage`
  directly.
- **Neither formatter may throw or assume `message` is a string.** `invoke`
  logs a failure BEFORE rethrowing, so a logger exception replaces the original
  rejection — `isAuthError` fails to narrow and no credential prompt is raised.
  Coerce odd payloads (`describeUnknown`), never interpolate. Pinned in
  `errors.test.ts` + `tauri.errors.test.ts`.
- **"No text at this path" is a STATE for all three file readers**
  (`read_file_content`, `_at_rev`, `_at_index`), each needing an explicit
  non-blob KIND test: a `160000` gitlink oid names a commit in the SUBMODULE's
  ODB, so a lookup answers "object not found" — which all three did for every
  submodule-row click until `tests/file_content_absence.rs`. Absence is
  `Ok(None)`; genuine failures still error. The frontend sentinel is `null`,
  NOT `""` — whole-file mode would compose a file out of an empty string.

## Forge tokens are NOT git credentials (#92)

- `commands/net.rs::Credentials` answers one askpass prompt; a forge API token
  authenticates an HTTP header and persists. No shared struct, storage key, or
  code path — do not extend `Credentials` for a forge.
- Storage delegates to the user's git credential helper under
  `protocol=https`, `host=<forge-host>.platypusgit-forge.invalid`,
  `username=platypusgit-forge`. The `.invalid` namespace is load-bearing:
  GitLab and GHE share one host between API and git transport, so a bare host
  key would overwrite the push credential; RFC 6761 means no remote can ever
  ask for it. (A custom `protocol=` was rejected — osxkeychain silently
  `exit(0)`s on unknown protocols.)
- `git credential` runs with cwd = the OS temp dir, so a repo-local
  `credential.helper` cannot redirect token reads or writes.
- `store_token` **round-trips** (approve → fill → compare) and raises
  `ForgeTokenStore` naming the remedy when the token did not stick — a silently
  lost token means a secret typed for nothing.
- A token is a `forge::token::Secret`: no `Display`, no `Serialize`, `Debug`
  prints `Secret(***)`. `expose()` has exactly two call sites (auth header,
  credential-protocol writer) — grep before adding a third. No command returns
  a token; `forge_token_status` reports presence + login.
- `LfsUnavailable` and `NoBisect` are STATES, not failures (disable + explain /
  refresh). `DirtyWorktree` is reused for `git worktree remove`'s refusal → the
  second, type-the-name confirm.

## Interactive rebase engine

- **The plan is validated before the repository is touched:**
  `rebase_plan::validate` runs first in `rebase_start`; a rejection raises
  `InvalidRebasePlan` with HEAD, the branch ref, and the worktree untouched.
- **A plan may name a base the branch does not descend from — that is
  `git rebase --onto`** (186); `validate` puts no ancestry requirement on
  `onto`. Consequences:
  - `onto` reaches the run through TWO sites — `rebase_start`'s initial
    `set_head_detached` and `advance_rebase`'s per-step `move_to_base` — and
    either alone places the first step (verified by mutation; changing where a
    run starts means finding both).
  - The base attaches at SUBMIT via `withPlanBase`, never when rows are built —
    baked into a row, a reorder would carry it away (a bug that predates the
    diverged base). Null base (root commit / oldest step off the loaded log)
    keeps the parent fallback.
  - The frontend range is `commitsBetween(base, HEAD)` when diverged,
    `commitsSince` when the base is an ancestor, chosen by
    `aheadBehind.behind === 0`. `commits_since` keeps its ancestor requirement.
  - `commits_between`'s handler defaults `limit` to 200 and breaks at the cap —
    the limit is derived from `aheadBehind.ahead` and the length verified; a
    truncated plan is refused rather than planned.
- **The replay runs on a detached HEAD**; the branch ref moves exactly once
  (`finish_rebase`). Abort is "put HEAD back on the branch", not a reset to a
  remembered oid.
- `RebaseState.rewritten` maps original oid → replayed oid, recorded after the
  action's post-commit rewrite; a dropped step maps to the HEAD it left behind.
- **Merge commits take one of three actions:** `Drop` (flatten — git's
  default), `MainlinePick` (`cherry-pick -m 1`), or `Merge` (recreate from
  rewritten parents — the `--rebase-merges` equivalent).
  `rebase_plan::merge_legal` is the single source of truth;
  `MERGE_ACTIONS_FLATTEN`/`MERGE_ACTIONS_PRESERVE` in `Rebase.tsx` mirror it
  per mode and must stay in sync.
- Plans carry topology structurally (`onto` per step, a `Merge` step's original
  parents) — no `label`/`reset`/`exec` steps, no rebase-cousins mode.
- **A recreated merge runs in the worktree** (`repo.merge`, not
  `merge_commits`), so a conflict lands in the index with stages and the
  resolver works unchanged; `rebase_continue` commits with both parents.
  Original conflict resolutions are not reused (neither does git). Octopus
  merges cannot be recreated — drop or keep as one commit.
- **Preserve mode disables reordering** (git documents its own reorder bugs
  under `--rebase-merges`) and rebuilds whole-range plans in place while
  leaving targeted plans (squash/fixup/reword) alone — a rebuild would discard
  the typed message.
- **A `data-testid` on a plan row's child must not start with `rebase-row`:**
  WebdriverIO's `*=` form compiles to a SUBSTRING attribute test plus an
  innermost-match condition, so a child sharing the stem makes the row match
  nothing, silently. Hence `rebase-action`/`rebase-badge`. Invisible to jsdom
  (exact match).
- `PGRebaseRow` speaks exact `RebaseAction` strings (`"Pick"`, `"Drop"`,
  `"MainlinePick"`) — a two-word action cannot survive a lowercase round trip.
  Its action control is a PGSelect: drive with `jsPickOption` (e2e) /
  `pgPickOption` (component tests).
- **Every transition mirrors to `.git/platypusgit-rebase.json`**;
  `rebase_status`/`repo_state` fall back to it when this process did not start
  the rebase, and it outranks `repo.state()` (which only sees a paused step's
  `CHERRY_PICK_HEAD`).
- **A finished rebase leaves a summary the backend retains until acknowledged**
  (`RebaseStatus.last_completed`, a second file — everything that asks "rebase
  in progress?" answers by the first file's existence). `rebase_start` and
  `rebase_abort` drop it, `rebase_acknowledge` spends it; the Rebase screen
  renders from it and holds no copy (#47).
- `continue_operation`/`abort_operation` delegate to
  `rebase_continue`/`rebase_abort` whenever a rebase is in progress — two entry
  points, one engine; committing the resolved tree without advancing the plan
  strands the rest of the rebase.

## Network ops and credentials (#61 D5)

- **One runner.** Every network shell-out goes through
  `commands::net::run_git_authenticated` (clone uses its primitives
  `apply_auth_env` + `map_git_failure` for a streamed stderr): fetch, fetch_all,
  pull, push, push_tag, push_delete_branch, clone_repo,
  forge_checkout_pull_request's fetch (its second git call passes `None` — the
  tip is already local), submodule_update, lfs_fetch/lfs_pull.
  `grep -rn 'run_git_authenticated\|run_git_creds\|apply_auth_env' src-tauri/src/`
  is the authoritative list. New network ops join it; on the frontend that
  means `useRepoStore`'s exported `withAuthRetry`, never a private copy.
  Deliberately credential-less: `branches.rs`'s local `run_git`
  (merge/rebase/checkout), `run_git_capture`, and the direct `git credential` /
  `git rev-parse` spawns (no remote contact; the runner would set `GIT_ASKPASS`
  and change `git credential`'s semantics).
- **Retry, never prompt mid-run:** the first attempt is always prompt-less. A
  failure classified by `git/auth.rs::classify_auth_failure` becomes
  `AppError::Auth(AuthChallenge)`, raised through `useAuthStore`, and the SAME
  closure re-runs with credentials — put `refreshAll()` INSIDE the retried
  closure. Host-key verification failure stays `Network` (no typeable
  credential fixes it).
- **`withAuthRetry` resolves once the challenge is RAISED, not when the retry
  finishes** — a boolean cannot distinguish "failed" from "prompt is up", and a
  caller would stack a dialog on the prompt. `useForgeStore.checkout` returns a
  `CheckoutOutcome` (`ok`/`branch-exists`/`auth-pending`/`error`) for exactly
  this; `useCreateStore` hand-rolls the shape for clone.
- **Scrub before surfacing:** `map_git_failure` runs `scrub_credentials` first,
  on both branches — git echoes remote URLs, and userinfo ends at the LAST `@`
  (splitting on the first leaks a password containing `@`).
- **Secrets travel in the environment, never argv** (argv is world-readable via
  `ps`). `GIT_ASKPASS` points at our own bare executable with the mode in
  `PLATYPUSGIT_ASKPASS` (askpass is exec'd directly, no args); the shim answers
  on stdout and prints nothing else.
- **End option parsing with `--` before any user-supplied value** — a value
  starting with `-` is otherwise an option (`git push --receive-pack=<program>`
  is argument injection). `push_tag_args`/`push_delete_args` emit it, tested.
  `push_args` does NOT yet — its force flag is documented last, which `--`
  would turn into a refspec; fixing it is its own change.
- `credential_approve` refuses values containing a newline rather than escaping
  them — the credential protocol is line-based, so a newline injects keys and
  could file a password against another host.

### Cancelling a stalled network op (#234)

- **One cancel path, at the same two choke points as the credential policy.**
  `cancel.rs` is a process-wide registry; `run_git_authenticated` and
  `run_clone` each register for as long as they run, so a network op that uses
  the one runner inherits cancellation with nothing to remember. A second spawn
  site would be an op nobody can stop, the same way it would be an op nobody can
  authenticate.
- **Registered by SCOPE, not by op id** — `Scope::Clone`, or
  `Scope::Repo(workdir)`. The UI has one of these in flight per scope by
  construction (`busy`, `activity`), and the auto-fetch timer's stacked fetches
  are ops the user never started and cannot point at; cancelling a scope reaches
  the whole pile. `Scope::Repo`'s path comes from `GitBackend::repo_path`, which
  is where the ops themselves get their `cwd` and where `cancel_network_op`
  resolves a `repo_id` — **the three must keep agreeing** or Cancel silently
  matches nothing.
- **`AppError::Cancelled`, never `Network`.** A SIGKILLed git's dying stderr
  says "early EOF" / "the remote end hung up unexpectedly"; routed through
  `Network`, a user who pressed Cancel is told their connection broke. The
  frontend drops it in `useRepoStore`'s `setErrorFor` (one place, so a network op
  added later cannot forget) and in `useCreateStore`'s clone catch.
- **Check `is_cancelled()` after the child exits, not just in the `select!`.**
  A cancel landing as git dies of its own accord loses the race, and the request
  is what decides the outcome, not who got there first.
- **A cancelled clone removes its partial destination**, and puts back an empty
  directory the user had picked. A SIGKILLed `git clone` cannot run its own
  cleanup, and the leftovers fail the NEXT attempt's `validate_clone_target`
  with "already exists and is not empty" — a cancel button whose real effect is
  to poison the destination. Safe to delete only because `validate_clone_target`
  already refused anything but "absent" or "empty": kill and **reap** first
  (`kill_and_reap`), so git is provably not still writing into it.
- **What it does not kill:** git's own transport helper (`git-remote-https`,
  `ssh`). It is git's child, not ours, and a SIGKILLed parent cannot take it
  along; it exits when its pipes close, which for a helper blocked on a network
  read means when that read times out. Closing that gap means killing the process
  group — a platform-specific kill path through the one sanctioned spawner —
  and is deliberately not done. The user-visible hang is gone either way.

## "No telemetry, no account" is a build gate (#226)

- The README advertises three promises as the reason to choose this app: no
  telemetry, no account, and no outbound traffic beyond your git remotes, the
  update check, and forge APIs you configured. `tests/no_telemetry.rs` is what
  keeps them true — a source-text guard in the shape of `spawn_no_window.rs`.
- **The app has exactly TWO outbound HTTP call sites**, and `ureq::` may not
  appear outside them: `update.rs` (the update check) and `forge/http.rs` (the
  only impure file in `forge/`, talking to the host the user configured). A
  third one means the README's disclosure is incomplete — the test says so, and
  names the file. `ureq` is also pinned as the only *direct* HTTP client;
  `reqwest` and `hyper` sit in `Cargo.lock` via Tauri itself, which is why the
  check reads `Cargo.toml`, not the lock.
- **Every hostname in `src/` is on an allow-list with a written reason.** Adding
  one is the review checkpoint: you are recording, in public, another host the
  binary knows about. Only `api.github.com` is a real destination; the rest are
  a spec URI, credential-prompt fixtures and RFC 2606 names. Self-hosted forge
  hosts arrive at RUNTIME off the user's remote (`forge/remote.rs`) — do not let
  the list tempt you into baking one in.
- The updater endpoint list, the `Cargo.lock` analytics denylist, and the
  webview capabilities (no `http:` permission — a webview-side client would
  route around every guard here) are pinned in the same file.
- **The frontend half is `test/privacy.test.ts`, and the split is load-bearing**
  — `tests.yml`'s `js` filter does not match `src-tauri/` and its `rust` filter
  does not match `README.md`, so one test over both trees would be skipped by
  exactly the change it polices. See `docs/dev/testing.md`.

## Signing: one chain for commits and tags (#61 D6, #132)

- **One chain, two callers:** `libgit2.rs::sign_payload` =
  `resolve_signing` → `signing::resolve_key_file` → `signing_args` →
  `run_signer`; `commit_signed` and `create_signed_tag` both call it. The ssh
  key-PATH restriction (`key::…` and bare `ssh-…` literals refused) lives in
  `resolve_key_file` — a second chain is how it holds for commits and lapses
  for tags.
- **A signing failure creates nothing, ever:** both writers move the ref LAST,
  after the signature exists. No unsigned fallback.
- **`git2` has no `tag_signed`:** `create_signed_tag` builds the canonical
  unsigned annotation (`tag_annotation_create`), reads its bytes from the ODB,
  signs those, appends the armor and writes a second object — byte-for-byte
  libgit2 serialization, no hand-rolled tagger formatting. (Cost: the unsigned
  annotation is gc-collected.) Shelling out to `git tag -s` was rejected — it
  does its own key resolution and would accept the `key::` literals commits
  refuse.
- `create_signed_tag` early-returns on an existing `refs/tags/<name>` BEFORE
  signing (a duplicate would take a passphrase and then fail); the atomic
  `force = false` ref write stays the real guarantee.
- **Signing implies annotated:** `sign: Some(true)` with no annotation is
  `InvalidArgument`, never a silent downgrade. A bare `tag.gpgsign` does NOT
  promote a lightweight tag (real `git tag v1` fails there too; a blank
  annotation field *means* lightweight).
- `commit.gpgsign` and `tag.gpgsign` are separate keys, as in git; `sign: None`
  follows the matching one.
- **`%G?` is a COMMIT placeholder — never use it for a tag** (`git show <tag>
  --format=%G?` grades the commit; `%(signature:grade)` is empty for tag
  objects). `verify_tag` uses `git verify-tag --raw` + `tag::parse_verify_tag`.
  Neither exit status nor text alone suffices: a valid signature from a key
  outside `allowedSignersFile` exits non-zero while grading `G`/`U`. The
  `[GNUPG:] ` prefix is required when matching gpg status tokens, and they
  arrive on **stderr** — read both streams.
- **"No false Good" belongs to the parser:** an SSH `Good` is refuted by a
  non-zero exit + `Could not verify signature`; a key outside
  `allowedSignersFile` is `UnknownKey` for a TAG (the commit path's `U` → Good
  mapping is a known gap with its own issue — do not copy it). There is no SSH
  `Revoked` branch: git emits only `Could not verify signature.` for a revoked
  key (measured, git 2.50.1 + OpenSSH 10.2).
- **Verdicts are lazy, presence is free:** `TagInfo.signed` is read during the
  existing walk (no subprocess); the graded badge verifies the SELECTED object
  only — a verdict per row is a signer process per row.

## Stash: two addresses, one destructive trap (#133)

- **`StashInfo` carries `index` AND `oid`, not interchangeable:** `index` is a
  reflog position and ANY write to `refs/stash` shifts it — a rename shifts it
  itself. `stash_drop` and `stash_rename` take BOTH, re-read and compare before
  mutating (`StaleStash` on mismatch); a COMPARISON takes the oid alone. Every
  UI path already has the oid — thread it, never assert past it.
- **Verify and mutate under ONE lock acquisition:** `with_repo_mut` holds the
  repos mutex per closure, so check-then-mutate across two acquisitions is a
  TOCTOU — and that mutex serialises every backend op, so a concurrent command
  is parked to run exactly at the boundary. Hence `stash_drop_at` /
  `stash_finish_rename`; `stash_pairs`/`stash_entry_at` take an
  already-borrowed `&mut Repository` (std's Mutex is not reentrant). Live
  concurrent writers exist (the reflog screen's auto-stash) — not theoretical.
- **`git stash store <oid>` is a SILENT no-op when `refs/stash` already points
  at `<oid>`** — exactly `stash@{0}`, the likeliest rename target; a
  store-then-drop rename would destroy the top stash while reporting success.
  `stash_rename` stores a **fresh commit** (same tree/parents/signatures, new
  message — which also keeps the commit message in step with the reflog
  message). Pinned by `tests/stash_rename.rs`, including a test of the git
  behaviour itself.
- **Additive first, destructive last, gated:** store → verify
  (`stash::rename_store_landed`) → drop. A failure anywhere yields a DUPLICATE
  the user can remove, never a gap. Do not simplify the verification away. A
  rename moves the entry to the top (the reflog is prepend-only); the UI says
  so and re-reads the list.
- **The third parent is where `git stash -u` lives**, unreachable by tree-level
  diffs of the stash commit. `stash_diff` folds it in explicitly (its tree vs
  the EMPTY tree); `stash-vs-wt` cannot, so it excludes untracked on BOTH sides
  and says so. Any new stash comparison decides this out loud.
- **Pathspec ops set `GIT_LITERAL_PATHSPECS=1`** on top of the `--` rule — `--`
  only ends option parsing, and git still reads a leading `:` as pathspec
  magic, so a file named `:(exclude)weird.txt` would stash the WHOLE worktree.
  Pinned by a test confirmed to fail without the env var. The only shell-out in
  the app passing a pathspec — do not enable the flag globally.
- **`git stash push` exits 0 when it saves nothing** — entry creation is read
  off `refs/stash` before/after, never the exit status. `Ok(None)` is a state.
- **Hunk-level partial stash is deliberately absent:** the `--staged`
  composition rewrites and restores the index around a subprocess, and an
  interruption silently reduces the index to the selection — staged work has no
  other copy anywhere. Crash-safety needs a journal and its own spec; do not
  stub an affordance meanwhile.

## Deleting an untracked file (#245)

`GitBackend::delete_untracked` is on the trait despite being an unlink rather
than a git call, because every check it depends on is a git question — does the
index know this path (at ANY stage: a conflicted file lives at 1/2/3), is the
entry an embedded repository — and the verify has to happen under the SAME lock
acquisition as the mutation. Only an implementation holding the per-repo lock can
do that; a command reading `status()` and then unlinking is the stash TOCTOU
again. `commands/repo.rs::delete_untracked_files` is therefore thin.

- **It is not `discard` with a nicer name.** Discard RESTORES a tracked path from
  the index and only deletes an untracked one. Delete refuses a tracked path
  outright, because a menu entry labelled "Delete file…" that reverted a file
  instead is the worst surprise available on a destructive action.
- **Containment is proven against the filesystem, not the string.**
  `opener::resolved_workdir_path` canonicalizes BOTH sides (the workdir too — on
  macOS a tempdir lives under `/var`, itself a symlink) and re-checks with the
  pure component-wise `contained_in`. The lexical `safe_workdir_path` cannot see
  a symlink: `repo/out -> /etc` makes `out/passwd` an innocent-looking relative
  path with no `..` in it. Only the PARENT is canonicalized and the last
  component re-joined, so a file that is already gone still resolves — its
  absence is the caller's to report. A symlink whose target leaves the worktree
  is refused, and so is one that cannot be resolved at all.
- **Containment runs BEFORE the index is touched**, and not only for tidiness:
  `git2::Index::get_path` PANICS on a path that is absolute or starts with `..`
  (it unwraps its own `path_to_repo_path`). `discard` orders itself the same way.
- **Two phases.** Everything decidable without touching the disk (tracked,
  escape, embedded repo, directory) is validated for the WHOLE batch first and
  fails all of it — a refusal must never leave a half-deleted selection, or a
  crafted path becomes discoverable by noticing the three files before it are
  gone. Then the unlinks run BEST-EFFORT, one `DeleteFailure` per path the OS
  refused: three read-only files in a ten-file selection must not decide the fate
  of the other seven.
- **Files, not trees.** A real directory is refused; a recursive delete is a
  different and far more dangerous op, and libgit2 recurses untracked directories
  in `status()` anyway, so every untracked row the UI shows is a file. Symlinks
  are unlinked as links (with a `remove_dir` fallback for the Windows
  directory-symlink case), never followed.

## Spawning processes (issue 172)

- **Never write `Command::new` outside `src-tauri/src/proc.rs`** —
  `tests/spawn_no_window.rs` fails the build; its allow-list names the two
  permitted files (the module itself, `detach.rs`'s `#[cfg(unix)]` re-exec)
  with reasons.
- The reason is Windows: release builds are GUI-subsystem
  (`windows_subsystem = "windows"`), so every console child (`git.exe`,
  `gpg.exe`, `powershell.exe`) gets a fresh visible conhost window unless
  created with `CREATE_NO_WINDOW`. Reproduces only in release/bundled builds —
  a debug build owns a console, so `pnpm tauri dev` concludes there is no bug.
- **Constructors, not a helper** (a helper is forgettable, and 19 of 20 spawn
  sites forgot): `proc::git`/`git_async` carry the flag,
  `GIT_TERMINAL_PROMPT=0` and a closed stdin; `git_async_in` is the clone shape
  (cwd instead of `-C`); `program`/`program_async` apply the flag only. Later
  builder calls win, so a caller piping stdin just overrides the null.
- **The two console-KEEPING exceptions are deliberate:**
  `git_async_keeping_console` (`git mergetool`) and
  `program_async_keeping_console` (`$VISUAL`/`$EDITOR`) — a console mergetool
  or `EDITOR=vim` IS a terminal program; silencing it leaves an invisible
  process holding the file forever. A stray console window is cosmetic; an
  invisible editor is Task Manager. The guard test allow-lists both call sites
  by name.
- **Pin Windows system executables to an absolute path.** `CreateProcess`
  searches the **current directory before the system directory**, and this
  app's cwd *is* a repository whenever the `pgit` shim launched it from inside
  one — so a bare `rundll32.exe` / `explorer.exe` / `cmd.exe` lets a cloned
  repo ship its own copy and have it run. `opener.rs::opener_program` pins via
  `%SystemRoot%\System32`; `reveal.rs::system32_exe` does the same, and
  `wt.exe` (an App Execution Alias, not a System32 binary) is pinned under
  `%LOCALAPPDATA%\Microsoft\WindowsApps` or skipped. Unresolvable beats
  relative: a missing pin falls back to the next candidate.
- **Decide with libgit2 before you spawn:** `verify_commit` reads the `gpgsig`
  header via `extract_signature` and answers `SigState::None` with no
  subprocess (same pre-check `verify_tag` has) — a cost win on every platform,
  and the question to ask of any new shell-out.

## Bisect: git's state is the only state of record (#93)

- **There is no `.git/platypusgit-bisect.json`, and there must not be:** every
  transition is a `git bisect` invocation, so git owns `BISECT_START`,
  `BISECT_LOG`, `BISECT_TERMS` and `refs/bisect/*` — a second record could only
  disagree. The exact inverse of `rebase_state.rs`, which exists because the
  app drives the replay and git cannot finish it. Reading git's files also
  makes a bisect survive an app restart and adopt one started in a terminal
  (`tests/bisect.rs` pins both with a fresh backend).
- `RepoState::Bisect` came free from libgit2 (off `BISECT_LOG`); the work was
  `bisect_status` and the actions.
- Progress comes from `git rev-list --bisect-vars` (`bisect_nr`/`bisect_steps`) —
  git's own arithmetic, recomputable at any time. **Read the terms from
  `BISECT_TERMS`**, never assume "bad"/"good" (`refs/bisect/<term>` is named
  after them). Convergence is `bisect_rev == refs/bisect/<bad>`; HEAD then sits
  on the last commit *tested*, so the UI must NAME the culprit.

## Async / threading

- `git2::Repository` is `Send` but not `Sync`. Each opened repo is
  `Arc<Mutex<Repository>>` inside a `Mutex<HashMap<RepoId, …>>`; `with_repo`
  clones the Arc and RELEASES the map lock before the op — different repos run
  in parallel, same-repo ops serialize on the inner mutex (the stash TOCTOU
  note relies on this). `close` is the only removal.
- Always wrap git2 work in `spawn_blocking` from Tauri commands — don't block
  the async runtime.

## Reading the log (#274)

Where it is — `tauri_plugin_log`'s `LogDir` target, i.e. Tauri's `app_log_dir`:

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Logs/io.github.jonassaa.platypusgit/platypusgit.log` |
| Linux / WSL | `~/.local/share/io.github.jonassaa.platypusgit/logs/platypusgit.log` (`$XDG_DATA_HOME` if set) |
| Windows | `%LOCALAPPDATA%\io.github.jonassaa.platypusgit\logs\platypusgit.log` |

**Settings → Diagnostics shows this path and copies the tail** — ask a reporter
for that rather than reciting a path, which is how a diagnosis once came down to
comparing `resolved child PATH (N chars)` against a known log to work out which
machine had written it.

### What the levels mean for you

`lib.rs` pins the file at `Info` and raises only `platypusgit_lib` to `Debug`.
Webview `debug()` calls — **every successful invoke** — are therefore dropped.
Consequences worth internalising before reasoning from a log:

- **Absence of an invoke line proves nothing about whether it ran.** A fast,
  successful call is invisible. Only `slow:` (≥250 ms), `failed:` and
  `still pending` lines survive.
- Timestamps are **UTC**. Compare against the file's mtime to find a session.
- A duration far larger than any plausible operation (`slow: 1052465ms`) is a
  **suspended machine**, not slow git — the promise resolved after wake.
- A run of invokes with near-identical durations completing in the same second
  is **one blocker draining a queue**, not N slow calls: same-repo ops serialize
  on the inner mutex (see Async / threading). A monotonic ladder
  (18s → 22s → 30s → …) is the same thing seen as it builds.

### Triaging "it will not open my repository"

`open_repo` logs on the way IN, so three previously identical silences now read
differently:

| Log shows | Means |
| --- | --- |
| `folder picker failed: …` | the native picker itself would not open — on Linux usually no `xdg-desktop-portal`. `open` is plugin-dialog's own IPC call, so it is invisible to the invoke wrapper AND the stall watchdog; `features/repo/ops.ts` catches it explicitly because every caller is a `void openRepoDialog()` whose rejection would otherwise be unhandled and leave no trace at all |
| no `open_repo` line and no picker line | the user cancelled the picker (a `null` resolve, deliberately not logged), or the frontend never dispatched |
| `open_repo <path>` and nothing after | libgit2 still working, or wedged. The webview's `still pending after 10000ms` confirms it, and the path says which filesystem |
| `open_repo <path>` then `open_repo failed for <path>: …` | an ordinary error with a reason — always the easy case |

The webview's stall watchdog (`src/lib/tauri.ts`) is what makes the middle row
readable: it is the only line either side logs **while** a call is outstanding.
Every other line is written after the fact, which is precisely why a hang used
to leave no trace at all.

### Environment header

One `host os=… arch=… kernel=… wsl=… git=…` INFO line per launch, from
`diagnostics::environment_line`. Emitted on the PATH-probe thread *after* the
probe, so `git=` names the git the app will actually spawn — read earlier, a
user whose git lives only on the login `PATH` would be told `git=UNAVAILABLE` by
an app that runs git perfectly well. `git=UNAVAILABLE` is spelled out rather
than omitted (unlike the other fields) because it pre-explains every git failure
below it.

A repository under `/mnt/<drive>` on WSL also logs a WARN: it is a Windows
filesystem over a VM boundary, every libgit2 `stat` crosses it, and a `/mnt/c`
repo measured 9.8s on the startup fan-out. Not an error — the repo works — but
an unexplained nine-second launch reads as a broken app.

## The hook chain

Commit-side hooks run in `Libgit2Backend::commit`, one per name, through
`git/hooks.rs` — the only place a hook is spawned. The order is load-bearing:

    pre-commit → read index → write tree → prepare-commit-msg → commit-msg
    → build/sign/move ref → post-commit

- **`pre-commit` runs before the index is read, and outside `with_repo`.** A hook
  that runs `git add` (lint-staged: reformat, restage) mutates the on-disk index,
  and only a read that happens afterwards sees it. Running it outside the lock
  also means a hook shelling out to git cannot deadlock against us.
- **`index.read(false)` after `repo.index()` is required, not incidental.**
  `with_repo` hands back a *cached* `git2::Repository`, and libgit2 keeps its
  index in memory — so reading the index after the hook still returned the
  pre-hook snapshot, and a reformatting hook's work was silently dropped.
  `tests/hooks.rs::a_pre_commit_that_restages_is_honoured` found this and pins
  it; it fails if either the read or the reload moves.
- **A non-zero `pre-commit`, `prepare-commit-msg` or `commit-msg` creates
  nothing** — no object, no ref move — the same guarantee the signing chain
  makes, for the same reason. The index is deliberately **not** rolled back: a
  hook that restaged did work the user wants, and git does not undo it either.
- **`post-commit`'s exit code is discarded**, because git discards it. Reporting
  a commit that exists as failed sends the user hunting for work that landed.
- **The final message is the hook's, not the user's.** `commit-msg` may rewrite
  `$GIT_DIR/COMMIT_EDITMSG`, so `commit` returns
  `CommitResult { oid, message }` and the panel shows what actually landed.
- **Sign-off is applied before any hook sees the message**, matching
  `git commit -s` — verified against real git, so a hook validating trailers sees
  what git would show it.
- **`prepare-commit-msg` gets source `message` and two arguments, amend
  included.** The source is `commit` (with the object as `$3`) only when the
  message is taken *from* a commit, as with `-c`/`-C` or a bare `--amend`; we
  always supply it as text.
- **`no_verify` skips all four.** Per-invocation, never persisted — a "skip once"
  that silently becomes "never run hooks again" is a worse version of the bug
  that running hooks fixes. `push_args` grows `--no-verify` for `pre-push`.
- **Support is detected, never inferred from a version string.**
  `git hook run --ignore-missing <a-hook-name-that-cannot-exist>` exits 0 on a
  git that has the subcommand and non-zero on one that does not, with no side
  effects. Probed once, cached.
- `AppError::HookRejected` carries the hook's name and its output as separate
  fields, because the output renders *as output* — not as a banner.

### The `PATH` every child gets

`proc.rs` resolves the user's login-shell `PATH` once, caches it, and applies it
to every child it constructs. Without it a hook calling `node`, or a
`gpg.program` in `/opt/homebrew/bin`, works or fails depending on whether the app
was launched from a terminal or from the Dock.

Two things about it that are easy to get wrong:

- **It is a union — login entries first, then the inherited `PATH`.** Measured:
  `Command::env("PATH", …)` governs where the child *binary itself* is looked up
  and uses only that value, never the parent's. Assigning the login `PATH`
  verbatim would break `Command::new("git")` for anyone whose login `PATH` lacks
  git's directory — a regression caused by the fix.
- **Children no longer inherit a `PATH` this process changes at runtime.** That
  is the point, but it means a test that stubs a binary by mutating `PATH` has to
  starve the probe first; `tests/verify_commit_no_spawn.rs` does, with a comment.
- **`child_path()` is a non-blocking cache read; `warm_child_path()` is the only
  resolver**, called once on a background thread from `run()`'s setup. Resolving
  inside the reader would make the FIRST spawn of the session wait for a login
  shell to run the user's rc files — a slow `.zshrc` (nvm, a network mount) would
  then stall their first git operation by up to the probe timeout. The window
  before the probe lands fails safe: those spawns inherit our environment, which
  is exactly the pre-feature behaviour. `proc.rs`'s
  `only_warm_child_path_resolves_the_probe` guards this at the source level,
  because a timing test in a parallel test binary gets warmed by a sibling and
  passes vacuously.
