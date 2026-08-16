# Tag signing: GPG/SSH signed annotated tags + a verified badge

**Issue:** [#132](https://github.com/jonassaa/platypusgit/issues/132)

## Problem

Commit signing shipped in 0.0.8 (#61 D6) and stopped at commits. `git/signing.rs`
resolves `gpg.format` → program → `user.signingkey`, `libgit2.rs::commit_signed`
builds the buffer, spawns the signer, writes the object and moves the ref, and
`verify_commit` + `SignatureStatus` back the badge in `CommitDiffPanel`.

Tags got none of it:

- `create_tag` is `repo.tag(name, obj, sig, msg, false)` for an annotated tag and
  `tag_lightweight` otherwise. `tag.gpgsign` is never read; `CommitOptions.sign`
  has no tag counterpart.
- The three create-tag entry points (`design/context-menu.tsx:417`,
  `screens/History.tsx:1196`, `features/palette/commands.ts:523`) are
  single-value `pgPrompt`s. Two of them cannot even produce an annotated tag —
  they hardcode `annotation: null`.
- `TagInfo` is `{ name, shortOid, oid }`. Nothing can verify a tag, so the
  Branches screen's tag rows have nothing to badge.

A repository that signs every commit therefore publishes unsigned tags, and
releases are exactly what people verify.

## Design

### A. How a signed tag gets written (the decision the issue defers)

Two routes were on the table. **We hand-roll the object.** `git tag -s` is
rejected.

`git2` has `commit_signed` but no `tag_signed`, so route (a) means building the
annotated-tag body, signing it, appending the armored signature and writing the
result to the ODB — which is what git itself does in `builtin/tag.c::do_sign`.
The hand-rolling is smaller than it sounds, because we do **not** re-derive git's
object serialization:

1. `repo.tag_annotation_create(name, target, tagger, message)` writes the
   canonical **unsigned** tag object and returns its oid. It creates no ref — the
   same shape as `commit_signed`, and the same trap.
2. `odb.read(oid)` gives that object's raw bytes back. Those bytes *are* the
   payload git signs: `object`/`type`/`tag`/`tagger` headers, a blank line, the
   message. No hand-written tagger formatting, no timezone arithmetic, no risk of
   producing a body that differs by a byte from the one libgit2 would have
   written.
3. `sign_payload` runs it through the existing `resolve_signing` →
   `resolve_key_file` → `signing_args` → `run_signer` chain — literally the same
   four calls `commit_signed` makes, extracted so there is one implementation.
4. `append_signature` glues the armored signature onto the body (after
   normalizing the message to end in exactly one `\n`, which git also does — a
   body whose last line is not terminated would run the armor header onto it and
   produce a tag nothing can verify).
5. `odb.write(ObjectType::Tag, bytes)` → `repo.reference("refs/tags/<name>", …)`.

Why not plain `git tag -s` (the issue's route b):

- **It would bypass `signing.rs` entirely.** `git tag -s` does its own
  `gpg.format` / `user.signingkey` resolution, so `SigningConfig`,
  `signing_args`, `run_signer` and the SSH key-path restriction would all be
  unused on the tag path. The issue asks to reuse `signing.rs` wholesale, and the
  SSH restriction — `user.signingkey` must be a key *path*, `key::…` literals are
  refused rather than written to a temp file — is **not kept** by `git tag -s`,
  which handles `key::` literals itself. Tags would silently accept what commits
  refuse.
- **It would split the annotated path in two.** Signed and unsigned annotated
  tags would then differ in tagger resolution (`default_signature` vs git's own
  config read), in force semantics, and in what happens on a name collision.
- **Testability.** Route (a) leaves the interesting parts pure:
  `append_signature`, `has_signature_block`, `validate_tag_name` and
  `parse_verify_tag` are all `#[cfg(test)]`-able with no keyring. Route (b) is
  one opaque subprocess.

**Rejected alternative — route (c), a hybrid, which the issue's binary framing
did not name.** Resolve the config *here* (`resolve_signing` + `resolve_key_file`,
refusing `key::` and bare `ssh-…` exactly as commits do) and only then delegate
the write:

```
git tag -s -u <resolved-key> -F - --cleanup=verbatim -- <name> <commit>
```

with the message on stdin. That preserves the whole justification above — the SSH
restriction still holds, because we refuse before git is ever invoked — while
removing both the hand-rolled object and the dangling one. It is a genuine
option, and it means route (a) is chosen for **testability and payload purity**,
not out of necessity:

- the signed bytes are the ones libgit2 itself produced, so there is no second
  serializer whose output could drift from the unsigned path's;
- the failure modes stay ours (`AppError` from `run_signer`) instead of arriving
  as `git tag`'s stderr needing classification;
- the whole thing is exercisable with a stubbed signer, because we own the
  invocation.

Route (a) is what shipped; this is recorded so the next reader is not left with a
false dichotomy.

Route (a) costs one orphan object per signed tag: the unsigned annotation from
step 1 is never referenced. It is unreachable and collected by `git gc` like any
other loose object, and — the point — **it never gets a ref**, so a signing
failure at step 3 leaves no tag behind. git writes one object instead of two;
that is the whole difference.

`create_tag`'s unsigned paths are untouched, byte for byte.

### B. A signing failure creates no tag

Non-negotiable, and the same reasoning `commit_signed`'s doc comment gives:
falling back to an unsigned tag leaves the user believing they signed it. The
ordering above is what enforces it — the ref is written **after** the signature
exists, so every failure mode (no key, X509, missing program, non-zero exit,
empty signature) returns an error with `refs/tags/<name>` absent.

A **name collision is checked before the signer runs**, not only by the final
`repo.reference(…, force = false)`. With `tag.gpgsign` on and a
passphrase-protected key, re-creating an existing `v1.0.0` would otherwise raise
pinentry, take the user's passphrase, and only then fail with "tag already
exists" — having written two objects for nothing. The early check is an
optimisation of the common case, not a replacement: the atomic `force = false`
write stays, so a ref created between the two still fails.

### C. Signing implies annotated

A lightweight tag is a ref pointing at the commit. There is no object to sign, so
signing one is not a thing that can be done, only a thing that can be silently
not done.

| `annotation` | `sign` | Result |
| --- | --- | --- |
| `Some(msg)` | `Some(true)` | signed annotated tag |
| `Some(msg)` | `Some(false)` | annotated tag, unsigned |
| `Some(msg)` | `None` | follows `tag.gpgsign` |
| `None` | `Some(true)` | **`InvalidArgument`** — refused, never quietly dropped |
| `None` | `None` / `Some(false)` | lightweight tag, unsigned |

The last row deliberately diverges from `git tag`. Real git treats
`tag.gpgsign=true` as implying `-s`, which implies `-a`, so `git tag v1` in such
a repository fails outright with `fatal: no tag message?` (verified against git
2.50.1). Our create-tag dialog has an explicit annotation field whose blankness
*means* lightweight, so we neither promote the tag to annotated behind the user's
back nor make lightweight tags unreachable in a signing repository. The dialog
disables and explains the sign toggle while the annotation is blank, so the
refused combination is not reachable from the UI at all — the backend check is
there for the IPC boundary, not for the button.

### D. `TagTarget.sign` and the create-tag dialog

`TagTarget` gains `sign: Option<bool>`, `#[serde(default)]`, with exactly
`CommitOptions.sign`'s semantics: `None` follows git config (`tag.gpgsign` here),
`Some` overrides it for this tag. `signing.rs` gains `config_wants_tag_signing`
beside `config_wants_signing`; both delegate to one `config_flag` helper so the
two keys cannot drift.

Three values (name + annotation + sign) do not fit a `pgPrompt`, so the three
call sites collapse onto one dialog:

- `features/tags/useCreateTagStore.ts` — `openCreateTag(target) => Promise<void>`,
  holding `{ open, oid, shortOid }` plus the resolve closure. Store-driven and
  promise-shaped for the same reason `useAuthStore` is: two of the three call
  sites (a context-menu item builder and a palette step) are not React components
  and cannot render a modal themselves.
- `features/tags/CreateTagDialog.tsx` — `PGModal` mounted once in `AppShell`,
  beside `CredentialDialog` / `CloneDialog`. Name (mono, required), annotation
  (textarea, blank = lightweight), and the **same three-state sign checkbox
  CommitPanel uses**: checked / unchecked / indeterminate, where indeterminate is
  "follow `tag.gpgsign`", which the frontend cannot read. Showing it as plain
  unchecked would claim the tag is unsigned in a repository that has tag signing
  on.
- Escape closes it through the keymap's `app.closeOverlay`, not a local listener,
  inserted in the same precedence chain as the clone/init dialogs.

No new setting. `signCommits` has a `"config" | "always" | "never"` preference
because the commit box is used many times a day; a tag is created rarely and
deliberately, so the dialog starts indeterminate every time and the repository's
own `tag.gpgsign` remains the default. A `signTags` preference can be added later
without changing anything here.

### E. Verifying a tag: `%G?` is commit-only

`verify_commit` asks `git show --format=%G?%x00%GS%x00%GK`. That does **not**
work for tags: `%G?` is a commit placeholder, and `git show <tag>` would report
the *commit's* signature, not the tag's. `git for-each-ref
--format='%(signature:grade)'` does not fill the gap either — verified
empirically against git 2.50.1, the atom yields the grade for a branch ref and an
empty string for a tag ref, because ref-filter only computes signatures for
commits.

So `verify_tag(repo_id, name)`:

1. **Validate the name before it reaches an argv** (`validate_tag_name`) — same
   class as `verify_commit`'s hex check and the D5 review's `git show` finding. A
   value beginning with `-` would be read as an option. The argv also ends option
   parsing with `--`.
2. **Answer the common case without a subprocess.** Peel `refs/tags/<name>`; a
   lightweight tag, or an annotated tag whose message carries none of git's four
   armor headers (`-----BEGIN PGP SIGNATURE-----`, `PGP MESSAGE`,
   `SIGNED MESSAGE`, `SSH SIGNATURE`), is `SigState::None`. Most tags in most
   repositories are unsigned, and this is the read that keeps the badge from
   spawning a process for each of them.
3. Otherwise `git -C <path> verify-tag --raw -- <name>`, stdout and stderr
   concatenated (git writes the verdict to stderr), through the pure
   `parse_verify_tag(raw, exit_ok)`.

`parse_verify_tag` returns the **existing** `SignatureStatus`, but it cannot
reuse `parse_verify_output` — that one parses git's already-digested
`%G?%x00%GS%x00%GK` triple, and `--raw` is the undigested signer output. It maps
git's own two shapes:

- **GPG status lines.** `BADSIG` → `Bad`, `REVKEYSIG` → `Revoked`,
  `EXPKEYSIG`/`EXPSIG` → `Expired`, `ERRSIG` → `UnknownKey`, `GOODSIG` → `Good`,
  taking `<keyid> <username>` off the matched line. Checked in that order so a
  compromising verdict wins if several appear. This mirrors git's own
  `sigcheck_gpg_status` table in `gpg-interface.c`.
- **SSH.** `Good "git" signature for <principal> with <type> key <fp>` → `Good`
  with signer + key. `Good "git" signature with <type> key <fp>` → **`UnknownKey`**
  (see below). `Could not verify signature.` / `Signature verification failed` →
  `Bad`.

There is deliberately **no SSH `Revoked` branch**. Measured against git 2.50.1 +
OpenSSH 10.2, a key revoked through `gpg.ssh.revocationFile` produces exactly
`Could not verify signature.` and exit 1 — ssh-keygen keeps the reason behind
`debug3_fr`, so neither a `Good` line nor the word "revoked" ever reaches us. A
`revoked`-substring branch would look prudent and be dead code. GPG revocation is
still reported, from `REVKEYSIG`.

**"No false Good" is a property of the parser, not of ssh-keygen's output
order.** A `Good` line is refuted by a non-zero exit *plus* a
`Could not verify signature` line, so a signer that printed its verdict before
its checks cannot produce a green badge for a signature git rejected. The
legitimate untrusted-key case never carries that line — an unmatched principal
says `No principal matched.`, a missing allowed-signers file says
`Unable to open allowed keys file …` — so the guard cannot misfire on it.

**A key outside `allowedSignersFile` is `UnknownKey`, not `Good`.** The common
SSH setup configures no allowed-signers file at all, which yields
`Good "git" signature with ED25519 key SHA256:…` and exit 1: the signature is
real, but nothing vouches for *whose* key made it. Rendering that as a green
"Signed" on a release tag is precisely the claim this feature exists to make
trustworthy, and the two shapes are distinguishable (`signature for ` names a
principal, `signature with ` names only a fingerprint), so this is information we
have rather than a guess. **The COMMIT path still reports it as `Good`**, because
`parse_verify_output` maps git's `U` that way — a real gap, inherited rather than
introduced, deliberately left for its own change rather than widened into this
one.

Unrecognized output falls back to `Good` when git exited 0 (it only does that for
`G` and `U`) and to **`UnknownKey`** when it did not. `UnknownKey` renders as
"Signed, key unavailable" — honest about not having checked — rather than `Bad`,
which would cry wolf, or `None`, which would show a real signature as absent.
`SigState::None` is reserved for "there is no signature", which step 2 already
decided.

`ERRSIG` carries **no signer**: its tail is gpg's positional fields
(`<pkalgo> <hashalgo> <sigclass> <time> <rc> <fpr>`), not a user id, and the badge
joins the signer into its tooltip.

### F. `TagInfo.signed` is cheap; the verdict is lazy

`TagInfo` gains `signed: bool`, read from the tag object's own message during the
existing `tag_foreach` walk. It costs no subprocess and no extra I/O, so
`list_tags` stays what it was.

The **verdict** is fetched lazily, exactly like commit verification, and for the
same stated reason: `SignatureBadge`'s doc comment refuses "a badge on every log
row" because it means one gpg/ssh-keygen process per row. The Branches screen
renders every tag at once, so an eager verdict would be N processes on screen
entry and N more on every refresh.

Where that lands in the UI:

- **Tag rows** show a lock glyph next to the tag glyph when `signed`. It states a
  fact read from the object ("this tag carries a signature") and claims no
  verdict, which is the only thing free information can honestly say.
- **`TagInspector`** — the selected tag, one at a time — renders
  `TagSignatureBadge`, which calls `verify_tag` behind the same 100 ms debounce
  `SignatureBadge` uses and shows the real Good/Bad/Expired/Revoked/UnknownKey
  verdict.

`SignatureBadge`'s `LOOK` table and markup are extracted into
`SignatureBadgeView` so the commit badge and the tag badge cannot drift into two
vocabularies for one set of states.

### G. What does not change

`push_tag` already ends option parsing with `--` and goes through the
credentialed runner; a signed tag is an ordinary tag object to it. `delete_tag`,
`checkout_ref`, the tag context menu and the palette's delete/push commands are
untouched. No new `AppError` variant is needed — every failure here is an
existing `Git`, `InvalidArgument`, `InvalidRef`, `NotImplemented` or `Io`, so
`src/lib/errors.ts` stays as it is.

## Testing

- **Rust, pure** (`git/tag.rs` unit tests, no keyring): `append_signature`
  normalizes the trailing newline and appends exactly once;
  `has_signature_block` recognizes all four armor headers and rejects a message
  that merely mentions one mid-line; `validate_tag_name` refuses empty, leading
  `-`, leading `.`, whitespace, control characters and `..`; `parse_verify_tag`
  maps every GPG status token and both SSH "Good" shapes, plus the tamper,
  refuted-Good and no-signature cases — the SSH strings are **recorded from a
  real `git verify-tag --raw`**.
- **Rust, GPG pipeline** (`tests/tag_signing_gpg.rs`). Hand-written status
  fixtures under-constrain — that is how `ERRSIG`'s positional tail came to be
  rendered as a signer name — so the OpenPGP side gets two layers. First, a
  **stubbed `gpg.program`** (needs only `/bin/sh`, so it always runs): everything
  but the cryptography is real — our `create_signed_tag` with the real OpenPGP
  argv, a real tag object, a real `git verify-tag --raw`, the real parser. This
  is what establishes the two facts the parser rests on and no unit test can:
  git relays gpg's status lines **with** the `[GNUPG:] ` prefix, and on
  **stderr**. Second, a **real-gpg** test against an ephemeral `GNUPGHOME` in a
  temp dir (never the user's keyring), skipped with a printed note when gpg is
  absent, covering `Good` end to end plus a tampered payload reading `Bad`.
- **Rust, integration** (`tests/tag_signing.rs`): follows `tests/signing.rs`'s
  `ssh_signing_repo()` pattern — generate an ed25519 key with `ssh-keygen`, skip
  the test with a printed note when `ssh-keygen` is unavailable. Asserts a signed
  tag is a **tag object reachable through `refs/tags/<name>`** whose body carries
  an SSH signature block; that `git tag -v` accepts it (the interop assertion —
  our hand-rolled object has to satisfy git, not just us); that `verify_tag`
  grades it `Good`; that a signing failure (nonexistent program) leaves **no
  ref**; that `sign: Some(true)` with no annotation is `InvalidArgument`; that
  `tag.gpgsign` is the default and a per-tag `Some(false)` overrides it; that
  `TagInfo.signed` is true for a signed tag and false for annotated-unsigned and
  lightweight ones.
- **Frontend, component:** `CreateTagDialog.test.tsx` — a lightweight tag sends
  `annotation: null`; an annotation enables the sign toggle and the three states
  send `null` / `true` / `false`; blanking the annotation disables the toggle and
  forces the payload back to unsigned. `TagSignatureBadge` reuses
  `SignatureBadge.test.tsx`'s shape against `verify_tag`.
- **E2E:** none. No existing spec drives tag creation, and the changed surfaces
  (a modal replacing a prompt, a badge in an inspector) are covered at the
  component layer.

## Out of scope

Bringing the COMMIT badge in line with §E's untrusted-key rule — `verify_commit`
still grades git's `U` as `Good`, so a commit signed by a key outside
`allowedSignersFile` shows a green "Signed". Same gap, one layer down, and
changing `parse_verify_output` touches every commit badge; it gets its own issue
rather than riding along here.

Also out: signing on the *push* path, tag verification in the History graph's ref
labels, a `signTags` preference, X.509 (`SigFormat::X509` stays a clean `NotImplemented`,
as for commits), SSH `key::…` literals (still refused rather than written to
disk), `gpg.ssh.allowedSignersFile` management, and re-signing or amending an
existing tag.
