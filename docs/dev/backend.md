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
- **A host holds MANY accounts (#233).** The host key stays shared (it is what
  keeps the API token off the transport credential), so the ACCOUNT is carried
  by `username=`: `credential_username(None)` is the bare `platypusgit-forge` a
  pre-#233 build stored every token under and must stay byte-identical, and
  `Some(id)` appends `:<id>`. The id is opaque, not the login — a forge login
  can be renamed while the token stays valid, and a login-keyed entry would
  orphan it. `ForgeTokens` is keyed `(host, account)` and `forge_sign_out`
  erases ONE slot, so signing out of the work account leaves the personal one
  signed in. Frontend side: `features/forge/forgeAccounts.ts`.
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
  pull, push, push_tag, push_delete_branch, fast_forward_branch,
  fast_forward_all_branches, unshallow, clone_repo,
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

### Cancelling a stalled network op (#234, hardened by #263)

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
- **`cancel()` kills by pid, from the cancelling call's own task — not through
  the op's `Child`.** The obvious shape, a `select!` over `child.wait()` and a
  cancel future, needs `&mut child` in both arms; `Arc<Mutex<Child>>` deadlocks,
  since the op holds the lock across the very `wait()` the killer needs to
  interrupt. So `Registration::attach(pid)` records the pid in the registry, and
  `cancel(scope)` signals it directly via `kill_tree`. The op's task never calls
  `select!`; it just notices that `wait()`/`wait_with_output()` returned because
  the child died, and checks `is_cancelled()` before trusting git's exit.
- **`SIGTERM` to the process group first; `SIGKILL` on a second cancel of the
  same op.** `SIGKILL` is uncatchable, so a SIGKILLed git never runs
  `remove_lock_file_on_signal` (`lockfile.c`) — a cancel landing mid-fetch could
  strand `.git/FETCH_HEAD.lock`, and the NEXT fetch fails with "File exists".
  `proc::git_async`/`git_async_in` put the child in its own process group
  (`process_group(0)` on unix); `kill_tree` signals the WHOLE group, which is
  what actually reaches `git-remote-https`/`ssh` — git's own child for the
  transfer, invisible to a kill of `git` alone. `kill_tree` checks
  `getpgid(pid) == pid` before `killpg`, so a future spawn site that forgot
  `process_group(0)` degrades to a single-process `kill` instead of signalling
  OUR OWN process group. The second click is the escalation signal — no timer,
  no rule for how long the first gets. **That puts a requirement on the UI:**
  the first click has to visibly change something, or an impatient double-click
  reaches `SIGKILL` in a few hundred milliseconds and strands the lock file
  this whole path exists to protect. `cancelRequested` and the
  "Cancelling…"/"Force stop" labels are that half — see `docs/dev/frontend.md`. Windows has no `SIGTERM` and a
  `CREATE_NO_WINDOW` child has no console for `GenerateConsoleCtrlEvent`, so
  there `kill_tree` is always `taskkill /F /T`; git gets no chance to clean up
  its lock files on Windows, a known and accepted gap, not one this closes.
- **`AppError::Cancelled`, never `Network`.** A killed git's dying stderr says
  "early EOF" / "the remote end hung up unexpectedly"; routed through
  `Network`, a user who pressed Cancel is told their connection broke. The
  frontend drops it in `useRepoStore`'s `setErrorFor` (one place, so a network op
  added later cannot forget) and in `useCreateStore`'s clone catch.
- **Check `is_cancelled()` after the child exits, always.** A cancel landing as
  git dies of its own accord must still win: the request is what decides the
  outcome, not who got there first.
- **Closing the app's window cancels everything in flight** (`cancel_all`, wired
  to `WindowEvent::CloseRequested` in `lib.rs`). `kill_on_drop(true)` is the
  backstop for a DROPPED future, and quitting drops nothing: `tao::EventLoop::run`
  is `-> !` and ends in `std::process::exit` on macOS, Linux and Windows alike,
  which runs no destructor on any stack. Measured before the fix: a
  `kill_on_drop` child was **still alive 500 ms after its parent's
  `process::exit(0)`** — so a `git clone` outlived the app and carried on
  populating the destination the Clone dialog had already reported as never
  created. Two rules on the handler: it is **gated on `window.label() == "main"`**
  (`cancel::close_cancels_everything`), because `on_window_event` is app-global
  and closing the `merge` resolver must not stop a fetch; and it sends
  **`SIGTERM` only, never the escalation**, because git's own
  `remove_lock_file_on_signal` / `remove_junk_on_signal` is the only cleanup
  still possible once our process is gone. `tests/cancel_on_close.rs` pins all
  three, the last of them by greping `lib.rs` — the closure needs a Tauri runtime
  no `cargo test` has. **`CloseRequested` is not every way out**: tao emits it
  from `windowShouldClose:` only, so ⌘Q on macOS
  (`applicationWillTerminate` → `LoopDestroyed`) never reaches it. So the app is
  built with `build()` + `App::run(cb)` — the documented expansion of
  `Builder::run(context)` — and `RunEvent::Exit`/`ExitRequested` calls
  `cancel_all` too. Being reached twice on the ordinary close path is free:
  `cancel_all` never escalates, and a finished op is already out of the
  registry.
