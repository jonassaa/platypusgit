// useHunkNav — F7/⇧F7 hunk cursor for diff panes: advances/retreats with
// clamping, scrolls the active hunk into view, resets when the viewed file
// changes, and answers only while one of its panes holds focus.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render } from "@testing-library/react";
import { useHunkNav } from "./useHunkNav";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";

function Harness({
  count,
  resetKey,
  onCursor,
  paneIds = ["d.files", "d.view"],
}: {
  count: number;
  resetKey: string;
  onCursor: (c: number) => void;
  paneIds?: string[];
}) {
  const cursor = useHunkNav({ paneIds, count, resetKey });
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

/** A pane element carrying one `[data-hunk-index]` wrapper per hunk, each with
 *  its own scrollIntoView spy so the "first matching pane" pick is observable. */
function mountPane(paneId: string, hunks: number[]): Map<number, () => void> {
  const pane = document.createElement("div");
  pane.setAttribute("data-pg-pane", paneId);
  const spies = new Map<number, () => void>();
  for (const i of hunks) {
    const hunk = document.createElement("div");
    hunk.setAttribute("data-hunk-index", String(i));
    const spy = vi.fn();
    hunk.scrollIntoView = spy;
    spies.set(i, spy);
    pane.appendChild(hunk);
  }
  document.body.appendChild(pane);
  return spies;
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

  afterEach(() => {
    document.body.innerHTML = "";
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
    press("F7", true);
    press("F7", true); // clamp at the first hunk
    expect(cursor).toBe(0);
  });

  it("answers from the file-list pane too, declines with no hunks", () => {
    const { rerender } = render(
      <Harness count={3} resetKey="a" onCursor={onCursor} />,
    );
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(0);
    // Same chord, other pane of the same screen — one registration serves both.
    useFocusStore.setState({ focused: "d.view" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(1);

    rerender(<Harness count={0} resetKey="b" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(false);
  });

  it("declines while an unrelated pane holds focus, or with no pane focused", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "elsewhere" });
    expect(press("F7")).toBe(false);
    expect(press("F7", true)).toBe(false);
    expect(cursor).toBe(-1);
    useFocusStore.setState({ focused: null });
    expect(press("F7")).toBe(false);
    expect(cursor).toBe(-1);
  });

  it("scopes follow a changed pane list", () => {
    const { rerender } = render(
      <Harness
        count={3}
        resetKey="a"
        onCursor={onCursor}
        paneIds={["d.files", "d.view"]}
      />,
    );
    rerender(
      <Harness count={3} resetKey="a" onCursor={onCursor} paneIds={["d.view"]} />,
    );
    useFocusStore.setState({ focused: "d.files" });
    expect(press("F7")).toBe(false);
    expect(cursor).toBe(-1);
    useFocusStore.setState({ focused: "d.view" });
    expect(press("F7")).toBe(true);
    expect(cursor).toBe(0);
  });

  it("scrolls the FIRST pane that renders the target hunk", () => {
    const files = mountPane("d.files", [0]); // a stand-in leading pane
    const view = mountPane("d.view", [0]);
    render(<Harness count={2} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.view" });
    press("F7");
    expect(files.get(0)).toHaveBeenCalledOnce();
    expect(view.get(0)).not.toHaveBeenCalled();
  });

  it("falls through to a later pane when the earlier one lacks the hunk", () => {
    mountPane("d.files", []); // file list never renders hunk wrappers
    const view = mountPane("d.view", [0, 1]);
    render(<Harness count={2} resetKey="a" onCursor={onCursor} />);
    useFocusStore.setState({ focused: "d.files" });
    press("F7");
    expect(view.get(0)).toHaveBeenCalledOnce();
    press("F7");
    expect(view.get(1)).toHaveBeenCalledOnce();
    expect(view.get(0)).toHaveBeenCalledOnce();
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

  it("registers one handler per action, not one per pane", () => {
    render(<Harness count={3} resetKey="a" onCursor={onCursor} />);
    const handlers = useKeymapStore.getState().handlers;
    expect(handlers.get("diff.nextChange")?.length).toBe(1);
    expect(handlers.get("diff.prevChange")?.length).toBe(1);
  });
});
