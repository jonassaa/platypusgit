import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useKeymapStore } from "./useKeymapStore";
import { useAction } from "./useAction";

function Harness({ onFiles }: { onFiles: () => void }) {
  useAction("nav.files", onFiles, [onFiles]);
  return null;
}

const key = (over: Partial<KeyboardEvent>, target: EventTarget = document.body) =>
  ({
    key: "1",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target,
    ...over,
  }) as unknown as KeyboardEvent;

describe("dispatch", () => {
  beforeEach(() => {
    useKeymapStore.setState({ handlers: new Map() });
  });

  it("fires the registered handler for Mod+1", () => {
    const spy = vi.fn();
    render(<Harness onFiles={spy} />);
    const handled = useKeymapStore.getState().dispatch(key({}));
    expect(handled).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("ignores a nav action when typing in a textarea", () => {
    const spy = vi.fn();
    render(<Harness onFiles={spy} />);
    const ta = document.createElement("textarea");
    const handled = useKeymapStore.getState().dispatch(key({}, ta));
    expect(handled).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns false when no handler is registered for the chord", () => {
    const handled = useKeymapStore.getState().dispatch(key({}));
    expect(handled).toBe(false);
  });

  it("dispatched in capture phase, fires even if a child stops bubbling", () => {
    // Reproduces the Alt+Arrow regression: a focused element stops keydown
    // during bubble, so a bubble-phase window listener never sees it. A
    // capture-phase listener (how AppShell wires dispatch) must still fire.
    const spy = vi.fn();
    render(<Harness onFiles={spy} />);

    const child = document.createElement("button");
    document.body.appendChild(child);
    child.addEventListener("keydown", (e) => e.stopPropagation()); // bubble stop

    const captureListener = (e: KeyboardEvent) =>
      useKeymapStore.getState().dispatch(e);
    window.addEventListener("keydown", captureListener, true);

    child.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "1",
        metaKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    window.removeEventListener("keydown", captureListener, true);
    document.body.removeChild(child);
    expect(spy).toHaveBeenCalledOnce();
  });

  it("falls through to an outer handler when the inner one declines", () => {
    const outer = vi.fn(() => true);
    const inner = vi.fn(() => false); // declines
    const store = useKeymapStore.getState();
    store.register("nav.files", outer); // registered first = outer
    store.register("nav.files", inner); // registered last = innermost
    const handled = store.dispatch(key({}));
    expect(handled).toBe(true);
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).toHaveBeenCalledOnce();
  });
});
