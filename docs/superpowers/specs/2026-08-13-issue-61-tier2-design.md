# Issue #61 Tier 2 remainder — design

**Issue:** #61 — B6 (skeleton loaders), D5 (credential / auth entry), D6 (GPG/SSH
commit signing), D7 (line-level staging), D8 (word / intra-line diff),
D9 (set-upstream), D10 (content log search).
**Date:** 2026-08-13.
**Status:** approved.

## Problem

Tier 0 and Tier 1 of #61 landed (`fa398c9`, `997e1ab`), as did D3/D4 clone+init
(#75) and A8 virtualization (#80, #82). What remains in Tier 2 is seven items
that fall into three unrelated failure modes:

1. **Core flows silently fail.** Fetch, pull, push and clone run with
   credential prompts hard-disabled, so any remote that needs authentication
   fails with git's stderr and no way to answer it (D5). This is the only item
   on the list where the app does not work, as opposed to looking unfinished.
2. **The diff is coarser than every reference client.** Staging bottoms out at
   the hunk, and a one-word change paints the whole line (D7, D8).
3. **Advertised-but-absent small gaps.** Branch tracking is displayed but not
   editable (D9), the log cannot search content (D10), commits cannot be signed
   (D6), and `.pg-shimmer` is a defined-but-unused keyframe (B6).

Tier 3 (C4 multi-repo tabs, C5 drag-and-drop, D11 PR/MR integration, D12
submodules/LFS/worktrees/bisect) is explicitly **not** in this spec — see
"Out of scope".

## Scope

Delivered as four PRs, in order. Each code PR branches off latest `main` after
the previous one merges.

| PR | Contents | Why grouped |
|----|----------|-------------|
| 0 | This spec + the matching plan | Reviewable independently of code |
| 1 | D9 set-upstream, D10 content log search, B6 skeletons | Three small, independent additions with no shared machinery — cheapest first |
| 2 | D7 line-level staging, D8 word diff | Both live in the diff row / hunk-patch machinery |
| 3 | D5 credentials, D6 signing | Both hinge on how we shell out to real `git` and both are security-sensitive |

### Out of scope, deliberately

- **Tier 3.** C4, C5, D11 and D12 each change an architecture rather than add a
  feature: C4 replaces `useRepoStore`'s single-repo model, D11 needs the
  credential work from D5 plus a whole API integration layer. Each gets its own
  issue and its own spec. Filing them is part of PR 0.
- **True `-S` pickaxe semantics.** See "D10" — we implement `-G`.
- **Signature badges on every log row.** See "D6".
- **Storing secrets ourselves.** See "D5".
- **Per-remote SSH key selection.** `core.sshCommand` / `-i` per remote adds
  per-remote configuration state; D5 covers passphrase entry for whichever key
  git already selects.

---

# PR 1 — D9, D10, B6

## D9 — Set-upstream / branch tracking

`BranchInfo.upstream`, `.ahead` and `.behind` are already computed and displayed
(`Branches.tsx:404,766`), but there is no op to change tracking. Adding one is
the standard path from CLAUDE.md, with no new concepts.

**Backend.** New trait method:

```rust
fn set_upstream(
    &self,
    repo_id: &RepoId,
    branch: &str,
    upstream: Option<&str>,
) -> AppResult<()>;
```

`Libgit2Backend` resolves the local branch and calls `Branch::set_upstream`.
`Some("origin/main")` sets tracking, `None` clears it.

**Validation before mutation.** libgit2 will happily fail deep inside
`set_upstream` with a stringified error for a name that is not a
remote-tracking branch. Resolve the candidate with
`repo.find_branch(name, BranchType::Remote)` first and return
`AppError::InvalidRef(name)` when it is absent, so the UI gets the same
"unknown ref" shape it already handles everywhere else. A missing *local*
branch is also `InvalidRef`.

`CliBackend` gets a `NotImplemented` stub, keeping the trait shape exercised.

**Command.** `set_upstream` in `commands/branches.rs` (thin, `spawn_blocking`),
registered in `invoke_handler!`. TS type + `setUpstream()` wrapper in
`lib/tauri.ts`, action on `useRepoStore` that refreshes branches after.

**UI, two attach points.**

- The Branches inspector's existing `Tracks` row (`Branches.tsx:766`) gains
  "Set upstream…" and, when tracking exists, "Clear tracking".
- The branch context menu gains the same "Set upstream…" entry.

Both route through `pgPrompt` seeded with the current upstream. This uses the
empty-vs-null contract `design/dialog.tsx` already guarantees: **an empty
submitted string clears tracking, a cancelled dialog does nothing.** That
distinction is the reason a prompt is adequate here and a bespoke picker is not
worth the effort for an S-sized item.

**First push establishes tracking.** A branch with no upstream currently pushes
without `-u`, so tracking never gets set from inside the app. Push adds `-u`
when and only when the branch being pushed has no upstream — matching what
every reference client does, and making D9's manual path the exception rather
than the only way to get tracking.

**Tests.** Rust integration tests over `TempRepo`: set tracking to an existing
remote branch and read it back; clear it; set to a non-existent remote branch →
`InvalidRef`; set on a non-existent local branch → `InvalidRef`; push of an
untracked branch leaves an upstream behind.

## D10 — Content log search

`LogFilter` searches message, author, sha, date and path, but not content. #81
rewrote the walk into `log_filtered_page` with a frontier cursor, so there is
now exactly one place a content predicate belongs.

**Semantics: `-G`, not `-S`.** We implement "the pattern appears in a line the
commit added or removed". Git's `-S` reports commits where the *number of
occurrences* of a string changed, which requires counting occurrences across
both full blobs of every candidate commit; `-G` is what "find the commit that
touched this text" means in practice and costs a diff scan we are already
positioned to do. The UI labels the field **"Changed lines contain"** rather
than "pickaxe", so the semantics are not oversold.

**Types.** `LogFilter` gains:

```rust
/// Pattern that must appear in a line this commit added or removed (`-G`).
pub content: Option<String>,
/// Treat `content` as a regular expression rather than a substring.
#[serde(default)]
pub content_regex: bool,
```

Mirrored in `src/lib/types.ts` in the same commit, per the errors/types
convention.

**Evaluation order matters.** The content predicate is the only filter that
costs a diff per commit. It runs **last**, after message/author/sha/date/path
have already rejected the commit, so an author-scoped content search diffs only
that author's commits. The regex is compiled once before the walk begins, never
per commit; a malformed pattern is reported before any walking happens.

**New error variant.** `AppError` has no variant for "the caller passed
something invalid" — the closest, `InvalidRef`, is about references
specifically. A malformed regex here (and an empty line selection in D7) is
exactly that case, so we add `InvalidArgument(String)`, mirrored into
`src/lib/errors.ts` in the same commit. Per the errors convention, adding a
variant beats stringifying into `Git`/`Internal`.

**Diff scan.** For each surviving commit, diff its tree against its first
parent (root commits diff against an empty tree) with the existing pathspec
applied when a path filter is present, and scan added/removed lines only. A
merge commit is compared against its first parent, matching git's default
`-G` behaviour on merges.

New Rust dependency: `regex`.

**Pagination interaction.** The page-size contract from #81 is unchanged: a
content filter makes a page slower to fill, not smaller. No cap on scanned
commits per page — a silent cap would report "no more results" when results
exist, which is worse than a slow page.

**Frontend.** `features/commits/logFilter.ts` already parses `key:value`
qualifiers, so `content:` and `contains:` join `author:`/`path:`/`sha:` there.
The advanced panel gains a "Changed lines contain" field and a `.*` regex
toggle, following the existing field layout (`History.tsx:1037`).

**Tests.** Rust integration: a commit that adds a line containing the needle is
found; an unrelated commit is not; a commit that *removes* the needle is found;
regex mode matches and a bad pattern errors before walking; content combined
with a path filter intersects rather than unions. Frontend unit tests for the
new qualifier parsing.

## B6 — Skeleton loaders

`.pg-shimmer` (`index.css:252`) has been defined and unused since it was
written. The issue framed this as an either/or; we build the primitive.

**New `src/design/skeleton.tsx`**, barrel-exported from `design/index.ts`:
`PGSkeleton` renders one or more shimmering placeholder blocks, taking
width/height/radius and a count. It is presentational only — no loading logic
of its own.

**Applied at three loads:** the History commit list, `CommitDiffPanel` while a
`diff_commits` round-trip is in flight, and the RepoBrowser file preview.

**Two constraints that make it look right rather than nearly right:**

- **Density.** Skeleton rows standing in for list rows must size with
  `calc(<base>px + var(--row-step))`, per CLAUDE.md's rule for any new
  list-row surface. Otherwise the skeleton and the real rows differ in height
  under a non-compact density setting and the list visibly jumps when data
  arrives.
- **Reduced motion.** The shimmer animation is suppressed under
  `prefers-reduced-motion: reduce`, leaving a static block.

**Tests.** Component tests: a screen in its loading state renders the expected
number of placeholders and none once loaded.

---

# PR 2 — D7, D8

## D7 — Line-level (partial-hunk) staging

Today's finest granularity is the hunk. `stage_hunk` applies a single hunk via
libgit2's `ApplyOptions::hunk_callback`; `unstage_hunk` and `discard_hunk`
build patch text with `patch_text_for_hunk` and pipe it to `git apply` through
the existing `git_apply` helper. Line-level staging is the same machinery with
a more selective patch.

**Patch synthesis.** `patch_text_for_hunk` generalizes to:

```rust
fn patch_text_for_lines(
    diff: &git2::Diff<'_>,
    delta_index: usize,
    hunk_index: usize,
    selected: &[usize],       // indices of changed lines within the hunk
    direction: PatchDirection, // Apply | Reverse
) -> AppResult<String>;
```

The rule is the one `git add -p` uses when you edit a hunk by hand. For
`Apply`:

| Line in source hunk | In synthesized patch |
|---|---|
| context (` `) | context |
| selected `-` | `-` |
| selected `+` | `+` |
| **unselected `-`** | **context** — we are not removing it, so it exists on both sides |
| **unselected `+`** | **dropped** — it exists on neither side of this partial patch |

For `Reverse` the two unselected rules swap: an unselected `+` becomes context
and an unselected `-` is dropped, because reversal flips which side each line
lands on. This is why `direction` is a parameter rather than something the
caller handles by post-processing.

The `@@` header counts are **recomputed from the synthesized body** — old count
is context + `-`, new count is context + `+` — never copied from the source
hunk. Copying them is the classic way to produce a patch `git apply` rejects.

**Ops.** Three new trait methods and commands mirroring the hunk trio, each
taking the selected line indices:

- `stage_lines` — from the index↔worktree diff, `git_apply --cached`
- `unstage_lines` — from the HEAD↔index diff, `git_apply --cached --reverse`
- `discard_lines` — from the index↔worktree diff, `git_apply --reverse`

An empty selection is `AppError::InvalidArgument` (the variant added in D10),
not a silent no-op — a no-op would read as "staging is broken". An index out of
range for the hunk is the same. A selection covering every changed line is
allowed and is equivalent to the hunk op.

**The ignore-whitespace constraint carries over.** `git/mod.rs:94-97` already
warns that hunk indices from an ignore-whitespace diff must never be fed to the
hunk ops, because that flag rewrites hunk boundaries. Line indices within a
hunk are affected identically, so the line ops inherit the same rule: they take
no `ignore_whitespace` and the UI disables them via the existing
`useHunkActionsDisabledReason` while the toggle is on.

**Frontend.** Selection state lives in the **owning diff surface**
(CommitPanel / DiffViewer / RepoBrowser), not in `PGDiffLine`. This is the same
rule that keeps tree keyboard handling in the screen rather than in
`PGFileTree`: a primitive that owns its own selection plus a global dispatcher
both answer the same input and the selection moves twice.

Interaction:

- Click a changed line toggles it; shift-click extends a range within the hunk.
- `Space` toggles the focused line.
- While a hunk has a non-empty selection, its stage/unstage button reads
  "Stage N lines" and acts on the selection; with an empty selection it behaves
  exactly as today.
- `Escape` clears the selection.

Selection is per-hunk and clears when the file or diff changes — a selection
surviving a refresh would point at line indices that no longer mean the same
thing.

**Tests.** Rust integration over `TempRepo`, asserting index/worktree contents
rather than patch text: stage one of three added lines and confirm the index
has exactly that line while the other two stay unstaged; stage a selection that
skips a removed line and confirm the file still contains it; discard selected
lines only; unstage a subset. Plus a direct test that a synthesized patch's
`@@` counts match its body. Frontend component tests for selection, the
"Stage N lines" label, and the whitespace-toggle disable.

## D8 — Word / intra-line diff

**Pure function, no dependency.** New `src/lib/wordDiff.ts` computing a
token-level diff between two strings and returning changed character ranges for
each side. Tokenization splits into word runs, punctuation and whitespace runs;
the diff is a token LCS. Hand-rolled to match how `graphLayout`, `buildRebasePlan`
and `semver.ts` are done in this repo — each is a tested pure function with no
dependency — and because a general text-diff library brings machinery we would
use one mode of.

**Rendering has nothing to collide with.** `PGDiffLine` (`git-components.tsx:498`)
renders `text` as plain text; there is no syntax highlighting in the diff path
(`lib/highlight.ts` is used by the file preview, not here). So intra-line spans
can be emitted directly without reconciling two span trees.

**Pairing rule.** `chunkDiffLines` groups runs **by kind**, so a removed run and
the added run following it are two *adjacent* chunks, not one — pairing therefore
happens across an adjacent `(rem, add)` chunk pair, and `PGDiffChunk` (which
renders `add`/`rem` rows inline rather than delegating to `PGDiffLine`) needs
both sides in hand. Within such a pair, the i-th removed line pairs with the
i-th added line, for the first `min(removed, added)` lines only. A pair gets
intra-line highlighting **only if its similarity clears a threshold**: at least
30% of the shorter side's non-whitespace tokens are common. Below that the pair
renders as plain whole-line add/remove. Without the gate, a run of unrelated
rewritten lines gets highlighted at random, which reads as noise and is worse
than no word diff.

**Cost guards.** Skip word diffing and fall back to plain line colouring when
either line exceeds 1000 characters or either side tokenizes to more than 200
tokens — the LCS table is `O(n·m)`, so those bounds cap it at 40k cells per
pair. A minified bundle must not be able to hang the renderer. Both numbers are
starting values chosen to sit well above ordinary source lines; they live as
named constants in `wordDiff.ts`, not scattered literals. Results memoize per
line pair and are computed lazily for rendered chunks only, since these lists
are long and windowed.

**Colour.** Changed spans get a stronger tint derived from the existing tokens
via relative colour — `oklch(from var(--git-added) …)` / `--git-removed` — so
custom and light themes carry through, per the styling convention.

**Tests.** `wordDiff.test.ts`: identical strings produce no spans; a single
changed word produces one span on each side; insertion at start and at end;
whitespace-only difference; a line pair below the similarity threshold produces
nothing; the long-line guard returns the fallback; multi-byte characters map to
correct ranges.

---

# PR 3 — D5, D6

## D5 — Credential / auth entry

Four ops shell out to real `git` with prompts hard-disabled:
fetch / pull / push (`commands/branches.rs:132-134`) and clone
(`commands/create.rs:235-237`). The disabling is deliberate and correct as far
as it goes — a subprocess with no terminal would otherwise hang on an invisible
prompt — but it means authentication cannot happen at all.

### Approach: retry on failure, not prompt during the run

Ops keep running prompt-less on the first attempt. When one fails, its stderr
is classified; if the failure is an authentication failure, the frontend
collects credentials and the op is **retried** with an askpass that already
knows the answer. Nothing prompts mid-run, so there is no IPC between a git
subprocess and the app window, no partially-blocked op, and the common case
(credential helper or ssh-agent already works) is byte-for-byte what happens
today.

### Error classification

`run_git`'s failure path currently maps every non-zero exit to
`AppError::Network(stderr)`. It gains a classifier producing a new variant:

```rust
Auth { host: Option<String>, kind: AuthKind }  // AuthKind: Https | SshPassphrase | SshKey
```

Distinguished from `Network` by matching git/ssh's stable phrasings:
`Authentication failed`, `could not read Username`,
`terminal prompts disabled`, `Invalid username or password`,
`Permission denied (publickey)`, `Enter passphrase for key`.

**`Host key verification failed` is explicitly not an auth failure** — it stays
`Network`, because prompting for a password cannot fix an unknown host key and
offering to would be actively misleading. `AppError` gains the variant on the
Rust side and `src/lib/errors.ts` in the same commit, per convention.

### The askpass shim is our own binary

`GIT_ASKPASS` / `SSH_ASKPASS` point at the platypusgit executable itself,
re-invoked through a new `--askpass <prompt>` intent in `cli.rs`. The shim:

1. Reads its answer from an environment variable set by the parent process.
2. Chooses which variable by matching the prompt text git passed as argv
   (`Username for …` vs `Password for …` vs `Enter passphrase for key …`).
3. Prints exactly that value and exits 0. On a prompt it does not recognize, or
   with the environment variable absent, it prints nothing and exits non-zero.

This must be handled **before** the Tauri app is built in `lib.rs` — no window,
no single-instance forwarding — so the shim is a fast process that never tries
to become a second app instance. `SSH_ASKPASS_REQUIRE=force` makes modern
OpenSSH use it without a `DISPLAY`.

**Secrets travel in the environment, never in argv.** Argv is world-readable
via `ps` on macOS and Linux; another user cannot read a process's environment
on either. This mirrors the care `opener.rs` already takes about never handing
data to a shell.

### Storage: git's own helper chain

We store nothing. On a successful retry where the user asked to remember, the
credential is handed to `git credential approve`, so whichever helper the user
already has configured (osxkeychain, manager-core, libsecret) owns it. Before
prompting, `git credential fill` is consulted so a known credential pre-fills
the dialog — and so a helper that already has the answer means no prompt at
all. When no helper is configured, the credential is kept in memory for the
remainder of the app session only, and the dialog says so.

This adds no secret-storage dependency, keeps us out of the business of secret
lifecycle, and interoperates with credentials the user already has.

### One shared runner

The duplicated env policy in `branches.rs` and `create.rs` collapses into a
single `run_git_authenticated(cwd, args, creds: Option<&Credentials>)` in a new
shared module, used by all four call sites. Clone's streaming-progress path
keeps its own output handling; only the environment and failure classification
are shared.

### Frontend

New `src/features/auth/`:

- `useAuthStore` — the pending challenge (host, kind, prefilled username) and
  the retry thunk supplied by whichever caller failed.
- `CredentialDialog` — a `PGModal` with username, secret (masked, toggleable),
  and a "remember" checkbox whose label reflects whether a helper exists.

Callers stay generic: a network action that catches `AppError::Auth` raises the
challenge with a closure that re-runs itself with credentials. Cancelling
surfaces the original error through the normal banner path — and per the
danger-op convention, `refreshAll()` runs before `set({ error })`.

### Security constraints

- The shim emits nothing but the requested value, and never logs.
- Credentials never enter `AppError` messages, log output, or event payloads.
- git stderr is **scrubbed** before it is surfaced or logged: git echoes remote
  URLs, which can carry embedded credentials (`https://user:token@host/…`).
- The retry sends the secret to exactly one subprocess for one op; it is not
  cached in the store beyond the session, and never persisted by us.

### Tests

`AppError` classification is a pure function over stderr fixtures — one test
per phrasing, including the host-key case asserting it stays `Network`, and the
URL-scrubbing case. The shim's prompt-kind matching and its
missing-variable refusal are pure functions too. Frontend component tests cover
the dialog, the retry path, and cancellation restoring the error banner.
E2E cannot exercise a real authenticated remote; a `file://` remote covers the
happy path, and the auth path is deliberately not e2e-tested.

## D6 — GPG / SSH commit signing

### Signing

`CommitOptions` gains `sign: Option<bool>` — `None` follows `commit.gpgsign`
from config, `Some` overrides it for this commit.

`commit()` currently calls `repo.commit(...)`, which cannot sign. Signing
requires the three-step form:

1. `repo.commit_create_buffer(...)` to get the commit content.
2. Sign that buffer with the configured program.
3. `repo.commit_signed(&buffer, &signature, Some("gpgsig"))`.

**`commit_signed` does not move HEAD.** Unlike `repo.commit(Some("HEAD"), …)`,
it only writes the object, so the signed path must update the HEAD reference
and write the reflog entry itself, and amend must retarget rather than rely on
`Commit::amend`. Getting this wrong produces a commit that exists but is not on
any branch — silently losing the user's work from their point of view. The
unsigned path stays exactly as it is today.

**Program dispatch** by `gpg.format`:

| `gpg.format` | Program | Signature |
|---|---|---|
| `openpgp` (default) | `gpg.program`, else `gpg` | detached armored signature over the buffer |
| `ssh` | `gpg.ssh.program`, else `ssh-keygen` | `-Y sign -n git` with `user.signingkey` |
| `x509` | — | clean unsupported error, not a panic or a silent unsigned commit |

`user.signingkey` may be a key id, a path, or a literal key with a `key::`
prefix in ssh mode; resolution handles all three. A signing failure fails the
commit — it must never fall back to committing unsigned, because the user asked
for a signed commit and would have no indication they did not get one.

### Verification: lazy, on the selected commit

New `verify_commit(repo_id, oid)` returning
`SignatureStatus { state, signer, key }`, where state covers
good / bad / unknown-key / expired / revoked / none. Implemented by asking git
for `%G?`, `%GS` and `%GK` on that one commit, which reuses git's own trust
evaluation rather than reimplementing it.

It is called **only for the currently selected commit**, and its result is
shown in `CommitDiffPanel`'s header. Badging every log row would mean a
`gpg`/`ssh-keygen` process per walked commit, which fights #81's pagination and
the windowed list from #80 directly.

### UI

- Settings: a "Sign commits" toggle, default "follow git config".
- Commit composer: a per-commit override alongside the existing amend and
  sign-off controls, which is where `CommitOptions.signoff` already lives.
- `CommitDiffPanel` header: signature state for the selected commit.

### Tests

Config resolution (`gpg.format` → program + argument list, `signingkey`
forms) and `%G?` parsing are pure functions, tested exhaustively against
fixtures. The end-to-end signed-commit test generates an ssh key with
`ssh-keygen` and signs with it — present on macOS and in the e2e image — and
skips when `ssh-keygen` is unavailable rather than failing. Asserted: the
commit is on HEAD with the right parent (the `commit_signed` trap), the object
has a `gpgsig` header, and `verify_commit` reports it good.

---

## Testing summary

| Layer | Covers |
|---|---|
| Rust integration (`TempRepo`) | `set_upstream` incl. `InvalidRef` paths, push `-u`, content filter incl. removals + regex + path intersection, the three line-staging ops asserted on index/worktree contents, signed commit reachable from HEAD with a `gpgsig` header |
| Rust unit | patch `@@` counts vs body, auth stderr classification incl. host-key and URL scrubbing, askpass prompt matching, signing config resolution, `%G?` parsing |
| Frontend unit | `wordDiff` cases, `content:` qualifier parsing |
| Component | skeleton loading states, line selection + "Stage N lines" + whitespace disable, credential dialog and retry/cancel |
| E2E (Docker only) | only specs covering changed surfaces; the auth path is not e2e-tested |

Per CLAUDE.md, e2e runs only once a change is done, only the affected specs,
and only via `pnpm test:e2e:docker`.

## Risks

- **`commit_signed` and HEAD.** The highest-consequence trap in this spec: a
  signed commit that never becomes HEAD looks like lost work. Covered by an
  explicit integration assertion, not just a "it committed" check.
- **Patch synthesis correctness (D7).** A malformed partial patch either fails
  loudly (`git apply` rejects) or, worse, stages the wrong lines. Tests assert
  resulting index and worktree contents rather than patch text.
- **Content search cost (D10).** Mitigated by ordering the predicate last and
  compiling the regex once; a deliberately un-capped scan keeps results honest
  at the cost of slower pages on large histories.
- **Secret leakage (D5).** Env-not-argv, stderr scrubbing, and no persistence
  of our own. Worth a `/security-review` pass on PR 3 before merge.
