// A render throw must leave a legible window, not an empty one.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { PGErrorBoundary } from "./error-boundary";

function Boom(): React.ReactNode {
  throw new Error("Rendered more hooks than during the previous render.");
}

describe("PGErrorBoundary", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders children when nothing throws", () => {
    render(
      <PGErrorBoundary>
        <div>all good</div>
      </PGErrorBoundary>,
    );
    expect(screen.getByText("all good")).toBeInTheDocument();
  });

  it("shows the error message instead of an empty window", () => {
    // React logs the caught error itself; silence it so the run stays readable.
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { container } = render(
      <PGErrorBoundary>
        <Boom />
      </PGErrorBoundary>,
    );

    expect(screen.getByTestId("app-error-boundary")).toBeInTheDocument();
    expect(screen.getByText(/Rendered more hooks/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    // The actual regression: the window is not blank.
    expect(container.textContent?.trim()).not.toBe("");
  });

  it("uses a caller-supplied reload action when given one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReload = vi.fn();

    render(
      <PGErrorBoundary onReload={onReload}>
        <Boom />
      </PGErrorBoundary>,
    );
    screen.getByRole("button", { name: "Reload" }).click();

    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
