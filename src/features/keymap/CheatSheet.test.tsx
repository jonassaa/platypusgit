import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheatSheet } from "./CheatSheet";
import { useOverlayStore } from "./useOverlayStore";
import { ALL_ACTION_IDS, ACTIONS } from "./actions";
import { useKeymapStore } from "./useKeymapStore";

describe("CheatSheet", () => {
  beforeEach(() => {
    useKeymapStore.getState().setPreset("rider");
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
});
