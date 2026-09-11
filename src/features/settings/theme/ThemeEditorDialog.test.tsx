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

describe("ThemeEditorDialog — the colour picker", () => {
  beforeEach(() => {
    resetDialogs();
    ed().close();
    useSettingsStore.getState().reset();
  });

  const swatchFor = (label: RegExp) =>
    screen.getByRole("button", { name: label });
  const picker = () => document.querySelector("[data-pg-colorpicker]");

  it("hands every slot a real picker instead of the host's colour dialog", () => {
    // The whole point: `<input type="color">` was a hand-off to whatever the
    // webview felt like showing — an unthemed OS panel on macOS, and on
    // WebKitGTK a control of exactly the shape that silently does nothing.
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    expect(document.querySelector('input[type="color"]')).toBeNull();
    fireEvent.click(swatchFor(/^background · base — #1a1d24/i));
    expect(picker()).toBeTruthy();
  });

  it("offers the theme's own palette inside the picker", () => {
    // "Make the border match the panel" is the most-used move in a theme
    // editor, and without this it means reading a hex off one row and typing
    // it into another.
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    fireEvent.click(swatchFor(/^border · subtle/i));
    fireEvent.click(
      screen.getByRole("button", { name: /^Background · panel \(#1e222a\)$/ }),
    );
    expect(ed().colors.border0).toBe("#1e222a");
  });

  it("measures a paired slot against its partner while it is being dragged", () => {
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    fireEvent.click(swatchFor(/^foreground · primary/i));
    // fg0 against bg0 — the pair CONTRAST_PAIRS names first.
    expect(screen.getByTestId("colorpicker-contrast")).toBeTruthy();
  });

  it("measures a BACKGROUND against its text, not only the text against it", () => {
    // A background is exactly what you drag while watching readability, so the
    // partner lookup has to read both sides of a pair.
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    fireEvent.click(swatchFor(/^background · base/i));
    expect(screen.getByTestId("colorpicker-contrast")).toBeTruthy();
  });

  it("says nothing about contrast for a slot that is in no pair", () => {
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    fireEvent.click(swatchFor(/^logo · bill/i));
    expect(screen.queryByTestId("colorpicker-contrast")).toBeNull();
  });

  it("remembers a colour once it is settled on, not once per drag frame", async () => {
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    fireEvent.click(swatchFor(/^accent · on-ink/i));
    const hex = screen.getByLabelText("Hex");
    fireEvent.change(hex, { target: { value: "#ff8800" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    // Still open, so nothing is remembered yet.
    expect(useSettingsStore.getState().recentColors).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.mouseDown(document.body);
    expect(useSettingsStore.getState().recentColors).toEqual(["#ff8800"]);
  });

  it("offers those remembered colours back", () => {
    useSettingsStore.getState().pushRecentColor("#ff8800");
    ed().openNew(dark);
    mount();
    fireEvent.click(screen.getByRole("button", { name: /all colours/i }));
    fireEvent.click(swatchFor(/^border · default/i));
    fireEvent.click(screen.getByRole("button", { name: /^#ff8800$/ }));
    expect(ed().colors.border1).toBe("#ff8800");
  });

  it("gives the Accent field the same picker as the eighteen", () => {
    // The guided start's accent field is a ColorField too, and a picker that
    // appeared on the collapsed rows but not on the one field everybody edits
    // would be the feature missing from where it matters most.
    ed().openNew(dark);
    mount();
    fireEvent.click(swatchFor(/^accent — #5aa8e8/i));
    expect(picker()).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Background · panel \(#1e222a\)$/ }),
    ).toBeTruthy();
  });

  it("shuffles the palette and leaves a locked accent alone", () => {
    ed().openEdit(dark);
    mount();

    fireEvent.click(screen.getByTestId("theme-lock-seed"));
    const seed = ed().traits.seed;
    fireEvent.click(screen.getByTestId("theme-shuffle"));

    expect(ed().traits.seed).toBe(seed);
    expect(ed().colors.accent).toBe(seed);
    // Something has to actually move, or the dice reads as a broken button.
    expect(ed().colors.bg0).not.toBe(dark.colors.bg0);
  });

  it("says Custom once a slot is hand-edited, and not before", () => {
    ed().openEdit(dark);
    mount();
    expect(screen.queryByText("Custom")).toBeNull();

    // act() because this drives the store directly rather than through an
    // event — without it React has not flushed the re-render when the
    // assertion runs, and the test fails for a reason that is not the feature.
    act(() => {
      ed().patchColors({ border1: "#ff00ff" });
    });
    expect(screen.getByText("Custom")).toBeInTheDocument();
  });

  it("has no native select and no native colour input in the palette section", () => {
    // Both are guard-tested repo-wide, but this section is where a new one
    // would land, so assert it here rather than finding out from a guard.
    ed().openEdit(dark);
    const { container } = mount();
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelector('input[type="color"]')).toBeNull();
  });

  it("moves the whole ramp when the tint is raised", () => {
    ed().openEdit(dark);
    mount();
    act(() => {
      ed().setTrait("strength", 0.7);
    });
    expect(ed().colors.bg0).not.toBe(dark.colors.bg0);
    expect(ed().colors.fg0).not.toBe(dark.colors.fg0);
    // The accent is the seed, and a seed is never tinted.
    expect(ed().colors.accent).toBe(dark.colors.accent);
  });
});
