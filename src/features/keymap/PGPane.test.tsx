import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { PGPane } from "./PGPane";
import { useFocusStore } from "./useFocusStore";
import { useKeymapStore } from "./useKeymapStore";
import { useAction } from "./useAction";

function FocusActions() {
  useAction("pane.focusRight", () => useFocusStore.getState().move("right"), []);
  return null;
}

const altRight = () =>
  ({
    key: "ArrowRight",
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault() {},
    target: document.body,
  }) as unknown as KeyboardEvent;

describe("focus model", () => {
  beforeEach(() => {
    useFocusStore.setState({ focused: null, panes: new Map() });
    useKeymapStore.setState({ handlers: new Map() });
  });

  it("Alt+ArrowRight moves focus to the declared right neighbor", () => {
    render(
      <>
        <FocusActions />
        <PGPane id="a" neighbors={{ right: "b" }}>
          A
        </PGPane>
        <PGPane id="b" neighbors={{ left: "a" }}>
          B
        </PGPane>
      </>,
    );
    useFocusStore.getState().focus("a");
    const handled = useKeymapStore.getState().dispatch(altRight());
    expect(handled).toBe(true);
    expect(useFocusStore.getState().focused).toBe("b");
  });

  it("first registered pane takes focus automatically", () => {
    render(
      <PGPane id="solo" neighbors={{}}>
        S
      </PGPane>,
    );
    expect(useFocusStore.getState().focused).toBe("solo");
  });
});
