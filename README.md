# platypusgit

A cross-platform, developer-focused git desktop app. Tauri 2 + React + TypeScript.
A dev-first alternative to TortoiseGit with "extreme usability" as the north star.

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](./LICENSE)

> **Status: active development.** Most core git operations are implemented
> end-to-end (staging, hunks, commit, diff, blame, branches, tags, history,
> stash, conflict resolution, interactive rebase, remotes, fetch/pull/push,
> reflog). Standalone GUI only — shell integration (Finder/Explorer overlays)
> is out of scope.

## Features

- **Staging & commit** — stage/unstage/discard files and individual hunks, commit with amend + author override
- **Diff & viewing** — worktree/index/HEAD diffs, commit-to-commit diffs, blame, repo browser
- **Branches & tags** — list/create/checkout/rename/delete branches, lightweight + annotated tags
- **History** — commit graph, file history, reflog viewer, detached-HEAD checkout
- **History manipulation** — reset (soft/mixed/hard), cherry-pick, revert
- **Stash** — save/apply/pop/drop, stash-to-branch
- **Conflict resolution** — 3-way sides, accept ours/theirs, external mergetool, continue/abort
- **Interactive rebase** — pick/reword/edit/squash/fixup/drop, continue/abort, base picker
- **Remotes & network** — add/remove/rename/prune remotes, fetch/pull/push (with-lease/force), merge

## Install

### macOS (Homebrew)

```bash
brew install --cask jonassaa/platypusgit/platypusgit
```

The app is ad-hoc signed but not notarized. The cask clears the macOS
Gatekeeper quarantine flag on install, so it launches with no "unidentified
developer" prompt. Update with `brew upgrade --cask --greedy platypusgit`.

### Other platforms

Grab the latest `.msi` (Windows), `.deb` / `.AppImage` (Linux) from
[Releases](https://github.com/jonassaa/platypusgit/releases), or build from
source (see below).

## Development

### Prerequisites

- **Node 22+**
- **pnpm** — install via `curl -fsSL https://get.pnpm.io/install.sh | sh -`
- **Rust stable** — install via [rustup](https://rustup.rs/)
- Platform build tools:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `libwebkit2gtk-4.1-dev`, `build-essential`, `libssl-dev` (see [Tauri prerequisites](https://tauri.app/start/prerequisites/))
  - **Windows:** WebView2 (shipped with Windows 11), MSVC Build Tools

### First-time setup

```bash
pnpm install
```

### Run the app

```bash
pnpm tauri dev
```

First launch compiles the full Rust dependency tree — expect 2–5 minutes. Subsequent runs start in ~10 seconds.

### Check everything compiles without launching

```bash
pnpm tsc --noEmit                                         # TypeScript
cargo check --manifest-path src-tauri/Cargo.toml          # Rust
pnpm vite build                                           # Frontend bundle
```

### Run tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

### Production bundles

```bash
pnpm tauri build
```

Produces platform-native installers in `src-tauri/target/release/bundle/`:
- macOS: `.dmg`
- Windows: `.msi`
- Linux: `.deb` and `.AppImage`

## Project layout

See [`CLAUDE.md`](./CLAUDE.md) for architecture, conventions, and the recipe for adding a new git operation. Design and implementation docs live under `docs/superpowers/`.

## Contributing

Contributions welcome! See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, the
test layers, commit conventions, and the PR workflow. Please also read the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## License

Licensed under the [GNU General Public License v3.0](./LICENSE).
