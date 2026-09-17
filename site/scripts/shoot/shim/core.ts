// The whole Tauri surface the app imports, faked for a browser render.
//
// Every `@tauri-apps/*` entry `src/` imports is aliased to THIS ONE FILE by
// vite.config.ts. That works because the eight modules' export names do not
// collide (measured — see the alias list), and it keeps the fake in one
// readable place instead of eight files that each stub two functions.
//
// The live surface, per module, as of this commit:
//   api/core          invoke
//   api/event         emit, listen, UnlistenFn (type)
//   api/window        getCurrentWindow
//   api/webviewWindow WebviewWindow
//   api/webview       getCurrentWebview
//   api/dpi           PhysicalPosition, PhysicalSize
//   plugin-log        attachConsole, debug, error, warn
//   plugin-dialog     open, save
//   plugin-os         platform
// Add to this file when that list grows; the build will tell you, loudly.

// ---------------------------------------------------------------- the scene

export type Handler = (args: Record<string, unknown>) => unknown;

/** One figure's world: what the app finds in storage, what the clock says,
 *  and how the backend answers. */
export type Scene = {
  /** Matches the `?scene=` query param and the `pnpm shoot <name>` argument. */
  name: string;
  /** The figure's output basename, e.g. "history-dark". */
  figure: string;
  /** Seeded into localStorage BEFORE any store module is imported. */
  storage: Record<string, string>;
  /** Frozen clock, ISO. Relative ages must not drift with the calendar. */
  now: string;
  /** cmd -> fixture. A miss throws, which is the fixture worklist. */
  handlers: Record<string, Handler>;
  /**
   * Put the mounted app into the state this figure shows — click through to a
   * screen, select a row, open a pane.
   *
   * Needed because not everything the app can show is reachable from storage:
   * the current screen is React state in AppShell (launch deliberately always
   * lands on History, and the old `pg-screen` restore is gone), so a figure of
   * any other screen has to navigate the way a user does. Driving the real UI
   * also keeps this honest — a scene cannot show a state the app cannot reach.
   */
  afterMount?: () => Promise<void>;
};

/** Wait for a selector and click it. The retry is not paranoia: the scene runs
 *  as soon as React has rendered once, and a pane further down the tree may
 *  still be resolving its own data. */
