// Settings → Diff → External diff tool (#235).
//
// The field's whole job is to stay OUT of the way: git resolves the tool from
// `diff.guitool` / `diff.tool` / `merge.tool` on its own, so empty is both the
// default and the answer for most people. What only the screen can get wrong is
// the one mistake the field invites — pasting a command line
// (`bcompare "$LOCAL" "$REMOTE"`) where git wants a tool NAME. The backend
// refuses it; without a marker here the user would only find out by clicking
// and reading a banner.
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

const field = () =>
  screen.getByTestId<HTMLInputElement>("settings-external-diff-tool");

describe("the external diff tool field", () => {
  it("starts empty — git decides — and writes edits straight through", () => {
    renderSettings();
    expect(field().value).toBe("");
    expect(field().getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.change(field(), { target: { value: "meld" } });
    expect(useSettingsStore.getState().externalDiffTool).toBe("meld");
    expect(field().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("flags a command line, which git cannot use as a tool name", () => {
    renderSettings();
    fireEvent.change(field(), {
      target: { value: 'bcompare "$LOCAL" "$REMOTE"' },
    });
    expect(field().getAttribute("aria-invalid")).toBe("true");
  });

  it("does not flag an empty field — that is the default and it is valid", () => {
    renderSettings();
    fireEvent.change(field(), { target: { value: "kdiff3" } });
    fireEvent.change(field(), { target: { value: "" } });
    expect(field().getAttribute("aria-invalid")).not.toBe("true");
    expect(useSettingsStore.getState().externalDiffTool).toBe("");
  });
});
