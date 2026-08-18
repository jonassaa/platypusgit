// The gutter's platform-facing half. The arithmetic is covered in
// lib/diffMinimap.test.ts; what is left to prove here is the width gate, the
// unmeasured-vs-narrow distinction, that a missing 2D context (jsdom) is
// survivable, and that a press scrolls the element it was handed.
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DiffMinimap } from "./DiffMinimap";
import { MINIMAP_MIN_CONTAINER_W } from "@/lib/diffMinimap";
import type { DiffRow } from "@/lib/diffRows";

const ROW_H = 18.6;

/**
 * jsdom has no `PointerEvent`, and testing-library's fallback drops `button` and
 * `clientY` — so a plain `fireEvent.pointerDown` would arrive with an undefined
 * button and be declined by the primary-button guard. A `MouseEvent` of the
 * pointer type carries both, which is what a real webview delivers.
 */
const pointer = (el: Element, type: string, init: MouseEventInit = {}) =>
  fireEvent(el, new MouseEvent(type, { bubbles: true, button: 0, ...init }));
const rows: DiffRow[] = Array.from({ length: 400 }, (_, i) => ({
  kind: "line",
  hunkIndex: 0,
  line: { kind: i % 40 === 0 ? "add" : "ctx", text: "  some line of code" },
  h: ROW_H,
}));

function Harness(props: {
  containerWidth?: number;
  containerHeight?: number;
  onScrollTop?: (n: number) => void;
  scrollEl?: HTMLElement | null;
  rows?: DiffRow[];
}) {
  const own = React.useRef<HTMLDivElement>(null);
  const ref = props.scrollEl !== undefined
    ? ({ current: props.scrollEl } as React.RefObject<HTMLElement | null>)
    : own;
  return (
    <>
      <div ref={own} />
      <DiffMinimap
        rows={props.rows ?? rows}
        heights={(props.rows ?? rows).map((r) => r.h)}
        rowH={ROW_H}
        scrollTop={0}
        viewportH={600}
        scrollRef={ref}
        onScrollTop={props.onScrollTop ?? (() => {})}
        containerWidth={props.containerWidth ?? 900}
        containerHeight={props.containerHeight ?? 600}
      />
    </>
  );
}