- **A cancelled clone removes its partial destination**, and puts back an empty
  directory the user had picked. Even with `SIGTERM` giving git a chance to run
  its own cleanup, the leftovers (a `SIGKILL` escalation, or Windows) fail the
  NEXT attempt's `validate_clone_target` with "already exists and is not
  empty" — a cancel button whose real effect is to poison the destination. Safe
  to delete only because `validate_clone_target` already refused anything but
  "absent" or "empty": **reap** first (`child.wait()`), so git is provably not
  still writing into it, before the directory is touched.

### Reporting progress from a long op (#296)

- **`--progress` or there is nothing to report.** Git writes its sideband
  progress only when stderr is a tty, and it never is here. `fetch_args` and
  `push_args` carry the flag unconditionally; a caller with no sink just
  discards the ticks. Forgetting the flag is the silent failure mode — the code
  looks wired up and no tick ever arrives.
- **One parser and one byte-splitter, in `progress.rs`.** Clone had both
  privately first. The splitter breaks on `\r` **as well as** `\n`: git redraws
  a progress line with a bare `\r`, so `read_until(b'\n')` buffers a whole phase
  and releases it in one burst — the bar freezes, then jumps. It also bounds an
  undelimited line and keeps the non-progress lines as the failure tail.
- **The failure message comes from that tail, not from raw stderr.** Progress
  redraws are filtered out of it, so `classify_auth_failure` and
  `host_from_stderr` see git's actual words instead of five hundred copies of
  "Receiving objects". Every non-progress line is kept, which is what those two
  need; the cap keeps the NEWEST lines, because git puts its `fatal:` last.
- **`run_git_authenticated` drains stderr by hand, so stdout goes to
  `/dev/null`.** It always discarded stdout; `wait_with_output` was there to
  drain both concurrently and avoid a deadlock. With one pipe to read, nulling
  the other removes the hazard rather than managing it.
- **Cancellation still works because a stalled fetch sits in that read loop.**
  The wait used to be one `wait_with_output`; it is now many reads, and a stalled
  transfer sits in exactly one of them. #296 raced each read against a cancel
  token with `select!`; #263 removed that, because returning early DROPS the
  `Child` and `kill_on_drop` is a `SIGKILL`. The kill is out-of-band now (by
  pid, from the cancelling task), and the read returns because the pipe closed
  underneath it.
- **Rebase reports through a sink on the trait, not an `AppHandle` on the
  backend.** `rebase_start_with_progress` / `rebase_continue_with_progress` take
  a `RebaseProgressSink`; the old names remain as default methods delegating
  with a no-op. That keeps 66 existing call sites untouched, keeps
  `GitBackend` object-safe (`AppState` holds an `Arc<dyn GitBackend>`), and
  keeps the ticks assertable from a plain `cargo test` — see
  `tests/rebase_progress.rs`.
- **A tick fires BEFORE its step is applied**, and `next_index` is the count of
  steps already done — the same value `RebaseStatus.next_index` carries, so one
  `+ 1` renders both. Drops tick too: they are part of `total`, and skipping
  them would freeze the counter on a plan that is in fact advancing.

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

## Image previews: the only reader that returns BYTES (#224)

- **`read_image_preview` is the fourth file reader**, and the only one that can
  feed an `<img>`: `FileContent.text` is `None` for a binary blob *by contract*,
  so `read_file_content`, `_at_rev` and `_at_index` structurally cannot. It
  takes a `BlobSource` (`worktree` / `index` / `rev` / conflict `stage`) rather
  than a nullable revspec — a sentinel meaning three things is how call sites
  get it wrong — and answers `AppResult<Option<ImagePreview>>`.
- **Bytes cross IPC as base64, in the ordinary JSON payload.** Tauri serialises
  a `Vec<u8>` as a JSON array of decimal numbers, ~5 bytes on the wire per byte
  of image, so raw bytes were never the cheap option. The alternatives were a
  raw `tauri::ipc::Response` (cannot also carry the sniffed media type, and
  steps outside the `AppResult<T>` contract) and a custom URI scheme (a protocol
  registration, a scope and a CSP, for a payload the ceiling already bounds).
  Base64 costs ~1.33x and lands as the exact string a `data:` URL wants, so the
  frontend concatenates it into an `src` with no decode and no second copy.
- **The extension never decides.** `git/image.rs::sniff` reads magic bytes only,
  and every rule checks enough of the header to be a real answer — a truncated
  `\x89PNG` is `NotAnImage`, `BM` needs its reserved field zero, an ICONDIR
  needs a non-zero image count. A repository is untrusted input, and a broken
  `<img>` is worse than a sentence.
- **SVG is recognised and REFUSED**, as its own `UnsupportedReason::Svg` so the
  UI can say so rather than looking broken. It is the one format on the list
  that is not inert (script, `<foreignObject>`, external `href`/`url()`,
  `@import`), and `tauri.conf.json` ships `"csp": null` — so there is nothing
  behind whatever the engine's `<img>` secure-static-mode does, and one engine
  bug or one refactor to inline SVG is script execution against unrestricted
  IPC. Sanitizing XML with a text scan is not a boundary worth pretending to
  have. The argument lives in `git/image.rs`'s module doc; change it there.
