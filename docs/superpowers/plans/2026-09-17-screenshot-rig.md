# Screenshot Rig Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regenerate the three site figures (`history-dark`, `commit-dark`,
`welcome-dark`) as sharp, current 2x masters from a repeatable `pnpm shoot`
command, with no human clicking a window.

**Architecture:** The app sets `titleBarStyle: "Overlay"`, so it draws its whole
titlebar in HTML — only the drop shadow and three traffic lights are native. So
render the real `src/` components in headless Chrome at device scale factor 2
with every `@tauri-apps/*` import aliased to a shim, then composite the native
pixels with sharp. A *scene* is a set of `localStorage` entries plus a
`cmd -> fixture` map; the mock throws on an unregistered command, which is what
turns fixture-building into a worklist rather than guesswork.

**Tech Stack:** Vite 7 (`resolve.alias`), React 19, headless Chrome
(`--force-device-scale-factor=2`), sharp (already on disk via astro's optional
dependency), TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-17-screenshot-rig-design.md`

## Global Constraints

- Masters land in `site/screenshots/<name>.png` at exactly **3200x2224**, window
  **2924x1950**, shadow margins **138** left/right, **94** top, **180** bottom.
  These are 2x the measured geometry of the shipped master; `screenshots.mjs`
  and `Screenshot.astro` both hardcode the 1600/1112 aspect and must not change.
- Figure names stay `history-dark`, `commit-dark`, `welcome-dark`.
- Dark theme, accent pinned (#455 added palette shuffling).
- Text size and Spacing presets pinned explicitly (#459 drives `--row-scale` /
  `--row-step`).
- The clock is frozen per scene — relative ages must not drift with the calendar.
- Fixtures import their types from `src/lib/types.ts`. A backend shape change
  must break `tsc`, not the picture.
- No new runtime dependency for the site: sharp is resolved from
  `node_modules/.pnpm` the way `screenshots.mjs` already does it.
- Nothing in this plan runs in CI.
- `pnpm` and `cargo` need `~/Library/pnpm` / `~/.cargo/bin` on PATH; in a
  worktree-isolated session call the binaries by absolute path
  (`~/Library/pnpm/pnpm`) rather than exporting PATH.

---

### Task 1: Shims and Vite config — boot the real app in a browser

**Files:**
- Create: `site/scripts/shoot/vite.config.ts`
- Create: `site/scripts/shoot/shim/{core,event,window,webviewWindow,dpi,log,dialog,os}.ts`
- Create: `site/scripts/shoot/entry.tsx`
- Create: `site/scripts/shoot/index.html`
- Create: `site/scripts/shoot/tsconfig.json`

**Interfaces:**
- Produces: `registerScene(scene: Scene): void` and
  `type Scene = { name: string; storage: Record<string,string>; now: string;
  handlers: Record<string, (args: Record<string, unknown>) => unknown> }` from
  `shim/core.ts`. Tasks 3 and 4 author `Scene` objects.
- Produces: `invoke<T>(cmd, args): Promise<T>` from `shim/core.ts`, which throws
  `Error("[shoot] no fixture for \"<cmd>\"")` on a miss.

- [ ] **Step 1: Write `shim/core.ts` with the throwing registry**

Mirror `src/test/invokeMock.ts`'s shape, but driven by a scene rather than
per-test registration:

```ts
export type Handler = (args: Record<string, unknown>) => unknown;
export type Scene = {
  name: string;
  storage: Record<string, string>;
  now: string; // ISO; frozen clock
  handlers: Record<string, Handler>;
};

