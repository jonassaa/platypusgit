# platypusgit — Initial Scaffold Design

**Status:** Approved 2026-04-21
**Scope:** Project scaffold + one end-to-end vertical slice (open repo, list status). All other MVP features are stubbed with trait/command shape but not implemented.

## Goals

1. Greenfield Tauri 2 + React + TS + Tailwind v4 project, pnpm-managed.
2. Cross-platform bundler config (Windows .msi, macOS .dmg, Linux .deb + AppImage).
3. Rust backend structured for a `GitBackend` trait so a libgit2 impl can coexist with a future CLI-backed impl.
4. Typed error path from Rust to TS — no stringified panics across the IPC boundary.
5. One working vertical slice — folder picker → git2 status read → rendered list — to prove the full pipe.

## Non-goals (this spec)

- Shell integration / Explorer / Finder overlays.
- Commit, diff, stage, branch, fetch/pull/push behavior (stubs only).
- Tests, CI, code signing, custom icons.
- Multi-repo / tabs / workspace concepts.

## Tech decisions

| Choice | Value | Reason |
|---|---|---|
| Package manager | pnpm | User-selected; efficient, Tauri-examples use it. |
| Tailwind | v4 | User-selected; stable, CSS-first config via `@theme`. |
| Bundle identifier | `com.platypusgit.app` (placeholder) | User will finalize later; marked with `TODO`. |
| State | Zustand, per-feature stores | Simple, no provider ceremony. |
| Icons | lucide-react | User-specified. |
| Rust async | tokio, `spawn_blocking` for git2 calls | libgit2 is sync; don't block Tauri's async runtime. |
| Error model | `thiserror` enum, serde-tagged | Typed errors on both sides of IPC. |

## Directory layout

```
platypusgit/
├── package.json
├── pnpm-lock.yaml
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
├── .gitignore
├── docs/
│   └── superpowers/specs/           # this file lives here
├── src/                             # frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                    # @import "tailwindcss"
│   ├── lib/
│   │   ├── tauri.ts                 # typed invoke() wrappers
│   │   └── errors.ts                # AppError discriminated union
│   ├── components/ui/
│   │   └── Button.tsx
│   ├── features/
│   │   ├── repo/                    # REAL
│   │   │   ├── OpenRepoButton.tsx
│   │   │   ├── StatusList.tsx
│   │   │   └── useRepoStore.ts
│   │   ├── commits/                 # stubs
│   │   ├── diff/                    # stubs
│   │   └── branches/                # stubs
│   └── store.ts
└── src-tauri/
    ├── Cargo.toml
    ├── tauri.conf.json
    ├── build.rs
    ├── capabilities/default.json
    ├── icons/                        # default Tauri icons
    └── src/
        ├── main.rs
        ├── lib.rs
        ├── error.rs                  # AppError via thiserror
        ├── state.rs                  # AppState holding Arc<dyn GitBackend>
        ├── git/
        │   ├── mod.rs                # pub trait GitBackend
        │   ├── libgit2.rs            # REAL impl
        │   ├── cli.rs                # stub impl (todo!())
        │   └── types.rs              # FileStatus, CommitInfo, RepoHandle
        └── commands/
            ├── mod.rs
            ├── repo.rs               # open_repo, get_status (REAL)
            ├── commits.rs            # stubs
            ├── diff.rs                # stubs
            └── branches.rs           # stubs
```

## Rust backend design

### `GitBackend` trait

Declared in `src-tauri/src/git/mod.rs`. Every current and future MVP operation is a method, returning `Result<T, AppError>`. Methods for unimplemented operations return `Err(AppError::NotImplemented)` from the trait's current `Libgit2Backend` impl rather than `todo!()` — this keeps the process alive if the frontend accidentally calls an unready command.

Surface (MVP-relevant subset):

