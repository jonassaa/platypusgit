# Native Window Titlebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the in-app `PGTitlebar` stripe with a native OS window titlebar that hosts the repo chip, branch chip, and fetch/pull/push actions — native traffic lights on macOS, custom min/max/close on Windows & Linux.

**Architecture:** On macOS set `titleBarStyle: "Overlay"` + `hiddenTitle: true` so the OS draws traffic lights over our web content; the titlebar root gets an 80px left shim. On Windows/Linux set `decorations: false` and render our own caption buttons on the far right using `@tauri-apps/api/window`. Platform detected once at mount via `@tauri-apps/plugin-os`. Drag region provided by `data-tauri-drag-region` on the titlebar root and its flex spacer.

**Tech Stack:** Tauri 2, React 18, TypeScript, Vitest, Testing Library, `@tauri-apps/plugin-os`, `@tauri-apps/api/window`.

Spec: `docs/superpowers/specs/2026-04-24-native-titlebar-design.md`.

---

## File map

- Modify `src-tauri/Cargo.toml` — add `tauri-plugin-os`.
- Modify `src-tauri/src/lib.rs` — register `tauri_plugin_os::init()`.
- Modify `src-tauri/capabilities/default.json` — add os + window permissions.
- Modify `src-tauri/tauri.conf.json` — window decorations / titleBarStyle / hiddenTitle / minimumSystemVersion.
- Modify `package.json` — add `@tauri-apps/plugin-os`.
- Modify `src/test/setup.ts` — mock `@tauri-apps/plugin-os` + `@tauri-apps/api/window`.
- Create `src/lib/platform.ts` — `getPlatform()` + `usePlatform()` hook.
- Create `src/lib/platform.test.ts` — unit test platform helper.
- Create `src/design/window-controls.tsx` — `PGWindowControls` (min/max/close).
- Create `src/design/window-controls.test.tsx` — component test.
- Modify `src/design/index.ts` — export new module.
- Modify `src/design/chrome.tsx` — rework `PGTitlebar` to be platform-aware; drop `PGTrafficLights` and `showTrafficLights` prop.
- Modify `src/AppShell.tsx` — drop `showTrafficLights={false}` prop.
- Create `src/design/chrome.test.tsx` — component test for `PGTitlebar` platform branching (if no existing test file covers `PGTitlebar`; otherwise extend).

---

## Task 1: Install + register `tauri-plugin-os`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `package.json`

- [ ] **Step 1: Add Rust dependency**

Edit `src-tauri/Cargo.toml`, add under `[dependencies]` (keep alphabetical with existing plugin line):

```toml
tauri-plugin-os = "2"
```

- [ ] **Step 2: Register plugin in `lib.rs`**

In `src-tauri/src/lib.rs`, in the `tauri::Builder::default()` chain, add after the existing `tauri_plugin_dialog::init()` line:

```rust
.plugin(tauri_plugin_os::init())
```

Resulting block:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_os::init())
    .manage(AppState::new(backend))
```

- [ ] **Step 3: Add capabilities**

Replace `src-tauri/capabilities/default.json` permissions array with:

```json
"permissions": [
  "core:default",
  "core:window:allow-minimize",
  "core:window:allow-toggle-maximize",
  "core:window:allow-close",
  "core:window:allow-start-dragging",
  "dialog:default",
  "dialog:allow-open",
  "os:default"
]
```

- [ ] **Step 4: Add JS dependency**

Run:

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm add @tauri-apps/plugin-os
```

- [ ] **Step 5: Verify Rust side builds**

Run:

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with no errors. Warnings about unused imports are acceptable.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json pnpm-lock.yaml
git commit -m "chore(titlebar): install tauri-plugin-os + window control permissions

Why: native titlebar rework needs runtime platform detection and
permission to call window.minimize / toggleMaximize / close / startDragging.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Platform helper + test