let scene: Scene | null = null;
export function registerScene(s: Scene): void { scene = s; }
export function currentScene(): Scene {
  if (!scene) throw new Error("[shoot] no scene registered");
  return scene;
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const h = currentScene().handlers[cmd];
  if (!h) throw new Error(`[shoot] no fixture for "${cmd}"`);
  return (await h(args ?? {})) as T;
}
```

- [ ] **Step 2: Write the remaining shims as inert stubs**

A still figure never listens, logs or opens a dialog. Each shim exports only
what `src/` imports — check with
`grep -rh "from \"@tauri-apps/api/window\"" src/ | sed 's/.*import //'`.

```ts
// shim/event.ts
export async function listen(): Promise<() => void> { return () => {}; }
export async function emit(): Promise<void> {}
export const TauriEvent = { WINDOW_RESIZED: "tauri://resize" } as const;
```

```ts
// shim/log.ts — the app calls these on real paths; swallow them
export async function attachConsole(): Promise<() => void> { return () => {}; }
export async function info(): Promise<void> {}
export async function warn(): Promise<void> {}
export async function error(): Promise<void> {}
export async function debug(): Promise<void> {}
export async function trace(): Promise<void> {}
```

`shim/window.ts` and `shim/webviewWindow.ts` need a `getCurrentWindow()` /
`getCurrentWebviewWindow()` returning an object whose methods resolve: `show`,
`hide`, `setTitle`, `label` (`"main"`), `onThemeChanged`, `listen`, `theme`
(`async () => "dark"`), `isVisible` (`async () => true`). `shim/os.ts` exports
`platform: () => "macos"`. `shim/dpi.ts` exports `LogicalSize`/`PhysicalSize`
classes. `shim/dialog.ts` exports `save`/`open`/`message`/`confirm` resolving
`null`/`false`.

- [ ] **Step 3: Write `vite.config.ts` aliasing every Tauri entry**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");
const shim = (f: string) => path.resolve(import.meta.dirname, "shim", f);

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "@tauri-apps/api/core": shim("core.ts"),
      "@tauri-apps/api/event": shim("event.ts"),
      "@tauri-apps/api/window": shim("window.ts"),
      "@tauri-apps/api/webviewWindow": shim("webviewWindow.ts"),
      "@tauri-apps/api/dpi": shim("dpi.ts"),
      "@tauri-apps/plugin-log": shim("log.ts"),
      "@tauri-apps/plugin-dialog": shim("dialog.ts"),
      "@tauri-apps/plugin-os": shim("os.ts"),
    },
  },
  worker: { format: "es" },
  server: { port: 1430, strictPort: true },
});
```

`worker: { format: "es" }` is copied from the root config deliberately — the
syntax tokenizer is a module worker and the build fails without it.

- [ ] **Step 4: Write `entry.tsx` — seed storage, freeze the clock, mount**

Storage must be written **before** any store module is imported, because the
Zustand stores read `localStorage` at module scope. A dynamic `import()` after
seeding is what guarantees the order.

```tsx
import { registerScene, type Scene } from "./shim/core";
import { scenes } from "./scenes";

const name = new URLSearchParams(location.search).get("scene") ?? "welcome";
const scene: Scene | undefined = scenes[name];
if (!scene) throw new Error(`[shoot] unknown scene "${name}"`);

registerScene(scene);
localStorage.clear();
for (const [k, v] of Object.entries(scene.storage)) localStorage.setItem(k, v);

// Freeze the clock so relative ages ("1mo ago") never drift with the calendar.
const FIXED = new Date(scene.now).getTime();
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) super(FIXED);
    else super(...args);
  }
  static now() { return FIXED; }
}
globalThis.Date = FrozenDate as DateConstructor;

const [{ default: React }, { default: ReactDOM }, { default: App }] =
  await Promise.all([import("react"), import("react-dom/client"), import("@/App")]);
await import("@/index.css");

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
// The driver waits on this flag rather than a fixed timeout.
queueMicrotask(() => { (window as never as { __shotReady?: boolean }).__shotReady = true; });
```

Note `<App />` is mounted WITHOUT `React.StrictMode` and without
`RevealOnFirstPaint` / `PGErrorBoundary`: StrictMode double-invokes effects,
which doubles fixture calls for no benefit, and the reveal is a no-op outside
Tauri.

- [ ] **Step 5: Add a minimal `welcome` scene so there is something to boot**

`welcome-dark` is the no-repository state, so it needs almost no fixtures. In
`scenes/welcome.ts`, `storage` is `{}` (nothing open) and `handlers` starts
empty. This is the smoke test for the whole shim layer.

- [ ] **Step 6: Run the dev server and iterate on the throw list**

Run: `~/Library/pnpm/pnpm exec vite --config site/scripts/shoot/vite.config.ts`
then open `http://localhost:1430/?scene=welcome`.