- **The ceiling is applied to the DECLARED size** — `metadata().len()` for the
  worktree, `Blob::size()` for a blob — so an oversized asset is never read,
  never encoded and never crosses IPC. It comes back as `TooLarge` carrying the
  size and the limit. Sniffing first and measuring after would defeat the point.
- **The worktree source does NOT fall back to HEAD**, unlike `read_file_content`.
  A preview *pair* asks for each side by name; the fallback would paint the old
  image into the "new" slot and claim a delete changed nothing.
- **An LFS pointer resolves to its object by PATH**, not by shelling out:
  `image::lfs_object_path` builds git-lfs's own `objects/aa/bb/<oid>` fan-out
  under `lfs.storage` (default `.git/lfs`). Asking the `git lfs` binary would
  refuse a perfectly readable object on a machine where git-lfs is not
  installed, and it would put a spawn on a preview path. The oid comes from a
  pointer file in an untrusted repository, so the builder refuses anything that
  is not plain lowercase hex. An object that is not there answers `LfsMissing`
  — never the pointer's own three lines.
- Absence stays a **state** on every source (`Ok(None)`), the #146 rule: an
  added file has no old side. A bad revspec or an unknown repository still
  errors. Pinned by `tests/image_preview.rs`; the sniffing table is unit-tested
  in `git/image.rs` with no repository at all, the `reveal.rs` model.

## SSH keys: showing one, and making one (#248)

- **The other half of "clone over SSH failed".** `git/auth.rs` classifies
  `Permission denied (publickey)` as `AuthKind::SshKey`; `ssh.rs` is what lets
  the app do something about it. The precise message the issue asks for —
  "you have a key, it just is not registered" vs "you have no key" — is decided
  on the FRONTEND (`features/auth/sshAdvice.ts`) from two facts it already has,
  because `classify_auth_failure` is pure over git's stderr and must not start
  reading `~/.ssh`.
- **Not a `GitBackend` method.** Nothing here opens a repository, takes a
  `RepoId` or touches an index; `commands/ssh.rs` takes no repo argument. Same
  shape as `diagnostics.rs` / `update.rs` / `reveal.rs`. The key comment comes
  from `git2::Config::open_default()` — global scope, because an SSH key is not
  per-repository.
