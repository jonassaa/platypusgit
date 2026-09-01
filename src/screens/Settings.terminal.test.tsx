// Settings → Terminal shell (#243).
//
// Blank is the default AND the answer for most people: the built-in terminal
// should be the same shell as the one outside the app, and the backend resolves
// that from `$SHELL`. So the two things worth pinning are that it starts empty
// — a non-empty default would silently give someone a different shell from
// their own terminal — and that blank survives being cleared, since that is the
// route back for anyone who typed a path that turned out not to work.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";

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

beforeEach(() => {
  localStorage.clear();
  resetDialogs();
  mockRestOfSettings();
  useSettingsStore.getState().reset();
});

function renderSettings() {
  render(
    <WithDialogs>
      <SettingsScreen />
    </WithDialogs>,
  );
}

const field = () => screen.getByTestId<HTMLInputElement>("terminal-shell");

describe("the terminal shell field", () => {
  it("starts empty, which is what makes the built-in terminal the user's own shell", () => {
    renderSettings();
    expect(field().value).toBe("");
    expect(useSettingsStore.getState().terminalShell).toBe("");
  });

  it("stores the shell the user names", () => {
    renderSettings();
    fireEvent.change(field(), {
      target: { value: "/opt/homebrew/bin/fish" },
    });
    expect(useSettingsStore.getState().terminalShell).toBe(
      "/opt/homebrew/bin/fish",
    );
  });

  it("lets the field be cleared back to the default", () => {
    renderSettings();
    fireEvent.change(field(), { target: { value: "/bin/nonsense" } });
    fireEvent.change(field(), { target: { value: "" } });
    expect(useSettingsStore.getState().terminalShell).toBe("");
  });
});
