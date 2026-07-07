import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { emitMockEvent } from "@/test/eventMock";
import { useRepoStore } from "@/features/repo/useRepoStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { useCliLaunch } from "./useCliLaunch";

function Probe() {
  useCliLaunch();
  return null;
}

// Zustand stores are module singletons: stub openRepo per test, restore after.
const realOpenRepo = useRepoStore.getState().openRepo;
let openRepo: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openRepo = vi.fn().mockResolvedValue(undefined);
  useRepoStore.setState({ openRepo: openRepo as never });
  useNavStore.getState().clearIntent();
});

afterEach(() => {
  useRepoStore.setState({ openRepo: realOpenRepo });
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
