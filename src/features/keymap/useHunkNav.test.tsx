// useHunkNav — F7/⇧F7 hunk cursor for diff panes: advances/retreats with
// clamping, scrolls the active hunk into view, resets when the viewed file
// changes, and answers only while one of its panes holds focus.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useHunkNav } from "./useHunkNav";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";

function Harness({
  count,
  resetKey,
  onCursor,
}: {
  count: number;
  resetKey: string;
  onCursor: (c: number) => void;
}) {
  const cursor = useHunkNav({
    paneIds: ["d.files", "d.view"],
    count,
    resetKey,
  });
  onCursor(cursor);
  return null;
}

const key = (k: string, shift = false) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: shift,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

function press(k: string, shift = false): boolean {
  let handled = false;
  act(() => {
    handled = useKeymapStore.getState().dispatch(key(k, shift));
  });
  return handled;
}

describe("useHunkNav", () => {
  let cursor = -1;
  const onCursor = (c: number) => {
    cursor = c;
  };

  beforeEach(() => {
    cursor = -1;
    Element.prototype.scrollIntoView = vi.fn();
    useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
    useKeymapStore.getState().setPreset("rider");
    useFocusStore.setState({
      focused: null,
      panes: new Map(),
      order: [],
      barId: null,
      pendingContentFocus: false,
    });
  });

  it("F7 walks forward with clamping; ⇧F7 walks back", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.view" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(0);
    press("F7");
    press("F7");
    expect(cursor).toBe(2);
    press("F7"); // clamp
    expect(cursor).toBe(2);
    press("F7", true); // Shift+F7
    expect(cursor).toBe(1);
  });

  it("answers from the file-list pane too, declines with no hunks", () => {
    render(<Harness count={0} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(false);
  });

  it("declines while an unrelated pane holds focus", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "elsewhere" });
    expect(press("F7")).toBe(false);
    expect(cursor).toBe(-1);
  });

  it("resets the cursor when the viewed file changes", () => {
    const { rerender } = render(
      <Harness count={3} resetKey="a" onCursor={onCursor} />,
    );
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    press("F7");
    expect(cursor).toBe(1);
    rerender(<Harness count={3} resetKey="b" onCursor={onCursor} />);
    expect(cursor).toBe(-1);
  });
});
