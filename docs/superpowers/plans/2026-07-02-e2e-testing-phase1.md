# E2E Testing Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real end-to-end tests — real webview → real IPC → real libgit2 → real temp repos — running locally on macOS and on Linux CI, covering the Phase 1 slice (open, status, stage, commit, branch, stash, history, diff).

**Architecture:** WebdriverIO + `@wdio/tauri-service` with the embedded provider (`tauri-plugin-wdio-webdriver` registered in debug builds only). Tests live in `e2e/`, launch the debug binary, and open repos through the existing recents mechanism (seed `localStorage`, click the recent row) — no test-only code paths in the app. A Node `TempRepo` fixture shells out to `git` to build repos per test.

**Tech Stack:** WebdriverIO v9 (Mocha framework, expect-webdriverio), `@wdio/tauri-service` ^1.2, `tauri-plugin-wdio-webdriver` ^1, TypeScript, GitHub Actions (ubuntu-latest + xvfb).

**Spec:** `docs/superpowers/specs/2026-07-02-e2e-testing-design.md`

## Global Constraints

- Branch: all work on `test/e2e-phase1` (already exists, spec committed). Never commit to `main`.
- `tauri-plugin-wdio-webdriver` must never be registered in release builds — registration behind `#[cfg(debug_assertions)]`.
- No test-only code paths in app logic. Only additive `data-testid` / `data-*` attributes (and prop pass-throughs to enable them).
- E2E specs excluded from vitest and from the app `tsconfig` — they must not break `pnpm test` or `pnpm tsc --noEmit`.
- Toolchain: Node 22 + pnpm. The assistant's Bash needs `export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"` before `pnpm`/`cargo`.
- Debug binary: `pnpm tauri build --debug --no-bundle` → binary in `src-tauri/target/debug/` (cargo package name is `platypusgit`; Tauri may rename to productName `PlatypusGit` — verify with `ls` in Task 2 and set `appBinaryPath` to what actually exists).
- Native dialogs (`window.prompt` / `window.confirm`) cannot be driven by WebDriver. Tests override them via `browser.execute` before triggering (see `e2e/support/app.ts`).
- Conventional Commits; frequent small commits.

## Facts discovered during design (trust these, don't re-derive)

- Recents key: `localStorage["pg-recent-repos"]`, shape `[{ path: string, openedAt: number }]` (`src/lib/recents.ts`). Persisted screen: `localStorage["pg-screen"]`.
- AppShell renders `WelcomeScreen` until `repo` is set (`src/AppShell.tsx:252-260`); after open, activity bar + screens render. Status bar shows a "syncing…" item while `loading` (`src/AppShell.tsx:521`).
- Welcome recent row: clickable `<div>` at `src/screens/Welcome.tsx:140`, click → `openRepo(r.path)`.
- CommitPanel (`src/screens/CommitPanel.tsx`): "STAGED" header ~line 245 with "Unstage all" button; "CHANGES" header ~line 287 with "Stage all" and "Stash" buttons; staged rows `PGChangeRow` ~line 271, unstaged rows ~line 320 (checkbox toggle stages/unstages); subject `PGInput` ~line 514; body `PGTextarea` ~line 538; Commit button (`PGButton`, text "Commit") ~line 601. The "Stash" button uses `window.prompt` for the message. Empty state title "Working tree clean" ~line 222. File context menu has "Discard changes" (no confirm; calls `discard([path])`).
- `PGButton` (`src/design/primitives.tsx:37`) spreads `...rest` onto its `<button>` — `data-testid` passed as prop lands in DOM. `PGIconButton` does NOT spread rest (only `title`). `PGChangeRow` (`src/design/git-components.tsx:283`), `PGCommitRow` (`git-components.tsx:1004`), `PGFileTreeRow` (`git-components.tsx:41`), `PGHunk` (`git-components.tsx:698`) do not accept arbitrary attributes today.
- BranchChip: `<button>` at `src/features/branches/BranchChip.tsx:34`, visible branch name span at line 58-65.
- BranchPicker (`src/features/branches/BranchPicker.tsx`): portal to `document.body`; rows already have `data-branch-row` (line 158), click → checkout; search input placeholder "Switch to branch…" (line 281); create happens via empty-state span ~line 302 (`Create branch "x" from HEAD`) → `createAndSwitchBranch(name, {autoStash:true})`.
- Branches screen stash actions (`src/screens/Branches.tsx:873-905`): "Apply" / "Pop" / "Show diff" / "Drop" buttons (`PGButton`), operate on selected stash.
- History (`src/screens/History.tsx`): commit rows `PGCommitRow` ~line 260; column headers "GRAPH/SHA/SUBJECT/AUTHOR/DATE" ~lines 231-235; graph is per-row SVG inside `PGCommitRow`, not one big canvas.
- RepoBrowser (`src/screens/RepoBrowser.tsx`): file tree `PGFileTree` ~line 379; clicking a row loads inline diff; inline `PGHunk` at line 513 with working `onStage` (→ `stageHunk`) and `onDiscard` (`window.confirm` then `discardHunk`). Filter group text "All / Changes / Conflicts" proves the screen rendered.
- Activity bar buttons (`src/design/chrome.tsx:185-225`): plain icon `<button>`s with no identifying attribute; item ids: `repo, commit, history, branches, conflict, rebase, remote, diff, reflog`.
- Global error banner has `role="alert"` (`src/AppShell.tsx:223`).
- Existing spec file to keep in sync: test case 5 wording says "confirm flow" — file-level discard has no confirm dialog; Task 9 amends the spec line.

