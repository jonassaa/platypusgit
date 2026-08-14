# Forge integration — PR / MR (GitHub + GitLab) — design

**Issue:** #92, spun out of #61 D11 (Tier 3).
**Date:** 2026-08-14.
**Status:** approved.
**Depends on:** #61 D5 (credentials) — landed. Reuses `AppError::Auth`,
`git/auth.rs` scrubbing, and `commands/net.rs`'s authenticated git runner for
the one git operation this feature performs.

## Problem

platypusgit has no forge integration at all: no API client, no PR/MR list, no
way to create one, no CI status. Every review round trip leaves the app —
which is the single most-cited reason people keep GitKraken or the web UI open
next to a desktop git client. #61 lists it as a core competitor selling point
with a `✗` against us.

## Scope

In scope:

- **Detect** the forge from the repository's existing remotes (SSH + HTTPS,
  `github.com` / `gitlab.com` / self-hosted GitHub Enterprise + GitLab).
- **Authenticate** with a per-host API token, entered and validated in Settings,
  with a "signed in as X" state and a way to remove it.
- **List** open pull requests / merge requests: number, title, author,
  source → target branch, draft flag, cross-repo (fork) flag.
- **CI / checks status** for the selected PR, one API call, on demand.
- **Open** a PR/MR in the browser.
- **Check out** a PR/MR's source branch locally, fork PRs included.
- **Create** a PR/MR from the current branch (title, body, target, draft), then
  surface the created URL.
- A `pulls` screen, an activity-bar entry, keymap actions in both presets, and
  palette commands.

Out of scope, deliberately:

- **Merging a PR from the app.** A merge is the one irreversible forge action,
  it has per-repo policy (required checks, required reviews, squash vs merge vs
  rebase, protected branches), and mis-modelling that policy is worse than not
  offering the button. The forge's own merge UI is one click away via "Open in
  browser".
- **Reviews, review comments, threads.** A separate feature with its own
  surface (a diff view keyed to review threads), not a line item on a list
  screen. See Gaps.
- **Issues.** Named in #61's "no API, no PR/MR, no issues" but a different
  object model with no branch relationship; nothing else in the app has a place
  to put one.
- **OAuth device flow.** #61 D11 says "OAuth/token auth"; this ships token auth
  only. A device flow needs a client-id registered per forge instance (so it
  cannot work for a self-hosted host without the user registering an app
  anyway), a polling loop, and refresh-token storage. A PAT gets the same
  capability with one paste and no per-instance registration. See Gaps.
- **Bitbucket, Gitea, Forgejo, Azure DevOps.** The `Forge` trait exists so a
  third is additive; adding one is not this pass.
- **Webhook / push-triggered live refresh.** The list refreshes on demand and on
  screen entry. No polling loop — an authenticated poll against a rate-limited
  API running forever in the background is a cost the user did not ask for.

## The central constraint: a forge token is not a git credential

#92 states it directly, and it is the design's load-bearing decision.

| | git-transport credential (D5) | forge API token (this) |
|---|---|---|
| Answers | git's askpass prompt for one `fetch`/`push` | an HTTP `Authorization` header |
| Scoped to | a remote URL | a host's API |
| Lifetime | one operation, optionally remembered | stored until removed |
| Owner | `commands/net.rs` `Credentials` | `forge/token.rs` `Secret` |

`Credentials` (`commands/net.rs`) is **not** extended, reused, or referenced by
the forge code. The two never share a struct, a storage key, or a code path.

### Where the token lives

Delegated to the user's own git credential helper — the same delegation D5
chose for transport credentials, so the app still stores no secret itself and
inherits whatever the platform already secures (osxkeychain, wincred,
libsecret, manager). But under a **key that cannot collide with a transport
credential**:

```
protocol = https
host     = <forge-host>.platypusgit-forge.invalid
username = platypusgit-forge
```

