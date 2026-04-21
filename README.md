# platypusgit

A cross-platform, developer-focused git desktop app. Tauri 2 + React + TypeScript.

Status: **early scaffold** — one working vertical slice (open a repository, list working-tree status). Commits, diff, staging, branches, and remote ops are stubbed.

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