---

### Task 1: Rust plugin + capability

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs` (builder chain, ~line 14)
- Modify: `src-tauri/capabilities/default.json`

**Interfaces:**
- Produces: debug binaries expose a W3C WebDriver server (default `127.0.0.1:4445`) that `@wdio/tauri-service`'s embedded provider connects to. Release builds unchanged.

- [ ] **Step 1: Add dependency**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo add tauri-plugin-wdio-webdriver --manifest-path src-tauri/Cargo.toml
```

Plain dependency (not cfg-gated in Cargo.toml — Cargo can't gate deps on `debug_assertions`, and the crate must be compiled so its permission identifiers stay valid in the capability file). Registration is what's gated.

- [ ] **Step 2: Register plugin, debug builds only**

In `src-tauri/src/lib.rs`, the builder is one long chain. Break it to gate the plugin:

```rust
pub fn run() {
    let backend = Arc::new(Libgit2Backend::new());

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                // ... existing log plugin config unchanged ...
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init());

    // WebDriver server for E2E tests. Debug builds only.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .setup(|_app| {
            // ... existing setup unchanged ...
        })
        // ... rest of chain unchanged (.manage, .invoke_handler, .run) ...
}
```

Only restructure the chain head — everything from `.setup(` down stays byte-identical.

- [ ] **Step 3: Add permission**

In `src-tauri/capabilities/default.json`, append to `permissions`:

```json
"wdio-webdriver:default"
```

- [ ] **Step 4: Verify both build modes**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo check --release --manifest-path src-tauri/Cargo.toml
```

Expected: both pass. If the release check fails on the capability identifier, the crate isn't being compiled in release — switch to feature-flag form (`optional = true` + a `webdriver` feature enabled by default) and re-check.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(e2e): embed wdio webdriver server in debug builds"
```

---

### Task 2: WDIO scaffold + smoke launch spec (test case 1)

**Files:**
- Modify: `package.json` (devDependencies, scripts)
- Create: `e2e/wdio.conf.ts`
- Create: `e2e/tsconfig.json`
- Create: `e2e/specs/smoke.e2e.ts`
- Modify: `tsconfig.json` (exclude `e2e`)
- Modify: `vite.config.ts` (vitest exclude, only if vitest picks up `e2e/` — check first)

**Interfaces:**
- Produces: `pnpm test:e2e` (builds debug binary, runs all specs); `pnpm test:e2e:run` (runs specs against existing binary — the inner-loop command every later task uses); `e2e/wdio.conf.ts` with `specs: ['./specs/**/*.e2e.ts']`.

- [ ] **Step 1: Install dev deps**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm add -D @wdio/cli @wdio/local-runner @wdio/mocha-framework @wdio/globals @wdio/tauri-service tsx
```

- [ ] **Step 2: Build debug binary and locate it**

```bash
pnpm tauri build --debug --no-bundle
ls src-tauri/target/debug/ | grep -i platypus
```

Expected: a `platypusgit` (or `PlatypusGit`) executable. Use the actual name in the config below. Takes ~2 min first time.

- [ ] **Step 3: Read the service README for exact config keys**

```bash
sed -n 1,120p node_modules/@wdio/tauri-service/README.md
```

The config below uses `appBinaryPath` + `driverProvider: 'embedded'` per v1.2 docs. If the README shows different key names or required capabilities, follow the README — the acceptance test is Step 6, not key names.

- [ ] **Step 4: Write config + tsconfig**

`e2e/wdio.conf.ts`:

```typescript
import path from "node:path";

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  capabilities: [{}],
  services: [
    [
      "tauri",
      {
        appBinaryPath: path.resolve(
          __dirname,
          "../src-tauri/target/debug/platypusgit",
        ),
        driverProvider: "embedded",
      },
    ],
  ],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 120_000 },
  waitforTimeout: 15_000,
  connectionRetryTimeout: 60_000,
  logLevel: "warn",
  reporters: ["spec"],
};
```

(Adjust binary filename to Step 2's result. If the service README requires a named capability such as `browserName: 'tauri'`, add it.)

`e2e/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node", "@wdio/globals/types", "@wdio/mocha-framework"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true
  },
  "include": ["./**/*.ts"]
}
```

Add `"e2e"` to the `exclude` array of the root `tsconfig.json` (create the array if absent). Check vitest doesn't glob `e2e/`: `pnpm test` — if it tries to load `*.e2e.ts`, add `exclude: ['e2e/**']` to the vitest config in `vite.config.ts`.

- [ ] **Step 5: Add scripts + first spec**

`package.json` scripts:

```json
"test:e2e": "pnpm tauri build --debug --no-bundle && wdio run e2e/wdio.conf.ts",
"test:e2e:run": "wdio run e2e/wdio.conf.ts"
```

`e2e/specs/smoke.e2e.ts`:

```typescript
import { browser, $, expect } from "@wdio/globals";

