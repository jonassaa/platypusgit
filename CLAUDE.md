# CLAUDE.md

Context for future Claude sessions working on this repo.

**Keep this file SHORT.** It is loaded into every session's context, so it holds
only operational rules and pointers. Deep dives — postmortems, design rationale,
annotated source trees — live in `docs/dev/` and in the specs. When a change
earns a written lesson, add it to the matching `docs/dev/*.md` file (or the
feature's spec), never here; this file grew to 2,456 lines once and was cut back
to what you are reading. A new section here needs a reason a pointer cannot serve.

## What this is

`platypusgit` — cross-platform, developer-focused git desktop app. Tauri 2 (Rust) backend + React/TS frontend. Dev-first TortoiseGit alternative with "extreme usability" as north star. Standalone GUI only — shell integration (Finder/Explorer overlays) out of scope.

## Detailed docs — read the matching one BEFORE working in its area

- `docs/dev/architecture.md` — the annotated backend + frontend source trees:
  every module, command, feature directory, and the traps between them. The map
  of the codebase; start here for any non-trivial change.
- `docs/dev/testing.md` — the four test layers, headless e2e in Docker, CI
  workflows and gates, e2e sharding, the `test/` doc invariants.
- `docs/dev/frontend.md` — diff rendering, the paged log, navigation model,
  state management (multi-repo tabs), styling/design system, PGSelect,
  resizable panes, dialogs, file lists, drag and drop.
- `docs/dev/backend.md` — errors, forge tokens, the rebase engine, network ops
  and credentials, signing, stash, spawning processes, bisect, async/threading.
- `docs/dev/distribution.md` — `pgit` CLI packaging per channel, the launch
  detach, Tauri permissions.
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — approved design docs
  and implementation plans per feature (`ls` for the current set). New feature
  beyond MVP slice → write new spec + plan there first.

`test/docs.test.ts` fails the build when the doc set falls behind the tree
(commands, backend modules, feature directories) — see `docs/dev/testing.md`.

## Toolchain

- **Node 22** + **pnpm** (at `~/Library/pnpm`). Not npm, not yarn.
- **Rust stable** via rustup (`~/.cargo/bin`).
- Assistant's Bash tool does not inherit interactive shell rc → prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` when running `pnpm` or `cargo`.

## Common commands

```bash
pnpm install                                # frontend + tauri-cli deps
pnpm tauri dev                              # run app (first build ~2 min, reruns ~10s)
pnpm tsc --noEmit                           # type-check
pnpm vite build                             # bundle frontend only
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build                            # production bundle (.msi/.dmg/.deb/.AppImage)
pnpm tauri build --no-sign                  # ...without updater signing (see note below)
pnpm test                                   # vitest (unit logic + component tests + doc invariants)
pnpm test:e2e:docker                        # e2e — THE way to run e2e (headless, same stack as CI)
pnpm test:e2e:docker run --spec e2e/specs/X.e2e.ts   # ...one spec against this worktree's snapshot
pnpm exec tsc -p e2e/tsconfig.json --noEmit # e2e typecheck gate (root tsc excludes e2e/)
```

**Local production builds need the updater signing key.** `tauri.conf.json`
sets an updater pubkey + `createUpdaterArtifacts`, and a pubkey with no private
key is a **hard error** on any target producing an updater artifact. Export
`TAURI_SIGNING_PRIVATE_KEY` (+ `_PASSWORD`) or build with `--no-sign`. CI passes
both from repo secrets.

## Testing — the operational rules

Four layers (details + CI shape in `docs/dev/testing.md`):

- **Rust backend integration** — `cargo test` against real temp repos.
- **Frontend pure logic + component tests** — `pnpm test` (vitest project
  `unit`, jsdom + mocks from `src/test/setup.ts`).
- **Doc/tree invariants** — `pnpm test` (vitest project `docs`, node env,
  reads `CLAUDE.md`, `docs/dev/`, `src-tauri/`, `e2e/`, `.github/`).
- **E2E** — WebdriverIO specs in `e2e/specs/` driving the real binary.

**E2E always runs in Docker (`pnpm test:e2e:docker …`) — never natively, never
in a UI window.** A native run pops a real WKWebView window, steals focus, is
flaky and slow, and does not predict the CI gate. The one exception is a
genuinely WKWebView-specific question the user explicitly asks for. Run e2e
only when DONE developing a change, and only the spec file(s) relevant to what
you touched — CI runs the full suite. After a `src/` or `src-tauri/` change,
rebuild the snapshot first: `pnpm test:e2e:docker build`, then
`pnpm test:e2e:docker run --spec e2e/specs/<file>.e2e.ts`. Never rely on a
stale snapshot. One cold container build at a time across ALL worktrees
(memory), different worktrees may otherwise run concurrently.

**Before writing or debugging any e2e spec, read the `e2e-testing` project
skill** (`.claude/skills/e2e-testing/SKILL.md`).

## Architecture in one screen

Backend (`src-tauri/src/`): thin Tauri command handlers (`commands/`, one file
per area) over a `GitBackend` trait (`git/mod.rs`) implemented by
`Libgit2Backend` (`git/libgit2.rs`, shelling out to real git where libgit2
falls short). One error type crosses IPC (`error.rs::AppError`). Process
spawning only via `proc.rs`; forge (GitHub/GitLab) integration under `forge/`.

Frontend (`src/`): screens (`screens/`) + per-feature Zustand stores and
components (`features/*/`), an in-house design system (`design/`, NOT
`components/ui/`), shared logic in `lib/` (typed `invoke` wrappers in
`lib/tauri.ts` — never call `invoke` directly). `@/` → `src/` path alias; use it.

**Three near-identical filename pairs do different jobs** — check before
editing: `git/signing.rs` (cryptography) vs `git/signature.rs` (identity/
sign-off); `src-tauri/src/update.rs` (engine) vs `commands/update.rs`
(handlers); `src-tauri/src/cli.rs` (pgit launch) vs `git/cli.rs` (CliBackend).

The full annotated trees are in `docs/dev/architecture.md`.

### Adding a new git op (standard path)

1. Add method to `GitBackend` trait (`src-tauri/src/git/mod.rs`).
2. Implement in `Libgit2Backend` (`libgit2.rs`). Stub in `CliBackend` too (`NotImplemented`) — keeps trait shape exercised.
3. Tauri command in right `commands/<area>.rs`. Keep thin. Wrap git2 calls in `tokio::task::spawn_blocking` (libgit2 is sync).
4. Register command name in `invoke_handler![…]` in `src-tauri/src/lib.rs`.
5. Add TS type to `src/lib/types.ts`, wrapper to `src/lib/tauri.ts`.
6. Wire into relevant feature's Zustand store.
7. Add it to the `commands/<area>.rs` entry in the backend tree in
   `docs/dev/architecture.md` — `test/docs.test.ts` fails the build otherwise,
   and a command nobody can find is a command that gets written twice.

## Conventions — the load-bearing rules

Each rule's full story (why, traps, tests that pin it) is in the named doc.

- **Errors:** every IPC-crossing fn returns `AppResult<T>`; add `AppError`
  variants, never stringify. TS `AppError` union stays 1:1 with the Rust enum,
  updated in the same commit. (`docs/dev/backend.md`)
- **Never `Command::new` outside `src-tauri/src/proc.rs`** — a guard test
  fails the build. Use the `proc::git*`/`proc::program*` constructors.
  (`docs/dev/backend.md`)
- **One credential path.** Network git ops go through
  `commands::net::run_git_authenticated`; frontend retries via `useRepoStore`'s
  exported `withAuthRetry`. Never a second auth path. Secrets travel in env,
  never argv; end option parsing with `--` before user-supplied values.
  (`docs/dev/backend.md`)
- **One cancel path.** A long-running child is stopped through
  `cancel::OpRegistry` — the frontend mints the `opId` before the invoke, and
  cancel kills the child's process group with SIGTERM (never SIGKILL first: git's
  handlers remove its lock files). A cancelled op returns `AppError::Cancelled`,
  which no surface may render as an error. (`docs/dev/backend.md`)
