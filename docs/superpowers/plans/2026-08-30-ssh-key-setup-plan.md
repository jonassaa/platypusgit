# Plan — generate and show an SSH key (issue 248)

Spec: `docs/superpowers/specs/2026-08-30-ssh-key-setup-spec.md`.
One PR, `feat/ssh-key-setup`.

## 1. Backend: `src-tauri/src/ssh.rs`

New top-level module (registered in `lib.rs`'s `pub mod` list).

Pure, unit-tested inline:

- `DEFAULT_IDENTITIES` — OpenSSH's default identity names, in its own order.
- `is_default_identity(name)`.
- `parse_public_key(line) -> Option<(algorithm, blob_b64, comment)>` — the
  `<algo> <base64> [comment]` format, rejecting anything else.
- `fingerprint(blob_b64) -> Option<String>` — `SHA256:` + unpadded base64 of the
  SHA-256 of the decoded blob. Pinned against a known `ssh-keygen -lf` output.
- `validate_key_name(name)` — non-empty, `[A-Za-z0-9._-]` only, no separators,
  no leading `-`, not `.pub`, length-bounded.
- `validate_comment(c)` — no control characters, no newline, length-bounded.
- `suggested_name(existing, host)` — `id_ed25519`, then
  `id_ed25519_<host-label>`, then `id_ed25519_2…`; first free, bounded.
- `host_label(host)` — first DNS label, sanitised.
- `add_key_url(host, kind)` — GitHub / GitLab paths, `None` otherwise, behind
  `forge::validate_host`.

Impure:

- `ssh_dir()` — `$HOME/.ssh` (`%USERPROFILE%` on Windows).
- `discover(dir) -> Vec<SshKeyInfo>` — scan `*.pub` with a private sibling.
- `keygen_available()` — `ssh-keygen -?`-style probe through `proc::program`,
  cached in a `OnceLock` (missing-binary is a state, not an error).
- `default_comment()` — `git2::Config::open_default()`'s `user.email`, else
  `user@host`.
- `status(dir, host, kind)` -> `SshKeyStatus`.
- `generate(dir, req, askpass) -> AppResult<SshKeyInfo>` — the whole of spec
  decision 6.

Every spawn goes through `proc::program("ssh-keygen")`, stdin nulled.

## 2. Backend: errors, commands, registry

- `error.rs`: `SshKeyExists(String)`, `SshKeygenUnavailable(String)`.
- `commands/ssh.rs`: `ssh_key_status`, `ssh_key_generate`, both thin, both in
  `spawn_blocking`; `ssh_key_generate` resolves the askpass from
  `std::env::current_exe()`.
- `commands/mod.rs` + `lib.rs` `generate_handler!`.

## 3. Frontend

- `lib/types.ts`: `SshKeyInfo`, `SshKeyStatus`, `SshKeyGenerateRequest`.
- `lib/tauri.ts`: `sshKeyStatus`, `sshKeyGenerate`.
- `lib/errors.ts`: the two new union members, `appErrorDetail` cases, an
  `SSH_KEYGEN_UNAVAILABLE_HELP` constant.
- `features/auth/sshAdvice.ts` — pure; `(kind, status) -> {tone, headline, body}`.
- `features/auth/useSshKeyStore.ts` — `status`, `loading`, `generating`,
  `error`, `generated`; `load(host)`, `generate(req)`, `reset()`. Never holds a
  passphrase.
- `features/auth/SshKeyPanel.tsx` — key list, advice line, copy, add-key link,
  generate sub-form.
- `features/auth/CredentialDialog.tsx` — mount the panel for the two SSH kinds;
  demote the passphrase box for `SshKey`.

## 4. Tests

Rust — `src-tauri/tests/ssh_keys.rs`, all against `tempfile` dirs, never `~/.ssh`:

- discovery finds a pair, reads algorithm/comment/fingerprint, flags default
  identities, ignores a `.pub` with no private sibling;
- fingerprint matches `ssh-keygen -lf` for a key we just generated;
- generate refuses when the private path exists, and when only the `.pub` does;
- generated private key is `0600` and `~/.ssh` is `0700` (unix);
- the returned payload, serialised, contains no private key material;
- a passphrase (via a temp askpass script, `#[cfg(unix)]`) produces a key that
  `ssh-keygen -y -P ""` cannot read;
- an askpass that answers nothing leaves no key behind and errors;
- `suggested_name` / `validate_key_name` / `add_key_url` tables (inline).

Every ssh-keygen-dependent test skips with a printed reason when the binary is
absent, so a Windows runner without OpenSSH does not fail the suite.

Vitest:

- `sshAdvice.test.ts` — the four (kind × has-key) cells.
- `SshKeyPanel.test.tsx` — renders the offered key; the no-key advice; copy
  writes the public key; the add-key link calls `openUrl` with the backend's
  URL; generate posts the typed name/comment and never the passphrase to the
  store; a refusal surfaces.
- `CredentialDialog.test.tsx` — additions: the panel appears for SSH kinds and
  not for `Https`; the existing secret-never-in-store assertion still holds.
- `errors.test.ts` — the two new variants render prose, not the enum spelling.

## 5. Docs

- `docs/dev/architecture.md` — `ssh.rs` in the backend tree, `commands/ssh.rs`
  with both command names (required by `test/docs.test.ts`), the new files under
  `features/auth/`.
- `docs/dev/backend.md` — one section: the askpass reuse, secret-in-env, the
  three refusals, why the URL is built in Rust.
- `docs/dev/frontend.md` — a short note under Dialogs.
- `Cargo.toml` — declare `sha2` with the "already transitively present" comment
  the file already uses for `base64`/`url`/`semver`.

## 6. Verification

`pnpm tsc --noEmit`, `pnpm test`, `cargo test`. No e2e spec added; CI runs the
suite.