Expected on first run: a `[shoot] no fixture for "…"` throw, or a missing-export
error from a shim. Each one names exactly what to add. Add it, reload, repeat
until the Welcome card renders. Record every command the welcome screen asked
for in a comment at the top of `scenes/welcome.ts` — later scenes inherit them.

- [ ] **Step 7: Commit**

```
feat(site): a headless shim layer that boots the app in a browser
```

---

### Task 2: The driver and compositor — geometry before content

**Files:**
- Create: `site/scripts/shoot/shoot.mjs`
- Create: `site/scripts/shoot/composite.mjs`
- Create: `site/scripts/shoot/chrome.sh`
- Modify: `site/package.json` (add the `shoot` script)

**Interfaces:**
- Consumes: the dev server from Task 1 at `?scene=<name>`.
- Produces: `composite(bodyPng: Buffer, outPath: string): Promise<void>`, writing
  a 3200x2224 PNG.

- [ ] **Step 1: Write `chrome.sh`, a one-line wrapper**

A quoted Chrome path is refused in a worktree-isolated session as "a command
whose name is computed at runtime", and symlinking the binary breaks it — Chrome
resolves `Google Chrome Framework` relative to the symlink and dies in `dlopen`.
A wrapper that `exec`s the real path is the only thing that works:

```sh
#!/bin/sh
exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" "$@"
```

`chmod +x` it.

- [ ] **Step 2: Write `composite.mjs` against the measured geometry**

```js
export const GEOM = {
  canvas: { w: 3200, h: 2224 },
  window: { w: 2924, h: 1950 },
  margin: { left: 138, top: 94 },   // right 138, bottom 180
  radius: 20,                        // 10pt at 2x
  lights: { cy: 138, r: 12, cx: [152, 192, 232],
            fill: ["#ff5f57", "#febc2e", "#28c840"] },
};
```

Round the body's corners with an SVG mask, draw a blurred black rounded rect
beneath it as the shadow, then composite the three circles. Return early with a
clear error if the body PNG is not exactly `GEOM.window`.

- [ ] **Step 3: Verify geometry against the shipped master BEFORE any content**

This is the step that proves the composite, and it must come first. Feed
`composite()` a solid magenta 2924x1950 rectangle and write
`/tmp/geomcheck.png`. Then run the same alpha-bounding-box measurement used to
derive the numbers:

Run a node script that loads `/tmp/geomcheck.png`, finds the bbox where
`alpha > 250`, and prints it.
Expected: `x 138..3061  y 94..2043`, i.e. window `2924 x 1950`, margins
`left 138 right 138 top 94 bottom 180` — exactly 2x the shipped master's
`69/69/47/90`.

If it disagrees, fix `composite.mjs` now; every figure inherits this.

- [ ] **Step 4: Write `shoot.mjs` to drive Chrome**

Start the vite server as a child process, wait for the port, then per scene run
Chrome headless. Chrome **writes the png and then does not exit** — so treat a
timeout as success if the file exists, and `pkill -f <the profile dir>`
afterwards. Give each shot its own `--user-data-dir` or concurrent shots collide.