```rust
pub trait GitBackend: Send + Sync {
    fn open(&self, path: &Path) -> Result<RepoHandle, AppError>;
    fn status(&self, repo_id: &RepoId) -> Result<Vec<FileStatus>, AppError>;
    fn log(&self, repo_id: &RepoId, limit: usize) -> Result<Vec<CommitInfo>, AppError>;
    fn diff(&self, repo_id: &RepoId, path: &Path, kind: DiffKind) -> Result<DiffHunks, AppError>;
    fn stage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> Result<(), AppError>;
    fn unstage(&self, repo_id: &RepoId, paths: &[PathBuf]) -> Result<(), AppError>;
    fn commit(&self, repo_id: &RepoId, opts: CommitOptions) -> Result<Oid, AppError>;
    fn branches(&self, repo_id: &RepoId) -> Result<Vec<BranchInfo>, AppError>;
    fn checkout_branch(&self, repo_id: &RepoId, name: &str) -> Result<(), AppError>;
    fn create_branch(&self, repo_id: &RepoId, name: &str, from: Option<&str>) -> Result<(), AppError>;
    fn fetch(&self, repo_id: &RepoId, remote: &str) -> Result<(), AppError>;
    fn pull(&self, repo_id: &RepoId, remote: &str, branch: &str) -> Result<(), AppError>;
    fn push(&self, repo_id: &RepoId, remote: &str, branch: &str) -> Result<(), AppError>;
}
```

### State

`AppState` (in `state.rs`) holds:
- `backend: Arc<dyn GitBackend>` — single backend instance, shared via `tauri::State`.
- `repos: Mutex<HashMap<RepoId, OpenRepo>>` — opened repositories by id. `OpenRepo` wraps a `git2::Repository` behind a mutex since `git2::Repository` is not `Sync`.

`RepoId` is a newtype around `Uuid`, generated on `open()`.

