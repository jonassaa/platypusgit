import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";
import { useOverlayStore } from "./useOverlayStore";
import { useSpeedSearchStore } from "./useSpeedSearchStore";
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

    it("Alt+Arrow is suppressed — it is caret word/paragraph movement on mac", () => {
      // Alt carries a "real modifier", but pane traversal must not eat the
      // macOS ⌥←/⌥→ caret jumps in the commit box (keymap review F1).
      const handled = useKeymapStore
        .getState()
        .dispatch(
          key({ key: "ArrowLeft", metaKey: false, altKey: true }, ta()),
        );
      expect(handled).toBe(false);
    });

    it("DoubleShift opens the palette even while typing (Rider allows it)", () => {
      const s = useKeymapStore.getState();
      const shiftInInput = () =>
        key(
          { key: "Shift", metaKey: false, shiftKey: true, repeat: false } as never,
          ta(),
        );
      expect(s.dispatch(shiftInInput())).toBe(false); // first tap: pending
      expect(s.dispatch(shiftInInput())).toBe(true); // second tap: palette
      expect(usePaletteStore.getState().open).toBe(true);
    });
  });

  it("Mod+P is claimed even when the palette is already open (webview Print)", () => {
    // An unclaimed ⌘P/Ctrl+P falls through to the webview's native Print
    // dialog (keymap review F6) — the runner must claim it as a no-op.
    usePaletteStore.setState({ open: true });
    const prevent = vi.fn();
    const handled = useKeymapStore.getState().dispatch(
      key({ key: "p", code: "KeyP", preventDefault: prevent } as never),
    );
    expect(handled).toBe(true);
    expect(prevent).toHaveBeenCalledOnce();
    expect(usePaletteStore.getState().open).toBe(true);
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

  describe("speed-search fallback", () => {
    let unregister: () => void;

    beforeEach(() => {
      useSpeedSearchStore.setState({ queries: {} });
      unregister = useKeymapStore.getState().registerSpeedSearch("list");
      useFocusStore.setState({ focused: "list" });
    });

    const q = () => useSpeedSearchStore.getState().queries["list"] ?? "";

    it("unbound printable keys build the focused pane's query and claim", () => {
      const s = useKeymapStore.getState();
      expect(s.dispatch(key({ key: "f", code: "KeyF", metaKey: false }))).toBe(true);
      expect(s.dispatch(key({ key: "e", code: "KeyE", metaKey: false }))).toBe(true);
      expect(q()).toBe("fe");
      unregister();
    });

    it("Backspace pops a character; on an empty query it falls through", () => {
      const s = useKeymapStore.getState();
      s.dispatch(key({ key: "f", code: "KeyF", metaKey: false }));
      expect(s.dispatch(key({ key: "Backspace", metaKey: false }))).toBe(true);
      expect(q()).toBe("");
      expect(s.dispatch(key({ key: "Backspace", metaKey: false }))).toBe(false);
      unregister();
    });

    it("modifier chords and editable targets never touch the query", () => {
      const s = useKeymapStore.getState();
      expect(s.dispatch(key({ key: "f", code: "KeyF" }))).toBe(false); // Mod+F unbound
      const ta = document.createElement("textarea");
      expect(s.dispatch(key({ key: "f", code: "KeyF", metaKey: false }, ta))).toBe(false);
      expect(q()).toBe("");
      unregister();
    });

    it("a pane without speed-search registered gets no query", () => {
      unregister();
      const s = useKeymapStore.getState();
      expect(s.dispatch(key({ key: "f", code: "KeyF", metaKey: false }))).toBe(false);
      expect(q()).toBe("");
    });

    it("pane focus change clears queries", () => {
      const s = useKeymapStore.getState();
      s.dispatch(key({ key: "f", code: "KeyF", metaKey: false }));
      expect(q()).toBe("f");
      useFocusStore.setState({ focused: "elsewhere" });
      expect(q()).toBe("");
      unregister();
    });
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
