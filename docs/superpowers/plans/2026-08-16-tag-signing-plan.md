# Tag signing — implementation plan

**Goal:** Annotated tags can be GPG/SSH signed, defaulting from `tag.gpgsign` and
overridable per tag; a signing failure creates no tag; tags carry a signature
state and the Branches screen shows it.

**Architecture:** The signing chain in `libgit2.rs::commit_signed` is factored
into two reusable pieces — `signing::resolve_key_file` (the SSH key-path
restriction, now pure) and `sign_payload` (config → args → `run_signer`) — and
the tag path calls them unchanged. A new pure `git/tag.rs` holds everything that
can be decided without a keyring: the armor-header test, the signature append,
the tag-name argv guard and the `git verify-tag --raw` parser. The frontend
replaces three single-value `pgPrompt` call sites with one store-driven modal,
and grows a tag counterpart to `SignatureBadge`.

**Tech Stack:** Rust + git2/libgit2, Tauri 2 commands, React 18 + Zustand,
vitest/RTL.

**Design doc:** `docs/superpowers/specs/2026-08-16-tag-signing-spec.md`
**Issue:** [#132](https://github.com/jonassaa/platypusgit/issues/132)

## Global Constraints

- Every IPC-crossing fn returns `AppResult<T>`. No new `AppError` variant is
  needed here; if one becomes necessary, `src/lib/errors.ts` changes in the same
  commit.
- New git op → trait method, `Libgit2Backend` impl, `CliBackend`
  `NotImplemented` stub, thin command, `invoke_handler!` registration, TS type +
  `lib/tauri.ts` wrapper, store wiring. All six steps.
- git2 work in commands goes through `spawn_blocking`.
- Never `window.confirm` / `window.prompt` — `pgConfirm` / `pgPrompt` from
  `@/design`. Component tests that render a dialog-using surface need
  `WithDialogs` from `@/test/dialog`.
- Frontend never calls `invoke()` directly.
- New per-repo store field → `RepoSlice` / `emptySlice` (`repoSlice.test.ts`
  enforces it). `TagInfo` is a field of the existing `tags` array, so no new key.
- New list-row surface opts into density: `calc(<base>px + var(--row-step))`.
  The tag row already does; the lock glyph rides inside it.
- Never hardcode the accent hue.
- Secrets never in argv; user-supplied values land after `--`.
- Run pnpm/cargo with `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"`.
- **Do not run e2e** — the orchestrator serializes it centrally.

## File Structure

**Create:**
- `src-tauri/src/git/tag.rs` — pure: `has_signature_block`, `append_signature`,
  `validate_tag_name`, `parse_verify_tag` + unit tests.
- `src-tauri/tests/tag_signing.rs` — integration, ssh-keygen-gated.
- `src/features/tags/useCreateTagStore.ts`
- `src/features/tags/CreateTagDialog.tsx`
- `src/features/tags/CreateTagDialog.test.tsx`
- `src/features/signing/TagSignatureBadge.tsx`
- `docs/superpowers/specs/2026-08-16-tag-signing-spec.md`
- `docs/superpowers/plans/2026-08-16-tag-signing-plan.md`

**Modify:**
- `src-tauri/src/git/signing.rs` — `config_flag`, `config_wants_tag_signing`,
  `resolve_key_file`, doc generalization.
- `src-tauri/src/git/mod.rs` — `pub mod tag;`, `verify_tag` on the trait.
- `src-tauri/src/git/types.rs` — `TagInfo.signed`, `TagTarget.sign`.
- `src-tauri/src/git/libgit2.rs` — `sign_payload`, `create_signed_tag`,
  `create_tag`, `tags`, `verify_tag`.
- `src-tauri/src/git/cli.rs` — `verify_tag` stub.
- `src-tauri/src/commands/branches.rs` — `verify_tag` command.
- `src-tauri/src/lib.rs` — registration.
- `src-tauri/tests/branches_tags.rs` — `TagTarget` literals gain `sign`.
- `src/lib/types.ts`, `src/lib/tauri.ts`
- `src/features/signing/SignatureBadge.tsx` — extract `SignatureBadgeView`.
- `src/AppShell.tsx` — mount `<CreateTagDialog />`.
- `src/features/keymap/actions.ts` — `app.closeOverlay` closes it.
- `src/design/context-menu.tsx`, `src/screens/History.tsx`,
  `src/features/palette/commands.ts` — the three call sites.
- `src/screens/Branches.tsx` — row lock glyph + inspector badge.
- `CLAUDE.md` — the tag-signing convention.

---

### Task 1: Factor the signing chain so the tag path can reuse it

- [ ] `signing.rs`: `fn config_flag(repo, key) -> bool`; `config_wants_signing`
      and a new `config_wants_tag_signing` (`tag.gpgsign`) both delegate to it.
- [ ] `signing.rs`: move the SSH key resolution out of `commit_signed` into
      `pub fn resolve_key_file(cfg: &SigningConfig) -> AppResult<Option<PathBuf>>`
      — `key::` / bare `ssh-…` literals stay refused. Unit-test it there.
- [ ] `libgit2.rs`: `fn sign_payload(repo, payload: &str) -> AppResult<String>` =
      `resolve_signing` → `resolve_key_file` → `signing_args` → `run_signer`.
      `commit_signed` calls it; its behaviour is unchanged.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — pure refactor, existing
      `signing.rs` tests must still pass.

### Task 2: `git/tag.rs` — the pure half, tests first

- [ ] `has_signature_block(message)` over git's four armor headers, anchored to a
      line start.
- [ ] `append_signature(body: &[u8], sig: &str) -> Vec<u8>` — one trailing
      newline on the body, then the signature, itself newline-terminated.
- [ ] `validate_tag_name(name) -> AppResult<()>` — refuse empty, leading `-`,
      whitespace, control chars, `..`, `~^:?*[\`, trailing `.lock`.
- [ ] `parse_verify_tag(raw, ok) -> SignatureStatus` per design §E, including the
      unrecognized-failure → `UnknownKey` fallback.
- [ ] Unit tests for all four, with the SSH strings recorded from a real
      `git verify-tag --raw` run.
- [ ] `mod tag;` in `git/mod.rs`.

### Task 3: Write the signed tag

- [ ] `types.rs`: `TagTarget.sign: Option<bool>` (`#[serde(default)]`),
      `TagInfo.signed: bool`.
- [ ] `libgit2.rs::create_signed_tag` — `tag_annotation_create` → `odb.read` →
      `sign_payload` → `append_signature` → `odb.write` → `repo.reference`.
      Comment the two traps: no ref is written by the annotation call, and the
      ref must come last so a signing failure leaves no tag.
- [ ] `libgit2.rs::create_tag` — resolve `want_sign` from
      `target.sign.unwrap_or_else(config_wants_tag_signing)`; validate the name;
      the design §C table, including `InvalidArgument` for signed-lightweight.
- [ ] `libgit2.rs::tags` — fill `signed` from the tag object's message.
- [ ] Fix the three `TagTarget` literals in `tests/branches_tags.rs`.
- [ ] `tests/tag_signing.rs` per design §Testing, `ssh_signing_repo()`-gated.

### Task 4: `verify_tag`

- [ ] Trait method on `GitBackend`; `CliBackend` stub.
- [ ] `Libgit2Backend::verify_tag` — validate, short-circuit unsigned without a
      subprocess, else `git verify-tag --raw --` with `GIT_TERMINAL_PROMPT=0` and
      a null stdin, stdout+stderr through `parse_verify_tag`.
- [ ] `commands/branches.rs::verify_tag` + `lib.rs` registration.
- [ ] Integration coverage in `tests/tag_signing.rs`: `Good` for a signed tag,
      `None` for annotated-unsigned and lightweight, `InvalidRef` for a bad name.

### Task 5: Frontend types + badges

- [ ] `lib/types.ts`: `TagInfo.signed`. `lib/tauri.ts`: `TagTarget.sign`,
      `verifyTag(repoId, name)`.
- [ ] `SignatureBadge.tsx`: extract `SignatureBadgeView({ status, testId })`
      holding `LOOK` + markup; `SignatureBadge` becomes its commit caller.
- [ ] `TagSignatureBadge.tsx` — same debounce, `verifyTag`, `SignatureBadgeView`.
- [ ] `Branches.tsx`: lock glyph on a `signed` tag row (title "Signed tag");
      `TagInspector` renders `TagSignatureBadge`.

### Task 6: The create-tag dialog

- [ ] `useCreateTagStore` — `{ open, oid, shortOid }` + `openCreateTag(target)`
      returning a promise that settles on submit or dismiss.
- [ ] `CreateTagDialog` — `PGModal`, name / annotation / three-state sign
      checkbox, sign disabled while the annotation is blank, submit calls
      `useRepoStore.createTag`. `data-testid`s: `create-tag-name`,
      `create-tag-annotation`, `create-tag-sign`, `create-tag-submit`.
      Reset the form on every closed→open transition — the dialog stays mounted.
- [ ] `AppShell.tsx`: mount it. `actions.ts`: `app.closeOverlay` closes it,
      inserted beside the clone/init branch.
- [ ] Repoint `design/context-menu.tsx`, `screens/History.tsx` and
      `features/palette/commands.ts` at `openCreateTag`.
- [ ] `CreateTagDialog.test.tsx` per design §Testing.

### Task 7: Docs + verification

- [ ] `CLAUDE.md`: signing section gains the tag rule (one chain, ref last,
      lightweight cannot be signed, `%G?` is commit-only).
- [ ] `pnpm tsc --noEmit`, `pnpm test`,
      `cargo check --manifest-path src-tauri/Cargo.toml`,
      `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Small Conventional Commits, push, draft PR against #132. **No e2e run.**