**Files:**
- Create: `src/lib/platform.ts`
- Create: `src/lib/platform.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/lib/platform.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { getPlatform, usePlatform, __resetPlatformCacheForTests } from "./platform";

const platformMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: platformMock,
}));

beforeEach(() => {
  platformMock.mockReset();
  __resetPlatformCacheForTests();
});

describe("getPlatform", () => {
  it("returns macos when plugin reports macos", async () => {
    platformMock.mockReturnValue("macos");
    expect(await getPlatform()).toBe("macos");
  });

  it("caches the resolved value", async () => {
    platformMock.mockReturnValue("windows");
    await getPlatform();
    await getPlatform();
    expect(platformMock).toHaveBeenCalledTimes(1);
  });

  it("maps unknown platforms to linux", async () => {
    platformMock.mockReturnValue("freebsd");
    expect(await getPlatform()).toBe("linux");
  });
});

describe("usePlatform", () => {
  it("returns undefined before resolving, then the platform", async () => {
    platformMock.mockReturnValue("macos");
    const { result } = renderHook(() => usePlatform());
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(result.current).toBe("macos"));
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/lib/platform.test.ts
```

Expected: FAIL — module `./platform` does not exist.

- [ ] **Step 3: Implement platform helper**

Create `src/lib/platform.ts`:

```ts
import { useEffect, useState } from "react";
import { platform as osPlatform } from "@tauri-apps/plugin-os";

export type Platform = "macos" | "windows" | "linux";

let cache: Platform | null = null;
let inflight: Promise<Platform> | null = null;

function normalize(raw: string): Platform {
  if (raw === "macos") return "macos";
  if (raw === "windows") return "windows";
  return "linux";
}

export async function getPlatform(): Promise<Platform> {
  if (cache) return cache;
  if (!inflight) {
    inflight = Promise.resolve(osPlatform()).then((raw) => {
      cache = normalize(raw);
      return cache;
    });
  }
  return inflight;
}

export function usePlatform(): Platform | undefined {
  const [p, setP] = useState<Platform | undefined>(cache ?? undefined);
  useEffect(() => {
    let cancelled = false;
    getPlatform().then((r) => {
      if (!cancelled) setP(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return p;
}

export function __resetPlatformCacheForTests() {
  cache = null;
  inflight = null;
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/lib/platform.test.ts
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/platform.ts src/lib/platform.test.ts
git commit -m "feat(platform): cached platform detection helper

Why: titlebar rework needs to branch layout per OS; one detection
call at mount, cached thereafter, with a usePlatform hook for
components that need to re-render once it resolves.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Test setup mocks for os + window

**Files:**
- Modify: `src/test/setup.ts`

- [ ] **Step 1: Extend setup**

Append to `src/test/setup.ts` (after the existing `vi.mock` blocks, before `afterEach`):

```ts
vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
}));

vi.mock("@tauri-apps/api/window", () => {
  const fn = () => vi.fn();
  return {
    getCurrentWindow: () => ({
      minimize: fn(),
      toggleMaximize: fn(),
      close: fn(),
      isMaximized: vi.fn().mockResolvedValue(false),
      onResized: vi.fn().mockResolvedValue(() => {}),
    }),
  };
});
```

- [ ] **Step 2: Run full test suite — expect pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test --run
```

Expected: all existing tests pass. (The `platform.test.ts` file from Task 2 overrides this mock via its own `vi.mock`, so order is fine.)

- [ ] **Step 3: Commit**

```bash
git add src/test/setup.ts
git commit -m "test: mock @tauri-apps/plugin-os and window in test setup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `PGWindowControls` component + test

**Files:**
- Create: `src/design/window-controls.tsx`
- Create: `src/design/window-controls.test.tsx`
- Modify: `src/design/index.ts`

- [ ] **Step 1: Write failing test**

Create `src/design/window-controls.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const minimize = vi.fn();
const toggleMaximize = vi.fn();
const close = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize,
    toggleMaximize,
    close,
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
  }),
}));

import { PGWindowControls } from "./window-controls";

