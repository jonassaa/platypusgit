# Contributing to platypusgit

Thanks for your interest in contributing! platypusgit is a cross-platform,
developer-focused git desktop app built with Tauri 2 (Rust) and React +
TypeScript.

This file owns setup, the test commands and the PR workflow. The
[README](./README.md) links here rather than repeating them.

By contributing you agree that your contributions are licensed under the
project's [GPL-3.0 license](./LICENSE). Please also read the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Quick start — clone to a running window

Budget ten minutes, most of it spent watching Rust compile.

### 1. Prerequisites

- **Node 22+** (CI builds on 22)
- **pnpm 9+** — `curl -fsSL https://get.pnpm.io/install.sh | sh -`. Not npm, not
  yarn: the lockfile is `pnpm-lock.yaml`.
- **Rust stable** — via [rustup](https://rustup.rs/)
- Platform build tools:
  - **macOS:** Xcode Command Line Tools — `xcode-select --install`
  - **Linux:** the set CI installs, which is the one known to link:
    ```bash
    sudo apt-get install libwebkit2gtk-4.1-dev libgtk-3-dev \
      libayatana-appindicator3-dev librsvg2-dev patchelf build-essential
    ```
    (see also [Tauri's prerequisites](https://tauri.app/start/prerequisites/))
  - **Windows:** MSVC Build Tools, plus WebView2 (already present on Windows 11)

### 2. Run it

```bash
pnpm install        # frontend + tauri-cli deps  — ~1 min the first time
pnpm tauri dev      # builds the Rust tree, then opens the app
```

**The first `pnpm tauri dev` compiles the entire Rust dependency tree: 2–5
minutes with no window and very little output.** It has not hung. Later runs
reuse the cargo cache and start in ~10s; frontend edits hot-reload without a
rebuild.

If it fails on Linux with a linker error about `webkit2gtk` or
`ayatana-appindicator`, a package from the list above is missing.

### 3. Check your toolchain is complete

```bash
pnpm tsc --noEmit                                   # seconds
pnpm test                                           # seconds
cargo test --manifest-path src-tauri/Cargo.toml     # minutes on a cold cache
```

If those pass, your toolchain is complete. There is a fourth test layer — e2e —
which runs in Docker rather than on your machine; see [Tests](#tests).

## What to work on

- **[good first issue](https://github.com/jonassaa/platypusgit/labels/good%20first%20issue)**
  — scoped, self-contained, and written to be picked up cold.
- **[All open issues](https://github.com/jonassaa/platypusgit/issues)** — bugs
  and feature requests, most with the relevant files named in the body.
- **[Discussions](https://github.com/jonassaa/platypusgit/discussions)** — the
  place for questions, ideas and "is this a bug?" before it is an issue.

Comment on an issue before starting something non-trivial, so two people don't
build it twice. For anything larger than a small fix, open an issue and agree
the approach first; net-new features land a spec + plan under
`docs/superpowers/` before implementation.

## Project layout

The architecture documentation for humans is [`docs/dev/`](./docs/dev/). **Read
the one matching your area before making a non-trivial change** — each is an
annotated tour, not an index:

- [`architecture.md`](./docs/dev/architecture.md) — annotated backend and
  frontend source trees: every module, command and feature directory, and the
  traps between them. Start here.
- [`frontend.md`](./docs/dev/frontend.md) — diff rendering, the paged log,
  navigation, multi-repo state, the design system, dialogs, drag and drop.
- [`backend.md`](./docs/dev/backend.md) — errors, forge tokens, the rebase
  engine, network ops and credentials, signing, stash, process spawning.
- [`testing.md`](./docs/dev/testing.md) — the four test layers, Docker e2e, the
  CI workflows and gates.
- [`distribution.md`](./docs/dev/distribution.md) — the `pgit` CLI, packaging
  per channel, Tauri permissions.

Approved design specs and implementation plans live under
[`docs/superpowers/`](./docs/superpowers/).
[`CLAUDE.md`](./CLAUDE.md) is the short operational brief for AI assistants; it
points at the same `docs/dev/` files.

High level:

- `src-tauri/` — Rust backend. A `GitBackend` trait + `Libgit2Backend` impl,
  behind thin Tauri command handlers in `commands/`.
- `src/` — React frontend. In-house design system in `src/design/`, per-feature
  Zustand stores and components in `src/features/`, screens in `src/screens/`.

## Tests

**Four independent layers.** Three run on your machine; the fourth runs in
Docker.

```bash
cargo test --manifest-path src-tauri/Cargo.toml     # layer 1
pnpm test                                           # layers 2 and 3 (one vitest run)
pnpm test:e2e:docker                                # layer 4 — see below
```

1. **Rust backend integration** — every `GitBackend` op against real temp repos
   (`TempRepo` fixture in `src-tauri/tests/support/`). No webview, no network.
2. **Frontend pure logic + component tests** — the vitest `unit` project:
   `src/**/*.test.{ts,tsx}`, jsdom + React Testing Library, with `invoke` mocked
   via `src/test/setup.ts` (`mockInvoke(cmd, handler)`).
3. **Doc and tree invariants** — the vitest `docs` project, `test/*.test.ts`.
   These read `CLAUDE.md`, `docs/dev/`, `README.md`, `src-tauri/` and `e2e/`,
   and **will fail your build if you add a command, backend module or feature
   directory without documenting it**. That is deliberate: a command nobody can
   find is a command that gets written twice. If `docs.test.ts` fails, the fix
   is to add your new thing to the tree in `docs/dev/architecture.md`.
4. **E2E** — WebdriverIO specs in `e2e/specs/` driving the real binary.

Run one vitest project with `pnpm vitest run --project unit` (or `--project
docs`).

Two typechecks sit alongside the layers, and CI runs both:

```bash
pnpm tsc --noEmit                                   # src/ and test/
pnpm exec tsc -p e2e/tsconfig.json --noEmit         # e2e/ — nothing else covers it
```

**`pnpm tsc --noEmit` does not cover `e2e/`.** The root tsconfig excludes it, so
a type error in a spec passes locally and fails CI unless you run the second
command.

### E2E: always in Docker

```bash
pnpm test:e2e:docker build                                  # rebuild the binary snapshot
pnpm test:e2e:docker run --spec e2e/specs/diff-nav.e2e.ts   # one spec, reusing the snapshot
pnpm test:e2e:docker                                        # build + the whole suite
```

**Never run e2e natively.** macOS has no headless webview, so a native run pops
a real window, steals focus, is flaky on multi-window specs and slow — and a
green native run does not predict the CI gate. The `test:e2e`, `test:e2e:build`
and `test:e2e:run` scripts are in-container primitives; don't call them on the
host.

Run e2e when you are *done* developing, and only the spec files covering what
you touched — CI runs the full suite. After any `src/` or `src-tauri/` change,
`build` first: `run` against a stale snapshot silently tests the old binary.
The first Docker run builds the image and compiles Rust from scratch and is
slow; later runs reuse caches.

Full detail — sharding, the memory limits, spec gotchas — is in
[`docs/dev/testing.md`](./docs/dev/testing.md).

### Adding tests

Add them alongside the code you change:

- New git op → a Rust integration test against a real temp repo.
- New pure frontend logic → `*.test.ts` next to it.
- New component → `*.test.tsx`.
- New user-facing flow, or a bug that reached the UI → an e2e spec.

## Production bundles

```bash
pnpm tauri build --no-sign     # .dmg / .msi / .deb / .AppImage under src-tauri/target/release/bundle/
```

**`--no-sign` is not optional locally.** `src-tauri/tauri.conf.json` carries the
updater public key and sets `createUpdaterArtifacts`, and a public key with no
matching private key is a *hard error* on any target that produces an updater
artifact. Either pass `--no-sign`, or export `TAURI_SIGNING_PRIVATE_KEY` (and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). CI passes both from repository secrets;
a plain `pnpm tauri build` will fail for you.

## Adding a new git operation

1. Add the method to the `GitBackend` trait (`src-tauri/src/git/mod.rs`).
2. Implement it in `Libgit2Backend` (`src-tauri/src/git/libgit2.rs`); stub
   `NotImplemented` in `CliBackend` (`src-tauri/src/git/cli.rs` — *not*
   `src-tauri/src/cli.rs`, which is the `pgit` launcher) to keep the trait
   shape exercised.
3. Add a thin Tauri command in the right `commands/<area>.rs`. Wrap git2 calls
   in `tokio::task::spawn_blocking` — libgit2 is sync, and `git2::Repository`
   is `Send` but not `Sync`.
4. Register the command in `invoke_handler![…]` (`src-tauri/src/lib.rs`).
5. Add the TS type to `src/lib/types.ts` and a typed wrapper to
   `src/lib/tauri.ts` (the frontend never calls `invoke()` directly).
6. Wire it into the relevant feature's Zustand store.
7. **Document it** — add the command to its `commands/<area>.rs` entry in the
   backend tree in `docs/dev/architecture.md`. `test/docs.test.ts` fails the
   build otherwise.

## Conventions

The rule is here; the reasoning and the traps are in the linked doc.

- **Errors:** every IPC-crossing Rust fn returns `AppResult<T>`. No
  `unwrap`/panic in commands — add an `AppError` variant instead of
  stringifying. Keep the TS `AppError` union (`src/lib/errors.ts`) 1:1 with the
  Rust enum, in the same commit. (`backend.md`)
- **Process spawning:** never `Command::new` outside `src-tauri/src/proc.rs` —
  a guard test fails the build. (`backend.md`)
- **One credential path:** network git ops go through
  `commands::net::run_git_authenticated`; the frontend retries via
  `withAuthRetry`. Secrets travel in env, never argv. (`backend.md`)
- **State:** Zustand per feature, not one global store. `useRepoStore` holds
  exactly one repository's state, so a new per-repo field must join
  `RepoSlice`/`emptySlice` or it leaks across tab switches. Cross-screen
  navigation goes through `useNavStore` intents. (`frontend.md`)
- **Design system:** import UI primitives from `@/design`. Do not add
  `src/components/ui/`. No native `<select>`/`<option>` and no
  `window.confirm`/`window.prompt` (use `PGSelect`, `pgConfirm`, `pgPrompt`) —
  guard tests enforce both. Never hardcode the accent hue. (`frontend.md`)
- **Styling:** Tailwind v4, CSS-first. Theme tokens in `src/index.css`. There is
  no `tailwind.config.js`.
- **Path alias:** `@/` → `src/`. Prefer it over deep relative imports.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(scope): add stash-to-branch action
fix(diff): handle empty hunk selection
test: cover reflog dirty-tree path
docs: update remote ops section
chore: bump tauri to 2.x
```

- Short imperative subject, under 72 chars.
- Optional body with a `Why:` line for non-obvious decisions.
- Do not create empty or merge commits. Do not amend published commits.

## Branching & merge workflow

We use **feature branches + squash and merge**. The `main` ruleset requires
linear history and allows squash merges only, so `main` is one commit per PR
with no merge commits.

1. Branch off `main` — `feat/...`, `fix/...`, `chore/...`, `docs/...`. Never commit to `main` directly.
2. Build the change as a series of small, focused commits (Conventional Commits throughout). They collapse into a single commit on merge, so each one need not be individually buildable.
3. If the branch needs updating, **rebase onto `main`** (`git rebase main`), never merge `main` in. Force-push with `--force-with-lease` after a rebase.
4. PRs are integrated with GitHub's **Squash and merge** — the branch becomes one commit on `main`, and the PR title + description become its message, so write them Conventional-Commit style. Merge-commit and rebase-merge are blocked.
5. A branch that is only *behind* `main` still merges — the squash commit lands on the current tip, which keeps history linear on its own. No rebase-before-merge dance: merge once GitHub reports the PR mergeable. Rebase only if GitHub reports conflicts, or you want CI to run against something that just landed on `main`.

## Pull requests

1. Make your change on a feature branch (see above), with tests.
2. Run the local gates — `pnpm tsc --noEmit`, `pnpm test`,
   `cargo test --manifest-path src-tauri/Cargo.toml`, plus
   `pnpm exec tsc -p e2e/tsconfig.json --noEmit` if you touched `e2e/`, and the
   relevant e2e spec(s) in Docker if you touched `src/` or `src-tauri/`.
3. Open the PR; fill out the template, describe the change and link any issue.
4. Keep PRs focused — one logical change per PR.

CI runs the same layers: a `unit` job (typecheck, vitest, e2e typecheck), a
`rust` job (`cargo test`), and the sharded Linux e2e suite. `e2e-linux` is the
required check.
