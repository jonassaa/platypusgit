# Dubious repository ownership (WSL / `/mnt/c`) — design

Issue: [#83](https://github.com/jonassaa/platypusgit/issues/83)

## Problem

Opening a repository that lives on a Windows drive from a WSL-hosted Linux
build fails outright:

```
Git: repository path '/mnt/c/dev/reponame' is not owned by current user
```

libgit2 1.9.2 performs the same "dubious ownership" validation git added for
CVE-2022-24765 (`validate_ownership` in `repository.c`, reached from
`git_repository_open_ext`). It compares the owner of the working directory —
and of the gitdir, and of any gitlink — against the current uid, and on
mismatch fails the open with `GIT_EOWNER`.

Under WSL, `/mnt/c` is a drvfs mount whose reported ownership depends on the
mount's `uid=`/`metadata` options and the Windows-side ACL, so it routinely
disagrees with the WSL user's uid even though the repository is the user's
own. Keeping code on the Windows filesystem and editing it from both sides is
an ordinary setup, and today it is a hard block: the generic error banner
prints libgit2's sentence and there is no way forward from inside the app.

## What libgit2 will accept

Verified against the vendored 1.9.2 source rather than assumed, because three
details shape the fix:

- **Config key is the working directory.** `validate_ownership` checks every
  path in `validation_paths` (workdir, gitlink, gitdir) but looks up only
  `validation_paths[0]` — the workdir when there is one, the gitdir for a bare
  repo. So the string that must land in `safe.directory` is the workdir root,
  which is exactly the path the error message names.
- **Global config only.** `validate_ownership_config` calls
  `load_global_config`; the repository's own config is not consulted (it
  cannot be — the repo is not open yet).
- **Exact match or literal `*`.** `validate_ownership_cb` accepts `*`
  (everything), the empty string (resets accumulated entries, same as git),
  or a value that, once normalised to a trailing slash, equals the workdir.
  The `dir/*` suffix glob newer git supports is **not** implemented in 1.9.2 —
  so one entry per repository.

## Approach

Keep the security check on. Make the app actionable instead.

1. **Name the condition.** A new `AppError::DubiousOwnership(String)` variant
   carrying the canonicalised path, mirrored 1:1 into the TS union. Today
   `ErrorCode::Owner` falls through the `NotFound` arm in
   `Libgit2Backend::open` and stringifies into `AppError::Git`, which the
   frontend cannot narrow on and therefore cannot remedy.

   Canonicalised, not the raw input: `safe.directory` matching is exact, and
   the caller may hand us a relative path, a trailing slash, or a symlink.
   `std::fs::canonicalize` resolves the same way libgit2 does.

2. **Offer the remedy the error implies.** A `trust_repo_path` command appends
   the path to global `safe.directory` as a multivar — precisely what
   `git config --global --add safe.directory <path>` does, which is what git's
   own error text tells users to run. Idempotent: an entry that is already
   present (in either the bare or trailing-slash form) is not duplicated.

3. **Ask before doing it.** `useRepoStore.openRepo` catches
   `DubiousOwnership` and raises a `pgConfirm` that names the directory and
   says plainly what trusting it means and where the entry is written. On
   accept: trust, then retry the open. On dismiss: the normal error banner,
   carrying the help text instead of libgit2's bare sentence.

   Handling this in the store rather than per-screen covers every entry point
   at once — Welcome, recents, the `pgit` CLI launch, the palette.

4. **Stop mistaking "refused" for "absent".** Four call sites ask libgit2
   whether a repository exists by opening it and testing `is_ok()`/`is_err()`.
   Under `GIT_EOWNER` the answer today is "no repository here", which is
   wrong and, in two cases, unsafe:

   | Site | Today under `GIT_EOWNER` | Should be |
   | --- | --- | --- |
   | `libgit2.rs` nested-repo probe | embedded repo reads as an ordinary directory, so `reject_embedded_repo` stops firing and staging can write an unresolvable `160000` gitlink | treat as a repository |
   | `libgit2.rs` init guard | "not a repo yet", so `init` proceeds over an existing repository | surface the ownership error |
   | `create.rs` clone-target guard | "not a repo", so cloning into an existing repo root is allowed | treat as a repository |
   | `cli.rs` `resolve_repo_root` | `discover` fails, the raw path passes through, and a subdirectory launch reports `NotARepo` | walk ancestors for `.git` |

   The last one matters beyond the message: trusting a *subdirectory* does
   nothing, because matching is exact. The trust target has to be the root.

## Rejected

**`git2::opts::set_verify_owner_validation(false)` at startup.** It is
`unsafe`, process-global, and permanently disables the CVE-2022-24765
protection for every repository the app touches for the rest of the process —
including a repository dropped into a shared or temp directory by someone
else, whose `core.fsmonitor` or `core.pager` would then run on open. The whole
point of the check is that the attacker controls the config. A per-path,
user-confirmed exception costs one click and gives up nothing else.

**A Settings toggle for the same thing.** Same objection, plus it would be set
once and forgotten. If it is ever wanted it can be added later; nothing here
forecloses it.

**Trusting automatically when the path looks like `/mnt/`.** Silently
disabling a security check based on a path prefix is the same hole with a
narrower mouth, and it would not cover `//wsl.localhost` or network shares.
The user should be the one to decide, once per repository.

## Deviations from this design, as built

- **`init` gets the same trust-and-retry as `open`.** `git_repository_init_ext`
  finishes by opening what it created, so initialising a repository on a
  Windows drive under WSL trips the identical check. Fixing only `open` would
  have left the Init dialog a dead end for the same users, so
  `useCreateStore.runInit` runs the same confirm → trust → retry.
- **`init` maps ownership only.** It uses `map_ownership_error`, not
  `map_open_error`: the latter turns `NotFound` into `NotARepo`, which is a
  true statement when opening and a nonsense one when creating.
- **The trust check folds entries in order.** libgit2 evaluates
  `safe.directory` as a running verdict, and an empty value resets it. A
  "does any entry match" search would call a path already trusted when a later
  reset had cancelled it, and then silently decline to write the exception the
  user just asked for. The append also avoids the `^$` value pattern for the
  same reason — it matches a reset entry and would overwrite it, re-trusting
  everything listed above.

## Testing

The ownership failure itself cannot be provoked in a unit test — it needs a
directory owned by a different uid, i.e. root. What is testable, and is
tested:

- the mapping from a `GIT_EOWNER` `git2::Error` to `DubiousOwnership`, built
  with `git2::Error::new`
- the `safe.directory` writer against a temp global config: exact value,
  idempotence, coexistence with existing entries
- the ancestor walk that finds a repository root
- the three misclassification guards, exercised through their normal
  (non-ownership) paths so the refactor cannot regress them
- the store's dialog-and-retry flow, with the backend mocked

The uncovered gap is honest and narrow: whether a real `GIT_EOWNER` reaches
the new arm. That is a two-line match on a stable libgit2 error code.
