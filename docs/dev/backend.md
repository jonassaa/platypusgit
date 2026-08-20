# Backend deep dives

Part of the `docs/dev/` set (`architecture`, `testing`, `frontend`, `backend`,
`distribution`) — deep-dive notes split out of CLAUDE.md, which keeps only the
operational rules and points here. A section referenced but not found in this
file lives in a sibling. `test/docs.test.ts` reads this set together with
CLAUDE.md, so the tree listings and command lists here are build-checked.

## Errors
- **Rust:** every IPC-crossing fn returns `AppResult<T> = Result<T, AppError>`. No unwrap/panic in commands. Add `AppError` variants rather than stringifying.
- **TS:** `AppError` union in `src/lib/errors.ts` stays 1:1 with Rust enum. New Rust variant → update TS same commit.
- Wire format: `{ kind, message }` via `#[serde(tag = "kind", content = "message")]`. Consumers narrow on `kind`.
- Some variants carry an IDENTIFIER, not prose — `Auth` (a struct), `ForgeAuth`
  (a host), `BranchExists` (a branch name). `appErrorMessage` renders each into a
  sentence; a new variant of that shape needs a case there, or the banner reads
  `github.com`.
- `ForgeAuth` is deliberately separate from `Auth`: `Auth` means "git needs a
  credential for this remote, prompt and retry", so reusing it for a bad API token
  would pop the transport-credential dialog for a problem only Settings can fix.
