// `scrollTo` publishes the new window itself, rather than waiting for the engine
// to dispatch a scroll event for a programmatic `scrollTop` write.
//
// The regression it exists for (issue 188): MEASURED on WebKitGTK 605 under xvfb,
// an `el.scrollTop = …` assignment made inside an effect left `win` describing the
// TOP of the file for seconds — so the row being scrolled to stayed UNMOUNTED, and
// F7's `data-hunk-active`, the line cursor's focus ring and the auto-open at the
// first change all appeared to do nothing at all. Which is precisely what a scroll
// event NOT arriving looks like, so the test dispatches none.

import { describe, expect, it } from "vitest";
import React from "react";
import { act, render } from "@testing-library/react";
import { useVariableWindow } from "./useVariableWindow";
import { stubContainerSize } from "@/test/elementSize";

const ROW = 20;
const ROWS = 500;
const heights = Array.from({ length: ROWS }, () => ROW);

function Harness({ onState }: { onState: (s: { start: number; scrollTo: (t: number) => void }) => void }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const { win, scrollTo } = useVariableWindow({
    heights,
    // A measured viewport, so `windowVariable` uses it rather than its 400px
    // pre-layout fallback.
    viewportH: 400,
    scrollRef: ref,
  });
  onState({ start: win.start, scrollTo });
  return <div ref={ref} />;
}

describe("useVariableWindow", () => {
  it("scrollTo republishes the window with NO scroll event", () => {
    // jsdom performs no layout, so the container must be told what it measures —
    // and `scrollTop` is writable on an HTMLElement there, which is all this needs.
    const restore = stubContainerSize({ height: 400 });
    try {
      let state = { start: -1, scrollTo: (_t: number) => {} };
      render(<Harness onState={(s) => (state = s)} />);
      expect(state.start).toBe(0);

      // Row 300 sits at 6000px. No `dispatchEvent("scroll")` anywhere below: the
      // window must move on the strength of the call alone.
      act(() => state.scrollTo(300 * ROW));
      expect(state.start).toBeGreaterThan(280);
      expect(state.start).toBeLessThanOrEqual(300);
    } finally {
      restore();
    }
  });
});
