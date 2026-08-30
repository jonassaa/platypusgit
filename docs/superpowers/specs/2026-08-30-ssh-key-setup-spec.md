# Generate and show an SSH key (issue 248)

Status: approved for implementation.
Issue: [248](https://github.com/jonassaa/platypusgit/issues/248).

## Goal

When a `git@…` remote fails to authenticate, stop at "authentication failed" no
longer. Show the user whether they have an SSH key at all, let them make one
without leaving the app, put the public half on their clipboard, and open the
host's "add a new SSH key" page.

This is the other half of the clone-over-SSH story. `git/auth.rs` already
classifies `Permission denied (publickey)` into `AuthKind::SshKey`; what it
cannot do is help. Today the credential dialog answers that classification with
"The server rejected the SSH key that was offered. Enter a passphrase if the key
is encrypted, or configure a key it will accept." — a passphrase box for a
problem a passphrase almost never fixes.

## What is true in the tree, verified by reading it

- `grep -rn "ssh_key_generate\|ssh-keygen" src src-tauri/src` finds only the
  *signing* chain (`git/libgit2.rs`, `git/signing.rs`) and one auth test
  fixture. There is no key discovery and no key generation anywhere.
- `commands/net.rs::apply_auth_env` already sets `SSH_ASKPASS` to our own
  executable, plus `SSH_ASKPASS_REQUIRE=force`, `PLATYPUSGIT_ASKPASS=1` and
  `PLATYPUSGIT_ASKPASS_SECRET`. The shim answers in `lib.rs::run` via
  `cli::askpass_answer`, and `cli::askpass_want` already routes any prompt
  containing "passphrase" to the secret. **ssh-keygen's two prompts — "Enter
  passphrase (empty for no passphrase): " and "Enter same passphrase again: " —
  both match.** The askpass we need already exists and needs no change.
- `commands/update.rs::open_url` + `opener::safe_url` already open an https URL
  in the user's browser, https-only, shell-free, quote-rejecting.
- `forge/remote.rs::builtin_kind` already maps `github.com`/`gitlab.com` to a
  `ForgeKind`, and `forge/mod.rs::validate_host` already validates a host
  before it is interpolated into a URL.
- `base64` is a direct dependency; `sha2` 0.10.9 is already in `Cargo.lock`
  transitively.
- `AuthKind::SshKey` reaches the frontend as `AppError::Auth`, raised through
  `useAuthStore` by `useRepoStore`'s `withAuthRetry`.

## Probes, run against OpenSSH_10.2p1 rather than trusted from the docs

| Probe | Result |
| --- | --- |
| `ssh-keygen -t ed25519 -f k -N "" -C c` | key `0600`, `k.pub` `0644` |
| `ssh-keygen -y -f k -P ""` on an unencrypted key | exit 0 |
| `ssh-keygen -y -f k -P ""` on an encrypted key | exit 255, no prompt, no hang |
| `SSH_ASKPASS=… SSH_ASKPASS_REQUIRE=force ssh-keygen -t ed25519 -f k` | asks the askpass, writes an **encrypted** key |
| Same, with **no** askpass and stdin closed | prints both prompts and writes an **UNENCRYPTED** key, **exit 0** |
| `ssh-keygen -t ed25519 -f <existing>` | prints `already exists.` then blocks on an interactive `Overwrite (y/n)?` |
| `base64(sha256(blob))` minus padding | byte-identical to `ssh-keygen -lf`'s `SHA256:…` |

Two of those rows decide the design. The silent-unencrypted row is the reason
generation **verifies** its own result; the `Overwrite (y/n)?` row is the reason
we do our own existence check instead of relying on ssh-keygen's.

## The decisions

### 1. A top-level `ssh.rs` module, not a `GitBackend` method

An SSH key is a property of the machine and the user, not of a repository:
nothing here opens a repo, takes a `RepoId`, or touches an index. It sits beside
`diagnostics.rs`, `update.rs` and `reveal.rs` — logic module plus a thin
`commands/ssh.rs` — and adding it to the `GitBackend` trait would put a
repo-shaped signature on something with no repo in it, and force a
`NotImplemented` stub in `cli.rs` that proves nothing.

`user.email` for the key comment comes from `git2::Config::open_default()`
(global + system), which needs no repository either.

### 2. Two commands, and the private key is not in either answer

- `ssh_key_status(host: Option<String>) -> SshKeyStatus`
- `ssh_key_generate(request: GenerateRequest) -> SshKeyInfo`

`SshKeyInfo` carries `path`, `publicPath`, `algorithm`, `comment`,
`fingerprint`, `publicKey` and `isDefaultIdentity`. There is no field for the
private key and no command that reads one; the only thing the backend ever does
with the private half is `chmod` it and ask ssh-keygen whether it is encrypted.
A guard test serialises a freshly generated `SshKeyInfo` and asserts the JSON
contains no `PRIVATE KEY`.

### 3. Discovery lists what is on the machine, and is honest about what it cannot know

`~/.ssh` is scanned for `*.pub` files that have a private sibling. Each is
flagged `isDefaultIdentity` when its name is one OpenSSH tries without any
config (`id_rsa`, `id_ecdsa`, `id_ecdsa_sk`, `id_ed25519`, `id_ed25519_sk`,
`id_dsa`), and the list is sorted default-identities-first in that order.

We deliberately do **not** claim to know which key ssh *would* offer. A
`~/.ssh/config` `IdentityFile`, a `Host` block, an agent-only key and the
server's own algorithm preferences all change the answer, and a confident wrong
answer here is worse than an honest list. The UI says "keys on this machine"
and marks the default identities; parsing `~/.ssh/config` is out of scope.

The fingerprint is computed in-process (`SHA256:` + unpadded base64 of the
SHA-256 of the decoded blob — probed byte-identical to `ssh-keygen -lf`), so
listing N keys costs zero subprocesses. It is the string GitHub and GitLab show
next to a registered key, which is what makes "is this one registered?"
answerable by eye.

### 4. "Key exists but is not registered" is decided from two facts, on the frontend

`AuthKind::SshKey` means the host rejected what was offered. Combined with
whether any key exists at all, that splits into the two messages the issue asks
for:

- no key on the machine → "No SSH key found in ~/.ssh. Generate one and add it
  to `<host>`."
- at least one key → "`<host>` did not accept your SSH key. The usual cause is
  that it has not been added to your account — its public half is below."

The decision is a pure function (`features/auth/sshAdvice.ts`) so it is
table-tested, and it lives on the frontend because it is a choice of *words*,
and because `classify_auth_failure` is pure by design and must not start reading
`~/.ssh`.

We stop there. Proving registration would mean talking to the host, and the
guess above is honest about being a guess ("the usual cause").

### 5. The passphrase reuses the existing askpass; it never touches argv

`ssh-keygen` has no environment variable for a passphrase, and `-N <secret>`
would put it in argv, which `ps` shows to every user on the machine. So a
requested passphrase goes the same way a git credential already goes: our own
executable as `SSH_ASKPASS`, `SSH_ASKPASS_REQUIRE=force`, and the secret in
`PLATYPUSGIT_ASKPASS_SECRET`. No second auth path, no new shim — `askpass_want`
already answers a "passphrase" prompt.

An empty passphrase is not a secret, so *that* case passes `-N ""` in argv and
sets no askpass at all.

The askpass executable is a **parameter** of `ssh::generate`, resolved by the
command handler from `std::env::current_exe()`. Integration tests pass a
throwaway script instead — an integration-test binary is not the askpass shim,
so without this the passphrase path would be untestable.

### 6. Generation verifies its own result, and refuses rather than lying

Three refusals, in order:

1. **Never overwrite.** If either the private path or its `.pub` exists, the
   command fails with `AppError::SshKeyExists` before spawning anything.
   `suggested_name` picks the next free name (`id_ed25519`, then
   `id_ed25519_<host-label>`, then `id_ed25519_2`…) so "pick a new name" is one
   click, not a puzzle. This is our own check, not ssh-keygen's: ssh-keygen's is
   an interactive `Overwrite (y/n)?` against a stdin nobody is feeding.
2. **0600 or it did not happen.** On unix the private key is `chmod 0600` and
   the mode re-read afterwards; a private key ssh refuses to use is a worse
   problem than the one we set out to solve. `~/.ssh` is created `0700` if
   absent.
3. **A passphrase that did not stick is a deleted key.** The probe above shows
   ssh-keygen writing an unencrypted key and exiting 0 when the askpass does not
   fire. So when a passphrase was requested, generation runs
   `ssh-keygen -y -f <key> -P ""`; if that *succeeds* the key is unencrypted, and
   both files are removed and the command fails. Reporting "created, encrypted"
   over an unencrypted key is the one outcome worse than failing.

### 7. The add-key URL is built in Rust from the runtime host

`ssh::add_key_url(host, kind)` returns
`https://<host>/settings/ssh/new` for GitHub (public and Enterprise) and
`https://<host>/-/user_settings/ssh_keys` for GitLab, `None` for a host whose
forge we do not know. `forge::validate_host` runs first; the frontend hands the
result straight to the existing `open_url`, which re-validates.

Built in Rust on purpose. The host is interpolated (`format!("https://{host}/…")`),
which both privacy guards read as a *runtime* host rather than a baked-in one,
so this adds no entry to either allow-list and bakes no hostname into `src/`.
The frontend makes no request; it renders a string and asks the OS to open it.

### 8. Where it appears

Inside `CredentialDialog`, for `SshKey` and `SshPassphrase` challenges only — the
place a user actually arrives at with this problem, and the surface the issue
names. A new `SshKeyPanel` component, backed by a new `useSshKeyStore` in
`features/auth/`.

A separate store, not `useRepoStore`: this is machine state, not repository
state, so it must not join `RepoSlice` — and not `useAuthStore` either, which
holds one challenge and deliberately nothing else. Like the credential dialog,
the store never holds the passphrase; it lives in component state and is handed
to the invoke.

For an `SshKey` challenge the panel leads and the passphrase box is demoted
behind a disclosure — a rejected public key is not a passphrase problem. For an
`SshPassphrase` challenge the passphrase box keeps the lead and the panel is
supporting context.

### 9. A retry may carry no credential

Without this the feature dead-ends: generate a key, copy it, register it with
GitHub — and then the dialog's only button is disabled, because there is no
secret to type. So `AuthChallengeRequest.retry` widens to
`Credentials | undefined`, and an SSH challenge's Retry re-runs the operation
prompt-less.

Not a new path: `withAuthRetry`'s `attempt` has always taken
`creds?: Credentials`, and the prompt-less attempt is exactly the one that now
succeeds. HTTPS keeps requiring a secret — a blank token burns an
authentication attempt on a credential we already know is empty — and both
`rememberCredential` call sites gain a `creds &&` guard, which they wanted
anyway.

## Deliberately not in this change

- **A Settings entry point.** The issue is scoped to the auth dialog; a user who
  has never hit a failure has no complaint yet. Cheap to add later — the store
  and panel are not dialog-specific.
- **Parsing `~/.ssh/config`.** See decision 3.
- **Anything to do with ssh-agent** — adding a key to the agent, listing agent
  identities, `ssh-add`. Different problem, different failure modes.
- **Uploading the key to the host.** That needs a forge token with a scope we do
  not ask for, and the copy-plus-link path works on a self-hosted instance we
  have no API for.
- **Changing an existing key's passphrase, or deleting a key.** Destructive ops
  on a credential the app did not create.
- **Host-key verification** (`known_hosts`). Deliberately not an auth failure
  (`classify_auth_failure` returns `None` for it) and unchanged here.

## Risks

- **The passphrase path depends on ssh-keygen honouring `SSH_ASKPASS_REQUIRE`**,
  which is OpenSSH ≥ 8.4 (2020). On an older OpenSSH with no `DISPLAY` the
  askpass is not consulted and an unencrypted key is written — which decision 6
  catches, deletes and reports. The failure mode is a refusal, never a key the
  user wrongly believes is encrypted.
- **`ssh-keygen` may be absent** (a stripped Windows install). `canGenerate` is
  a *state* in the status payload — the button is disabled with a reason, in the
  shape `LfsUnavailable` already uses — and `ssh_key_generate` answers
  `AppError::SshKeygenUnavailable` rather than an `Io` error reading "No such
  file or directory".
- **`HOME` may be unset.** Every path answer is fallible; the status command
  reports the directory it looked in so a user can see we looked in the wrong
  place.
