// Settings search: one flat list of matching rows across every page, each with
// its real working control.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { mockInvoke } from "@/test/invokeMock";
import { WithDialogs, resetDialogs } from "@/test/dialog";
import { useSettingsStore } from "@/features/settings/useSettingsStore";
import { SettingsScreen } from "./Settings";

function typeSearch(text: string) {
  fireEvent.change(screen.getByTestId("settings-search"), { target: { value: text } });
}

beforeEach(() => {
  resetDialogs();
  useSettingsStore.getState().set("settingsPage", "general.appearance");
  mockInvoke("cli_shim_status", () => ({
    installed: true, shimPath: "/usr/local/bin/pgit",
    target: "/usr/bin/platypusgit", source: "package", pathState: "onPath",
  }));
  mockInvoke("diagnostics_report", () => ({
    logPath: "/tmp/platypusgit.log", logExists: false, logSizeBytes: 0,
    environment: "host os=macos arch=aarch64 git=2.43.0", version: "0.1.0",
  }));
  mockInvoke("get_update_capability", () => "self-update");
});

describe("settings search", () => {
  it("shows matching rows from more than one page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    // "version" hits general.updates ("Current version") AND advanced.backup
    // (diagnostics.environment's "version" keyword) — two distinct pages,
    // verified against the real page metas (`grep` for "version" across
    // src/features/settings/pages/*.tsx turns up exactly these two ids).
    typeSearch("version");
    expect(document.querySelector('[data-setting-id="updates.version"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="diagnostics.environment"]')).toBeTruthy();
    // The page the user was on is no longer rendered as a page.
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeNull();
  });

  it("shows a breadcrumb for each page with hits", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("theme");
    expect(screen.getByText(/General.*Appearance/)).toBeTruthy();
  });

  it("hides rows on a hit page that do not match", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    expect(document.querySelector('[data-setting-id="diff.context"]')).toBeTruthy();
    expect(document.querySelector('[data-setting-id="diff.layout"]')).toBeNull();
  });

  it("badges pages with hits and dims pages without", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("context lines");
    const diff = screen.getByRole("treeitem", { name: /Diff/ });
    expect(diff.textContent).toContain("1");
    // Pages with no hits stay listed rather than disappearing.
    expect(screen.getByRole("treeitem", { name: /Updates/ })).toBeTruthy();
  });

  it("finds a row by a keyword its label does not contain", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("gpg");
    expect(document.querySelector('[data-setting-id="commit.sign"]')).toBeTruthy();
  });

  it("shows an empty state and clears back to the page", () => {
    render(<WithDialogs><SettingsScreen /></WithDialogs>);
    typeSearch("zzzznope");
    expect(screen.getByText(/No settings match/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Clear search/ }));
    expect(document.querySelector('[data-settings-page="general.appearance"]')).toBeTruthy();
  });
});
