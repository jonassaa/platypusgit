import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { WithDialogs, acceptDialog, dismissDialog, resetDialogs } from "@/test/dialog";
import { lastDialogSaveOptions, mockDialogOpen, mockDialogSave } from "@/test/dialogMock";
import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";
import { BUILTIN_THEMES, useSettingsStore } from "@/features/settings/useSettingsStore";

import { ThemeEditorDialog } from "./ThemeEditorDialog";
import { useThemeEditorStore } from "./useThemeEditorStore";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const ed = () => useThemeEditorStore.getState();

/** The dialog reads its own open state, so it always mounts. */
function mount() {
  return render(
    <WithDialogs>
      <ThemeEditorDialog />
    </WithDialogs>,
  );
}

const preview = () => screen.getByTestId("theme-preview");
const written = () => getInvokeCalls().filter((c) => c.cmd === "write_user_file");

describe("ThemeEditorDialog", () => {
  beforeEach(() => {
    resetDialogs();
    ed().close();
    useSettingsStore.getState().reset();
  });

  it("renders nothing while the editor is closed", () => {
    const { container } = mount();
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("shows the draft's preview and repaints it on a colour change", () => {
    ed().openNew(dark);
    mount();
    expect(preview().style.getPropertyValue("--bg-0")).toBe(dark.colors.bg0);

    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    const field = screen.getByLabelText(/^background · base$/i);
    fireEvent.change(field, { target: { value: "#123456" } });
    fireEvent.blur(field);

    expect(ed().colors.bg0).toBe("#123456");
    expect(preview().style.getPropertyValue("--bg-0")).toBe("#123456");
  });

  it("warns about unreadable text without disabling Save", () => {
    ed().openNew(dark);
    mount();
    // A store write from outside an event handler needs act() to flush the
    // re-render before the assertion reads the DOM.
    act(() => ed().patchColors({ fg0: dark.colors.bg0 }));

    expect(screen.getByTestId("theme-contrast-warnings")).toHaveTextContent(
      /primary text/i,
    );
    // Advisory, never blocking: a low-contrast theme is the user's own call.
    expect(screen.getByRole("button", { name: /create theme/i })).toBeEnabled();
  });

  it("says nothing when every checked pair is fine", () => {
    ed().openNew(dark);
    mount();
    expect(screen.queryByTestId("theme-contrast-warnings")).not.toBeInTheDocument();
  });

  it("never spells a colour-slot key in a warning", () => {
    ed().openNew(dark);
    mount();
    act(() => ed().patchColors({ fg0: dark.colors.bg0 }));
    const warnings = screen.getByTestId("theme-contrast-warnings");
    expect(warnings.textContent).not.toMatch(/\bfg0\b|\bbg0\b/);
  });

  it("exports the unsaved draft to the file the user picked", async () => {
    ed().openNew(dark);
    ed().setName("My theme");
    mockDialogSave("/home/you/my-theme.pgtheme.json");
    mockInvoke("write_user_file", () => undefined);
    mount();

    fireEvent.click(screen.getByRole("button", { name: /^export/i }));

    await waitFor(() => expect(written()).toHaveLength(1));
    expect(lastDialogSaveOptions()).toMatchObject({
      defaultPath: "my-theme.pgtheme.json",
    });
    const body = JSON.parse((written()[0].args as { contents: string }).contents);
    expect(body.name).toBe("My theme");
    // The DRAFT, not a saved theme: nothing was created.
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("loads a file into the draft without keeping it", async () => {
    ed().openNew(dark);
    mount();
    mockDialogOpen("/home/you/from-disk.pgtheme.json");
    mockInvoke("read_user_file", () =>
      JSON.stringify({
        version: 1,
        name: "From disk",
        mode: "light",
        colors: { ...dark.colors, accent: "#abcdef" },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^import/i }));

    await waitFor(() => expect(ed().colors.accent).toBe("#abcdef"));
    expect(ed().themeMode).toBe("light");
    // Round-tripping through an external editor is the point (#435) — the file
    // is loaded into the draft, not added to the store behind the user's back.
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("saves the draft as a new theme and closes", () => {
    ed().openNew(dark);
    ed().setName("My theme");
    mount();

    fireEvent.click(screen.getByRole("button", { name: /create theme/i }));

    expect(useSettingsStore.getState().customThemes.map((t) => t.name)).toEqual([
      "My theme",
    ]);
    expect(ed().open).toBeNull();
  });

  it("refuses an empty name and stays open", () => {
    ed().openNew(dark);
    ed().setName("  ");
    mount();
    fireEvent.click(screen.getByRole("button", { name: /create theme/i }));
    expect(ed().open).not.toBeNull();
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("cancel restores the theme that was live when it opened", () => {
    ed().openNew(dark);
    mount();
    act(() => ed().patchColors({ bg0: "#123456" }));

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(document.documentElement.style.getPropertyValue("--bg-0")).toBe(
      dark.colors.bg0,
    );
    expect(useSettingsStore.getState().customThemes).toEqual([]);
  });

  it("reveals all 18 colour slots behind the disclosure", () => {
    ed().openNew(dark);
    mount();
    // Collapsed by default so the guided path is what a first-timer sees.
    expect(screen.queryByLabelText(/^background · base$/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    expect(screen.getByLabelText(/^background · base$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^logo · bill$/i)).toBeInTheDocument();
  });

  it("applies the guided start from a base theme", () => {
    ed().openNew(dark);
    mount();
    // PGSelect is a custom combobox, not a native <select> (a guard test
    // forbids those), and it opens on mouseDown rather than click — the same
    // way primitives.select.test.tsx drives it.
    fireEvent.mouseDown(screen.getByTestId("theme-editor-base"), { button: 0 });
    const option = document.querySelector<HTMLElement>(
      "[data-pg-option][data-value='nord']",
    );
    expect(option, "the base picker should list every theme").not.toBeNull();
    fireEvent.click(option!);
    expect(ed().colors.bg0).toBe(BUILTIN_THEMES.find((t) => t.id === "nord")!.colors.bg0);
  });

  it("offers to re-base the palette when the mode is flipped", async () => {
    ed().openNew(dark);
    ed().patchColors({ bg0: "#123456" }); // an edited draft, so there is something to lose
    mount();


    fireEvent.click(screen.getByRole("button", { name: /^light$/i }));

    // Dark greys under a light calibration are unreadable, and doing that
    // silently is how "Light" appears broken.
    await screen.findByTestId("dialog-confirm");
    await acceptDialog();
    await waitFor(() => expect(ed().themeMode).toBe("light"));
    expect(ed().colors.bg0).not.toBe("#123456");
  });

  it("keeps the colours when the re-base offer is declined", async () => {
    ed().openNew(dark);
    ed().patchColors({ bg0: "#123456" });
    mount();

    fireEvent.click(screen.getByRole("button", { name: /^light$/i }));
    await screen.findByTestId("dialog-confirm");
    await dismissDialog();

    await waitFor(() => expect(ed().themeMode).toBe("light"));
    expect(ed().colors.bg0).toBe("#123456");
  });

  it("does not ask when the draft is still the source's own colours", async () => {
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^light$/i }));
    // Nothing to lose, so no question — it just re-bases.
    await waitFor(() => expect(ed().themeMode).toBe("light"));
    expect(screen.queryByTestId("dialog-confirm")).toBeNull();
    expect(ed().colors.bg0).not.toBe(dark.colors.bg0);
  });
});
