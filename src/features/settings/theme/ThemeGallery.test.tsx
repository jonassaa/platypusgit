import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { WithDialogs, acceptDialog, resetDialogs } from "@/test/dialog";
import { mockDialogSave } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { BUILTIN_THEMES, useSettingsStore } from "@/features/settings/useSettingsStore";

import { ThemeGallery } from "./ThemeGallery";
import { useThemeEditorStore } from "./useThemeEditorStore";

const ed = () => useThemeEditorStore.getState();
const st = () => useSettingsStore.getState();

function mount(appearance?: "light" | "dark") {
  return render(
    <WithDialogs>
      <ThemeGallery appearance={appearance} />
    </WithDialogs>,
  );
}

describe("ThemeGallery", () => {
  beforeEach(() => {
    resetDialogs();
    ed().close();
    st().reset();
  });

  it("shows a card per theme, each painted in its own colours", () => {
    mount();
    expect(screen.getAllByRole("radio")).toHaveLength(BUILTIN_THEMES.length);
    const light = screen.getByRole("radio", { name: "Light" });
    expect(
      within(light).getByTestId("theme-preview").style.getPropertyValue("--bg-0"),
    ).toBe(BUILTIN_THEMES.find((t) => t.id === "light")!.colors.bg0);
  });

  it("marks the active theme as checked", () => {
    st().setActiveThemeId("nord");
    mount();
    expect(screen.getByRole("radio", { name: "Nord" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Dracula" })).not.toBeChecked();
  });

  it("activates the theme on the card you click", () => {
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Dracula" }));
    expect(st().getActiveTheme().id).toBe("dracula");
  });

  it("moves the selection with the arrow keys, activating as it goes", () => {
    st().setActiveThemeId("dark-cool");
    mount();
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(st().getActiveTheme().id).toBe("dark-warm");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(st().getActiveTheme().id).toBe("dark-cool");
    fireEvent.keyDown(group, { key: "End" });
    expect(st().getActiveTheme().id).toBe("github-light");
    fireEvent.keyDown(group, { key: "Home" });
    expect(st().getActiveTheme().id).toBe("dark-cool");
  });

  it("does not wrap past either end", () => {
    st().setActiveThemeId("dark-cool");
    mount();
    const group = screen.getByRole("radiogroup");
    fireEvent.keyDown(group, { key: "ArrowLeft" });
    // Still the first one — a silent wrap in a grid the user is looking at
    // reads as a bug.
    expect(st().getActiveTheme().id).toBe("dark-cool");
  });

  it("filters to one mode and drives that half of the pairing", () => {
    st().setThemeFollowMode("system");
    mount("light");
    for (const card of screen.getAllByRole("radio")) {
      const name = card.getAttribute("aria-label") ?? "";
      const theme = BUILTIN_THEMES.find((t) => t.name === name);
      expect(theme?.mode, `${name} is not a light theme`).toBe("light");
    }
    fireEvent.click(screen.getByRole("radio", { name: "GitHub Light" }));
    expect(st().themePreference.lightId).toBe("github-light");
  });

  it("offers Duplicate on a built-in card and opens the editor with it", () => {
    mount();
    const card = screen.getByRole("radio", { name: "Nord" });
    fireEvent.click(within(card).getByRole("button", { name: /duplicate/i }));
    expect(ed().open?.mode).toBe("new");
    expect(ed().open?.sourceTheme.id).toBe("nord");
  });

  it("offers Edit and Delete only on a custom card", () => {
    const created = st().duplicateTheme("nord", "Mine");
    expect(created.name).toBe("Mine");
    mount();

    const builtin = screen.getByRole("radio", { name: "Nord" });
    expect(within(builtin).queryByRole("button", { name: /^edit/i })).toBeNull();
    expect(within(builtin).queryByRole("button", { name: /^delete/i })).toBeNull();

    const custom = screen.getByRole("radio", { name: "Mine" });
    expect(within(custom).getByRole("button", { name: /^edit/i })).toBeInTheDocument();
    expect(within(custom).getByRole("button", { name: /^delete/i })).toBeInTheDocument();
  });

  it("marks a custom theme as custom and a built-in as built-in", () => {
    st().duplicateTheme("nord", "Mine");
    mount();
    expect(screen.getByRole("radio", { name: "Mine" })).toHaveTextContent("Custom");
    expect(screen.getByRole("radio", { name: "Nord" })).toHaveTextContent("Built-in");
  });

  it("opens the editor on Edit for the theme whose card it is", () => {
    const created = st().duplicateTheme("nord", "Mine");
    mount();
    const card = screen.getByRole("radio", { name: "Mine" });
    fireEvent.click(within(card).getByRole("button", { name: /^edit/i }));
    expect(ed().open?.mode).toBe("edit");
    expect(ed().open?.sourceTheme.id).toBe(created.id);
  });

  it("exports the theme on the card", async () => {
    mockDialogSave("/home/you/nord.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);
    mount();
    const card = screen.getByRole("radio", { name: "Nord" });
    fireEvent.click(within(card).getByRole("button", { name: /^export/i }));
    await waitFor(() =>
      expect(getInvokeCalls().some((c) => c.cmd === "write_user_file")).toBe(true),
    );
  });

  it("asks before deleting, and does not re-activate the card it was on", async () => {
    st().setActiveThemeId("dark-cool");
    const created = st().duplicateTheme("nord", "Mine");
    // duplicateTheme activates its copy, so put the selection back.
    st().setActiveThemeId("dark-cool");
    mount();

    fireEvent.click(
      within(screen.getByRole("radio", { name: "Mine" })).getByRole("button", {
        name: /^delete/i,
      }),
    );
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();

    await waitFor(() =>
      expect(st().customThemes.some((t) => t.id === created.id)).toBe(false),
    );
    // The action button stops its click reaching the card, so pressing Delete
    // must not also switch the app to the theme being deleted.
    expect(st().getActiveTheme().id).toBe("dark-cool");
  });
});
