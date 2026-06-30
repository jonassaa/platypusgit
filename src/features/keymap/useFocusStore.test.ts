import { describe, it, expect, beforeEach } from "vitest";
import { useFocusStore } from "./useFocusStore";

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
    s.register("activitybar", {}, { isBar: true, autoFocus: false });
    expect(useFocusStore.getState().focused).toBe(null);
    s.register("repo.tree", { left: "activitybar" });
    expect(useFocusStore.getState().focused).toBe("repo.tree");
  });

  it("requestContentFocus focuses the first non-bar pane", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", {}, { isBar: true, autoFocus: false });
    s.register("repo.tree", {});
    s.register("repo.preview", {});
    useFocusStore.setState({ focused: "activitybar" });
    useFocusStore.getState().requestContentFocus();
    expect(useFocusStore.getState().focused).toBe("repo.tree");
  });

  it("move right from the bar enters the content area", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", {}, { isBar: true, autoFocus: false });
    s.register("repo.tree", { left: "activitybar" });
    useFocusStore.setState({ focused: "activitybar" });
    useFocusStore.getState().move("right");
    expect(useFocusStore.getState().focused).toBe("repo.tree");
  });

  it("move left from the leftmost content pane reaches the bar", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", {}, { isBar: true, autoFocus: false });
    s.register("repo.tree", { left: "activitybar" });
    useFocusStore.setState({ focused: "repo.tree" });
    useFocusStore.getState().move("left");
    expect(useFocusStore.getState().focused).toBe("activitybar");
  });

  it("a pending content-focus request is claimed by the next content pane", () => {
    const s = useFocusStore.getState();
    s.register("activitybar", {}, { isBar: true, autoFocus: false });
    useFocusStore.setState({ focused: "activitybar" });
    // No content panes yet → request is armed.
    useFocusStore.getState().requestContentFocus();
    expect(useFocusStore.getState().pendingContentFocus).toBe(true);
    // Next content pane to mount claims it.
    s.register("history.list", {});
    expect(useFocusStore.getState().focused).toBe("history.list");
    expect(useFocusStore.getState().pendingContentFocus).toBe(false);
  });
});
