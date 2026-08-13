// PGSkeleton (#61 B6) — the primitive that finally uses the .pg-shimmer
// keyframe, which had been defined and unused since it was written.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PGSkeleton } from "./skeleton";

describe("PGSkeleton", () => {
  it("renders one placeholder by default", () => {
    render(<PGSkeleton />);
    expect(screen.getAllByTestId("pg-skeleton")).toHaveLength(1);
  });

  it("renders `count` placeholders", () => {
    render(<PGSkeleton count={5} />);
    expect(screen.getAllByTestId("pg-skeleton")).toHaveLength(5);
  });

  it("is hidden from assistive tech", () => {
    render(<PGSkeleton />);
    expect(screen.getByTestId("pg-skeleton")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("carries the shimmer class so the keyframe applies", () => {
    render(<PGSkeleton />);
    expect(screen.getByTestId("pg-skeleton").className).toContain(
      "pg-shimmer",
    );
  });

  it("sizes rows with the shared row token when rowStep is set", () => {
    render(<PGSkeleton rowStep />);
    // --row-h is already calc(24px + var(--row-step)), so a skeleton row
    // matches a real row at any density.
    expect(screen.getByTestId("pg-skeleton").style.height).toContain(
      "var(--row-h)",
    );
  });

  it("uses the explicit height when rowStep is not set", () => {
    render(<PGSkeleton height={40} />);
    expect(screen.getByTestId("pg-skeleton").style.height).toBe("40px");
  });

  it("treats a zero or negative count as one placeholder", () => {
    render(<PGSkeleton count={0} />);
    expect(screen.getAllByTestId("pg-skeleton")).toHaveLength(1);
  });
});