describe("PGWindowControls", () => {
  it("wires each button to the correct window method", async () => {
    const user = userEvent.setup();
    render(<PGWindowControls />);

    await user.click(screen.getByRole("button", { name: /minimize/i }));
    expect(minimize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /maximize/i }));
    expect(toggleMaximize).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/window-controls.test.tsx
```

Expected: FAIL — module `./window-controls` does not exist.

- [ ] **Step 3: Implement component**

Create `src/design/window-controls.tsx`:

```tsx
import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function ControlButton({
  label,
  onClick,
  closeTone,
  children,
}: {
  label: string;
  onClick: () => void;
  closeTone?: boolean;
  children: React.ReactNode;
}) {
  const [hover, setHover] = React.useState(false);
  const bg = hover
    ? closeTone
      ? "#e81123"
      : "var(--bg-2)"
    : "transparent";
  const fg = hover && closeTone ? "#fff" : "var(--fg-1)";
  return (
    <button
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 46,
        height: 38,
        background: bg,
        color: fg,
        border: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {children}
    </button>
  );
}

const iconProps = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
} as const;

function MinIcon() {
  return (
    <svg {...iconProps}>
      <line x1="1" y1="5" x2="9" y2="5" />
    </svg>
  );
}

function MaxIcon({ maximized }: { maximized: boolean }) {
  return maximized ? (
    <svg {...iconProps}>
      <rect x="1" y="3" width="6" height="6" />
      <rect x="3" y="1" width="6" height="6" fill="var(--bg-titlebar)" />
    </svg>
  ) : (
    <svg {...iconProps}>
      <rect x="1" y="1" width="8" height="8" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps}>
      <line x1="1" y1="1" x2="9" y2="9" />
      <line x1="9" y1="1" x2="1" y2="9" />
    </svg>
  );
}

export function PGWindowControls() {
  const win = React.useMemo(() => getCurrentWindow(), []);
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    win.isMaximized().then((v) => {
      if (!cancelled) setMaximized(v);
    });
    win.onResized(async () => {
      const v = await win.isMaximized();
      if (!cancelled) setMaximized(v);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [win]);

  return (
    <div style={{ display: "flex", height: 38 }}>
      <ControlButton label="Minimize" onClick={() => win.minimize()}>
        <MinIcon />
      </ControlButton>
      <ControlButton label="Maximize" onClick={() => win.toggleMaximize()}>
        <MaxIcon maximized={maximized} />
      </ControlButton>
      <ControlButton label="Close" onClick={() => win.close()} closeTone>
        <CloseIcon />
      </ControlButton>
    </div>
  );
}
```

- [ ] **Step 4: Export from design barrel**

Edit `src/design/index.ts`, append:

```ts
export * from "./window-controls";
```

- [ ] **Step 5: Run test — expect pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/window-controls.test.tsx
```

Expected: 1 passing.

- [ ] **Step 6: Commit**

```bash
git add src/design/window-controls.tsx src/design/window-controls.test.tsx src/design/index.ts
git commit -m "feat(design): PGWindowControls for Win/Linux caption buttons

Why: when decorations:false is set on non-mac, we need to render
our own min/max/close trio. Win11-style sizing (46x38), maximized
state tracked via onResized.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Rework `PGTitlebar` to be platform-aware

**Files:**
- Modify: `src/design/chrome.tsx`
- Create: `src/design/chrome.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/design/chrome.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const platformMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platform", () => ({
  usePlatform: platformMock,
  __esModule: true,
}));

import { PGTitlebar } from "./chrome";

beforeEach(() => {
  platformMock.mockReset();
});

