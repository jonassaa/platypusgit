// Choosing where a custom action shows up (#225, second half).
//
// The list, the parser refusal and the placeholder substitution all have their
// own tests. What only this control can get wrong is the SURFACE choice: an
// action saved with no surface at all exists in Settings and can never be run,
// and an action whose toggles say one thing while the stored list says another
// disappears from the menu its owner just placed it on.
import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CustomActionsSettings } from "./CustomActionsSettings";
import { useSettingsStore } from "@/features/settings/useSettingsStore";

const stored = () => useSettingsStore.getState().customActions;

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.getState().reset();
});

async function startNewAction(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId("custom-action-add"));
  await user.type(screen.getByTestId("custom-action-name-input"), "Open");
  await user.type(screen.getByTestId("custom-action-command-input"), "code $FILE");
}

describe("the surface toggles on a custom action", () => {
  it("starts a new action in the palette and nowhere else", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-save"));

    expect(stored()).toHaveLength(1);
    expect(stored()[0].surfaces).toEqual(["repo"]);
  });

  it("places an action on the file menu without taking it out of the palette", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-surface-file"));
    await user.click(screen.getByTestId("custom-action-save"));

    expect(stored()[0].surfaces).toEqual(["repo", "file"]);
  });

  it("stores the surfaces in catalog order however they are clicked", async () => {
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    // Back-to-front on purpose: two actions ticked the same way must compare
    // equal, which is what lets a settings export diff cleanly.
    await user.click(screen.getByTestId("custom-action-surface-commit"));
    await user.click(screen.getByTestId("custom-action-surface-file"));
    await user.click(screen.getByTestId("custom-action-surface-repo"));
    await user.click(screen.getByTestId("custom-action-save"));

    expect(stored()[0].surfaces).toEqual(["file", "commit"]);
  });

  it("refuses to save an action that would show up nowhere", async () => {
    // Not silently putting a surface back: the cause stays on screen — three
    // empty toggles — instead of the app overruling the click that emptied them.
    const user = userEvent.setup();
    render(<CustomActionsSettings />);
    await startNewAction(user);
    await user.click(screen.getByTestId("custom-action-surface-repo"));

    expect(screen.getByTestId("custom-action-save")).toBeDisabled();
    await user.click(screen.getByTestId("custom-action-save"));
    expect(stored()).toEqual([]);
  });

  it("says where a saved action shows up, on its row", async () => {
    useSettingsStore.getState().set("customActions", [
      {
        id: "a1",
        name: "Open",
        command: "code $FILE",
        showOutput: false,
        refreshAfter: false,
        surfaces: ["file", "commit"],
        chord: "",
      },
    ]);
    render(<CustomActionsSettings />);
    expect(screen.getByTestId("custom-action-row")).toHaveTextContent(
      "File menu, Commit menu",
    );
  });

  it("shows an action saved before surfaces existed as a palette action", async () => {
    // The migration, where its owner looks for it. `coerceCustomActions` fills
    // the field in on load; the row must not render a blank "shows up nowhere".
    const user = userEvent.setup();
    useSettingsStore.getState().set("customActions", [
      {
        id: "a1",
        name: "Open",
        command: "code $FILE",
        showOutput: false,
        refreshAfter: false,
      } as never,
    ]);
    render(<CustomActionsSettings />);
    expect(screen.getByTestId("custom-action-row")).toHaveTextContent(
      "Command palette",
    );

    // And the editor opens with that same answer ticked, rather than empty.
    await user.click(screen.getByTestId("custom-action-edit"));
    await user.click(screen.getByTestId("custom-action-save"));
    expect(stored()[0].surfaces).toEqual(["repo"]);
  });
});
