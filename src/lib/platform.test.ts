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
