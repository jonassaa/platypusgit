import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { PGLogo } from "./logo";

describe("PGLogo", () => {
  it("fills the two brand shapes from the themeable --logo / --logo-2 vars", () => {
    const { container } = render(<PGLogo />);
    const svg = container.querySelector("svg")!;
    expect(svg).toBeTruthy();
    const fills = [...container.querySelectorAll("path")].map((p) =>
      p.getAttribute("fill"),
    );
    // Fills track the theme's logo colors, not hardcoded values.
    expect(fills).toContain("var(--logo)");
    expect(fills).toContain("var(--logo-2)");
  });

  it("honors the size prop", () => {
    const { container } = render(<PGLogo size={34} />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("34");
    expect(svg.getAttribute("height")).toBe("34");
  });

  it("is decorative (aria-hidden) with no title", () => {
    const { container } = render(<PGLogo />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
  });

  it("exposes an accessible image when given a title", () => {
    const { getByRole } = render(<PGLogo title="PlatypusGit" />);
    const svg = getByRole("img", { name: "PlatypusGit" });
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("passes data-testid through to the svg", () => {
    const { container } = render(<PGLogo data-testid="pg-app-logo" />);
    expect(container.querySelector('[data-testid="pg-app-logo"]')).toBeTruthy();
  });
});