describe("smoke", () => {
  it("launches and shows the Welcome screen", async () => {
    const heading = $("*=Welcome to PlatypusGit");
    await expect(heading).toBeDisplayed();
    await expect($("button=Open repository…")).toBeDisplayed();
  });
});
```

Note: the Welcome screen only renders when no repo auto-opens — a fresh app data dir has empty localStorage, so this holds. If a previous manual run left `pg-recent-repos` behind that's fine (recents don't auto-open), but `pg-screen: "settings"` would bypass Welcome — the spec clears storage in later tasks' `resetApp()`; here just be aware.

- [ ] **Step 6: Run, verify pass**

```bash
pnpm test:e2e:run
```

Expected: app window launches, 1 passing spec. This step validates the whole stack (plugin, permission, service, binary path) — budget debugging time here; consult the service README/repo issues if the session fails to connect.

- [ ] **Step 7: Type-check + unit tests still green**

```bash
pnpm tsc --noEmit && pnpm test
```

Expected: both pass (e2e excluded).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json e2e/
git commit -m "test(e2e): wdio scaffold + launch smoke spec"
```

(Include `vite.config.ts` if touched.)

---

### Task 3: TempRepo fixture + app helpers + open-repo spec (test case 2)

**Files:**
- Create: `e2e/support/tempRepo.ts`
- Create: `e2e/support/app.ts`
- Modify: `src/screens/Welcome.tsx:140` (recent row testid)
- Modify: `e2e/specs/smoke.e2e.ts` (add open-repo test)

**Interfaces:**
- Produces:
  - `class TempRepo { path: string; git(...args: string[]): string; write(rel: string, content: string): void; commitFile(rel: string, content: string, msg: string): void; dispose(): void }` and `makeTempRepo(): TempRepo` (init + user config, no commits).
  - Fixture builders: `basicRepo(): TempRepo` (3 commits on main: a.txt v1, b.txt, a.txt v2), `dirtyRepo(): TempRepo` (basic + modified `a.txt`, untracked `new.txt`, staged `staged.txt`), `branchyRepo(): TempRepo` (basic + `feature` branch with 1 commit, merged back with `--no-ff` → 5 commits total on main).
  - App helpers: `openRepo(path: string): Promise<void>` (seed recents → refresh → click row → wait loaded), `resetApp(): Promise<void>` (clear localStorage → refresh → Welcome visible), `waitRepoLoaded(): Promise<void>`, `stubNativeDialogs(opts?: { promptText?: string; confirm?: boolean }): Promise<void>`, `switchScreen(id: string): Promise<void>` (uses `data-activity` — added in Task 7; until then tests stay on default screens).

- [ ] **Step 1: Write `e2e/support/tempRepo.ts`**

```typescript
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export class TempRepo {
  readonly path: string;

  constructor() {
    this.path = mkdtempSync(path.join(tmpdir(), "pg-e2e-"));
    this.git("init", "-b", "main");
    this.git("config", "user.name", "E2E Tester");
    this.git("config", "user.email", "e2e@platypusgit.test");
    this.git("config", "commit.gpgsign", "false");
  }

  git(...args: string[]): string {
    return execFileSync("git", args, { cwd: this.path, encoding: "utf8" });
  }

  write(rel: string, content: string): void {
    const abs = path.join(this.path, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  read(rel: string): string {
    return readFileSync(path.join(this.path, rel), "utf8");
  }

  commitFile(rel: string, content: string, msg: string): void {
    this.write(rel, content);
    this.git("add", rel);
    this.git("commit", "-m", msg);
  }

  headSha(): string {
    return this.git("rev-parse", "--short", "HEAD").trim();
  }

  dispose(): void {
    rmSync(this.path, { recursive: true, force: true });
  }
}

export function basicRepo(): TempRepo {
  const r = new TempRepo();
  r.commitFile("a.txt", "alpha v1\n", "feat: add a.txt");
  r.commitFile("b.txt", "bravo\n", "feat: add b.txt");
  r.commitFile("a.txt", "alpha v2\n", "fix: update a.txt");
  return r;
}

export function dirtyRepo(): TempRepo {
  const r = basicRepo();
  r.write("a.txt", "alpha v3 dirty\n"); // modified, unstaged
  r.write("new.txt", "untracked\n"); // untracked
  r.write("staged.txt", "staged content\n");
  r.git("add", "staged.txt"); // staged new file
  return r;
}

export function branchyRepo(): TempRepo {
  const r = basicRepo();
  r.git("checkout", "-b", "feature");
  r.commitFile("feature.txt", "feature work\n", "feat: feature work");
  r.git("checkout", "main");
  r.git("merge", "--no-ff", "-m", "merge feature", "feature");
  return r; // 5 commits reachable from main, two lanes in graph
}
```

