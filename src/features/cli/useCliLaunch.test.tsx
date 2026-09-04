import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { emitMockEvent, emitMockEventTo } from "@/test/eventMock";
import { useTabsStore } from "@/features/repo/useTabsStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useCliLaunch } from "./useCliLaunch";

function Probe() {
  useCliLaunch();
  return null;
}

// Zustand stores are module singletons: stub openRepo per test, restore after.
// It lives on the TABS store since #90 — a forwarded launch opens a tab.
const realOpenRepo = useTabsStore.getState().openRepo;
let openRepo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openRepo = vi.fn().mockResolvedValue(undefined);
  useTabsStore.setState({ openRepo: openRepo as never });
  useNavStore.getState().clearIntent();
});

afterEach(() => {
  useTabsStore.setState({ openRepo: realOpenRepo });
});

describe("useCliLaunch", () => {
  it("opens repo and switches screen from the initial intent", async () => {
    mockInvoke("take_launch_intent", () => ({
      path: "/tmp/repo",
      screen: "commit",
    }));
    render(<Probe />);
    await waitFor(() => expect(openRepo).toHaveBeenCalledWith("/tmp/repo"));
    await waitFor(() =>
      expect(useNavStore.getState().intent).toEqual({
        kind: "switch-screen",
        screen: "commit",
      }),
    );
  });

  it("path-only intent opens repo without switching screen", async () => {
    mockInvoke("take_launch_intent", () => ({ path: "/tmp/repo", screen: null }));
    render(<Probe />);
    await waitFor(() => expect(openRepo).toHaveBeenCalledWith("/tmp/repo"));
    expect(useNavStore.getState().intent).toBeNull();
  });

  it("does nothing on a plain launch (null intent)", async () => {
    mockInvoke("take_launch_intent", () => null);
    render(<Probe />);
    // Give the mount effect a tick to resolve.
    await waitFor(() => expect(openRepo).not.toHaveBeenCalled());
    expect(useNavStore.getState().intent).toBeNull();
  });

  it("handles a forwarded cli-launch event from a second invocation", async () => {
    mockInvoke("take_launch_intent", () => null);
    render(<Probe />);
    // Let the mount effect finish registering the listener.
    await waitFor(() => expect(openRepo).not.toHaveBeenCalled());
    emitMockEvent("cli-launch", { path: "/tmp/other", screen: "history" });
    await waitFor(() => expect(openRepo).toHaveBeenCalledWith("/tmp/other"));
    await waitFor(() =>
      expect(useNavStore.getState().intent).toEqual({
        kind: "switch-screen",
        screen: "history",
      }),
    );
  });
});

describe("useCliLaunch — which window (#256)", () => {
  it("a sibling window does NOT take the first-launch intent", async () => {
    // `take_launch_intent` is take-once. With several windows racing to mount,
    // an ungated take would land `pgit ~/repo` in whichever asked first — a
    // restored window on the second monitor as often as the one in front of
    // the user. The forwarded event is a separate path and is routed backend
    // side, so it still reaches exactly one window.
    vi.resetModules();
    vi.doMock("@tauri-apps/api/window", () => ({
      getCurrentWindow: () => ({
        label: "pg-1",
        outerPosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
        outerSize: vi.fn().mockResolvedValue({ width: 1200, height: 800 }),
        setTitle: vi.fn().mockResolvedValue(undefined),
        show: vi.fn().mockResolvedValue(undefined),
        theme: vi.fn().mockResolvedValue(null),
        onThemeChanged: vi.fn().mockResolvedValue(() => {}),
      }),
    }));
    const taken = vi.fn(() => ({ path: "/tmp/repo", screen: null }));
    mockInvoke("take_launch_intent", taken);

    const sibling = await import("./useCliLaunch");
    const tabs = await import("@/features/repo/useTabsStore");
    const siblingOpen = vi.fn().mockResolvedValue(undefined);
    tabs.useTabsStore.setState({ openRepo: siblingOpen as never });

    function SiblingProbe() {
      sibling.useCliLaunch();
      return null;
    }
    render(<SiblingProbe />);

    await waitFor(() => expect(taken).not.toHaveBeenCalled());
    expect(siblingOpen).not.toHaveBeenCalled();

    // A forwarded launch routed to ANOTHER window must not land here. This is
    // the half that a plain `listen()` gets wrong: an untargeted listener
    // matches every emit, including one addressed to a single window, so
    // `WindowRegistry::route`'s decision would be undone in the webview and
    // every window would open the repository.
    emitMockEventTo("main", "cli-launch", { path: "/tmp/main-only", screen: null });
    expect(siblingOpen).not.toHaveBeenCalled();

    // …one routed to THIS window does.
    emitMockEventTo(
      "pg-1",
      "cli-launch",
      { path: "/tmp/other", screen: null },
    );
    await waitFor(() => expect(siblingOpen).toHaveBeenCalledWith("/tmp/other"));

    // And a genuine broadcast still reaches every window, so nothing that uses
    // `app.emit` (fs://changed, net://progress) is affected by the scoping.
    emitMockEvent("cli-launch", { path: "/tmp/broadcast", screen: null });
    await waitFor(() => expect(siblingOpen).toHaveBeenCalledWith("/tmp/broadcast"));

    vi.doUnmock("@tauri-apps/api/window");
    vi.resetModules();
  });
});
