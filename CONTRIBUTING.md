# Contributing to platypusgit

Thanks for your interest in contributing! platypusgit is a cross-platform,
developer-focused git desktop app built with Tauri 2 (Rust) and React +
TypeScript. This guide covers everything you need to get a change merged.

By contributing you agree that your contributions are licensed under the
project's [GPL-3.0 license](./LICENSE).

## Prerequisites

- **Node 22+**
- **pnpm** — `curl -fsSL https://get.pnpm.io/install.sh | sh -`
- **Rust stable** — via [rustup](https://rustup.rs/)
- Platform build tools:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev` (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))
  - **Windows:** WebView2 (ships with Windows 11), MSVC Build Tools

## Getting started

```bash
pnpm install        # frontend + tauri-cli deps
pnpm tauri dev      # run the app (first build ~2-5 min, reruns ~10s)
```

## Project layout

See [`CLAUDE.md`](./CLAUDE.md) for the full architecture tour, conventions, and
the step-by-step recipe for adding a new git operation. Design specs and
implementation plans live under `docs/superpowers/`.

High level:

- `src-tauri/` — Rust backend. `GitBackend` trait + `Libgit2Backend` impl, thin
  Tauri command handlers in `commands/`.
- `src/` — React frontend. In-house design system in `src/design/`, per-feature
  Zustand stores in `src/features/`, screens in `src/screens/`.

## Tests

Three independent layers — run all before opening a PR:

```bash
pnpm tsc --noEmit                                   # TypeScript type-check
cargo test --manifest-path src-tauri/Cargo.toml     # Rust backend integration
pnpm test                                           # vitest (frontend unit + component)
```

Add tests alongside the code you change:

- New git op → integration test against a real temp repo (`TempRepo` fixture in
  `src-tauri/tests/support/`).
- New pure frontend logic → `*.test.ts`.
- New component → `*.test.tsx` (jsdom + React Testing Library; mock `invoke` via
  `mockInvoke` in `src/test/setup.ts`).

## Adding a new git operation

1. Add the method to the `GitBackend` trait (`src-tauri/src/git/mod.rs`).
2. Implement it in `Libgit2Backend` (`libgit2.rs`); stub `NotImplemented` in
   `CliBackend` (`cli.rs`) to keep the trait shape exercised.
3. Add a thin Tauri command in the right `commands/<area>.rs`. Wrap git2 calls in
   `tokio::task::spawn_blocking` (libgit2 is sync).
4. Register the command in `invoke_handler![…]` (`src-tauri/src/lib.rs`).
5. Add the TS type to `src/lib/types.ts` and a typed wrapper to `src/lib/tauri.ts`
   (the frontend never calls `invoke()` directly).
6. Wire it into the relevant feature's Zustand store.

## Conventions

- **Errors:** every IPC-crossing Rust fn returns `AppResult<T>`. No `unwrap`/panic
  in commands — add an `AppError` variant instead of stringifying. Keep the TS
  `AppError` union (`src/lib/errors.ts`) 1:1 with the Rust enum in the same commit.
- **State:** Zustand per-feature, not one global store. Cross-screen navigation
  goes through `useNavStore` intents.
- **Styling:** Tailwind v4 (CSS-first). Theme tokens in `src/index.css`. No
  `tailwind.config.js`.
- **Design system:** import UI primitives from `@/design`. Do not add
  `src/components/ui/`.
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

We use **feature branches + squash and merge**. Each PR lands on `main` as a single commit, so `main` stays linear.

1. Branch off `main` — `feat/...`, `fix/...`, `chore/...`, `docs/...`. Never commit to `main` directly.
2. Build the change as a series of small, focused commits (Conventional Commits throughout).
3. Keep the branch current by **rebasing onto `main`** (`git rebase main`), not by merging `main` in. Force-push with `--force-with-lease` after a rebase.
4. PRs are integrated with GitHub's **Squash and merge** — all your commits collapse into one commit on `main`. Write a clear Conventional-Commit PR title + description; it becomes the squash commit message.

## Pull requests

1. Make your change on a feature branch (see above), with tests.
2. Ensure all three test layers pass (see [Tests](#tests)).
3. Open the PR; fill out the template, describe the change and link any issue.
4. Keep PRs focused — one logical change per PR.

For larger features beyond a small fix, open an issue first to discuss the
approach. Net-new features should land a spec + plan under `docs/superpowers/`
before implementation.
