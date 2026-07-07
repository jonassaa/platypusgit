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
  };
  return { getCurrentWindow: () => win };
});

afterEach(() => {
  cleanup();
  resetInvokeMock();
  resetDialogMock();
  resetEventMock();
  vi.clearAllMocks();
});
