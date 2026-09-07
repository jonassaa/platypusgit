// `PGProgressBar`'s two modes, and the one trap between them.
//
// The indeterminate fill's width belongs to `.pg-progress-indeterminate` in
// `index.css`, NOT to an inline style — because that is the only way
// `prefers-reduced-motion` can replace the width and the animation together.
// Stopping the slide on a 35 %-wide sliver leaves a bar that reads as "35 %
// done", and reporting progress without implying a position is the entire job
// of the indeterminate mode. An inline `width` would win over the media query
// and quietly restore the lie, so it is asserted against here.

import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";

import { PGProgressBar } from "./primitives";

/** The moving part: the track is the bar's own element, the fill is inside it. */
const fill = (c: HTMLElement) =>
  c.firstElementChild!.firstElementChild as HTMLElement;

describe("the indeterminate mode", () => {
  it("takes its width from the class, never from an inline style", () => {
    const { container } = render(<PGProgressBar indeterminate />);
    expect(fill(container).className).toBe("pg-progress-indeterminate");
    // The assertion that matters: an inline width would outrank the reduced
    // motion override and there would be no way to tell from the screen.
    expect(fill(container).style.width).toBe("");
  });

  it("does not animate a width it is not setting", () => {
    const { container } = render(<PGProgressBar indeterminate />);
    expect(fill(container).style.transition).toBe("");
  });
});

describe("the determinate mode", () => {
  it("paints the value as a percentage of the track", () => {
    const { container } = render(<PGProgressBar value={62} />);
    expect(fill(container).style.width).toBe("62%");
    expect(fill(container).className).toBe("");
  });

  it("scales to a custom max", () => {
    const { container } = render(<PGProgressBar value={5} max={20} />);
    expect(fill(container).style.width).toBe("25%");
  });

  it("eases between values, so a progress tick is not a jump", () => {
    const { container } = render(<PGProgressBar value={10} />);
    expect(fill(container).style.transition).toContain("width");
  });
});
