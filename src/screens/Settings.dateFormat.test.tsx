// Settings ▸ Appearance ▸ Date format (#354).
//
// The formatting itself is pinned in lib/commitDate.test.ts and the column
// width in design/graph-geometry.test.ts. This file asserts the only part
// neither of those can: that the preference is REACHABLE, that the control
// reflects what is stored, and that the row says what it does — including the
// two things that hold in every mode (hover, and the detail panel), so nobody
// picks "Relative" believing the exact time is now unreachable.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
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
  mockInvoke("get_update_capability", () => "self-update");
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log",
    logExists: false,
    logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0",
    version: "0.1.0",
  }));
}

beforeEach(() => {
  localStorage.clear();
  mockRestOfSettings();
  useSettingsStore.getState().set("dateFormat", "relative");
});

const button = (name: string) => screen.getByRole("button", { name });

describe("Settings → Appearance: the date format", () => {
  it("offers the three formats and shows which one is stored", () => {
    render(<SettingsScreen />);
    expect(button("Relative").getAttribute("aria-pressed")).toBe("true");
    expect(button("Absolute").getAttribute("aria-pressed")).toBe("false");
    expect(button("Both").getAttribute("aria-pressed")).toBe("false");
  });

  it("persists a pick and moves the pressed state with it", async () => {
    render(<SettingsScreen />);
    await userEvent.click(button("Both"));
    expect(useSettingsStore.getState().dateFormat).toBe("both");
    expect(button("Both").getAttribute("aria-pressed")).toBe("true");
    expect(button("Relative").getAttribute("aria-pressed")).toBe("false");
  });

  // The row carries a live sample, so the difference between the three is read
  // off the screen rather than guessed from the word.
  it("previews the chosen format on a real timestamp", async () => {
    render(<SettingsScreen />);
    const sample = () => screen.getByTestId("settings-date-format-sample").textContent ?? "";
    expect(sample()).toBe("3w ago");

    await userEvent.click(button("Absolute"));
    expect(sample()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    await userEvent.click(button("Both"));
    expect(sample()).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(3w ago\)$/);
  });

  // "Relative" must not read as "the exact time is gone".
  it("says the full timestamp is always available", () => {
    render(<SettingsScreen />);
    const hint = screen.getByTestId("settings-date-format-hint").textContent ?? "";
    expect(hint).toMatch(/hover/i);
    expect(hint).toMatch(/commit details/i);
  });
});
