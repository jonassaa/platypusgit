import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PGPane } from "./PGPane";
import { useFocusStore } from "./useFocusStore";

describe("PGPane", () => {
  beforeEach(() => {
    useFocusStore.setState({
      focused: null,
      panes: new Map(),
      order: [],
      barId: null,
      pendingContentFocus: false,
    });
  });

  it("registers on mount and the first content pane takes focus", () => {
    render(<PGPane id="solo">S</PGPane>);
    expect(useFocusStore.getState().focused).toBe("solo");
    expect(useFocusStore.getState().panes.has("solo")).toBe(true);
  });

  it("a bar pane does not auto-grab focus", () => {
    render(
      <PGPane id="bar" isBar>
        B
      </PGPane>,
    );
    expect(useFocusStore.getState().focused).toBe(null);
    expect(useFocusStore.getState().barId).toBe("bar");
  });

  it("unregisters on unmount", () => {
    const { unmount } = render(<PGPane id="solo">S</PGPane>);
    unmount();
    expect(useFocusStore.getState().panes.has("solo")).toBe(false);
  });
});
