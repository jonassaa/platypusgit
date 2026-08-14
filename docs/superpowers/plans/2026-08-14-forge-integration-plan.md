# Forge integration (PR / MR) — implementation plan

**Spec:** `docs/superpowers/specs/2026-08-14-forge-integration-design.md`
**Issue:** #92 (#61 D11)
**Date:** 2026-08-14

One PR. Phases are commit-shaped during development and squashed into a single
Conventional Commit before merge, per the repo's branch workflow.

---

## Global constraints

Carried into every phase; a change that breaks one of these is wrong even if it
compiles.

1. **`commands/net.rs::Credentials` is not touched.** No forge type derives from
   it, no forge code imports it except `run_git_authenticated` (which takes
   `Option<&Credentials>` and is passed `None`).
2. **A token is a `Secret`.** No `String` token crosses a function boundary
   except at the two `expose()` sites. `Secret` has no `Display`, no
   `Serialize`, and a `Debug` that prints `Secret(***)`.
3. **No token in an error, a log, an event, or an IPC response.** Every error
   built from an HTTP body runs through `redact(text, secret)` and D5's
   `scrub_credentials`.
4. **All outbound HTTP is `https_only` + timed out + size-capped**, via the one
   agent builder in `forge/http.rs`, matching `update.rs`.
5. **Opening a URL goes through `opener::safe_url`** — i.e. through the existing
   `open_url` command. No second path.
6. **Nothing user-influenced reaches a URL or a git argv unvalidated.**
   `validate_host`, `encode_segment`, `validate_sha`, `validate_ref_name`, and a
   `--` separator before positional git arguments.
7. **A repo with no recognised forge is a state, not an error.**
8. **Every new `AppError` variant lands in `src/lib/errors.ts` in the same
   commit.**
9. **Every new keymap action is bound in BOTH presets** (`presets.test.ts`
   asserts it) and adds no `Mod+Alt+<letter>` chord.
10. **Every new row surface uses `var(--row-step)`; every new pane owns its
    scrolling.**

---

## Phase 1 — errors + forge types + remote parsing (pure, tested first)

**Files**

- `src-tauri/src/error.rs` — add `Forge`, `ForgeAuth`, `ForgeTokenStore`,
  `BranchExists`.
- `src/lib/errors.ts` — mirror the four, plus `isForgeAuthError` and
  `forgeAuthHost` helpers next to the existing `isAuthError` family.
- `src-tauri/src/forge/mod.rs` — `ForgeKind` (`GitHub` | `GitLab`),
  `ForgeRepo { host, owner, name, kind }`,
  `ForgeDetection { remote, host, owner, name, kind: Option<ForgeKind> }`,
  `PullRequest`, `ChecksState`, `ChecksSummary`, `NewPullRequest`,
  `ForgeIdentity`, the `Forge` trait, `forge_for(kind)`.
- `src-tauri/src/forge/remote.rs` — `parse_remote_url`, `detect`,
  `builtin_kind`.
- `src-tauri/src/lib.rs` — `pub mod forge;`.

**Serde shapes.** All forge structs are `#[serde(rename_all = "camelCase")]`
`Serialize` (+ `Deserialize` for the ones the frontend sends back:
`ForgeRepo`, `NewPullRequest`). `ForgeKind` serialises as `"GitHub"` /
`"GitLab"` (bare enum, matching `PullMode` / `ResetMode` precedent).

**`PullRequest` fields** — the union of what both APIs give cheaply:

```rust
pub struct PullRequest {
    pub number: u64,
    pub title: String,
    pub author: String,
    pub source_branch: String,
    pub target_branch: String,
    pub url: String,
    pub draft: bool,
    pub cross_repo: bool,
    pub sha: Option<String>,
    pub updated_at: String,
}
```

`cross_repo` drives the local-branch name choice; `sha` drives the checks call
(`Option` because a payload can omit it).

**Tests** (`src-tauri/tests/forge_remote.rs`) — write these before the
implementation:

- scp-like, `ssh://` (with and without port and user), `https://` (with and
  without `.git`, with userinfo, with port), `git://`.
- GitLab subgroup → `owner = "group/sub"`, `name = "repo"`.
- SSH port dropped, HTTPS port kept.
- Userinfo never retained anywhere in the result.
- `None` for: `""`, `"not a url"`, `"/local/path"`, `"file:///x"`,
  `"https://host"` (no owner/name), `"https://host/only-one-segment"`,
  `"git@host:"`.
- Host lowercased; trailing `/` and `.git` stripped; `owner`/`name` non-empty.
- `detect` prefers `origin`, then `upstream`, then first parseable; skips
  unparseable remotes instead of failing; returns `None` for an empty list.
