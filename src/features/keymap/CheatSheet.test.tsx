import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheatSheet } from "./CheatSheet";

describe("CheatSheet", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<CheatSheet open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a row per action with its chord when open", () => {
    render(<CheatSheet open onClose={() => {}} />);
    expect(screen.getByText("Go to Files")).toBeTruthy();
    expect(screen.getByText("Show keyboard shortcuts")).toBeTruthy();
    // chord for nav.files contains the digit 1 in either glyph or word form
    expect(screen.getByText(/1/)).toBeTruthy();
  });
});
