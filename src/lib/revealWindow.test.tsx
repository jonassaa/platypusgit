// The window is created hidden, so this module is the difference between an app
// that opens and an app that does not. Two behaviours are load-bearing and
// neither is obvious from reading the call site:
//
//   1. it shows the window on mount, and
//   2. it never throws — a failure here must not be able to take down the very
//      render that was about to become visible.
//
// The static half of the guard (that main.tsx actually mounts this, outside the
// error boundary) lives in test/startupPaint.test.ts, because it is a fact about
// a file rather than about behaviour.

import { render } from "@testing-library/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RevealOnFirstPaint, revealWindow } from "./revealWindow";

const show = vi.mocked(getCurrentWindow().show);

afterEach(() => {
  vi.restoreAllMocks();
  show.mockReset();
  show.mockResolvedValue(undefined);
});

describe("revealWindow", () => {
  it("shows the current window", async () => {
    await revealWindow();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("swallows a failure instead of throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    show.mockRejectedValueOnce(new Error("no such window"));

    // The assertion IS that this resolves. A rejection here would surface as an
    // unhandled rejection inside a layout effect.
    await expect(revealWindow()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe("RevealOnFirstPaint", () => {
  it("renders nothing and reveals on mount", () => {
    const { container } = render(<RevealOnFirstPaint />);
    // Nothing in the DOM: it is a side effect wearing a component's clothes, so
    // it can sit outside the error boundary without affecting layout.
    expect(container.innerHTML).toBe("");
    expect(show).toHaveBeenCalled();
  });

  it("reveals even when the app it sits beside throws", () => {
    // The scenario the placement exists for: a sibling subtree explodes during
    // render. React still commits this component, so the window still appears —
    // carrying whatever the error boundary decided to draw.
    const Boom = () => {
      throw new Error("app failed to render");
    };
    class Boundary extends React.Component<
      { children: React.ReactNode },
      { failed: boolean }
    > {
      state = { failed: false };
      static getDerivedStateFromError() {
        return { failed: true };
      }
      render() {
        return this.state.failed ? "broken" : this.props.children;
      }
    }

    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <>
        <RevealOnFirstPaint />
        <Boundary>
          <Boom />
        </Boundary>
      </>,
    );

    expect(show).toHaveBeenCalled();
    err.mockRestore();
  });
});
