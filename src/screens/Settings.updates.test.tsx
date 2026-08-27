// The Updates panel's half of #237: the three-way preference is reachable, and
// "Never" is visibly off rather than a button that quietly does nothing.
//
// The gate itself is pinned in features/update/updateCheckMode.test.ts — this
// file only asserts the UI cannot lead someone into it.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { useUpdateStore } from "@/features/update/useUpdateStore";
import { SettingsScreen } from "./Settings";

/** The rest of the Settings screen loads too; give it what it asks for. */
function mockRestOfSettings() {
  mockInvoke("cli_shim_status", () => ({
    installed: true,
    shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit",
    source: "package",
    pathState: "onPath",
  }));
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log",
    logExists: false,
    logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0",
    version: "0.1.0",
  }));
}

let checked: boolean[];

beforeEach(() => {
  checked = [];
  localStorage.clear();
  mockRestOfSettings();
  useSettingsStore.getState().set("updateCheckMode", "auto");
  useUpdateStore.setState({
    status: "idle",
    info: null,
    capability: null,
    dismissedVersion: null,
    currentVersion: "0.1.0",
    lastCheckedAt: null,
    installing: false,
    progress: null,
    error: null,
    message: null,
    panelOpen: false,
    check: vi.fn(async (manual: boolean) => void checked.push(manual)),
  });
});

const modeSelect = () => screen.getByTestId("update-check-mode");
const checkButton = () =>
  screen.getByRole("button", { name: /check for updates/i });

/** PGSelect is an in-page listbox, not a native <select> — its rows are the
 *  only place the labels appear once (the trigger renders a hidden sizing copy
 *  of the current one, which is why a bare getByText finds two). */
const openModeOptions = async (): Promise<HTMLElement[]> => {
  await userEvent.click(modeSelect());
  return [...document.querySelectorAll<HTMLElement>("[data-pg-option]")];
};

const pickMode = async (label: string) => {
  const rows = await openModeOptions();
  const row = rows.find((r) => r.textContent === label);
  if (!row) throw new Error(`no option labelled "${label}"`);
  await userEvent.click(row);
};

describe("Settings → Updates: the check preference", () => {
  it("offers the three modes through PGSelect and persists the choice", async () => {
    render(<SettingsScreen />);
    // The labels are the promise the user reads; assert them, not the values.
    const rows = await openModeOptions();
    expect(rows.map((r) => r.textContent)).toEqual([
      "Automatically",
      "Only when I ask",
      "Never",
    ]);
    // And no native control got there by the back door (guard-tested globally,
    // asserted here because this is the row that introduced one).
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelector("option")).toBeNull();

    await userEvent.click(rows[1]);
    expect(useSettingsStore.getState().updateCheckMode).toBe("manual");
    const raw = JSON.parse(localStorage.getItem("pg-settings-v2") ?? "{}");
    expect(raw.updateCheckMode).toBe("manual");
  });

  it("keeps the manual button live under 'only when I ask'", async () => {
    useSettingsStore.getState().set("updateCheckMode", "manual");
    render(<SettingsScreen />);
    expect(checkButton()).not.toBeDisabled();
    await userEvent.click(checkButton());
    expect(checked).toEqual([true]);
  });

  it("disables the button and explains itself under 'never'", async () => {
    useSettingsStore.getState().set("updateCheckMode", "never");
    render(<SettingsScreen />);
    expect(checkButton()).toBeDisabled();
    expect(
      screen.getByText(/update checks are turned off/i),
    ).toBeInTheDocument();
    // Disabled means disabled: even a forced click reaches nothing.
    await userEvent.click(checkButton(), { pointerEventsCheck: 0 });
    expect(checked).toEqual([]);
  });

  it("is one click back out of 'never' — not a dead end", async () => {
    useSettingsStore.getState().set("updateCheckMode", "never");
    render(<SettingsScreen />);
    await pickMode("Only when I ask");
    expect(useSettingsStore.getState().updateCheckMode).toBe("manual");
    await waitFor(() => expect(checkButton()).not.toBeDisabled());
  });
});

describe("Settings → Updates: last checked", () => {
  it("says never when nothing has been checked yet", () => {
    render(<SettingsScreen />);
    expect(screen.getByTestId("update-last-checked")).toHaveTextContent(
      /never/i,
    );
  });

  it("shows a relative time once a check has run", () => {
    useUpdateStore.setState({ lastCheckedAt: Date.now() - 2 * 3600 * 1000 });
    render(<SettingsScreen />);
    expect(screen.getByTestId("update-last-checked")).toHaveTextContent("2h ago");
  });
});
