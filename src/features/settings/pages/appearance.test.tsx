// Creating a theme used to be reachable only through a card's Duplicate
// button, which meant "make me a theme" was spelled as "copy that one". The
// Add theme button is the direct entry; the editor's own "Start from" picker
// is what changes the palette it begins on.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useThemeEditorStore } from "@/features/settings/theme/useThemeEditorStore";

import { AppearancePage } from "./appearance";

const ed = () => useThemeEditorStore.getState();
const st = () => useSettingsStore.getState();

function mount() {
  return render(
    <WithDialogs>
      <AppearancePage />
    </WithDialogs>,
  );
}

describe("AppearancePage — Add theme", () => {
  beforeEach(() => {
    resetDialogs();
    ed().close();
    st().reset();
  });

  it("starts a new draft from the theme that is active", () => {
    st().setActiveThemeId("nord");
    mount();

    fireEvent.click(screen.getByRole("button", { name: "Add theme" }));

    expect(ed().open?.mode).toBe("new");
    expect(ed().baseId).toBe("nord");
    expect(ed().name).toBe("Nord (custom)");
  });

  it("opens the editor, where the base can still be changed", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add theme" }));
    // The page mounts the editor, so the button is a complete route to it —
    // not a store poke some other surface has to notice.
    expect(screen.getByTestId("theme-editor-name")).toBeTruthy();
    expect(screen.getByTestId("theme-editor-base")).toBeTruthy();
  });

  it("adds a theme rather than replacing the one it started from", () => {
    st().setActiveThemeId("dracula");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Add theme" }));
    ed().setName("Mine");
    ed().save();

    const customs = st().customThemes;
    expect(customs.map((t) => t.name)).toEqual(["Mine"]);
    expect(st().getActiveTheme().name).toBe("Mine");
  });
});
