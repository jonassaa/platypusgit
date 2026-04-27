import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

import { resetInvokeMock } from "./invokeMock";
import { resetDialogMock } from "./dialogMock";

vi.mock("@tauri-apps/api/core", async () => {
  const { invoke } = await import("./invokeMock");
  return { invoke };
});

vi.mock("@tauri-apps/plugin-dialog", async () => {
  return await import("./dialogMock");
});

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

afterEach(() => {
  cleanup();
  resetInvokeMock();
  resetDialogMock();
});