describe("PGTitlebar", () => {
  it("renders the 80px shim on macOS and no window controls", () => {
    platformMock.mockReturnValue("macos");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.getByTestId("pg-titlebar-mac-shim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("renders window controls on Windows and no shim", () => {
    platformMock.mockReturnValue("windows");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.queryByTestId("pg-titlebar-mac-shim")).toBeNull();
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("renders window controls on Linux and no shim", () => {
    platformMock.mockReturnValue("linux");
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.queryByTestId("pg-titlebar-mac-shim")).toBeNull();
    expect(screen.getByRole("button", { name: /minimize/i })).toBeInTheDocument();
  });

  it("treats undefined platform as mac to avoid control-flash", () => {
    platformMock.mockReturnValue(undefined);
    render(<PGTitlebar repoName="demo" branch="main" />);
    expect(screen.getByTestId("pg-titlebar-mac-shim")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
  });

  it("carries data-tauri-drag-region on root", () => {
    platformMock.mockReturnValue("macos");
    const { container } = render(<PGTitlebar repoName="demo" branch="main" />);
    const root = container.querySelector("[data-tauri-drag-region]");
    expect(root).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/chrome.test.tsx
```

Expected: FAIL — several assertions unmet (no shim testid, no window controls, no drag-region attribute).

- [ ] **Step 3: Rework `PGTitlebar`**

In `src/design/chrome.tsx`:

a) At the top of the file, add imports:

```tsx
import { usePlatform } from "@/lib/platform";
import { PGWindowControls } from "./window-controls";
```

b) **Delete** the entire `PGTrafficLights` function (lines 9–40 of the current file). It is no longer used.

c) Replace the `PGTitlebarProps` interface and `PGTitlebar` function with:

```tsx
export interface PGTitlebarProps {
  repoName?: string;
  branch?: ReactNode;
  dirty?: number;
  children?: ReactNode;
  rightSlot?: ReactNode;
}

export function PGTitlebar({
  repoName = "platypus-core",
  branch = "main",
  dirty = 0,
  children,
  rightSlot,
}: PGTitlebarProps) {
  const platform = usePlatform();
  const isMac = platform === "macos" || platform === undefined;

  return (
    <div
      data-tauri-drag-region
      style={{
        height: 38,
        background: "var(--bg-titlebar)",
        borderBottom: "1px solid var(--border-0)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexShrink: 0,
        userSelect: "none",
        paddingLeft: isMac ? 80 : 12,
        paddingRight: isMac ? 12 : 0,
      }}
    >
      {isMac && (
        <div
          data-testid="pg-titlebar-mac-shim"
          style={{ width: 0, height: 38 }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-12)",
          color: "var(--fg-2)",
        }}
      >
        <PGIcon name="repo" size={13} />
        <span style={{ color: "var(--fg-0)", fontWeight: 600 }}>{repoName}</span>
        <span style={{ color: "var(--fg-3)" }}>/</span>
        {typeof branch === "string" ? (
          <>
            <PGIcon name="branch" size={12} />
            <span style={{ color: "var(--accent)" }}>{branch}</span>
          </>
        ) : (
          branch
        )}
        {dirty > 0 && (
          <span
            style={{
              fontSize: "var(--fs-10)",
              color: "var(--git-modified)",
              padding: "1px 5px",
              borderRadius: "var(--r-2)",
              border: "1px solid var(--git-modified)",
              opacity: 0.85,
            }}
          >
            ●{dirty}
          </span>
        )}
      </div>
      <div data-tauri-drag-region style={{ flex: 1, height: 38 }} />
      {children}
      {rightSlot}
      {!isMac && <PGWindowControls />}
    </div>
  );
}
```

Note: the `PGTrafficLights` export is removed. The `onClose` prop is removed (nothing was wiring it in production). The `showTrafficLights` prop is removed.

- [ ] **Step 4: Run chrome test — expect pass**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm test src/design/chrome.test.tsx
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add src/design/chrome.tsx src/design/chrome.test.tsx
git commit -m "feat(titlebar): platform-aware PGTitlebar with drag region

Why: macOS uses Overlay titleBarStyle (native traffic lights over
our content, 80px shim), Win/Linux render PGWindowControls trio.
Root + spacer carry data-tauri-drag-region.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Drop `showTrafficLights` usage in `AppShell`

**Files:**
- Modify: `src/AppShell.tsx`

- [ ] **Step 1: Remove the prop**

In `src/AppShell.tsx`, find the `<PGTitlebar ... showTrafficLights={false}` line and delete the `showTrafficLights={false}` attribute. The surrounding JSX stays intact. The final block reads:

```tsx
<PGTitlebar
  repoName={repoName}
  branch={<BranchChip onClick={(el) => setPickerAnchor((prev) => (prev ? null : el))} />}
  dirty={dirty}
  rightSlot={
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {/* ...unchanged children... */}
    </div>
  }
/>
```

- [ ] **Step 2: Type-check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/AppShell.tsx
git commit -m "chore(titlebar): drop showTrafficLights prop from AppShell

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Configure Tauri window for native-integrated titlebar

**Files:**
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Update window config**

Replace the `app.windows` entry in `src-tauri/tauri.conf.json` with:

```json
"windows": [
  {
    "title": "PlatypusGit",
    "width": 1200,
    "height": 800,
    "minWidth": 800,
    "minHeight": 600,
    "resizable": true,
    "fullscreen": false,
    "decorations": false,
    "titleBarStyle": "Overlay",
    "hiddenTitle": true
  }
]
```

- [ ] **Step 2: Bump macOS minimum system version**

In the same file, update `bundle.macOS.minimumSystemVersion` from `"10.15"` to `"11.0"` (required for `titleBarStyle: "Overlay"`).

- [ ] **Step 3: Type-check config by building**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished`. Any schema errors in `tauri.conf.json` surface here.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(titlebar): enable Overlay titleBarStyle, remove decorations

Why: lets the native macOS traffic lights render over our custom
titlebar content, and removes the OS frame on Win/Linux so we can
host our own caption buttons. Bumps macOS minimumSystemVersion to
11.0 because Overlay requires Big Sur+.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end manual verification

**Files:** none.

- [ ] **Step 1: Full test run + type check**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tsc --noEmit && pnpm test --run && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all green.

- [ ] **Step 2: Launch app on macOS**

```bash
export PATH="$HOME/Library/pnpm:$HOME/.cargo/bin:$PATH"
pnpm tauri dev
```

First build takes ~2 minutes. Once the window opens, verify in this order:

1. Only one horizontal bar at the top (no stacked double titlebar).
2. Red / yellow / green traffic lights visible, clickable — close, minimize, maximize all work.
3. Repo chip + branch chip + action buttons all interactable.
4. Dragging the window from an empty region of the titlebar moves the window.
5. Double-clicking an empty region toggles maximize.
6. The branch picker popover opens anchored to the branch chip and not offset incorrectly.
7. No visual regression on the status bar, activity bar, or any screen.

If any of the above fail, create a follow-up task — do not mark the plan complete.

- [ ] **Step 3: Document the verification outcome**

Paste the verification checklist with ✅ / ❌ per step into the final commit body or PR description. If any item failed, open an issue and link it.

- [ ] **Step 4: Final commit (if any tweaks needed)**

Only if manual testing forced changes — otherwise skip this step. Follow standard commit style from `CLAUDE.md`.

---

## Self-review notes

Spec coverage audit:

- Goal 1 (single visual titlebar) — Tasks 5, 7.
- Goal 2 (native macOS traffic lights) — Task 7 (`titleBarStyle: Overlay` + `hiddenTitle`).
- Goal 3 (Win/Linux min/max/close) — Tasks 4, 5.
- Goal 4 (draggable from empty regions) — Task 5 (`data-tauri-drag-region` on root + spacer).
- Goal 5 (no change to activity bar / status bar / screens) — Tasks 5, 6 only touch titlebar + its caller; status bar and activity bar files are untouched.
- Non-goal: HTML traffic lights — Task 5 explicitly deletes `PGTrafficLights`.
- Non-goal: terminal / search / bell icons — not in the plan, as intended.

Placeholder scan: no "TBD", "later", or vague-handling steps. All code blocks are concrete.

Type consistency: `Platform` type is the single source of truth; `usePlatform()` returns `Platform | undefined`; `PGTitlebar` treats `undefined` as mac explicitly — matches spec.