```js
const args = [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  `--force-device-scale-factor=2`,
  `--window-size=${GEOM.window.w / 2},${GEOM.window.h / 2}`,
  `--screenshot=${bodyPath}`,
  "--virtual-time-budget=8000",
  `--user-data-dir=${profileDir}`,
  `http://localhost:1430/?scene=${name}`,
];
```

`--window-size` is in CSS px and the scale factor doubles it, so 1462x975 CSS
yields the 2924x1950 body.

- [ ] **Step 5: Wire `pnpm shoot` and run it for `welcome`**

Add to `site/package.json`: `"shoot": "node scripts/shoot/shoot.mjs"`.

Run: `~/Library/pnpm/pnpm shoot welcome`
Expected: `site/screenshots/welcome-dark.png` at 3200x2224. Read the PNG and
confirm the Welcome card is centred, the theme is dark, and the traffic lights
sit in the titlebar rather than over content.

- [ ] **Step 6: Commit**

```
feat(site): drive headless Chrome and composite the macOS window chrome
```

---

### Task 3: The showcase fixtures and the history scene

**Files:**
- Create: `site/scripts/shoot/fixtures/showcase.ts`
- Create: `site/scripts/shoot/scenes/history.ts`
- Modify: `site/scripts/shoot/scenes/index.ts`

**Interfaces:**
- Consumes: `Scene` from `shim/core.ts`.
- Produces: `SHOWCASE_COMMITS`, `SHOWCASE_STATUS`, `SHOWCASE_DIFF`,
  `SHOWCASE_HEAD`, `SHOWCASE_BRANCHES` — each typed with the matching import
  from `@/lib/types`.

- [ ] **Step 1: Transcribe the existing hero's content as fixtures**

The shipped `history-dark.png` is the content brief — it is a composition that
was already approved, and reproducing it keeps the figure comparable. Its seven
visible refs: `HEAD->main`, `fix/div-by-zero-message`, `feat/repl`,
`origin/feat/repl`, `origin/main`, `topic/docs-site`, `topic/bench`. Authors:
Jonas Aasberg, Kofi Mensah, Ana Ruiz, Yuki Tanaka. Twelve rows are visible;
provide ~30 so the list scrolls naturally.

Type every array against `src/lib/types.ts` — `Commit[]`, `FileStatus[]`,
`HeadInfo`. Do not invent field names; read the type first.

- [ ] **Step 2: Set the frozen clock so the age column reads "1mo ago"**

The repository's commits are pinned to 2026-06-26. Set `now` in the scene to
**`"2026-07-28T10:30:00+02:00"`**, roughly one month later, which reproduces the
"1mo ago" / "2mo ago" column the approved composition shows.

- [ ] **Step 3: Seed the history scene's storage**

```ts
storage: {
  "pg-screen": JSON.stringify("history"),
  "pg-open-repos": JSON.stringify([{ path: "/Users/jonas/pgit-showcase", name: "pgit-showcase" }]),
  "pg-history-diff-layout": JSON.stringify("side-by-side"),
  "pg-settings-v2": JSON.stringify({ themeMode: "dark", textSize: "default", spacing: "default" }),
}
```

Read the real shapes from `useTabsStore.ts` and `useSettingsStore.ts` before
writing these — a wrong shape is silently ignored and the scene renders the
default state, which looks like a fixture bug but is a storage bug.

- [ ] **Step 4: Run and follow the throw list to completion**

Run: `~/Library/pnpm/pnpm shoot history`
Each `[shoot] no fixture for "<cmd>"` names the next fixture. Expect roughly:
`open_repo`, `head_info`, `get_status`, `log`/`list_commits`, `commit_detail`,
`diff_commit`, `list_branches`, `ahead_behind`, `blob_ceiling`.

- [ ] **Step 5: Read the rendered PNG and check it against the current UI**

Expected, and each is a drift this plan exists to fix:
- icons are lucide (#425), not the hand-drawn set
- the activity bar runs to the window's bottom edge (#426)
- a tag pill carries a tag icon, not a branch's (#443)
- the commit subject column is not collapsed (#444)

- [ ] **Step 6: Commit**

```
feat(site): the showcase fixtures and the history figure
```

---

### Task 4: The commit scene

**Files:**
- Create: `site/scripts/shoot/scenes/commit.ts`
- Modify: `site/scripts/shoot/scenes/index.ts`

**Interfaces:**
- Consumes: the `SHOWCASE_*` fixtures from Task 3 and `Scene` from `shim/core.ts`.

- [ ] **Step 1: Read the shipped `commit-dark.png` and list what it shows**

Run `Read site/screenshots/commit-dark.png`. It is the commit/working-tree
screen; note which panes, which staged/unstaged split and what message text the
approved composition used.

- [ ] **Step 2: Seed storage for the commit screen**

`"pg-screen": JSON.stringify("commit")` plus `pg-commit-view-mode`, reusing the
same repo entry and settings as Task 3. Reuse `SHOWCASE_STATUS` so the two
figures agree about the repository — the hero's status bar says "4 changed" and
a commit figure showing a different count reads as two different products.

- [ ] **Step 3: Run and complete the throw list**

Run: `~/Library/pnpm/pnpm shoot commit`
Expect additionally: `diff_worktree`/`diff_index`, `list_staged`, and the
commit-composer commands (`commit_template`, `commit_cleanup_mode`).

- [ ] **Step 4: Read the PNG and confirm the composition matches the original**

- [ ] **Step 5: Commit**

```
feat(site): the commit figure
```

---

### Task 5: Encode, re-alt, retire the manual path

**Files:**
- Modify: `site/src/pages/index.astro` (hero alt text)
- Modify: `site/src/pages/features.astro` (two alt texts + captions)
- Delete: `site/scripts/capture.mjs`
- Modify: `site/package.json` (drop the `capture` script)
- Modify: `docs/dev/` (whichever file documents the site figures)

- [ ] **Step 1: Encode all three and confirm the 2x variant appears**

Run: `~/Library/pnpm/pnpm screenshots` in `site/`
Expected: six files in `site/public/screenshots/` — `<name>.webp` AND
`<name>@2x.webp` for all three — and **no** "is 1x — so NO 2x variant" warning.
That warning's absence is the machine-checkable form of "crisp".

- [ ] **Step 2: Rewrite the alt text against the new renders**

The alt text is unusually load-bearing here: these are the only images on the
site carrying product information, and `Screenshot.astro` documents that
"screenshot of platypusgit" is not acceptable. The current hero alt lists a
specific ref set and panel layout — re-read the new PNG and correct anything
that changed.

- [ ] **Step 3: Delete `capture.mjs` and its package script**

The spec's reasoning: leaving a broken manual path beside a working automated
one invites someone to use it. Its aspect gate and resize target disagree by
construction, so it cannot produce a master.

- [ ] **Step 4: Document the rig where the figures are documented**

Find the doc that currently points at `pnpm capture`
(`grep -rn "pnpm capture" docs/ site/ CLAUDE.md`) and replace it with `pnpm
shoot`, naming the scene files as the place a figure's content is decided.

- [ ] **Step 5: Verify the whole gate**

Run, in order:
- `~/Library/pnpm/pnpm exec tsc -p site/scripts/shoot/tsconfig.json --noEmit`
- `~/Library/pnpm/pnpm test` (repo root — `docs` project reads the tree)
- `~/Library/pnpm/pnpm vite build` in `site/`

Expected: all pass. The `docs` vitest project asserts tree invariants and may
notice a removed script.

- [ ] **Step 6: Commit and open the PR**

```
feat(site): regenerate the figures from a headless rig
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: the shim layer and
the one-function mock surface to Task 1; geometry, the compositor and the DPR-2
render to Task 2; fixtures, type-pinning, the frozen clock and pinned
presets to Tasks 1/3; the three figures to Tasks 2-4; encoding, alt text,
retiring `capture.mjs` and the docs pointer to Task 5. The "what runs when"
decision (on-demand, committed masters, no CI) is realised by Task 2 Step 5
adding only a local `pnpm shoot` script and by no task touching `.github/`.

**Placeholder scan.** No TBD/TODO. The two places that read like
open questions are deliberate and are the method the spec argues for, not gaps:
the throw-list loops (Task 1 Step 6, Task 3 Step 4, Task 4 Step 3) are a
worklist the mock generates, and each names the expected commands so the
executor knows when it is done. Task 3 Step 1 and Task 4 Step 1 direct the
executor to read the shipped PNG because the approved composition is the brief.

**Type consistency.** `Scene`, `registerScene`, `currentScene`, `invoke` and
`GEOM` are defined once (Tasks 1-2) and referenced with the same names in Tasks
3-4. `SHOWCASE_*` is defined in Task 3 and consumed by name in Task 4. Scene
names (`welcome`, `history`, `commit`) match the `?scene=` parameter and the
`pnpm shoot <name>` argument throughout; figure names (`welcome-dark`,
`history-dark`, `commit-dark`) stay distinct from scene names and are only used
for output paths.

**One risk the executor must not paper over.** If a scene renders the default
state instead of the seeded one, the cause is almost always a `localStorage`
shape that the store ignored, not a missing fixture. Read the store's parser
before adding fixtures to chase it.
