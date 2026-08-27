// Settings → Commit → Ticket pattern (#252).
//
// The pattern's SEMANTICS are pinned next to `extractTicket` and its coercion
// next to the store. What only the screen can get wrong is the one thing tested
// here: a pattern that will not compile means the composer's ticket chip simply
// never appears, so the field has to say so while it is being typed rather than
// accepting it in silence.
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

const field = () => screen.getByTestId<HTMLInputElement>("settings-ticket-pattern");

describe("the ticket pattern field", () => {
  it("shows the stored pattern and writes edits straight through", () => {
    renderSettings();
    expect(field().value).toBe("[A-Z][A-Z0-9]+-\\d+");
    fireEvent.change(field(), { target: { value: "issue-(\\d+)" } });
    expect(useSettingsStore.getState().commitTicketPattern).toBe("issue-(\\d+)");
    expect(field().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("flags a pattern that will not compile", () => {
    renderSettings();
    fireEvent.change(field(), { target: { value: "([unclosed" } });
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("treats an empty pattern as off, not as broken", () => {
    renderSettings();
    fireEvent.change(field(), { target: { value: "" } });
    expect(field().getAttribute("aria-invalid")).not.toBe("true");
  });
});
