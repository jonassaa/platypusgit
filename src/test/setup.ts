import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { resetInvokeMock } from "./invokeMock";
import { resetDialogMock } from "./dialogMock";
import { resetEventMock } from "./eventMock";
import { resetWebviewMock } from "./webviewMock";

vi.mock("@tauri-apps/api/core", async () => {
  const { invoke } = await import("./invokeMock");
  return { invoke };
});

vi.mock("@tauri-apps/api/event", async () => {
  return await import("./eventMock");
});

vi.mock("@tauri-apps/plugin-dialog", async () => {
  return await import("./dialogMock");
});

// The invoke wrapper (lib/tauri.ts) logs every call via plugin-log; stub it so
// component tests don't hit the real bridge (no window.__TAURI_INTERNALS__).
vi.mock("@tauri-apps/plugin-log", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  attachConsole: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/plugin-os", () => ({
  platform: vi.fn(() => "macos"),
}));

vi.mock("@tauri-apps/api/window", () => {
  const win = {
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn().mockResolvedValue(false),
    onResized: vi.fn().mockResolvedValue(() => {}),
    setTitle: vi.fn().mockResolvedValue(undefined),
    // The main window is created hidden and revealed on first commit
    // (lib/revealWindow.tsx). Anything that mounts the app's root tree calls
    // this, so it belongs in the shared mock rather than in one spec.
    show: vi.fn().mockResolvedValue(undefined),
    // The OS appearance source (#236). `null` is the honest default here:
    // nothing under test runs against a real window, and "the window cannot
    // tell us" is the branch that has to keep working.
    theme: vi.fn().mockResolvedValue(null),
    onThemeChanged: vi.fn().mockResolvedValue(() => {}),
  };
  return { getCurrentWindow: () => win };
});

// applyZoom (useSettingsStore) drives the real webview's zoom; record it.
vi.mock("@tauri-apps/api/webview", async () => {
  return await import("./webviewMock");
});

vi.mock("@tauri-apps/api/webviewWindow", () => {
  class FakeWebviewWindow {
    static getByLabel = vi.fn().mockResolvedValue(null);
    label: string;
    constructor(label: string) {
      this.label = label;
    }
    once = vi.fn().mockResolvedValue(() => {});
    setFocus = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }
  return { WebviewWindow: FakeWebviewWindow };
});

// CodeMirror 6 (merge resolver result editor) needs layout APIs jsdom lacks.
// Rendering fidelity is irrelevant in tests — only document/transaction state
// is asserted.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      width: 0,
      height: 0,
    }) as DOMRect;
}

// The diff minimap paints to a canvas (#161), and jsdom implements
// `getContext` as a hard "Not implemented" that prints a stack trace to the
// virtual console for EVERY mount — every diff surface has one now, so an
// unstubbed context buries real test output under hundreds of lines.
//
// A recording no-op rather than `() => null`: the component already survives a
// null context (a webview without one must not crash), but with a real object
// the paint pass actually RUNS in component tests, so an exception in the
// painter surfaces there instead of only in a screenshot. Fidelity is
// irrelevant — nothing asserts pixels.
HTMLCanvasElement.prototype.getContext = function stubGetContext(
  this: HTMLCanvasElement,
  kind: string,
) {
  if (kind !== "2d") return null;
  return {
    canvas: this,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
  } as unknown as CanvasRenderingContext2D;
} as never;

afterEach(() => {
  cleanup();
  resetInvokeMock();
  resetDialogMock();
  resetEventMock();
  resetWebviewMock();
  vi.clearAllMocks();
});