export async function clickWhenPresent(selector: string, timeoutMs = 8000): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.click();
      return;
    }
    if (Date.now() > until) {
      throw new Error(`[shoot] never found "${selector}" to click`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Click the element matching `selector` whose trimmed text is exactly `text`.
 *
 * For controls the design system builds without a stable hook — `PGButtonGroup`
 * gives its buttons only `aria-pressed`, so Unified/Split can be reached by
 * label or not at all. Exact match, not substring: "Split" must not also match
 * a "Split view" somewhere else on screen.
 */
export async function clickByText(
  selector: string,
  text: string,
  timeoutMs = 8000,
): Promise<void> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const el = [...document.querySelectorAll<HTMLElement>(selector)].find(
      (e) => e.textContent?.trim() === text,
    );
    if (el) {
      el.click();
      return;
    }
    if (Date.now() > until) {
      throw new Error(`[shoot] never found a "${selector}" reading "${text}" to click`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

let scene: Scene | null = null;

export function registerScene(s: Scene): void {
  scene = s;
}

export function currentScene(): Scene {
  if (!scene) throw new Error("[shoot] no scene registered");
  return scene;
}

/** Commands this render asked for and did not get, in first-asked order.
 *
 *  A miss still throws — the app's own error paths stay honest — but it is
 *  recorded first, so ONE run reports every fixture the screen wants instead of
 *  making you rediscover them one reload at a time. The overlay in entry.tsx
 *  renders this. */
export const misses: string[] = [];

/** Every command that WAS answered, for pruning a scene back down once it
 *  renders: a handler nobody calls is a fixture that can drift unnoticed. */
export const hits: string[] = [];

// ---------------------------------------------------------------- api/core

/** The single chokepoint. `src/lib/tauri.ts`'s 167 wrappers all funnel through
 *  the real one, so answering this answers the whole backend.
 *
 *  A miss THROWS on purpose: it names the next fixture to write, which is what
 *  makes building a scene a worklist rather than guesswork. */
export async function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const h = currentScene().handlers[cmd];
  if (!h) {
    if (!misses.includes(cmd)) misses.push(cmd);
    throw new Error(
      `[shoot] no fixture for "${cmd}" in scene "${currentScene().name}". ` +
        `Add it to that scene's handlers.`,
    );
  }
  if (!hits.includes(cmd)) hits.push(cmd);
  return (await h(args ?? {})) as T;
}

// The alias catches more than `src/`: the Tauri PLUGINS import from
// `@tauri-apps/api/core` too, and they resolve through it as well. Measured
// across the installed plugin bundles, they want exactly these two beyond
// `invoke` — `plugin-updater` imports `{ Resource, Channel, invoke }`. Neither
// does anything in a still figure; they exist so the bundler can link.

export class Channel<T = unknown> {
  id = 0;
  onmessage: ((msg: T) => void) | null = null;
  toJSON(): string {
    return `__CHANNEL__:${this.id}`;
  }
}

export class Resource {
  constructor(public rid: number = 0) {}
  async close(): Promise<void> {}
}

// --------------------------------------------------------------- api/event

export type UnlistenFn = () => void;
export async function listen(): Promise<UnlistenFn> {
  return () => {};
}
export async function emit(): Promise<void> {}

// -------------------------------------------- api/window, webviewWindow, webview

// Shaped after the fakes in src/test/setup.ts, which is the shape the app is
// already known to tolerate. `theme` resolves "dark" rather than the test
// mock's null: these figures are dark by contract, and systemAppearance.ts
// reads exactly this.
const win = {
  label: "main",
  theme: async () => "dark" as const,
  onThemeChanged: async () => () => {},
  onResized: async () => () => {},
  outerPosition: async () => ({ x: 0, y: 0 }),
  outerSize: async () => ({ width: 1462, height: 975 }),
  isMaximized: async () => false,
  setTitle: async () => {},
  show: async () => {},
  hide: async () => {},
  close: async () => {},
  minimize: async () => {},
  toggleMaximize: async () => {},
  setFocus: async () => {},
};

export function getCurrentWindow() {
  return win;
}

export function getCurrentWebview() {
  return {
    // applyZoom (useSettingsStore) scales the whole UI through the WEBVIEW's
    // zoom rather than a CSS transform, so text reflows and stays sharp. CSS
    // `zoom` on the root element is the browser-side equivalent: it shrinks the
    // layout viewport by the factor and scales the result, which is exactly what
    // setZoom does in the real window.
    //
    // This is not cosmetic. The shipped 2026-08-18 figures were captured at
    // 120% (measured: the Welcome card is 634 CSS px there against 526 at
    // 100%), and the site renders a 1462px window into a 1040px column — a 71%
    // downscale that 13px body text does not survive well. Honouring the
    // scene's uiZoom is what keeps the new figures as legible as the old.
    setZoom: async (factor: number) => {
      document.documentElement.style.zoom = String(factor);
    },
  };
}

export class WebviewWindow {
  static async getByLabel(): Promise<WebviewWindow | null> {
    return null;
  }
  label: string;
  constructor(label: string) {
    this.label = label;
  }
  async once(): Promise<UnlistenFn> {
    return () => {};
  }
  async setPosition(): Promise<void> {}
  async setSize(): Promise<void> {}
  async setFocus(): Promise<void> {}
  async close(): Promise<void> {}
}

// ----------------------------------------------------------------- api/dpi

export class PhysicalSize {
  constructor(
    public width: number,
    public height: number,
  ) {}
}
export class PhysicalPosition {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

// ------------------------------------------------------------- plugin-log

export async function attachConsole(): Promise<UnlistenFn> {
  return () => {};
}
export async function debug(): Promise<void> {}
export async function warn(): Promise<void> {}
export async function error(): Promise<void> {}
export async function info(): Promise<void> {}
export async function trace(): Promise<void> {}

// ---------------------------------------------------------- plugin-dialog

// A still figure never opens a picker. `null` is the "user cancelled" answer
// every call site already handles.
export async function open(): Promise<null> {
  return null;
}
export async function save(): Promise<null> {
  return null;
}

// -------------------------------------------------------------- plugin-os

export function platform(): string {
  return "macos";
}
