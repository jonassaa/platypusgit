import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { getInvokeCalls, mockInvoke } from "@/test/invokeMock";

import { ReportIssueDialog } from "./ReportIssueDialog";
import { useReportStore } from "./useReportStore";

/**
 * `fireEvent`, not `userEvent`, and deliberately so.
 *
 * `userEvent.setup()` REPLACES `navigator.clipboard` with its own stub in
 * order to implement copy/paste, which silently detaches any spy installed
 * before it — the writes land in userEvent's internal clipboard and a
 * `writeText` assertion sees nothing at all. Every clipboard assertion in this
 * file would be vacuous. `fireEvent` is also what `design/dialog.test.tsx`
 * uses, so this is the house pattern either way.
 */

const DIAG = {
  logPath: "/tmp/platypusgit.log",
  logExists: true,
  logSizeBytes: 4096,
  environment: "host os=linux arch=x86_64 git=2.43.0",
  version: "0.8.0",
};

let written: string[] = [];

beforeEach(() => {
  written = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async (t: string) => {
        written.push(t);
      }),
    },
  });
  mockInvoke("diagnostics_report", () => DIAG);
  mockInvoke("read_log_tail", () => "11:02 WARN invoke fetch slow: 1400ms");
  mockInvoke("open_url", () => undefined);
  useReportStore.setState({ open: false, seed: "" });
});

function openDialog(seed = "") {
  useReportStore.getState().openReport(seed);
}

/** The preview only exists once `diagnostics_report` has resolved. */
async function readyPreview() {
  await waitFor(() =>
    expect(screen.getByTestId("report-preview")).toHaveTextContent(
      "platypusgit 0.8.0",
    ),
  );
  return screen.getByTestId("report-preview");
}

describe("ReportIssueDialog", () => {
  it("renders nothing while closed", () => {
    render(<ReportIssueDialog />);
    expect(screen.queryByTestId("report-dialog")).toBeNull();
  });

  it("shows the exact text that will be copied", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    // Nothing leaves this app without being shown first — the preview is the
    // report itself, not a summary of it.
    const preview = await readyPreview();
    expect(preview).toHaveTextContent("invoke fetch slow: 1400ms");
    expect(preview).toHaveTextContent("host os=linux arch=x86_64 git=2.43.0");
    expect(preview).toHaveTextContent("/tmp/platypusgit.log");
  });

  it("seeds the summary from the caller", async () => {
    render(<ReportIssueDialog />);
    openDialog("Network: could not resolve host");
    await waitFor(() =>
      expect(screen.getByTestId("report-summary")).toHaveValue(
        "Network: could not resolve host",
      ),
    );
  });

  it("drops the log from the preview when the box is unchecked", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.click(screen.getByTestId("report-include-log"));
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).not.toHaveTextContent(
        "invoke fetch slow",
      ),
    );
    // Unchecking the log is the privacy control: it is what removes the paths.
    expect(screen.getByTestId("report-preview")).not.toHaveTextContent(
      "/tmp/platypusgit.log",
    );
  });

  it("drops the environment from the preview when unchecked", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.click(screen.getByTestId("report-include-env"));
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).not.toHaveTextContent(
        "host os=linux",
      ),
    );
    // The build survives every opt-out.
    expect(screen.getByTestId("report-preview")).toHaveTextContent(
      "platypusgit 0.8.0",
    );
  });

  it("copies what the preview shows, not the unfiltered report", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.click(screen.getByTestId("report-include-log"));
    await waitFor(() =>
      expect(screen.getByTestId("report-preview")).not.toHaveTextContent(
        "invoke fetch slow",
      ),
    );
    fireEvent.click(screen.getByTestId("report-copy"));
    await waitFor(() => expect(written.length).toBe(1));
    // An opt-out that filters only the preview would be worse than no opt-out
    // at all: the user would believe they had removed the paths.
    expect(written[0]).not.toContain("invoke fetch slow");
    expect(written[0]).not.toContain("/tmp/platypusgit.log");
    expect(written[0]).toContain("platypusgit 0.8.0");
  });

  it("copies without opening the browser on Copy report", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.click(screen.getByTestId("report-copy"));
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0]).toContain("platypusgit 0.8.0");
    expect(written[0]).toContain("invoke fetch slow");
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("open_url");
    // Copy-only leaves the dialog open: the user is mid-flow, filing by hand.
    expect(screen.getByTestId("report-dialog")).toBeTruthy();
  });

  it("copies and opens the prefilled issue on Copy & open", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.change(screen.getByTestId("report-summary"), {
      target: { value: "Fetch hangs" },
    });
    fireEvent.click(screen.getByTestId("report-open"));
    await waitFor(() =>
      expect(getInvokeCalls().map((c) => c.cmd)).toContain("open_url"),
    );
    expect(written[0]).toContain("platypusgit 0.8.0");
    const url = getInvokeCalls().find((c) => c.cmd === "open_url")!.args
      .url as string;
    const params = new URL(url).searchParams;
    expect(params.get("labels")).toBe("bug");
    expect(params.get("title")).toBe("[bug] Fetch hangs");
    expect(params.get("body")).toContain("Fetch hangs");
    // The log rode the clipboard, not the URL.
    expect(params.get("body")).not.toContain("invoke fetch slow");
  });

  it("closes after handing the issue to the browser", async () => {
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.click(screen.getByTestId("report-open"));
    await waitFor(() =>
      expect(screen.queryByTestId("report-dialog")).toBeNull(),
    );
  });

  it("stays open when the copy fails, so nothing typed is lost", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    render(<ReportIssueDialog />);
    openDialog();
    await readyPreview();
    fireEvent.change(screen.getByTestId("report-summary"), {
      target: { value: "typed this" },
    });
    fireEvent.click(screen.getByTestId("report-open"));
    await waitFor(() =>
      expect(screen.getByTestId("report-open")).toBeEnabled(),
    );
    expect(screen.getByTestId("report-dialog")).toBeTruthy();
    expect(screen.getByTestId("report-summary")).toHaveValue("typed this");
    // And it did not send the user to a form they cannot fill in.
    expect(getInvokeCalls().map((c) => c.cmd)).not.toContain("open_url");
  });

  it("still offers an environment report when the log cannot be read", async () => {
    mockInvoke("read_log_tail", () => {
      throw { kind: "Io", message: "no log file at /tmp/x yet" };
    });
    render(<ReportIssueDialog />);
    openDialog();
    const preview = await readyPreview();
    expect(preview).toHaveTextContent("host os=linux");
    // No dangling section header for a log that was never read.
    expect(preview).not.toHaveTextContent("log tail");
    expect(screen.getByTestId("report-copy")).toBeEnabled();
  });

  it("starts a fresh report on each open rather than keeping the last one", async () => {
    render(<ReportIssueDialog />);
    openDialog("first error");
    await waitFor(() =>
      expect(screen.getByTestId("report-summary")).toHaveValue("first error"),
    );
    fireEvent.click(screen.getByTestId("report-cancel"));
    await waitFor(() =>
      expect(screen.queryByTestId("report-dialog")).toBeNull(),
    );

    openDialog("second error");
    await waitFor(() =>
      expect(screen.getByTestId("report-summary")).toHaveValue("second error"),
    );
  });
});
