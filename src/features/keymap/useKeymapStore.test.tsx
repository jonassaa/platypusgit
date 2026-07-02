import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";
import { useOverlayStore } from "./useOverlayStore";
import { useNavStore } from "@/features/nav/useNavStore";
import { usePaletteStore } from "@/features/palette/usePaletteStore";
import { useAction } from "./useAction";

function Harness({
  onFiles,
  paneId,
}: {
  onFiles: () => boolean | void;
  paneId?: string;
}) {
  useAction("nav.files", onFiles, [onFiles], { paneId });
  return null;
}

const key = (over: Partial<KeyboardEvent>, target: EventTarget = document.body) =>
  ({
    key: "1",
    code: "",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target,
    ...over,
  }) as unknown as KeyboardEvent;

function resetStores() {
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
  useOverlayStore.setState({ cheatSheetOpen: false });
  useNavStore.setState({ intent: null });
  usePaletteStore.setState({ open: false });
}

describe("dispatch", () => {
  beforeEach(resetStores);

  it("fires the registered handler for Mod+1", () => {
    const spy = vi.fn();
    render(<Harness onFiles={spy} />);
    const handled = useKeymapStore.getState().dispatch(key({}));
    expect(handled).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    // Handler claimed it — the default runner must not also fire.
    expect(useNavStore.getState().intent).toBe(null);
  });

  it("falls back to the catalog default runner when nothing is registered", () => {
    const handled = useKeymapStore.getState().dispatch(key({}));
    expect(handled).toBe(true);
    expect(useNavStore.getState().intent).toEqual({
      kind: "switch-screen",
      screen: "repo",
    });
  });

  it("marks the event consumed via preventDefault", () => {
    const prevent = vi.fn();
    useKeymapStore.getState().dispatch(key({ preventDefault: prevent } as never));
    expect(prevent).toHaveBeenCalledOnce();
  });

  it("returns false for a chord with no binding", () => {
    const handled = useKeymapStore
      .getState()
      .dispatch(key({ key: "j", code: "KeyJ", metaKey: false }));
    expect(handled).toBe(false);
  });

  describe("inside text inputs", () => {
    const ta = () => document.createElement("textarea");

    it("modifier chords still dispatch (Mod+1 navigates while typing)", () => {
      const handled = useKeymapStore.getState().dispatch(key({}, ta()));
      expect(handled).toBe(true);
      expect(useNavStore.getState().intent).toEqual({
        kind: "switch-screen",
        screen: "repo",
      });
    });

    it("bare-key chords are suppressed ('?' must type, not open the cheat-sheet)", () => {
      const handled = useKeymapStore
        .getState()
        .dispatch(key({ key: "?", code: "Slash", metaKey: false }, ta()));
      expect(handled).toBe(false);
      expect(useOverlayStore.getState().cheatSheetOpen).toBe(false);
    });

    it("Escape is allowed in and closes an open overlay", () => {
      useOverlayStore.setState({ cheatSheetOpen: true });
      const handled = useKeymapStore
        .getState()
        .dispatch(key({ key: "Escape", metaKey: false }, ta()));
      expect(handled).toBe(true);
      expect(useOverlayStore.getState().cheatSheetOpen).toBe(false);
    });
  });

  it("Escape with nothing to close falls through (no swallowed keys)", () => {
    const handled = useKeymapStore
      .getState()
      .dispatch(key({ key: "Escape", metaKey: false }));
    expect(handled).toBe(false);
  });

  describe("pane scope", () => {
    it("delivers pane actions only to the focused pane's handler", () => {
      const spy = vi.fn();
      const un = useKeymapStore
        .getState()
        .register("list.up", spy, { paneId: "a" });

      useFocusStore.setState({ focused: "b" });
      expect(
        useKeymapStore
          .getState()
          .dispatch(key({ key: "ArrowUp", metaKey: false })),
      ).toBe(false);
      expect(spy).not.toHaveBeenCalled();

      useFocusStore.setState({ focused: "a" });
      expect(
        useKeymapStore
          .getState()
          .dispatch(key({ key: "ArrowUp", metaKey: false })),
      ).toBe(true);
      expect(spy).toHaveBeenCalledOnce();
      un();
    });
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

  it("dispatched in capture phase, fires even if a child stops bubbling", () => {
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

  describe("DoubleShift", () => {
    const shift = () =>
      key({ key: "Shift", metaKey: false, shiftKey: true, repeat: false } as never);

    it("two quick Shift taps open the palette", () => {
      const s = useKeymapStore.getState();
      expect(s.dispatch(shift())).toBe(false); // first tap: pending
      expect(s.dispatch(shift())).toBe(true); // second tap: DoubleShift
      expect(usePaletteStore.getState().open).toBe(true);
    });

    it("an intervening key cancels the pending tap", () => {
      const s = useKeymapStore.getState();
      expect(s.dispatch(shift())).toBe(false);
      s.dispatch(key({ key: "j", code: "KeyJ", metaKey: false }));
      expect(s.dispatch(shift())).toBe(false);
      expect(usePaletteStore.getState().open).toBe(false);
    });

    it("Shift held as part of a combo does not count as a tap", () => {
      const s = useKeymapStore.getState();
      expect(
        s.dispatch(key({ key: "Shift", metaKey: true, shiftKey: true })),
      ).toBe(false);
      expect(s.dispatch(shift())).toBe(false);
      expect(usePaletteStore.getState().open).toBe(false);
    });
  });
});
