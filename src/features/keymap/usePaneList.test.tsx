import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";
import { usePaneList } from "./usePaneList";
import { useKeymapStore } from "./useKeymapStore";
import { useFocusStore } from "./useFocusStore";
import { useSpeedSearchStore } from "./useSpeedSearchStore";

function ListHarness({
  paneId,
  count,
  selected,
  onSelect,
  onActivate,
  onToggle,
  searchText,
}: {
  paneId: string;
  count: number;
  selected: number;
  onSelect: (i: number) => void;
  onActivate?: (i: number) => void;
  onToggle?: (i: number) => void;
  searchText?: (i: number) => string;
}) {
  usePaneList({
    paneId,
    count,
    selectedIndex: selected,
    onSelect,
    onActivate,
    onToggle,
    searchText,
  });
  return null;
}

const key = (k: string) =>
  ({
    key: k,
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

function reset() {
  useKeymapStore.setState({ handlers: new Map(), lastShiftAt: 0 });
  useKeymapStore.getState().setPreset("rider");
  useFocusStore.setState({
    focused: null,
    panes: new Map(),
    order: [],
    barId: null,
    pendingContentFocus: false,
  });
}

describe("usePaneList", () => {
  beforeEach(reset);

  it("arrow keys move the selection while the pane is focused", () => {
    const onSelect = vi.fn();
    render(
      <ListHarness paneId="p" count={3} selected={1} onSelect={onSelect} />,
    );
    useFocusStore.setState({ focused: "p" });
    useKeymapStore.getState().dispatch(key("ArrowDown"));
    expect(onSelect).toHaveBeenLastCalledWith(2);
    useKeymapStore.getState().dispatch(key("ArrowUp"));
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it("clamps at both ends", () => {
    const onSelect = vi.fn();
    render(
      <ListHarness paneId="p" count={3} selected={2} onSelect={onSelect} />,
    );
    useFocusStore.setState({ focused: "p" });
    useKeymapStore.getState().dispatch(key("ArrowDown"));
    expect(onSelect).toHaveBeenLastCalledWith(2);
  });

  it("Home/End jump to first/last item", () => {
    const onSelect = vi.fn();
    render(
      <ListHarness paneId="p" count={5} selected={2} onSelect={onSelect} />,
    );
    useFocusStore.setState({ focused: "p" });
    useKeymapStore.getState().dispatch(key("Home"));
    expect(onSelect).toHaveBeenLastCalledWith(0);
    useKeymapStore.getState().dispatch(key("End"));
    expect(onSelect).toHaveBeenLastCalledWith(4);
  });

  it("Enter activates, Space toggles", () => {
    const onActivate = vi.fn();
    const onToggle = vi.fn();
    render(
      <ListHarness
        paneId="p"
        count={3}
        selected={1}
        onSelect={() => {}}
        onActivate={onActivate}
        onToggle={onToggle}
      />,
    );
    useFocusStore.setState({ focused: "p" });
    useKeymapStore.getState().dispatch(key("Enter"));
    expect(onActivate).toHaveBeenCalledWith(1);
    useKeymapStore.getState().dispatch(key(" "));
    expect(onToggle).toHaveBeenCalledWith(1);
  });

  it("does nothing while another pane is focused (keys fall through)", () => {
    const onSelect = vi.fn();
    render(
      <ListHarness paneId="p" count={3} selected={1} onSelect={onSelect} />,
    );
    useFocusStore.setState({ focused: "other" });
    const handled = useKeymapStore.getState().dispatch(key("ArrowDown"));
    expect(handled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("declines on an empty list so keys fall through", () => {
    render(
      <ListHarness paneId="p" count={0} selected={0} onSelect={() => {}} />,
    );
    useFocusStore.setState({ focused: "p" });
    expect(useKeymapStore.getState().dispatch(key("ArrowDown"))).toBe(false);
  });

  it("two lists coexist — only the focused pane's list reacts", () => {
    const a = vi.fn();
    const b = vi.fn();
    render(
      <>
        <ListHarness paneId="a" count={3} selected={0} onSelect={a} />
        <ListHarness paneId="b" count={3} selected={0} onSelect={b} />
      </>,
    );
    useFocusStore.setState({ focused: "b" });
    useKeymapStore.getState().dispatch(key("ArrowDown"));
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(1);
  });

  describe("speed-search", () => {
    const ROWS = ["main", "feature", "fix/tab-cycle"];
    // key() helper takes only the key name — extend inline for code.
    const typedKey = (k: string, code: string) =>
      ({
        key: k,
        code,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        preventDefault() {},
        target: document.body,
      }) as unknown as KeyboardEvent;

    beforeEach(() => {
      useSpeedSearchStore.setState({ queries: {} });
    });

    it("typing jumps the selection to the first matching row", () => {
      const onSelect = vi.fn();
      render(
        <ListHarness
          paneId="p"
          count={3}
          selected={0}
          onSelect={onSelect}
          searchText={(i) => ROWS[i]}
        />,
      );
      useFocusStore.setState({ focused: "p" });
      act(() => {
        useKeymapStore.getState().dispatch(typedKey("f", "KeyF"));
      });
      expect(onSelect).toHaveBeenLastCalledWith(1); // "feature"
      act(() => {
        useKeymapStore.getState().dispatch(typedKey("i", "KeyI"));
      });
      expect(onSelect).toHaveBeenLastCalledWith(2); // "fix/tab-cycle"
    });

    it("no match leaves the selection alone", () => {
      const onSelect = vi.fn();
      render(
        <ListHarness
          paneId="p"
          count={3}
          selected={0}
          onSelect={onSelect}
          searchText={(i) => ROWS[i]}
        />,
      );
      useFocusStore.setState({ focused: "p" });
      act(() => {
        useKeymapStore.getState().dispatch(typedKey("z", "KeyZ"));
      });
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("Escape clears the query and claims; with no query it declines", () => {
      render(
        <ListHarness
          paneId="p"
          count={3}
          selected={0}
          onSelect={() => {}}
          searchText={(i) => ROWS[i]}
        />,
      );
      useFocusStore.setState({ focused: "p" });
      act(() => {
        useKeymapStore.getState().dispatch(typedKey("f", "KeyF"));
      });
      expect(useSpeedSearchStore.getState().queries["p"]).toBe("f");
      let handled = false;
      act(() => {
        handled = useKeymapStore.getState().dispatch(key("Escape"));
      });
      expect(handled).toBe(true);
      expect(useSpeedSearchStore.getState().queries["p"] ?? "").toBe("");
      act(() => {
        handled = useKeymapStore.getState().dispatch(key("Escape"));
      });
      expect(handled).toBe(false);
    });

    it("without searchText, typing falls through (no speed-search)", () => {
      render(
        <ListHarness paneId="p" count={3} selected={0} onSelect={() => {}} />,
      );
      useFocusStore.setState({ focused: "p" });
      let handled = true;
      act(() => {
        handled = useKeymapStore.getState().dispatch(typedKey("f", "KeyF"));
      });
      expect(handled).toBe(false);
    });
  });
});