`.invalid` is reserved by RFC 6761 §6.4 and is guaranteed never to resolve, so
no git remote can ever ask for that host. That matters concretely: GitLab's API
and its git transport share one host (`gitlab.com/api/v4`), and so does GitHub
Enterprise (`ghe.example.com/api/v3`). Keyed on the bare host, storing an API
token would **overwrite the credential the user pushes with** — the exact
overloading #92 forbids, arrived at through the back door. The reserved
username is a second layer (git's `credential_match` compares username when
the request sets one) and makes the entry self-describing in Keychain.

A custom `protocol=` was considered and rejected: `git-credential-osxkeychain`
silently `exit(0)`s on any protocol it does not recognise, so the token would
vanish with no error.

`git credential` runs with the OS temp dir as its cwd, so config resolution is
global + system only — whichever repository happens to be open cannot redirect
where a token is stored or read from via a repo-local `credential.helper`.

### The helper-less case is reported, not swallowed

D5 could treat storage as best-effort ("the credential still worked for the
operation they asked for"). A forge token cannot: if it silently vanishes, the
user typed a secret into a box for nothing. So `store_token` **round-trips**:
`approve`, then `fill`, and if the token does not come back it raises
`AppError::ForgeTokenStore` naming the remedy (`git config --global
credential.helper …`). The token is still held in memory for the session, so the
feature works until restart while the user fixes their helper.

### Secret hygiene

The D5 security review found three bugs of this shape (userinfo split on the
first `@`, unescaped values injected into git's line-based credential protocol,
an oid passed where a leading `-` reads as an option). Each has a
counter-measure here, and each has a test:

1. **`Secret` newtype** (`forge/token.rs`) wraps the token. It has a hand-written
   `Debug` that prints `Secret(***)`, no `Display`, and no `Serialize`. A token
   therefore **cannot** be formatted into an error, a log line, an event
   payload, or an IPC response by accident — it takes an explicit
   `.expose()` call, which exists at exactly two call sites (the auth header,
   and the credential-protocol writer).
2. **`redact(text, secret)`** scrubs any literal occurrence of the token out of
   any string that becomes an error, and every forge API error body goes
   through it *and* through D5's `scrub_credentials` before it becomes an
   `AppError`. Belt and braces: (1) should make (2) unreachable.
3. **Newline guard** on every value written to git's credential protocol
   (`host`, `username`, `password`) — refuse rather than escape, exactly as
   `credential_approve` does, so a token containing `\nhost=evil.example`
   cannot re-target the entry.
4. **No token ever crosses IPC.** `forge_token_status` returns
   `{ host, signedIn, login }`. There is no command that reads a token out.
5. **Argument-injection guards** on everything that reaches a URL or a git
   subcommand: `validate_host` (hostname charset + optional numeric port only),
   `encode_segment` (percent-encode owner/repo so `..` or `?` cannot rewrite an
   API path), `validate_sha` (hex, 7–64), `validate_ref_name` (no leading `-`,
   no control chars, no `..`), and `--` before every user-influenced git
   argument.

## Architecture

### Backend: `src-tauri/src/forge/`

```
forge/
├── mod.rs      ForgeKind, ForgeRepo, ForgeDetection, PullRequest, ChecksSummary,
│               ChecksState, NewPullRequest, ForgeIdentity + the `Forge` trait
│               and `forge_for(kind) -> &'static dyn Forge`
├── remote.rs   parse_remote_url + detect — remote URL → host/owner/name. PURE.
├── token.rs    Secret, redact, credential_host, store/load/erase_token
├── http.rs     ureq agent (timeout + https_only), size cap, GET/POST JSON,
│               status → AppError mapping. The ONLY impure file.
├── github.rs   GitHub REST v3: URL builders + response parsers. PURE.
├── gitlab.rs   GitLab REST v4: URL builders + response parsers. PURE.
└── checkout.rs The git half of a PR checkout: `fetch_args`, `checkout_args`,
                `branch_exists`. Split out of the command so it can be driven
                against a real repository in a test.
```

The trait is deliberately **not** `fn list_pull_requests(&self) -> Result<Vec<PullRequest>>`.
Splitting each operation into a URL builder and a response parser makes both
halves pure, so the whole forge-specific surface is unit-testable against
recorded JSON with no network and no injected HTTP client:

```rust
pub trait Forge: Send + Sync {
    fn kind(&self) -> ForgeKind;
    fn auth_header(&self) -> &'static str;          // "Authorization" | "PRIVATE-TOKEN"
    fn auth_value(&self, token: &Secret) -> String; // "Bearer …" | the token
    fn identity_url(&self, host: &str) -> AppResult<String>;
    fn parse_identity(&self, json: &str) -> AppResult<ForgeIdentity>;
    fn list_url(&self, repo: &ForgeRepo) -> AppResult<String>;
    fn parse_list(&self, json: &str) -> AppResult<Vec<PullRequest>>;
    fn checks_url(&self, repo: &ForgeRepo, sha: &str) -> AppResult<String>;
    fn parse_checks(&self, json: &str) -> AppResult<ChecksSummary>;
    fn create_url(&self, repo: &ForgeRepo) -> AppResult<String>;
    fn create_body(&self, req: &NewPullRequest) -> serde_json::Value;
    fn parse_created(&self, json: &str) -> AppResult<PullRequest>;
    fn head_ref(&self, number: u64) -> String;      // the fetchable ref
}
```

`http.rs` is the seam: it takes a URL, a header pair, and an optional JSON body,
and returns a `String`. It never sees a `ForgeRepo` and never builds a URL.

### Remote → forge detection (`forge/remote.rs`)

`parse_remote_url` accepts, and is tested against:

| Form | Example | Host taken as |
|---|---|---|
| scp-like SSH | `git@github.com:owner/repo.git` | `github.com` |
| `ssh://` | `ssh://git@host:2222/owner/repo.git` | `host` (**port dropped**) |
| HTTPS | `https://gitlab.com/group/sub/repo.git` | `gitlab.com`, owner `group/sub` |
| HTTPS + userinfo | `https://u:p@host/o/r` | `host` (userinfo discarded, never retained) |
| HTTPS + port | `https://git.example.com:8443/o/r.git` | `git.example.com:8443` (**port kept**) |
| `git://` | `git://host/o/r.git` | `host` |

The SSH-vs-HTTPS port asymmetry is the subtle one: an SSH port has nothing to do
with where the API listens, so keeping `:2222` would build
`https://host:2222/api/v4`. An HTTPS port *is* where the API listens, so
dropping it would build the wrong base for a self-hosted instance on a
non-standard port.

Anything else — a local path, `file://`, an empty string, a URL with no
owner/name pair — yields `None`. **A repo with no recognisable forge is not an
error**: `forge_detect` resolves to `null` and the screen renders a disabled
empty state.

Remote preference: `origin`, then `upstream`, then the first parseable remote.

Forge **kind** resolves from a builtin map (`github.com` → GitHub, `gitlab.com`
→ GitLab) and otherwise from a user-supplied per-host mapping. A self-hosted
host is indistinguishable from its URL, so detection returns
`ForgeDetection { host, owner, name, remote, kind: Option<ForgeKind> }` — a
detected host with `kind: null` is a *prompt* ("which forge is
git.example.com?", answered in Settings), never a failure.

### Commands: `src-tauri/src/commands/forge.rs`

| Command | Does |
|---|---|
| `forge_detect(repoId, hostKinds)` | lists remotes via `GitBackend`, parses, returns `ForgeDetection \| null` |
| `forge_sign_in(host, kind, token)` | validates the token against the API, **then** stores it; returns `ForgeIdentity` |
| `forge_token_status(host)` | presence only, **no network** |
| `forge_sign_out(host)` | `git credential reject` + drops the memory cache |
| `forge_list_pull_requests(forge)` | open PRs/MRs |
| `forge_pull_request_checks(forge, sha)` | one call, on demand |
| `forge_create_pull_request(forge, request)` | creates, returns the `PullRequest` incl. its URL |
| `forge_checkout_pull_request(repoId, remote, kind, number, localBranch, force, credentials?)` | the git half |

Every API command wraps its blocking `ureq` work in `spawn_blocking`, like every
libgit2 call. Tokens are cached in a `ForgeTokens(Mutex<HashMap<String, Secret>>)`
managed state so a list refresh does not shell out to `git credential` per call.

`forge_token_status` deliberately does not probe the network: Settings would
otherwise fire an authenticated request on every render. The login shown in
"signed in as X" comes from `forge_sign_in`'s response, persisted per host by
the frontend; a "Re-check" button re-probes on demand.

### Checking out a PR — the part most likely to be wrong

A fork PR's source branch does not exist on any remote we have. It is reachable
only through the ref the forge synthesises **on the base repository**:

- GitHub: `refs/pull/<number>/head`
- GitLab: `refs/merge-requests/<iid>/head`

So checkout never needs the fork's URL, and works identically for same-repo and
cross-repo PRs. Two steps, deliberately:

1. `git -C <workdir> fetch --no-tags -- <remote> <headRef>` → `FETCH_HEAD`.
   No ref is written, so this cannot clobber anything.
2. `git checkout -b <local> FETCH_HEAD`, or `-B` when the caller passed
   `force: true`.

Fetching straight into `refs/heads/<local>` with a `+` refspec was rejected: git
refuses to fetch into the currently checked-out branch, and force-updating a
local branch behind the user's back is exactly the kind of silent data loss the
rest of the app is careful about. So the branch guard is explicit — a branch
that already exists raises `AppError::BranchExists` unless the caller opted in,
and the frontend gets that opt-in from a `pgConfirm`.

`local` defaults to the PR's source branch name for a same-repo PR and to
`pr-<n>` / `mr-<n>` for a cross-repo one — a fork's `main` must not land on your
`main`.

Step 1 goes through `commands::net::run_git_authenticated` with `credentials:
None` on the first attempt, so an auth failure surfaces as `AppError::Auth` and
the **existing** `CredentialDialog` retry path (#61 D5) drives it. The forge
token is not a transport credential and is never offered here.

### Errors

Four new `AppError` variants (Rust enum and `src/lib/errors.ts` union, same
commit):

| Variant | Raised when |
|---|---|
| `Forge(String)` | the API answered with a failure we can describe (scrubbed + redacted) |
| `ForgeAuth(String)` | 401/403 for `host` — the UI routes to Settings, not to the git credential dialog |
| `ForgeTokenStore(String)` | the token did not survive the `approve` → `fill` round trip |
| `BranchExists(String)` | PR checkout would overwrite an existing local branch |

`ForgeAuth` is separate from `Auth` on purpose: `Auth` means "git needs a
credential for this remote, let me prompt and retry", and reusing it would pop
the transport-credential dialog for a problem only Settings can fix.

### Frontend: `src/features/forge/` + `src/screens/Pulls.tsx`

```
features/forge/
├── useForgeStore.ts     detection, list, selection, checks, create, sign-in/out;
│                        hostKinds + logins persisted in localStorage
├── forgeLabels.ts       PURE: prNoun/prAbbrev per kind, localBranchFor(pr),
│                        checksTone(state), forgeLabel(kind)
├── PullRequestRow.tsx   one list row — opts into `var(--row-step)`
├── CreatePullRequestDialog.tsx   PGModal form (title, body, target, draft)
└── ForgeSettings.tsx    the Settings section (token entry, signed-in-as, remove)
```

`ForgeSettings` renders inside `screens/Settings.tsx` but its state lives in
`useForgeStore`, not `useSettingsStore`: `useSettingsStore` is the preferences
store (appearance, diff, pull mode) and an account list is not a preference.
Per-feature Zustand is the stated convention; this follows it.

The `pulls` screen: a header (detected repo, Refresh, New pull request), a list
pane (`PGPane primary`, so screen entry focuses it) and a detail pane below it.
Both panes own their scrolling via `FocusableScroll` — the shell is a fixed
frame. Rows carry `height: calc(48px + var(--row-step))` so the density toggle
reaches them.

Empty states, each distinct and each actionable:

| State | Shows |
|---|---|
| no repo | "Open a repository" |
| no parseable remote | "No GitHub or GitLab remote found" |
| host detected, kind unknown | "Which forge is `git.example.com`?" + a link to Settings |
| not signed in | "Add a token for `github.com`" + a link to Settings |
| signed in, nothing open | "No open pull requests" |

### Keyboard + palette

Two keymap actions, bound in **both** presets (`presets.test.ts` requires every
catalogued action to be bound in every preset):

| Action | Chord | Why that chord |
|---|---|---|
| `nav.pulls` | `Mod+Shift+8` | the shifted-digit family is already where screens without a primary number live (`nav.reflog` = `Mod+Shift+9` in rider). Free in both presets, and the classic preset's asserted `Mod+8` = Diff stays untouched. |
| `forge.createPr` | `Mod+Shift+Y` | repo *ops* live on `Mod+Shift+<letter>` (`S`/`U`/`M`/`K`/`T`). `Y` carries no entrenched meaning on any platform, and it is Shift — not `Mod+Alt+<letter>`, which the AltGr rule forbids. |

Palette: "Go to Pull requests" (a `SCREENS` entry, so its chip tracks the
keymap), "Create pull request…", "Refresh pull requests", and an
"Open pull request in browser…" pick step over the loaded list.

## Testing

**Rust** — three test files, no network:

- `forge_remote.rs` — every URL form in the table above, the SSH/HTTPS port
  asymmetry, subgroups, userinfo discard, garbage → `None`, remote preference,
  builtin + override kind resolution.
- `forge_api.rs` — URL builders for github.com / GHE / gitlab.com / self-hosted;
  `validate_host` / `encode_segment` / `validate_sha` / `validate_ref_name`
  rejecting injection; parsers against recorded fixtures in
  `src-tauri/tests/fixtures/`; GitLab's `Draft:` title prefix vs GitHub's
  `draft` flag; `head_ref` per kind.
- `forge_token.rs` — `Secret`'s `Debug` redacts; `redact` removes a token from
  a body echo; the newline guard refuses; `credential_host` namespacing.
- `forge_checkout.rs` — the fork case, on disk. A bare `origin` carries
  `refs/pull/1/head` at a commit on **no branch**, and the work repo is cloned
  over `file://` so a local-path clone cannot hardlink the object in for free.
  Asserts the tip is genuinely absent first, then that the fetch lands it in
  `FETCH_HEAD` and writes no ref, that `-b` produces the branch with the fork's
  file in the worktree, that `-b` REFUSES an existing branch while `-B` resets
  it, and that GitLab's `refs/merge-requests/1/head` works the same way.

**Frontend** — `useForgeStore.test.ts` (detect / refresh / error / sign-in /
sign-out / checkout branch choice), `forgeLabels.test.ts` (pure), and component
tests for the list (`Pulls.test.tsx`), the create form
(`CreatePullRequestDialog.test.tsx`) and the Settings control
(`ForgeSettings.test.tsx`), all with `mockInvoke`, and `WithDialogs` where a
`pgConfirm` gates the flow.

**E2E** — one spec (`pulls.e2e.ts`) covering what is reachable with no forge and
no network: the activity-bar entry navigates to the screen, and a repository
whose remote is not a forge renders the "no forge" empty state rather than an
error banner. Everything past detection needs a live API.

## Gaps (stated, not hidden)

- **The authenticated paths cannot be e2e'd** — same limitation #61 recorded for
  the git-auth path. Listing, creating, checking out a PR and validating a token
  all require a real forge; a fake one would test the fake. They are covered by
  Rust parser tests against recorded payloads and by frontend component tests
  against `mockInvoke`.
- **No OAuth device flow** — token only (see Scope).
- **Merging, reviews, review comments and issues are not implemented** (see
  Scope).
- **CI status is per-selected-PR, not per-row.** GitHub's PR list carries no
  status, so a column would cost one request per row on every refresh.
- **No background refresh.** On demand and on screen entry only.
- **Storing a token needs a configured git credential helper.** Without one the
  token works for the session and `ForgeTokenStore` says so; it does not
  survive a restart. An OS-keyring dependency would remove the caveat and is the
  natural follow-up.
- **Only the base repo's synthesised head ref is fetched.** A PR whose fork was
  deleted after opening has no `refs/pull/N/head` on some forges; checkout then
  fails with git's own message.
