// The OS appearance source (#236).
//
// Two sources with different jobs, so both are pinned here: `prefers-color-
// scheme` answers synchronously (no flash of the wrong theme at first paint,
// and the only source in a plain browser tab), while Tauri's window theme +
// `tauri://theme-changed` is authoritative and is what makes a switch at
// sunset land mid-session.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { installMatchMedia, uninstallMatchMedia } from "@/test/matchMediaStub";

async function fresh() {
  vi.resetModules();
  return await import("./systemAppearance");
}

/** The mocked window from src/test/setup.ts, typed enough to steer. */
function tauriWindow() {
  return getCurrentWindow() as unknown as {
    theme: ReturnType<typeof vi.fn>;
    onThemeChanged: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  uninstallMatchMedia();
  tauriWindow().theme.mockResolvedValue(null);
  tauriWindow().onThemeChanged.mockResolvedValue(() => {});
});

afterEach(() => {
  uninstallMatchMedia();
});

describe("reading the OS appearance", () => {
  it("reads prefers-color-scheme synchronously", async () => {
    installMatchMedia("light");
    const m = await fresh();
    expect(m.getSystemAppearance()).toBe("light");
  });

  it("falls back to dark when nothing can answer", async () => {
    // jsdom has no matchMedia at all, and a webview with no
    // prefers-color-scheme support answers `false` to both queries. Neither is
    // "light" — the app's historic appearance is the honest answer.
    const m = await fresh();
    expect(m.getSystemAppearance()).toBe("dark");
  });

  it("does not read 'not dark' as 'light'", async () => {
    installMatchMedia(null); // both queries answer false
    const m = await fresh();
    expect(m.getSystemAppearance()).toBe("dark");
    expect(m.readMediaQuery()).toBeNull();
  });
});

describe("watching the OS appearance", () => {
  it("delivers the Tauri window theme, which outranks the media query", async () => {
    installMatchMedia("dark");
    tauriWindow().theme.mockResolvedValue("light");
    const m = await fresh();
    const seen: string[] = [];
    m.watchSystemAppearance((a) => seen.push(a));
    await vi.waitFor(() => expect(seen).toEqual(["light"]));
    expect(m.getSystemAppearance()).toBe("light");
  });

  it("re-resolves on tauri://theme-changed", async () => {
    installMatchMedia("dark");
    let fire: ((e: { payload: string }) => void) | null = null;
    tauriWindow().onThemeChanged.mockImplementation(
      async (handler: (e: { payload: string }) => void) => {
        fire = handler;
        return () => {};
      },
    );
    const m = await fresh();
    const seen: string[] = [];
    m.watchSystemAppearance((a) => seen.push(a));
    await vi.waitFor(() => expect(fire).not.toBeNull());
    fire!({ payload: "light" });
    expect(seen).toEqual(["light"]);
    expect(m.getSystemAppearance()).toBe("light");
  });

  it("re-resolves on a prefers-color-scheme change", async () => {
    const mq = installMatchMedia("dark");
    const m = await fresh();
    const seen: string[] = [];
    m.watchSystemAppearance((a) => seen.push(a));
    mq.set("light");
    expect(seen).toEqual(["light"]);
  });

  it("reports a change once, not once per source", async () => {
    const mq = installMatchMedia("dark");
    tauriWindow().theme.mockResolvedValue("dark");
    const m = await fresh();
    const seen: string[] = [];
    m.watchSystemAppearance((a) => seen.push(a));
    await vi.waitFor(() => expect(tauriWindow().theme).toHaveBeenCalled());
    // The window theme agreed with the media query — nothing changed, so
    // nothing is reported and the theme is not re-applied for no reason.
    expect(seen).toEqual([]);
    mq.set("light");
    expect(seen).toEqual(["light"]);
  });

  it("stops delivering after the returned unsubscribe", async () => {
    const mq = installMatchMedia("dark");
    const m = await fresh();
    const seen: string[] = [];
    const stop = m.watchSystemAppearance((a) => seen.push(a));
    await vi.waitFor(() => expect(tauriWindow().onThemeChanged).toHaveBeenCalled());
    stop();
    mq.set("light");
    expect(seen).toEqual([]);
  });

  it("survives a webview with no Tauri window API", async () => {
    installMatchMedia("light");
    tauriWindow().theme.mockRejectedValue(new Error("not running under Tauri"));
    const m = await fresh();
    const seen: string[] = [];
    expect(() => m.watchSystemAppearance((a) => seen.push(a))).not.toThrow();
    // The media query already answered at import; nothing is reported because
    // nothing changed, and no unhandled rejection escapes.
    await vi.waitFor(() => expect(tauriWindow().theme).toHaveBeenCalled());
    expect(m.getSystemAppearance()).toBe("light");
  });
});
