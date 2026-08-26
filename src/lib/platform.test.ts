import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import {
  getPlatform,
  usePlatform,
  fileManagerLabel,
  __resetPlatformCacheForTests,
} from "./platform";

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

// #215 — the "reveal in file manager" label names the actual app on the two
// platforms that have one; Linux (and the brief window before resolving) get
// the generic wording, since there is no one app to name.
describe("fileManagerLabel", () => {
  it("names Finder on macOS", () => {
    expect(fileManagerLabel("macos")).toBe("Reveal in Finder");
  });

  it("names Explorer on Windows", () => {
    expect(fileManagerLabel("windows")).toBe("Show in Explorer");
  });

  it("falls back to a generic label on Linux", () => {
    expect(fileManagerLabel("linux")).toBe("Show in file manager");
  });

  it("falls back to the same generic label before the platform resolves", () => {
    expect(fileManagerLabel(undefined)).toBe("Show in file manager");
  });
});
