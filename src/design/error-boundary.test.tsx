// A render throw must leave a legible window, not an empty one.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { error as logError } from "@tauri-apps/plugin-log";

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

  /**
   * The console is not a diagnostic channel for a shipped app: #146's reporter
   * handed over the Rust log file, which is the only artifact they had. An
   * unhandled render error is the single most valuable line that file could
   * carry, and it was the one place that wrote to the console only.
   */
  it("writes the failure to the log file, not just the console", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(logError).mockClear();

    render(
      <PGErrorBoundary>
        <Boom />
      </PGErrorBoundary>,
    );

    expect(logError).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(logError).mock.calls[0][0]);
    expect(line).toContain("Rendered more hooks");
    // The component stack is what names the screen that threw; a minified
    // production stack alone rarely does.
    expect(line).toContain("Boom");
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

  /**
   * The report path here CANNOT go through the dialog, and this is the test
   * that keeps it that way.
   *
   * `PGDialogHost` and `ReportIssueDialog` are both mounted by `AppShell`,
   * which is mounted inside this boundary (`main.tsx`). By the time this
   * fallback renders, React has unmounted that entire subtree — so there is no
   * dialog host, no dialog, and nothing subscribed to `useReportStore`.
   * `openReport()` from here would set a flag nobody reads and the button
   * would appear to do nothing at all.
   *
   * Hence a callback, and hence a render with NO host of any kind mounted:
   * that absence is the boundary's real world, not a simplification of it.
   */
  it("reports the throw with no dialog host mounted anywhere", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onReport = vi.fn();

    render(
      <PGErrorBoundary onReport={onReport}>
        <Boom />
      </PGErrorBoundary>,
    );
    screen.getByTestId("boundary-report").click();

    expect(onReport).toHaveBeenCalledTimes(1);
    // Handed the error itself, so the report is seeded with the throw rather
    // than starting from a blank box.
    const seen = onReport.mock.calls[0]![0] as Error;
    expect(seen).toBeInstanceOf(Error);
    expect(seen.message).toContain("Rendered more hooks");
  });

  it("offers no report button when no handler is given", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <PGErrorBoundary>
        <Boom />
      </PGErrorBoundary>,
    );

    expect(screen.getByTestId("app-error-boundary")).toBeInTheDocument();
    expect(screen.queryByTestId("boundary-report")).toBeNull();
    // Reload is unconditional and must survive the new sibling.
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