- **The passphrase reuses the ONE askpass, and never touches argv.**
  `ssh-keygen` has no env var for a passphrase and `-N <secret>` is visible to
  `ps`, so a requested passphrase goes exactly where a git credential goes: our
  own executable as `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, and
  `PLATYPUSGIT_ASKPASS_SECRET`. `cli::askpass_want` already routes any prompt
  containing "passphrase" to the secret, which covers both of ssh-keygen's — so
  this added no shim and no second auth path. An EMPTY passphrase is not a
  secret and goes in argv as `-N ""`, with no askpass set up at all.
- **Three refusals in `generate`, each from a measured behaviour** (OpenSSH
  10.2p1, probed — the spec's table has the runs):
  1. *Never overwrite.* Ours, not ssh-keygen's: `ssh-keygen -f <existing>`
     blocks on an interactive `Overwrite (y/n)?` against a stdin nobody feeds,
     and its prompt guards only the PRIVATE path, so a stale `.pub` beside a
     missing private key would be clobbered silently. Checked with
     `symlink_metadata`, so a broken symlink counts as something being there.
     `AppError::SshKeyExists` carries the path; `suggested_name` makes "pick
     another" one click.
  2. *0600, re-read.* ssh refuses a loosely-permissioned private key, and
     `~/.ssh` is created `0700` — a key we made and ssh will not touch is a
     worse problem than the one being solved.
  3. *A passphrase that did not stick deletes the key.* With no askpass
     reachable, `ssh-keygen` prints both prompts, writes an **unencrypted** key
     and exits **0**. So a passphrase run is verified with
     `ssh-keygen -y -P ""` (which succeeds only on an unencrypted key) and both
     files are removed if it did. Reporting "created, encrypted" over an
     unencrypted key is the one outcome worse than failing. An unrunnable probe
     reads as "encrypted": the gate must not throw away a good key over a
     broken PATH.
- **The private key never crosses IPC.** `SshKeyInfo` has no field for it, and
  `tests/ssh_keys.rs` asserts on the SERIALISED payload rather than field by
  field — a field added later would pass a field check and still ship the key.
- **The add-key URL is built in Rust from the runtime host.**
  `format!("https://{host}/settings/ssh/new")` is what both privacy guards read
  as a user-supplied host rather than a baked-in destination, so this feature
  adds no allow-list entry and bakes no hostname into `src/`. A host that fails
  `forge::validate_host` — or has a label starting with `-`, which that
  validator permits and RFC 1123 does not — yields `None`, never a URL.
- **`ssh-keygen` missing is a STATE**, in the `LfsUnavailable` shape:
  `SshKeyStatus.canGenerate` disables the button with a reason, and only the
  generate command raises `AppError::SshKeygenUnavailable`.
- **`parse_public_key` must never read a PRIVATE key as a public one.**
  `-----BEGIN OPENSSH PRIVATE KEY-----` splits into three whitespace fields of
  dashes and capitals, which a charset-only check accepts as
  `<algo> <blob> <comment>` — so the algorithm is matched on OpenSSH's three
  real prefixes (`ssh-`, `ecdsa-`, `sk-`), with a regression test.
- Not `git/signing.rs`, which also drives `ssh-keygen` — for SIGNATURES. Two
  files, two jobs; check which one you are in.

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

## Fast-forwarding a branch you are not on (#246)

`pull <remote> <branch>` never could do this: the branch argument is a
*refspec*, so `git pull origin main` while HEAD is `feat/x` merges `origin/main`
into `feat/x`. `GitBackend::fast_forward_branch` moves the branch's REF instead,
and `fast_forward_all` sweeps every local branch that can.

- **The network half and the ref half sit on opposite sides of the command
  boundary, on purpose.** The fetch is a credentialed subprocess, so it stays in
  `commands/branches.rs` on the one runner (`run_git_authenticated`). The
  ancestry check and the ref move are libgit2 work that must not be split, so
  they are ONE backend call. `fast_forward_remote` runs FIRST and refuses a
  checked-out or untracked branch, so a call that cannot succeed never spends a
  fetch.
- **Verify and mutate under ONE lock acquisition** — the stash TOCTOU again, with
  a ref instead of a reflog slot. `fast_forward_branch` is a single `with_repo`
  closure, and `fast_forward_all` is a single closure for the WHOLE sweep
  (listing included). `plan_fast_forward` hands the caller the `Reference` it
  read, so the object that was checked is the object that moves — one ref lookup,
  not two.
- **A branch any working tree is standing on is refused**, HEAD here or a linked
  worktree's HEAD: moving the ref without touching the index and worktree leaves
  that checkout rendering every incoming change as a deletion. The frontend
  routes HEAD to `pull` with the user's `defaultPullMode` instead. git2-rs 0.21
  does not bind `git_branch_is_checked_out`, so `worktree::linked_worktree_heads`
  walks the linked worktrees — one repository open each, which is why only
  ref-moving ops pay it and a bulk sweep walks once.
- **Already-current and strictly-ahead are `moved: false`, not errors**; only
  real divergence is, as `NotFastForward` naming both refs. `NoUpstream` is its
  own variant because the remedy is specific. A bulk run COLLECTS those refusals
  into `diverged` / `checked_out` rather than aborting — one diverged branch must
  not decide the fate of the other five.
- **The remote comes from `branch.<name>.remote`, never `upstream.split('/')[0]`**
  — a remote name may contain a slash, and `team/fork/main` would otherwise be
  fetched from a remote called `team`. The frontend has the same rule in
  `features/branches/fastForward.ts::remoteOfUpstream`, resolved against the
  repository's own remote list.
- **`fetch_args` ends option parsing before the remote name** (`git fetch
  --prune -- origin`). Same finding class as `push_tag_args`: the remote is
  user-supplied and `--upload-pack=<program>` names a program git runs for the
  transport. Verified against git 2.50 — the fetch works normally, and a
  dash-leading value is refused as a strange pathname instead of honoured.

## Checking out a branch another worktree holds (#356)

`checkout_branch` used to be two statements — `checkout_tree` then `set_head` —
and libgit2 refuses the second one when a linked worktree is standing on the
target: *"cannot set HEAD to reference 'refs/heads/x' as it is the current HEAD
of a linked repository"*. The refusal was correct and arrived too late. By then
`checkout_tree` had rewritten the index and the working tree to the target's
tree, so the user was left on an unmoved HEAD with **the entire difference
between the two branches staged**, files from their own branch deleted off disk.
A refusal had presented as data loss.

- **Validate before you write, the way git does.** git dies with `'x' is already
  used by worktree at '…'` before it touches anything;
  `reject_held_by_linked_worktree` is that check, and it runs first in the
  closure — ahead of the dirty check too, because "stash first" is the wrong
  instruction for a branch that is checked out somewhere else and stashing will
  not make the second attempt succeed.
- **Only LINKED worktrees block a checkout.** It reuses `checked_out_at` from
  #246 with `head: None`, which skips that helper's "this worktree" case on
  purpose: re-checking-out the branch you are already on is `git checkout
  <current>`, a no-op rather than an error. Passing `repo.head()` here — the
  obvious reuse of `reject_checked_out` — would refuse an everyday operation.
- **The tree write still rolls back if the ref move fails anyway.** `set_head`
  is no longer expected to fail, but it is the one step that runs after the
  worktree has been rewritten, so its error arm resets hard to the commit
  captured before `checkout_tree`. The dirty check above it means that reset
  restores the state we started from rather than discarding anybody's work.
  Every other head-moving path in `libgit2.rs` (`checkout_detached`,
  `stash_branch`, rebase finish and abort) already moves the ref *before* it
  touches the tree; `checkout_branch` was the only inverted one.
- **`checkout_tree` first is still the right order for checkout itself** — it is
  git's order, and it is what lets libgit2's SAFE strategy refuse a checkout that
  would overwrite untracked files while HEAD is still where the user left it.
  Moving `set_head` up would just relocate the same class of bug to the conflict
  path.

### Taking a held branch (#358)

The refusal above tells the user where the branch is; `checkout_branch`'s `take`
flag is how they get it *here*, which is what they actually wanted.

- **A worktree can RELEASE a branch without being removed.** It is already
  standing on the branch's tip, so releasing is `set_head_detached` to the oid it
  is already at: a rewrite of that worktree's HEAD file and nothing else — no
  checkout, no index write, its working tree never opened. That is the whole
  reason this is safe to offer, and it is why uncommitted work over there
  survives. `taking_a_held_branch_leaves_the_holders_uncommitted_work_alone`
  pins it.
- **One flag on the existing command, not a second command.** `take: false`
  refuses and describes; `take: true` releases and proceeds. Same shape as
  `delete_branch(.., force)` and `BranchExists`, and it keeps the resolve →
  validate → release → checkout sequence inside ONE `with_repo` closure, so
  nothing can move between the check and the write.
- **The blockers are the two kinds of state a detached HEAD would abandon**, not
  dirtiness: a **locked** worktree (an explicit "leave me alone" that operations
  honour) and one **mid-operation** — rebase, merge, cherry-pick, revert, am or
  bisect, read off `Repository::state()`. git tracks those against HEAD, so
  moving HEAD out from under one leaves a half-finished operation nobody can
  explain. Dirtiness is reported, never refused.
- **`release_blocker` computes `dirty` BEFORE it returns any refusal.** Returning
  early from the lock check reported every locked worktree as clean, and the
  confirmation's wording depends on it — the bug the
  `the_refusal_reports_a_blocked_holder…` test was written to catch.
- **The refusal re-validates at take time** rather than trusting the `blocked` it
  reported: the user saw that a dialog ago, and a lock or a rebase can have
  started since.
- **A checkout that fails after the release puts the holder back on its branch.**
  Leaving it detached would have cost it its branch for a checkout that never
  happened — the same half-applied state this whole guard exists to prevent, one
  worktree over.

The frontend half is one catch arm in `useRepoStore.checkoutBranch`: it turns
`BranchHeldByWorktree` into a `pgChoose`, retries with `take: true` on "move it
here", and **pops the auto-stash back on every path that does not complete the
checkout** — decline, "open that one", and a take the backend refuses on
re-validation. That action stashes BEFORE it calls the backend, so any of those
returning early would leave the user's work in a stash they never made. Only the
refused take also raises a banner; a decline is a choice, not a failure.

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

## `blame.ignoreRevsFile` — where libgit2 cannot follow (#253)

- **libgit2's blame has no ignore-revs support of any kind.**
  `git_blame_options` carries whitespace, first-parent and range flags and
  nothing that takes a list of revisions to pass through, so there is no
  in-process answer to give. `.git-blame-ignore-revs` is committed in a great
  many repositories, and blame that names whoever ran the formatter is worse
  than no blame — it looks authoritative and is wrong. So blame joins
  `merge_branch`, `rebase_onto` and `worktree remove` in shelling out.
- **The shell-out is opt-in by the repository, not global.** No
  `blame.ignoreRevsFile` → the in-process libgit2 blame, exactly as before: no
  subprocess, no parsing, no behaviour change for the common case. A repo that
  configured one gets `git blame` for **both** toggle states — comparing a
  libgit2 blame against a git blame would let unrelated engine differences
  masquerade as the effect of the toggle.
- **The configured path never reaches argv.** `git blame` reads
  `blame.ignoreRevsFile` from the repository's own config, so the ignore-revs
  view passes no `--ignore-revs-file=<path>` at all: the user-supplied path is
  never assembled into a command line and can never be read as an option. The
  un-ignored view passes the fixed literal `--ignore-revs-file=`, whose empty
  value is git's documented "clear the list of revs from previously processed
  files" — including the entries the config contributed. The only user-supplied
  argv value left is the blamed path, and it goes after `--`. The resolved path
  is used for one thing only: deciding whether the file is there.
- **`HEAD` is passed explicitly**, so both engines answer the same question:
  the file as of HEAD, not the working tree. Without it git would blame the
  worktree and attribute uncommitted lines to the all-zero oid, and the line
  COUNT would change depending on whether the repository happens to have an
  ignore-revs file — the toggle would appear to add and remove lines.
- **A configured file that cannot be used degrades, it does not fail.** git
  DIES on a missing one (`fatal: could not open object name list`) and on a
  malformed one (an oid it cannot peel to a commit), and a missing file is an
  ordinary state — a config that arrived through an include, a template, or a
  branch where the file does not exist yet. Both cases fall back to the libgit2
  blame with `BlameResult.ignore_revs_error` set; the screen shows a warning
  beside a working blame. `--ignore-revs-file=` cannot rescue it, because git
  processes the config entries first and dies before reaching the clear.
- **`--line-porcelain`, not the default format.** The default packs author,
  date and line number into a column-aligned parenthesised field around content
  that may contain any of those characters. Porcelain is the stable documented
  form — and it carries the `ignored` / `unblamable` keys, so
  `blame.markIgnoredLines` needs no second run to observe. Those keys are
  **gated on the config** (measured, git 2.50.1): git only marks when asked, and
  so do we. Parsing keys on the TAB prefix is what makes blaming a file that
  itself contains blame output unambiguous.

## `git notes` — read-only, and lazy on purpose (#253)

- **Per SELECTED commit, never per log row.** `commit_notes` has the same shape
  as `verify_commit` beside it, for the same reason: the paged log walk is the
  hot path, and a note lookup is a fanout-tree descent per notes ref. Batching
  the page would still put that work on every page fetch, for a feature most
  repositories never use — so the log page's cost is **zero**, and the read
  happens once the selection settles (`CommitNotes`, debounced 100 ms, so
  arrowing through the log reads nothing for the rows passed over).
- **Absence is a state at THREE levels** and none of them may error: no
  `refs/notes/*` in the repository, no note for this commit on a ref that has
  others, and a note whose message is blank. All three are `Ok(vec![])`, and the
  component renders `null` — a "no notes" placeholder would be permanent
  furniture in a panel most commits never fill. An unresolvable OID is still an
  error: that is a caller bug, and reporting it as "no notes" hides it forever.
- **Every `refs/notes/*` ref is shown, labelled with the ref**, and
  `core.notesRef` / `notes.displayRef` are deliberately NOT consulted. The
  asymmetry decides it: showing a note the display config would have hidden
  costs one labelled block, and the ref name is on screen so nothing is
  ambiguous; hiding a note somebody deliberately attached, in a GUI with no
  "show all notes" affordance, is a fact the user cannot discover at all. The
  default ref sorts first.
- **Read-only.** Writing needs a ref to pick, a merge strategy for the notes
  tree, and a push story; it is a separate feature, not a missing button.

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
- **The console-KEEPING exceptions are deliberate**, and there are three call
  sites across two constructors: `git_async_keeping_console` for `git mergetool`
  and for `git difftool` (#235), `program_async_keeping_console` for
  `$VISUAL`/`$EDITOR`. A console mergetool, a console difftool (`vimdiff`,
  `nvimdiff`) or `EDITOR=vim` IS a terminal program; silencing it leaves an
  invisible process holding the file forever. A stray console window is
  cosmetic; an invisible editor is Task Manager. The guard test allow-lists
  every call site by name with its reason, so a fourth is an argued change with
  a test to update.
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

## The pty carve-out (#243)

`portable-pty` spawns through its **own** `CommandBuilder`, not
`std::process::Command`, so a pty opened anywhere would sail straight past the
`Command::new` guard above — a second spawn path with no guard on it, which is
exactly the state issue 172 found the tree in, and invisible this time.

So `proc::spawn_pty_shell` owns the **whole operation** — `openpty`, the
builder, and `spawn_command` — and returns the master and the child.
`crate::terminal` never touches `portable_pty`'s spawn API.
`tests/spawn_no_window.rs` allow-lists those three symbols in `proc.rs` and
counts zero everywhere else, so a future second pty fails the build the way a
second `Command::new` does.

Two properties of that child are deliberate inversions of what every other
spawn in this codebase gets, and both are the kind of thing a later reader
would "fix":

- **`GIT_TERMINAL_PROMPT` is NOT set to 0.** The standing `prompt_less` policy
  exists because a child of a GUI app has no terminal, so an auth prompt hangs
  forever behind a window nobody can see. This child *is* a terminal, on
  purpose, and the user is looking at it. Inheriting the silence would turn a
  working `git push` into a mysterious failure.
- **`CREATE_NO_WINDOW` does not apply**, which is why this does not go through
  `program()`. ConPTY is not `CreateProcess` with an inherited console:
  `portable-pty` allocates a pseudoconsole, so no `conhost` window appears and
  #172's flash cannot happen here. *Reasoned, not yet measured on Windows* — if
  a flash ever appears, the fix is in `spawn_pty_shell` and nowhere else, which
  is the point of the carve-out.

It does get `child_path()`: a Dock-launched app inherits launchd's minimal
environment (#232), and without it the built-in terminal would be the one
terminal on the machine where `node` is missing.

**One more rule, with a test behind it: `src/terminal.rs` contains no logging
call at all.** A terminal is where a `sudo` password gets typed. The bytes read
from the pty have exactly one destination — the event sink — and the lifecycle
logging worth having lives in `commands/terminal.rs`, which handles ids and exit
codes and never sees traffic. `tests/terminal_privacy.rs` enforces the split;
the rule is blunt (no logger, not "no logger near the buffer") because that is
the version a grep can actually keep.

## Clone options, and what a shallow clone costs (#255)

`--depth`, `--filter=blob:none`, `--single-branch` and `--recurse-submodules`
are **flags on the one `git clone`** in `commands/create.rs`. There is no second
clone implementation and there must not be one: `run_clone` owns the destination
validation, the streamed `--progress` stderr, the `cancel::Scope::Clone`
registration, the partial-destination cleanup and the credential env, and every
one of those has to hold for an option-bearing clone too.

- **`--depth` implies `--single-branch` unless told otherwise**, so `clone_args`
  emits `--no-single-branch` when a depth is set and the box is unticked. Without
  it the checkbox would silently mean nothing on exactly the combination a user
  reaches for. Every option in that list is OURS — a `u32` we format, or a fixed
  literal — so the argv carries no user text at all ahead of the `--`.
- **`--depth 0` is refused in `run_clone`**, not relayed from git. `fatal: depth
  0 is not a positive number` is a form validation wearing a clone failure's
  clothes, and it would only arrive after the spawn.
- **Shallow state is READ, never remembered.** There is no
  `.git/platypusgit-shallow.json` — the `git/bisect.rs` call, not the
  `git/rebase_state.rs` one. `Repository::is_shallow()` stats
  `<commondir>/shallow` on **every** call (measured against libgit2's source and
  pinned by `tests/clone_options.rs`), which is what lets a `git2::Repository`
  cached for the life of a tab stop reporting shallow the moment `--unshallow`
  removes the file. Pinning that is not pedantry: a cached `true` would leave
  every truncation notice up forever with the full history behind it.
- `ShallowInfo` carries three facts, and the count is **best-effort**: an
  unreadable `.git/shallow` leaves `boundary_count: 0` with `shallow: true`,
  because the boolean is what every surface branches on and a wrong number is
  worse than none. `single_branch` is the durable trace `--single-branch` leaves
  in `remote.<name>.fetch` — the parsing is pure in `git/shallow.rs`, and the
  glob that decides is on the **source** side of the refspec.
- **`unshallow` is a fetch and goes on the one runner.** `git fetch --unshallow`,
  through `run_git_authenticated_with_progress`, so it is credentialed,
  cancellable and reports progress — which matters, because unshallowing a large
  repository is the longest single wait in the app. It names **no remote**: git
  resolves the default itself, which is what keeps the argument list free of
  user-supplied text entirely.
- **It answers `false` rather than relaying git's refusal.** `--unshallow` on a
  complete repository is `fatal: --unshallow on a complete repository does not
  make sense`, and a user who clicked a button another window had already acted
  on must not be shown that. The command re-reads `is_shallow()` first.
- **Deepen-by-N and widening a single-branch refspec are deliberately absent.**
  A deepen leaves the repository shallow, so every notice stays up afterwards and
  the reader's actual question ("why does history stop") goes unanswered; a widen
  rewrites the user's own config with a per-remote choice to make. Both are their
  own change — see the spec.

## `git difftool` — what we decide, and what git does (#235)

The feature is "open this diff in Beyond Compare / Kaleidoscope / Meld /
`nvimdiff`", and almost all of it is git's. `git/difftool.rs` decides which two
sides and builds the argv; `commands/diff.rs::open_in_difftool` spawns it.

- **Shell out, never materialise the sides ourselves.** For a commit or an index
  diff neither side is a file — they are blobs — and `git difftool` already
  extracts both, honours `diff.guitool` / `diff.tool` / `merge.tool` /
  `difftool.<tool>.cmd` / `difftool.<tool>.path`, and cleans up. Our own copy
  would be worse and would drift the first time git adds a tool. That is also
  what makes this zero-config for anyone already set up: with no Settings
  override we pass no tool at all.
- **`--gui` and `--tool` are mutually exclusive.** git refuses the pair —
  `fatal: options '--gui' and '--tool' cannot be used together` — because they
  answer the same question. No override → `--gui` (which puts `diff.guitool`
  first and falls back to `diff.tool`); an override → `--tool=<name>` alone.
  Found by the end-to-end test, pinned by a unit test.
- **A commit's own diff resolves its parent in RUST.** Both shorthands are wrong
  at a root commit: `<oid>^` fails to resolve, and `<oid>^!` — git's own
  documented "changes on this commit" form — silently degrades to
  `git diff <oid>`, a diff against the **working tree**. So `spec_for` asks git2
  for the first parent and falls back to `treebuilder(None).write()`, the
  repository's own empty tree (hash-algorithm-correct, where a hard-coded
  `4b825dc…` is SHA-1 only). `tests/difftool.rs` pins the wrong answer as much as
  the right one: an uncommitted edit in the worktree must never reach a commit's
  diff.
- **A tool NAME is not a command line.** `normalize_tool` refuses whitespace and
  control characters with `InvalidArgument`, because `diff.tool=meld` selects
  `difftool.meld.cmd` — the command line belongs in that key, where git reads it.
- **No `NoDiffTool` variant.** When nothing resolves, git says
  `This message is displayed because 'diff.tool' is not configured` in the user's
  own locale. The command pipes **stderr** (stdin and stdout stay inherited, so a
  console tool still owns the terminal) and puts its tail in `AppError::Git`.
  Minting a variant would mean pattern-matching English against a resolution
  order we do not own.
- **No caller-supplied string reaches argv.** Revisions are RESOLVED to hex oids
  (`resolve_commit`), not validated: `git difftool` needs its revisions **ahead
  of `--`**, so the separator that protects the pathspecs cannot protect them,
  and a `--output=…` in a revision slot would be read as an option. Resolving
  makes that unrepresentable rather than merely refused, and it is the better
  error besides — a bad ref fails as `InvalidRef` with git's own message instead
  of after the spawn. `every_revision_reaching_argv_is_a_hex_oid` asserts it as a
  property over every target shape, so a new variant that passed a string through
  fails without anyone remembering this paragraph.
- **`GIT_LITERAL_PATHSPECS` is the second user of `git/stash.rs`'s constant.**
  This is the app's other pathspec-passing shell-out; without it a file named
  `a[b].c` is a glob and the row the user right-clicked is not the file git
  opens. Tested with a decoy that the glob would have matched.
- Paths are a LIST so a rename passes `[oldPath, newPath]` — scoped to the new
  path alone git reports a renamed file as wholly added, which is the dead end
  the feature exists to remove. Every path goes through
  `opener::safe_workdir_path`, and one bad path refuses the whole batch.

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

## Stacked branches: `--update-refs` is implemented, not passed through (#240)

Our rebase is our **own replay** — `rebase_start_with_progress` detaches at the
base, cherry-picks each step, and moves the branch ref once in `finish_rebase`.
There is no `git rebase` process to hand `--update-refs` to. The issue flagged
that as the question deciding the feature's size; `git/update_refs.rs` is the
answer, and it is small because the engine already keeps the one piece of state
that makes it possible: `RebaseState::rewritten`, the original → new oid map
maintained per step.

Three decisions worth knowing before changing it:

- **The stack is captured BEFORE the detach.** `stacked_refs` asks "which local
  branch tips are inside this plan" while HEAD still describes the pre-rebase
  history. Afterwards those commits are no longer what the branch contains and
  the question cannot be asked again — which is also why the answer is persisted
  in `rebase_state`, so a rebase resumed in a later session still moves them.
- **Tips only**, which is git's own rule. A branch pointing into the middle of
  the range is what stacking produces; a branch pointing elsewhere is not this
  rebase's business.
- **A ref whose commit was dropped is left alone.** There is no honest place to
  move it: retargeting to a neighbour would silently change what the branch
  contains, and deleting it would destroy a ref nobody asked us to touch.
  Leaving it loses nothing, and the summary reports what *did* move so the
  difference is visible.

`move_stacked_refs` runs immediately after `finish_rebase`, so the branch and
its dependants move as one logical step: a stack is either rebased or it is not.

The default is git's own — `rebase.updateRefs`, read by `config_enabled`, off
unless set. Turning it on for someone who did not ask is the same class of
surprise as leaving their stack behind, just in the other direction. The
frontend still confirms first and names every ref (`features/commits/stackedRefs.ts`),
because the flag alone is a silent behaviour change.
## A user-supplied command string is not a shell line (#225)

Custom actions let a user run their own program from the UI. The tempting
implementation is `sh -c "<the string>"`, and it is wrong in a way that stays
invisible until it bites: under a shell, a branch named `main; rm -rf ~` or a
path containing `$(...)` stops being **data** and becomes **code**. Branch names
and paths come from the repository, which means they can come from anyone who
has ever pushed to it.

`custom_action.rs` is therefore pure, and the whole design is three steps:

1. **`parse_command`** splits the string into argv once. Quotes group; a
   backslash escapes (except inside single quotes, so a Windows path survives).
   `|`, `>`, `;`, `&&`, `$`, `*`, `~` are ordinary characters, because that is
   all they can be when nothing interprets them.
2. **`substitute`** expands `$REPO` / `$FILE` / `$FILES` / `$SHA` / `$BRANCH`
   **into individual argv entries**, after splitting. A value can therefore
   never introduce a new argument, however it is spelled.
3. **`proc::program_async`** spawns it — the only sanctioned constructor (a
   guard test fails the build on a bare `Command::new`), which also carries the
   `CREATE_NO_WINDOW` treatment from #172 so an action never flashes a console.

Two traps worth knowing before editing `substitute`, both pinned by tests:

- **It is ONE left-to-right pass.** Chained `str::replace` calls re-scan text an
  earlier call just substituted, so a file literally named `$SHA` would pull in
  the commit sha. Values are data, not templates; emitting each expansion
  straight into the output and never looking at it again makes that structural.
- **Placeholders are tried LONGEST NAME FIRST**, because `$FILE` is a prefix of
  `$FILES`. Anything else matches `$FILE` inside `$FILES` and leaves a stray
  `S`.

`$FILES` is the one placeholder that changes the *number* of arguments, and only
when it is the whole entry — as whole entries, never by splitting a joined
string. Inside a larger argument (`--files=$FILES`) it joins, because "become N
arguments" cannot be expressed as a substring replacement.

**No secrets, ever.** A custom action is a user program, not a trusted one:
nothing from the auth path goes near it — no forge token, no git credential, no
askpass wiring. It gets the ordinary child environment `proc.rs` builds.