describe("DiffMinimap", () => {
  it("renders in a pane wide enough for it", () => {
    render(<Harness containerWidth={MINIMAP_MIN_CONTAINER_W} />);
    expect(screen.getByTestId("diff-minimap")).toBeInTheDocument();
  });

  it("hides itself in a pane below the threshold rather than eating the diff", () => {
    render(<Harness containerWidth={MINIMAP_MIN_CONTAINER_W - 1} />);
    expect(screen.queryByTestId("diff-minimap")).toBeNull();
  });

  it("does NOT hide at width 0 — that is unmeasured, not narrow", () => {
    // The useElementSize contract: 0 means "no constraint known". Hiding on it
    // would blank the gutter forever on a webview where only the attach-time read
    // lands (WebKitGTK 605 has no ResizeObserver).
    render(<Harness containerWidth={0} />);
    expect(screen.getByTestId("diff-minimap")).toBeInTheDocument();
  });

  it("renders nothing for an empty diff", () => {
    render(<Harness rows={[]} />);
    expect(screen.queryByTestId("diff-minimap")).toBeNull();
  });

  it("survives a webview with no 2D canvas context", () => {
    // A webview may hand back null; the paint effect must no-op, not throw.
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(null);
    try {
      render(<Harness />);
      expect(screen.getByTestId("diff-minimap")).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("paints, and hands the canvas rgb() — never the oklch token it read", () => {
    // The whole point of lib/cssColor: `ctx.fillStyle = "oklch(…)"` is a SILENT
    // no-op on a webview that cannot parse it (WebKitGTK 605, the e2e target),
    // so an oklch string reaching here would paint with the previous fill.
    const fills: string[] = [];
    const rects: number[][] = [];
    const spy = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        const ctx = {
          canvas: this,
          set fillStyle(v: string) {
            fills.push(v);
          },
          get fillStyle() {
            return "";
          },
          strokeStyle: "",
          lineWidth: 1,
          clearRect: () => {},
          fillRect: (...a: number[]) => rects.push(a),
          strokeRect: () => {},
        };
        return ctx as unknown as CanvasRenderingContext2D;
      } as never,
    );
    try {
      render(<Harness containerHeight={600} />);
    } finally {
      spy.mockRestore();
    }

    expect(rects.length).toBeGreaterThan(1);
    expect(fills.length).toBeGreaterThan(1);
    for (const f of fills) {
      expect(f).toMatch(/^rgba?\(/);
      expect(f).not.toContain("oklch");
      expect(f).not.toContain("var(");
    }
  });

  it("scrolls the element it was handed, and reports back what that element took", () => {
    const el = document.createElement("div");
    // jsdom does not lay out, so scrollTop would clamp to 0; make it settable.
    let value = 0;
    Object.defineProperty(el, "scrollTop", {
      get: () => value,
      set: (v: number) => {
        value = v;
      },
      configurable: true,
    });
    const onScrollTop = vi.fn();
    render(<Harness scrollEl={el} onScrollTop={onScrollTop} />);

    const canvas = screen.getByTestId("diff-minimap");
    pointer(canvas, "pointerdown", { clientY: 300 });

    expect(onScrollTop).toHaveBeenCalled();
    expect(onScrollTop.mock.calls[0][0]).toBe(value);
    // 400 rows × 18.6 = 7440px of content in a 600px gutter, viewport 600 → the
    // press is well inside the file, so it must have moved.
    expect(value).toBeGreaterThan(0);
  });

  it("ignores a non-primary button so a right-click stays the pane's", () => {
    const el = document.createElement("div");
    const onScrollTop = vi.fn();
    render(<Harness scrollEl={el} onScrollTop={onScrollTop} />);
    pointer(screen.getByTestId("diff-minimap"), "pointerdown", {
      button: 2,
      clientY: 300,
    });
    expect(onScrollTop).not.toHaveBeenCalled();
  });

  it("marks itself while scrubbing, and stops when the pointer is released", () => {
    const el = document.createElement("div");
    render(<Harness scrollEl={el} />);
    const canvas = screen.getByTestId("diff-minimap");
    expect(canvas).not.toHaveAttribute("data-scrubbing");
    pointer(canvas, "pointerdown", { clientY: 200 });
    expect(canvas).toHaveAttribute("data-scrubbing");
    pointer(canvas, "pointerup");
    expect(canvas).not.toHaveAttribute("data-scrubbing");
  });

  it("forwards the wheel to the diff — the gutter is a sibling, not a child", () => {
    // Over the gutter there is no scrollable ancestor, so without this the wheel
    // is the one gesture in the app that does nothing.
    const el = document.createElement("div");
    let value = 100;
    Object.defineProperty(el, "scrollTop", {
      get: () => value,
      set: (v: number) => {
        value = v;
      },
      configurable: true,
    });
    const onScrollTop = vi.fn();
    render(<Harness scrollEl={el} onScrollTop={onScrollTop} />);
    fireEvent.wheel(screen.getByTestId("diff-minimap"), { deltaY: 240 });
    expect(value).toBe(340);
    expect(onScrollTop).toHaveBeenCalledWith(340);
  });

  it("falls back to MOUSE events on a stack that delivers no pointerdown", () => {
    // Measured on WebKitGTK 605 (the e2e/CI webview): a real pointer action there
    // delivers mousedown only. Without this path the whole feature is decorative
    // on that stack.
    const el = document.createElement("div");
    let value = 0;
    Object.defineProperty(el, "scrollTop", {
      get: () => value,
      set: (v: number) => {
        value = v;
      },
      configurable: true,
    });
    render(<Harness scrollEl={el} />);
    const canvas = screen.getByTestId("diff-minimap");
    fireEvent.mouseDown(canvas, { button: 0, clientY: 300 });
    expect(canvas).toHaveAttribute("data-scrubbing");
    expect(value).toBeGreaterThan(0);

    // The drag is followed on `document`, since there is no pointer capture here.
    const first = value;
    fireEvent.mouseMove(document, { clientY: 400 });
    expect(value).not.toBe(first);
    fireEvent.mouseUp(document);
    expect(canvas).not.toHaveAttribute("data-scrubbing");
  });

  it("declines the mouse fallback once a real pointerdown has been seen", () => {
    // A compliant browser fires pointerdown BEFORE mousedown for one gesture, so
    // both paths must never run for the same press.
    const el = document.createElement("div");
    let sets = 0;
    Object.defineProperty(el, "scrollTop", {
      get: () => 0,
      set: () => {
        sets++;
      },
      configurable: true,
    });
    render(<Harness scrollEl={el} />);
    const canvas = screen.getByTestId("diff-minimap");
    pointer(canvas, "pointerdown", { clientY: 300 });
    const afterPointer = sets;
    expect(afterPointer).toBeGreaterThan(0);
    fireEvent.mouseDown(canvas, { button: 0, clientY: 300 });
    expect(sets).toBe(afterPointer);
  });

  it("does not move on a pointermove that is not part of a scrub", () => {
    const el = document.createElement("div");
    const onScrollTop = vi.fn();
    render(<Harness scrollEl={el} onScrollTop={onScrollTop} />);
    pointer(screen.getByTestId("diff-minimap"), "pointermove", { clientY: 300 });
    expect(onScrollTop).not.toHaveBeenCalled();
  });
});
