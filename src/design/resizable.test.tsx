// The pane hook end to end: measurement → clamp → persistence (#162). The pure
// arithmetic is pinned in paneSize.test.ts; this file is about the three things
// only a mounted component can show — that a real measurement reaches the clamp,
// that an UNMEASURED container leaves the stored value alone, and that a
// container which changes size re-clamps without a ResizeObserver.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { stubContainerSize } from "@/test/elementSize";
import { PGResizeHandle, usePaneSize } from "./resizable";
import { useElementSize } from "@/lib/useElementSize";

const KEY = "pg-test-pane-w";

function Split({
  axis = "width",
  initial = 300,
  min = 180,
  siblingMin = 320,
}: {
  axis?: "width" | "height";
  initial?: number;
  min?: number;
  siblingMin?: number;
}) {
  const layout = useElementSize();
  const pane = usePaneSize(initial, {
    axis,
    container: layout,
    min,
    siblingMin,
    storageKey: KEY,
  });
  return (
    <div ref={layout.ref} data-testid="container">
      <div
        data-testid="pane"
        style={axis === "width" ? { width: pane.size } : { height: pane.size }}
      />
      <PGResizeHandle
        testId="handle"
        orientation={axis === "width" ? "horizontal" : "vertical"}
        onDrag={pane.resize}
        onReset={pane.reset}
      />
      <div data-testid="sibling" style={{ flex: 1, minWidth: 0 }} />
    </div>
  );
}

const paneSize = (el: HTMLElement, axis: "width" | "height" = "width") =>
  el.style[axis];

const drag = (handle: HTMLElement, delta: number, axis: "x" | "y" = "x") => {
  const from = axis === "x" ? { clientX: 100 } : { clientY: 100 };
  const to =
    axis === "x" ? { clientX: 100 + delta } : { clientY: 100 + delta };
  fireEvent.mouseDown(handle, from);
  fireEvent.mouseMove(document, to);
  fireEvent.mouseUp(document);
};

describe("usePaneSize", () => {
  let restore: (() => void) | null = null;

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("drags past every old fixed maximum when the container allows it", () => {
    restore = stubContainerSize({ width: 2400 });
    const { getByTestId } = render(<Split />);

    drag(getByTestId("handle"), 4000);

    // 2400 − 320 − 4. The largest hard-coded ceiling in the app was 800px.
    expect(paneSize(getByTestId("pane"))).toBe("2076px");
  });

  it("leaves a stored size that outgrew the container alone until measured", () => {
    localStorage.setItem(KEY, "1800");
    const { getByTestId } = render(<Split />); // jsdom: container measures 0

    expect(paneSize(getByTestId("pane"))).toBe("1800px");
    // The critical half: a clamp against 0 would have rewritten this to 180.
    expect(localStorage.getItem(KEY)).toBe("1800");
  });

  it("renders a too-large stored size clamped, without overwriting it", () => {
    // Persist 1800 on an external monitor, reopen at 1280: the panel comes back
    // narrowed, but the preference the big display earned is still on disk, so
    // it returns in full when the window does.
    localStorage.setItem(KEY, "1800");
    restore = stubContainerSize({ width: 1280 });
    const { getByTestId } = render(<Split />);

    expect(paneSize(getByTestId("pane"))).toBe("956px");
    expect(localStorage.getItem(KEY)).toBe("1800");
  });

  it("re-clamps on a window resize, with no ResizeObserver in sight", () => {
    const noResizeObserver = vi
      .spyOn(globalThis, "ResizeObserver", "get")
      .mockReturnValue(undefined as unknown as typeof ResizeObserver);
    try {
      restore = stubContainerSize({ width: 2000 });
      const { getByTestId } = render(<Split />);
      drag(getByTestId("handle"), 4000);
      expect(paneSize(getByTestId("pane"))).toBe("1676px");

      // The window moves to a smaller display.
      restore();
      restore = stubContainerSize({ width: 900 });
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });

      // 900 − 320 − 4: narrowed, and the sibling still has its floor, so the
      // handle between them is still on screen and still draggable.
      expect(paneSize(getByTestId("pane"))).toBe("576px");
    } finally {
      noResizeObserver.mockRestore();
    }
  });

  it("keeps the pane's own minimum when the container cannot fit both floors", () => {
    restore = stubContainerSize({ width: 300 });
    const { getByTestId } = render(<Split />);

    // 300 − 320 − 4 is negative; `min` wins rather than the pane vanishing.
    expect(paneSize(getByTestId("pane"))).toBe("180px");
  });

  it("persists a dragged size — debounced, and flushed by unmount", () => {
    restore = stubContainerSize({ width: 1600 });
    const { getByTestId, unmount } = render(<Split />);
    drag(getByTestId("handle"), 100);
    // Deliberately NOT on disk yet: the write is debounced off the drag, so a
    // mousemove never pays a synchronous localStorage.setItem.
    expect(localStorage.getItem(KEY)).toBeNull();
    unmount(); // a pending write is flushed rather than lost

    expect(localStorage.getItem(KEY)).toBe("400");
    const again = render(<Split />);
    expect(paneSize(again.getByTestId("pane"))).toBe("400px");
  });

  it("resets to the initial size on a double-click of the handle", () => {
    vi.useFakeTimers();
    try {
      restore = stubContainerSize({ width: 1600 });
      const { getByTestId } = render(<Split />);
      drag(getByTestId("handle"), 200);
      expect(paneSize(getByTestId("pane"))).toBe("500px");

      fireEvent.doubleClick(getByTestId("handle"));

      expect(paneSize(getByTestId("pane"))).toBe("300px");
      // The trailing debounce write lands once the drag settles.
      act(() => {
        vi.advanceTimersByTime(300);
      });
      expect(localStorage.getItem(KEY)).toBe("300");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads the axis it was told, not always the width", () => {
    // The hook sizes History's bottom panel and Compare's commit lists too. A
    // width-only measurement would clamp those against the wrong dimension —
    // here a tall, narrow container would cap a height pane at 180.
    restore = stubContainerSize({ width: 200, height: 1200 });
    const { getByTestId } = render(<Split axis="height" initial={300} />);

    drag(getByTestId("handle"), 4000, "y");

    expect(paneSize(getByTestId("pane"), "height")).toBe("876px");
  });
});
