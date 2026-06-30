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
});
