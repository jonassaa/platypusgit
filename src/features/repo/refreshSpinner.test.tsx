// The Refresh button's spinner — and specifically the two cases it has to tell
// apart.
//
// Both wrong answers are one line long and look right in review. Bound straight
// to `s.loading` the button twitches on every commit and tab switch; bound to
// `useDelayedFlag(loading, 400)` a click on Refresh in a warm repository does
// nothing visible at all. What is worth pinning is that neither happens.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render } from "@testing-library/react";

import { PGButton } from "@/design";
import { SHOW_AFTER_MS } from "./elapsed";
import {
  markRefreshRequested,
  MIN_SPIN_MS,
  resetRefreshRequests,
  useRefreshSpinner,
} from "./refreshSpinner";
import { refreshOp } from "./ops";
import { emptySlice } from "./repoSlice";
import { useRepoStore } from "./useRepoStore";
import { resetInvokeMock } from "@/test/invokeMock";

/**
 * The real button, so this covers the hook AND the `loading` → `.pg-spin`
 * contract it depends on. A hook that returns the right boolean into a prop
 * that no longer animates is still a button that does not spin.
 */
function Probe() {
  return (
    <PGButton icon="sync" loading={useRefreshSpinner()}>
      Refresh
    </PGButton>
  );
}

function spinning(container: HTMLElement): boolean {
  return container.querySelector(".pg-spin") !== null;
}

/** Let the mount effects settle without moving the clock. */
function flush() {
  act(() => {
    vi.advanceTimersByTime(0);
  });
}

function setLoading(loading: boolean) {
  act(() => {
    useRepoStore.setState({ loading });
  });
}

function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  resetInvokeMock();
  resetRefreshRequests();
  useRepoStore.setState({
    ...emptySlice(),
    current: { id: "r1", path: "/repo", head: "main" },
  });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a refresh nobody asked for", () => {
  it("does not spin at all when nothing is loading", () => {
    const { container } = render(<Probe />);
    tick(SHOW_AFTER_MS + MIN_SPIN_MS);
    expect(spinning(container)).toBe(false);
  });

  it("stays still through the flicker floor", () => {
    // What a commit or a tab switch looks like: `loading` flips, and is back
    // down inside 100 ms. The button must not notice.
    const { container } = render(<Probe />);
    setLoading(true);
    tick(SHOW_AFTER_MS - 50);
    expect(spinning(container)).toBe(false);
    setLoading(false);
    tick(MIN_SPIN_MS);
    expect(spinning(container)).toBe(false);
  });

  it("does spin once it has run past the floor", () => {
    // The `/mnt/c`-under-WSL case (#274): slow enough that saying nothing is
    // the wrong answer, whoever started it.
    const { container } = render(<Probe />);
    setLoading(true);
    tick(SHOW_AFTER_MS + 50);
    expect(spinning(container)).toBe(true);
    setLoading(false);
    flush();
    expect(spinning(container)).toBe(false);
  });
});

describe("a refresh the user asked for", () => {
  it("spins immediately, without waiting out the floor", () => {
    const { container } = render(<Probe />);
    act(() => {
      markRefreshRequested();
      useRepoStore.setState({ loading: true });
    });
    expect(spinning(container)).toBe(true);
  });

  it("keeps spinning for the minimum even when the work is already done", () => {
    // The acknowledgement. A 40 ms quarter-turn reads as a rendering glitch,
    // not as "I heard you".
    const { container } = render(<Probe />);
    act(() => {
      markRefreshRequested();
      useRepoStore.setState({ loading: true });
    });
    setLoading(false);
    tick(MIN_SPIN_MS - 50);
    expect(spinning(container)).toBe(true);
  });

  it("stops once the minimum has elapsed", () => {
    const { container } = render(<Probe />);
    act(() => {
      markRefreshRequested();
      useRepoStore.setState({ loading: true });
    });
    setLoading(false);
    tick(MIN_SPIN_MS + 50);
    expect(spinning(container)).toBe(false);
  });

  it("hands off to the slow path without a gap when the refresh is long", () => {
    // The two windows overlap on purpose: the hold expires at MIN_SPIN_MS and
    // the delayed flag came up at SHOW_AFTER_MS, so a nine-second refresh spins
    // continuously rather than blinking off in the middle.
    const { container } = render(<Probe />);
    act(() => {
      markRefreshRequested();
      useRepoStore.setState({ loading: true });
    });
    let at = 0;
    for (const target of [SHOW_AFTER_MS - 50, SHOW_AFTER_MS + 50, MIN_SPIN_MS + 50, 9000]) {
      tick(target - at);
      at = target;
      expect(spinning(container), `still loading at ${at}ms`).toBe(true);
    }
    setLoading(false);
    flush();
    expect(spinning(container)).toBe(false);
  });

  it("restarts the hold when the user asks again", () => {
    const { container } = render(<Probe />);
    act(() => {
      markRefreshRequested();
      useRepoStore.setState({ loading: true });
    });
    setLoading(false);
    tick(MIN_SPIN_MS - 50);
    act(() => {
      markRefreshRequested();
    });
    tick(MIN_SPIN_MS - 50);
    expect(spinning(container)).toBe(true);
    tick(100);
    expect(spinning(container)).toBe(false);
  });
});

describe("mounting", () => {
  it("does not read earlier requests as one the user just made", () => {
    // A second repository window, or a titlebar remounting on a tab switch,
    // must not open already spinning.
    act(() => {
      markRefreshRequested();
    });
    const { container } = render(<Probe />);
    flush();
    expect(spinning(container)).toBe(false);
  });
});

describe("refreshOp", () => {
  // The button, `Mod+Alt+Y` and the palette all come through here — that shared
  // entry point is what lets one marker cover all three.
  it("marks the request, so the button spins for a hotkey too", () => {
    const refreshAll = vi.fn(async () => {});
    useRepoStore.setState({ refreshAll });
    const { container } = render(<Probe />);
    act(() => {
      expect(refreshOp()).toBe(true);
    });
    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(spinning(container)).toBe(true);
  });

  it("marks nothing when it declines for want of a repository", () => {
    useRepoStore.setState({ current: null });
    const { container } = render(<Probe />);
    act(() => {
      expect(refreshOp()).toBe(false);
    });
    tick(SHOW_AFTER_MS + MIN_SPIN_MS);
    expect(spinning(container)).toBe(false);
  });
});
