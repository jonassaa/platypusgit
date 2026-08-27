// The Diagnostics panel exists so that "send me your log" is a click rather
// than a per-platform path nobody can be told over chat (#274). What these tests
// pin is therefore not the layout but the two properties that make it work at
// all: the path is shown verbatim, and what lands on the clipboard identifies
// the machine it came from.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { SettingsScreen } from "./Settings";

const LOG_PATH = "/home/jonas/.local/share/io.github.jonassaa.platypusgit/logs/platypusgit.log";
const ENV_LINE =
  "host os=linux arch=x86_64 kernel=5.15.153.1-microsoft-standard-WSL2 wsl=Ubuntu-24.04 git=2.43.0";

/** The rest of the Settings screen loads too; give it what it asks for. */
function mockRestOfSettings() {
  mockInvoke("cli_shim_status", () => ({
    installed: true,
    shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit",
    source: "package",
    pathState: "onPath",
  }));
}

function mockReport(over: Record<string, unknown> = {}) {
  mockInvoke("diagnostics_report", () => ({
    logPath: LOG_PATH,
    logExists: true,
    logSizeBytes: 4096,
    environment: ENV_LINE,
    version: "0.1.0",
    ...over,
  }));
}

let clipboard: string[];

beforeEach(() => {
  clipboard = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn((t: string) => void clipboard.push(t)) },
  });
  mockRestOfSettings();
});

describe("the Settings diagnostics panel", () => {
  it("shows the log path and the environment line verbatim", async () => {
    mockReport();
    render(<SettingsScreen />);

    // Verbatim and selectable: the user's next move is to copy it or go find
    // the file, and a path shortened for layout serves neither.
    expect(await screen.findByText(LOG_PATH)).toBeInTheDocument();
    expect(screen.getByText(ENV_LINE)).toBeInTheDocument();
  });

  it("puts the version, environment and path ON the clipboard, above the tail", async () => {
    mockReport();
    mockInvoke("read_log_tail", () => "[2026-08-27][12:01:13][INFO] open_repo /mnt/c/dev/app");
    render(<SettingsScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: /copy last 500 lines/i }),
    );

    await waitFor(() => expect(clipboard).toHaveLength(1));
    const pasted = clipboard[0];
    // The whole point: a tail alone cannot say which machine wrote it, and a
    // 500-line window may not reach back to the startup header. #274 was hard
    // to read for exactly this reason, so provenance travels with the copy.
    expect(pasted).toContain("0.1.0");
    expect(pasted).toContain(ENV_LINE);
    expect(pasted).toContain(LOG_PATH);
    expect(pasted).toContain("open_repo /mnt/c/dev/app");
    // Header first, log after — not interleaved.
    expect(pasted.indexOf(ENV_LINE)).toBeLessThan(pasted.indexOf("open_repo"));
  });

  it("offers neither action when no log file has been written yet", async () => {
    mockReport({ logExists: false, logSizeBytes: null });
    render(<SettingsScreen />);

    // A button that reveals a nonexistent path fails in the file manager, where
    // the error is the OS's problem to explain and it explains it badly.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /copy last 500 lines/i }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: /show file/i })).toBeDisabled();
    expect(screen.getByText(/not written yet/i)).toBeInTheDocument();
  });

  it("reports a failed read instead of copying a lie", async () => {
    mockReport();
    mockInvoke("read_log_tail", () => {
      throw { kind: "Io", message: "cannot read the log: permission denied" };
    });
    render(<SettingsScreen />);

    await userEvent.click(
      await screen.findByRole("button", { name: /copy last 500 lines/i }),
    );

    // Nothing reaches the clipboard: a user who is told "copied" and pastes an
    // empty buffer into an issue has been actively misled.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /copy last 500 lines/i })).toBeEnabled(),
    );
    expect(clipboard).toEqual([]);
  });
});