- [ ] **Step 2: Write `e2e/support/app.ts`**

```typescript
import { browser, $ } from "@wdio/globals";

export async function resetApp(): Promise<void> {
  await browser.execute(() => localStorage.clear());
  await browser.refresh();
  await $("*=Welcome to PlatypusGit").waitForDisplayed();
}

export async function waitRepoLoaded(): Promise<void> {
  // Welcome gone + repo chrome present
  await $('[data-testid="branch-chip"]').waitForDisplayed({ timeout: 20_000 });
  // initial status/log fetch done
  await browser.waitUntil(
    async () => !(await $("*=syncing…").isExisting()),
    { timeout: 20_000, timeoutMsg: "app stuck syncing" },
  );
}

export async function openRepo(repoPath: string): Promise<void> {
  await browser.execute((p: string) => {
    localStorage.clear();
    localStorage.setItem(
      "pg-recent-repos",
      JSON.stringify([{ path: p, openedAt: 1 }]),
    );
  }, repoPath);
  await browser.refresh();
  const row = $(`[data-testid="recent-repo"][data-path="${repoPath}"]`);
  await row.waitForDisplayed();
  await row.click();
  await waitRepoLoaded();
}

/** WebDriver can't drive native prompt/confirm — stub them in-page BEFORE the
 *  action that triggers them. Reset by any refresh. */
export async function stubNativeDialogs(
  opts: { promptText?: string; confirm?: boolean } = {},
): Promise<void> {
  await browser.execute(
    (promptText: string | null, confirm: boolean) => {
      (window as any).prompt = () => promptText;
      (window as any).confirm = () => confirm;
    },
    opts.promptText ?? "e2e",
    opts.confirm ?? true,
  );
}

export async function switchScreen(id: string): Promise<void> {
  await $(`[data-activity="${id}"]`).click();
}
```

Note `waitRepoLoaded` and `switchScreen` depend on attributes added in this task's Step 3 (`branch-chip`, `data-activity`); later tasks only consume them.

- [ ] **Step 3: Add testids — Welcome recent row, branch chip, activity bar**

`src/screens/Welcome.tsx` — on the recent-row `<div>` (line ~140, the one with `key={r.path}`), add:

```tsx
data-testid="recent-repo"
data-path={r.path}
```

`src/features/branches/BranchChip.tsx` — on the `<button>` (line ~34), add:

```tsx
data-testid="branch-chip"
```

`src/design/chrome.tsx` — `PGActivityBar` item `<button>` (~line 219), add:

```tsx
data-activity={it.id}
```

(Activity ids: repo, commit, history, branches, conflict, rebase, remote, diff, reflog — this powers `switchScreen()`.)

- [ ] **Step 4: Add open-repo test to `e2e/specs/smoke.e2e.ts`**

```typescript
import { browser, $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp } from "../support/app";

describe("smoke", () => {
  let repo: TempRepo | undefined;

  afterEach(async () => {
    await resetApp();
    repo?.dispose();
    repo = undefined;
  });

  it("launches and shows the Welcome screen", async () => {
    // (existing test body unchanged)
  });

  it("opens a repo via recents and shows the file tree", async () => {
    repo = basicRepo();
    await openRepo(repo.path);
    // RepoBrowser filter group proves the Files screen rendered
    await expect($("button=Changes")).toBeDisplayed();
    // branch chip shows main
    await expect($('[data-testid="branch-chip"]')).toHaveText(
      expect.stringContaining("main"),
    );
  });
});
```

If the default screen after open is not `repo` (persisted `pg-screen` was cleared by `openRepo`, default is `repo`), assert accordingly.

- [ ] **Step 5: Run e2e, then guard rails**

```bash
pnpm test:e2e   # full: rebuilds binary (testids are frontend → rebuild required)
pnpm tsc --noEmit && pnpm test
```

Expected: 2 passing e2e tests; typecheck + vitest green.

- [ ] **Step 6: Commit**

```bash
git add e2e/ src/screens/Welcome.tsx src/features/branches/BranchChip.tsx
git commit -m "test(e2e): temp-repo fixtures, app helpers, open-repo smoke"
```

---

### Task 4: Status + stage/unstage/discard spec (test cases 3–5)

**Files:**
- Modify: `src/design/git-components.tsx` (PGChangeRow: accept/forward `data-path`)
- Modify: `src/screens/CommitPanel.tsx` (list-container testids, row `data-path`)
- Create: `e2e/specs/status-stage.e2e.ts`

**Interfaces:**
- Consumes: `dirtyRepo()`, `openRepo()`, `resetApp()`, `stubNativeDialogs()` from Task 3.
- Produces: DOM contract used by later specs: `[data-testid="staged-list"]`, `[data-testid="changes-list"]` containers in CommitPanel; each `PGChangeRow` root carries `data-path="<file path>"`.