- **Forge tokens are NOT git credentials** — separate storage, separate types
  (`Secret`), no command returns a token. (`docs/dev/backend.md`)
- **One signing chain** (`libgit2.rs::sign_payload`) for commits AND tags; a
  signing failure creates nothing. (`docs/dev/backend.md`)
- **Never `window.confirm`/`window.prompt`** — `pgConfirm`/`pgPrompt` from
  `@/design`. (`docs/dev/frontend.md`)
- **No native `<select>`/`<option>` in shipped `src/`** — `PGSelect`; a guard
  test enforces it. (`docs/dev/frontend.md`)
- **Design system lives in `src/design/`**, imported from `@/design`. Do NOT
  add `src/components/ui/`. Never hardcode the accent hue — CSS vars/theme
  tokens only. New list-row surfaces opt into UI density (`var(--row-step)`).
  (`docs/dev/frontend.md`)
- **Zustand per feature.** `useRepoStore` holds exactly ONE repository's state
  (the active tab's); a new per-repo field must join `RepoSlice`/`emptySlice`
  or tab switches leak state. Danger-op catch arms: `refreshAll()` first,
  `set({ error })` last. (`docs/dev/frontend.md`)
- **A new `NavIntent` kind must be routed in `AppShell`** — compile-enforced
  (`assertNever`) + `AppShell.navroutes.test.tsx`. (`docs/dev/frontend.md`)
- **Diff surfaces:** one row model (`flattenDiffRows`); gate text rendering on
  `isTextualDiff`, scroll by offset (never `scrollIntoView` under windowing),
  measure viewports with `lib/useViewportH`/`useElementSize` (read first,
  observe second — WebKitGTK has no `ResizeObserver`). New row markup keeps the
  selection split: code cell `.pg-selectable`, line numbers and `+`/`−` marker
  `user-select: none`. A selection cannot leave the rendered window, so copying a
  long range goes through `lib/diffCopy.ts` (`diff.copy` / the right-click menu),
  and `Mod+C` must keep declining to the native copy. (`docs/dev/frontend.md`)
- **The log is paged** — `s.commits` is a prefix of history, never the answer
  to "does X exist / is X an ancestor"; ask the backend.
  (`docs/dev/frontend.md`)
- **Drag and drop:** pointer events via `features/dnd`, never HTML5 dnd; every
  drag has a keyboard equivalent. (`docs/dev/frontend.md`)
- **`git2::Repository` is `Send` not `Sync`** — wrap git2 work in
  `spawn_blocking`; per-repo ops serialize on an inner mutex. Verify and mutate
  under ONE lock acquisition (stash TOCTOU). (`docs/dev/backend.md`)
- **Tauri permissions:** shared set in `capabilities/default.json`; privileged
  ones (updater, e2e) stay in their scoped capability files.
  (`docs/dev/distribution.md`)

## Things deliberately NOT in codebase

- Shell integration / Finder / Explorer overlays (out of scope).
- Custom icons — Tauri defaults for now. Replace before first release.
- Code signing config for bundles (distinct from the *updater* signing key
  above, and from git object signing, which is a feature).

## Known placeholders

- **Bundle identifier** in `src-tauri/tauri.conf.json` is `com.platypusgit.app` — placeholder. User will finalize; changing later orphans installed instances, so don't auto-change without asking.

## Commit style

Match existing log:
- `feat(scope): …` / `fix(scope): …` / `test: …` / `docs: …` / `chore: …`
- Short imperative subject, under 72 chars.
- Optional body with **Why:** for non-obvious decisions.
- Trailing `Co-Authored-By: Claude …` when assistant drove the commit.

Do not create empty / merge commits. Do not amend published commits without asking.

## Branching & merge workflow

- **Never commit directly to `main`.** Branch first: `feat/...`, `fix/...`, `chore/...`, `docs/...`.
- **Always work in a dedicated git worktree, never the primary checkout.** Multiple assistant sessions run against this repo at once; sharing one working directory collides (competing index/HEAD, a rebase-in-progress from another session, `localStorage`-clearing e2e runs). Create the branch and its worktree together off latest `main`: `git fetch origin && git worktree add -b <type>/<slug> .claude/worktrees/<slug> origin/main`. Do all edits, builds, and tests there; remove it with `git worktree remove` when the PR is merged. Read-only analysis still gets its own worktree (`--detach origin/main`) so it never touches another session's state.
- Work as a series of small, focused commits on the feature branch (Conventional Commits throughout).
- When the branch does need updating, **rebase onto `main`**, not merge `main` in — no merge commits on the branch.
- Integrate via **squash and merge** — the `main` ruleset (id `18319179`) enforces squash-only (`allowed_merge_methods: ["squash"]`) plus `required_linear_history`, `non_fast_forward`, and no branch deletion; merge-commit and rebase-merge are blocked. `main` gets one commit per PR, linear by construction.
- Since the PR squashes to a single commit anyway, squash the branch's commits into one locally (`git reset --soft origin/main` + one Conventional Commit) before merging so the squashed commit message is clean rather than an auto-concatenation.
- **No rebase-before-merge requirement.** `required_linear_history` is satisfied by the squash merge itself (one new commit on the `main` tip), and the required `e2e-linux` check is non-strict, so a branch that is merely *behind* `main` merges fine. **Merge as soon as GitHub reports the PR mergeable** (`gh pr view <N> --json mergeable,mergeStateStatus`). Rebase only when there's a reason: GitHub reports conflicts (`mergeable: CONFLICTING`), or your change interacts with something that landed on `main` since and you want CI to run against it.
- Resolve conflicts by rebasing onto `origin/main` (`git fetch origin && git rebase origin/main`), then force-push (`--force-with-lease`).
- Branch and open a PR even for assistant-driven work — don't push straight to `main`.
- `main` may be checked out by a worktree under `.claude/worktrees/` (other assistant sessions). Then `git checkout main` and `gh pr merge --delete-branch`'s local cleanup fail with "'main' is already used by worktree" — the remote merge still succeeds. Recover with `git checkout --detach origin/main`, delete the branch manually, and leave the other worktree alone.
