// A drag must not smear a text selection across the diff.
//
// `beginDrag` does not `preventDefault` on pointerdown (it cannot: the gesture is
// only a drag once it clears the slop, and until then the event still has to
// behave like a click), so the guard against selecting while dragging has always
// been `document.body.style.userSelect = "none"`.
//
// That guard stopped being sufficient the moment the diff opted its code cells
// back IN with `.pg-selectable` — a class on the span beats an inherited value
// from body, so dragging a file row across the diff would select code. The body
// marker plus the `[data-pg-dragging]` rule in index.css is what restores it.

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { beginDrag, useDragStore } from "./dragController";

const DRAGGING_ATTR = "data-pg-dragging";

// MouseEvent, not PointerEvent: jsdom ships no PointerEvent constructor, and the
// controller only reads button/clientX/clientY/pointerId — the same shape
// dnd.test.tsx uses. `pointerId` rides along as an extra property, which is what
// `onMove`'s identity check compares.
function pointer(type: string, x: number, y: number): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

function Row() {
  return (
    <div
      data-testid="row"
      onPointerDown={(e) =>
        beginDrag(e, {
          kind: "files",
          side: "unstaged",
          paths: ["a.txt"],
          label: "a.txt",
        })
      }
    >
      a.txt
    </div>
  );
}

beforeEach(() => {
  useDragStore.setState({ payload: null, overId: null });
  document.body.style.userSelect = "";
  document.body.removeAttribute(DRAGGING_ATTR);
});

describe("a drag suppresses selection everywhere, including opted-in text", () => {
  it("marks the document while the drag is live and clears it on drop", () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId("row");

    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
    });
    // Below the slop this is still a click, so nothing is suppressed yet.
    expect(document.body.hasAttribute(DRAGGING_ATTR)).toBe(false);

    act(() => {
      row.dispatchEvent(pointer("pointermove", 60, 60));
    });
    expect(document.body.hasAttribute(DRAGGING_ATTR)).toBe(true);

    act(() => {
      window.dispatchEvent(pointer("pointerup", 60, 60));
    });
    expect(document.body.hasAttribute(DRAGGING_ATTR)).toBe(false);
  });

  it("clears the mark when the drag is cancelled rather than dropped", () => {
    const { getByTestId } = render(<Row />);
    const row = getByTestId("row");
    act(() => {
      row.dispatchEvent(pointer("pointerdown", 10, 10));
      row.dispatchEvent(pointer("pointermove", 60, 60));
    });
    expect(document.body.hasAttribute(DRAGGING_ATTR)).toBe(true);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.body.hasAttribute(DRAGGING_ATTR)).toBe(false);
  });

  // The marker only does anything because of this rule, and jsdom applies no
  // stylesheet — so pin the rule itself, the way diffSelection.test.tsx pins
  // `.pg-selectable`.
  it("is backed by a rule that overrides .pg-selectable", () => {
    const css = fs.readFileSync(
      path.join(process.cwd(), "src/index.css"),
      "utf8",
    );
    const rule = css.match(
      /body\[data-pg-dragging\][^{]*\.pg-selectable[^{]*\{[^}]*\}/,
    );
    expect(
      rule,
      "index.css must suppress .pg-selectable while a drag is live",
    ).not.toBeNull();
    expect(rule![0]).toContain("user-select: none");
    expect(rule![0]).toContain("-webkit-user-select: none");
  });
});
