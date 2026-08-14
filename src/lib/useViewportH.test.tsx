// The regression this hook exists for: measuring must not depend on
// ResizeObserver. WebKitGTK 605 (the Linux webview) has none, and the previous
// inline version guarded before its initial measurement, leaving the height 0 —
// which made windowVariable fall back to a 400px viewport and render the bottom
// of a taller diff pane blank.
import { afterEach, describe, expect, it } from "vitest";
import React from "react";
import { renderHook } from "@testing-library/react";
import { useViewportH } from "./useViewportH";

const realRO = globalThis.ResizeObserver;

afterEach(() => {
  globalThis.ResizeObserver = realRO;
});

function refTo(height: number): React.RefObject<HTMLElement | null> {
  const el = document.createElement("div");
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
  return { current: el };
}

describe("useViewportH", () => {
  it("measures on mount when ResizeObserver exists", () => {
    const { result } = renderHook(() => useViewportH(refTo(704)));
    expect(result.current.viewportH).toBe(704);
  });

  it("still measures on mount with NO ResizeObserver", () => {
    // @ts-expect-error deliberately removing it, as the old webview does
    delete globalThis.ResizeObserver;
    const { result } = renderHook(() => useViewportH(refTo(704)));
    expect(result.current.viewportH).toBe(704);
  });

  it("reports 0 for a detached ref, rather than throwing", () => {
    const { result } = renderHook(() =>
      useViewportH({ current: null } as React.RefObject<HTMLElement | null>),
    );
    expect(result.current.viewportH).toBe(0);
  });
});
