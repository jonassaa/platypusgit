// Both windows follow the OS appearance (#236).
//
// The merge resolver is a second Tauri window running THIS bundle, selected by
// a query param — so the one place that can wire the appearance watch for both
// is `main.tsx`, before it branches on which window it is. A resolver left in
// last night's theme while the main window switched is precisely the bug the
// issue is about, and it is invisible in every test that renders a component
// directly.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentWindow } from "@tauri-apps/api/window";

// React never has to actually mount for this: the question is what main.tsx
// wires up on the way there.
vi.mock("react-dom/client", () => ({
  default: { createRoot: () => ({ render: () => {} }) },
  createRoot: () => ({ render: () => {} }),
}));

function tauriWindow() {
  return getCurrentWindow() as unknown as {
    theme: ReturnType<typeof vi.fn>;
    onThemeChanged: ReturnType<typeof vi.fn>;
  };
}

async function bootAs(search: string) {
  vi.resetModules();
  window.history.replaceState(null, "", search ? `/?${search}` : "/");
  document.body.innerHTML = '<div id="root"></div>';
  await import("./main");
}

beforeEach(() => {
  localStorage.clear();
  tauriWindow().theme.mockResolvedValue(null);
  tauriWindow().onThemeChanged.mockResolvedValue(() => {});
});

describe("main.tsx", () => {
  it("subscribes the MAIN window to tauri://theme-changed", async () => {
    await bootAs("");
    await vi.waitFor(() =>
      expect(tauriWindow().onThemeChanged).toHaveBeenCalledTimes(1),
    );
  });

  it("subscribes the MERGE resolver window too", async () => {
    await bootAs("window=merge&repoId=r1");
    await vi.waitFor(() =>
      expect(tauriWindow().onThemeChanged).toHaveBeenCalledTimes(1),
    );
  });

  it("re-themes the resolver window when its OS appearance flips", async () => {
    let fire: ((e: { payload: string }) => void) | null = null;
    tauriWindow().onThemeChanged.mockImplementation(
      async (handler: (e: { payload: string }) => void) => {
        fire = handler;
        return () => {};
      },
    );
    localStorage.setItem(
      "pg-settings-v2",
      JSON.stringify({
        themePreference: { mode: "system", lightId: "github-light", darkId: "nord" },
      }),
    );
    await bootAs("window=merge&repoId=r1");
    await vi.waitFor(() => expect(fire).not.toBeNull());
    expect(document.documentElement.dataset.theme).toBe("nord");
    fire!({ payload: "light" });
    expect(document.documentElement.dataset.theme).toBe("github-light");
    expect(document.documentElement.dataset.themeMode).toBe("light");
  });
});