- [ ] **Step 1: Forward `data-path` through PGChangeRow**

In `src/design/git-components.tsx`, `PGChangeRow` (~line 283): add a `path`-derived data attribute on the root `<div>`. The component already receives the file path (it sets `title={path}` ~line 358). Add to the root div:

```tsx
data-path={path}
```

- [ ] **Step 2: Container testids in CommitPanel**

`src/screens/CommitPanel.tsx`: wrap-level divs that contain the staged rows (the block mapping staged files, ~line 271 context) and the unstaged rows (~line 320 context). Add `data-testid="staged-list"` on the staged section's row-list container and `data-testid="changes-list"` on the changes section's row-list container. If rows are mapped directly under the section root, put the testid on the section root — the selector contract is "rows are descendants".

- [ ] **Step 3: Write failing spec `e2e/specs/status-stage.e2e.ts`**

```typescript
import { browser, $, $$, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

const stagedRow = (p: string) =>
  $(`[data-testid="staged-list"] [data-path="${p}"]`);
const changeRow = (p: string) =>
  $(`[data-testid="changes-list"] [data-path="${p}"]`);

describe("status & staging", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("buckets modified / untracked / staged correctly", async () => {
    await expect(changeRow("a.txt")).toBeDisplayed(); // modified
    await expect(changeRow("new.txt")).toBeDisplayed(); // untracked
    await expect(stagedRow("staged.txt")).toBeDisplayed(); // staged
    await expect(stagedRow("a.txt")).not.toBeExisting();
  });

  it("stages and unstages a file via the row checkbox", async () => {
    const row = changeRow("a.txt");
    await row.$('input[type="checkbox"]').click();
    await stagedRow("a.txt").waitForDisplayed();

    await stagedRow("a.txt").$('input[type="checkbox"]').click();
    await changeRow("a.txt").waitForDisplayed();
    await expect(stagedRow("a.txt")).not.toBeExisting();
  });

  it("discards a modified file via context menu", async () => {
    await changeRow("a.txt").click({ button: "right" });
    await $("*=Discard changes").waitForDisplayed();
    await $("*=Discard changes").click();
    await browser.waitUntil(
      async () => !(await changeRow("a.txt").isExisting()),
      { timeoutMsg: "a.txt still listed after discard" },
    );
    // verify on disk: content back to committed v2
    expect(repo.read("a.txt")).toBe("alpha v2\n");
  });
});
```

If `PGCheckbox` renders no native `input[type="checkbox"]`, inspect its markup in `src/design/primitives.tsx` and target its clickable root instead (add `data-testid="row-toggle"` inside `PGChangeRow` next to the checkbox if nothing selectable exists). Same acceptance: staging toggles.

- [ ] **Step 4: Run to see it fail, wire up, re-run**

```bash
pnpm test:e2e:run    # fails: selectors missing (frontend not rebuilt yet)
pnpm test:e2e        # rebuild + run — expected: 5 passing (2 smoke + 3 here)
```

- [ ] **Step 5: Guard rails + commit**

```bash
pnpm tsc --noEmit && pnpm test
git add src/design/git-components.tsx src/screens/CommitPanel.tsx e2e/specs/status-stage.e2e.ts
git commit -m "test(e2e): status buckets, stage/unstage, discard"
```

---

### Task 5: Commit spec (test case 6)

**Files:**
- Modify: `src/screens/CommitPanel.tsx` (commit button + subject input testids)
- Create: `e2e/specs/commit.e2e.ts`

**Interfaces:**
- Consumes: row selectors from Task 4, helpers from Task 3.
- Produces: `[data-testid="commit-button"]`, `[data-testid="commit-subject"]`.

- [ ] **Step 1: Testids**

`src/screens/CommitPanel.tsx`:
- Commit `PGButton` (~line 601, the one whose text is "Commit"/"Amend"): add `data-testid="commit-button"` (PGButton spreads rest — lands on the `<button>`).
- Subject `PGInput` (~line 514): pass `data-testid="commit-subject"`. If `PGInput` doesn't spread rest onto its `<input>` (check `src/design/primitives.tsx`), add rest-spreading to `PGInput`'s `<input>` — additive, safe.

- [ ] **Step 2: Write spec `e2e/specs/commit.e2e.ts`**

```typescript
import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

describe("commit", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("commits staged changes; status clean after staging all", async () => {
    await $("button=Stage all").click();
    await browser.waitUntil(async () =>
      !(await $('[data-testid="changes-list"] [data-path]').isExisting()),
    );

    await $('[data-testid="commit-subject"]').setValue("feat: e2e commit");
    await $('[data-testid="commit-button"]').click();

    // panel returns to clean state
    await $("*=Working tree clean").waitForDisplayed({ timeout: 20_000 });

    // repo truth: new HEAD commit with our message, clean tree
    expect(repo.git("log", "-1", "--pretty=%s")).toContain("feat: e2e commit");
    expect(repo.git("status", "--porcelain").trim()).toBe("");
  });
});
```