### Error model

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
    #[error("path is not a git repository: {0}")]
    NotARepo(String),
    #[error("repository not found: {0}")]
    UnknownRepo(String),
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("git error: {0}")]
    Git(String),
    #[error("not implemented")]
    NotImplemented,
    #[error("internal error: {0}")]
    Internal(String),
}
```

`From<git2::Error>` and `From<std::io::Error>` conversions included. Tauri commands return `Result<T, AppError>` — Tauri serializes `Err(AppError)` as `{ kind, message }` to the frontend.

### Commands

In `commands/repo.rs`:

```rust
#[tauri::command]
pub async fn open_repo(state: State<'_, AppState>, path: String) -> Result<RepoHandle, AppError>;

#[tauri::command]
pub async fn get_status(state: State<'_, AppState>, repo_id: String) -> Result<Vec<FileStatus>, AppError>;
```

Both wrap their git2 work in `tokio::task::spawn_blocking`. Commands are thin — they validate inputs, dispatch to the backend, translate errors, and return.

Other command modules (`commits.rs`, `diff.rs`, `branches.rs`) have function signatures registered in `invoke_handler` but bodies return `Err(AppError::NotImplemented)`.

### `FileStatus` type

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct FileStatus {
    pub path: String,
    pub worktree: StatusFlag,  // vs index
    pub index: StatusFlag,     // vs HEAD
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind")]
pub enum StatusFlag {
    Unmodified,
    Modified,
    Added,
    Deleted,
    Renamed,
    Typechange,
    Untracked,
    Ignored,
    Conflicted,
}
```

Both worktree and index flags are surfaced separately so the UI can distinguish "staged modified / unstaged modified" later. For MVP the list just shows the worktree flag; staging UI will use index flag in a later phase.

## Frontend design

### IPC layer (`src/lib/tauri.ts`)

One typed function per Rust command. Example:

```ts
import { invoke } from "@tauri-apps/api/core";
import { AppError } from "./errors";

export async function openRepo(path: string): Promise<RepoHandle> {
  return invoke<RepoHandle>("open_repo", { path });
}

export async function getStatus(repoId: string): Promise<FileStatus[]> {
  return invoke<FileStatus[]>("get_status", { repoId });
}
```

Tauri rejects promises with the serialized `AppError` object. Consumers catch and narrow via the `kind` discriminant.

### Error types (`src/lib/errors.ts`)

Discriminated union matching the Rust enum 1:1:

```ts
export type AppError =
  | { kind: "NotARepo"; message: string }
  | { kind: "UnknownRepo"; message: string }
  | { kind: "InvalidPath"; message: string }
  | { kind: "Io"; message: string }
  | { kind: "Git"; message: string }
  | { kind: "NotImplemented"; message: string }
  | { kind: "Internal"; message: string };

export function isAppError(e: unknown): e is AppError { /* ... */ }
```

### State (Zustand)

Per-feature stores. `useRepoStore` in `features/repo/useRepoStore.ts` holds:

```ts
interface RepoState {
  current: RepoHandle | null;
  status: FileStatus[];
  loading: boolean;
  error: AppError | null;
  openRepo: (path: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
}
```

`src/store.ts` just re-exports — no global composition needed yet.

### UI

- `App.tsx`: header with "Open repository" button + repo path display. Main pane: if repo open → `<StatusList>`; else → empty-state card.
- `OpenRepoButton.tsx`: calls `@tauri-apps/plugin-dialog` `open({ directory: true })`, then `useRepoStore.openRepo(selectedPath)`.
- `StatusList.tsx`: reads `status` from store; renders each entry as a row with a lucide icon + path + Tailwind-colored badge. No interactions.
- Error state: a small red banner above the list when `error` is set.

## Step-5 end-to-end slice

User-visible flow:

1. Launch app → empty state with "Open repository" button.
2. Click → native folder picker (via dialog plugin).
3. Pick a directory → `openRepo` invoked.
4. Rust: `Libgit2Backend::open` runs `git2::Repository::open`, stores under a new `RepoId`, returns `RepoHandle { id, path, head }`.
5. Store updates `current`, then calls `getStatus(id)`.
6. Rust: `statuses()` with default options, mapped to `Vec<FileStatus>`, returned.
7. UI renders list.

Error paths covered: picker cancelled (no-op), path not a repo (`NotARepo` → red banner), any libgit2 error (`Git` variant → red banner).

## Tauri configuration

`src-tauri/tauri.conf.json` key fields:

- `identifier`: `"com.platypusgit.app"` (placeholder, TODO comment)
- `productName`: `"platypusgit"`
- `bundle.targets`: `["msi", "dmg", "deb", "appimage"]`
- `bundle.category`: `"DeveloperTool"`
- `bundle.macOS.minimumSystemVersion`: `"10.15"`
- `bundle.windows.wix`: default, per-user install scope
- Window: 1200x800, resizable, min 800x600

Permissions (`capabilities/default.json`): `core:default`, `dialog:allow-open`, no filesystem plugin needed for MVP (git2 reads paths directly).

## Dependencies

### Cargo.toml

- `tauri = { version = "2", features = [] }`
- `tauri-plugin-dialog = "2"`
- `serde = { version = "1", features = ["derive"] }`
- `serde_json = "1"`
- `thiserror = "1"`
- `tokio = { version = "1", features = ["rt-multi-thread", "macros"] }`
- `git2 = "0.19"`
- `uuid = { version = "1", features = ["v4", "serde"] }`

### package.json (runtime)

- `react`, `react-dom` (v18)
- `@tauri-apps/api` v2
- `@tauri-apps/plugin-dialog` v2
- `zustand`
- `lucide-react`

### package.json (dev)

- `@tauri-apps/cli` v2
- `@vitejs/plugin-react`
- `@tailwindcss/vite` (Tailwind v4)
- `tailwindcss` v4
- `typescript`, `vite`
- `@types/react`, `@types/react-dom`

## Verification plan

1. `pnpm install` — succeeds, lockfile written.
2. `cargo check --manifest-path src-tauri/Cargo.toml` — no errors.
3. `pnpm tsc --noEmit` — no type errors.
4. `pnpm tauri dev` — window launches. In the running app, click "Open repository", pick `/Users/jonas/dev/fun/platypusgit` itself (or another real repo), confirm the status list renders rows matching `git status --porcelain`.

Success criteria: all four steps pass and the status list shows at least one entry matching `git status` output in an active repo.

## Out of scope / deferred

| Item | Phase |
|---|---|
| Commits / log view | MVP-next |
| Diff viewer | MVP-next |
| Stage/unstage hunks | MVP-next |
| Commit dialog | MVP-next |
| Branches checkout/create | MVP-next |
| Fetch/pull/push + progress | MVP-next |
| CLI-backed GitBackend impl | Post-MVP |
| Shell integration (Finder/Explorer) | Post-MVP |
| Tests, CI | Before first release |
| Code signing, custom icons | Before first release |
