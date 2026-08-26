# Run the commit-side git hooks (issue 232)

Status: approved for implementation.
Issue: [232](https://github.com/jonassaa/platypusgit/issues/232).

## Goal

Committing from the app runs the hooks git would run: `pre-commit`,
`prepare-commit-msg`, `commit-msg`, `post-commit`. Give the user a visible,
per-invocation way to skip them, on commit and on push. And make a hook that
calls `node`, `python` or `pnpm` work when the app was launched from the Dock or
a `.desktop` file, not only when it was launched from a terminal.

The bug today is not that hooks are broken. It is that they are absent on commit
and present on push, silently: a repo with husky, lefthook, `pre-commit` or
commitlint is enforced by our `git push` and bypassed by our commit, and nothing
in the UI says so. That asymmetry is what gets a GUI client banned by a team.

## What is true in the tree, verified by reading it

- `grep -ri hook src-tauri/src` returns nothing but unrelated comments. There has
  never been hook support.
- `Libgit2Backend::commit` (`git/libgit2.rs:3752`) builds the commit with
  `repo.commit(Some("HEAD"), …)`, or `commit_signed` (`libgit2.rs:1134`) when
  signing is on. **libgit2 runs no hooks, ever.** So the four commit-side hooks
  never fire.
- Push is the inconsistency, and it is accidental:
  `commands::net::run_git_authenticated` shells out to real `git push`
  (`commands/net.rs:91`), which runs `pre-push` because git does, not because we
  asked.
- There is no `--no-verify` anywhere — not on commit, not on push. `push_args`
  (`commands/branches.rs:223`) builds `push [-u] <remote> <branch> [--force…]`
  and nothing else.
- A failed commit surfaces through `pgFlash(appErrorMessage(e))`
  (`screens/CommitPanel.tsx:1109`) — a transient toast. Nothing in `src/design/`
  can display multi-line process output. **The output surface is genuinely new.**
- Every child process is spawned through `proc.rs`, enforced by
  `tests/spawn_no_window.rs`. `proc.rs` sets `GIT_TERMINAL_PROMPT=0` and closes
  stdin (`prompt_less`) and touches nothing else about the environment — the
  child inherits ours.

## The decisions

### 1. Keep the libgit2 commit and run hooks around it — do not shell out to `git commit`

The issue offers either. Shelling out loses on a rule this repo already holds:
`git commit -S` signs through git's own `gpg.program`, which would stand up a
**second signing chain** beside `libgit2.rs::sign_payload`. CLAUDE.md's
one-signing-chain rule exists because two chains drift, and the failure mode is a
commit the user believes is signed. Shelling out would also hand back raw git
stderr in place of the classified `AppError` variants the frontend switches on,
and would need arg translation for amend, author override and sign-off — three
behaviours already correct in the libgit2 path.

So `commit()` keeps its body and gains hook calls around it.

### 2. Run hooks with `git hook run`, not by executing the scripts ourselves

Executing hook scripts directly means re-implementing git's contract: resolve
`core.hooksPath`, honour the executable bit, and — the one that silently breaks
Windows — run the script through git's bundled `sh`, because a hook is a shell
script and Windows has no shebang. Getting that last part wrong means hooks
quietly do not run on Windows, which is the exact bug being fixed.

`git hook run` is git doing all of that for us. Probed in a scratch repo rather
than trusted from the docs:

| Probe | Result |
| --- | --- |
| hook exits 3 | `git hook run` exits 3 — exit codes propagate |
| `core.hooksPath=custom-hooks` | the custom hook ran, `.git/hooks` ignored |
| hook present but not executable | skipped, exit 0, with git's own `advice.ignoredHook` hint |
| `--ignore-missing`, hook absent | exit 0 |
| hook absent, no `--ignore-missing` | exit 1, `error: cannot find a hook named …` |
| `-- <file> message` | hook saw `$1`/`$2`; appending to `$1` rewrote the file |
| `pre-commit` running `git add generated.txt` | a later index read saw it staged |
| `commit --amend -m` | `prepare-commit-msg` got source `message`, argc 2, no `$3` |
| `commit -s` | `commit-msg` read a file that already had the trailer |

Two findings shape the implementation:

- **Hook stdout is redirected to stderr.** Both a hook's stdout and its stderr
  arrive on our captured stderr, on success and on failure. So there is one
  stream to capture and one to display, not two to interleave. Capture stderr;
  ignore stdout.
- **An index-modifying `pre-commit` works only if we open the index after it
  AND reload it.** A hook that runs `git add` (the `lint-staged` shape: reformat,
  restage) mutates the on-disk index, so `repo.index()` must be called *after*
  `pre-commit` returns. Ordering alone turned out to be insufficient — see the
  correction below.

**Support is detected, never inferred from a version number.** `git hook run`
arrived in git 2.36; Ubuntu 22.04 LTS is supported into 2027 and ships 2.34. But
parsing `git --version` and comparing is a string-compare bug waiting to happen,
and it is unnecessary — there is a side-effect-free capability probe:

```
git hook run --ignore-missing pg-capability-probe
```

A hook by that name cannot exist, so on a supporting git this runs nothing and
exits 0 silently (verified). On an older git it exits 1 with
`git: 'hook' is not a git command`. Probe once, cache the answer, no version
arithmetic. The probe cannot be confused with a hook rejection, because the hook
it names never exists.

The fallback for an unsupporting git execs the hook directly, and it is cheap
because it only has to cover Unix: a shebang'd executable script runs fine, and
Windows always has a current Git for Windows. The fallback resolves
`core.hooksPath` and checks the executable bit; it does not attempt Windows `sh`
shimming, because it never runs there.

**One correction, found by the test rather than by reading.** Reordering the
index read was *not* enough: the first run of
`a_pre_commit_that_restages_is_honoured` committed `unfixed`. `with_repo` hands
back a **cached** `git2::Repository`, and libgit2 keeps that repository's index in
memory — so a read placed after the hook still returned the pre-hook snapshot,
and the hook's reformatting was silently discarded. `index.read(false)` after
`repo.index()` is therefore load-bearing, not hygiene; it reloads only when the
on-disk index actually changed, so it costs a stat in the common case. Recorded
in `docs/dev/backend.md`, because a future change to where the index is read has
to keep both halves.

**A second consequence, found the same way.** `tests/verify_commit_no_spawn.rs`
stubs `git` by mutating the process `PATH`, which no longer reaches children now
that `proc.rs` pins one (decision 8). That test starves the probe instead, with a
comment saying why — and it is a fair warning about the blast radius: pinning
`PATH` means a runtime `PATH` change no longer affects anything we spawn.

### 3. The commit sequence, and what "creates nothing" means

```
pre-commit                    → non-zero: stop, create nothing
open index, write tree        ← after pre-commit, so a restaging hook is honoured
write COMMIT_EDITMSG
prepare-commit-msg <file> <source>
                              → non-zero: stop, create nothing
commit-msg <file>             → non-zero: stop, create nothing
re-read COMMIT_EDITMSG        ← the message that lands is the hook's, not the user's
build + sign + move ref       ← unchanged libgit2 path
post-commit                   → exit code IGNORED, as git ignores it
```

A non-zero `pre-commit`, `prepare-commit-msg` or `commit-msg` **creates no object
and moves no reference**, and leaves the index as the hook left it. This mirrors
the signing rule (`commit_signed`: a signing failure creates nothing) for the
same reason — a half-applied commit is worse than a refused one. Note the index
is deliberately *not* rolled back: a `pre-commit` hook that restaged files did
work the user wants to keep, and git does not undo it either.

`post-commit` runs after the ref moves. Its exit code is discarded because git
discards it; a failing `post-commit` must not report a commit that exists as
failed.

The message file is `$GIT_DIR/COMMIT_EDITMSG`, which is where git puts it and
therefore where a hook that ignores `$1` and hardcodes the path still works.

`prepare-commit-msg`'s second argument is git's *source*, and ours is always
`message` with **no third argument — amend included**. Verified rather than
assumed, because the intuition is wrong: the source is `commit` (with the object
as `$3`) only when the message is taken *from* a commit, as with `-c`/`-C` or a
bare `--amend`. We always supply the message as text — the panel prefills HEAD's
message into the box and sends it back — so git's own equivalent is
`commit --amend -m <msg>`, which reports `message` and passes two arguments.

**Sign-off is applied before `prepare-commit-msg` sees the message**, matching
`git commit -s`: verified that the trailer is already in the file by the time
`commit-msg` reads it, so a hook validating trailers sees what git would show it.

### 4. `AppError::HookRejected { hook, output }` — a typed field, not a stringified banner

Hook output is the whole point of the feature; it cannot arrive as a formatted
string inside `AppError::Git`. A new variant carries the hook's name and its
captured output separately, so the frontend renders the output as output — in a
monospace, scrollable block — rather than pasting a 40-line eslint dump into a
one-line banner. Per CLAUDE.md the TS `AppError` union is updated in the same
commit.

Distinct from the missing-hook and cannot-run cases: a hook that does not exist
is not an error at all (`--ignore-missing`), and a hook we could not *launch*
(permissions on the hooks dir, no git) is `AppError::Io` — a bug in the
environment, not a rejection by a hook.

### 5. The commit returns what actually landed

`commit()` today returns the new oid. Because `commit-msg` may rewrite the
message, the panel's idea of what it committed can now be wrong. The command
returns the final message alongside the oid so the panel reflects what landed.

### 6. `no_verify` is per-invocation, on `CommitOptions` and on `push_args`

`CommitOptions` gains `no_verify: bool` (`#[serde(default)]`, so an existing
caller is unchanged). When set, all four hooks are skipped — matching
`git commit --no-verify`, which skips `pre-commit` and `commit-msg`, and taking
`prepare-commit-msg` and `post-commit` with it for one reason: a user asking to
commit without hooks means without hooks, and a `prepare-commit-msg` that
rewrites the message is exactly the thing a stuck user is trying to get past.

`push_args` gains `--no-verify` to skip `pre-push`.

**On push it is a separate palette command, not a toggle.** There is no push
dialog to hang a checkbox on — force-push, the other per-invocation push variant,
is already a distinct `danger: true` palette command behind a confirm, so
"Push <branch> without hooks" follows that shape exactly. It confirms, and the
confirm names what will not run, because the hook being skipped is usually the
test suite. It pushes with `PushForce::None`: skipping hooks must not quietly
also force.

Not sticky, and not a setting. It is an override; persisting it would turn "skip
this once" into a repo that silently never runs hooks, which is the bug this
issue is about, only worse for being our own doing.

### 7. Hook output renders inline in the commit panel

A collapsible, scrollable, monospace block below the message box, persisting
until dismissed or until the next commit attempt — so the user can read the
hook's complaint *while editing the message or files it objected to*. A modal
would block the panel it is asking them to fix; the existing toast auto-dismisses
and would lose the output before a slow reader clicks anything.

The block carries a `Commit without hooks` action, which is the in-the-moment
half of decision 6.

### 8. The `$PATH` fix applies to every child spawned through `proc.rs`

A GUI launch (Dock, Finder, `.desktop`) inherits launchd's or the session
manager's minimal environment, not the login shell's. A launch through our `pgit`
CLI inherits the terminal's. So a hook calling `node` fails or succeeds depending
on how the app was started — the worst kind of bug, and the one Fork has an
upvoted issue about.

**Resolution is a login-shell probe, once, cached:** spawn
`$SHELL -l -c '<marker>; printf %s "$PATH"; <marker>'`, take what lies between
the markers, with a timeout. Markers because a noisy rc file prints banners; a
timeout because an rc file can block on a prompt. This is the only approach that
finds nvm, asdf and pyenv shims, whose directories are version-specific and
cannot be guessed. A static list of well-known directories is the fallback when
the probe fails, not the primary mechanism.

**Scope is every `proc.rs` constructor, not just hooks.** The issue names
`proc.rs` as where the environment decision belongs, and the identical bug
silently breaks `gpg`/`ssh-keygen` discovery for signing, `$VISUAL`/`$EDITOR` for
open-in-editor, `git mergetool`, and the `git-lfs` availability probe. Fixing one
caller and leaving four is a decision to refix this later.

**The resolved value is a union, not a replacement — and this is load-bearing.**
Measured, not assumed: Rust's `Command::env("PATH", …)` governs where the child
*binary itself* is looked up, and it uses **only** that value, not the parent's.
A probe run against a directory holding one fake binary found the fake and then
failed to find `sh` with `NotFound`. So assigning the login-shell PATH verbatim
would break `Command::new("git")` for any user whose login PATH happens not to
contain git's directory — a regression on flows that work today, caused by the
fix.

So the applied value is `login_path` first, then the inherited `PATH`, deduped.
Hooks and program lookup gain the version-manager shims; nothing that resolves
today stops resolving. Login-first ordering is deliberate: a Dock-launched app
should prefer the git the user's own terminal uses, which is the point.

The probe is cached and non-fatal: a failure leaves the inherited environment
exactly as it is now.

**The probe runs off the main thread at startup, and nothing ever waits on it.**
`child_path()` is a non-blocking cache read; `warm_child_path()` is the only
resolver. Resolving inside the reader — the obvious shape, and the one this was
first built as — would make the first spawn of the session wait for a login shell
to run the user's rc files, so a slow `.zshrc` would stall their first git
operation by up to the timeout. The window before the probe lands fails safe:
those spawns inherit our environment, which is exactly the pre-feature
behaviour.

## Where the code goes

**Backend**

- **`src-tauri/src/git/hooks.rs`** (new) — the only place a hook is spawned.
  `run_hook(workdir, name, args) -> AppResult<HookOutcome>` where
  `HookOutcome { ran: bool, code: i32, output: String }`. Owns the
  `git hook run` invocation, the direct-exec fallback for an older git, and the
  one-time cached capability probe that chooses between them.
- **`src-tauri/src/proc.rs`** — the login-shell PATH resolution and its cache;
  every constructor applies it. Stays the only spawn site, so the guard test is
  untouched.
- **`src-tauri/src/git/types.rs`** — `CommitOptions.no_verify`; a `CommitResult
  { oid, message }` for decision 5.
- **`src-tauri/src/git/libgit2.rs`** — `commit()` gains the sequence in decision
  3. Reordered so `repo.index()` follows `pre-commit`.
- **`src-tauri/src/error.rs`** — `AppError::HookRejected { hook, output }`.
- **`src-tauri/src/commands/commits.rs`** — `commit` takes `no_verify`, returns
  `CommitResult`.
- **`src-tauri/src/commands/branches.rs`** — `push_args` takes `no_verify`;
  `push` takes it from the frontend.
- **`src-tauri/src/git/cli.rs`** — `CliBackend` stub stays in shape.

**Frontend**

- **`src/lib/types.ts`** — `AppError` union gains `HookRejected`; `CommitResult`.
- **`src/lib/tauri.ts`** — `commit`/`push` wrappers take `noVerify`.
- **`src/design/`** — the output block from decision 7.
- **`src/screens/CommitPanel.tsx`** — the block, the checkbox beside
  Amend/Sign-off/Sign, and the `Commit without hooks` retry.
- **`src/features/repo/`** — `commitAction`/`pushAction` carry `noVerify`; the
  rejection lands in state rather than a flash.

**Docs** — `docs/dev/backend.md` gets the hook chain (a sibling of the signing
chain and the credential path); `docs/dev/architecture.md` gets `git/hooks.rs`
and the changed `commands/` entries, or `test/docs.test.ts` fails the build.

## Out of scope

- **Hooks beyond the four commit-side ones plus `pre-push`.** `post-checkout`,
  `post-merge`, `post-rewrite` and the rest are real gaps, but they belong to the
  operations that trigger them, not to this issue.
- **A hooks manager** — installing, editing or listing hooks. Issue 225 (custom
  actions) is the neighbour; this issue is git's own contract.
- **`pre-push` output display.** `pre-push` already runs; surfacing its output as
  richly as commit's is a follow-up, and pushing it in here doubles the UI work
  for a path that is not currently broken.
- **`advice.ignoredHook`.** git already prints the non-executable hint into the
  output we capture and display. Re-implementing the advice is redundant.

## Testing

**Rust integration, against real temp repos with real hook scripts** — this is
where the contract lives:

- `pre-commit` exiting non-zero: no new commit object, HEAD unmoved, the hook's
  output in the error.
- `pre-commit` that restages a file: the commit contains it (pins the
  index-after-hook ordering from decision 2; the test fails if the read moves
  back).
- `commit-msg` that rewrites the message: the rewritten message is what the
  commit carries, and what the command returns.
- `commit-msg` exiting non-zero: nothing created.
- `core.hooksPath` pointing elsewhere: that hook runs, `.git/hooks` does not.
- A non-executable hook: skipped, commit succeeds.
- No hooks at all: commit succeeds, unchanged from today.
- `no_verify: true` with a rejecting `pre-commit` *and* a rewriting
  `commit-msg`: commit succeeds and the message is verbatim.
- `post-commit` exiting non-zero: the commit still succeeds.
- Signing + a rejecting `pre-commit`: nothing created, and nothing signed.

**Rust unit** — `push_args` with and without `no_verify`, beside the existing
cases. The login-shell probe's parser against marker-wrapped noisy output. The
capability probe against both outcomes, and a test that forces the direct-exec
fallback path so it is exercised on a machine whose git supports `git hook run`
(otherwise the fallback ships untested everywhere except Ubuntu 22.04).

**Frontend** — a component test for the output block (renders multi-line output,
collapses, dismisses, fires the retry) and for the checkbox reaching the invoke
wrapper.

**E2E** — one case in `e2e/specs/commit.e2e.ts`: a temp repo with a rejecting
`pre-commit`, commit attempted, output block asserted visible with the hook's
text, then `Commit without hooks` succeeds. One spec, because the Rust tests
carry the matrix and e2e carries the wiring.

**Manual, and it cannot be skipped** — decision 8 is only real when checked from
a Dock/Finder launch with a hook that shells out to a version-managed `node`.
That is the failure the issue describes and no automated layer here reproduces
it: the test harness always has a terminal's environment.
