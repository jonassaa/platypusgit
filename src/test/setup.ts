import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { resetInvokeMock } from "./invokeMock";
import { resetDialogMock } from "./dialogMock";
import { resetEventMock } from "./eventMock";

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
  };
  return { getCurrentWindow: () => win };
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

afterEach(() => {
  cleanup();
  resetInvokeMock();
  resetDialogMock();
  resetEventMock();
  vi.clearAllMocks();
});
