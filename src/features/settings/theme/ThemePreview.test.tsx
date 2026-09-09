import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BUILTIN_THEMES } from "@/features/settings/useSettingsStore";

import { ThemePreview } from "./ThemePreview";

const dark = BUILTIN_THEMES.find((t) => t.id === "dark-cool")!;
const light = BUILTIN_THEMES.find((t) => t.id === "light")!;

describe("ThemePreview", () => {
  it("paints from the theme it was handed, not from :root", () => {
    // The whole reason this component exists: a card on a dark page has to be
    // able to show a light theme. If it read :root vars it would show the page.
    document.documentElement.style.setProperty("--bg-0", "#ff00ff");
    const { container } = render(<ThemePreview theme={light} size="card" />);
    const root = container.querySelector("[data-testid='theme-preview']") as HTMLElement;
    expect(root.style.getPropertyValue("--bg-0")).toBe(light.colors.bg0);
    expect(root.style.getPropertyValue("--bg-0")).not.toBe("#ff00ff");
  });

  it("carries the mode-calibrated semantic tokens", () => {
    const { container } = render(<ThemePreview theme={dark} size="card" />);
    const root = container.querySelector("[data-testid='theme-preview']") as HTMLElement;
    expect(root.style.getPropertyValue("--git-added")).toBeTruthy();
    expect(root.style.getPropertyValue("--accent")).toBe(dark.colors.accent);
  });

  it("gives a light theme a different diff palette from a dark one", () => {
    const a = render(<ThemePreview theme={dark} size="card" />);
    const darkAdded = (
      a.container.querySelector("[data-testid='theme-preview']") as HTMLElement
    ).style.getPropertyValue("--git-added");
    a.unmount();
    const b = render(<ThemePreview theme={light} size="card" />);
    const lightAdded = (
      b.container.querySelector("[data-testid='theme-preview']") as HTMLElement
    ).style.getPropertyValue("--git-added");
    expect(lightAdded).not.toBe(darkAdded);
  });

  it("shows the surfaces a palette is actually judged on", () => {
    render(<ThemePreview theme={dark} size="pane" />);
    expect(screen.getByTestId("theme-preview-titlebar")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-history")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-diff")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-button")).toBeInTheDocument();
  });

  it("renders both sizes from one tree", () => {
    const card = render(<ThemePreview theme={dark} size="card" />);
    expect(card.getByTestId("theme-preview").dataset.size).toBe("card");
    card.unmount();
    const pane = render(<ThemePreview theme={dark} size="pane" />);
    expect(pane.getByTestId("theme-preview").dataset.size).toBe("pane");
  });

  it("is a picture, not a control", () => {
    // Nothing inside may take focus or a click: a card that is itself a radio
    // has to keep its own semantics, and the preview's text must not become
    // part of the card's accessible name.
    render(<ThemePreview theme={dark} size="card" />);
    const root = screen.getByTestId("theme-preview");
    expect(root.style.pointerEvents).toBe("none");
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelectorAll("button, a, input, select")).toHaveLength(0);
  });

  it("does not stamp data-theme, which belongs to the document", () => {
    render(<ThemePreview theme={light} size="card" />);
    const root = screen.getByTestId("theme-preview");
    expect(root.dataset.theme).toBeUndefined();
  });

  it("survives a theme missing the logo slots", () => {
    const legacy = {
      ...dark,
      colors: { ...dark.colors, logo: undefined, logo2: undefined },
    } as unknown as typeof dark;
    expect(() => render(<ThemePreview theme={legacy} size="card" />)).not.toThrow();
  });
});