- **Two formatters, two voices, and the wrong one is a bug either way** (#146).
  `describeError` is for the LOG FILE and leads with the `kind`; `appErrorMessage`
  is for a BANNER and never shows the enum's spelling. `toAppError`
  (`lib/errors.ts`, one definition for the five stores whose `error` field is an
  `AppError`) wraps with `appErrorMessage` — a banner reading "TypeError: x is not
  a function" is developer text. Stores whose `error` is a plain string call
  `appErrorMessage` directly and need no wrapper.
- **Neither formatter may throw, and neither may assume `message` is a string.**
  `invoke` logs a failure BEFORE it rethrows it, so an exception raised inside the
  logger *replaces* the original rejection — `isAuthError` then fails to narrow and
  no credential prompt is raised. And `isAppError` accepts any object with a string
  `kind`, while `Auth` proves the enum itself can carry a struct, so a payload of
  the wrong shape must be coerced (`describeUnknown`), never interpolated. Both
  are pinned in `errors.test.ts` + `tauri.errors.test.ts`.
- **"No text at this path" is a STATE for all three file-content readers**
  (`read_file_content`, `_at_rev`, `_at_index`), and each one needs an explicit
  non-blob KIND test to honour it. A `160000` gitlink's oid names a commit in the
  SUBMODULE's object database, so looking the entry's object up answers "object not
  found" — which is what all three did for every click on a submodule row until
  `tests/file_content_absence.rs`. Absence is answered `Ok(None)` because every
  caller is a diff or preview surface reading one side of something it is already
  rendering; a genuine failure (bad revspec, unknown repository, unreadable file)
  still errors. On the frontend the sentinel is `null`, NOT `""` — whole-file mode
  bails on `null` and would compose a file out of an empty string.

## Forge tokens are NOT git credentials (#92)
- `commands/net.rs::Credentials` answers git's askpass prompt for one
  fetch/push. A forge API token authenticates an HTTP header for a host's API and
  is kept until removed. **They share no struct, no storage key, and no code
  path** — do not extend `Credentials` for a forge.
- Storage is still delegated to the user's own git credential helper, but under
  `protocol=https`, `host=<forge-host>.platypusgit-forge.invalid`,
  `username=platypusgit-forge`. The `.invalid` namespacing is load-bearing:
  GitLab's API and its git transport share one host (`gitlab.com/api/v4`), as
  does GitHub Enterprise, so keying on the bare host would **overwrite the
  credential the user pushes with**. `.invalid` is RFC 6761-reserved, so no git
  remote can ever ask for it. A custom `protocol=` was tried and rejected:
  `git-credential-osxkeychain` silently `exit(0)`s on an unknown protocol.
- `git credential` runs with cwd = the OS temp dir, so a repo-local
  `credential.helper` cannot redirect where a token is read from or stored.
- `store_token` **round-trips** (`approve` → `fill` → compare) and raises
  `ForgeTokenStore` naming the remedy when the token did not stick. Unlike D5,
  storage here cannot be best-effort: a silently lost token means the user typed a
  secret into a box for nothing.
- A token is a `forge::token::Secret`: no `Display`, no `Serialize`, `Debug`
  prints `Secret(***)`. `expose()` has exactly two call sites (the auth header,
  and the credential-protocol writer). Grep for it before adding a third.
- No command returns a token. `forge_token_status` reports presence + login.
- `LfsUnavailable` is a **state, not a failure** (#93): the UI disables the LFS
  actions and explains, so git's `'lfs' is not a git command` can never reach an
  error banner. `NoBisect` likewise means "refresh", not "alarm". `DirtyWorktree`
  is reused for `git worktree remove`'s refusal, which is what turns into the
  second, type-the-name confirm.


## Interactive rebase engine
- **The plan is validated before the repository is touched.**
  `rebase_plan::validate` runs first in `rebase_start`; anything it rejects
  raises `AppError::InvalidRebasePlan` with HEAD, the branch ref, and the
  worktree untouched. Before this, an unexecutable step (a merge commit, which
  libgit2 refuses to cherry-pick without a mainline) surfaced mid-replay with
  earlier picks already committed and the branch tip already moved.
- **A plan may name a base the branch does not descend from — that is
  `git rebase --onto`** (186). `rebase_plan::validate` accepts any existing
  commit as an `onto`, with **no ancestry requirement**, so the diverged case
  needed no engine change at all. Four things follow:
  - **`onto` reaches the run through TWO sites, and either one alone places the
    first step**: `rebase_start`'s initial `set_head_detached` (base =
    `first_step.onto`, else that commit's first parent) and `advance_rebase`'s
    per-step `move_to_base`. Verified by mutation — killing one leaves
    `tests/rebase_onto_new_base.rs` green; only killing both replays the branch
    on its own root. Anyone changing where a run starts has to find both.
  - The base is attached at **submit**, by `withPlanBase`
    (`features/commits/withPlanBase.ts`), never when the rows are built. Flatten
    mode lets the user reorder, and the base belongs to whichever step ends up
    first — baked into a row, a drag would carry it away. That is a bug which
    PREDATES the diverged base: with every row's `onto` null, a reordered plan
    detached at the new first step's own parent, i.e. the middle of its own
    range. The Rebase screen therefore tracks a base for EVERY plan it can
    submit, including one seeded by `Interactive rebase from here`; null (a root
    commit, or an oldest step outside the loaded log) keeps the parent fallback.
  - The frontend range is `commitsBetween(base, HEAD)` when the base is diverged
    and `commitsSince` when it is an ancestor, chosen by `aheadBehind`'s
    `behind === 0` (nothing reachable from the base is missing from HEAD — that
    IS "ancestor"). **`commits_since` is not loosened** — its ancestor
    requirement is the on-branch flow's invariant, and keeping the split leaves
    it its only caller instead of making it dead code.
  - `commits_between`'s handler defaults `limit` to **200** and breaks at the
    cap, so the limit is derived from `aheadBehind`'s exact `ahead` and the
    length is verified. A truncated plan leaves commits unreplayed and still
    moves the branch ref, so a mismatch is refused rather than planned.
- **The replay runs on a detached HEAD** and moves the branch ref exactly once,
  when the plan completes (`finish_rebase`). So a failed or paused rebase never
  leaves the branch mid-replay, and `rebase_abort` is "put HEAD back on the
  branch" rather than a reset to a remembered oid.
- **`RebaseState.rewritten` maps original oid → replayed oid** for every step
  that ran, recorded *after* the action's post-commit rewrite (reword amends,
  squash/fixup collapse), and a dropped step maps to the HEAD it left behind.
- **Merge commits in a plan take one of three actions**: `Drop` (flatten — git's
  own default: the merge disappears and its commits are replayed individually),
  `MainlinePick` (keep the merge as one ordinary commit — `git cherry-pick -m 1`,
  so `start_pick` passes mainline 1), or `Merge` (recreate it from its rewritten
  parents — the `--rebase-merges` equivalent). `rebase_plan::merge_legal` is the
  single source of truth; `MERGE_ACTIONS_FLATTEN` / `MERGE_ACTIONS_PRESERVE` in
  `src/screens/Rebase.tsx` mirror it per mode, and they must stay in sync or the
  UI offers an action the backend refuses.
- **Plans carry topology structurally, not as git's todo language.** A
  `RebaseStep` may name the original commit it is applied `onto` (resolved
  through the engine's rewritten map, so every commit is implicitly its own
  label), and a `Merge` step carries its original parents beyond the first. A
  plan whose steps all leave `onto: null` is the linear default. There are no
  `label` / `reset` / `exec` steps and no `rebase-cousins` mode — a generated
  plan does not need the naming layer.
- **A recreated merge runs in the worktree** (`repo.merge`, not
  `merge_commits`), so a conflict lands in the index with stages and
  `conflict_sides`, the Conflict screen, and the merge resolver window all work
  unchanged; `rebase_continue` then commits the resolution with both parents.
  Conflict resolutions inside the ORIGINAL merge are not reused — neither does
  git. Octopus merges cannot be recreated; they can be dropped or kept as one
  commit.
- **Preserve mode disables reordering** (git documents its own reorder bugs
  under `--rebase-merges`), and it rebuilds a whole-range plan in place while
  deliberately leaving a targeted plan (squash/fixup/reword) alone — rebuilding
  one would discard the message the user typed.
- **A `data-testid` on a plan row's CHILD must not start with `rebase-row`.**
  WebdriverIO compiles `[data-testid="rebase-row"]*=text` to an xpath whose
  attribute test is `contains(@data-testid, "rebase-row")` — a SUBSTRING match —
  plus `not(.//*[<same conditions>])` to keep the innermost hit. A child testid
  sharing that stem therefore satisfies the row's own condition and the row
  matches nothing, with no error beyond the spec's own `timeoutMsg`. Hence
  `rebase-action` and `rebase-badge`, not `rebase-row-action` / `rebase-row-badge`
  — the badge form hid the trap for months by only rendering on a merge row.
  Invisible to `pnpm test`: jsdom's `getByTestId` is an exact CSS match.
- **`PGRebaseRow` speaks exact `RebaseAction` strings** (`"Pick"`, `"Drop"`,
  `"MainlinePick"`), not lowercased ones — a two-word action cannot survive a
  lowercase/re-capitalise round trip. The row's action control is a `PGSelect`
  (an in-page listbox, not a `<select>`), so specs drive it with `jsPickOption`
  and component tests with `pgPickOption`, passing the exact value.
- **Every transition is mirrored to `.git/platypusgit-rebase.json`**, and
  `rebase_status` / `repo_state` fall back to it when this process did not start
  the rebase. `repo_state` gives the file precedence over libgit2's
  `repo.state()`, which only sees the `CHERRY_PICK_HEAD` a paused step leaves
  behind.
- **A finished rebase leaves a summary the BACKEND retains until acknowledged**
  (`RebaseStatus.last_completed`, `.git/platypusgit-rebase-last.json`). The
  engine sweeps `RebaseState` the instant a plan completes, so the next
  `rebase_status` poll reports `total: 0`; the frontend used to cache the final
  status for its "N steps completed" line and therefore had to clear that cache
  on every abort and start path (#47). Now `rebase_start` and `rebase_abort`
  drop the summary in the engine and `rebase_acknowledge` spends it — the
  Rebase screen renders straight from `rebaseStatus.lastCompleted` and
  acknowledges on unmount, holding no copy of its own.
- **`continue_operation` / `abort_operation` delegate** to `rebase_continue` /
  `rebase_abort` whenever a rebase is in progress. The Conflict screen and the
  Rebase banner must stay two entry points to one engine: committing the
  resolved tree without advancing the plan strands the rest of the rebase.

## Network ops and credentials (#61 D5)

- **One runner, and every network op is on this list.** Every op that shells out
  to real `git` over the network goes through
  `commands::net::run_git_authenticated` (or, for clone, through its two
  primitives `apply_auth_env` + `map_git_failure`, because clone needs a
  streamed stderr pipe rather than `.output()`):
  `fetch`, `fetch_all`, `pull`, `push`, `push_tag`, `push_delete_branch` in
  `commands/branches.rs` (all six via its local `run_git_creds` wrapper),
  `clone_repo` in `commands/create.rs`, `forge_checkout_pull_request`'s FETCH in
  `commands/forge.rs` (#92 — its second git call, the `checkout` of `FETCH_HEAD`,
  passes `None` on purpose: the tip is already local and touches no remote), and
  — since #93 — `submodule_update` (`commands/submodule.rs`) plus `lfs_fetch` /
  `lfs_pull` (`commands/lfs.rs`).
  `grep -rn 'run_git_authenticated\|run_git_creds\|apply_auth_env' src-tauri/src/`
  is the authoritative list — a bare count used to lead this bullet and two PRs
  landing a day apart each updated the prose for their own additions only.
  A new network op joins them; **do not open a second auth path** — on the
  frontend that means `useRepoStore`'s exported
  `withAuthRetry`, not a private copy, or the challenge is raised with nothing
  mounted to answer it. The deliberately credential-less siblings are
  `branches.rs`'s local `run_git` (merge/rebase/checkout) and `libgit2.rs`'s
  `run_git_capture` (the #93 prompt-less shell-outs); `forge/token.rs`'s
  `git credential` and `forge/checkout.rs`'s `git rev-parse` spawn git directly
  because neither contacts a remote (and routing `git credential` through the
  authenticated runner would set `GIT_ASKPASS` and change its semantics).
- **Retry, never prompt mid-run.** The first attempt is always prompt-less, so the
  common case (helper or ssh-agent already works) is byte-for-byte what it always
  was. A failure is classified by `git/auth.rs::classify_auth_failure`; an auth
  failure becomes `AppError::Auth(AuthChallenge)`, the frontend raises it through
  `useAuthStore` and re-runs the SAME closure with credentials. Host-key
  verification failure stays `Network` on purpose — no typeable credential fixes
  it. New store actions use `withAuthRetry` and put `refreshAll()` INSIDE the
  retried closure.
- **`withAuthRetry` returns once the challenge is RAISED, not once the retry
  finishes.** So an action whose caller then decides something (a confirm, a
  toast) cannot report success/failure as a boolean — `false` would mean both "it
  failed" and "a password prompt is on screen", and the caller would stack its own
  dialog on top of the prompt. `useForgeStore.checkout` returns a
  `CheckoutOutcome` (`ok` | `branch-exists` | `auth-pending` | `error`) for exactly
  this reason.
- **Scrub before surfacing, always.** `map_git_failure` runs `scrub_credentials`
  first, on both branches, because git echoes remote URLs and a remote configured
  as `https://user:token@host/…` would otherwise put the token in an error banner
  and the log file. Userinfo ends at the LAST `@` of the authority — splitting on
  the first leaks the tail of a password containing `@`.
- **Secrets travel in the environment, never in argv.** Argv is world-readable via
  `ps`. `GIT_ASKPASS` points at our own bare executable with the mode selected by
  `PLATYPUSGIT_ASKPASS`, because `GIT_ASKPASS` is exec'd directly and cannot carry
  arguments. The shim answers on stdout and prints nothing else, ever.
- **End option parsing with `--` before any user-supplied value.** Remotes and ref
  names reach these commands from prompts and lists, and a value beginning with
  `-` is otherwise parsed as an option — `git push --receive-pack=<program>` names
  a program git runs for the transport, so this is argument injection, not a
  confusing error. `push_tag_args` / `push_delete_args` emit the separator and a
  test asserts every user value lands after it. Same class as the D5 security
  review's finding that `verify_commit` handed an oid straight to `git show`.
  `push_args` (fetch/pull/push) does NOT yet have one — its force flag is
  documented as coming last, which `--` would turn into a refspec, so fixing it is
  its own change.
- **`credential_approve` refuses values containing a newline** rather than
  escaping them: git's credential protocol is line-based `key=value`, so a
  newline injects further keys and could file a password against another host.

## Signing: one chain for commits and tags (#61 D6, #132)

- **One chain, two callers.** `libgit2.rs::sign_payload` is
  `resolve_signing` → `signing::resolve_key_file` → `signing_args` →
  `run_signer`, and `commit_signed` and `create_signed_tag` both call it. Do not
  open a second one: the ssh key-PATH restriction (`user.signingkey` must be a
  file, `key::…` and bare `ssh-…` literals are refused rather than written to a
  temp file) lives in `resolve_key_file`, and a private copy is how it would come
  to hold for commits and lapse for tags.
- **A signing failure creates nothing, ever.** Both writers put the ref update
  LAST — `repo.commit_signed` and `tag_annotation_create`/`odb.write` move no
  reference, so we move it ourselves, after the signature exists. An unsigned
  fallback would leave the user believing they had signed it.
- **`git2` has no `tag_signed`.** `create_signed_tag` builds the canonical
  UNSIGNED annotation with `tag_annotation_create`, reads its bytes back from the
  ODB, signs those, appends the armored signature and writes a second object.
  Deliberately not hand-written serialization: the payload is then byte-for-byte
  what libgit2 would have stored, with no tagger formatting or timezone
  arithmetic of ours. Cost: the unsigned annotation is left unreferenced and
  collected by `git gc`. **Shelling out to plain `git tag -s` was considered and
  rejected** — it does its own key resolution, so it would bypass `signing.rs`
  entirely and silently accept the `key::` literals commits refuse. (A hybrid —
  resolve here, then `git tag -s -u <key> -F -` — would keep the restriction; the
  spec records why route (a) won anyway, so nobody re-derives a false dichotomy.)
- **The ref write is not the only collision check.** `create_signed_tag`
  early-returns on an existing `refs/tags/<name>` BEFORE signing: otherwise a
  duplicate name pops pinentry, takes the passphrase, and only then fails. The
  atomic `force = false` write stays as the real guarantee.
- **Signing implies annotated.** A lightweight tag is a ref with no object to
  sign, so `sign: Some(true)` with no annotation is `InvalidArgument`, not a
  silent downgrade. A bare `tag.gpgsign`, though, does NOT promote a lightweight
  tag — real `git tag v1` fails outright there (`fatal: no tag message?`), which
  would make lightweight tags unreachable in a signing repository, and the
  dialog's blank annotation field *means* lightweight.
- **`commit.gpgsign` and `tag.gpgsign` are separate keys**, as in git. `sign:
  None` follows the matching one; `Some` overrides it for that one object.
- **`%G?` is a COMMIT format placeholder — never use it for a tag.** `git show
  <tag> --format=%G?` reports the *commit's* signature, and
  `for-each-ref`'s `%(signature:grade)` atom is empty for a tag object (checked
  against git 2.50.1). `verify_tag` uses `git verify-tag --raw` and its own
  parser, `tag::parse_verify_tag`, which returns the same `SignatureStatus`.
  Neither the exit status nor the text alone is sufficient: a valid signature
  from a key outside `allowedSignersFile` exits NON-ZERO while grading `G`/`U`.
  The `[GNUPG:] ` prefix is REQUIRED when matching a gpg status token — git
  relays gpg's status-fd output verbatim, on **stderr**, so read both streams.
- **"No false Good" belongs to the parser.** An SSH `Good` line is refuted by a
  non-zero exit plus `Could not verify signature`, so a signer that printed its
  verdict before its checks cannot produce a green badge. And a key outside
  `allowedSignersFile` (`Good "git" signature with …`, no principal) is
  `UnknownKey` for a TAG, not `Good` — the COMMIT path still says `Good` via
  `parse_verify_output`'s `U` mapping, which is a known gap with its own issue,
  not something to copy. There is no SSH `Revoked` branch: git emits only
  `Could not verify signature.` for a revoked key (measured, git 2.50.1 +
  OpenSSH 10.2), so one would be dead code.
- **Verdicts are lazy, presence is free.** `TagInfo.signed` is read off the tag
  object during the existing walk (no subprocess), so tag ROWS can mark a signed
  tag; the graded badge (`TagSignatureBadge`) verifies the SELECTED tag only.
  Same rule `SignatureBadge` states for the log: a verdict per row is a signer
  process per row.
## Stash: two addresses, one destructive trap (#133)

- **`StashInfo` carries `index` AND `oid`, and they are not interchangeable.**
  `index` is a position in the `refs/stash` reflog, so ANY write to that ref
  shifts it — a rename shifts it itself. So `stash_drop` and `stash_rename` take
  BOTH, and the oid is REQUIRED, not a convenience: they re-read the entry and
  compare before mutating, raising `StaleStash` on a mismatch. A COMPARISON
  takes the oid alone, because a stale index would silently diff a different
  entry. Every UI path already has the oid (`StashMenuTarget`, the palette's
  `stashItems`) — thread it, never assert past it.
- **Verify and mutate under ONE lock acquisition.** `with_repo_mut` holds the
  backend's `repos` mutex only for its closure, so a check in one acquisition
  and a drop in the next is a TOCTOU — and because that mutex serialises every
  backend git op, a concurrent command parked on it is scheduled to run at
  exactly that boundary. A write to `refs/stash` landing there shifts every
  index and the drop deletes an unrelated entry, permanently. `stash_drop_at`
  and `stash_finish_rename` exist for this; `stash_pairs` / `stash_entry_at`
  take an already-borrowed `&mut Repository` because `Libgit2Backend::stashes`
  takes the lock itself and std's `Mutex` is not reentrant. Nothing on the
  frontend gates stash writes with a busy flag, and the reflog screen's
  auto-stash is another live writer, so this is not theoretical.
- **`git stash store <oid>` is a SILENT no-op when `refs/stash` already points
  at `<oid>`.** git elides a value-identical ref update, writes no reflog entry,
  and still exits 0 — and that is exactly `stash@{0}`, the entry a user is most
  likely to rename. A store-then-drop rename that stores the EXISTING oid
  therefore destroys the top stash while reporting success. `stash_rename`
  stores a **fresh commit** instead (same tree, parents and both signatures;
  only the message differs), which cannot collide with the ref's current value
  and also keeps the stash commit's own message in step with its reflog message
  — the way `git stash push` writes both. Pinned by two tests in
  `tests/stash_rename.rs`, one of which asserts the git behaviour directly.
- **Additive first, destructive last, and gated.** Store, then verify
  (`stash::rename_store_landed`), then drop. Everything before the drop leaves
  the original entry where it was, so a failure anywhere yields a DUPLICATE the
  user can remove — never a gap. Do not "simplify" the verification away.
- **A rename moves the entry to the top.** The reflog can only be prepended to;
  restoring the previous order would mean dropping and re-storing every entry
  above it. The UI says so in the prompt and **re-reads the list** rather than
  patching its own copy.
- **The third parent is where `git stash -u` lives**, and no tree-level diff of
  the stash commit can reach it. `stash_diff` folds it in explicitly (its tree
  against the EMPTY tree, so exactly the untracked files, all added);
  `stash-vs-wt` cannot, so it excludes untracked on BOTH sides and says so. Any
  new stash comparison must make that decision out loud, not by default.
- **Pathspec ops set `GIT_LITERAL_PATHSPECS=1`** on top of the `--` rule, and
  the `--` alone does NOT cover it: that ends option parsing, and everything
  after it is still parsed as a pathspec. A path is data from `git status`, but
  git reads a leading `:` as magic, so a file honestly named
  `:(exclude)weird.txt` means "everything EXCEPT weird.txt" — a request to stash
  one file stashes the **whole worktree**. Pinned by
  `a_pathspec_magic_filename_is_a_literal_path_not_an_exclusion`, which was
  confirmed to fail without the env var. This is the only shell-out in the app
  that passes a pathspec — do not turn the flag on globally.
- **`git stash push` exits 0 when it saves nothing** ("No local changes to
  save"), so "was an entry created" is read off `refs/stash` before and after,
  never off the exit status. `Ok(None)` is a state, not a failure.
- **Hunk-level partial stash is deliberately absent, not merely unbuilt.** The
  `git stash push --staged` composition needs the index rewritten and restored
  around a subprocess, and an interruption in that window silently reduces the
  user's index to the selection — and staged-but-uncommitted work has no other
  copy anywhere. Crash-safety would need a journal, which is the `rebase_state`
  instrument applied to a case git owns (the `bisect.rs` reasoning). Building it
  needs its own spec; do not stub an affordance for it in the meantime.

## Spawning processes (issue 172)

- **Never write `Command::new` outside `src-tauri/src/proc.rs`.**
  `tests/spawn_no_window.rs` fails the build if you do, and the allow-list it
  carries names the two files that may (the module itself, and `detach.rs`'s
  `#[cfg(unix)]` re-exec) with the reason.
- The reason is Windows. `main.rs` sets `windows_subsystem = "windows"`, so a
  **release** build is a GUI-subsystem process with no console; every
  console-subsystem child (`git.exe`, `gpg.exe`, `powershell.exe`) is therefore
  given a *fresh* console with a visible `conhost.exe` window unless it is created
  with `CREATE_NO_WINDOW`. It reproduces only in a release/bundled build — a debug
  build already owns a console and children inherit it, so `pnpm tauri dev`
  concludes there is no bug.
- **Constructors, not a `no_window(&mut cmd)` helper.** A helper is something a new
  spawn site can forget, and 19 of 20 did. `proc::git(workdir)` /
  `proc::git_async(workdir)` hand back a `Command` that already carries the flag,
  `GIT_TERMINAL_PROMPT=0` and a closed stdin; `proc::git_async_in(dir)` is the
  clone shape (working directory instead of `-C`, because the repository does not
  exist yet); `proc::program(prog)` / `proc::program_async(prog)` apply the flag and
  nothing else, for children that are not git and own their stdio (the signing
  program pipes all three streams). A caller that pipes stdin overrides the
  constructor's `null` afterwards — later builder calls win.
- **The two console-KEEPING exceptions are deliberate**:
  `proc::git_async_keeping_console` (`git mergetool`) and
  `proc::program_async_keeping_console` (`$VISUAL`/`$EDITOR`). A console mergetool
  or `EDITOR=vim` *is* a terminal program: silencing it leaves an invisible process
  holding the file with `status().await` never returning and no cancel button. The
  asymmetry decides it — a stray console window is cosmetic, an invisible editor is
  Task Manager. The guard test allow-lists both call sites by name, so a third one
  is an argued decision rather than a copy-paste.
- **Decide with libgit2 before you spawn.** `verify_commit` shelled out
  unconditionally, so an unsigned commit — which renders NO badge — cost a console
  flash per commit selected in History. It now reads the `gpgsig` header through
  `extract_signature` first and answers `SigState::None` with no subprocess at all,
  the same pre-check `verify_tag` has had since #132. That is a cost win on every
  platform, not a Windows workaround, and the same question is worth asking of any
  new shell-out.

## Bisect: git's state is the only state of record (#93)

- **There is no `.git/platypusgit-bisect.json`, and there must not be.** Every
  transition is a `git bisect` invocation, so git owns `BISECT_START`,
  `BISECT_LOG`, `BISECT_TERMS` and `refs/bisect/*`, and a second record could only
  ever *disagree* with it. This is the exact inverse of `rebase_state.rs` — that
  file exists because the app DRIVES the replay and git cannot finish it — and the
  reason is the same one CLAUDE.md gives there, read from the other direction.
- Reading git's files is also what makes a bisect survive an app restart and pick
  up one the user started in a terminal, for free. `tests/bisect.rs` pins that
  with a FRESH `Libgit2Backend` continuing and resetting a bisect it never started.
- **`RepoState::Bisect` needed no new variant** — libgit2 already reports it off
  `BISECT_LOG`. What was missing was the detail (`bisect_status`) and the actions.
- Progress comes from `git rev-list --bisect-vars` (`bisect_nr` / `bisect_steps`),
  git's own arithmetic, so the numbers match what `git bisect good` prints and —
  unlike scraping that output — are recomputable at any time.
- **Read the terms from `BISECT_TERMS`**, never assume "bad"/"good":
  `refs/bisect/<term>` is named after them, so a `--term-old`/`--term-new` bisect
  would otherwise be invisible (no bad ref found → no progress, no culprit).
- Convergence is `bisect_rev == refs/bisect/<bad>` — git's own test. Note HEAD
  then sits on the last commit *tested*, not on the culprit, so the UI must NAME
  the first bad commit rather than let the user read a sha off the titlebar.

## Async / threading (Rust)
- `git2::Repository` is `Send` but not `Sync`. `Libgit2Backend` holds each opened repo as `Arc<Mutex<Repository>>` inside a `Mutex<HashMap<RepoId, ...>>` — `with_repo` clones the Arc and RELEASES the map lock before running the op, so different repositories run in parallel while same-repo ops still serialize on the inner mutex (which the stash TOCTOU note relies on). Several repositories are genuinely open at once (multi-repo tabs); `close` is the only thing that removes an entry.
- Always wrap git2 work in `spawn_blocking` from Tauri commands — don't block async runtime.

