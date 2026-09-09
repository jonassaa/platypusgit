// Settings → Appearance, the "follow the system" half (#236). The store's side
// is pinned in features/settings/themePreference.test.ts; this file asserts the
// one thing only the UI can get wrong — offering a pairing that cannot switch.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { AppearancePage } from "@/features/settings/pages/appearance";

/**
 * The Row whose label is `label`, so a control can be found by what it is FOR
 * rather than by position.
 *
 * `Row` wraps label + hint in a `flex: 1` div and puts the control beside it,
 * so the row is the label node's grandparent — and that wrapper is also what
 * distinguishes a row label from the Section header of the same name
 * ("Appearance" is both, deliberately: it is the word the OS uses).
 */
function row(label: string): HTMLElement {
  const wrapper = screen
    .getAllByText(label)
    .map((el) => el.parentElement)
    .find((el) => el?.style.flex);
  if (!wrapper?.parentElement) throw new Error(`no settings row labelled "${label}"`);
  return wrapper.parentElement;
}

beforeEach(() => {
  localStorage.clear();
  resetDialogs();
  useSettingsStore.getState().reset();
  useSettingsStore.getState().syncSystemAppearance("dark");
});

function renderSettings() {
  render(
    <WithDialogs>
      <AppearancePage />
    </WithDialogs>,
  );
}

describe("the Appearance control", () => {
  it("shows one theme picker while fixed, and the pair while following", () => {
    renderSettings();
    expect(screen.getByText("Theme")).toBeInTheDocument();
    expect(screen.queryByText("Light theme")).not.toBeInTheDocument();

    fireEvent.click(within(row("Appearance")).getByText("Follow system"));

    expect(screen.getByText("Light theme")).toBeInTheDocument();
    expect(screen.getByText("Dark theme")).toBeInTheDocument();
    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
  });

  it("offers only light themes as the light half, and only dark as the dark", () => {
    useSettingsStore.getState().setThemeFollowMode("system");
    renderSettings();
    const named = (el: HTMLElement) =>
      within(el)
        .getAllByRole("radio")
        .map((card) => card.getAttribute("aria-label"));
    const light = named(row("Light theme"));
    const dark = named(row("Dark theme"));
    // A pairing whose halves are the same mode never switches — the control
    // must make that unrepresentable rather than validating it after the fact.
    // The picker is a gallery of cards now, but the rule is the same one.
    expect(light).toEqual(["Light", "GitHub Light"]);
    expect(dark).toContain("Dark · Cool");
    expect(dark).not.toContain("Light");
    expect(light).not.toContain("Nord");
  });

  it("applies the pick that matches the current OS appearance", () => {
    useSettingsStore.getState().setThemeFollowMode("system");
    renderSettings();
    fireEvent.click(
      within(row("Dark theme")).getByRole("radio", { name: "Dracula" }),
    );
    expect(useSettingsStore.getState().themePreference.darkId).toBe("dracula");
    expect(document.documentElement.dataset.theme).toBe("dracula");

    // …and stores the other half without touching the screen.
    fireEvent.click(
      within(row("Light theme")).getByRole("radio", { name: "GitHub Light" }),
    );
    expect(useSettingsStore.getState().themePreference.lightId).toBe("github-light");
    expect(document.documentElement.dataset.theme).toBe("dracula");
  });

  it("says which appearance it is currently following", () => {
    useSettingsStore.getState().setThemeFollowMode("system");
    renderSettings();
    expect(screen.getByText(/Follows the OS — currently dark/)).toBeInTheDocument();
  });
});