- [ ] **Step 3: Run + verify**

```bash
pnpm test:e2e
```

Expected: 6 passing.

- [ ] **Step 4: Guard rails + commit**

```bash
pnpm tsc --noEmit && pnpm test
git add src/screens/CommitPanel.tsx e2e/specs/commit.e2e.ts
git commit -m "test(e2e): commit flow"
```

(Also `src/design/primitives.tsx` if PGInput needed rest-spreading.)

---

### Task 6: Branch spec (test case 7)

**Files:**
- Modify: `src/features/branches/BranchPicker.tsx` (create-branch affordance testid)
- Create: `e2e/specs/branches.e2e.ts`

**Interfaces:**
- Consumes: `[data-testid="branch-chip"]` (Task 3), `[data-branch-row]` (already in BranchPicker).
- Produces: `[data-testid="branch-create"]`.

- [ ] **Step 1: Testid on create affordance**

`src/features/branches/BranchPicker.tsx` — the empty-state `<span onClick>` (~line 302, text `Create branch "x" from HEAD`): add `data-testid="branch-create"`.

- [ ] **Step 2: Write spec `e2e/specs/branches.e2e.ts`**

```typescript
import { browser, $, expect } from "@wdio/globals";
import { basicRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp } from "../support/app";

describe("branches", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = basicRepo();
    await openRepo(repo.path);
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("creates a branch via picker, chip updates, checkout back works", async () => {
    const chip = $('[data-testid="branch-chip"]');

    // create + switch
    await chip.click();
    const search = $('input[placeholder="Switch to branch…"]');
    await search.waitForDisplayed();
    await search.setValue("e2e-branch");
    await $('[data-testid="branch-create"]').waitForDisplayed();
    await $('[data-testid="branch-create"]').click();
    await browser.waitUntil(
      async () => (await chip.getText()).includes("e2e-branch"),
      { timeoutMsg: "chip did not update to new branch" },
    );
    expect(repo.git("branch", "--show-current").trim()).toBe("e2e-branch");

    // checkout main again via picker row
    await chip.click();
    await $('[data-branch-row="local:main"]').waitForDisplayed();
    await $('[data-branch-row="local:main"]').click();
    await browser.waitUntil(async () => (await chip.getText()).includes("main"));
    expect(repo.git("branch", "--show-current").trim()).toBe("main");
  });
});
```

`data-branch-row` value format: the row is keyed `` `${kind}:${name}` `` (BranchPicker.tsx:156-159) — verify whether the attribute carries that value or is bare. If bare (`data-branch-row` with no value), select by row text instead: `$('[data-branch-row]*=main')`. Acceptance unchanged.

- [ ] **Step 3: Run + verify**

```bash
pnpm test:e2e
```

Expected: 7 passing.

- [ ] **Step 4: Guard rails + commit**

```bash
pnpm tsc --noEmit && pnpm test
git add src/features/branches/BranchPicker.tsx e2e/specs/branches.e2e.ts
git commit -m "test(e2e): branch create/checkout via picker"
```

---

### Task 7: Stash spec (test case 8)

**Files:**
- Create: `e2e/specs/stash.e2e.ts`

**Interfaces:**
- Consumes: `stubNativeDialogs()` (CommitPanel "Stash" button uses `window.prompt`), `switchScreen()` + `[data-activity]` from Task 3, Branches-screen stash buttons ("Pop") from `src/screens/Branches.tsx:884`.

- [ ] **Step 1: Write spec `e2e/specs/stash.e2e.ts`**

```typescript
import { browser, $, expect } from "@wdio/globals";
import { dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, stubNativeDialogs, switchScreen } from "../support/app";

describe("stash", () => {
  let repo: TempRepo;

  beforeEach(async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    await switchScreen("commit");
  });

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("stash save cleans the tree; pop restores it", async () => {
    await stubNativeDialogs({ promptText: "e2e stash" });
    await $("button=Stash").click();
    await $("*=Working tree clean").waitForDisplayed({ timeout: 20_000 });
    expect(repo.git("stash", "list")).toContain("e2e stash");

    // pop from Branches screen stash section
    await switchScreen("branches");
    const stashRow = $("*=stash@{0}");
    await stashRow.waitForDisplayed();
    await stashRow.click();
    await $("button=Pop").click();

    await switchScreen("commit");
    await $('[data-testid="changes-list"] [data-path="a.txt"]').waitForDisplayed(
      { timeout: 20_000 },
    );
    expect(repo.git("stash", "list").trim()).toBe("");
  });
});
```

Note: `dirtyRepo` has a staged file; CommitPanel's stash uses `keepIndex: false, includeUntracked: true`, so everything stashes. If "Working tree clean" doesn't appear because staged content behaves differently, assert via `repo.git("status", "--porcelain")` being empty instead — repo truth is the acceptance, UI text is the wait condition.

- [ ] **Step 2: Run + verify**

```bash
pnpm test:e2e:run
```