- Builtin kinds resolve; an override map resolves a self-hosted host
  case-insensitively; an unknown host yields `kind: None` with the host still
  reported.

---

## Phase 2 — token storage + secret hygiene

**Files**

- `src-tauri/src/forge/token.rs`

```rust
pub struct Secret(String);
impl Secret { pub fn new(s: String) -> Self; pub fn expose(&self) -> &str; pub fn is_empty(&self) -> bool; }
impl std::fmt::Debug for Secret { /* Secret(***) */ }

pub fn redact(text: &str, secret: &Secret) -> String;
pub fn credential_host(host: &str) -> String;   // <host>.platypusgit-forge.invalid
pub const CREDENTIAL_USERNAME: &str = "platypusgit-forge";

pub async fn store_token(host: &str, token: &Secret) -> AppResult<()>;
pub async fn load_token(host: &str) -> AppResult<Option<Secret>>;
pub async fn erase_token(host: &str) -> AppResult<()>;
```

**Mechanics**

- All three shell out to `git credential <approve|fill|reject>` with cwd =
  `std::env::temp_dir()`, `GIT_TERMINAL_PROMPT=0`, and `GIT_ASKPASS`/`SSH_ASKPASS`
  pointing at a program that *fails* (`false` on unix, `cmd` is not used —
  the value is only ever exec'd, never shelled). A helper that answers with an
  empty string must not read as a stored empty token, so `load_token` also
  treats an empty `password=` as `None`.
- Newline guard before writing any credential-protocol line; refuse, don't
  escape.
- `store_token` = `approve`, then `load_token`, then compare; mismatch →
  `AppError::ForgeTokenStore` with the `credential.helper` remedy.
- Parsing `fill` output: split each line on the first `=`; take `password`.
  Ignore everything else. Never log the raw output.

**Tests** (`src-tauri/tests/forge_token.rs`) — the pure half only; the
subprocess half is exercised through the round trip in manual verification and
is not unit-tested (it would test the developer's own keychain).

- `format!("{:?}", Secret::new("ghp_x".into()))` contains neither `ghp_` nor
  `x`, and does contain `***`.
- `redact` removes every occurrence of the token from a multi-line body echo,
  and leaves token-free text byte-identical.
- `redact` with an empty secret is the identity (an empty needle must not
  splatter `***` between every character).
- `credential_host("gitlab.com")` ends in `.platypusgit-forge.invalid` and is
  `!= "gitlab.com"` — i.e. it cannot collide with the transport key.
- `credential_line_safe` refuses `\n`, `\r`, and accepts ordinary values.

---

## Phase 3 — HTTP + the two forge implementations

**Files**

- `src-tauri/src/forge/http.rs`

```rust
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BODY: u64 = 4 * 1024 * 1024;

pub fn get_json(url: &str, header: (&str, &str)) -> AppResult<String>;
pub fn post_json(url: &str, header: (&str, &str), body: &serde_json::Value) -> AppResult<String>;
```

- Agent: `ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).https_only(true)`.
  `https_only` also covers redirects (ureq follows up to 5 by default).
- `User-Agent: platypusgit`, `Accept: application/json`.
- Read through `resp.into_reader().take(MAX_BODY)`.
- Status mapping: 401/403 → `ForgeAuth(host-from-url)`; 404 → `Forge("… not
  found …")`; other non-2xx → `Forge` with the API's own `message`/`error` field
  when the body is JSON, else the status line. **Every** message goes through
  `scrub_credentials`. The caller adds `redact` with the live token.
- Transport errors → `AppError::Network`.

- `src-tauri/src/forge/github.rs` / `gitlab.rs` — the trait impls. Both are URL
  builders + `serde_json::Value` parsers, nothing else.

**GitHub**

| Op | Call |
|---|---|
| base | `github.com` → `https://api.github.com`; else `https://<host>/api/v3` |
| identity | `GET {base}/user` → `login`, `name` |
| list | `GET {base}/repos/{o}/{r}/pulls?state=open&per_page=50&sort=updated&direction=desc` |
| checks | `GET {base}/repos/{o}/{r}/commits/{sha}/status` → `state`, `total_count` |
| create | `POST {base}/repos/{o}/{r}/pulls` `{title, head, base, body, draft}` |
| head ref | `refs/pull/{n}/head` |
| auth | `Authorization: Bearer <token>` |

`cross_repo` = `head.repo.full_name != base.repo.full_name` (or `head.repo`
absent → `true`, a deleted fork).

**GitLab**

| Op | Call |
|---|---|
| base | `https://<host>/api/v4` |
| project | `{o}/{r}` percent-encoded whole, `/` included → `group%2Fsub%2Frepo` |
| identity | `GET {base}/user` → `username`, `name` |
| list | `GET {base}/projects/{id}/merge_requests?state=opened&per_page=50&order_by=updated_at` |
| checks | `GET {base}/projects/{id}/pipelines?sha={sha}&per_page=1` → `[0].status` |
| create | `POST {base}/projects/{id}/merge_requests` `{source_branch, target_branch, title, description}` |
| head ref | `refs/merge-requests/{n}/head` |
| auth | `PRIVATE-TOKEN: <token>` |

GitLab's MR-create API has **no** `draft` parameter — draft is expressed by a
`Draft: ` title prefix. `create_body` applies it, and does not double-prefix a
title the user already prefixed. This has a test.

`cross_repo` = `source_project_id != target_project_id`.

**Validation helpers** live in `forge/mod.rs` so both impls share them:
`validate_host`, `encode_segment` (percent-encode all but
`A-Za-z0-9-._~`), `encode_path` (same but keeps `/` → used for the GitHub
owner/name pair only where a `/` is structural), `validate_sha`.

**Checks normalisation** — both forges' status vocabularies map onto
`ChecksState { Success, Pending, Failure, None }` so the UI has one tone
mapping. `ChecksSummary { state, total, label }` keeps the forge's own word
(`"success"`, `"running"`, …) for display.

**Tests** (`src-tauri/tests/forge_api.rs`, fixtures in
`src-tauri/tests/fixtures/`)

- Base URL for `github.com` vs `ghe.example.com`; `gitlab.com` vs
  `git.example.com:8443`.
- Every URL builder output, byte-exact.
- `validate_host` rejects `evil.com/`, `evil.com?x`, `u@evil.com`,
  `"e vil.com"`, `"\n"`, `""`, `"a".repeat(300)`; accepts `host`, `host:8443`,
  `sub.host-1.example`.
- `encode_segment("..")` → `%2E%2E`; `encode_segment("a/b")` → `a%2Fb`; so a
  crafted owner cannot escape the API path. Assert the built URL still contains
  the intended path prefix.
- `validate_sha` rejects `"-x"`, `"../../"`, `"g"*40`, too short/long.
- `parse_list` against `github_pulls.json` / `gitlab_mrs.json`: numbers,
  authors, branches, draft, `cross_repo` both ways, `sha`.
- `parse_checks` against `github_status.json` / `gitlab_pipelines.json`,
  including GitLab's empty array → `ChecksState::None`.
- `parse_identity` against `github_user.json` / `gitlab_user.json`.
- `parse_created` against `github_created_pr.json` / `gitlab_created_mr.json`.
- `create_body`: GitHub sets `draft: true`; GitLab prefixes `Draft: ` and does
  not double-prefix.
- `head_ref` per kind.
- A malformed payload (`"{}"`, `"[]"`, `"not json"`) yields
  `AppError::Forge`, never a panic.

---

## Phase 4 — commands + registration

**Files**

- `src-tauri/src/commands/forge.rs`
- `src-tauri/src/commands/mod.rs` — `pub mod forge;`
- `src-tauri/src/lib.rs` — register the eight commands; `.manage(ForgeTokens::default())`.

**Token resolution** in one place:

```rust
async fn token_for(tokens: &ForgeTokens, host: &str) -> AppResult<Secret>
```

memory cache → `load_token` → `ForgeAuth(host)` when absent. Every API command
starts here, so "not signed in" is one error shape.

**`forge_checkout_pull_request`** — the git half. The mechanics live in
`forge/checkout.rs` (`fetch_args`, `checkout_args`, `branch_exists`) so a test can
drive them against a real repository; the command only sequences them:

1. `validate_ref_name(local_branch)`; reject a remote name starting with `-`.
2. Resolve the workdir via `backend.repo_path`.
3. `run_git_authenticated(workdir, fetch_args(remote, head_ref), creds)`.
4. `branch_exists` → exists && !force → `AppError::BranchExists(local)`.
5. `run_git_authenticated(workdir, checkout_args(local, exists), None)`.

**`branch_exists` must NOT pass `--` to `git rev-parse`.** After `--` everything is
read as a PATH rather than a revision, so `rev-parse --verify --quiet --
refs/heads/main` exits 1 even when `main` exists — every branch reads as absent and
a real collision surfaces as git's own "branch already exists" failure instead of a
clean `BranchExists`. The argument is safe without it: always `refs/heads/`-prefixed
(so it cannot begin with `-`) and already through `validate_ref_name`. Regression
test in `tests/forge_checkout.rs`.

**Verification for this phase:** `cargo test`, `cargo clippy --all-targets`.

---

## Phase 5 — frontend types, wrappers, store

**Files**

- `src/lib/types.ts` — `ForgeKind`, `ForgeRepo`, `ForgeDetection`,
  `PullRequest`, `ChecksState`, `ChecksSummary`, `NewPullRequest`,
  `ForgeIdentity`, `ForgeTokenStatus`.
- `src/lib/tauri.ts` — one typed wrapper per command. No `invoke` anywhere else.
- `src/features/forge/forgeLabels.ts` — pure:
  `forgeLabel`, `prNoun`, `prAbbrev`, `localBranchFor(pr, kind)`,
  `checksTone(state)`.
- `src/features/forge/useForgeStore.ts`.

**`localBranchFor`** — `pr.crossRepo ? (kind === "GitHub" ? \`pr-${n}\` :
\`mr-${n}\`) : pr.sourceBranch`. Pure and unit-tested; the store never inlines
the rule.

**Store shape**

```ts
detection: ForgeDetection | null;
forge: ForgeRepo | null;          // detection + a resolved kind
pulls: PullRequest[];
selected: number | null;
checks: Record<number, ChecksSummary>;
hostKinds: Record<string, ForgeKind>;   // persisted
logins: Record<string, string>;         // persisted, per host
loading / creating / checkingOut: boolean;
error: string | null;
signedIn: boolean;
createOpen: boolean;
```

Actions: `detect(repoId)`, `refresh()`, `select(n)`, `loadChecks(n)`,
`openInBrowser(pr)`, `checkout(pr, force)`, `openCreate()`, `closeCreate()`,
`create(input)`, `signIn(host, kind, token)`, `signOut(host)`,
`setHostKind(host, kind)`, `clearError()`.

`hostKinds` + `logins` persist under `pg-forge-hosts` (one key, one JSON blob),
read defensively like `useRecentsStore` does.

`checkout` catches `BranchExists` and rethrows a typed marker the screen turns
into a `pgConfirm`, rather than the store calling `pgConfirm` itself — a store
that opens dialogs cannot be unit-tested.

**Tests** — `useForgeStore.test.ts`, `forgeLabels.test.ts`.

---

## Phase 6 — screen, dialog, Settings section, keymap, palette

**Files**

- `src/screens/Pulls.tsx`
- `src/features/forge/PullRequestRow.tsx`
- `src/features/forge/CreatePullRequestDialog.tsx`
- `src/features/forge/ForgeSettings.tsx`
- `src/design/icons.tsx` — a `pullRequest` glyph (added to the map, not a
  one-off SVG in the screen).
- `src/AppShell.tsx` — `pulls` in `ScreenId`, `ACTIVITY_ITEMS`,
  `ACTIVITY_ACTION`, `screens`.
- `src/features/keymap/actions.ts` — `nav.pulls`, `forge.createPr`.
- `src/features/keymap/presets.ts` — both presets.
- `src/features/palette/commands.ts` — `SCREENS` entry + three commands.
- `src/screens/Settings.tsx` — render `<ForgeSettings />`.

**Row geometry:** `height: "calc(48px + var(--row-step))"`.
**Panes:** list pane is `<PGPane id="pulls.list" primary>`; both panes wrap
their content in `FocusableScroll`.
**List keyboard:** `usePaneList` on the list pane (selection + Enter to open in
browser), matching every other list screen.

**Tests** — `Pulls.test.tsx`, `CreatePullRequestDialog.test.tsx`,
`ForgeSettings.test.tsx`, all with `mockInvoke`; `WithDialogs` for the checkout
confirm and the remove-token confirm.

---

## Phase 7 — e2e + docs

- `e2e/specs/pulls.e2e.ts` — activity-bar navigation to the screen, and the
  "no forge" empty state for a repo whose remote is not a forge. Nothing past
  detection is reachable without a live API.
- `CLAUDE.md` — the new backend module tree, the new feature dir, the new
  screen, the four `AppError` variants, and the token-storage decision (one
  line: forge tokens are namespaced under `<host>.platypusgit-forge.invalid`
  and never share the D5 `Credentials` path).

---

## Verification gate (all must pass before the PR)

```bash
pnpm tsc --noEmit
pnpm exec tsc -p e2e/tsconfig.json --noEmit
pnpm test
cargo test  --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
```

E2E is **not** run locally for this change: five other agents are compiling
concurrently and the 8 GB Docker VM OOM-kills rustc. CI's `e2e-linux` job is the
gate.

## Manual verification (not automatable)

Recorded in the PR body rather than as a test, because it needs a real token:

1. Settings → Integrations → paste a GitHub PAT → "signed in as <login>".
2. Pulls screen lists open PRs for a repo with an `origin` on github.com.
3. Select a PR → checks summary appears.
4. "Open in browser" opens the forge page.
5. "Check out" on a fork PR produces a local `pr-<n>` at the PR head.
6. "New pull request" from a pushed branch returns a URL.
7. "Remove token" → the list falls back to the "add a token" empty state.
