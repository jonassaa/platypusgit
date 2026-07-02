import { describe, it, expect, beforeEach } from "vitest";
import { useFocusStore } from "./useFocusStore";

// Geometry-dependent behavior (move/first-pane spatial ordering) is covered by
// spatial.test.ts — jsdom has no layout, so these tests exercise registration,
// ordering fallback, bar exclusion and pending-focus only.

function reset() {
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
}

describe("useFocusStore", () => {
  beforeEach(reset);

  it("bar pane does not auto-grab focus; first content pane does", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", null, { isBar: true, autoFocus: false });
    expect(useFocusStore.getState().focused).toBe(null);
    expect(useFocusStore.getState().barId).toBe("activitybar");
    s.register("repo.tree", null);
    expect(useFocusStore.getState().focused).toBe("repo.tree");
  });

  it("requestContentFocus focuses the first non-bar pane", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", null, { isBar: true, autoFocus: false });
    s.register("repo.tree", null);
    s.register("repo.preview", null);
    useFocusStore.setState({ focused: "activitybar" });
    useFocusStore.getState().requestContentFocus();
    expect(useFocusStore.getState().focused).toBe("repo.tree");
  });

  it("a pending content-focus request is claimed by the next content pane", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", null, { isBar: true, autoFocus: false });
    useFocusStore.setState({ focused: "activitybar" });
    useFocusStore.getState().requestContentFocus();
    expect(useFocusStore.getState().pendingContentFocus).toBe(true);
    s.register("history.list", null);
    expect(useFocusStore.getState().focused).toBe("history.list");
    expect(useFocusStore.getState().pendingContentFocus).toBe(false);
  });

  it("unregistering the focused pane falls back to another content pane", () => {
    const s = useFocusStore.getState();
    const un = s.register("a", null);
    s.register("b", null);
    expect(useFocusStore.getState().focused).toBe("a");
    un();
    expect(useFocusStore.getState().focused).toBe("b");
  });

  describe("cycle (Tab order)", () => {
    it("cycles panes in registration order without layout, wrapping", () => {
      const s = useFocusStore.getState();
      s.register("a", null);
      s.register("b", null);
      s.register("c", null);
      useFocusStore.setState({ focused: "a" });
      useFocusStore.getState().cycle(1);
      expect(useFocusStore.getState().focused).toBe("b");
      useFocusStore.getState().cycle(1);
      expect(useFocusStore.getState().focused).toBe("c");
      useFocusStore.getState().cycle(1); // wraps
      expect(useFocusStore.getState().focused).toBe("a");
    });

    it("cycles backwards with Shift+Tab, wrapping to the end", () => {
      const s = useFocusStore.getState();
      s.register("a", null);
      s.register("b", null);
      useFocusStore.setState({ focused: "a" });
      useFocusStore.getState().cycle(-1);
      expect(useFocusStore.getState().focused).toBe("b");
    });

    it("focuses the first pane when nothing is focused yet", () => {
      const s = useFocusStore.getState();
      s.register("a", null, { autoFocus: false });
      useFocusStore.setState({ focused: null });
      useFocusStore.getState().cycle(1);
      expect(useFocusStore.getState().focused).toBe("a");
    });
  });
});