Expected: 8 passing (spec-only change — no rebuild needed).

- [ ] **Step 3: Commit**

```bash
git add e2e/specs/stash.e2e.ts
git commit -m "test(e2e): stash save and pop"
```

---

### Task 8: History + diff spec (test cases 9–10)

**Files:**
- Modify: `src/design/git-components.tsx` (PGCommitRow root: `data-testid` + `data-sha`; PGHunk stage button: testid)
- Modify: `src/screens/History.tsx` (pass sha to row if not already a prop — it is: `sha` prop exists)
- Create: `e2e/specs/history-diff.e2e.ts`

**Interfaces:**
- Consumes: `branchyRepo()`, `dirtyRepo()`, helpers.
- Produces: `[data-testid="commit-row"]` (with `data-sha`), `[data-testid="hunk-stage"]`.

- [ ] **Step 1: Testids in design components**

`src/design/git-components.tsx`:
- `PGCommitRow` (~line 1004): on the root element add `data-testid="commit-row"` and `data-sha={sha}` (component already receives `sha`).
- `PGHunk` (~line 698): on the stage button (~line 732, label "Stage hunk"/"Staged") add `data-testid="hunk-stage"`. If it's a `PGButton`, pass the prop through; if `PGIconButton`, target by existing text `button=Stage hunk` instead and skip the testid.

- [ ] **Step 2: Write spec `e2e/specs/history-diff.e2e.ts`**

```typescript
import { browser, $, $$, expect } from "@wdio/globals";
import { branchyRepo, dirtyRepo, TempRepo } from "../support/tempRepo";
import { openRepo, resetApp, switchScreen } from "../support/app";

describe("history & diff", () => {
  let repo: TempRepo;

  afterEach(async () => {
    await resetApp();
    repo.dispose();
  });

  it("renders one row per commit with graph markup on a branchy repo", async () => {
    repo = branchyRepo();
    await openRepo(repo.path);
    await switchScreen("history");

    await $("*=SUBJECT").waitForDisplayed(); // column headers = screen ready
    const expected = Number(repo.git("rev-list", "--count", "HEAD").trim()); // 5
    await browser.waitUntil(
      async () => (await $$('[data-testid="commit-row"]').length) === expected,
      { timeoutMsg: `expected ${expected} commit rows` },
    );
    // graph geometry rendered inside rows
    await expect($('[data-testid="commit-row"] svg')).toBeExisting();
    // merge commit present
    await expect($("*=merge feature")).toBeDisplayed();
  });

  it("shows a hunk for a modified file and stages it", async () => {
    repo = dirtyRepo();
    await openRepo(repo.path);
    // Files screen renders inline diff on row click
    await switchScreen("repo");
    await $("span=a.txt").waitForDisplayed();
    await $("span=a.txt").click();

    const stageBtn = $('[data-testid="hunk-stage"]');
    await stageBtn.waitForDisplayed();
    await stageBtn.click();

    await browser.waitUntil(
      async () => repo.git("diff", "--cached", "--name-only").includes("a.txt"),
      { timeoutMsg: "hunk stage did not reach the index" },
    );
  });
});
```

`span=a.txt` may match the FILE INFO panel or tree row — if ambiguous, scope it: `$('[data-testid="changes-list"] …')` doesn't exist on this screen, so use the tree: give `PGFileTreeRow` root a `data-path` the same way as PGChangeRow (one-line addition in `git-components.tsx:41` region) and select `[data-path="a.txt"]`. Prefer that if the bare text selector proves flaky.

- [ ] **Step 3: Run + verify**

```bash
pnpm test:e2e
```

Expected: 10 passing.

- [ ] **Step 4: Guard rails + commit**

```bash
pnpm tsc --noEmit && pnpm test
git add src/design/git-components.tsx e2e/specs/history-diff.e2e.ts
git commit -m "test(e2e): history graph rows, hunk staging"
```

(Include `src/screens/History.tsx` only if a prop needed threading.)

---

### Task 9: CI workflow

**Files:**
- Create: `.github/workflows/e2e.yml`
- Modify: `docs/superpowers/specs/2026-07-02-e2e-testing-design.md` (test case 5 wording)

**Interfaces:**
- Consumes: `pnpm test:e2e` script chain from Task 2.

- [ ] **Step 1: Write workflow**

```yaml
name: e2e

on:
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: e2e-${{ github.ref }}
  cancel-in-progress: true

jobs:
  e2e-linux:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - name: Install Tauri system deps
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev \
            libayatana-appindicator3-dev librsvg2-dev patchelf xvfb

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Configure git for fixtures
        run: |
          git config --global user.name "CI"
          git config --global user.email "ci@platypusgit.test"
          git config --global init.defaultBranch main

      - name: Build debug binary
        run: pnpm tauri build --debug --no-bundle

      - name: Run E2E
        run: xvfb-run --auto-servernum pnpm test:e2e:run
```

Fixture git config note: `TempRepo` sets local user config itself, but global `init.defaultBranch` avoids `git init -b main` failing on ancient git (ubuntu-latest git is modern; keep anyway — harmless).

