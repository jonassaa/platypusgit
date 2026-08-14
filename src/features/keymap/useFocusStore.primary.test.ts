// A screen names its main pane (`<PGPane primary>`), and that outranks mount
// order and geometry for the two moments that used to guess: entering a screen,
// and Alt+Right off the activity bar.
import { describe, expect, it, beforeEach } from "vitest";

import { useFocusStore } from "./useFocusStore";

/** Panes need a non-zero rect to count as laid out; jsdom reports zeros. */
function paneEl(rect: { left: number; top: number; right: number; bottom: number }) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

// The real geometry that made this wrong: a full-height activity bar, the log
// filling the top-right, and a detail panel across the bottom. From the bar's
// vertical middle the bottom panel is the nearest pane to the right.
const BAR = paneEl({ left: 0, top: 0, right: 44, bottom: 800 });
const LIST = paneEl({ left: 44, top: 0, right: 1200, bottom: 400 });
const DETAIL = paneEl({ left: 44, top: 400, right: 1200, bottom: 800 });

function reset() {
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    primaryId: null,
    pendingContentFocus: false,
  });
}

/** Register in the order the DOM mounts them: bar, then detail, then list. */
function mountScreen() {
  const store = useFocusStore.getState();
  store.register("activitybar", BAR, { isBar: true, autoFocus: false });
  store.register("history.detail", DETAIL, { autoFocus: true });
  store.register("history.list", LIST, { autoFocus: true, isPrimary: true });
}

describe("primary pane", () => {
  beforeEach(reset);

  it("wins screen entry even when it mounted last", () => {
    mountScreen();
    useFocusStore.getState().requestContentFocus();
    expect(useFocusStore.getState().focused).toBe("history.list");
  });

  it("is where Alt+Right off the activity bar lands, not the nearest pane", () => {
    mountScreen();
    useFocusStore.getState().focus("activitybar");
    useFocusStore.getState().move("right");
    expect(useFocusStore.getState().focused).toBe("history.list");
  });

  it("leaves ordinary spatial moves to geometry", () => {
    mountScreen();
    useFocusStore.getState().focus("history.list");
    useFocusStore.getState().move("down");
    expect(useFocusStore.getState().focused).toBe("history.detail");
    useFocusStore.getState().move("left");
    expect(useFocusStore.getState().focused).toBe("activitybar");
  });

  it("falls back to geometry when the screen names no primary", () => {
    const store = useFocusStore.getState();
    store.register("activitybar", BAR, { isBar: true, autoFocus: false });
    store.register("b.detail", DETAIL, { autoFocus: true });
    store.register("b.list", LIST, { autoFocus: true });
    useFocusStore.getState().requestContentFocus();
    // Top-leftmost content pane.
    expect(useFocusStore.getState().focused).toBe("b.list");
  });

  it("forgets the primary when that pane unmounts", () => {
    mountScreen();
    const unregister = useFocusStore
      .getState()
      .register("x.only", LIST, { autoFocus: true, isPrimary: true });
    expect(useFocusStore.getState().primaryId).toBe("x.only");
    unregister();
    expect(useFocusStore.getState().primaryId).toBeNull();
  });

  it("keeps exactly one pane focused at a time", () => {
    mountScreen();
    useFocusStore.getState().requestContentFocus();
    const s = useFocusStore.getState();
    const focusedCount = s.order.filter((id) => id === s.focused).length;
    expect(focusedCount).toBe(1);
  });
});
