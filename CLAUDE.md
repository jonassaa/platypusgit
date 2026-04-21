# CLAUDE.md

Context for future Claude sessions working on this repo. Keep it current when architecture or conventions change.

## What this is

`platypusgit` — a cross-platform, developer-focused git desktop app. Tauri 2 (Rust) backend + React/TS frontend. Positioned as a dev-first TortoiseGit alternative with "extreme usability" as the north star. Standalone GUI only — shell integration (Finder/Explorer overlays) is explicitly out of scope.

## Canonical references

- **Spec:** `docs/superpowers/specs/2026-04-21-platypusgit-scaffold-design.md` — approved design for the initial scaffold.
- **Plan:** `docs/superpowers/plans/2026-04-21-platypusgit-scaffold.md` — 23-task implementation plan.

When adding a feature beyond the MVP slice, write a new spec + plan under these folders.

## Toolchain

- **Node 22** + **pnpm** (installed at `~/Library/pnpm`). Not `npm`, not `yarn`.
- **Rust stable** via rustup (`~/.cargo/bin`).
- Shell calls from the assistant's Bash tool don't inherit interactive shell rc — prepend `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` when running `pnpm` or `cargo`.

## Common commands

```bash
pnpm install                                # frontend + tauri-cli deps
pnpm tauri dev                              # run the app (first build ~2 min, reruns ~10s)
pnpm tsc --noEmit                           # type-check
pnpm vite build                             # bundle frontend only
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build                            # production bundle (.msi/.dmg/.deb/.AppImage)
```

## Architecture

```
src-tauri/src/
├── error.rs            AppError enum (thiserror + serde-tagged) — the ONLY error type crossing IPC
├── state.rs            AppState { backend: Arc<dyn GitBackend> }
├── git/
│   ├── mod.rs          GitBackend trait — all git operations, returning AppResult<T>
│   ├── types.rs        RepoHandle, FileStatus, StatusFlag, CommitInfo, BranchInfo, DiffKind, etc.
│   ├── libgit2.rs      Libgit2Backend — the active impl (open + status real; others NotImplemented)
│   └── cli.rs          CliBackend — stub for ops libgit2 handles poorly (LFS, creds, complex merges)
└── commands/           Thin Tauri command handlers, one file per feature area
    ├── repo.rs         open_repo, get_status (REAL)
    ├── commits.rs      get_log, commit (stubs)
    ├── diff.rs         get_diff, stage_paths, unstage_paths (stubs)
    └── branches.rs     list_branches, checkout_branch, create_branch, fetch, pull, push (stubs)

src/
├── lib/
│   ├── tauri.ts        Typed invoke() wrappers — frontend NEVER calls invoke() directly
│   ├── types.ts        Shared types mirroring Rust types.rs
│   └── errors.ts       AppError discriminated union matching Rust enum 1:1
├── features/<area>/    Per-feature folders: components + Zustand store colocated
├── components/ui/      Shared primitives (Button today; add more here)
├── App.tsx             Minimal shell: header, empty state, error banner, <StatusList>
└── store.ts            Re-export hub (keep thin — no global Zustand store composition)
```

## Conventions

### Errors
- **Rust side:** everything crossing IPC returns `AppResult<T> = Result<T, AppError>`. Never unwrap/panic in a command. Add new error variants to `AppError` rather than stringifying.
- **TS side:** the `AppError` union in `src/lib/errors.ts` must stay 1:1 with the Rust enum. When you add a Rust variant, update TS in the same commit.
- Tauri serializes `Err(AppError)` as `{ kind, message }` via `#[serde(tag = "kind", content = "message")]`. Consumers narrow via the `kind` discriminant.

### Adding a new git operation (standard path)
1. Add method to `GitBackend` trait (`src-tauri/src/git/mod.rs`).
2. Implement in `Libgit2Backend` (`libgit2.rs`). Stub in `CliBackend` too (return `NotImplemented`) — keeps the trait shape exercised.
3. Write the Tauri command in the right `commands/<area>.rs` — keep it thin; wrap git2 calls in `tokio::task::spawn_blocking` (libgit2 is sync).
4. Register the command name in `invoke_handler![…]` in `src-tauri/src/lib.rs`.
5. Add the TS type to `src/lib/types.ts`, the wrapper to `src/lib/tauri.ts`.
6. Wire into the relevant feature's Zustand store.

### State management
- **Zustand per-feature**, not one big global store. `useRepoStore` lives in `features/repo/` because that's who owns the state.
- Cross-feature state is rare in this app — if it emerges, compose in `src/store.ts`, don't hoist prematurely.

### Async / threading (Rust)
- `git2::Repository` is `Send` but not `Sync`. `Libgit2Backend` holds each opened repo as `Mutex<Repository>` inside a `Mutex<HashMap<RepoId, ...>>`.
- Always wrap git2 work in `spawn_blocking` from tauri commands — don't block the async runtime.

### Styling
- Tailwind v4 (CSS-first config). Theme tokens in `src/index.css` under `@theme { … }`. Use the CSS vars (`var(--color-accent)`) or Tailwind arbitrary-value syntax (`text-[var(--color-accent)]`).
- No `tailwind.config.js` — v4 doesn't need one for this project.

### Permissions (Tauri 2)
- All permissions live in `src-tauri/capabilities/default.json`. Current set: `core:default`, `dialog:default`, `dialog:allow-open`.
- Adding a new plugin means: `cargo add tauri-plugin-X`, `pnpm add @tauri-apps/plugin-X`, register with `.plugin(tauri_plugin_X::init())` in `lib.rs`, add the plugin's permissions to the capability file.

### Path aliases
- `@/` → `src/` in both `tsconfig.json` and `vite.config.ts`. Use it — `@/features/repo/...` beats `../../features/repo/...`.

## Things that are deliberately NOT in the codebase

- Shell integration / Finder / Explorer overlays (out of scope).
- Tests beyond the libgit2 smoke test (add tests alongside each feature as you build it).
- CI config.
- Custom icons — using the Tauri defaults. Replace before first release.
- Code signing config for bundles.

## Known placeholders

- **Bundle identifier** in `src-tauri/tauri.conf.json` is `com.platypusgit.app` — a placeholder. The user will finalize it; changing it later orphans installed instances, so don't auto-change without asking.

## Commit style

Follow the existing log:
- `feat: …` / `test: …` / `docs: …` / `chore: …`
- Short imperative subject (under 72 chars).
- Optional body with **Why:** for non-obvious decisions.
- Trailing `Co-Authored-By: Claude …` when the assistant drove the commit.

Do not create empty / merge commits; do not amend published commits without asking.
