import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheatSheet } from "./CheatSheet";
import { useOverlayStore } from "./useOverlayStore";
import { ALL_ACTION_IDS, ACTIONS } from "./actions";
import { useKeymapStore } from "./useKeymapStore";

describe("CheatSheet", () => {
  beforeEach(() => {
    useKeymapStore.getState().setPreset("rider");
    useKeymapStore.setState({ userBindings: new Map() });
  });

  it("renders nothing when closed", () => {
    useOverlayStore.setState({ cheatSheetOpen: false });
    const { container } = render(<CheatSheet />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a row for every catalog action when open", () => {
    useOverlayStore.setState({ cheatSheetOpen: true });
    render(<CheatSheet />);
    for (const id of ALL_ACTION_IDS) {
      expect(screen.getByText(ACTIONS[id].title)).toBeTruthy();
    }
  });

  it("shows the active preset name", () => {
    useOverlayStore.setState({ cheatSheetOpen: true });
    render(<CheatSheet />);
    expect(screen.getByText(/Rider/)).toBeTruthy();
  });

  // User-defined shortcuts (#225) are rendered from the dispatcher's OWN table,
  // so a chord that fires is a chord the sheet lists — the same reason the rest
  // of the sheet is derived from the catalog and the preset.
  it("lists a custom action's shortcut", () => {
    useOverlayStore.setState({ cheatSheetOpen: true });
    useKeymapStore.setState({
      userBindings: new Map([
        ["Mod+Shift+X", { title: "Deploy", run: () => true }],
      ]),
    });
    render(<CheatSheet />);
    expect(screen.getByTestId("cheat-sheet-custom")).toBeTruthy();
    expect(screen.getByText("Deploy")).toBeTruthy();
  });

  it("has no custom section when nothing is bound", () => {
    useOverlayStore.setState({ cheatSheetOpen: true });
    render(<CheatSheet />);
    expect(screen.queryByTestId("cheat-sheet-custom")).toBeNull();
  });
});