- [ ] **Step 2: Amend spec wording (discovered during planning)**

In `docs/superpowers/specs/2026-07-02-e2e-testing-design.md`, test case 5, replace:

```
5. Discard a modified file → confirm flow → change gone on disk.
```

with:

```
5. Discard a modified file via the file context menu → change gone on disk.
   (File-level discard has no confirm dialog; hunk-level discard's native
   confirm is stubbed via window.confirm override.)
```

- [ ] **Step 3: Commit + push + verify CI**

```bash
git add .github/workflows/e2e.yml docs/superpowers/specs/2026-07-02-e2e-testing-design.md
git commit -m "ci(e2e): run wdio suite on PRs"
git push -u origin test/e2e-phase1
gh run watch --repo jonassaa/platypusgit $(gh run list --branch test/e2e-phase1 --workflow e2e --limit 1 --json databaseId -q '.[0].databaseId')
```

Expected: e2e workflow green on the branch's PR (open the PR in Task 10 first if push alone doesn't trigger — workflow triggers on `pull_request`, so open PR then watch). Debug Linux-only failures here (xvfb, missing system libs, timing).

---

### Task 10: Docs + PR

**Files:**
- Modify: `CLAUDE.md` (Testing section)

- [ ] **Step 1: Update CLAUDE.md Testing section**

Replace the final paragraph of the Testing section (the one starting "Full webview-level E2E (WebdriverIO + `tauri-driver`) is not wired up…") with:

```markdown
- **E2E (webview-level)** — `pnpm test:e2e` builds a debug binary and runs
  WebdriverIO specs in `e2e/` against the real app (real IPC, real libgit2,
  temp repos built by `e2e/support/tempRepo.ts`). Works on macOS via the
  embedded WebDriver provider (`tauri-plugin-wdio-webdriver`, debug builds
  only) and on Linux CI (`.github/workflows/e2e.yml`, xvfb). Inner loop:
  `pnpm test:e2e:run` reuses the existing binary — rebuild first if Rust or
  frontend changed. Native dialogs can't be driven: stub `window.prompt`/
  `window.confirm` via `stubNativeDialogs()`. Selector contract: `data-testid`
  attributes added sparingly (recent-repo, branch-chip, staged-list/
  changes-list + row `data-path`, commit-subject, commit-button,
  branch-create, commit-row, hunk-stage) plus `data-activity` on the
  activity bar.
```

Also add to the three-layer intro sentence: "Three layers" → "Four layers".

- [ ] **Step 2: Full verification sweep**

```bash
pnpm tsc --noEmit && pnpm test
cargo check --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:e2e
```

Expected: everything green, 10 e2e tests passing.

- [ ] **Step 3: Commit docs, open PR**

```bash
git add CLAUDE.md
git commit -m "docs: document e2e test layer"
git push
gh pr create --title "test(e2e): webview end-to-end suite, phase 1" --body "$(cat <<'EOF'
## Summary
- Adds real end-to-end tests: WebdriverIO + @wdio/tauri-service (embedded provider), launching the debug binary and driving the real webview → real IPC → real libgit2 against temp repos.
- `tauri-plugin-wdio-webdriver` registered in debug builds only; release binaries unchanged.
- Repo-open seam: seed `pg-recent-repos` in localStorage, click the recent row — no test-only code paths.
- 10 tests: launch/welcome, open repo, status buckets, stage/unstage, discard, commit, branch create/checkout, stash save/pop, history graph rows, hunk staging.
- New CI job `.github/workflows/e2e.yml` (ubuntu + xvfb) on PRs.
- Sparse `data-testid`/`data-*` attributes added where text selectors were brittle.

Spec: `docs/superpowers/specs/2026-07-02-e2e-testing-design.md`
Plan: `docs/superpowers/plans/2026-07-02-e2e-testing-phase1.md`

## Test plan
- [ ] `pnpm test:e2e` — 10 passing locally (macOS/WKWebView)
- [ ] e2e workflow green on this PR (Linux/WebKitGTK)
- [ ] `pnpm tsc --noEmit`, `pnpm test`, `cargo test` all green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Rebase onto latest `origin/main` before merging; squash-merge per CLAUDE.md workflow.

---

## Execution notes

- **Order matters:** Tasks 1→2 are the risk spike (embedded provider working at all). If Task 2 Step 6 can't be made green after real debugging effort, STOP and report — fallback decision (CrabNebula provider / Linux-only) is the user's call per spec.
- **Rebuild discipline:** frontend or Rust change → `pnpm test:e2e` (rebuild). Spec-only change → `pnpm test:e2e:run`.
- **Line numbers** in this plan come from a scan on 2026-07-02; treat them as anchors, not gospel — match on the described element.
- **Flakiness rule:** never `pause()`; always `waitUntil`/`waitForDisplayed` with a message. Repo truth (`repo.git(...)`) is the acceptance criterion wherever possible; UI text is the wait condition.
